import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth
from app.models.events import AuditLog, Event
from app.models.users import ClientCategory, ClientProfile, DelegateRole, EventDelegate, UserType

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
    delegate_user_id: uuid.UUID
    delegate_role: DelegateRole
    permissions: dict


@portal_router.patch("/profile")
async def update_client_profile(body: UpdateClientProfileBody, auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
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

    db.add(AuditLog(tenant_id=auth.tenant_id, actor_id=user.id, action="CLIENT_PROFILE_UPDATED", new_value=body.model_dump(exclude_none=True)))
    await db.commit()
    return {"status": "UPDATED"}


@portal_router.post("/events/{event_id}/delegates")
async def upsert_event_delegate(event_id: uuid.UUID, body: DelegateUserBody, auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    event = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.primary_client_id != auth.user.id and auth.user.user_type != UserType.INTERNAL_STAFF:
        raise HTTPException(status_code=403, detail="Forbidden")

    existing = (await db.execute(select(EventDelegate).where(EventDelegate.event_id == event_id, EventDelegate.user_id == body.delegate_user_id))).scalar_one_or_none()
    if existing:
        existing.delegate_role = body.delegate_role
        existing.permissions = body.permissions
    else:
        db.add(EventDelegate(event_id=event_id, user_id=body.delegate_user_id, delegate_role=body.delegate_role, permissions=body.permissions))

    db.add(AuditLog(tenant_id=auth.tenant_id, event_id=event_id, actor_id=auth.user.id, action="DELEGATE_UPDATED", new_value=body.permissions))
    await db.commit()
    return {"status": "SAVED"}


@portal_router.get("/audit-logs")
async def list_audit_logs(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (await db.execute(select(AuditLog).where(AuditLog.tenant_id == auth.tenant_id).order_by(AuditLog.created_at.desc()).limit(100))).scalars().all()
    return [{"id": str(r.id), "action": r.action, "new_value": r.new_value, "created_at": r.created_at.isoformat()} for r in rows]
