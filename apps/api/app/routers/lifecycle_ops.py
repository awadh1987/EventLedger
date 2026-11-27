import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles, verify_event_access
from app.models.accounting import AccountingConfig, DepositStatus, Invoice
from app.models.base import utcnow
from app.models.events import AuditLog, Event, EventStatus, GatePass
from app.models.events_extensions import DamageInspection, EventContract, EventGuest, InspectionStatus, RsvpStatus
from app.models.users import StaffRole, UserType
from app.services.accounting_service import DoubleEntryService

router = APIRouter(prefix="/api/v1", tags=["Tier 2: Contracts, Guests, Receipt Verify & Deposit Vault"])


class SignContractBody(BaseModel):
    signature_name: str


class AddGuestBody(BaseModel):
    full_name: str
    phone: Optional[str] = None
    vip_tier: str = "STANDARD"
    dietary_notes: Optional[str] = None
    table_label: Optional[str] = None


class VerifyMilestoneBody(BaseModel):
    payment_method: str = "KURAIMI_BANK"
    is_security_deposit: bool = False
    reference: str = "Verified Transfer"


class DamageInspectionBody(BaseModel):
    status: InspectionStatus
    deduction_amount: Decimal = Decimal("0.00")
    notes: Optional[str] = None
    checklist_json: dict = {}


