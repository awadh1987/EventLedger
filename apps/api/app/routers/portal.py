import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import AuditLog, Event
from app.models.tenant import Tenant
from app.models.users import ClientCategory, ClientProfile, DelegateRole, EventDelegate, User, UserType
from app.models.venue import Hall

portal_router = APIRouter(prefix="/api/v1/portal", tags=["Client Account Control Panel"])


class UpdateClientProfileBody(BaseModel):
    full_name: Optional[str] = None
    preferred_lang: Optional[str] = None
    is_2fa_enabled: Optional[bool] = None
    client_category: Optional[ClientCategory] = None
    national_id_or_cr: Optional[str] = None
    tax_id: Optional[str] = None
    company_name: Optional[str] = None
    billing_address: Optional[str] = None
    refund_bank_details: Optional[dict] = None


class DelegateUserBody(BaseModel):
    full_name: str
    phone: str
    email: Optional[str] = None
    delegate_role: DelegateRole
    permissions: dict


@portal_router.get("/me")
async def get_portal_me(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == auth.user.id))).scalar_one_or_none()
    return {
        "user": {
            "id": str(auth.user.id),
            "tenant_id": str(auth.user.tenant_id) if auth.user.tenant_id else None,
            "full_name": auth.user.full_name,
            "email": auth.user.email,
            "phone": auth.user.phone,
            "user_type": auth.user.user_type.value,
            "staff_role": auth.staff_role.value if auth.staff_role else None,
            "preferred_lang": auth.user.preferred_lang,
            "is_2fa_enabled": auth.user.is_2fa_enabled,
        },
        "profile": (
            {
                "client_category": cp.client_category.value,
                "national_id_or_cr": cp.national_id_or_cr,
                "tax_id": cp.tax_id,
                "company_name": cp.company_name,
                "billing_address": cp.billing_address,
                "refund_bank_details": cp.refund_bank_details,
                "vip_tier": cp.vip_tier,
            }
            if cp
            else None
        ),
    }


@portal_router.patch("/profile")
async def update_client_profile(
    body: UpdateClientProfileBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    user = auth.user
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.preferred_lang is not None:
        user.preferred_lang = body.preferred_lang
    if body.is_2fa_enabled is not None:
        user.is_2fa_enabled = body.is_2fa_enabled

    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == user.id))).scalar_one_or_none()
    if not cp:
        cp = ClientProfile(user_id=user.id, client_category=body.client_category or ClientCategory.INDIVIDUAL_B2C)
        db.add(cp)
    for field in ["client_category", "national_id_or_cr", "tax_id", "company_name", "billing_address", "refund_bank_details"]:
        val = getattr(body, field)
        if val is not None:
            setattr(cp, field, val)

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=user.id,
            action="CLIENT_PROFILE_UPDATED",
            new_value=body.model_dump(exclude_none=True),
        )
    )
    await db.commit()
    return {"status": "UPDATED"}


