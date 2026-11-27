import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles, verify_event_access
from app.models.accounting import DepositStatus, Invoice, PaymentMilestone
from app.models.base import utcnow
from app.models.events import AuditLog, Event, EventStatus, GatePass
from app.models.events_extensions import DamageInspection, EventContract, EventSecurityProfile
from app.models.users import StaffRole, User, UserType
from app.services.comms_service import CommsService

router = APIRouter(prefix="/api/v1", tags=["Events & Halls Security, Deposit Lifecycle & Close Operation"])

DEFAULT_READINESS_CHECKLIST = {
    "fire_and_exits": False,
    "cctv_and_lighting": False,
    "guard_roster_assigned": False,
    "vip_and_privacy_zone": False,
    "vendor_loading_bay": False,
    "crowd_capacity_plan": False,
}

SECURITY_STAFF_ROLES = {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.OPS_MANAGER, StaffRole.SECURITY}
CLOSE_OP_ROLES = {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.OPS_MANAGER, StaffRole.FINANCE}


class UpdateSecurityReadinessBody(BaseModel):
    readiness_checklist_json: dict = Field(default_factory=dict)
    guard_headcount: int = Field(default=4, ge=0, le=200)
    security_lead_name: Optional[str] = Field(default=None, max_length=150)
    security_status: Literal["DRAFT", "PENDING_REVIEW", "CLEARED", "RETURNED_FOR_AMENDMENT", "INCIDENT_FLAGGED"] = "DRAFT"
    tenant_remarks: Optional[str] = None
    amendment_reason: Optional[str] = None


class ClientSecurityRemarksBody(BaseModel):
    client_remarks: Optional[str] = None
    resubmit: bool = False


class CreateSecurityPassBody(BaseModel):
    clearance_category: str = Field(default="GUEST", min_length=2, max_length=40)
    pass_type: Optional[str] = Field(default=None, max_length=40)
    holder_name: str = Field(..., min_length=2, max_length=255)
    holder_phone: Optional[str] = Field(default=None, max_length=40)
    holder_id_number: Optional[str] = Field(default=None, max_length=80)
    organization: Optional[str] = Field(default=None, max_length=255)
    vehicle_plate: Optional[str] = Field(default=None, max_length=60)
    remarks: Optional[str] = None
    clearance_status: Optional[Literal["APPROVED", "PENDING_APPROVAL", "RETURNED_FOR_AMENDMENT", "REVOKED"]] = None
    require_approval: bool = False


class UpdateSecurityPassBody(BaseModel):
    clearance_category: Optional[str] = Field(default=None, max_length=40)
    pass_type: Optional[str] = Field(default=None, max_length=40)
    holder_name: Optional[str] = Field(default=None, max_length=255)
    holder_phone: Optional[str] = Field(default=None, max_length=40)
    holder_id_number: Optional[str] = Field(default=None, max_length=80)
    organization: Optional[str] = Field(default=None, max_length=255)
    vehicle_plate: Optional[str] = Field(default=None, max_length=60)
    clearance_status: Optional[Literal["APPROVED", "PENDING_APPROVAL", "RETURNED_FOR_AMENDMENT", "REVOKED"]] = None
    remarks: Optional[str] = None
    is_checked_in: Optional[bool] = None
    resubmit: bool = False


class ClientInspectionRespondBody(BaseModel):
    decision: Literal["ACCEPT", "RETURN_FOR_AMENDMENT", "UPDATE_REMARKS"]
    client_remarks: Optional[str] = None
    amendment_remarks: Optional[str] = None


class CloseOperationBody(BaseModel):
    closing_remarks: str = Field(..., min_length=2, max_length=1500)
    force_close: bool = False


class ReopenOperationBody(BaseModel):
    reason: str = Field(..., min_length=2, max_length=1000)


def _serialize_pass(p: GatePass) -> dict:
    return {
        "id": str(p.id),
        "event_id": str(p.event_id),
        "pass_type": p.pass_type,
        "clearance_category": p.clearance_category,
        "holder_name": p.holder_name,
        "holder_phone": p.holder_phone,
        "holder_id_number": p.holder_id_number,
        "organization": p.organization,
        "vehicle_plate": p.vehicle_plate,
        "clearance_status": p.clearance_status,
        "remarks": p.remarks,
        "qr_token": p.qr_token,
        "valid_from": p.valid_from.isoformat(),
        "valid_until": p.valid_until.isoformat(),
        "is_checked_in": p.is_checked_in,
        "checked_in_at": p.checked_in_at.isoformat() if p.checked_in_at else None,
    }


