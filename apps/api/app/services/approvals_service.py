import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import AccountingConfig, Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import utcnow
from app.models.events import (
    ApprovalRequest,
    ApprovalStatus,
    AuditLog,
    DraftStatus,
    DraftType,
    Event,
    EventDraft,
)
from app.models.tenant import Tenant
from app.models.users import StaffRole, UserType
from app.models.venue import EventInventoryAllocation, InventoryItem
from app.services.accounting_service import DoubleEntryService


class ApprovalsService:
    @staticmethod
    async def submit_draft_for_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        draft_id: uuid.UUID,
        requester_id: uuid.UUID,
        requester_type: str,
    ) -> tuple[ApprovalRequest, DraftStatus]:
        draft = (
            await db.execute(
                select(EventDraft).where(EventDraft.id == draft_id, EventDraft.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")

        event = (
            await db.execute(select(Event).where(Event.id == draft.event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        settings_map = tenant.settings or {}
        lock_hours = (
            settings_map.get("cateringLockHours", 72)
            if draft.draft_type == DraftType.CATERING_MENU
            else settings_map.get("floorPlanLockHours", 24)
        )
        hours_until = (event.start_time.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 3600.0

        if (event.is_locked or hours_until < lock_hours) and requester_type != "INTERNAL_STAFF":
            raise HTTPException(status_code=403, detail=f"Draft is locked ({lock_hours}h pre-event freeze).")

        if draft.financial_delta > Decimal("0.00") and requester_id != event.primary_client_id:
            draft.status = DraftStatus.PENDING_CLIENT_APPROVAL
            required_role = "CLIENT_PRIMARY"
        else:
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            required_role = "OPS_MANAGER"

        approval = ApprovalRequest(
            tenant_id=tenant_id,
            event_id=event.id,
            draft_id=draft.id,
            requested_by_id=requester_id,
            required_approver_role=required_role,
            status=ApprovalStatus.PENDING,
        )
        db.add(approval)
        await db.commit()
        await db.refresh(approval)
        return approval, draft.status

    @staticmethod
    async def resolve_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        approval_id: uuid.UUID,
        approver_id: uuid.UUID,
        approver_user_type: UserType,
        approver_staff_role: Optional[StaffRole],
        decision: ApprovalStatus | str,
        rejection_reason: Optional[str] = None,
    ) -> dict:
        approval = (
            await db.execute(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.id == approval_id,
                    ApprovalRequest.tenant_id == tenant_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not approval or approval.status != ApprovalStatus.PENDING:
            raise HTTPException(status_code=400, detail="Approval request not found or already resolved")

        draft = (
            await db.execute(
                select(EventDraft).where(EventDraft.id == approval.draft_id, EventDraft.tenant_id == tenant_id)
            )
        ).scalar_one()
        event = (
            await db.execute(select(Event).where(Event.id == approval.event_id, Event.tenant_id == tenant_id))
        ).scalar_one()

        # Enforce strict approver role and event ownership
        if approval.required_approver_role == "CLIENT_PRIMARY":
            if approver_user_type != UserType.SUPER_ADMIN and approver_id != event.primary_client_id:
                raise HTTPException(
                    status_code=403,
                    detail="Only the event's primary client may resolve this client approval gate",
                )
        elif approval.required_approver_role == "OPS_MANAGER":
            allowed_staff = {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.OPS_MANAGER}
            if approver_user_type != UserType.SUPER_ADMIN and (
                approver_user_type != UserType.INTERNAL_STAFF or approver_staff_role not in allowed_staff
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Only OPS_MANAGER, ADMIN, or OWNER may resolve internal approval gates",
                )

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        dec_str = decision.value if isinstance(decision, ApprovalStatus) else str(decision).upper()

        if dec_str == "RETURNED_FOR_AMENDMENT":
            approval.status = ApprovalStatus.REJECTED
            approval.approved_by_id = approver_id
            approval.rejection_reason = f"[RETURNED_FOR_AMENDMENT] {rejection_reason or ''}".strip()
            approval.resolved_at = utcnow()
            draft.status = DraftStatus.DRAFT
            db.add(
                AuditLog(
                    tenant_id=tenant_id,
                    event_id=event.id,
                    actor_id=approver_id,
                    action="DRAFT_RETURNED_FOR_AMENDMENT",
                    new_value={"draft_id": str(draft.id), "remarks": rejection_reason},
                )
            )
            await db.commit()
            return {"status": "RETURNED_FOR_AMENDMENT", "draft_id": str(draft.id), "remarks": rejection_reason}

        dec_enum = ApprovalStatus(dec_str)
        approval.status = dec_enum
        approval.approved_by_id = approver_id
        approval.rejection_reason = rejection_reason
        approval.resolved_at = utcnow()

        if dec_enum == ApprovalStatus.REJECTED:
            draft.status = DraftStatus.REJECTED
            db.add(
                AuditLog(
                    tenant_id=tenant_id,
                    event_id=event.id,
                    actor_id=approver_id,
                    action="DRAFT_REJECTED",
                    new_value={"draft_id": str(draft.id), "reason": rejection_reason},
                )
            )
            await db.commit()
            return {"status": "REJECTED", "draft_id": str(draft.id)}

        if approval.required_approver_role == "CLIENT_PRIMARY":
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            next_gate = ApprovalRequest(
                tenant_id=tenant_id,
                event_id=event.id,
                draft_id=draft.id,
                requested_by_id=approver_id,
                required_approver_role="OPS_MANAGER",
                status=ApprovalStatus.PENDING,
            )
            db.add(next_gate)
            await db.commit()
            return {"status": "FORWARDED_TO_OPS", "next_approval_id": str(next_gate.id)}

        draft.status = DraftStatus.APPROVED_SYNCED
        payload = draft.payload or {}

        delta_net = Decimal(str(draft.financial_delta)).quantize(Decimal("0.01"))
        if delta_net != Decimal("0.00"):
            invoice = (
                await db.execute(
                    select(Invoice)
                    .where(Invoice.event_id == event.id, Invoice.tenant_id == tenant_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if invoice:
                old_tax = Decimal(str(invoice.tax_amount)).quantize(Decimal("0.01"))
                old_total = Decimal(str(invoice.total_amount)).quantize(Decimal("0.01"))
                new_subtotal = (Decimal(str(invoice.subtotal)) + delta_net).quantize(Decimal("0.01"))
                new_tax = (new_subtotal * (Decimal(str(tenant.tax_rate)) / Decimal("100.00"))).quantize(
                    Decimal("0.01")
                )
                new_total = (new_subtotal + new_tax).quantize(Decimal("0.01"))
                tax_delta = (new_tax - old_tax).quantize(Decimal("0.01"))
                total_delta = (new_total - old_total).quantize(Decimal("0.01"))

                invoice.subtotal = new_subtotal
                invoice.tax_amount = new_tax
                invoice.total_amount = new_total

                pending = (
                    await db.execute(
                        select(PaymentMilestone)
                        .where(
                            PaymentMilestone.invoice_id == invoice.id,
                            PaymentMilestone.tenant_id == tenant_id,
                            PaymentMilestone.status == "PENDING",
                            PaymentMilestone.is_security_deposit == False,  # noqa: E712
                        )
                        .order_by(PaymentMilestone.due_date.asc())
                    )
                ).scalars().all()
                if pending:
                    pending[-1].amount_due = (Decimal(str(pending[-1].amount_due)) + total_delta).quantize(
                        Decimal("0.01")
                    )
                elif total_delta > Decimal("0.00"):
                    db.add(
                        PaymentMilestone(
                            tenant_id=tenant_id,
                            invoice_id=invoice.id,
                            title=f"تعديل مالي معتمد / Approved Change Order (v{draft.version_number})",
                            amount_due=total_delta,
                            due_date=utcnow() + timedelta(days=3),
                            is_security_deposit=False,
                            upload_token_jti=uuid.uuid4().hex,
                            status="PENDING",
                        )
                    )
                    if invoice.status == InvoiceStatus.PAID:
                        invoice.status = InvoiceStatus.PARTIALLY_PAID

                # Post balanced GL adjustment entry inside same transaction
                cfg = (
                    await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
                ).scalar_one_or_none()
                if cfg and cfg.accounts_receivable_id and cfg.hall_revenue_account_id and total_delta != Decimal("0.00"):
                    rev_acc = (
                        cfg.catering_revenue_account_id
                        if draft.draft_type == DraftType.CATERING_MENU and cfg.catering_revenue_account_id
                        else cfg.hall_revenue_account_id
                    )
                    lines: list[dict] = []
                    if total_delta > Decimal("0.00"):
                        lines.append(
                            {
                                "account_id": cfg.accounts_receivable_id,
                                "debit": total_delta,
                                "credit": Decimal("0.00"),
                                "memo": f"Change order AR ({draft.draft_type.value})",
                            }
                        )
                        lines.append(
                            {
                                "account_id": rev_acc,
                                "debit": Decimal("0.00"),
                                "credit": delta_net,
                                "memo": f"Change order revenue v{draft.version_number}",
                            }
                        )
                        if tax_delta > Decimal("0.00") and cfg.tax_payable_account_id:
                            lines.append(
                                {
                                    "account_id": cfg.tax_payable_account_id,
                                    "debit": Decimal("0.00"),
                                    "credit": tax_delta,
                                    "memo": "Change order tax",
                                }
                            )
                    else:
                        abs_total = abs(total_delta)
                        abs_net = abs(delta_net)
                        abs_tax = abs(tax_delta)
                        lines.append(
                            {
                                "account_id": rev_acc,
                                "debit": abs_net,
                                "credit": Decimal("0.00"),
                                "memo": f"Change order credit v{draft.version_number}",
                            }
                        )
                        if abs_tax > Decimal("0.00") and cfg.tax_payable_account_id:
                            lines.append(
                                {
                                    "account_id": cfg.tax_payable_account_id,
                                    "debit": abs_tax,
                                    "credit": Decimal("0.00"),
                                    "memo": "Change order tax credit",
                                }
                            )
                        lines.append(
                            {
                                "account_id": cfg.accounts_receivable_id,
                                "debit": Decimal("0.00"),
                                "credit": abs_total,
                                "memo": f"Change order AR reduction ({draft.draft_type.value})",
                            }
                        )

                    await DoubleEntryService.post_balanced_entry(
                        db=db,
                        tenant_id=tenant_id,
                        created_by_id=approver_id,
                        reference=f"ADJ-{invoice.invoice_number}-v{draft.version_number}",
                        description=f"Approved draft financial adjustment for {event.event_code}",
                        event_id=event.id,
                        lines=lines,
                        is_system_posting=True,
                        idempotency_key=f"DRAFT_SYNC:{draft.id}",
                    )

        if payload.get("itemId") and payload.get("quantityReserved") is not None:
            item_uuid = uuid.UUID(str(payload["itemId"]))
            item = (
                await db.execute(
                    select(InventoryItem).where(InventoryItem.id == item_uuid, InventoryItem.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if item:
                alloc = (
                    await db.execute(
                        select(EventInventoryAllocation).where(
                            EventInventoryAllocation.event_id == event.id,
                            EventInventoryAllocation.item_id == item.id,
                            EventInventoryAllocation.tenant_id == tenant_id,
                        )
                    )
                ).scalar_one_or_none()
                qty = int(payload["quantityReserved"])
                if alloc:
                    alloc.quantity_reserved = qty
                else:
                    db.add(
                        EventInventoryAllocation(
                            tenant_id=tenant_id,
                            event_id=event.id,
                            item_id=item.id,
                            quantity_reserved=qty,
                        )
                    )

        if "totalSeatedGuests" in payload:
            event.guest_count = int(payload["totalSeatedGuests"])

        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=event.id,
                actor_id=approver_id,
                action="DRAFT_APPROVED_AND_SYNCED",
                new_value={"draft_id": str(draft.id), "financial_delta": float(draft.financial_delta)},
            )
        )
        await db.commit()
        return {"status": "APPROVED_SYNCED", "event_id": str(event.id), "draft_id": str(draft.id)}
