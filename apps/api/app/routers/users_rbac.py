from decimal import Decimal
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    RBAC_ACTIONS,
    RBAC_MODULES,
    AuthContext,
    default_permissions_for_role,
    hash_password,
    require_roles,
    resolve_effective_permissions,
)
from app.models.events import AuditLog
from app.models.tenant import Tenant
from app.models.users import StaffProfile, StaffRole, User, UserType

router = APIRouter(prefix="/api/v1", tags=["Tenant Users, RBAC & Platform User Oversight"])


class CreateTenantUserBody(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=255)
    phone: str = Field(..., min_length=7, max_length=40)
    email: Optional[str] = Field(default=None, max_length=255)
    password: str = Field(..., min_length=8)
    staff_role: StaffRole = StaffRole.STAFF
    custom_role_title: Optional[str] = Field(default=None, max_length=120)
    department: str = Field(default="OPERATIONS", max_length=80)
    max_discount_percent: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    commission_rate: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    is_2fa_enabled: bool = False
    is_active: bool = True
    permissions: Optional[dict[str, list[str]]] = None


class UpdateTenantUserBody(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    phone: Optional[str] = Field(default=None, min_length=7, max_length=40)
    email: Optional[str] = Field(default=None, max_length=255)
    staff_role: Optional[StaffRole] = None
    custom_role_title: Optional[str] = Field(default=None, max_length=120)
    department: Optional[str] = Field(default=None, max_length=80)
    max_discount_percent: Optional[Decimal] = Field(default=None, ge=0, le=100)
    commission_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    is_2fa_enabled: Optional[bool] = None
    phone_verified: Optional[bool] = None
    is_active: Optional[bool] = None
    permissions: Optional[dict[str, list[str]]] = None


class ResetUserPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=8)


class AdminCreateUserBody(BaseModel):
    tenant_id: Optional[uuid.UUID] = None
    user_type: UserType = UserType.INTERNAL_STAFF
    full_name: str = Field(..., min_length=2, max_length=255)
    phone: str = Field(..., min_length=7, max_length=40)
    email: Optional[str] = Field(default=None, max_length=255)
    password: str = Field(..., min_length=8)
    staff_role: Optional[StaffRole] = StaffRole.ADMIN
    custom_role_title: Optional[str] = Field(default=None, max_length=120)
    department: str = Field(default="MANAGEMENT", max_length=80)
    is_2fa_enabled: bool = False
    is_active: bool = True
    permissions: Optional[dict[str, list[str]]] = None


class AdminUpdateUserBody(UpdateTenantUserBody):
    user_type: Optional[UserType] = None


def _serialize_staff_row(u: User, sp: Optional[StaffProfile], tenant: Optional[Tenant] = None) -> dict:
    role = sp.role if sp else None
    eff_perms = resolve_effective_permissions(role, sp.permissions_json if sp else None) if sp else {}
    return {
        "id": str(u.id),
        "tenant_id": str(u.tenant_id) if u.tenant_id else None,
        "tenant_name": tenant.name if tenant else None,
        "tenant_slug": tenant.slug if tenant else None,
        "user_type": u.user_type.value,
        "full_name": u.full_name,
        "email": u.email,
        "phone": u.phone,
        "preferred_lang": u.preferred_lang,
        "is_2fa_enabled": bool(u.is_2fa_enabled),
        "phone_verified": bool(u.phone_verified),
        "is_active": bool(u.is_active),
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat(),
        "staff_role": role.value if role else None,
        "custom_role_title": sp.custom_role_title if sp else None,
        "department": sp.department if sp else None,
        "max_discount_percent": float(sp.max_discount_percent) if sp else 0.0,
        "commission_rate": float(sp.commission_rate) if sp else 0.0,
        "permissions": eff_perms,
    }


def _sanitize_permissions(raw: Optional[dict[str, list[str]]], role: StaffRole) -> dict[str, list[str]]:
    if not raw:
        return default_permissions_for_role(role)
    cleaned: dict[str, list[str]] = {}
    for mod in RBAC_MODULES:
        acts = raw.get(mod) or []
        cleaned[mod] = [a for a in acts if a in RBAC_ACTIONS]
    return cleaned