def _default_pass_type(category: str) -> str:
    c = category.strip().upper()
    if c == "VIP":
        return "VIP_PASS"
    if c in ("VENDOR", "STAFF", "MEDIA", "CONTRACTOR"):
        return "VENDOR_PASS"
    return "GUEST_PASS"


@router.get("/security/events/{event_id}/overview")
async def get_event_security_overview(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = await verify_event_access(db, auth, event_id)
    profile = (
        await db.execute(
            select(EventSecurityProfile).where(
                EventSecurityProfile.event_id == event_id,
                EventSecurityProfile.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    passes = (
        await db.execute(
            select(GatePass)
            .where(GatePass.event_id == event_id, GatePass.tenant_id == auth.tenant_id)
            .order_by(GatePass.valid_from.asc(), GatePass.holder_name.asc())
        )
    ).scalars().all()
    logs = (
        await db.execute(
            select(AuditLog, User.full_name)
            .join(User, AuditLog.actor_id == User.id)
            .where(
                AuditLog.tenant_id == auth.tenant_id,
                AuditLog.event_id == event_id,
                AuditLog.action.ilike("%SECURITY%"),
            )
            .order_by(AuditLog.created_at.desc())
            .limit(40)
        )
    ).all()

    return {
        "event": {
            "id": str(ev.id),
            "event_code": ev.event_code,
            "title": ev.title,
            "status": ev.status.value,
            "start_time": ev.start_time.isoformat(),
            "end_time": ev.end_time.isoformat(),
            "guest_count": ev.guest_count,
            "is_locked": bool(ev.is_locked),
        },
        "security_profile": {
            "readiness_checklist_json": (
                {**DEFAULT_READINESS_CHECKLIST, **(profile.readiness_checklist_json or {})}
                if profile
                else dict(DEFAULT_READINESS_CHECKLIST)
            ),
            "guard_headcount": profile.guard_headcount if profile else 4,
            "security_lead_name": profile.security_lead_name if profile else None,
            "security_status": profile.security_status if profile else "DRAFT",
            "tenant_remarks": profile.tenant_remarks if profile else None,
            "client_remarks": profile.client_remarks if profile else None,
            "amendment_reason": profile.amendment_reason if profile else None,
            "updated_at": profile.updated_at.isoformat() if profile else None,
        },
        "passes": [_serialize_pass(p) for p in passes],
        "stats": {
            "total": len(passes),
            "approved": sum(1 for p in passes if p.clearance_status == "APPROVED"),
            "pending": sum(1 for p in passes if p.clearance_status == "PENDING_APPROVAL"),
            "returned": sum(1 for p in passes if p.clearance_status == "RETURNED_FOR_AMENDMENT"),
            "revoked": sum(1 for p in passes if p.clearance_status == "REVOKED"),
            "checked_in": sum(1 for p in passes if p.is_checked_in),
        },
        "audit_logs": [
            {
                "id": str(lg.id),
                "action": lg.action,
                "actor_name": actor_name,
                "new_value": lg.new_value,
                "created_at": lg.created_at.isoformat(),
            }
            for lg, actor_name in logs
        ],
    }


@router.put("/security/events/{event_id}/readiness")
async def upsert_security_readiness(
    event_id: uuid.UUID,
    body: UpdateSecurityReadinessBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, SECURITY_STAFF_ROLES, required_perm=("security", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    profile = (
        await db.execute(
            select(EventSecurityProfile).where(
                EventSecurityProfile.event_id == event_id,
                EventSecurityProfile.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not profile:
        profile = EventSecurityProfile(tenant_id=auth.tenant_id, event_id=event_id)
        db.add(profile)

    profile.readiness_checklist_json = {**DEFAULT_READINESS_CHECKLIST, **(body.readiness_checklist_json or {})}
    profile.guard_headcount = body.guard_headcount
    profile.security_lead_name = body.security_lead_name.strip() if body.security_lead_name else None
    profile.security_status = body.security_status
    profile.tenant_remarks = body.tenant_remarks.strip() if body.tenant_remarks else None
    if body.amendment_reason is not None:
        profile.amendment_reason = body.amendment_reason.strip() or None
    elif body.security_status != "RETURNED_FOR_AMENDMENT":
        profile.amendment_reason = None
    profile.updated_by_id = auth.user.id
    profile.updated_at = utcnow()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="SECURITY_READINESS_UPDATED",
            new_value={
                "security_status": profile.security_status,
                "guard_headcount": profile.guard_headcount,
                "tenant_remarks": profile.tenant_remarks,
                "amendment_reason": profile.amendment_reason,
            },
        )
    )
    await db.commit()
    return {
        "status": "SAVED",
        "security_status": profile.security_status,
        "updated_at": profile.updated_at.isoformat(),
    }


@router.patch("/security/events/{event_id}/client-remarks")
async def update_client_security_remarks(
    event_id: uuid.UUID,
    body: ClientSecurityRemarksBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)
    profile = (
        await db.execute(
            select(EventSecurityProfile).where(
                EventSecurityProfile.event_id == event_id,
                EventSecurityProfile.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not profile:
        profile = EventSecurityProfile(tenant_id=auth.tenant_id, event_id=event_id)
        db.add(profile)

    profile.client_remarks = body.client_remarks.strip() if body.client_remarks else None
    if body.resubmit and profile.security_status in ("DRAFT", "RETURNED_FOR_AMENDMENT"):
        profile.security_status = "PENDING_REVIEW"
    profile.updated_by_id = auth.user.id
    profile.updated_at = utcnow()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="SECURITY_CLIENT_REMARKS_UPDATED",
            new_value={
                "client_remarks": profile.client_remarks,
                "resubmit": body.resubmit,
                "security_status": profile.security_status,
            },
        )
    )
    await db.commit()
    return {"status": "SAVED", "security_status": profile.security_status, "client_remarks": profile.client_remarks}


@router.post("/security/events/{event_id}/passes")
async def create_security_pass(
    event_id: uuid.UUID,
    body: CreateSecurityPassBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = await verify_event_access(db, auth, event_id, required_delegate_perm="canManageGuests")

    is_staff = auth.user.user_type in (UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN)
    cat = body.clearance_category.strip().upper()
    pass_type = (body.pass_type or _default_pass_type(cat)).strip().upper()

    if is_staff:
        clearance_status = body.clearance_status or "APPROVED"
    else:
        clearance_status = "PENDING_APPROVAL" if (body.require_approval or cat not in ("GUEST", "VIP")) else "APPROVED"

    qr_token = f"QR-{ev.event_code}-{uuid.uuid4().hex[:6].upper()}"
    gp = GatePass(
        tenant_id=auth.tenant_id,
        event_id=ev.id,
        pass_type=pass_type,
        clearance_category=cat,
        holder_name=body.holder_name.strip(),
        holder_phone=body.holder_phone.strip() if body.holder_phone else None,
        holder_id_number=body.holder_id_number.strip() if body.holder_id_number else None,
        organization=body.organization.strip() if body.organization else None,
        vehicle_plate=body.vehicle_plate.strip() if body.vehicle_plate else None,
        clearance_status=clearance_status,
        remarks=body.remarks.strip() if body.remarks else None,
        requested_by_id=auth.user.id,
        reviewed_by_id=auth.user.id if is_staff and clearance_status == "APPROVED" else None,
        qr_token=qr_token,
        valid_from=ev.start_time - timedelta(hours=3),
        valid_until=ev.end_time + timedelta(hours=3),
    )
    db.add(gp)
    await db.flush()
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="SECURITY_PASS_CREATED",
            new_value={
                "pass_id": str(gp.id),
                "holder_name": gp.holder_name,
                "clearance_category": gp.clearance_category,
                "clearance_status": gp.clearance_status,
            },
        )
    )
    await db.commit()
    await db.refresh(gp)
    return _serialize_pass(gp)


@router.patch("/security/passes/{pass_id}")
async def update_security_pass(
    pass_id: uuid.UUID,
    body: UpdateSecurityPassBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    gp = (
        await db.execute(select(GatePass).where(GatePass.id == pass_id, GatePass.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not gp:
        raise HTTPException(status_code=404, detail="Security pass not found")

    is_staff = auth.user.user_type in (UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN)
    if is_staff:
        if auth.user.user_type == UserType.INTERNAL_STAFF and auth.staff_role not in SECURITY_STAFF_ROLES:
            raise HTTPException(status_code=403, detail="Insufficient security clearance role")
    else:
        await verify_event_access(db, auth, gp.event_id, required_delegate_perm="canManageGuests")

    if body.clearance_category is not None:
        gp.clearance_category = body.clearance_category.strip().upper()
    if body.pass_type is not None:
        gp.pass_type = body.pass_type.strip().upper()
    if body.holder_name is not None and body.holder_name.strip():
        gp.holder_name = body.holder_name.strip()
    if body.holder_phone is not None:
        gp.holder_phone = body.holder_phone.strip() or None
    if body.holder_id_number is not None:
        gp.holder_id_number = body.holder_id_number.strip() or None
    if body.organization is not None:
        gp.organization = body.organization.strip() or None
    if body.vehicle_plate is not None:
        gp.vehicle_plate = body.vehicle_plate.strip() or None
    if body.remarks is not None:
        gp.remarks = body.remarks.strip() or None

    if is_staff:
        if body.clearance_status is not None:
            gp.clearance_status = body.clearance_status
            gp.reviewed_by_id = auth.user.id
        if body.is_checked_in is not None:
            gp.is_checked_in = body.is_checked_in
            gp.checked_in_at = utcnow() if body.is_checked_in else None
    elif body.resubmit:
        gp.clearance_status = "PENDING_APPROVAL"

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=gp.event_id,
            actor_id=auth.user.id,
            action="SECURITY_PASS_UPDATED",
            new_value={
                "pass_id": str(gp.id),
                "clearance_status": gp.clearance_status,
                "remarks": gp.remarks,
            },
        )
    )
    await db.commit()
    await db.refresh(gp)
    return _serialize_pass(gp)


@router.get("/events/{event_id}/deposit-lifecycle")
async def get_event_deposit_lifecycle(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = await verify_event_access(db, auth, event_id)
    inv = (
        await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    insp = (
        await db.execute(
            select(DamageInspection).where(
                DamageInspection.event_id == event_id,
                DamageInspection.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    contract = (
        await db.execute(
            select(EventContract).where(
                EventContract.event_id == event_id,
                EventContract.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    sec_profile = (
        await db.execute(
            select(EventSecurityProfile).where(
                EventSecurityProfile.event_id == event_id,
                EventSecurityProfile.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()

    milestones = []
    if inv:
        milestones = (
            await db.execute(
                select(PaymentMilestone)
                .where(PaymentMilestone.invoice_id == inv.id, PaymentMilestone.tenant_id == auth.tenant_id)
                .order_by(PaymentMilestone.due_date.asc())
            )
        ).scalars().all()

    paid_installments = sum(
        (Decimal(str(m.paid_amount)) for m in milestones if not m.is_security_deposit),
        Decimal("0.00"),
    )
    sec_held = Decimal(str(inv.security_deposit_amount)) if inv else Decimal("0.00")
    ded_amt = Decimal(str(insp.deduction_amount)) if insp else Decimal("0.00")
    refundable = max(Decimal("0.00"), sec_held - ded_amt)

    return {
        "event": {
            "id": str(ev.id),
            "event_code": ev.event_code,
            "title": ev.title,
            "status": ev.status.value,
            "is_locked": bool(ev.is_locked),
            "closed_at": ev.closed_at.isoformat() if ev.closed_at else None,
            "closing_remarks": ev.closing_remarks,
            "reopened_reason": ev.reopened_reason,
        },
        "invoice": (
            {
                "id": str(inv.id),
                "invoice_number": inv.invoice_number,
                "total_amount": float(inv.total_amount),
                "paid_amount": float(paid_installments),
                "security_deposit_amount": float(sec_held),
                "deposit_status": inv.deposit_status.value,
                "status": inv.status.value,
            }
            if inv
            else None
        ),
        "inspection": (
            {
                "id": str(insp.id),
                "status": insp.status.value,
                "approval_status": insp.approval_status,
                "checklist_json": insp.checklist_json or {},
                "deduction_items": insp.deduction_items_json or [],
                "deduction_amount": float(ded_amt),
                "refundable_balance": float(refundable),
                "notes": insp.notes,
                "client_remarks": insp.client_remarks,
                "amendment_remarks": insp.amendment_remarks,
                "inspected_at": insp.inspected_at.isoformat(),
            }
            if insp
            else None
        ),
        "pre_close_checklist": {
            "contract_signed": bool(contract and contract.client_signed_at),
            "invoice_settled": bool(inv and paid_installments >= Decimal(str(inv.total_amount))),
            "security_cleared": bool(sec_profile and sec_profile.security_status == "CLEARED"),
            "inspection_completed": bool(insp and insp.approval_status == "FINALIZED"),
            "deposit_resolved": bool(
                not inv or inv.security_deposit_amount <= 0 or inv.deposit_status in (DepositStatus.REFUNDED, DepositStatus.UNPAID)
            ),
        },
    }


@router.post("/portal/events/{event_id}/inspection/respond")
async def client_respond_to_inspection(
    event_id: uuid.UUID,
    body: ClientInspectionRespondBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)
    insp = (
        await db.execute(
            select(DamageInspection).where(
                DamageInspection.event_id == event_id,
                DamageInspection.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not insp:
        raise HTTPException(status_code=404, detail="Damage inspection not found")

    if body.client_remarks is not None:
        insp.client_remarks = body.client_remarks.strip() or None
    if body.decision == "ACCEPT":
        insp.approval_status = "CLIENT_ACCEPTED"
    elif body.decision == "RETURN_FOR_AMENDMENT":
        insp.approval_status = "RETURNED_FOR_AMENDMENT"
        if body.amendment_remarks is not None:
            insp.amendment_remarks = body.amendment_remarks.strip() or None
        elif body.client_remarks:
            insp.amendment_remarks = body.client_remarks.strip()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="INSPECTION_CLIENT_RESPONSE",
            new_value={
                "decision": body.decision,
                "approval_status": insp.approval_status,
                "client_remarks": insp.client_remarks,
            },
        )
    )
    await db.commit()
    return {
        "status": body.decision,
        "approval_status": insp.approval_status,
        "client_remarks": insp.client_remarks,
        "amendment_remarks": insp.amendment_remarks,
    }


@router.post("/erp/ops/events/{event_id}/close-operation")
async def close_event_operation(
    event_id: uuid.UUID,
    body: CloseOperationBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CLOSE_OP_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.status == EventStatus.CLOSED:
        raise HTTPException(status_code=409, detail="Operation is already closed")

    inv = (
        await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if inv and inv.deposit_status == DepositStatus.HELD:
        if not body.force_close:
            raise HTTPException(
                status_code=400,
                detail="Refundable security deposit is still HELD. Complete inspection & deposit settlement or pass force_close as Admin/Owner.",
            )
        if auth.staff_role not in (StaffRole.OWNER, StaffRole.ADMIN):
            raise HTTPException(status_code=403, detail="Only OWNER or ADMIN may force-close an event with a HELD deposit")

    old_status = ev.status.value
    ev.status = EventStatus.CLOSED
    ev.is_locked = True
    ev.closed_at = utcnow()
    ev.closed_by_id = auth.user.id
    ev.closing_remarks = body.closing_remarks.strip()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="EVENT_OPERATION_CLOSED",
            old_value={"status": old_status},
            new_value={
                "status": EventStatus.CLOSED.value,
                "closing_remarks": ev.closing_remarks,
                "force_close": body.force_close,
            },
        )
    )
    client = (await db.execute(select(User).where(User.id == ev.primary_client_id))).scalar_one_or_none()
    if client:
        await CommsService.notify_and_whatsapp(
            db,
            auth.tenant_id,
            title=f"إغلاق تشغيل الفعالية رسمياً · {ev.event_code}",
            content=f"تم إغلاق ملف التشغيل للفعالية {ev.event_code}: {ev.closing_remarks}",
            category="OPERATION_CLOSED",
            event_id=ev.id,
            recipient_user_id=client.id,
            recipient_phone=client.phone,
            send_whatsapp=True,
        )
    await db.commit()
    return {
        "status": ev.status.value,
        "is_locked": True,
        "closed_at": ev.closed_at.isoformat(),
        "closing_remarks": ev.closing_remarks,
    }


@router.post("/erp/ops/events/{event_id}/reopen-operation")
async def reopen_event_operation(
    event_id: uuid.UUID,
    body: ReopenOperationBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.status != EventStatus.CLOSED:
        raise HTTPException(status_code=409, detail="Only CLOSED operations can be reopened")

    insp = (
        await db.execute(
            select(DamageInspection).where(
                DamageInspection.event_id == event_id,
                DamageInspection.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()

    ev.status = EventStatus.COMPLETED if (insp and insp.approval_status == "FINALIZED") else EventStatus.CONFIRMED
    ev.is_locked = False
    ev.reopened_reason = body.reason.strip()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="EVENT_OPERATION_REOPENED",
            old_value={"status": EventStatus.CLOSED.value},
            new_value={"status": ev.status.value, "reason": ev.reopened_reason},
        )
    )
    await db.commit()
    return {"status": ev.status.value, "is_locked": False, "reopened_reason": ev.reopened_reason}
