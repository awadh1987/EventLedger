import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, RecordLifecycle, TenantOwnedMixin, UUIDPkMixin, utcnow


class AccountType(str, enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    REVENUE = "REVENUE"
    EXPENSE = "EXPENSE"


class NormalBalance(str, enum.Enum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class PeriodStatus(str, enum.Enum):
    OPEN = "OPEN"
    LOCKED = "LOCKED"
    CLOSED = "CLOSED"


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


def default_normal_balance(account_type: AccountType) -> NormalBalance:
    if account_type in (AccountType.ASSET, AccountType.EXPENSE):
        return NormalBalance.DEBIT
    return NormalBalance.CREDIT


class ChartOfAccount(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "chart_of_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_tenant_account_code"),)

    code: Mapped[str] = mapped_column(String(30))
    name_ar: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255))
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType))
    normal_balance: Mapped[NormalBalance] = mapped_column(Enum(NormalBalance), default=NormalBalance.DEBIT)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("chart_of_accounts.id", ondelete="SET NULL"), nullable=True
    )
    is_control_account: Mapped[bool] = mapped_column(Boolean, default=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


class AccountingConfig(UUIDPkMixin, Base):
    __tablename__ = "accounting_configs"

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True)
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, default=1)
    auto_post_on_payment_verify: Mapped[bool] = mapped_column(Boolean, default=True)
    cash_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    bank_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    accounts_receivable_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    hall_revenue_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    catering_revenue_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    security_deposit_liab_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    tax_payable_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    catering_cogs_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    damage_recovery_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    general_expense_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)


class SequenceCounter(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "sequence_counters"
    __table_args__ = (UniqueConstraint("tenant_id", "doc_type", "year", name="uq_tenant_seq_doc_year"),)

    doc_type: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    last_number: Mapped[int] = mapped_column(Integer, default=0)


class FiscalYear(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "fiscal_years"
    __table_args__ = (UniqueConstraint("tenant_id", "year_label", name="uq_tenant_fiscal_year"),)

    year_label: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[datetime] = mapped_column(DateTime)
    end_date: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[PeriodStatus] = mapped_column(Enum(PeriodStatus), default=PeriodStatus.OPEN)


class AccountingPeriod(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "accounting_periods"
    __table_args__ = (UniqueConstraint("tenant_id", "fiscal_year_id", "period_number", name="uq_tenant_fy_period"),)

    fiscal_year_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fiscal_years.id", ondelete="CASCADE"), index=True)
    period_number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(40))
    start_date: Mapped[datetime] = mapped_column(DateTime)
    end_date: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[PeriodStatus] = mapped_column(Enum(PeriodStatus), default=PeriodStatus.OPEN)


class JournalEntry(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        UniqueConstraint("tenant_id", "entry_number", name="uq_tenant_entry_number"),
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_tenant_je_idempotency"),
    )

    entry_number: Mapped[str] = mapped_column(String(50))
    entry_date: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    fiscal_period_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("accounting_periods.id", ondelete="SET NULL"), nullable=True
    )
    reversed_entry_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("journal_entries.id", ondelete="SET NULL"), nullable=True
    )
    is_system_posting: Mapped[bool] = mapped_column(Boolean, default=False)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="POSTED")
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    lines: Mapped[list["JournalLine"]] = relationship(back_populates="journal_entry", cascade="all, delete-orphan")


class JournalLine(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "journal_lines"
    __table_args__ = (
        CheckConstraint("debit >= 0", name="ck_journal_line_debit_nonneg"),
        CheckConstraint("credit >= 0", name="ck_journal_line_credit_nonneg"),
    )

    journal_entry_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chart_of_accounts.id"))
    debit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    credit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    journal_entry: Mapped["JournalEntry"] = relationship(back_populates="lines")


class Invoice(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("tenant_id", "invoice_number", name="uq_invoices_tenant_number"),)

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    invoice_number: Mapped[str] = mapped_column(String(60), index=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    security_deposit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    deposit_status: Mapped[DepositStatus] = mapped_column(Enum(DepositStatus), default=DepositStatus.UNPAID)
    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    line_items_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    refund_voucher_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    refund_payment_method: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    refund_reference: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    refund_journal_entry_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PaymentMilestone(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "payment_milestones"

    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    amount_due: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    due_date: Mapped[datetime] = mapped_column(DateTime)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    payment_method: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    receipt_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_security_deposit: Mapped[bool] = mapped_column(Boolean, default=False)
    upload_token_jti: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    reviewer_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EventExpense(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_expenses"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    account_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("chart_of_accounts.id", ondelete="SET NULL"), nullable=True
    )
    payment_method: Mapped[str] = mapped_column(String(60), default="CASH")
    journal_entry_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("journal_entries.id", ondelete="SET NULL"), nullable=True
    )
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
