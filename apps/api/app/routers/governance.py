import re
import uuid
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, verify_event_access
from app.models.base import utcnow
from app.models.events import AuditLog, Event
from app.models.governance import (
    ChangeApprovalRequest,
    GovernanceRequestStatus,
    GovernanceScope,
    GovernanceTargetType,
)
from app.models.tenant import SubscriptionStatus, SubscriptionTier, Tenant
from app.models.users import ClientCategory, ClientProfile, StaffRole, User, UserType

router = APIRouter(prefix="/api/v1", tags=["Tiered Governance & Identity Change Approvals"])


class CreateChangeRequestBody(BaseModel):
    target_entity_type: GovernanceTargetType
    target_entity_id: Optional[uuid.UUID] = None
    request_title: Optional[str] = Field(default=None, max_length=255)
    proposed_values: dict
    remarks: Optional[str] = Field(default=None, max_length=1000)


class ResolveChangeRequestBody(BaseModel):
    decision: Literal["APPROVED", "REJECTED", "RETURNED_FOR_AMENDMENT"]
    remarks: Optional[str] = Field(default=None, max_length=1000)


class ResubmitChangeRequestBody(BaseModel):
    proposed_values: dict
    remarks: Optional[str] = Field(default=None, max_length=1000)


@router.post("/governance/change-requests")
async def submit_governance_change_request(
    body: CreateChangeRequestBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not body.proposed_values:
        raise HTTPException(status_code=400, detail="proposed_values must not be empty")

    scope: GovernanceScope
    tenant_id: Optional[uuid.UUID] = auth.tenant_id
    target_id: uuid.UUID
    current_values: dict = {}
    proposed: dict = {}
    default_title: str

    if body.target_entity_type == GovernanceTargetType.EVENT:
        if not auth.tenant_id or not body.target_entity_id:
            raise HTTPException(status_code=400, detail="tenant_id and target_entity_id are required for EVENT changes")
        ev = await verify_event_access(db, auth, body.target_entity_id)
        scope = GovernanceScope.TENANT_ADMIN
        target_id = ev.id
        allowed = {"title", "event_type", "guest_count"}
        for k, v in body.proposed_values.items():
            if k in allowed:
                proposed[k] = v
        if not proposed:
            raise HTTPException(status_code=400, detail="No editable EVENT fields provided")
        current_values = {"title": ev.title, "event_type": ev.event_type, "guest_count": ev.guest_count}
        default_title = f"Event Change: {ev.event_code}"

    elif body.target_entity_type == GovernanceTargetType.CLIENT:
        if not auth.tenant_id:
            raise HTTPException(status_code=400, detail="Tenant context required")
        target_id = body.target_entity_id or auth.user.id
        if auth.user.user_type not in (UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN) and target_id != auth.user.id:
            raise HTTPException(status_code=403, detail="Clients may only submit identity change requests for themselves")
        client_user = (
            await db.execute(select(User).where(User.id == target_id, User.tenant_id == auth.tenant_id))
        ).scalar_one_or_none()
        if not client_user:
            raise HTTPException(status_code=404, detail="Client account not found")
        cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == client_user.id))).scalar_one_or_none()
        scope = GovernanceScope.TENANT_ADMIN
        allowed = {
            "full_name",
            "phone",
            "email",
            "client_category",
            "company_name",
            "tax_id",
            "national_id_or_cr",
            "billing_address",
        }
        for k, v in body.proposed_values.items():
            if k in allowed:
                proposed[k] = v
        if not proposed:
            raise HTTPException(status_code=400, detail="No editable CLIENT fields provided")
        current_values = {
            "full_name": client_user.full_name,
            "phone": client_user.phone,
            "email": client_user.email,
            "client_category": cp.client_category.value if cp else ClientCategory.INDIVIDUAL_B2C.value,
            "company_name": cp.company_name if cp else None,
            "tax_id": cp.tax_id if cp else None,
            "national_id_or_cr": cp.national_id_or_cr if cp else None,
            "billing_address": cp.billing_address if cp else None,
        }
        default_title = f"Client Identity Change: {client_user.full_name}"

    else:  # TENANT -> Platform Super Admin approval
        if auth.user.user_type not in (UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN):
            raise HTTPException(status_code=403, detail="Only tenant staff or super admin may submit TENANT changes")
        if auth.user.user_type == UserType.INTERNAL_STAFF and auth.staff_role not in (StaffRole.OWNER, StaffRole.ADMIN):
            raise HTTPException(status_code=403, detail="Only Tenant OWNER or ADMIN may submit TENANT governance requests")
        target_id = body.target_entity_id or auth.tenant_id
        if not target_id:
            raise HTTPException(status_code=400, detail="Target tenant_id is required")
        tenant = (await db.execute(select(Tenant).where(Tenant.id == target_id))).scalar_one_or_none()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        tenant_id = tenant.id
        scope = GovernanceScope.SUPER_ADMIN
        allowed = {
            "name",
            "slug",
            "custom_domain",
            "currency",
            "tax_rate",
            "subscription_tier",
            "max_halls",
            "monthly_whatsapp_quota",
        }
        for k, v in body.proposed_values.items():
            if k in allowed:
                proposed[k] = v
        if not proposed:
            raise HTTPException(status_code=400, detail="No editable TENANT fields provided")
        current_values = {
            "name": tenant.name,
            "slug": tenant.slug,
            "custom_domain": tenant.custom_domain,
            "currency": tenant.currency,
            "tax_rate": float(tenant.tax_rate),
            "subscription_tier": tenant.subscription_tier.value,
            "max_halls": tenant.max_halls,
            "monthly_whatsapp_quota": tenant.monthly_whatsapp_quota,
        }
        default_title = f"Tenant Change: {tenant.name} (/{tenant.slug})"

    req = ChangeApprovalRequest(
        tenant_id=tenant_id,
        scope=scope.value,
        target_entity_type=body.target_entity_type.value,
        target_entity_id=target_id,
        request_title=(body.request_title or default_title).strip(),
        current_values=current_values,
        proposed_values=proposed,
        status=GovernanceRequestStatus.PENDING.value,
        requester_id=auth.user.id,
        requester_remarks=body.remarks.strip() if body.remarks else None,
    )
    db.add(req)
    await db.flush()
    if tenant_id:
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=target_id if body.target_entity_type == GovernanceTargetType.EVENT else None,
                actor_id=auth.user.id,
                action="GOVERNANCE_CHANGE_REQUESTED",
                old_value=current_values,
                new_value={"request_id": str(req.id), "scope": scope.value, **proposed},
            )
        )
    await db.commit()
    await db.refresh(req)
    return {
        "id": str(req.id),
        "scope": req.scope,
        "status": req.status,
        "target_entity_type": req.target_entity_type,
        "target_entity_id": str(req.target_entity_id),
        "request_title": req.request_title,
        "current_values": req.current_values,
        "proposed_values": req.proposed_values,
        "created_at": req.created_at.isoformat(),
    }


