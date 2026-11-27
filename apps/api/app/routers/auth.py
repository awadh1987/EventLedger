from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    AuthContext,
    create_access_token,
    get_current_auth,
    hash_password,
    issue_otp_code_async,
    resolve_effective_permissions,
    verify_otp_code_async,
    verify_password,
)
from app.core.tenant_middleware import resolve_active_tenant_by_slug
from app.models.base import utcnow
from app.models.tenant import Tenant
from app.models.users import ClientCategory, ClientProfile, StaffProfile, User, UserType

auth_router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & 2FA OTP"])


class LoginBody(BaseModel):
    identifier: str
    password: str
    tenant_slug: Optional[str] = None


class OtpRequestBody(BaseModel):
    identifier: str
    password: Optional[str] = None
    tenant_slug: Optional[str] = None


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class ClientRegisterBody(BaseModel):
    full_name: str = Field(..., min_length=2)
    phone: str = Field(..., min_length=7)
    email: Optional[str] = None
    password: str = Field(..., min_length=8)
    client_category: ClientCategory = ClientCategory.INDIVIDUAL_B2C
    company_name: Optional[str] = None
    tax_id: Optional[str] = None
    national_id_or_cr: Optional[str] = None
    tenant_slug: Optional[str] = None


class ResetPasswordBody(BaseModel):
    identifier: str
    otp_code: str
    new_password: str = Field(..., min_length=8)
    tenant_slug: Optional[str] = None


class OtpLoginBody(BaseModel):
    identifier: str
    otp_code: str
    tenant_slug: Optional[str] = None


