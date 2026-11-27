import hashlib
import hmac
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.events import Event
from app.models.users import EventDelegate, StaffProfile, StaffRole, User, UserType

bearer_scheme = HTTPBearer(auto_error=False)
_OTP_STORE: dict[str, tuple[str, datetime, str]] = {}

RBAC_MODULES = [
    "dashboard",
    "bookings",
    "catalog",
    "invoicing",
    "finance",
    "operations",
    "security",
    "clients",
    "users_rbac",
    "branding",
    "governance",
]
RBAC_ACTIONS = ["view", "create", "edit", "delete", "approve", "export"]


def _full_matrix() -> dict[str, list[str]]:
    return {m: list(RBAC_ACTIONS) for m in RBAC_MODULES}


def default_permissions_for_role(role: Optional[StaffRole]) -> dict[str, list[str]]:
    if role in (StaffRole.OWNER, StaffRole.ADMIN):
        return _full_matrix()
    if role == StaffRole.FINANCE:
        return {
            "dashboard": ["view", "export"],
            "bookings": ["view"],
            "catalog": ["view"],
            "invoicing": ["view", "create", "edit", "approve", "export"],
            "finance": ["view", "create", "edit", "approve", "export"],
            "operations": ["view"],
            "security": ["view"],
            "clients": ["view", "create", "edit"],
            "users_rbac": [],
            "branding": [],
            "governance": ["view"],
        }
    if role == StaffRole.OPS_MANAGER:
        return {
            "dashboard": ["view"],
            "bookings": ["view", "create", "edit", "approve"],
            "catalog": ["view", "create", "edit", "delete"],
            "invoicing": ["view"],
            "finance": ["view"],
            "operations": ["view", "create", "edit", "approve", "export"],
            "security": ["view", "create", "edit", "approve", "export"],
            "clients": ["view", "edit"],
            "users_rbac": ["view"],
            "branding": ["view", "edit"],
            "governance": ["view"],
        }
    if role in (StaffRole.SALES, StaffRole.SALES_MANAGER, StaffRole.SALES_REP):
        actions = ["view", "create", "edit", "approve"] if role == StaffRole.SALES_MANAGER else ["view", "create", "edit"]
        return {
            "dashboard": ["view"],
            "bookings": actions,
            "catalog": ["view"],
            "invoicing": ["view", "export"],
            "finance": [],
            "operations": ["view"],
            "security": ["view"],
            "clients": ["view", "create", "edit"],
            "users_rbac": [],
            "branding": ["view"],
            "governance": ["view"],
        }
    if role == StaffRole.SECURITY:
        return {
            "dashboard": ["view"],
            "bookings": ["view"],
            "catalog": [],
            "invoicing": [],
            "finance": [],
            "operations": ["view"],
            "security": ["view", "create", "edit", "approve", "export"],
            "clients": [],
            "users_rbac": [],
            "branding": [],
            "governance": [],
        }
    if role == StaffRole.HEAD_CHEF:
        return {
            "dashboard": ["view"],
            "bookings": ["view"],
            "catalog": ["view", "edit"],
            "invoicing": [],
            "finance": [],
            "operations": ["view", "create", "edit", "export"],
            "security": [],
            "clients": [],
            "users_rbac": [],
            "branding": [],
            "governance": [],
        }
    return {
        "dashboard": ["view"],
        "bookings": ["view"],
        "catalog": ["view"],
        "invoicing": [],
        "finance": [],
        "operations": ["view"],
        "security": ["view"],
        "clients": ["view"],
        "users_rbac": [],
        "branding": [],
        "governance": [],
    }


def resolve_effective_permissions(role: Optional[StaffRole], custom_json: Optional[dict]) -> dict[str, list[str]]:
    if role == StaffRole.OWNER:
        return _full_matrix()
    if isinstance(custom_json, dict) and custom_json:
        raw_map = custom_json.get("modules") if isinstance(custom_json.get("modules"), dict) else custom_json
        if isinstance(raw_map, dict) and raw_map:
            normalized: dict[str, list[str]] = {}
            for m in RBAC_MODULES:
                acts = raw_map.get(m)
                if isinstance(acts, list):
                    normalized[m] = [str(a) for a in acts if a in RBAC_ACTIONS]
                else:
                    normalized[m] = []
            return normalized
    return default_permissions_for_role(role)


