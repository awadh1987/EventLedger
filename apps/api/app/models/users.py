import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPkMixin, utcnow


class UserType(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    INTERNAL_STAFF = "INTERNAL_STAFF"
    CLIENT_PRIMARY = "CLIENT_PRIMARY"
    CLIENT_DELEGATE = "CLIENT_DELEGATE"
    EXTERNAL_VENDOR = "EXTERNAL_VENDOR"


class StaffRole(str, enum.Enum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    SALES_MANAGER = "SALES_MANAGER"
    SALES_REP = "SALES_REP"
    SALES = "SALES"
    FINANCE = "FINANCE"
    OPS_MANAGER = "OPS_MANAGER"
    HEAD_CHEF = "HEAD_CHEF"
    SECURITY = "SECURITY"
    STAFF = "STAFF"
    OTHER = "OTHER"


class ClientCategory(str, enum.Enum):
    INDIVIDUAL_B2C = "INDIVIDUAL_B2C"
    CORPORATE_B2B = "CORPORATE_B2B"


class DelegateRole(str, enum.Enum):
    CO_HOST = "CO_HOST"
    WEDDING_PLANNER = "WEDDING_PLANNER"
    VENDOR = "VENDOR"


class User(UUIDPkMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "phone", name="uq_users_tenant_phone"),
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_type: Mapped[UserType] = mapped_column(Enum(UserType))
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    phone: Mapped[str] = mapped_column(String(40), index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    full_name: Mapped[str] = mapped_column(String(255))
    preferred_lang: Mapped[str] = mapped_column(String(10), default="ar")
    is_2fa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    staff_profile: Mapped[Optional["StaffProfile"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    client_profile: Mapped[Optional["ClientProfile"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class StaffProfile(Base):
    __tablename__ = "staff_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[StaffRole] = mapped_column(Enum(StaffRole))
    custom_role_title: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    department: Mapped[str] = mapped_column(String(80))
    max_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    permissions_json: Mapped[dict] = mapped_column(JSON, default=dict)

    user: Mapped["User"] = relationship(back_populates="staff_profile")


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    client_category: Mapped[ClientCategory] = mapped_column(Enum(ClientCategory), default=ClientCategory.INDIVIDUAL_B2C)
    custom_category_label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    national_id_or_cr: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tax_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refund_bank_details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    vip_tier: Mapped[str] = mapped_column(String(30), default="STANDARD")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    archived_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    archive_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="client_profile")


class EventDelegate(UUIDPkMixin, Base):
    __tablename__ = "event_delegates"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_delegate"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delegate_role: Mapped[DelegateRole] = mapped_column(Enum(DelegateRole))
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)