@router.get("/portal/events/{event_id}/contract")
async def get_event_contract(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)

    contract = (
        await db.execute(
            select(EventContract).where(
                EventContract.event_id == event_id,
                EventContract.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    return {
        "id": str(contract.id),
        "event_id": str(contract.event_id),
        "contract_number": contract.contract_number,
        "terms_ar": contract.terms_ar,
        "terms_en": contract.terms_en,
        "client_signed_at": contract.client_signed_at.isoformat() if contract.client_signed_at else None,
        "client_signature_name": contract.client_signature_name,
        "staff_countersigned_at": contract.staff_countersigned_at.isoformat() if contract.staff_countersigned_at else None,
        "pdf_url": contract.pdf_url,
    }


@router.post("/portal/events/{event_id}/contract/sign")
async def sign_event_contract(
    event_id: uuid.UUID,
    body: SignContractBody,
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id, primary_client_or_staff_only=True)

    contract = (
        await db.execute(
            select(EventContract).where(
                EventContract.event_id == event_id,
                EventContract.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract.client_signed_at = utcnow()
    contract.client_signature_name = body.signature_name.strip()
    contract.client_signature_ip = request.client.host if request.client else "unknown"

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="CONTRACT_ESIGNED_BY_CLIENT",
            new_value={"contract_number": contract.contract_number, "signed_by": contract.client_signature_name},
        )
    )
    await db.commit()
    return {
        "status": "SIGNED",
        "contract_number": contract.contract_number,
        "signed_at": contract.client_signed_at.isoformat(),
    }


@router.get("/portal/events/{event_id}/guests")
async def list_event_guests(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)

    rows = (
        await db.execute(
            select(EventGuest, GatePass)
            .outerjoin(GatePass, EventGuest.gate_pass_id == GatePass.id)
            .where(EventGuest.event_id == event_id, EventGuest.tenant_id == auth.tenant_id)
            .order_by(EventGuest.created_at.desc())
        )
    ).all()
    return [
        {
            "id": str(g.id),
            "full_name": g.full_name,
            "phone": g.phone,
            "vip_tier": g.vip_tier,
            "dietary_notes": g.dietary_notes,
            "table_label": g.table_label,
            "rsvp_status": g.rsvp_status.value,
            "qr_token": gp.qr_token if gp else None,
            "pass_type": gp.pass_type if gp else None,
            "is_checked_in": gp.is_checked_in if gp else False,
        }
        for g, gp in rows
    ]


@router.post("/portal/events/{event_id}/guests")
async def add_guest_with_qr_pass(
    event_id: uuid.UUID,
    body: AddGuestBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = await verify_event_access(db, auth, event_id, required_delegate_perm="canManageGuests")

    qr_token = f"QR-{ev.event_code}-{str(uuid.uuid4().int % 100000).zfill(5)}"
    gate_pass = GatePass(
        tenant_id=auth.tenant_id,
        event_id=ev.id,
        pass_type="VIP_PASS" if body.vip_tier == "VIP" else "GUEST_PASS",
        holder_name=body.full_name.strip(),
        qr_token=qr_token,
        valid_from=ev.start_time - timedelta(hours=2),
        valid_until=ev.end_time + timedelta(hours=2),
    )
    db.add(gate_pass)
    await db.flush()

    guest = EventGuest(
        tenant_id=auth.tenant_id,
        event_id=ev.id,
        full_name=body.full_name.strip(),
        phone=body.phone,
        vip_tier=body.vip_tier,
        dietary_notes=body.dietary_notes,
        table_label=body.table_label,
        rsvp_status=RsvpStatus.CONFIRMED,
        gate_pass_id=gate_pass.id,
    )
    db.add(guest)
    await db.commit()
    return {"guest_id": str(guest.id), "qr_token": qr_token, "pass_type": gate_pass.pass_type}


@router.patch("/erp/finance/milestones/{milestone_id}/verify")
async def verify_payment_milestone(
    milestone_id: uuid.UUID,
    body: VerifyMilestoneBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.verify_milestone_payment(
        db=db,
        tenant_id=auth.tenant_id,
        user_id=auth.user.id,
        milestone_id=milestone_id,
        payment_method=body.payment_method,
        is_security_deposit=body.is_security_deposit,
        reference=body.reference,
    )


@router.post("/erp/ops/events/{event_id}/inspection")
async def submit_damage_inspection(
    event_id: uuid.UUID,
    body: DamageInspectionBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.OPS_MANAGER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    deduction = Decimal(str(body.deduction_amount)).quantize(Decimal("0.01"))
    if deduction < Decimal("0.00"):
        raise HTTPException(status_code=400, detail="deduction_amount cannot be negative")

    inv = (
        await db.execute(
            select(Invoice)
            .where(Invoice.event_id == event_id, Invoice.tenant_id == auth.tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    if inv:
        if body.status == InspectionStatus.DAMAGE_CLAIMED and deduction > Decimal("0.00"):
            if deduction > Decimal(str(inv.security_deposit_amount)):
                raise HTTPException(
                    status_code=400,
                    detail="Deduction amount cannot exceed held security deposit amount",
                )
            cfg = (
                await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == auth.tenant_id))
            ).scalar_one_or_none()
            if not cfg or not cfg.security_deposit_liab_id:
                raise HTTPException(status_code=400, detail="AccountingConfig missing security deposit account")
            recovery_acc = cfg.damage_recovery_account_id or cfg.hall_revenue_account_id
            if not recovery_acc:
                raise HTTPException(status_code=400, detail="AccountingConfig missing damage recovery revenue account")

            await DoubleEntryService.post_balanced_entry(
                db=db,
                tenant_id=auth.tenant_id,
                created_by_id=auth.user.id,
                reference=f"DMG-{inv.invoice_number}",
                description=f"Post-event damage deduction for {ev.event_code}",
                event_id=event_id,
                is_system_posting=True,
                idempotency_key=f"DAMAGE_DEDUCT:{event_id}",
                lines=[
                    {
                        "account_id": cfg.security_deposit_liab_id,
                        "debit": deduction,
                        "credit": Decimal("0.00"),
                        "memo": "Deduct damage claim from security deposit 2100",
                    },
                    {
                        "account_id": recovery_acc,
                        "debit": Decimal("0.00"),
                        "credit": deduction,
                        "memo": "Damage recovery revenue",
                    },
                ],
            )
            inv.deposit_status = DepositStatus.DEDUCTED
        else:
            inv.deposit_status = (
                DepositStatus.INSPECTION_PASSED if body.status == InspectionStatus.PASSED else DepositStatus.DEDUCTED
            )

    ev.status = EventStatus.COMPLETED

    inspection = (
        await db.execute(
            select(DamageInspection).where(
                DamageInspection.event_id == event_id,
                DamageInspection.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if inspection:
        inspection.inspected_by_id = auth.user.id
        inspection.checklist_json = body.checklist_json
        inspection.deduction_amount = deduction
        inspection.notes = body.notes
        inspection.status = body.status
        inspection.inspected_at = utcnow()
    else:
        inspection = DamageInspection(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            inspected_by_id=auth.user.id,
            checklist_json=body.checklist_json,
            deduction_amount=deduction,
            notes=body.notes,
            status=body.status,
        )
        db.add(inspection)

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="POST_EVENT_DAMAGE_INSPECTION",
            new_value={"status": body.status.value, "deduction_amount": float(deduction)},
        )
    )
    await db.commit()
    return {"status": body.status.value, "deposit_status": inv.deposit_status.value if inv else None}
