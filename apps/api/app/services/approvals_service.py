import uuid
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import ApprovalRequest, ApprovalStatus, AuditLog, DraftStatus, DraftType, Event, EventDraft
from app.models.tenant import Tenant
from app.models.venue import EventInventoryAllocation, InventoryItem


class ApprovalsService:
    @staticmethod
    async def submit_draft_for_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        draft_id: uuid.UUID,
        requester_id: uuid.UUID,
        requester_type: str,
    ) -> ApprovalRequest:
        draft = (await db.execute(select(EventDraft).where(EventDraft.id == draft_id))).scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")

        event = (await db.execute(select(Event).where(Event.id == draft.event_id, Event.tenant_id == tenant_id))).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        settings_map = tenant.settings or {}
        lock_hours = settings_map.get("cateringLockHours", 72) if draft.draft_type == DraftType.CATERING_MENU else settings_map.get("floorPlanLockHours", 24)
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
            event_id=event.id,
            draft_id=draft.id,
            requested_by_id=requester_id,
            required_approver_role=required_role,
            status=ApprovalStatus.PENDING,
        )
        db.add(approval)
        await db.commit()
        await db.refresh(approval)
        return approval

    @staticmethod
    async def resolve_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        approval_id: uuid.UUID,
        approver_id: uuid.UUID,
        decision: ApprovalStatus,
        rejection_reason: str | None = None,
    ) -> dict:
        approval = (await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id))).scalar_one_or_none()
        if not approval or approval.status != ApprovalStatus.PENDING:
            raise HTTPException(status_code=400, detail="Approval request not found or resolved")

        draft = (await db.execute(select(EventDraft).where(EventDraft.id == approval.draft_id))).scalar_one()
        event = (await db.execute(select(Event).where(Event.id == approval.event_id, Event.tenant_id == tenant_id))).scalar_one()
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()

        approval.status = decision
        approval.approved_by_id = approver_id
        approval.rejection_reason = rejection_reason
        approval.resolved_at = datetime.utcnow()

        if decision == ApprovalStatus.REJECTED:
            draft.status = DraftStatus.REJECTED
            await db.commit()
            return {"status": "REJECTED", "draft_id": str(draft.id)}

        if approval.required_approver_role == "CLIENT_PRIMARY":
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            next_gate = ApprovalRequest(
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

        if draft.financial_delta != Decimal("0.00"):
            invoice = (await db.execute(select(Invoice).where(Invoice.event_id == event.id, Invoice.tenant_id == tenant_id))).scalar_one_or_none()
            if invoice:
                invoice.subtotal = Decimal(str(invoice.subtotal)) + draft.financial_delta
                invoice.tax_amount = (Decimal(str(invoice.subtotal)) * (Decimal(str(tenant.tax_rate)) / Decimal("100.00"))).quantize(Decimal("0.01"))
                invoice.total_amount = Decimal(str(invoice.subtotal)) + Decimal(str(invoice.tax_amount)) - Decimal(str(invoice.discount_amount))
                pending = (await db.execute(select(PaymentMilestone).where(PaymentMilestone.invoice_id == invoice.id, PaymentMilestone.status == "PENDING"))).scalars().all()
                if pending:
                    pending[-1].amount_due = Decimal(str(pending[-1].amount_due)) + draft.financial_delta

        if payload.get("itemId") and payload.get("quantityReserved") is not None:
            item_uuid = uuid.UUID(str(payload["itemId"]))
            item = (await db.execute(select(InventoryItem).where(InventoryItem.id == item_uuid, InventoryItem.tenant_id == tenant_id))).scalar_one_or_none()
            if item:
                alloc = (await db.execute(select(EventInventoryAllocation).where(EventInventoryAllocation.event_id == event.id, EventInventoryAllocation.item_id == item.id))).scalar_one_or_none()
                qty = int(payload["quantityReserved"])
                if alloc:
                    alloc.quantity_reserved = qty
                else:
                    db.add(EventInventoryAllocation(event_id=event.id, item_id=item.id, quantity_reserved=qty))

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
