from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import create_access_token, issue_otp_code, verify_otp_code, verify_password
from app.models.users import StaffProfile, User, UserType

auth_router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & 2FA OTP"])


class OtpRequestBody(BaseModel):
    identifier: str
    password: Optional[str] = None


class OtpLoginBody(BaseModel):
    identifier: str
    otp_code: str


@auth_router.post("/otp-request")
async def request_otp(body: OtpRequestBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    query = select(User).where(or_(User.phone == body.identifier.strip(), User.email == body.identifier.strip().lower()), User.is_active == True)
    if tenant:
        query = query.where(or_(User.tenant_id == tenant.id, User.user_type == UserType.SUPER_ADMIN))

    user = (await db.execute(query)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if body.password and not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    otp_code = issue_otp_code(body.identifier)
    return {"status": "OTP_SENT", "expires_in_seconds": 300, "dev_otp": otp_code}


@auth_router.post("/otp-login")
async def otp_login(body: OtpLoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    if not verify_otp_code(body.identifier, body.otp_code):
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")

    tenant = getattr(request.state, "tenant", None)
    query = select(User).where(or_(User.phone == body.identifier.strip(), User.email == body.identifier.strip().lower()), User.is_active == True)
    if tenant:
        query = query.where(or_(User.tenant_id == tenant.id, User.user_type == UserType.SUPER_ADMIN))

    user = (await db.execute(query)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    staff_role = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            staff_role = sp.role

    token = create_access_token(user.id, tenant.id if tenant else user.tenant_id, user.user_type, staff_role)
    return {"access_token": token, "token_type": "bearer", "user_type": user.user_type.value}
