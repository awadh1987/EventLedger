# EventLedger (إيفنت ليدجر) — Python Backend Master Execution Pack
**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Alembic + Celery/Redis + WeasyPrint + Next.js 14 (RTL/LTR Frontend)

---

## 1. Python Backend Directory Structure (`apps/api`)
```text
apps/api/
├── alembic/
│   └── versions/
├── app/
│   ├── main.py                        # FastAPI app, CORS, TenantMiddleware, WebSockets
│   ├── core/
│   │   ├── config.py                  # Pydantic BaseSettings (.env loader)
│   │   ├── database.py                # Async SQLAlchemy engine & get_db dependency
│   │   ├── security.py                # JWT auth, 2FA OTP, RBAC role guards
│   │   └── tenant_middleware.py       # Resolves {slug}.eventledger.cloud & customDomain
│   ├── models/                        # SQLAlchemy 2.0 Declarative Models
│   │   ├── tenant.py                  # Tenant, TenantBranding, SystemLookup
│   │   ├── users.py                   # User, StaffProfile, ClientProfile, EventDelegate
│   │   ├── venue.py                   # Hall, PricingRule, InventoryItem, CateringMenuItem
│   │   ├── events.py                  # Event, EventDraft, ApprovalRequest, EventMessage, GatePass, AuditLog
│   │   └── accounting.py              # ChartOfAccount, AccountingConfig, JournalEntry, JournalLine, Invoice, PaymentMilestone, EventExpense
│   ├── schemas/                       # Pydantic v2 Request/Response DTOs
│   ├── services/
│   │   ├── availability_service.py    # Partition-hall conflict checks & PricingRule engine
│   │   ├── approvals_service.py       # Draft -> Approval -> Cross-ERP Sync pipeline
│   │   ├── accounting_service.py      # Balanced Double-Entry Journal posting & Event P&L
│   │   ├── comms_service.py           # In-App EventMessage + WhatsApp Cloud API webhooks
│   │   └── import_export_service.py   # UTF-8 BOM CSV bulk import + WeasyPrint RTL/LTR PDF export
│   ├── routers/                       # FastAPI APIRouters (/public, /portal, /erp, /gate, /admin)
│   └── workers/
│       └── celery_tasks.py            # 48h tentative hold auto-expiry & WhatsApp reminders
├── seed.py                            # Python async database seeder (EventLedger + Al-Massa Palace)
├── pyproject.toml                     # FastAPI, SQLAlchemy, asyncpg, alembic, pydantic, celery, redis, weasyprint, boto3
└── alembic.ini
```

---

## 2. Complete Python SQLAlchemy 2.0 Database Models (`app/models/`)

```python
import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from sqlalchemy import (
    String, Integer, Boolean, DateTime, ForeignKey, Numeric, Text, Enum, JSON, ARRAY, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ==========================================
# ENUMS
# ==========================================
class SubscriptionTier(str, enum.Enum):
    BASIC = "BASIC"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


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


class RecordLifecycle(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    DELETED = "DELETED"


class AccountType(str, enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    REVENUE = "REVENUE"
    EXPENSE = "EXPENSE"


class EventStatus(str, enum.Enum):
    INQUIRY = "INQUIRY"
    HOLD_48H = "HOLD_48H"
    CONTRACT_PENDING = "CONTRACT_PENDING"
    CONFIRMED = "CONFIRMED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class DelegateRole(str, enum.Enum):
    CO_HOST = "CO_HOST"
    WEDDING_PLANNER = "WEDDING_PLANNER"
    VENDOR = "VENDOR"


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


# ==========================================
# 1. MULTI-TENANCY, BRANDING & LOOKUPS
# ==========================================
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
    accounting_config: Mapped[Optional["AccountingConfig"]] = relationship(back_populates="tenant", uselist=False)


class TenantBranding(Base):
    __tablename__ = "tenant_branding"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True)
    logo_light_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logo_dark_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    favicon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_color: Mapped[str] = mapped_column(String(20), default="#D4AF37")
    accent_color: Mapped[str] = mapped_column(String(20), default="#1E293B")
    default_theme: Mapped[str] = mapped_column(String(20), default="SYSTEM")
    enable_spotlight: Mapped[bool] = mapped_column(Boolean, default=True)
    spotlight_color: Mapped[str] = mapped_column(String(50), default="rgba(212, 175, 55, 0.18)")
    invoice_footer_ar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invoice_footer_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="branding")


class SystemLookup(Base):
    __tablename__ = "system_lookups"
    __table_args__ = (UniqueConstraint("tenant_id", "category", "code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(50))
    code: Mapped[str] = mapped_column(String(50))
    label_ar: Mapped[str] = mapped_column(String(255))
    label_en: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


# ==========================================
# 2. DOUBLE-ENTRY ACCOUNTING
# ==========================================
class ChartOfAccount(Base):
    __tablename__ = "chart_of_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name_ar: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255))
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType))
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("chart_of_accounts.id"), nullable=True)
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

    tenant: Mapped["Tenant"] = relationship(back_populates="accounting_config")


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (UniqueConstraint("tenant_id", "entry_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    entry_number: Mapped[str] = mapped_column(String(50))
    entry_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="POSTED")
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))

    lines: Mapped[List["JournalLine"]] = relationship(back_populates="journal_entry", cascade="all, delete-orphan")


class JournalLine(Base):
    __tablename__ = "journal_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    journal_entry_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chart_of_accounts.id"))
    debit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    credit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    journal_entry: Mapped["JournalEntry"] = relationship(back_populates="lines")


# ==========================================
# 3. USERS, STAFF & CLIENT PROFILES
# ==========================================
class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    user_type: Mapped[UserType] = mapped_column(Enum(UserType))
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    phone: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    full_name: Mapped[str] = mapped_column(String(255))
    preferred_lang: Mapped[str] = mapped_column(String(5), default="ar")
    is_2fa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StaffProfile(Base):
    __tablename__ = "staff_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[StaffRole] = mapped_column(Enum(StaffRole))
    department: Mapped[str] = mapped_column(String(50))
    max_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    client_category: Mapped[ClientCategory] = mapped_column(Enum(ClientCategory))
    national_id_or_cr: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tax_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refund_bank_details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    vip_tier: Mapped[str] = mapped_column(String(20), default="STANDARD")


# ==========================================
# 4. HALLS, EVENTS, DRAFTS, APPROVALS & GATE
# ==========================================
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


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    security_deposit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    deposit_status: Mapped[DepositStatus] = mapped_column(Enum(DepositStatus), default=DepositStatus.UNPAID)
    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT)
```