@router.get("/governance/change-requests")
async def list_governance_change_requests(
    scope: Optional[GovernanceScope] = Query(default=None),
    status: Optional[GovernanceRequestStatus] = Query(default=None),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ChangeApprovalRequest)
    if auth.user.user_type == UserType.SUPER_ADMIN:
        pass
    elif auth.user.user_type == UserType.INTERNAL_STAFF:
        if not auth.tenant_id:
            raise HTTPException(status_code=400, detail="Tenant context required")
        stmt = stmt.where(ChangeApprovalRequest.tenant_id == auth.tenant_id)
    else:
        if not auth.tenant_id:
            raise HTTPException(status_code=400, detail="Tenant context required")
        stmt = stmt.where(
            ChangeApprovalRequest.tenant_id == auth.tenant_id,
            ChangeApprovalRequest.requester_id == auth.user.id,
        )

    if scope:
        stmt = stmt.where(ChangeApprovalRequest.scope == scope.value)
    if status:
        stmt = stmt.where(ChangeApprovalRequest.status == status.value)

    rows = (await db.execute(stmt.order_by(ChangeApprovalRequest.created_at.desc()).limit(150))).scalars().all()
    if not rows:
        return []

    user_ids = {r.requester_id for r in rows} | {r.reviewer_id for r in rows if r.reviewer_id}
    tenant_ids = {r.tenant_id for r in rows if r.tenant_id}
    users_map = {
        u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    }
    tenants_map = (
        {t.id: t for t in (await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))).scalars().all()}
        if tenant_ids
        else {}
    )

    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id) if r.tenant_id else None,
            "tenant_name": tenants_map[r.tenant_id].name if r.tenant_id in tenants_map else None,
            "tenant_slug": tenants_map[r.tenant_id].slug if r.tenant_id in tenants_map else None,
            "scope": r.scope,
            "target_entity_type": r.target_entity_type,
            "target_entity_id": str(r.target_entity_id),
            "request_title": r.request_title,
            "current_values": r.current_values,
            "proposed_values": r.proposed_values,
            "status": r.status,
            "requester_id": str(r.requester_id),
            "requester_name": users_map.get(r.requester_id, ""),
            "requester_remarks": r.requester_remarks,
            "reviewer_id": str(r.reviewer_id) if r.reviewer_id else None,
            "reviewer_name": users_map.get(r.reviewer_id) if r.reviewer_id else None,
            "reviewer_remarks": r.reviewer_remarks,
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat(),
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        }
        for r in rows
    ]


