import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.models.users import StaffProfile, StaffRole, User, UserType

bearer_scheme = HTTPBearer(auto_error=False)
_OTP_STORE: dict[str, tuple[str, datetime]] = {}


def hash_password(raw_password: str) -> str:
    salt = os.getenv("PASSWORD_SALT", "eventledger_salt_v3")
    return hashlib.sha256(f"{salt}:{raw_password}".encode("utf-8")).hexdigest()


def verify_password(raw_password: str, stored_hash: Optional[str]) -> bool:
    if not stored_hash:
        return False
    return secrets.compare_digest(hash_password(raw_password), stored_hash)


def issue_otp_code(identifier: str) -> str:
    code = f"{secrets.randbelow(900000) + 100000}"
    _OTP_STORE[identifier.strip().lower()] = (code, datetime.now(timezone.utc) + timedelta(minutes=5))
    return code


def verify_otp_code(identifier: str, code: str) -> bool:
    key = identifier.strip().lower()
    entry = _OTP_STORE.get(key)
    if not entry:
        return False
    expected_code, expires_at = entry
    if datetime.now(timezone.utc) > expires_at:
        _OTP_STORE.pop(key, None)
        return False
    if secrets.compare_digest(expected_code, code.strip()):
        _OTP_STORE.pop(key, None)
        return True
    return False


def create_access_token(
    user_id: uuid.UUID,
    tenant_id: Optional[uuid.UUID],
    user_type: UserType,
    staff_role: Optional[StaffRole] = None,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id) if tenant_id else None,
        "user_type": user_type.value,
        "staff_role": staff_role.value if staff_role else None,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


class AuthContext:
    def __init__(self, user: User, tenant_id: Optional[uuid.UUID], staff_role: Optional[StaffRole] = None):
        self.user = user
        self.tenant_id = tenant_id
        self.staff_role = staff_role


async def get_current_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    try:
        claims = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id_str = claims.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token subject")

    user = (await db.execute(select(User).where(User.id == uuid.UUID(user_id_str), User.is_active == True))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    resolved_tenant = getattr(request.state, "tenant", None)
    if user.user_type != UserType.SUPER_ADMIN:
        if not resolved_tenant or user.tenant_id != resolved_tenant.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-tenant access denied")

    staff_role: Optional[StaffRole] = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            staff_role = sp.role

    return AuthContext(user=user, tenant_id=resolved_tenant.id if resolved_tenant else user.tenant_id, staff_role=staff_role)


def require_roles(allowed_user_types: set[UserType], allowed_staff_roles: Optional[set[StaffRole]] = None) -> Callable:
    async def _guard(auth: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if auth.user.user_type == UserType.SUPER_ADMIN:
            return auth
        if auth.user.user_type not in allowed_user_types:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")
        if auth.user.user_type == UserType.INTERNAL_STAFF and allowed_staff_roles is not None:
            if auth.staff_role not in allowed_staff_roles:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient staff role")
        return auth

    return _guard
