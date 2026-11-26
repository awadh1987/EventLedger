#!/usr/bin/env python3
"""
EventLedger (إيفنت ليدجر) — Complete 8-Phase Monorepo Generator
Writes all backend (Python 3.12 + FastAPI + SQLAlchemy 2.0 + Alembic + Celery),
frontend (Next.js 14 RTL/LTR + Tailwind + Konva), desktop (Tauri v2), and mobile (Capacitor 6) files.
"""

from pathlib import Path

ROOT = Path.cwd()

FILES: dict[str, str] = {
    # =========================================================================
    # ROOT MONOREPO & ENV CONFIG
    # =========================================================================
    "pnpm-workspace.yaml": """packages:
  - 'apps/*'
""",
    "package.json": """{
  "name": "eventledger-saas",
  "private": true,
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "build:web": "pnpm --filter web build",
    "build:exe": "pnpm --filter desktop tauri build",
    "build:apk": "BUILD_TARGET=NATIVE pnpm --filter web build && pnpm --filter mobile cap sync android"
  }
}
""",
    ".env.example": """BRAND_NAME_EN="EventLedger"
BRAND_NAME_AR="إيفنت ليدجر"
NEXT_PUBLIC_ROOT_DOMAIN="eventledger.local:3000"
ROOT_DOMAIN="eventledger.local:3000"
NEXT_PUBLIC_API_URL="http://localhost:8000/api/v1"
DATABASE_URL="postgresql+asyncpg://venue_admin:venue_secret_password@localhost:5432/venue_erp_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="change-this-to-a-64-char-random-secret"
JWT_ALGORITHM="HS256"
JWT_EXPIRE_MINUTES=10080
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minio_admin"
S3_SECRET_KEY="minio_secret_password"
S3_BUCKET="eventledger-assets"
WHATSAPP_API_URL="https://graph.facebook.com/v20.0"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="eventledger_wa_verify_token"
""",
    # =========================================================================
    # PHASE 1: PYTHON FASTAPI BACKEND, ALEMBIC, MODELS & SEED
    # =========================================================================
    "apps/api/pyproject.toml": """[project]
name = "eventledger-api"
version = "3.0.0"
description = "EventLedger (إيفنت ليدجر) Multi-Tenant Venue & Conference ERP API"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "sqlalchemy[asyncio]>=2.0.35",
    "asyncpg>=0.30.0",
    "alembic>=1.14.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.6.0",
    "python-jose[cryptography]>=3.3.0",
    "passlib[bcrypt]>=1.7.4",
    "python-multipart>=0.0.17",
    "celery>=5.4.0",
    "redis>=5.2.0",
    "weasyprint>=63.0",
    "boto3>=1.35.0",
    "httpx>=0.27.0"
]
""",
    "apps/api/alembic.ini": """[alembic]
script_location = alembic
prepend_sys_path = .
version_path_separator = os
sqlalchemy.url = postgresql+asyncpg://venue_admin:venue_secret_password@localhost:5432/venue_erp_db

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =

[logger_alembic]
level = INFO
handlers =

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
""",
    "apps/api/alembic/env.py": """import asyncio
from logging.config import fileConfig
from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config
from app.core.config import settings
from app.models.tenant import Base
import app.models.users  # noqa: F401
import app.models.venue  # noqa: F401
import app.models.events  # noqa: F401
import app.models.accounting  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    url = settings.DATABASE_URL
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url.split("?")[0]


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = get_url()
    connectable = async_engine_from_config(cfg, prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
""",
    "apps/api/alembic/script.py.mako": """\"\"\"${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
\"\"\"
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
""",
    "apps/api/app/__init__.py": "",
    "apps/api/app/core/__init__.py": "",
    "apps/api/app/core/config.py": """from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    BRAND_NAME_EN: str = "EventLedger"
    BRAND_NAME_AR: str = "إيفنت ليدجر"
    ROOT_DOMAIN: str = "eventledger.local:3000"
    DATABASE_URL: str = "postgresql+asyncpg://venue_admin:venue_secret_password@localhost:5432/venue_erp_db"
    REDIS_URL: str = "redis://localhost:6379"
    JWT_SECRET: str = "change-this-to-a-64-char-random-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 10080
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minio_admin"
    S3_SECRET_KEY: str = "minio_secret_password"
    S3_BUCKET: str = "eventledger-assets"
    WHATSAPP_API_URL: str = "https://graph.facebook.com/v20.0"
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str = "eventledger_wa_verify_token"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
""",
    "apps/api/app/core/database.py": """from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.config import settings

db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
if "?schema=" in db_url:
    db_url = db_url.split("?schema=")[0]

engine = create_async_engine(db_url, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
""",
    "apps/api/app/core/tenant_middleware.py": """from fastapi import Request
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant

ROOT_DOMAIN = settings.ROOT_DOMAIN.split(":")[0].lower()


class TenantResolverMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0].lower()
        slug_header = (request.headers.get("x-tenant-slug") or "").strip().lower()
        custom_domain_header = (request.headers.get("x-tenant-custom-domain") or "").strip().lower()

        request.state.tenant = None
        request.state.tenant_mode = "PLATFORM_ROOT"

        if host == f"admin.{ROOT_DOMAIN}":
            request.state.tenant_mode = "PLATFORM_SUPER_ADMIN"
            return await call_next(request)

        async with AsyncSessionLocal() as db:
            tenant = None
            if slug_header:
                res = await db.execute(select(Tenant).where(Tenant.slug == slug_header, Tenant.is_active == True))
                tenant = res.scalar_one_or_none()
            elif custom_domain_header:
                res = await db.execute(select(Tenant).where(Tenant.custom_domain == custom_domain_header, Tenant.is_active == True))
                tenant = res.scalar_one_or_none()
            elif host and host not in (ROOT_DOMAIN, f"www.{ROOT_DOMAIN}", "localhost", "127.0.0.1"):
                if host.endswith(f".{ROOT_DOMAIN}"):
                    slug = host.replace(f".{ROOT_DOMAIN}", "")
                    res = await db.execute(select(Tenant).where(Tenant.slug == slug, Tenant.is_active == True))
                else:
                    res = await db.execute(select(Tenant).where(Tenant.custom_domain == host, Tenant.is_active == True))
                tenant = res.scalar_one_or_none()

            if tenant:
                request.state.tenant = tenant
                request.state.tenant_mode = "TENANT_WORKSPACE"

        return await call_next(request)
""",
    "apps/api/app/core/security.py": """import hashlib
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
""",
    "apps/api/app/models/__init__.py": "",
    "apps/api/app/models/tenant.py": """import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Numeric, Text, Enum, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SubscriptionTier(str, enum.Enum):
    BASIC = "BASIC"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


class RecordLifecycle(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    DELETED = "DELETED"


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    custom_domain: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    subscription_tier: Mapped[SubscriptionTier] = mapped_column(Enum(SubscriptionTier), default=SubscriptionTier.PRO)
    currency: Mapped[str] = mapped_column(String(10), default="YER")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    whatsapp_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    branding: Mapped[Optional["TenantBranding"]] = relationship(back_populates="tenant", uselist=False)


class TenantBranding(Base):
    __tablename__ = "tenant_brandings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True)
    logo_light_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logo_dark_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    favicon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_color: Mapped[str] = mapped_column(String(20), default="#D4AF37")
    accent_color: Mapped[str] = mapped_column(String(20), default="#0F172A")
    default_theme: Mapped[str] = mapped_column(String(20), default="SYSTEM")
    enable_spotlight: Mapped[bool] = mapped_column(Boolean, default=True)
    spotlight_color: Mapped[str] = mapped_column(String(50), default="rgba(212, 175, 55, 0.18)")
    invoice_footer_ar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invoice_footer_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="branding")


class SystemLookup(Base):
    __tablename__ = "system_lookups"
    __table_args__ = (UniqueConstraint("tenant_id", "category", "code", name="uq_tenant_category_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(60))
    code: Mapped[str] = mapped_column(String(60))
    label_ar: Mapped[str] = mapped_column(String(255))
    label_en: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
""",
    "apps/api/app/models/users.py": """import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Numeric, Text, Enum, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.tenant import Base


class UserType(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    INTERNAL_STAFF = "INTERNAL_STAFF"
    CLIENT_PRIMARY = "CLIENT_PRIMARY"
    CLIENT_DELEGATE = "CLIENT_DELEGATE"
    EXTERNAL_VENDOR = "EXTERNAL_VENDOR"


class StaffRole(str, enum.Enum):
    OWNER = "OWNER"
    SALES_MANAGER = "SALES_MANAGER"
    SALES_REP = "SALES_REP"
    FINANCE = "FINANCE"
    OPS_MANAGER = "OPS_MANAGER"
    HEAD_CHEF = "HEAD_CHEF"
    SECURITY = "SECURITY"


class ClientCategory(str, enum.Enum):
    INDIVIDUAL_B2C = "INDIVIDUAL_B2C"
    CORPORATE_B2B = "CORPORATE_B2B"


class DelegateRole(str, enum.Enum):
    CO_HOST = "CO_HOST"
    WEDDING_PLANNER = "WEDDING_PLANNER"
    VENDOR = "VENDOR"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    user_type: Mapped[UserType] = mapped_column(Enum(UserType))
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    phone: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    full_name: Mapped[str] = mapped_column(String(255))
    preferred_lang: Mapped[str] = mapped_column(String(10), default="ar")
    is_2fa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    staff_profile: Mapped[Optional["StaffProfile"]] = relationship(back_populates="user", uselist=False)
    client_profile: Mapped[Optional["ClientProfile"]] = relationship(back_populates="user", uselist=False)


class StaffProfile(Base):
    __tablename__ = "staff_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[StaffRole] = mapped_column(Enum(StaffRole))
    department: Mapped[str] = mapped_column(String(80))
    max_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))

    user: Mapped["User"] = relationship(back_populates="staff_profile")


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    client_category: Mapped[ClientCategory] = mapped_column(Enum(ClientCategory), default=ClientCategory.INDIVIDUAL_B2C)
    national_id_or_cr: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tax_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refund_bank_details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    vip_tier: Mapped[str] = mapped_column(String(30), default="STANDARD")

    user: Mapped["User"] = relationship(back_populates="client_profile")


class EventDelegate(Base):
    __tablename__ = "event_delegates"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_delegate"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delegate_role: Mapped[DelegateRole] = mapped_column(Enum(DelegateRole))
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)
""",
    "apps/api/app/models/venue.py": """import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Numeric, Enum, JSON, ARRAY
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.tenant import Base, RecordLifecycle


class Hall(Base):
    __tablename__ = "halls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    name_ar: Mapped[str] = mapped_column(String(255))
    capacity_banquet: Mapped[int] = mapped_column(Integer)
    capacity_theater: Mapped[int] = mapped_column(Integer)
    base_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    cleaning_buffer_minutes: Mapped[int] = mapped_column(Integer, default=120)
    combinable_with_hall_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


class PricingRule(Base):
    __tablename__ = "pricing_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    hall_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("halls.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    days_of_week: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    multiplier: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=Decimal("1.00"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(80))
    total_stock: Mapped[int] = mapped_column(Integer, default=0)
    unit_addon_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


class EventInventoryAllocation(Base):
    __tablename__ = "event_inventory_allocations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_items.id"))
    quantity_reserved: Mapped[int] = mapped_column(Integer)


class CateringMenuItem(Base):
    __tablename__ = "catering_menu_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name_ar: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255))
    price_per_guest: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    cost_per_guest: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    recipe_bom: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
""",
    "apps/api/app/models/events.py": """import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Numeric, Text, Enum, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.tenant import Base


class EventStatus(str, enum.Enum):
    INQUIRY = "INQUIRY"
    HOLD_48H = "HOLD_48H"
    CONTRACT_PENDING = "CONTRACT_PENDING"
    CONFIRMED = "CONFIRMED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class DraftType(str, enum.Enum):
    PACKAGE_QUOTE = "PACKAGE_QUOTE"
    FLOOR_PLAN = "FLOOR_PLAN"
    CATERING_MENU = "CATERING_MENU"
    TIMELINE_BEO = "TIMELINE_BEO"
    ADDON_REQUEST = "ADDON_REQUEST"


class DraftStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PENDING_CLIENT_APPROVAL = "PENDING_CLIENT_APPROVAL"
    PENDING_INTERNAL_APPROVAL = "PENDING_INTERNAL_APPROVAL"
    APPROVED_SYNCED = "APPROVED_SYNCED"
    REJECTED = "REJECTED"


class ApprovalStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    hall_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("halls.id"))
    primary_client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    assigned_sales_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_code: Mapped[str] = mapped_column(String(50), unique=True)
    event_type: Mapped[str] = mapped_column(String(50))
    start_time: Mapped[datetime] = mapped_column(DateTime)
    end_time: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[EventStatus] = mapped_column(Enum(EventStatus), default=EventStatus.INQUIRY)
    guest_count: Mapped[int] = mapped_column(Integer)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EventDraft(Base):
    __tablename__ = "event_drafts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    version_number: Mapped[int] = mapped_column(Integer)
    draft_type: Mapped[DraftType] = mapped_column(Enum(DraftType))
    payload: Mapped[dict] = mapped_column(JSON)
    financial_delta: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[DraftStatus] = mapped_column(Enum(DraftStatus), default=DraftStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    draft_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("event_drafts.id", ondelete="CASCADE"))
    requested_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    required_approver_role: Mapped[str] = mapped_column(String(50))
    approved_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[ApprovalStatus] = mapped_column(Enum(ApprovalStatus), default=ApprovalStatus.PENDING)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EventMessage(Base):
    __tablename__ = "event_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    channel: Mapped[str] = mapped_column(String(30), default="IN_APP")
    department: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    attachments: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GatePass(Base):
    __tablename__ = "gate_passes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    pass_type: Mapped[str] = mapped_column(String(40))
    holder_name: Mapped[str] = mapped_column(String(255))
    holder_id_number: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    qr_token: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    valid_from: Mapped[datetime] = mapped_column(DateTime)
    valid_until: Mapped[datetime] = mapped_column(DateTime)
    is_checked_in: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(120))
    old_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
""",
    "apps/api/app/models/accounting.py": """import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Numeric, Text, Enum, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.tenant import Base, RecordLifecycle


class AccountType(str, enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    REVENUE = "REVENUE"
    EXPENSE = "EXPENSE"


class DepositStatus(str, enum.Enum):
    UNPAID = "UNPAID"
    HELD = "HELD"
    INSPECTION_PASSED = "INSPECTION_PASSED"
    REFUNDED = "REFUNDED"
    DEDUCTED = "DEDUCTED"


class InvoiceStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    OVERDUE = "OVERDUE"
    VOIDED = "VOIDED"


class ChartOfAccount(Base):
    __tablename__ = "chart_of_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_tenant_account_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(30))
    name_ar: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255))
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType))
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


class AccountingConfig(Base):
    __tablename__ = "accounting_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True)
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, default=1)
    auto_post_on_payment_verify: Mapped[bool] = mapped_column(Boolean, default=True)
    cash_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    bank_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    accounts_receivable_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    hall_revenue_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    catering_revenue_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    security_deposit_liab_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    tax_payable_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    catering_cogs_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (UniqueConstraint("tenant_id", "entry_number", name="uq_tenant_entry_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    entry_number: Mapped[str] = mapped_column(String(50))
    entry_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="POSTED")
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lines: Mapped[list["JournalLine"]] = relationship(back_populates="journal_entry", cascade="all, delete-orphan")


class JournalLine(Base):
    __tablename__ = "journal_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    journal_entry_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chart_of_accounts.id"))
    debit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    credit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    journal_entry: Mapped["JournalEntry"] = relationship(back_populates="lines")


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    invoice_number: Mapped[str] = mapped_column(String(60), unique=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    security_deposit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    deposit_status: Mapped[DepositStatus] = mapped_column(Enum(DepositStatus), default=DepositStatus.UNPAID)
    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PaymentMilestone(Base):
    __tablename__ = "payment_milestones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    amount_due: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    due_date: Mapped[datetime] = mapped_column(DateTime)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    payment_method: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    receipt_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EventExpense(Base):
    __tablename__ = "event_expenses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
""",
    # =========================================================================
    # SERVICES & WORKERS
    # =========================================================================
    "apps/api/app/services/__init__.py": "",
    "apps/api/app/services/availability_service.py": """import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.events import Event, EventStatus
from app.models.tenant import Tenant
from app.models.venue import Hall, PricingRule


class AvailabilityService:
    BLOCKING_STATUSES = [EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]

    @staticmethod
    async def check_hall_availability(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> dict:
        hall = (await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))).scalar_one_or_none()
        if not hall:
            return {"available": False, "reason": "HALL_NOT_FOUND", "conflicts": []}

        target_hall_ids = [hall.id]
        if hall.combinable_with_hall_id:
            target_hall_ids.append(hall.combinable_with_hall_id)

        linked = (await db.execute(select(Hall.id).where(Hall.tenant_id == tenant_id, Hall.combinable_with_hall_id == hall.id))).all()
        for (linked_id,) in linked:
            if linked_id not in target_hall_ids:
                target_hall_ids.append(linked_id)

        buffer_delta = timedelta(minutes=hall.cleaning_buffer_minutes)
        expanded_start = start_time - buffer_delta
        expanded_end = end_time + buffer_delta

        candidates = (
            await db.execute(
                select(Event).where(
                    Event.tenant_id == tenant_id,
                    Event.hall_id.in_(target_hall_ids),
                    Event.status.in_(AvailabilityService.BLOCKING_STATUSES),
                )
            )
        ).scalars().all()

        conflicts = []
        for ev in candidates:
            ev_hall = (await db.execute(select(Hall).where(Hall.id == ev.hall_id))).scalar_one_or_none()
            ev_buf = timedelta(minutes=ev_hall.cleaning_buffer_minutes if ev_hall else 0)
            ev_start = ev.start_time - ev_buf
            ev_end = ev.end_time + ev_buf
            if expanded_start < ev_end and expanded_end > ev_start:
                conflicts.append({"event_id": str(ev.id), "event_code": ev.event_code, "status": ev.status.value})

        return {"available": len(conflicts) == 0, "checked_hall_ids": [str(h) for h in target_hall_ids], "conflicts": conflicts}

    @staticmethod
    async def calculate_dynamic_quote(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        addon_amount: Decimal = Decimal("0.00"),
        discount_amount: Decimal = Decimal("0.00"),
    ) -> dict:
        hall = (await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))).scalar_one()
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        rules = (
            await db.execute(
                select(PricingRule).where(
                    PricingRule.tenant_id == tenant_id,
                    PricingRule.is_active == True,
                    or_(PricingRule.hall_id == hall_id, PricingRule.hall_id.is_(None)),
                )
            )
        ).scalars().all()

        sun_dow = (start_time.weekday() + 1) % 7
        multiplier = Decimal("1.00")
        for r in rules:
            if (not r.days_of_week or sun_dow in r.days_of_week):
                if (not r.start_date or start_time >= r.start_date) and (not r.end_date or start_time <= r.end_date):
                    multiplier *= Decimal(str(r.multiplier))

        adjusted = (Decimal(str(hall.base_price)) * multiplier).quantize(Decimal("0.01"))
        subtotal = max(Decimal("0.00"), adjusted + addon_amount - discount_amount)
        tax_amount = (subtotal * (Decimal(str(tenant.tax_rate)) / Decimal("100.00"))).quantize(Decimal("0.01"))
        total_amount = subtotal + tax_amount
        deposit_amount = Decimal(str((tenant.settings or {}).get("defaultSecurityDeposit", 0)))

        return {
            "subtotal": float(subtotal),
            "tax_amount": float(tax_amount),
            "total_amount": float(total_amount),
            "security_deposit_amount": float(deposit_amount),
            "effective_multiplier": float(multiplier),
            "currency": tenant.currency,
        }
""",
    "apps/api/app/services/approvals_service.py": """import uuid
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import ApprovalRequest, ApprovalStatus, AuditLog, DraftStatus, DraftType, Event, EventDraft
from app.models.tenant import Tenant
from app.models.venue import EventInventoryAllocation, InventoryItem


class ApprovalsService:
    @staticmethod
    async def submit_draft_for_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        draft_id: uuid.UUID,
        requester_id: uuid.UUID,
        requester_type: str,
    ) -> ApprovalRequest:
        draft = (await db.execute(select(EventDraft).where(EventDraft.id == draft_id))).scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")

        event = (await db.execute(select(Event).where(Event.id == draft.event_id, Event.tenant_id == tenant_id))).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        settings_map = tenant.settings or {}
        lock_hours = settings_map.get("cateringLockHours", 72) if draft.draft_type == DraftType.CATERING_MENU else settings_map.get("floorPlanLockHours", 24)
        hours_until = (event.start_time.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 3600.0

        if (event.is_locked or hours_until < lock_hours) and requester_type != "INTERNAL_STAFF":
            raise HTTPException(status_code=403, detail=f"Draft is locked ({lock_hours}h pre-event freeze).")

        if draft.financial_delta > Decimal("0.00") and requester_id != event.primary_client_id:
            draft.status = DraftStatus.PENDING_CLIENT_APPROVAL
            required_role = "CLIENT_PRIMARY"
        else:
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            required_role = "OPS_MANAGER"

        approval = ApprovalRequest(
            event_id=event.id,
            draft_id=draft.id,
            requested_by_id=requester_id,
            required_approver_role=required_role,
            status=ApprovalStatus.PENDING,
        )
        db.add(approval)
        await db.commit()
        await db.refresh(approval)
        return approval

    @staticmethod
    async def resolve_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        approval_id: uuid.UUID,
        approver_id: uuid.UUID,
        decision: ApprovalStatus,
        rejection_reason: str | None = None,
    ) -> dict:
        approval = (await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id))).scalar_one_or_none()
        if not approval or approval.status != ApprovalStatus.PENDING:
            raise HTTPException(status_code=400, detail="Approval request not found or resolved")

        draft = (await db.execute(select(EventDraft).where(EventDraft.id == approval.draft_id))).scalar_one()
        event = (await db.execute(select(Event).where(Event.id == approval.event_id, Event.tenant_id == tenant_id))).scalar_one()
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()

        approval.status = decision
        approval.approved_by_id = approver_id
        approval.rejection_reason = rejection_reason
        approval.resolved_at = datetime.utcnow()

        if decision == ApprovalStatus.REJECTED:
            draft.status = DraftStatus.REJECTED
            await db.commit()
            return {"status": "REJECTED", "draft_id": str(draft.id)}

        if approval.required_approver_role == "CLIENT_PRIMARY":
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            next_gate = ApprovalRequest(
                event_id=event.id,
                draft_id=draft.id,
                requested_by_id=approver_id,
                required_approver_role="OPS_MANAGER",
                status=ApprovalStatus.PENDING,
            )
            db.add(next_gate)
            await db.commit()
            return {"status": "FORWARDED_TO_OPS", "next_approval_id": str(next_gate.id)}

        draft.status = DraftStatus.APPROVED_SYNCED
        payload = draft.payload or {}

        if draft.financial_delta != Decimal("0.00"):
            invoice = (await db.execute(select(Invoice).where(Invoice.event_id == event.id, Invoice.tenant_id == tenant_id))).scalar_one_or_none()
            if invoice:
                invoice.subtotal = Decimal(str(invoice.subtotal)) + draft.financial_delta
                invoice.tax_amount = (Decimal(str(invoice.subtotal)) * (Decimal(str(tenant.tax_rate)) / Decimal("100.00"))).quantize(Decimal("0.01"))
                invoice.total_amount = Decimal(str(invoice.subtotal)) + Decimal(str(invoice.tax_amount)) - Decimal(str(invoice.discount_amount))
                pending = (await db.execute(select(PaymentMilestone).where(PaymentMilestone.invoice_id == invoice.id, PaymentMilestone.status == "PENDING"))).scalars().all()
                if pending:
                    pending[-1].amount_due = Decimal(str(pending[-1].amount_due)) + draft.financial_delta

        if payload.get("itemId") and payload.get("quantityReserved") is not None:
            item_uuid = uuid.UUID(str(payload["itemId"]))
            item = (await db.execute(select(InventoryItem).where(InventoryItem.id == item_uuid, InventoryItem.tenant_id == tenant_id))).scalar_one_or_none()
            if item:
                alloc = (await db.execute(select(EventInventoryAllocation).where(EventInventoryAllocation.event_id == event.id, EventInventoryAllocation.item_id == item.id))).scalar_one_or_none()
                qty = int(payload["quantityReserved"])
                if alloc:
                    alloc.quantity_reserved = qty
                else:
                    db.add(EventInventoryAllocation(event_id=event.id, item_id=item.id, quantity_reserved=qty))

        if "totalSeatedGuests" in payload:
            event.guest_count = int(payload["totalSeatedGuests"])

        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=event.id,
                actor_id=approver_id,
                action="DRAFT_APPROVED_AND_SYNCED",
                new_value={"draft_id": str(draft.id), "financial_delta": float(draft.financial_delta)},
            )
        )
        await db.commit()
        return {"status": "APPROVED_SYNCED", "event_id": str(event.id), "draft_id": str(draft.id)}
""",
    "apps/api/app/services/accounting_service.py": """import uuid
from datetime import datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import AccountingConfig, EventExpense, Invoice, JournalEntry, JournalLine
from app.models.events import Event


class DoubleEntryService:
    @staticmethod
    async def post_balanced_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        reference: str,
        description: str,
        lines: list[dict],
        event_id: uuid.UUID | None = None,
    ) -> JournalEntry:
        total_debit = sum((Decimal(str(l.get("debit", 0))) for l in lines), Decimal("0.00"))
        total_credit = sum((Decimal(str(l.get("credit", 0))) for l in lines), Decimal("0.00"))
        if abs(total_debit - total_credit) >= Decimal("0.01") or total_debit <= Decimal("0.00"):
            raise HTTPException(status_code=400, detail=f"Unbalanced journal entry: debit={total_debit}, credit={total_credit}")

        entry = JournalEntry(
            tenant_id=tenant_id,
            event_id=event_id,
            entry_number=f"JE-{datetime.utcnow().year}-{str(uuid.uuid4().int % 1000000).zfill(6)}",
            reference=reference,
            description=description,
            status="POSTED",
            created_by_id=created_by_id,
        )
        db.add(entry)
        await db.flush()
        for l in lines:
            db.add(
                JournalLine(
                    journal_entry_id=entry.id,
                    account_id=l["account_id"],
                    debit=Decimal(str(l.get("debit", 0))),
                    credit=Decimal(str(l.get("credit", 0))),
                    memo=l.get("memo"),
                )
            )
        await db.commit()
        await db.refresh(entry)
        return entry

    @staticmethod
    async def record_verified_payment(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        event_id: uuid.UUID,
        amount: Decimal,
        is_security_deposit: bool,
        payment_method: str,
        reference: str,
    ) -> JournalEntry:
        cfg = (await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))).scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        debit_acc = cfg.cash_account_id if payment_method == "CASH" else cfg.bank_account_id
        credit_acc = cfg.security_deposit_liab_id if is_security_deposit else cfg.accounts_receivable_id
        return await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=reference,
            description=f"Verified payment ({payment_method})",
            event_id=event_id,
            lines=[
                {"account_id": debit_acc, "debit": amount, "credit": Decimal("0.00"), "memo": reference},
                {"account_id": credit_acc, "debit": Decimal("0.00"), "credit": amount, "memo": reference},
            ],
        )

    @staticmethod
    async def get_event_pnl(db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID) -> dict:
        event = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        invoices = (await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == tenant_id))).scalars().all()
        gross = sum((Decimal(str(i.subtotal)) for i in invoices), Decimal("0.00"))
        discounts = sum((Decimal(str(i.discount_amount)) for i in invoices), Decimal("0.00"))
        net_rev = gross - discounts

        expenses = (await db.execute(select(EventExpense).where(EventExpense.event_id == event_id, EventExpense.tenant_id == tenant_id))).scalars().all()
        total_exp = sum((Decimal(str(e.amount)) for e in expenses), Decimal("0.00"))
        profit = net_rev - total_exp

        return {
            "event_id": str(event.id),
            "event_code": event.event_code,
            "net_revenue": float(net_rev),
            "total_expenses": float(total_exp),
            "net_profit": float(profit),
            "margin_percent": float((profit / net_rev * 100).quantize(Decimal("0.01"))) if net_rev > 0 else 0.0,
        }
""",
    "apps/api/app/services/comms_service.py": """import uuid
from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.events import Event, EventMessage, EventStatus
from app.models.users import User


class CommsService:
    @staticmethod
    async def post_message(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        event_id: uuid.UUID,
        sender_id: uuid.UUID,
        content: str,
        channel: str = "IN_APP",
        department: str | None = "ALL",
        is_internal: bool = False,
        external_id: str | None = None,
    ) -> EventMessage:
        event = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        msg = EventMessage(
            event_id=event_id,
            sender_id=sender_id,
            channel=channel,
            department=department,
            content=content,
            is_internal=is_internal,
            external_id=external_id,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg

    @staticmethod
    async def ingest_whatsapp_webhook(db: AsyncSession, payload: dict) -> dict:
        entry = (payload.get("entry") or [{}])[0]
        change = (entry.get("changes") or [{}])[0]
        messages = (change.get("value") or {}).get("messages") or []
        if not messages:
            return {"status": "ignored"}

        wa_msg = messages[0]
        raw_phone = str(wa_msg.get("from", "")).strip()
        variants = [raw_phone, f"+{raw_phone}"] if not raw_phone.startswith("+") else [raw_phone, raw_phone[1:]]
        text_body = (wa_msg.get("text") or {}).get("body") or "[WhatsApp Media]"

        user = (await db.execute(select(User).where(User.phone.in_(variants), User.is_active == True))).scalar_one_or_none()
        if not user or not user.tenant_id:
            return {"status": "unknown_sender"}

        ev = (
            await db.execute(
                select(Event)
                .where(
                    Event.tenant_id == user.tenant_id,
                    or_(Event.primary_client_id == user.id, Event.assigned_sales_id == user.id),
                    Event.status.in_([EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]),
                )
                .order_by(Event.start_time.asc())
            )
        ).scalar_one_or_none()
        if not ev:
            return {"status": "no_active_event"}

        created = await CommsService.post_message(
            db=db,
            tenant_id=user.tenant_id,
            event_id=ev.id,
            sender_id=user.id,
            content=text_body,
            channel="WHATSAPP",
            external_id=wa_msg.get("id"),
        )
        return {"status": "SYNCED", "message_id": str(created.id)}
""",
    "apps/api/app/workers/__init__.py": "",
    "apps/api/app/workers/celery_tasks.py": """import asyncio
import uuid
from celery import Celery
from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import Event, EventStatus

celery_app = Celery("eventledger_worker", broker=settings.REDIS_URL, backend=settings.REDIS_URL)


async def _expire_hold_async(event_id_str: str) -> str:
    event_id = uuid.UUID(event_id_str)
    async with AsyncSessionLocal() as db:
        ev = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
        if not ev or ev.status != EventStatus.HOLD_48H:
            return "SKIPPED"

        inv = (await db.execute(select(Invoice).where(Invoice.event_id == ev.id))).scalar_one_or_none()
        if inv:
            milestones = (await db.execute(select(PaymentMilestone).where(PaymentMilestone.invoice_id == inv.id))).scalars().all()
            if any(m.status in {"PAID", "UNDER_REVIEW", "VERIFIED"} or float(m.paid_amount) > 0 for m in milestones):
                return "PAID_OR_UNDER_REVIEW"

        ev.status = EventStatus.CANCELLED
        await db.commit()
        return "EXPIRED_AND_CANCELLED"


@celery_app.task(name="eventledger.expire_unpaid_48h_hold")
def expire_unpaid_48h_hold(event_id: str) -> str:
    return asyncio.run(_expire_hold_async(event_id))
""",
    # =========================================================================
    # ROUTERS & MAIN APP
    # =========================================================================
    "apps/api/app/routers/__init__.py": "",
    "apps/api/app/routers/public_onboarding.py": """import re
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import hash_password
from app.models.accounting import AccountingConfig, AccountType, ChartOfAccount
from app.models.tenant import SubscriptionTier, Tenant, TenantBranding
from app.models.users import StaffProfile, StaffRole, User, UserType

router = APIRouter(prefix="/api/v1/public", tags=["Public & SaaS Onboarding"])


class TenantRegisterRequest(BaseModel):
    venue_name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=3, max_length=50)
    owner_name: str = Field(..., min_length=2, max_length=150)
    owner_phone: str = Field(..., min_length=7, max_length=30)
    owner_email: str | None = None
    owner_password: str | None = Field(default="VenueOwner@2026", min_length=6)
    currency: str = Field(default="YER")
    subscription_tier: SubscriptionTier = Field(default=SubscriptionTier.PRO)


@router.post("/tenants/register")
async def register_tenant(payload: TenantRegisterRequest, db: AsyncSession = Depends(get_db)):
    clean_slug = re.sub(r"[^a-z0-9-]", "", payload.slug.lower().strip())
    if len(clean_slug) < 3 or clean_slug in {"www", "admin", "api", "app", "mail", "static"}:
        raise HTTPException(status_code=400, detail="Invalid or reserved subdomain slug")

    if (await db.execute(select(Tenant).where(Tenant.slug == clean_slug))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Subdomain slug is already taken")

    tenant = Tenant(
        name=payload.venue_name,
        slug=clean_slug,
        currency=payload.currency,
        subscription_tier=payload.subscription_tier,
        settings={"cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48},
    )
    db.add(tenant)
    await db.flush()
    db.add(TenantBranding(tenant_id=tenant.id))

    default_accounts = [
        ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True),
        ("1020", "البنك والمحافظ الإلكترونية", "Bank & E-Wallets", AccountType.ASSET, True),
        ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True),
        ("2100", "تأمينات الأضرار المستردة", "Refundable Security Deposits", AccountType.LIABILITY, True),
        ("2200", "ضريبة القيمة المضافة المستحقة", "Tax Payable", AccountType.LIABILITY, True),
        ("4000", "إيرادات تأجير القاعات", "Hall Rental Revenue", AccountType.REVENUE, True),
        ("4100", "إيرادات الضيافة والبوفيه", "Catering Revenue", AccountType.REVENUE, True),
        ("5000", "تكلفة المواد الغذائية والضيافة", "Catering COGS", AccountType.EXPENSE, True),
    ]
    acc_ids = {}
    for code, ar, en, atype, is_sys in default_accounts:
        acc = ChartOfAccount(tenant_id=tenant.id, code=code, name_ar=ar, name_en=en, account_type=atype, is_system=is_sys)
        db.add(acc)
        await db.flush()
        acc_ids[code] = acc.id

    db.add(
        AccountingConfig(
            tenant_id=tenant.id,
            cash_account_id=acc_ids["1010"],
            bank_account_id=acc_ids["1020"],
            accounts_receivable_id=acc_ids["1100"],
            security_deposit_liab_id=acc_ids["2100"],
            tax_payable_account_id=acc_ids["2200"],
            hall_revenue_account_id=acc_ids["4000"],
            catering_revenue_account_id=acc_ids["4100"],
            catering_cogs_account_id=acc_ids["5000"],
        )
    )

    owner = User(
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        email=payload.owner_email,
        phone=payload.owner_phone,
        password_hash=hash_password(payload.owner_password or "VenueOwner@2026"),
        full_name=payload.owner_name,
        preferred_lang="ar",
    )
    db.add(owner)
    await db.flush()
    db.add(StaffProfile(user_id=owner.id, role=StaffRole.OWNER, department="MANAGEMENT", max_discount_percent=Decimal("100.00")))
    await db.commit()

    return {"tenant_id": str(tenant.id), "slug": tenant.slug, "workspace_url": f"https://{tenant.slug}.eventledger.cloud", "owner_id": str(owner.id)}
""",
    "apps/api/app/routers/auth.py": """from typing import Optional
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
""",
    "apps/api/app/routers/portal.py": """import uuid
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
""",
    "apps/api/app/routers/bookings.py": """import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import Event, EventStatus
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Availability, Quotes & 48h Holds"])


class HoldBookingRequest(BaseModel):
    hall_id: uuid.UUID
    primary_client_id: uuid.UUID
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = 200
    addon_amount: Decimal = Decimal("0.00")


@router.get("/public/halls/availability")
async def get_halls_availability(
    request: Request,
    hall_id: uuid.UUID = Query(...),
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    avail = await AvailabilityService.check_hall_availability(db, tenant.id, hall_id, start_time, end_time)
    quote = await AvailabilityService.calculate_dynamic_quote(db, tenant.id, hall_id, start_time)
    return {"availability": avail, "quote": quote}


@router.post("/bookings/hold")
async def create_48h_hold(body: HoldBookingRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, body.hall_id, body.start_time, body.end_time)
    if not avail["available"]:
        raise HTTPException(status_code=409, detail=avail)

    quote = await AvailabilityService.calculate_dynamic_quote(db, tenant.id, body.hall_id, body.start_time, addon_amount=body.addon_amount)
    event_code = f"EVT-{datetime.now(timezone.utc).year}-{str(uuid.uuid4().int % 10000).zfill(4)}"
    event = Event(
        tenant_id=tenant.id,
        hall_id=body.hall_id,
        primary_client_id=body.primary_client_id,
        event_code=event_code,
        event_type=body.event_type,
        start_time=body.start_time.replace(tzinfo=None) if body.start_time.tzinfo else body.start_time,
        end_time=body.end_time.replace(tzinfo=None) if body.end_time.tzinfo else body.end_time,
        status=EventStatus.HOLD_48H,
        guest_count=body.guest_count,
    )
    db.add(event)
    await db.flush()

    invoice = Invoice(
        tenant_id=tenant.id,
        event_id=event.id,
        invoice_number=f"INV-{event_code}",
        subtotal=Decimal(str(quote["subtotal"])),
        tax_amount=Decimal(str(quote["tax_amount"])),
        total_amount=Decimal(str(quote["total_amount"])),
        security_deposit_amount=Decimal(str(quote["security_deposit_amount"])),
        status=InvoiceStatus.ISSUED,
    )
    db.add(invoice)
    await db.flush()
    db.add(
        PaymentMilestone(
            invoice_id=invoice.id,
            title="48h Hold Confirmation Deposit (50%)",
            amount_due=(Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01")),
            due_date=datetime.utcnow() + timedelta(hours=48),
            status="PENDING",
        )
    )
    await db.commit()
    return {"event_id": str(event.id), "event_code": event.event_code, "status": "HOLD_48H", "quote": quote}
""",
    "apps/api/app/routers/approvals.py": """import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.events import ApprovalStatus, DraftType, Event, EventDraft
from app.services.approvals_service import ApprovalsService

router = APIRouter(prefix="/api/v1", tags=["Drafts & Cross-ERP Approvals"])


class CreateDraftBody(BaseModel):
    draft_type: DraftType
    payload: dict
    financial_delta: Decimal = Decimal("0.00")
    created_by_id: uuid.UUID


class ResolveApprovalBody(BaseModel):
    approver_id: uuid.UUID
    decision: ApprovalStatus
    rejection_reason: str | None = None


@router.post("/events/{event_id}/drafts")
async def create_event_draft(event_id: uuid.UUID, body: CreateDraftBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant.id))).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    max_v = (await db.execute(select(func.max(EventDraft.version_number)).where(EventDraft.event_id == event_id))).scalar() or 0
    draft = EventDraft(
        event_id=event_id,
        created_by_id=body.created_by_id,
        version_number=max_v + 1,
        draft_type=body.draft_type,
        payload=body.payload,
        financial_delta=body.financial_delta,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return {"draft_id": str(draft.id), "version_number": draft.version_number, "status": draft.status.value}


@router.post("/drafts/{draft_id}/submit")
async def submit_draft(
    draft_id: uuid.UUID,
    request: Request,
    requester_id: uuid.UUID = Query(...),
    requester_type: str = Query(default="CLIENT_PRIMARY"),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    approval = await ApprovalsService.submit_draft_for_approval(db, tenant.id, draft_id, requester_id, requester_type)
    return {"approval_id": str(approval.id), "required_approver_role": approval.required_approver_role}


@router.post("/approvals/{approval_id}/resolve")
async def resolve_approval(approval_id: uuid.UUID, body: ResolveApprovalBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await ApprovalsService.resolve_approval(db, tenant.id, approval_id, body.approver_id, body.decision, body.rejection_reason)
""",
    "apps/api/app/routers/finance.py": """import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import ChartOfAccount, JournalEntry
from app.services.accounting_service import DoubleEntryService

router = APIRouter(prefix="/api/v1/finance", tags=["Double-Entry Accounting & Finance"])


class JournalLineInput(BaseModel):
    account_id: uuid.UUID
    debit: Decimal = Decimal("0.00")
    credit: Decimal = Decimal("0.00")
    memo: str | None = None


class PostJournalRequest(BaseModel):
    created_by_id: uuid.UUID
    reference: str
    description: str
    event_id: uuid.UUID | None = None
    lines: list[JournalLineInput]


@router.get("/accounts")
async def list_chart_of_accounts(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (await db.execute(select(ChartOfAccount).where(ChartOfAccount.tenant_id == tenant.id).order_by(ChartOfAccount.code.asc()))).scalars().all()
    return [{"id": str(r.id), "code": r.code, "name_ar": r.name_ar, "name_en": r.name_en, "account_type": r.account_type.value} for r in rows]


@router.post("/journal-entries")
async def post_journal_entry(body: PostJournalRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    entry = await DoubleEntryService.post_balanced_entry(
        db=db,
        tenant_id=tenant.id,
        created_by_id=body.created_by_id,
        reference=body.reference,
        description=body.description,
        event_id=body.event_id,
        lines=[l.model_dump() for l in body.lines],
    )
    return {"id": str(entry.id), "entry_number": entry.entry_number, "status": entry.status}
""",
    "apps/api/app/routers/phase6_ops.py": """import csv
import io
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import AccountType, ChartOfAccount, Invoice
from app.models.events import Event, EventDraft, EventMessage
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService
from app.services.comms_service import CommsService

router = APIRouter(prefix="/api/v1", tags=["P&L, CSV, PDF, Comms & BEO"])


class PostEventMessageBody(BaseModel):
    sender_id: uuid.UUID
    content: str
    channel: str = "IN_APP"
    department: str | None = "ALL"
    is_internal: bool = False


@router.get("/finance/events/{event_id}/pnl")
async def get_event_pnl(event_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_event_pnl(db, tenant.id, event_id)


@router.post("/import/{entity_type}")
async def bulk_import_csv(entity_type: str, request: Request, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    raw = await file.read()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    imported = 0
    for row in reader:
        if entity_type == "accounts":
            code = (row.get("code") or "").strip()
            if not code:
                continue
            acc_type_str = (row.get("account_type") or "ASSET").strip().upper()
            acc_type = AccountType(acc_type_str) if acc_type_str in AccountType._value2member_map_ else AccountType.ASSET
            db.add(ChartOfAccount(tenant_id=tenant.id, code=code, name_ar=(row.get("name_ar") or code).strip(), name_en=(row.get("name_en") or code).strip(), account_type=acc_type))
            imported += 1
    await db.commit()
    return {"entity_type": entity_type, "imported_rows": imported}


@router.get("/exports/invoices/{invoice_id}/pdf")
async def export_invoice_pdf(invoice_id: uuid.UUID, request: Request, locale: str = Query(default="ar", pattern="^(ar|en)$"), db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    inv = (await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant.id))).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    is_rtl = locale == "ar"
    html = f"<html dir='{'rtl' if is_rtl else 'ltr'}'><body><h2>{tenant.name} — #{inv.invoice_number}</h2><p>{inv.total_amount} {tenant.currency}</p></body></html>"
    try:
        import weasyprint
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
    except Exception:
        pdf_bytes = html.encode("utf-8")

    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{inv.invoice_number}-{locale}.pdf"'})


@router.get("/events/{event_id}/messages")
async def list_event_messages(event_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    msgs = (await db.execute(select(EventMessage).where(EventMessage.event_id == event_id).order_by(EventMessage.created_at.asc()))).scalars().all()
    return [{"id": str(m.id), "channel": m.channel, "department": m.department, "content": m.content, "is_internal": m.is_internal} for m in msgs]


@router.post("/events/{event_id}/messages")
async def create_event_message(event_id: uuid.UUID, body: PostEventMessageBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    msg = await CommsService.post_message(db, tenant.id, event_id, body.sender_id, body.content, body.channel, body.department, body.is_internal)
    return {"id": str(msg.id), "status": "SENT"}


@router.post("/webhooks/whatsapp")
async def whatsapp_webhook(payload: dict, db: AsyncSession = Depends(get_db)):
    return await CommsService.ingest_whatsapp_webhook(db, payload)


@router.get("/ops/beo")
async def get_live_beo(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    events = (await db.execute(select(Event).where(Event.tenant_id == tenant.id).order_by(Event.start_time.asc()))).scalars().all()
    halls = {h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()}
    orders = []
    for ev in events:
        drafts = (await db.execute(select(EventDraft).where(EventDraft.event_id == ev.id).order_by(EventDraft.version_number.desc()))).scalars().all()
        hall = halls.get(ev.hall_id)
        orders.append({
            "event_id": str(ev.id),
            "event_code": ev.event_code,
            "event_type": ev.event_type,
            "hall_name_ar": hall.name_ar if hall else "",
            "hall_name_en": hall.name if hall else "",
            "start_time": ev.start_time.isoformat(),
            "guest_count": ev.guest_count,
            "latest_draft_payload": drafts[0].payload if drafts else {},
        })
    return {"orders": orders}
""",
    "apps/api/app/routers/offline_sync.py": """from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.events import Event, GatePass

router = APIRouter(prefix="/api/v1/sync", tags=["Offline Desktop & Mobile Sync"])


class OfflineMutationItem(BaseModel):
    mutation_id: str
    action_type: str
    payload: dict
    recorded_at: datetime


class BatchSyncRequest(BaseModel):
    device_id: str
    mutations: list[OfflineMutationItem]


@router.get("/manifest")
async def get_offline_manifest(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant header (X-Tenant-Slug) required")
    window_start = datetime.utcnow() - timedelta(hours=6)
    window_end = datetime.utcnow() + timedelta(hours=24)
    events = (await db.execute(select(Event).where(Event.tenant_id == tenant.id, Event.start_time >= window_start, Event.start_time <= window_end))).scalars().all()
    event_ids = [e.id for e in events]
    passes = (await db.execute(select(GatePass).where(GatePass.event_id.in_(event_ids)))).scalars().all() if event_ids else []
    return {
        "tenant_slug": tenant.slug,
        "synced_at": datetime.utcnow().isoformat(),
        "events": [{"id": str(e.id), "event_code": e.event_code, "start_time": e.start_time.isoformat(), "guest_count": e.guest_count} for e in events],
        "gate_passes": [{"id": str(p.id), "qr_token": p.qr_token, "holder_name": p.holder_name, "is_checked_in": p.is_checked_in} for p in passes],
    }


@router.post("/batch")
async def process_offline_batch(body: BatchSyncRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant header required")
    processed_ids: list[str] = []
    for item in body.mutations:
        if item.action_type == "GATE_QR_CHECKIN":
            token = str((item.payload or {}).get("qr_token", "")).strip()
            if token:
                gp = (await db.execute(select(GatePass).where(GatePass.qr_token == token))).scalar_one_or_none()
                if gp and not gp.is_checked_in:
                    gp.is_checked_in = True
                    gp.checked_in_at = item.recorded_at.replace(tzinfo=None) if item.recorded_at.tzinfo else item.recorded_at
        processed_ids.append(item.mutation_id)
    await db.commit()
    return {"status": "SYNCED", "device_id": body.device_id, "processed_count": len(processed_ids), "processed_ids": processed_ids}
""",
    "apps/api/app/main.py": """from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.tenant_middleware import TenantResolverMiddleware
from app.routers import approvals, auth, bookings, finance, offline_sync, phase6_ops, portal, public_onboarding

app = FastAPI(
    title="EventLedger (إيفنت ليدجر) API",
    version="3.0.0",
    description="Multi-Tenant Venue, Wedding Hall & Conference ERP + Client Portal API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantResolverMiddleware)

app.include_router(public_onboarding.router)
app.include_router(auth.auth_router)
app.include_router(portal.portal_router)
app.include_router(bookings.router)
app.include_router(approvals.router)
app.include_router(finance.router)
app.include_router(phase6_ops.router)
app.include_router(offline_sync.router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "EventLedger Python FastAPI"}
""",
    "apps/api/seed.py": """import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.accounting import AccountingConfig, AccountType, ChartOfAccount, DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import ApprovalRequest, ApprovalStatus, AuditLog, DraftStatus, DraftType, Event, EventDraft, EventStatus, GatePass
from app.models.tenant import RecordLifecycle, SubscriptionTier, SystemLookup, Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, DelegateRole, EventDelegate, StaffProfile, StaffRole, User, UserType
from app.models.venue import CateringMenuItem, Hall, InventoryItem, PricingRule


async def seed_all():
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(Tenant).where(Tenant.slug == "almassa"))).scalar_one_or_none():
            print("Tenant 'almassa' already seeded.")
            return

        db.add(User(tenant_id=None, user_type=UserType.SUPER_ADMIN, email="superadmin@eventledger.cloud", phone="+967770000000", password_hash=hash_password("SuperAdmin@2026"), full_name="EventLedger Platform Admin", preferred_lang="en", is_2fa_enabled=True))

        tenant = Tenant(
            name="قصر الماسة للمؤتمرات والأفراح | Al-Massa Grand Palace",
            slug="almassa",
            custom_domain="events.almassa.ye",
            subscription_tier=SubscriptionTier.ENTERPRISE,
            currency="YER",
            tax_rate=Decimal("5.00"),
            settings={"cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48, "defaultSecurityDeposit": 150000},
        )
        db.add(tenant)
        await db.flush()

        db.add(TenantBranding(tenant_id=tenant.id, primary_color="#D4AF37", accent_color="#0F172A", default_theme="DARK", enable_spotlight=True, spotlight_color="rgba(212, 175, 55, 0.18)"))

        accounts_spec = [
            ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True),
            ("1020", "البنك والمحافظ الإلكترونية", "Bank & E-Wallets", AccountType.ASSET, True),
            ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True),
            ("2100", "تأمينات الأضرار المستردة", "Refundable Security Deposits", AccountType.LIABILITY, True),
            ("2200", "ضريبة القيمة المضافة المستحقة", "Tax Payable", AccountType.LIABILITY, True),
            ("4000", "إيرادات تأجير القاعات", "Hall Rental Revenue", AccountType.REVENUE, True),
            ("4100", "إيرادات الضيافة والبوفيه", "Catering Revenue", AccountType.REVENUE, True),
            ("5000", "تكلفة المواد الغذائية والضيافة", "Catering COGS", AccountType.EXPENSE, True),
        ]
        acc_map = {}
        for code, ar, en, atype, is_sys in accounts_spec:
            acc = ChartOfAccount(tenant_id=tenant.id, code=code, name_ar=ar, name_en=en, account_type=atype, is_system=is_sys)
            db.add(acc)
            await db.flush()
            acc_map[code] = acc.id

        db.add(AccountingConfig(tenant_id=tenant.id, cash_account_id=acc_map["1010"], bank_account_id=acc_map["1020"], accounts_receivable_id=acc_map["1100"], security_deposit_liab_id=acc_map["2100"], tax_payable_account_id=acc_map["2200"], hall_revenue_account_id=acc_map["4000"], catering_revenue_account_id=acc_map["4100"], catering_cogs_account_id=acc_map["5000"]))

        hall_a = Hall(tenant_id=tenant.id, name="Grand Diamond Hall", name_ar="قاعة الماسة الكبرى", capacity_banquet=500, capacity_theater=800, base_price=Decimal("1500000.00"), cleaning_buffer_minutes=120)
        hall_b = Hall(tenant_id=tenant.id, name="Royal Jasmine Hall", name_ar="قاعة الياسمين الملكية", capacity_banquet=300, capacity_theater=450, base_price=Decimal("950000.00"), cleaning_buffer_minutes=90)
        db.add_all([hall_a, hall_b])
        await db.flush()
        hall_a.combinable_with_hall_id = hall_b.id
        hall_b.combinable_with_hall_id = hall_a.id

        db.add(PricingRule(tenant_id=tenant.id, hall_id=hall_a.id, name="Weekend Peak (+20%)", days_of_week=[4, 5], multiplier=Decimal("1.20"), is_active=True))
        db.add(InventoryItem(tenant_id=tenant.id, name="Royal Gold Chiavari Chairs", category="FURNITURE", total_stock=800, unit_addon_price=Decimal("1500.00")))
        db.add(CateringMenuItem(tenant_id=tenant.id, name_ar="بوفيه الماسة الملكي", name_en="Al-Massa Royal Banquet Buffet", price_per_guest=Decimal("6500.00"), cost_per_guest=Decimal("3800.00")))

        owner = User(tenant_id=tenant.id, user_type=UserType.INTERNAL_STAFF, email="owner@almassa.eventledger.local", phone="+967770000001", password_hash=hash_password("Almassa@2026"), full_name="أ. طارق المنصور", preferred_lang="ar")
        client = User(tenant_id=tenant.id, user_type=UserType.CLIENT_PRIMARY, email="ahmed@client.local", phone="+967771112233", password_hash=hash_password("Client@2026"), full_name="أحمد عبدالله الشامي", preferred_lang="ar")
        planner = User(tenant_id=tenant.id, user_type=UserType.CLIENT_DELEGATE, email="layla.planner@studio.local", phone="+967773334455", password_hash=hash_password("Planner@2026"), full_name="ليلى الأهدل", preferred_lang="ar")
        db.add_all([owner, client, planner])
        await db.flush()

        db.add(StaffProfile(user_id=owner.id, role=StaffRole.OWNER, department="MANAGEMENT", max_discount_percent=Decimal("100.00")))
        db.add(ClientProfile(user_id=client.id, client_category=ClientCategory.INDIVIDUAL_B2C, national_id_or_cr="010100998877", refund_bank_details={"method": "Kuraimi / Jaib", "accountNumber": "301234567"}))

        start = datetime.utcnow() + timedelta(days=20)
        ev = Event(tenant_id=tenant.id, hall_id=hall_a.id, primary_client_id=client.id, assigned_sales_id=owner.id, event_code="EVT-2026-1001", event_type="WEDDING", start_time=start, end_time=start + timedelta(hours=6), status=EventStatus.CONFIRMED, guest_count=420)
        db.add(ev)
        await db.flush()

        db.add(EventDelegate(event_id=ev.id, user_id=planner.id, delegate_role=DelegateRole.WEDDING_PLANNER, permissions={"canViewFinance": False, "canEditFloorplan": True, "canRequestAddons": True}))
        draft = EventDraft(event_id=ev.id, created_by_id=planner.id, version_number=2, draft_type=DraftType.ADDON_REQUEST, payload={"addonItem": "Royal Gold Chiavari Chairs", "extraQty": 30}, financial_delta=Decimal("45000.00"), status=DraftStatus.PENDING_CLIENT_APPROVAL)
        db.add(draft)
        await db.flush()
        db.add(ApprovalRequest(event_id=ev.id, draft_id=draft.id, requested_by_id=planner.id, required_approver_role="CLIENT_PRIMARY", status=ApprovalStatus.PENDING))

        inv = Invoice(tenant_id=tenant.id, event_id=ev.id, invoice_number="INV-2026-1001", subtotal=Decimal("1500000.00"), tax_amount=Decimal("75000.00"), total_amount=Decimal("1575000.00"), security_deposit_amount=Decimal("150000.00"), deposit_status=DepositStatus.HELD, status=InvoiceStatus.PARTIALLY_PAID)
        db.add(inv)
        await db.flush()
        db.add(PaymentMilestone(invoice_id=inv.id, title="الدفعة الأولى (50%)", amount_due=Decimal("787500.00"), due_date=datetime.utcnow(), paid_amount=Decimal("787500.00"), payment_method="KURAIMI_BANK", status="PAID", paid_at=datetime.utcnow()))
        db.add(GatePass(event_id=ev.id, pass_type="VIP_PASS", holder_name="الشيخ عبدالله يحيى الشامي", qr_token="QR-EVT-2026-1001-VIP01", valid_from=start, valid_until=start + timedelta(hours=6)))
        db.add(AuditLog(tenant_id=tenant.id, event_id=ev.id, actor_id=owner.id, action="SEED_INITIALIZED_EVENT", new_value={"event_code": "EVT-2026-1001"}))
        await db.commit()
        print("✅ Seed completed for tenant: almassa")


if __name__ == "__main__":
    asyncio.run(seed_all())
""",
    # =========================================================================
    # NEXT.JS 14 FRONTEND (apps/web)
    # =========================================================================
    "apps/web/package.json": """{
  "name": "web",
  "version": "3.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "next": "14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "next-intl": "^3.22.0",
    "next-themes": "^0.4.3",
    "konva": "^9.3.16",
    "react-konva": "^18.2.10",
    "lucide-react": "^0.454.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3"
  }
}
""",
    "apps/web/next.config.mjs": """/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.BUILD_TARGET === 'NATIVE';

const nextConfig = {
  ...(isNativeBuild
    ? { output: 'export', images: { unoptimized: true } }
    : { images: { unoptimized: true } }),
};

export default nextConfig;
""",
    "apps/web/tsconfig.json": """{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
""",
    "apps/web/tailwind.config.ts": """import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
""",
    "apps/web/postcss.config.mjs": """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
""",
    "apps/web/src/app/globals.css": """@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --brand-primary: #D4AF37;
  --brand-accent: #0F172A;
  --brand-glow: rgba(212, 175, 55, 0.18);
}
""",
    "apps/web/src/middleware.ts": """import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const intlMiddleware = createMiddleware({ locales: ['ar', 'en'], defaultLocale: 'ar' });
const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000').split(':')[0].toLowerCase();

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const hostname = req.headers.get('host') || '';
  const cleanHost = hostname.split(':')[0].toLowerCase();

  if (url.pathname.startsWith('/_next') || url.pathname.startsWith('/api') || url.pathname.includes('.')) {
    return NextResponse.next();
  }

  const res = intlMiddleware(req);
  if (cleanHost === ROOT_DOMAIN || cleanHost === `www.${ROOT_DOMAIN}` || cleanHost === 'localhost') {
    res.headers.set('x-tenant-mode', 'PLATFORM_ROOT');
    return res;
  }
  if (cleanHost === `admin.${ROOT_DOMAIN}`) {
    res.headers.set('x-tenant-mode', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  let tenantIdentifier = cleanHost;
  let identifierType: 'SLUG' | 'CUSTOM_DOMAIN' = 'CUSTOM_DOMAIN';
  if (cleanHost.endsWith(`.${ROOT_DOMAIN}`)) {
    tenantIdentifier = cleanHost.replace(`.${ROOT_DOMAIN}`, '');
    identifierType = 'SLUG';
  }
  res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
  res.headers.set('x-tenant-identifier', tenantIdentifier);
  res.headers.set('x-tenant-identifier-type', identifierType);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
""",
    "apps/web/src/components/providers/theme-branding-provider.tsx": """'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export interface TenantBrandingConfig {
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  enableSpotlight: boolean;
  spotlightColor: string;
}

const DEFAULT_BRANDING: TenantBrandingConfig = {
  primaryColor: '#D4AF37',
  accentColor: '#0F172A',
  defaultTheme: 'DARK',
  enableSpotlight: true,
  spotlightColor: 'rgba(212, 175, 55, 0.18)',
};

const BrandingContext = createContext<TenantBrandingConfig>(DEFAULT_BRANDING);
export function useTenantBranding() {
  return useContext(BrandingContext);
}

export function ThemeBrandingProvider({ children, branding }: { children: React.ReactNode; branding?: Partial<TenantBrandingConfig> }) {
  const merged = useMemo(() => ({ ...DEFAULT_BRANDING, ...branding }), [branding]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', merged.primaryColor);
    root.style.setProperty('--brand-accent', merged.accentColor);
    root.style.setProperty('--brand-glow', merged.spotlightColor);
    if (merged.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = merged.faviconUrl;
    }
  }, [merged]);

  return (
    <BrandingContext.Provider value={merged}>
      <NextThemesProvider attribute="class" defaultTheme={merged.defaultTheme.toLowerCase()} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
""",
    "apps/web/src/components/ui/spotlight-elements.tsx": """'use client';

import React, { useRef, useState } from 'react';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';

export function SpotlightCard({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const branding = useTenantBranding();
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const update = (cx: number, cy: number) => {
    if (!ref.current || !branding.enableSpotlight) return;
    const rect = ref.current.getBoundingClientRect();
    setCoords({ x: cx - rect.left, y: cy - rect.top });
    setActive(true);
  };

  return (
    <div
      ref={ref}
      onMouseMove={(e) => update(e.clientX, e.clientY)}
      onMouseEnter={(e) => update(e.clientX, e.clientY)}
      onMouseLeave={() => setActive(false)}
      onPointerDown={(e) => update(e.clientX, e.clientY)}
      onTouchStart={(e) => e.touches[0] && update(e.touches[0].clientX, e.touches[0].clientY)}
      className={`relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/90 ${
        active && branding.enableSpotlight ? 'border-[var(--brand-primary,#D4AF37)] shadow-md' : ''
      } ${className}`}
      {...props}
    >
      {branding.enableSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px rounded-xl transition-opacity duration-300"
          style={{
            opacity: active ? 1 : 0,
            background: `radial-gradient(420px circle at ${coords.x}px ${coords.y}px, var(--brand-glow, ${branding.spotlightColor}), transparent 75%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function SpotlightHeading({ as: Tag = 'h2', children, className = '', ...props }: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'h4' }) {
  return (
    <Tag className={`font-bold tracking-tight text-slate-900 dark:text-slate-100 ${className}`} {...props}>
      {children}
    </Tag>
  );
}
""",
    "apps/web/src/components/layout/MobileBottomNav.tsx": """'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, CheckCircle2, ClipboardList, CreditCard, LayoutGrid, QrCode, Utensils, Wallet } from 'lucide-react';

export type MobileNavPersona = 'CLIENT' | 'ERP_STAFF' | 'SECURITY_GATE';

const TABS = {
  CLIENT: [
    { href: '/portal/dashboard', labelAr: 'الرئيسية', labelEn: 'Home', icon: LayoutGrid },
    { href: '/portal/floor-plan', labelAr: 'القاعة', labelEn: 'Floor Plan', icon: Calendar },
    { href: '/portal/approvals', labelAr: 'الاعتمادات', labelEn: 'Approvals', icon: CheckCircle2 },
    { href: '/portal/payments', labelAr: 'المدفوعات', labelEn: 'Payments', icon: CreditCard },
  ],
  ERP_STAFF: [
    { href: '/erp/dashboard', labelAr: 'الحجوزات', labelEn: 'Events', icon: Calendar },
    { href: '/erp/approvals', labelAr: 'الطلبات', labelEn: 'Queue', icon: CheckCircle2 },
    { href: '/erp/ops/beo', labelAr: 'التشغيل', labelEn: 'Live BEO', icon: Utensils },
    { href: '/erp/finance/ledger', labelAr: 'المالية', labelEn: 'Finance', icon: Wallet },
  ],
  SECURITY_GATE: [
    { href: '/gate/scanner', labelAr: 'ماسح QR', labelEn: 'Scan QR', icon: QrCode },
    { href: '/gate/guest-list', labelAr: 'المدعوين', labelEn: 'Guests', icon: ClipboardList },
  ],
};

export function MobileBottomNav({ persona, locale = 'ar' }: { persona: MobileNavPersona; locale?: 'ar' | 'en' }) {
  const pathname = usePathname();
  const isRtl = locale === 'ar';
  return (
    <nav dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {TABS[persona].map((tab) => {
          const fullHref = `/${locale}${tab.href}`;
          const Icon = tab.icon;
          const active = pathname?.startsWith(fullHref);
          return (
            <Link key={tab.href} href={fullHref} className={`flex min-h-[44px] min-w-[60px] flex-col items-center justify-center gap-1 text-[11px] ${active ? 'text-[var(--brand-primary,#D4AF37)]' : 'text-slate-400'}`}>
              <Icon className="h-5 w-5" />
              <span>{isRtl ? tab.labelAr : tab.labelEn}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
""",
    "apps/web/src/components/ui/ResponsiveDataList.tsx": """'use client';

import React from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-elements';

export interface ColumnDef<T> {
  key: string;
  headerAr: string;
  headerEn: string;
  render: (row: T) => React.ReactNode;
}

export function ResponsiveDataList<T extends { id: string }>({
  data,
  columns,
  locale = 'ar',
  mobileCardHeader,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  locale?: 'ar' | 'en';
  mobileCardHeader: (row: T) => React.ReactNode;
}) {
  const isRtl = locale === 'ar';
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-800 md:block">
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 text-start">{isRtl ? c.headerAr : c.headerEn}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {data.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {data.map((row) => (
          <SpotlightCard key={row.id} className="space-y-2 p-4">
            <div className="font-bold">{mobileCardHeader(row)}</div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {columns.map((c) => (
                <div key={c.key}>
                  <dt className="text-slate-400">{isRtl ? c.headerAr : c.headerEn}</dt>
                  <dd>{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </SpotlightCard>
        ))}
      </div>
    </>
  );
}
""",
    "apps/web/src/components/native/WorkspaceConnectScreen.tsx": """'use client';

import React, { useState } from 'react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export function WorkspaceConnectScreen({ locale = 'ar', onConnected }: { locale?: 'ar' | 'en'; onConnected?: (cfg: { slug: string; apiUrl: string }) => void }) {
  const isRtl = locale === 'ar';
  const [slug, setSlug] = useState('almassa');
  const [mode, setMode] = useState<'CLOUD' | 'LAN'>('CLOUD');
  const [lanIp, setLanIp] = useState('http://192.168.1.100:8000/api/v1');

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const apiUrl = mode === 'CLOUD' ? `https://${slug}.eventledger.cloud/api/v1` : lanIp;
    if (typeof window !== 'undefined') {
      localStorage.setItem('eventledger_native_tenant', JSON.stringify({ slug, apiUrl }));
    }
    onConnected?.({ slug, apiUrl });
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <SpotlightCard className="w-full max-w-md space-y-4">
        <SpotlightHeading as="h2" className="text-xl">
          {isRtl ? 'ربط تطبيق إيفنت ليدجر (EventLedger)' : 'Connect EventLedger Workspace'}
        </SpotlightHeading>
        <form onSubmit={handleConnect} className="space-y-3">
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="almassa" required className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('CLOUD')} className={`flex-1 rounded-lg border py-2 text-xs ${mode === 'CLOUD' ? 'border-[var(--brand-primary)]' : 'border-slate-700'}`}>Cloud</button>
            <button type="button" onClick={() => setMode('LAN')} className={`flex-1 rounded-lg border py-2 text-xs ${mode === 'LAN' ? 'border-[var(--brand-primary)]' : 'border-slate-700'}`}>LAN</button>
          </div>
          {mode === 'LAN' && <input value={lanIp} onChange={(e) => setLanIp(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs" />}
          <button type="submit" className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950">
            {isRtl ? 'دخول النظام' : 'Launch Workspace'}
          </button>
        </form>
      </SpotlightCard>
    </div>
  );
}
""",
    "apps/web/src/app/[locale]/layout.tsx": """import React from 'react';
import '../globals.css';
import { ThemeBrandingProvider } from '@/components/providers/theme-branding-provider';

export function generateStaticParams() {
  return [{ locale: 'ar' }, { locale: 'en' }];
}

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeBrandingProvider>{children}</ThemeBrandingProvider>
      </body>
    </html>
  );
}
""",
    "apps/web/src/app/[locale]/(marketing)/page.tsx": """'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function SaasLandingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const [venueName, setVenueName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/v1/public/tenants/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_name: venueName, slug, owner_name: ownerName, owner_phone: phone }),
    });
    const data = await res.json();
    if (data?.slug) {
      const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local').split(':')[0];
      window.location.href = `${window.location.protocol}//${data.slug}.${root}/${locale}/erp/dashboard`;
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-4xl space-y-8 px-6 py-16">
      <div className="text-center">
        <SpotlightHeading as="h1" className="text-3xl sm:text-5xl">
          {isRtl ? 'إيفنت ليدجر — نظام إدارة القاعات والمؤتمرات' : 'EventLedger — Venue & Conference SaaS ERP'}
        </SpotlightHeading>
      </div>
      <SpotlightCard className="mx-auto max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder={isRtl ? 'اسم الصالة' : 'Venue Name'} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="almassa" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder={isRtl ? 'اسم المالك' : 'Owner Name'} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+967770000001" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <button type="submit" className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950">
            {isRtl ? 'تفعيل المنصة الآن' : 'Launch Workspace'}
          </button>
        </form>
      </SpotlightCard>
    </div>
  );
}
""",
    "apps/web/src/app/[locale]/portal/dashboard/page.tsx": """'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

export default function ClientPortalDashboard() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-5xl space-y-6 p-6 pb-24">
      <SpotlightHeading as="h1" className="text-2xl">
        {isRtl ? 'لوحة تحكم العميل (Client Control Panel)' : 'Client Account Control Panel'}
      </SpotlightHeading>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'ملف العميل والاسترداد' : 'B2C/B2B & Refund Vault'}</div>
          <div className="mt-2 text-sm font-semibold">Kuraimi / Jaib / Jawali / OneCash / IBAN</div>
        </SpotlightCard>
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'تفويض المنظمين وسجل التدقيق' : 'Delegation & Immutable Audit Log'}</div>
          <div className="mt-2 text-sm font-semibold">EVT-2026-1001 — CONFIRMED</div>
        </SpotlightCard>
      </div>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
""",
    "apps/web/src/app/[locale]/(erp)/dashboard/page.tsx": """'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

export default function ErpDashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-6 p-6 pb-24">
      <SpotlightHeading as="h1" className="text-2xl">
        {isRtl ? 'لوحة عمليات الصالة (Internal Venue ERP)' : 'Internal Venue Operations Hub'}
      </SpotlightHeading>
      <SpotlightCard>
        <div className="text-sm">{isRtl ? 'قصر الماسة للمؤتمرات والأفراح — نظام جاهز للتشغيل' : 'Al-Massa Grand Palace — Active ERP Workspace'}</div>
      </SpotlightCard>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
""",
    # =========================================================================
    # PHASE 8: TAURI V2 (.exe) & CAPACITOR 6 (.apk) WRAPPERS
    # =========================================================================
    "apps/desktop/package.json": """{
  "name": "desktop",
  "private": true,
  "scripts": {
    "tauri": "tauri",
    "build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  }
}
""",
    "apps/desktop/src-tauri/tauri.conf.json": """{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "EventLedger",
  "version": "3.0.0",
  "identifier": "cloud.eventledger.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter web dev",
    "beforeBuildCommand": "BUILD_TARGET=NATIVE pnpm --filter web build",
    "frontendDist": "../../web/out"
  },
  "app": {
    "windows": [{ "title": "EventLedger (إيفنت ليدجر)", "width": 1280, "height": 840, "resizable": true }]
  },
  "bundle": { "active": true, "targets": ["nsis"] }
}
""",
    "apps/mobile/package.json": """{
  "name": "mobile",
  "private": true,
  "scripts": { "cap": "cap" },
  "dependencies": {
    "@capacitor/core": "^6.0.0",
    "@capacitor/cli": "^6.0.0",
    "@capacitor/splash-screen": "^6.0.0",
    "@capacitor/push-notifications": "^6.0.0",
    "@capacitor-mlkit/barcode-scanning": "^6.0.0"
  }
}
""",
    "apps/mobile/capacitor.config.ts": """import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cloud.eventledger.mobile',
  appName: 'EventLedger',
  webDir: '../web/out',
  server: { androidScheme: 'https', cleartext: true },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, backgroundColor: '#0F172A', showSpinner: true, spinnerColor: '#D4AF37' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
""",
}


def main():
    for rel_path, content in FILES.items():
        target = ROOT / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.lstrip("\n"), encoding="utf-8")
        print(f"Wrote {rel_path}")

    env_file = ROOT / ".env"
    if not env_file.exists():
        env_file.write_text(FILES[".env.example"].lstrip("\n"), encoding="utf-8")
        print("Created .env from .env.example")

    print("\n✅ All 8 phases written! Run these verification commands next:")
    print("  1. docker-compose up -d")
    print("  2. cd apps/api && pip install -e . && alembic revision --autogenerate -m 'init' && alembic upgrade head && python seed.py")
    print("  3. uvicorn app.main:app --reload --port 8000")
    print("  4. pnpm install && pnpm --filter web build")


if __name__ == "__main__":
    main()