@router.post("/governance/change-requests/{request_id}/resolve")
async def resolve_governance_change_request(
    request_id: uuid.UUID,
    body: ResolveChangeRequestBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    req = (
        await db.execute(
            select(ChangeApprovalRequest).where(ChangeApprovalRequest.id == request_id).with_for_update()
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Governance request not found")
    if req.status not in (GovernanceRequestStatus.PENDING.value, GovernanceRequestStatus.RETURNED_FOR_AMENDMENT.value):
        raise HTTPException(status_code=409, detail=f"Request is already resolved ({req.status})")

    if req.scope == GovernanceScope.SUPER_ADMIN.value:
        if auth.user.user_type != UserType.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Only Platform Super Admin may resolve tenant governance requests")
    else:
        if auth.user.user_type != UserType.SUPER_ADMIN:
            can_approve = (
                auth.user.user_type == UserType.INTERNAL_STAFF
                and auth.tenant_id == req.tenant_id
                and (
                    auth.staff_role in (StaffRole.OWNER, StaffRole.ADMIN)
                    or "approve" in (auth.permissions.get("governance") or [])
                )
            )
            if not can_approve:
                raise HTTPException(status_code=403, detail="Only Tenant OWNER or ADMIN may resolve tenant-level requests")

    if body.decision == GovernanceRequestStatus.APPROVED.value:
        pv = req.proposed_values or {}
        if req.target_entity_type == GovernanceTargetType.EVENT.value:
            ev = (
                await db.execute(select(Event).where(Event.id == req.target_entity_id, Event.tenant_id == req.tenant_id))
            ).scalar_one_or_none()
            if not ev:
                raise HTTPException(status_code=404, detail="Target event not found")
            if "title" in pv:
                ev.title = str(pv["title"]).strip() or None if pv["title"] is not None else None
            if "event_type" in pv and pv["event_type"]:
                ev.event_type = str(pv["event_type"]).strip()
            if "guest_count" in pv and pv["guest_count"] is not None:
                ev.guest_count = int(pv["guest_count"])

        elif req.target_entity_type == GovernanceTargetType.CLIENT.value:
            u = (
                await db.execute(select(User).where(User.id == req.target_entity_id, User.tenant_id == req.tenant_id))
            ).scalar_one_or_none()
            if not u:
                raise HTTPException(status_code=404, detail="Target client not found")
            if "full_name" in pv and pv["full_name"]:
                u.full_name = str(pv["full_name"]).strip()
            if "phone" in pv and pv["phone"]:
                clean_p = str(pv["phone"]).strip()
                if clean_p != u.phone:
                    dup = (
                        await db.execute(
                            select(User.id).where(
                                User.tenant_id == req.tenant_id, User.phone == clean_p, User.id != u.id
                            )
                        )
                    ).scalar_one_or_none()
                    if dup:
                        raise HTTPException(status_code=409, detail="Phone number already in use in this tenant")
                    u.phone = clean_p
            if "email" in pv:
                clean_e = str(pv["email"]).strip().lower() if pv["email"] else None
                if clean_e != u.email:
                    if clean_e:
                        dup = (
                            await db.execute(
                                select(User.id).where(
                                    User.tenant_id == req.tenant_id, User.email == clean_e, User.id != u.id
                                )
                            )
                        ).scalar_one_or_none()
                        if dup:
                            raise HTTPException(status_code=409, detail="Email already in use in this tenant")
                    u.email = clean_e
            cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == u.id))).scalar_one_or_none()
            if not cp:
                cp = ClientProfile(user_id=u.id)
                db.add(cp)
            if "client_category" in pv and pv["client_category"]:
                cp.client_category = ClientCategory(pv["client_category"])
            for f in ("company_name", "tax_id", "national_id_or_cr", "billing_address"):
                if f in pv:
                    setattr(cp, f, str(pv[f]).strip() if pv[f] is not None else None)

        elif req.target_entity_type == GovernanceTargetType.TENANT.value:
            t = (await db.execute(select(Tenant).where(Tenant.id == req.target_entity_id))).scalar_one_or_none()
            if not t:
                raise HTTPException(status_code=404, detail="Target tenant not found")
            if "name" in pv and pv["name"]:
                t.name = str(pv["name"]).strip()
            if "slug" in pv and pv["slug"]:
                clean_s = re.sub(r"[^a-z0-9-]", "", str(pv["slug"]).lower().strip())
                if len(clean_s) < 3 or clean_s in {"www", "admin", "api", "app", "mail", "static"}:
                    raise HTTPException(status_code=400, detail="Invalid or reserved tenant slug")
                if clean_s != t.slug:
                    dup = (await db.execute(select(Tenant.id).where(Tenant.slug == clean_s, Tenant.id != t.id))).scalar_one_or_none()
                    if dup:
                        raise HTTPException(status_code=409, detail="Tenant slug already in use")
                    t.slug = clean_s
            if "custom_domain" in pv:
                t.custom_domain = str(pv["custom_domain"]).strip().lower() or None if pv["custom_domain"] else None
            if "currency" in pv and pv["currency"]:
                t.currency = str(pv["currency"]).strip().upper()
            if "tax_rate" in pv and pv["tax_rate"] is not None:
                t.tax_rate = Decimal(str(pv["tax_rate"]))
            if "subscription_tier" in pv and pv["subscription_tier"]:
                t.subscription_tier = SubscriptionTier(pv["subscription_tier"])
            if "subscription_status" in pv and pv["subscription_status"]:
                t.subscription_status = SubscriptionStatus(pv["subscription_status"])
            if "max_halls" in pv and pv["max_halls"] is not None:
                t.max_halls = int(pv["max_halls"])
            if "monthly_whatsapp_quota" in pv and pv["monthly_whatsapp_quota"] is not None:
                q_val = int(pv["monthly_whatsapp_quota"])
                t.monthly_whatsapp_quota = q_val
                t.settings = {**(t.settings or {}), "whatsapp_monthly_quota": q_val}

    req.status = body.decision
    req.reviewer_id = auth.user.id
    req.reviewer_remarks = body.remarks.strip() if body.remarks else None
    req.updated_at = utcnow()
    if body.decision in (GovernanceRequestStatus.APPROVED.value, GovernanceRequestStatus.REJECTED.value):
        req.resolved_at = utcnow()

    if req.tenant_id:
        db.add(
            AuditLog(
                tenant_id=req.tenant_id,
                event_id=req.target_entity_id if req.target_entity_type == GovernanceTargetType.EVENT.value else None,
                actor_id=auth.user.id,
                action=f"GOVERNANCE_CHANGE_{body.decision}",
                old_value=req.current_values,
                new_value={"request_id": str(req.id), **(req.proposed_values or {}), "remarks": req.reviewer_remarks},
            )
        )
    await db.commit()
    return {
        "status": req.status,
        "request_id": str(req.id),
        "reviewer_remarks": req.reviewer_remarks,
    }