def _serialize_user(
    user: User,
    staff_role=None,
    tenant_slug: Optional[str] = None,
    custom_role_title: Optional[str] = None,
    permissions: Optional[dict] = None,
) -> dict:
    return {
        "id": str(user.id),
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "tenant_slug": tenant_slug,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "user_type": user.user_type.value,
        "staff_role": staff_role.value if staff_role else None,
        "custom_role_title": custom_role_title,
        "permissions": permissions,
        "preferred_lang": user.preferred_lang,
        "is_2fa_enabled": user.is_2fa_enabled,
        "phone_verified": bool(user.phone_verified),
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


async def _get_user_tenant_slug(db: AsyncSession, user: User, request: Request) -> Optional[str]:
    req_tenant = getattr(request.state, "tenant", None)
    if req_tenant and user.tenant_id == req_tenant.id:
        return req_tenant.slug
    if user.tenant_id:
        return (await db.execute(select(Tenant.slug).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    return None


async def _resolve_target_tenant(db: AsyncSession, request: Request, body_slug: Optional[str]) -> Optional[Tenant]:
    req_tenant = getattr(request.state, "tenant", None)
    if req_tenant:
        return req_tenant
    if body_slug and body_slug.strip():
        return await resolve_active_tenant_by_slug(db, body_slug)
    return None


async def _list_user_workspaces(db: AsyncSession, identifier: str) -> list[dict]:
    clean = identifier.strip()
    rows = (
        await db.execute(
            select(User, Tenant)
            .join(Tenant, User.tenant_id == Tenant.id)
            .where(
                or_(User.phone == clean, User.email == clean.lower()),
                User.is_active == True,  # noqa: E712
                Tenant.is_active == True,  # noqa: E712
            )
            .order_by(User.last_login_at.desc().nullslast(), User.created_at.desc())
        )
    ).all()
    return [
        {
            "tenant_id": str(t.id),
            "tenant_slug": t.slug,
            "tenant_name": t.name,
            "user_type": u.user_type.value,
        }
        for u, t in rows
    ]


async def _find_user(
    db: AsyncSession,
    identifier: str,
    tenant: Optional[Tenant],
    password: Optional[str] = None,
    allow_cross_tenant_client_provision: bool = False,
) -> Optional[User]:
    clean = identifier.strip()
    ident_filter = or_(User.phone == clean, User.email == clean.lower())

    if tenant:
        local_user = (
            await db.execute(
                select(User).where(
                    User.tenant_id == tenant.id,
                    ident_filter,
                    User.is_active == True,  # noqa: E712
                )
            )
        ).scalars().first()
        if local_user:
            return local_user

        sa_user = (
            await db.execute(
                select(User).where(
                    User.tenant_id.is_(None),
                    User.user_type == UserType.SUPER_ADMIN,
                    ident_filter,
                    User.is_active == True,  # noqa: E712
                )
            )
        ).scalars().first()
        if sa_user:
            return sa_user

        if allow_cross_tenant_client_provision and password:
            candidates = (
                await db.execute(
                    select(User)
                    .where(
                        User.user_type.in_([UserType.CLIENT_PRIMARY, UserType.CLIENT_DELEGATE]),
                        ident_filter,
                        User.is_active == True,  # noqa: E712
                    )
                    .order_by(User.last_login_at.desc().nullslast(), User.created_at.desc())
                )
            ).scalars().all()
            for cand in candidates:
                if verify_password(password, cand.password_hash):
                    src_cp = (
                        await db.execute(select(ClientProfile).where(ClientProfile.user_id == cand.id))
                    ).scalar_one_or_none()
                    provisioned = User(
                        tenant_id=tenant.id,
                        user_type=UserType.CLIENT_PRIMARY,
                        email=cand.email,
                        phone=cand.phone,
                        password_hash=cand.password_hash,
                        full_name=cand.full_name,
                        preferred_lang=cand.preferred_lang,
                        is_2fa_enabled=cand.is_2fa_enabled,
                        phone_verified=cand.phone_verified,
                    )
                    db.add(provisioned)
                    await db.flush()
                    db.add(
                        ClientProfile(
                            user_id=provisioned.id,
                            client_category=src_cp.client_category if src_cp else ClientCategory.INDIVIDUAL_B2C,
                            national_id_or_cr=src_cp.national_id_or_cr if src_cp else None,
                            tax_id=src_cp.tax_id if src_cp else None,
                            company_name=src_cp.company_name if src_cp else None,
                            billing_address=src_cp.billing_address if src_cp else None,
                            refund_bank_details=src_cp.refund_bank_details if src_cp else None,
                        )
                    )
                    await db.flush()
                    return provisioned
        return None

    # Platform root login (no tenant resolved): check SUPER_ADMIN first, then any active user matching identifier
    sa_user = (
        await db.execute(
            select(User).where(
                User.tenant_id.is_(None),
                User.user_type == UserType.SUPER_ADMIN,
                ident_filter,
                User.is_active == True,  # noqa: E712
            )
        )
    ).scalars().first()
    if sa_user:
        return sa_user

    candidates = (
        await db.execute(
            select(User)
            .where(ident_filter, User.is_active == True)  # noqa: E712
            .order_by(User.last_login_at.desc().nullslast(), User.created_at.desc())
        )
    ).scalars().all()
    if not candidates:
        return None
    if password:
        for cand in candidates:
            if verify_password(password, cand.password_hash):
                return cand
    return candidates[0]


async def _staff_meta(db: AsyncSession, user: User) -> tuple[Optional[object], Optional[str], Optional[dict]]:
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            return sp.role, sp.custom_role_title, resolve_effective_permissions(sp.role, sp.permissions_json)
    return None, None, None


@auth_router.post("/login")
async def password_login(body: LoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = await _resolve_target_tenant(db, request, body.tenant_slug)
    user = await _find_user(
        db,
        body.identifier,
        tenant,
        password=body.password,
        allow_cross_tenant_client_provision=True,
    )
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    otp_scope = str(tenant.id) if tenant else "global"
    if user.is_2fa_enabled:
        otp_code, challenge_id = await issue_otp_code_async(body.identifier, tenant_scope=otp_scope)
        await db.commit()
        resp = {"status": "OTP_REQUIRED", "challenge_id": challenge_id, "expires_in_seconds": 300}
        if settings.DEBUG:
            resp["dev_otp"] = otp_code
        return resp

    user.last_login_at = utcnow()
    staff_role, custom_role_title, perms = await _staff_meta(db, user)
    await db.commit()

    effective_tid = tenant.id if tenant else user.tenant_id
    t_slug = tenant.slug if tenant else await _get_user_tenant_slug(db, user, request)
    token = create_access_token(user.id, effective_tid, user.user_type, staff_role)
    workspaces = await _list_user_workspaces(db, body.identifier)
    return {
        "status": "OK",
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_user(user, staff_role, t_slug, custom_role_title, perms),
        "workspaces": workspaces,
    }


@auth_router.post("/otp-request")
async def request_otp(body: OtpRequestBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = await _resolve_target_tenant(db, request, body.tenant_slug)
    user = await _find_user(db, body.identifier, tenant, password=body.password)
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if body.password and not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    otp_scope = str(tenant.id) if tenant else "global"
    otp_code, challenge_id = await issue_otp_code_async(body.identifier, tenant_scope=otp_scope)
    resp = {"status": "OTP_SENT", "challenge_id": challenge_id, "expires_in_seconds": 300}
    if settings.DEBUG:
        resp["dev_otp"] = otp_code
    return resp


@auth_router.post("/otp-login")
async def otp_login(body: OtpLoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = await _resolve_target_tenant(db, request, body.tenant_slug)
    otp_scope = str(tenant.id) if tenant else "global"
    if not await verify_otp_code_async(body.identifier, body.otp_code, tenant_scope=otp_scope):
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")

    user = await _find_user(db, body.identifier, tenant)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.phone_verified = True
    user.last_login_at = utcnow()
    staff_role, custom_role_title, perms = await _staff_meta(db, user)
    await db.commit()

    effective_tid = tenant.id if tenant else user.tenant_id
    t_slug = tenant.slug if tenant else await _get_user_tenant_slug(db, user, request)
    token = create_access_token(user.id, effective_tid, user.user_type, staff_role)
    workspaces = await _list_user_workspaces(db, body.identifier)
    return {
        "status": "OK",
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_user(user, staff_role, t_slug, custom_role_title, perms),
        "workspaces": workspaces,
    }


@auth_router.post("/register-client")
async def register_client(body: ClientRegisterBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = await _resolve_target_tenant(db, request, body.tenant_slug)
    if not tenant:
        tenant = await resolve_active_tenant_by_slug(db, "tenant")
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    phone = body.phone.strip()
    email = body.email.strip().lower() if body.email else None
    if (
        await db.execute(select(User.id).where(User.tenant_id == tenant.id, User.phone == phone))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Phone number is already registered in this workspace")
    if email and (
        await db.execute(select(User.id).where(User.tenant_id == tenant.id, User.email == email))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email is already registered in this workspace")

    user = User(
        tenant_id=tenant.id,
        user_type=UserType.CLIENT_PRIMARY,
        email=email,
        phone=phone,
        password_hash=hash_password(body.password),
        full_name=body.full_name.strip(),
        preferred_lang="ar",
        last_login_at=utcnow(),
    )
    db.add(user)
    await db.flush()
    db.add(
        ClientProfile(
            user_id=user.id,
            client_category=body.client_category,
            company_name=body.company_name.strip() if body.company_name else None,
            tax_id=body.tax_id.strip() if body.tax_id else None,
            national_id_or_cr=body.national_id_or_cr.strip() if body.national_id_or_cr else None,
        )
    )
    await db.commit()
    token = create_access_token(user.id, tenant.id, user.user_type, None)
    return {
        "status": "OK",
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_user(user, None, tenant.slug),
    }


@auth_router.post("/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = await _resolve_target_tenant(db, request, body.tenant_slug)
    otp_scope = str(tenant.id) if tenant else "global"
    if not await verify_otp_code_async(body.identifier, body.otp_code, tenant_scope=otp_scope):
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")
    user = await _find_user(db, body.identifier, tenant)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
    user.phone_verified = True
    await db.commit()
    return {"status": "PASSWORD_RESET"}


@auth_router.post("/change-password")
async def change_password(
    body: ChangePasswordBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    user = auth.user
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from current password")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"status": "PASSWORD_CHANGED"}


@auth_router.get("/me")
async def get_me(
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    t_slug = await _get_user_tenant_slug(db, auth.user, request)
    return _serialize_user(
        auth.user,
        auth.staff_role,
        t_slug,
        auth.custom_role_title,
        auth.permissions,
    )