---

## 3. Core Python Services (`app/services/`)

### A. Double-Entry Accounting Service (`app/services/accounting_service.py`)
```python
from decimal import Decimal
import uuid
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import AccountingConfig, JournalEntry, JournalLine


class DoubleEntryService:
    @staticmethod
    async def post_journal_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        description: str,
        lines: list[dict],
        reference: str | None = None,
        event_id: uuid.UUID | None = None,
    ) -> JournalEntry:
        total_debit = sum(Decimal(str(l.get("debit", 0))) for l in lines)
        total_credit = sum(Decimal(str(l.get("credit", 0))) for l in lines)

        if abs(total_debit - total_credit) > Decimal("0.01"):
            raise HTTPException(
                status_code=400,
                detail=f"Unbalanced Journal Entry: Debit ({total_debit}) != Credit ({total_credit})",
            )

        entry = JournalEntry(
            tenant_id=tenant_id,
            entry_number=f"JE-{int(uuid.uuid4().int % 10**9)}",
            reference=reference,
            description=description,
            event_id=event_id,
            created_by_id=created_by_id,
            lines=[
                JournalLine(
                    account_id=l["account_id"],
                    debit=Decimal(str(l.get("debit", 0))),
                    credit=Decimal(str(l.get("credit", 0))),
                    memo=l.get("memo"),
                )
                for l in lines
            ],
        )
        db.add(entry)
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
        res = await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
        cfg = res.scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        debit_account = cfg.cash_account_id if payment_method == "CASH" else cfg.bank_account_id
        credit_account = cfg.security_deposit_liab_id if is_security_deposit else cfg.accounts_receivable_id

        return await DoubleEntryService.post_journal_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=reference,
            event_id=event_id,
            description="Security Deposit Liability Held" if is_security_deposit else "Event Milestone Payment Received",
            lines=[
                {"account_id": debit_account, "debit": amount, "credit": Decimal("0.00"), "memo": payment_method},
                {"account_id": credit_account, "debit": Decimal("0.00"), "credit": amount, "memo": reference},
            ],
        )
```

### B. Tenant Subdomain & Custom Domain Middleware (`app/core/tenant_middleware.py`)
```python
import os
from fastapi import Request
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant

ROOT_DOMAIN = os.getenv("ROOT_DOMAIN", "eventledger.local:3000").split(":")[0].lower()


class TenantResolverMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0].lower()
        request.state.tenant = None
        request.state.tenant_mode = "PLATFORM_ROOT"

        if host == f"admin.{ROOT_DOMAIN}":
            request.state.tenant_mode = "PLATFORM_SUPER_ADMIN"
        elif host and host not in (ROOT_DOMAIN, f"www.{ROOT_DOMAIN}", "localhost", "127.0.0.1"):
            async with AsyncSessionLocal() as db:
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
```

---

## 4. Updated Phase 1 Prompt for Your Coding Agent (Python Stack)

> *"Read `CLAUDE.md`, `docker-compose.yml`, `.env.example`, `eventledger-complete-bundle.md`, and `eventledger-python-fastapi-pack.md`. Build the **EventLedger (إيفنت ليدجر)** monorepo with `apps/api` in **Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Alembic + Celery + Redis + WeasyPrint** (using the exact SQLAlchemy models and services in `eventledger-python-fastapi-pack.md`), and `apps/web` in **Next.js 14 App Router + Tailwind CSS + Shadcn/UI + `next-intl` (Arabic `dir="rtl"` & English `dir="ltr"`) + `react-konva`**. Configure Alembic migrations, create `apps/api/seed.py` for the sample tenant (`almassa`), start Docker, run migrations and seed data, and verify both `uvicorn` and `next build` pass."*