def hash_password(raw_password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", raw_password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${dk.hex()}"


def verify_password(raw_password: str, stored_hash: Optional[str]) -> bool:
    if not stored_hash:
        return False
    if stored_hash.startswith("pbkdf2_sha256$"):
        try:
            _, salt, expected_hex = stored_hash.split("$", 2)
        except ValueError:
            return False
        dk = hashlib.pbkdf2_hmac("sha256", raw_password.encode("utf-8"), salt.encode("utf-8"), 120_000)
        return secrets.compare_digest(dk.hex(), expected_hex)
    legacy_salt = os.getenv("PASSWORD_SALT", "eventledger_salt_v3")
    legacy_hex = hashlib.sha256(f"{legacy_salt}:{raw_password}".encode("utf-8")).hexdigest()
    return secrets.compare_digest(legacy_hex, stored_hash)


def issue_otp_code(identifier: str, tenant_scope: str = "global") -> tuple[str, str]:
    code = f"{secrets.randbelow(900000) + 100000}"
    challenge_id = str(uuid.uuid4())
    key = f"{tenant_scope}:{identifier.strip().lower()}"
    _OTP_STORE[key] = (
        code,
        datetime.now(timezone.utc) + timedelta(minutes=5),
        challenge_id,
    )
    return code, challenge_id


def verify_otp_code(identifier: str, code: str, tenant_scope: str = "global") -> bool:
    key = f"{tenant_scope}:{identifier.strip().lower()}"
    entry = _OTP_STORE.get(key)
    if not entry and tenant_scope != "global":
        legacy_key = f"global:{identifier.strip().lower()}"
        entry = _OTP_STORE.get(legacy_key)
        if entry:
            key = legacy_key
    if not entry:
        return False
    expected_code, expires_at, _ = entry
    if datetime.now(timezone.utc) > expires_at:
        _OTP_STORE.pop(key, None)
        return False
    if secrets.compare_digest(expected_code, code.strip()):
        _OTP_STORE.pop(key, None)
        return True
    return False


async def issue_otp_code_async(identifier: str, tenant_scope: str = "global") -> tuple[str, str]:
    code = f"{secrets.randbelow(900000) + 100000}"
    challenge_id = str(uuid.uuid4())
    clean_id = identifier.strip().lower()
    if settings.APP_ENV != "test":
        try:
            import redis.asyncio as aioredis

            r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=0.5, socket_timeout=0.5, decode_responses=True)
            redis_key = f"el:otp:{tenant_scope}:{clean_id}"
            await r.setex(redis_key, 300, json.dumps({"code": code, "challenge_id": challenge_id}))
            await r.aclose()
            return code, challenge_id
        except Exception:
            pass
    _OTP_STORE[f"{tenant_scope}:{clean_id}"] = (
        code,
        datetime.now(timezone.utc) + timedelta(minutes=5),
        challenge_id,
    )
    return code, challenge_id


async def verify_otp_code_async(identifier: str, code: str, tenant_scope: str = "global") -> bool:
    clean_id = identifier.strip().lower()
    clean_code = code.strip()
    if settings.APP_ENV != "test":
        try:
            import redis.asyncio as aioredis

            r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=0.5, socket_timeout=0.5, decode_responses=True)
            redis_key = f"el:otp:{tenant_scope}:{clean_id}"
            raw = await r.get(redis_key)
            if not raw and tenant_scope != "global":
                redis_key = f"el:otp:global:{clean_id}"
                raw = await r.get(redis_key)
            if raw:
                data = json.loads(raw)
                expected = str(data.get("code", ""))
                ok = bool(expected) and secrets.compare_digest(expected, clean_code)
                if ok:
                    await r.delete(redis_key)
                await r.aclose()
                return ok
            await r.aclose()
        except Exception:
            pass
    return verify_otp_code(clean_id, clean_code, tenant_scope=tenant_scope)


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
    def __init__(
        self,
        user: User,
        tenant_id: Optional[uuid.UUID],
        staff_role: Optional[StaffRole] = None,
        permissions: Optional[dict[str, list[str]]] = None,
        custom_role_title: Optional[str] = None,
    ):
        self.user = user
        self.tenant_id = tenant_id
        self.staff_role = staff_role
        self.permissions = permissions or {}
        self.custom_role_title = custom_role_title