async def _ensure_active_owner_remains(db: AsyncSession, tenant_id: uuid.UUID, excluding_user_id: uuid.UUID) -> None:
    remaining = (
        await db.execute(
            select(func.count(User.id))
            .join(StaffProfile, StaffProfile.user_id == User.id)
            .where(
                User.tenant_id == tenant_id,
                User.id != excluding_user_id,
                User.is_active == True,  # noqa: E712
                StaffProfile.role == StaffRole.OWNER,
            )
        )
    ).scalar() or 0
    if remaining == 0:
        raise HTTPException(status_code=400, detail="At least one active OWNER must remain in the tenant")


@router.get("/tenant/users/meta")
async def get_tenant_users_rbac_meta(
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("users_rbac", "view"))
    ),
):
    return {
        "roles": [r.value for r in StaffRole],
        "modules": RBAC_MODULES,
        "actions": RBAC_ACTIONS,
        "role_presets": {r.value: default_permissions_for_role(r) for r in StaffRole},
    }


@router.get("/tenant/users")
async def list_tenant_users(
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("users_rbac", "view"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (
        await db.execute(
            select(User, StaffProfile)
            .join(StaffProfile, User.id == StaffProfile.user_id)
            .where(User.tenant_id == auth.tenant_id, User.user_type == UserType.INTERNAL_STAFF)
            .order_by(User.created_at.desc())
        )
    ).all()
    return [_serialize_staff_row(u, sp) for u, sp in rows]


@router.post("/tenant/users")
async def create_tenant_user(
    body: CreateTenantUserBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("users_rbac", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    if (
        body.staff_role == StaffRole.OWNER
        and auth.user.user_type != UserType.SUPER_ADMIN
        and auth.staff_role != StaffRole.OWNER
    ):
        raise HTTPException(status_code=403, detail="Only an OWNER or Super Admin may assign the OWNER role")

    clean_phone = body.phone.strip()
    clean_email = body.email.strip().lower() if body.email and body.email.strip() else None

    if (
        await db.execute(select(User.id).where(User.tenant_id == auth.tenant_id, User.phone == clean_phone))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Phone number already exists for another user in this tenant")
    if clean_email and (
        await db.execute(select(User.id).where(User.tenant_id == auth.tenant_id, User.email == clean_email))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already exists for another user in this tenant")

    user = User(
        tenant_id=auth.tenant_id,
        user_type=UserType.INTERNAL_STAFF,
        full_name=body.full_name.strip(),
        phone=clean_phone,
        email=clean_email,
        password_hash=hash_password(body.password),
        preferred_lang="ar",
        is_2fa_enabled=body.is_2fa_enabled,
        is_active=body.is_active,
    )
    db.add(user)
    await db.flush()

    perms = _sanitize_permissions(body.permissions, body.staff_role)
    sp = StaffProfile(
        user_id=user.id,
        role=body.staff_role,
        custom_role_title=body.custom_role_title.strip() if body.custom_role_title else None,
        department=body.department.strip().upper(),
        max_discount_percent=body.max_discount_percent,
        commission_rate=body.commission_rate,
        permissions_json=perms,
    )
    db.add(sp)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="TENANT_USER_CREATED",
            new_value={
                "target_user_id": str(user.id),
                "full_name": user.full_name,
                "phone": user.phone,
                "staff_role": sp.role.value,
                "custom_role_title": sp.custom_role_title,
            },
        )
    )
    await db.commit()
    await db.refresh(user)
    return _serialize_staff_row(user, sp)


@router.patch("/tenant/users/{user_id}")
async def update_tenant_user(
    user_id: uuid.UUID,
    body: UpdateTenantUserBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("users_rbac", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    row = (
        await db.execute(
            select(User, StaffProfile)
            .join(StaffProfile, User.id == StaffProfile.user_id)
            .where(User.id == user_id, User.tenant_id == auth.tenant_id, User.user_type == UserType.INTERNAL_STAFF)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Staff user not found")
    user, sp = row

    if (
        body.staff_role == StaffRole.OWNER
        and sp.role != StaffRole.OWNER
        and auth.user.user_type != UserType.SUPER_ADMIN
        and auth.staff_role != StaffRole.OWNER
    ):
        raise HTTPException(status_code=403, detail="Only an OWNER or Super Admin may promote to OWNER")

    if body.is_active is False and user.id == auth.user.id:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account")

    if sp.role == StaffRole.OWNER and ((body.is_active is False) or (body.staff_role and body.staff_role != StaffRole.OWNER)):
        await _ensure_active_owner_remains(db, auth.tenant_id, user.id)

    old_snapshot = {
        "full_name": user.full_name,
        "phone": user.phone,
        "email": user.email,
        "is_active": user.is_active,
        "staff_role": sp.role.value,
        "custom_role_title": sp.custom_role_title,
    }

    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.phone is not None:
        clean_phone = body.phone.strip()
        if clean_phone != user.phone:
            dup = (
                await db.execute(
                    select(User.id).where(
                        User.tenant_id == auth.tenant_id, User.phone == clean_phone, User.id != user.id
                    )
                )
            ).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=409, detail="Phone number already in use in this tenant")
            user.phone = clean_phone
    if body.email is not None:
        clean_email = body.email.strip().lower() or None
        if clean_email != user.email:
            if clean_email:
                dup = (
                    await db.execute(
                        select(User.id).where(
                            User.tenant_id == auth.tenant_id, User.email == clean_email, User.id != user.id
                        )
                    )
                ).scalar_one_or_none()
                if dup:
                    raise HTTPException(status_code=409, detail="Email already in use in this tenant")
            user.email = clean_email
    if body.is_2fa_enabled is not None:
        user.is_2fa_enabled = body.is_2fa_enabled
    if body.phone_verified is not None:
        user.phone_verified = body.phone_verified
    if body.is_active is not None:
        user.is_active = body.is_active

    if body.staff_role is not None:
        sp.role = body.staff_role
        if body.permissions is None and not sp.permissions_json:
            sp.permissions_json = default_permissions_for_role(body.staff_role)
    if body.custom_role_title is not None:
        sp.custom_role_title = body.custom_role_title.strip() or None
    if body.department is not None:
        sp.department = body.department.strip().upper()
    if body.max_discount_percent is not None:
        sp.max_discount_percent = body.max_discount_percent
    if body.commission_rate is not None:
        sp.commission_rate = body.commission_rate
    if body.permissions is not None:
        sp.permissions_json = _sanitize_permissions(body.permissions, sp.role)

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="TENANT_USER_UPDATED",
            old_value=old_snapshot,
            new_value={
                "target_user_id": str(user.id),
                "full_name": user.full_name,
                "is_active": user.is_active,
                "staff_role": sp.role.value,
                "custom_role_title": sp.custom_role_title,
            },
        )
    )
    await db.commit()
    return _serialize_staff_row(user, sp)


@router.post("/tenant/users/{user_id}/reset-password")
async def reset_tenant_user_password(
    user_id: uuid.UUID,
    body: ResetUserPasswordBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("users_rbac", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    user = (
        await db.execute(
            select(User).where(
                User.id == user_id, User.tenant_id == auth.tenant_id, User.user_type == UserType.INTERNAL_STAFF
            )
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Staff user not found")

    user.password_hash = hash_password(body.new_password)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="TENANT_USER_PASSWORD_RESET",
            new_value={"target_user_id": str(user.id)},
        )
    )
    await db.commit()
    return {"status": "PASSWORD_RESET", "user_id": str(user.id)}


@router.delete("/tenant/users/{user_id}")
async def delete_or_deactivate_tenant_user(
    user_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("users_rbac", "delete"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    if user_id == auth.user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    row = (
        await db.execute(
            select(User, StaffProfile)
            .join(StaffProfile, User.id == StaffProfile.user_id)
            .where(User.id == user_id, User.tenant_id == auth.tenant_id, User.user_type == UserType.INTERNAL_STAFF)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Staff user not found")
    user, sp = row

    if sp.role == StaffRole.OWNER:
        await _ensure_active_owner_remains(db, auth.tenant_id, user.id)

    try:
        async with db.begin_nested():
            await db.delete(sp)
            await db.flush()
            await db.delete(user)
            await db.flush()
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                actor_id=auth.user.id,
                action="TENANT_USER_DELETED",
                old_value={"target_user_id": str(user_id), "full_name": user.full_name},
            )
        )
        await db.commit()
        return {"status": "DELETED", "user_id": str(user_id)}
    except IntegrityError:
        user.is_active = False
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                actor_id=auth.user.id,
                action="TENANT_USER_DEACTIVATED",
                new_value={"target_user_id": str(user_id), "reason": "Preserved historical references"},
            )
        )
        await db.commit()
        return {"status": "DEACTIVATED_WITH_HISTORY", "user_id": str(user_id)}


@router.get("/admin/users")
async def admin_list_users(
    tenant_id: Optional[uuid.UUID] = Query(default=None),
    user_type: Optional[UserType] = Query(default=None),
    q: Optional[str] = Query(default=None),
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(User, StaffProfile, Tenant)
        .outerjoin(StaffProfile, User.id == StaffProfile.user_id)
        .outerjoin(Tenant, User.tenant_id == Tenant.id)
    )
    if tenant_id:
        stmt = stmt.where(User.tenant_id == tenant_id)
    if user_type:
        stmt = stmt.where(User.user_type == user_type)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(like), User.phone.ilike(like), User.email.ilike(like)))
    rows = (await db.execute(stmt.order_by(User.created_at.desc()).limit(250))).all()
    return [_serialize_staff_row(u, sp, t) for u, sp, t in rows]


@router.post("/admin/users")
async def admin_create_user(
    body: AdminCreateUserBody,
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    if body.user_type != UserType.SUPER_ADMIN and not body.tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id is required for non-SUPER_ADMIN accounts")
    target_tenant = None
    if body.tenant_id:
        target_tenant = (await db.execute(select(Tenant).where(Tenant.id == body.tenant_id))).scalar_one_or_none()
        if not target_tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")

    clean_phone = body.phone.strip()
    clean_email = body.email.strip().lower() if body.email and body.email.strip() else None

    if body.tenant_id is None:
        if (
            await db.execute(select(User.id).where(User.tenant_id.is_(None), User.phone == clean_phone))
        ).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Platform phone already exists")
        if clean_email and (
            await db.execute(select(User.id).where(User.tenant_id.is_(None), User.email == clean_email))
        ).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Platform email already exists")
    else:
        if (
            await db.execute(select(User.id).where(User.tenant_id == body.tenant_id, User.phone == clean_phone))
        ).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Phone already exists in tenant")
        if clean_email and (
            await db.execute(select(User.id).where(User.tenant_id == body.tenant_id, User.email == clean_email))
        ).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Email already exists in tenant")

    user = User(
        tenant_id=body.tenant_id if body.user_type != UserType.SUPER_ADMIN else None,
        user_type=body.user_type,
        full_name=body.full_name.strip(),
        phone=clean_phone,
        email=clean_email,
        password_hash=hash_password(body.password),
        preferred_lang="en" if body.user_type == UserType.SUPER_ADMIN else "ar",
        is_2fa_enabled=body.is_2fa_enabled,
        is_active=body.is_active,
    )
    db.add(user)
    await db.flush()

    sp: Optional[StaffProfile] = None
    if body.user_type == UserType.INTERNAL_STAFF:
        role = body.staff_role or StaffRole.ADMIN
        sp = StaffProfile(
            user_id=user.id,
            role=role,
            custom_role_title=body.custom_role_title.strip() if body.custom_role_title else None,
            department=body.department.strip().upper(),
            permissions_json=_sanitize_permissions(body.permissions, role),
        )
        db.add(sp)

    if user.tenant_id:
        db.add(
            AuditLog(
                tenant_id=user.tenant_id,
                actor_id=auth.user.id,
                action="SUPER_ADMIN_USER_CREATED",
                new_value={"target_user_id": str(user.id), "user_type": user.user_type.value},
            )
        )
    await db.commit()
    await db.refresh(user)
    return _serialize_staff_row(user, sp, target_tenant)


@router.patch("/admin/users/{user_id}")
async def admin_update_user(
    user_id: uuid.UUID,
    body: AdminUpdateUserBody,
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(User, StaffProfile, Tenant)
            .outerjoin(StaffProfile, User.id == StaffProfile.user_id)
            .outerjoin(Tenant, User.tenant_id == Tenant.id)
            .where(User.id == user_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    user, sp, tenant = row

    if body.is_active is False and user.id == auth.user.id:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account")
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.phone is not None:
        user.phone = body.phone.strip()
    if body.email is not None:
        user.email = body.email.strip().lower() or None
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_2fa_enabled is not None:
        user.is_2fa_enabled = body.is_2fa_enabled
    if body.phone_verified is not None:
        user.phone_verified = body.phone_verified
    if sp:
        if body.staff_role is not None:
            sp.role = body.staff_role
        if body.custom_role_title is not None:
            sp.custom_role_title = body.custom_role_title.strip() or None
        if body.department is not None:
            sp.department = body.department.strip().upper()
        if body.max_discount_percent is not None:
            sp.max_discount_percent = body.max_discount_percent
        if body.permissions is not None:
            sp.permissions_json = _sanitize_permissions(body.permissions, sp.role)

    await db.commit()
    return _serialize_staff_row(user, sp, tenant)


@router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_user_password(
    user_id: uuid.UUID,
    body: ResetUserPasswordBody,
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"status": "PASSWORD_RESET", "user_id": str(user.id)}