@portal_router.get("/events")
async def list_portal_events(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    halls = {
        h.id: h
        for h in (await db.execute(select(Hall).where(Hall.tenant_id == auth.tenant_id))).scalars().all()
    }

    if auth.user.user_type == UserType.INTERNAL_STAFF:
        events = (
            await db.execute(
                select(Event).where(Event.tenant_id == auth.tenant_id).order_by(Event.start_time.asc())
            )
        ).scalars().all()
        role_map = {
            e.id: ("PRIMARY", {"canViewFinance": True, "canEditFloorplan": True, "canRequestAddons": True, "canChat": True})
            for e in events
        }
    else:
        primary_events = (
            await db.execute(
                select(Event).where(Event.tenant_id == auth.tenant_id, Event.primary_client_id == auth.user.id)
            )
        ).scalars().all()
        delegations = (
            await db.execute(
                select(EventDelegate).where(
                    EventDelegate.tenant_id == auth.tenant_id,
                    EventDelegate.user_id == auth.user.id,
                )
            )
        ).scalars().all()
        del_event_ids = [d.event_id for d in delegations]
        del_events = (
            (
                await db.execute(
                    select(Event).where(Event.tenant_id == auth.tenant_id, Event.id.in_(del_event_ids))
                )
            )
            .scalars()
            .all()
            if del_event_ids
            else []
        )
        del_by_ev = {d.event_id: d for d in delegations}

        events_by_id = {e.id: e for e in del_events}
        role_map = {e.id: (del_by_ev[e.id].delegate_role.value, del_by_ev[e.id].permissions or {}) for e in del_events}
        for e in primary_events:
            events_by_id[e.id] = e
            role_map[e.id] = (
                "PRIMARY",
                {"canViewFinance": True, "canEditFloorplan": True, "canRequestAddons": True, "canChat": True},
            )
        events = list(events_by_id.values())

    out = []
    for ev in events:
        my_role, perms = role_map[ev.id]
        hall = halls.get(ev.hall_id)
        inv_payload = None
        if perms.get("canViewFinance", my_role == "PRIMARY"):
            inv = (
                await db.execute(select(Invoice).where(Invoice.event_id == ev.id, Invoice.tenant_id == auth.tenant_id))
            ).scalar_one_or_none()
            if inv:
                milestones = (
                    await db.execute(
                        select(PaymentMilestone)
                        .where(PaymentMilestone.invoice_id == inv.id, PaymentMilestone.tenant_id == auth.tenant_id)
                        .order_by(PaymentMilestone.due_date.asc())
                    )
                ).scalars().all()
                inv_payload = {
                    "id": str(inv.id),
                    "invoice_number": inv.invoice_number,
                    "subtotal": float(inv.subtotal),
                    "discount_amount": float(inv.discount_amount),
                    "tax_amount": float(inv.tax_amount),
                    "total_amount": float(inv.total_amount),
                    "security_deposit_amount": float(inv.security_deposit_amount),
                    "deposit_status": inv.deposit_status.value,
                    "status": inv.status.value,
                    "milestones": [
                        {
                            "id": str(m.id),
                            "title": m.title,
                            "amount_due": float(m.amount_due),
                            "due_date": m.due_date.isoformat(),
                            "paid_amount": float(m.paid_amount),
                            "payment_method": m.payment_method,
                            "receipt_url": m.receipt_url,
                            "status": m.status,
                        }
                        for m in milestones
                    ],
                }
        out.append(
            {
                "id": str(ev.id),
                "event_code": ev.event_code,
                "event_type": ev.event_type,
                "hall_id": str(ev.hall_id),
                "hall_name": hall.name if hall else "",
                "hall_name_ar": hall.name_ar if hall else "",
                "start_time": ev.start_time.isoformat(),
                "end_time": ev.end_time.isoformat(),
                "status": ev.status.value,
                "guest_count": ev.guest_count,
                "is_locked": ev.is_locked,
                "my_role": my_role,
                "permissions": perms,
                "invoice": inv_payload,
            }
        )
    return out


@portal_router.get("/events/{event_id}/delegates")
async def list_event_delegates(
    event_id: uuid.UUID, auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (
        await db.execute(
            select(EventDelegate, User)
            .join(User, EventDelegate.user_id == User.id)
            .where(EventDelegate.event_id == event_id, EventDelegate.tenant_id == auth.tenant_id)
        )
    ).all()
    return [
        {
            "id": str(d.id),
            "user_id": str(u.id),
            "full_name": u.full_name,
            "phone": u.phone,
            "email": u.email,
            "delegate_role": d.delegate_role.value,
            "permissions": d.permissions,
        }
        for d, u in rows
    ]


@portal_router.post("/events/{event_id}/delegates")
async def upsert_event_delegate(
    event_id: uuid.UUID,
    body: DelegateUserBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    event = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.primary_client_id != auth.user.id and auth.user.user_type != UserType.INTERNAL_STAFF:
        raise HTTPException(status_code=403, detail="Forbidden")

    delegate_user = (
        await db.execute(select(User).where(User.phone == body.phone.strip(), User.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not delegate_user:
        delegate_user = User(
            tenant_id=auth.tenant_id,
            user_type=UserType.CLIENT_DELEGATE,
            phone=body.phone.strip(),
            email=body.email.lower().strip() if body.email else None,
            full_name=body.full_name.strip(),
            preferred_lang="ar",
        )
        db.add(delegate_user)
        await db.flush()

    existing = (
        await db.execute(
            select(EventDelegate).where(
                EventDelegate.event_id == event_id,
                EventDelegate.user_id == delegate_user.id,
                EventDelegate.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.delegate_role = body.delegate_role
        existing.permissions = body.permissions
        delegate_id = existing.id
    else:
        new_del = EventDelegate(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            user_id=delegate_user.id,
            delegate_role=body.delegate_role,
            permissions=body.permissions,
        )
        db.add(new_del)
        await db.flush()
        delegate_id = new_del.id

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="DELEGATE_UPDATED",
            new_value={"phone": body.phone, "role": body.delegate_role.value, "permissions": body.permissions},
        )
    )
    await db.commit()
    return {"status": "SAVED", "delegate_id": str(delegate_id)}


@portal_router.delete("/events/{event_id}/delegates/{delegate_id}")
async def remove_event_delegate(
    event_id: uuid.UUID,
    delegate_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    deleg = (
        await db.execute(
            select(EventDelegate).where(
                EventDelegate.id == delegate_id,
                EventDelegate.event_id == event_id,
                EventDelegate.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not deleg:
        raise HTTPException(status_code=404, detail="Delegate not found")
    await db.delete(deleg)
    await db.commit()
    return {"status": "REMOVED"}


@portal_router.get("/audit-logs")
async def list_audit_logs(
    event_id: Optional[uuid.UUID] = Query(default=None),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    query = select(AuditLog, User.full_name).join(User, AuditLog.actor_id == User.id).where(AuditLog.tenant_id == auth.tenant_id)
    if event_id:
        query = query.where(AuditLog.event_id == event_id)
    rows = (await db.execute(query.order_by(AuditLog.created_at.desc()).limit(100))).all()
    return [
        {
            "id": str(r.id),
            "action": r.action,
            "actor_name": actor_name,
            "event_id": str(r.event_id) if r.event_id else None,
            "old_value": r.old_value,
            "new_value": r.new_value,
            "created_at": r.created_at.isoformat(),
        }
        for r, actor_name in rows
    ]


ALLOWED_RECEIPT_EXT = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
MAX_RECEIPT_BYTES = 8 * 1024 * 1024


async def save_milestone_receipt(
    db: AsyncSession,
    milestone: PaymentMilestone,
    upload: UploadFile,
    payment_method: Optional[str],
    transfer_reference: Optional[str],
    actor_id: Optional[uuid.UUID] = None,
) -> dict:
    """Validate + store a receipt, flag the milestone UNDER_REVIEW and commit."""
    ext = Path(upload.filename or "receipt.jpg").suffix.lower() or ".jpg"
    if ext not in ALLOWED_RECEIPT_EXT:
        raise HTTPException(status_code=400, detail="Unsupported receipt file type")
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty receipt file")
    if len(data) > MAX_RECEIPT_BYTES:
        raise HTTPException(status_code=413, detail="Receipt file too large (max 8MB)")

    upload_dir = Path(settings.UPLOAD_DIR) / "receipts"
    os.makedirs(upload_dir, exist_ok=True)
    fname = f"{milestone.id}_{uuid.uuid4().hex[:8]}{ext}"
    (upload_dir / fname).write_bytes(data)

    milestone.receipt_url = f"/uploads/receipts/{fname}"
    milestone.status = "UNDER_REVIEW"
    if payment_method and payment_method.strip():
        milestone.payment_method = payment_method.strip()[:60]
    ref = (transfer_reference or "").strip()[:80]
    if ref and ref not in milestone.title:
        milestone.title = f"{milestone.title} | Ref: {ref}"[:255]
    if actor_id:
        db.add(
            AuditLog(
                tenant_id=milestone.tenant_id,
                actor_id=actor_id,
                action="MILESTONE_RECEIPT_UPLOADED",
                new_value={"milestone_id": str(milestone.id), "transfer_reference": ref or None},
            )
        )
    await db.commit()
    return {
        "status": "UNDER_REVIEW",
        "milestone_id": str(milestone.id),
        "receipt_url": milestone.receipt_url,
        "payment_method": milestone.payment_method,
        "transfer_reference": ref or None,
    }


@portal_router.post("/milestones/{milestone_id}/receipt")
async def upload_milestone_receipt(
    milestone_id: uuid.UUID,
    receipt: Optional[UploadFile] = File(default=None),
    file: Optional[UploadFile] = File(default=None),
    payment_method: Optional[str] = Form(default=None),
    transfer_reference: Optional[str] = Form(default=None),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    upload = receipt or file
    if upload is None:
        raise HTTPException(status_code=422, detail="receipt file is required")
    milestone = (
        await db.execute(
            select(PaymentMilestone).where(
                PaymentMilestone.id == milestone_id,
                PaymentMilestone.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return await save_milestone_receipt(db, milestone, upload, payment_method, transfer_reference, auth.user.id)


@portal_router.get("/payment-accounts")
async def get_payment_accounts(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one()
    accounts = (tenant.settings or {}).get("paymentAccounts")
    if accounts:
        return accounts
    return [
        {"method": "KURAIMI", "label_ar": "بنك الكريمي", "label_en": "Kuraimi Bank", "account_name": tenant.name, "account_number": "301234567"},
        {"method": "JAIB", "label_ar": "محفظة جيب", "label_en": "Jaib Wallet", "account_name": tenant.name, "account_number": "770000001"},
        {"method": "JAWALI", "label_ar": "محفظة جوالي", "label_en": "Jawali Wallet", "account_name": tenant.name, "account_number": "770000002"},
        {"method": "ONECASH", "label_ar": "ون كاش", "label_en": "OneCash", "account_name": tenant.name, "account_number": "770000003"},
    ]
