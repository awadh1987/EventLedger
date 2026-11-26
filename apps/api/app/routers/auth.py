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
    issue_otp_code,
    verify_otp_code,
    verify_password,
)
from app.models.users import ClientCategory, ClientProfile, StaffProfile, User, UserType

auth_router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & 2FA OTP"])


class LoginBody(BaseModel):
    identifier: str
    password: str


class OtpRequestBody(BaseModel):
    identifier: str
    password: Optional[str] = None


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


class ResetPasswordBody(BaseModel):
    identifier: str
    otp_code: str
    new_password: str = Field(..., min_length=8)


class OtpLoginBody(BaseModel):
    identifier: str
    otp_code: str


def _serialize_user(user: User, staff_role=None) -> dict:
    return {
        "id": str(user.id),
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "user_type": user.user_type.value,
        "staff_role": staff_role.value if staff_role else None,
        "preferred_lang": user.preferred_lang,
        "is_2fa_enabled": user.is_2fa_enabled,
    }


async def _find_user(db: AsyncSession, identifier: str, request: Request) -> Optional[User]:
    clean = identifier.strip()
    tenant = getattr(request.state, "tenant", None)
    query = select(User).where(
        or_(User.phone == clean, User.email == clean.lower()),
        User.is_active == True,  # noqa: E712
    )
    if tenant:
        query = query.where(or_(User.tenant_id == tenant.id, User.user_type == UserType.SUPER_ADMIN))
    return (await db.execute(query)).scalar_one_or_none()


@auth_router.post("/login")
async def password_login(body: LoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    user = await _find_user(db, body.identifier, request)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if user.is_2fa_enabled:
        otp_code, challenge_id = issue_otp_code(body.identifier)
        resp = {"status": "OTP_REQUIRED", "challenge_id": challenge_id, "expires_in_seconds": 300}
        if settings.DEBUG:
            resp["dev_otp"] = otp_code
        return resp

    staff_role = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            staff_role = sp.role

    tenant = getattr(request.state, "tenant", None)
    token = create_access_token(user.id, tenant.id if tenant else user.tenant_id, user.user_type, staff_role)
    return {
        "status": "OK",
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_user(user, staff_role),
    }


@auth_router.post("/otp-request")
async def request_otp(body: OtpRequestBody, request: Request, db: AsyncSession = Depends(get_db)):
    user = await _find_user(db, body.identifier, request)
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if body.password and not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    otp_code, challenge_id = issue_otp_code(body.identifier)
    resp = {"status": "OTP_SENT", "challenge_id": challenge_id, "expires_in_seconds": 300}
    if settings.DEBUG:
        resp["dev_otp"] = otp_code
    return resp


@auth_router.post("/otp-login")
async def otp_login(body: OtpLoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    if not verify_otp_code(body.identifier, body.otp_code):
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")

    user = await _find_user(db, body.identifier, request)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    staff_role = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            staff_role = sp.role

    tenant = getattr(request.state, "tenant", None)
    token = create_access_token(user.id, tenant.id if tenant else user.tenant_id, user.user_type, staff_role)
    return {
        "status": "OK",
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_user(user, staff_role),
    }


@auth_router.post("/register-client")
async def register_client(body: ClientRegisterBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    phone = body.phone.strip()
    email = body.email.strip().lower() if body.email else None
    if (await db.execute(select(User.id).where(User.phone == phone))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Phone number is already registered")
    if email and (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(
        tenant_id=tenant.id,
        user_type=UserType.CLIENT_PRIMARY,
        email=email,
        phone=phone,
        password_hash=hash_password(body.password),
        full_name=body.full_name.strip(),
        preferred_lang="ar",
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
    return {"status": "OK", "access_token": token, "token_type": "bearer", "user": _serialize_user(user)}


@auth_router.post("/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    if not verify_otp_code(body.identifier, body.otp_code):
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")
    user = await _find_user(db, body.identifier, request)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
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
async def get_me(auth: AuthContext = Depends(get_current_auth)):
    return _serialize_user(auth.user, auth.staff_role)