@router.patch("/governance/change-requests/{request_id}/resubmit")
async def resubmit_governance_change_request(
    request_id: uuid.UUID,
    body: ResubmitChangeRequestBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    req = (
        await db.execute(
            select(ChangeApprovalRequest).where(ChangeApprovalRequest.id == request_id).with_for_update()
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Governance request not found")
    if req.status not in (
        GovernanceRequestStatus.RETURNED_FOR_AMENDMENT.value,
        GovernanceRequestStatus.PENDING.value,
    ):
        raise HTTPException(status_code=409, detail="Only pending or returned requests may be amended and resubmitted")

    is_owner_resubmit = (
        req.target_entity_type == GovernanceTargetType.TENANT.value
        and auth.user.user_type == UserType.INTERNAL_STAFF
        and auth.tenant_id == req.tenant_id
        and auth.staff_role in (StaffRole.OWNER, StaffRole.ADMIN)
    )
    if req.requester_id != auth.user.id and not is_owner_resubmit and auth.user.user_type != UserType.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only the original requester may resubmit this change request")

    req.proposed_values = body.proposed_values
    if body.remarks is not None:
        req.requester_remarks = body.remarks.strip() or None
    req.status = GovernanceRequestStatus.PENDING.value
    req.updated_at = utcnow()
    if req.tenant_id:
        db.add(
            AuditLog(
                tenant_id=req.tenant_id,
                event_id=req.target_entity_id if req.target_entity_type == GovernanceTargetType.EVENT.value else None,
                actor_id=auth.user.id,
                action="GOVERNANCE_CHANGE_RESUBMITTED",
                new_value={"request_id": str(req.id), **body.proposed_values},
            )
        )
    await db.commit()
    return {"status": req.status, "request_id": str(req.id)}