async def get_current_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    try:
        claims = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id_str = claims.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token subject")

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token subject")

    user = (
        await db.execute(select(User).where(User.id == user_uuid, User.is_active == True))  # noqa: E712
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    resolved_tenant = getattr(request.state, "tenant", None)
    if user.user_type != UserType.SUPER_ADMIN:
        if resolved_tenant and user.tenant_id != resolved_tenant.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-tenant access denied")
        if not resolved_tenant:
            claim_tid = claims.get("tenant_id")
            if not claim_tid or str(user.tenant_id) != str(claim_tid):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant context required")

    staff_role: Optional[StaffRole] = None
    permissions: dict[str, list[str]] = {}
    custom_role_title: Optional[str] = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            staff_role = sp.role
            custom_role_title = sp.custom_role_title
            permissions = resolve_effective_permissions(sp.role, sp.permissions_json)
    elif user.user_type == UserType.SUPER_ADMIN:
        permissions = _full_matrix()

    effective_tenant_id = resolved_tenant.id if resolved_tenant else user.tenant_id
    return AuthContext(
        user=user,
        tenant_id=effective_tenant_id,
        staff_role=staff_role,
        permissions=permissions,
        custom_role_title=custom_role_title,
    )


async def get_optional_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[AuthContext]:
    if not credentials or not credentials.credentials:
        return None
    try:
        return await get_current_auth(request, credentials, db)
    except HTTPException:
        return None


def require_roles(
    allowed_user_types: set[UserType],
    allowed_staff_roles: Optional[set[StaffRole]] = None,
    required_perm: Optional[tuple[str, str]] = None,
) -> Callable:
    async def _guard(auth: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if auth.user.user_type == UserType.SUPER_ADMIN:
            return auth
        if auth.user.user_type not in allowed_user_types:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")
        if auth.user.user_type == UserType.INTERNAL_STAFF and allowed_staff_roles is not None:
            effective_allowed = set(allowed_staff_roles)
            if StaffRole.OWNER in effective_allowed:
                effective_allowed.add(StaffRole.ADMIN)
            if StaffRole.SALES_REP in effective_allowed or StaffRole.SALES_MANAGER in effective_allowed:
                effective_allowed.add(StaffRole.SALES)
            has_role = auth.staff_role in effective_allowed
            has_perm = bool(
                required_perm and required_perm[1] in (auth.permissions.get(required_perm[0]) or [])
            )
            if not has_role and not has_perm:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient staff role")
        return auth

    return _guard


def create_receipt_upload_token(tenant_id: uuid.UUID, milestone_id: uuid.UUID, jti: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=48)
    payload = {
        "sub": "receipt_upload",
        "tenant_id": str(tenant_id),
        "milestone_id": str(milestone_id),
        "jti": jti,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def verify_receipt_upload_token(token: str, tenant_id: uuid.UUID, milestone_id: uuid.UUID) -> str:
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired receipt upload token")
    if (
        claims.get("sub") != "receipt_upload"
        or claims.get("tenant_id") != str(tenant_id)
        or claims.get("milestone_id") != str(milestone_id)
        or not claims.get("jti")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Upload token scope mismatch")
    return str(claims["jti"])


def verify_whatsapp_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    secret = (settings.WHATSAPP_APP_SECRET or "").strip()
    if not secret:
        return False
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    provided = signature_header.split("=", 1)[1].strip()
    return secrets.compare_digest(expected, provided)


async def get_accessible_event_ids(db: AsyncSession, auth: AuthContext) -> set[uuid.UUID]:
    primary_ids = (
        await db.execute(
            select(Event.id).where(Event.tenant_id == auth.tenant_id, Event.primary_client_id == auth.user.id)
        )
    ).scalars().all()
    delegate_ids = (
        await db.execute(
            select(EventDelegate.event_id).where(
                EventDelegate.tenant_id == auth.tenant_id,
                EventDelegate.user_id == auth.user.id,
            )
        )
    ).scalars().all()
    return set(primary_ids) | set(delegate_ids)


async def verify_event_access(
    db: AsyncSession,
    auth: AuthContext,
    event_id: uuid.UUID,
    required_delegate_perm: Optional[str] = None,
    primary_client_or_staff_only: bool = False,
) -> Event:
    event = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if auth.user.user_type in (UserType.SUPER_ADMIN, UserType.INTERNAL_STAFF):
        return event

    if event.primary_client_id == auth.user.id:
        return event

    if primary_client_or_staff_only:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the primary client or staff may perform this action")

    delegate = (
        await db.execute(
            select(EventDelegate).where(
                EventDelegate.event_id == event_id,
                EventDelegate.tenant_id == auth.tenant_id,
                EventDelegate.user_id == auth.user.id,
            )
        )
    ).scalar_one_or_none()
    if not delegate:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this event")

    if required_delegate_perm and not (delegate.permissions or {}).get(required_delegate_perm, False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Delegate lacks required permission: {required_delegate_perm}",
        )
    return event
