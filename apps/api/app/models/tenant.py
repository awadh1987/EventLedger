import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, RecordLifecycle, TenantOwnedMixin, UUIDPkMixin, utcnow

__all__ = [
    "Base",
    "RecordLifecycle",
    "SubscriptionTier",
    "SubscriptionStatus",
    "Tenant",
    "TenantBranding",
    "SystemLookup",
]


class SubscriptionTier(str, enum.Enum):
    BASIC = "BASIC"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


class SubscriptionStatus(str, enum.Enum):
    TRIAL = "TRIAL"
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    SUSPENDED = "SUSPENDED"


class Tenant(UUIDPkMixin, Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    custom_domain: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    custom_domain_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    subscription_tier: Mapped[SubscriptionTier] = mapped_column(Enum(SubscriptionTier), default=SubscriptionTier.PRO)
    subscription_status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus), default=SubscriptionStatus.ACTIVE
    )
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    max_halls: Mapped[int] = mapped_column(Integer, default=5)
    monthly_whatsapp_quota: Mapped[int] = mapped_column(Integer, default=2000)
    whatsapp_used_this_month: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(10), default="YER")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    whatsapp_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    payment_accounts: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    branding: Mapped[Optional["TenantBranding"]] = relationship(back_populates="tenant", uselist=False)


class TenantBranding(UUIDPkMixin, Base):
    __tablename__ = "tenant_brandings"

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True)
    logo_light_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logo_dark_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    favicon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_color: Mapped[str] = mapped_column(String(20), default="#D4AF37")
    accent_color: Mapped[str] = mapped_column(String(20), default="#0F172A")
    default_theme: Mapped[str] = mapped_column(String(20), default="SYSTEM")
    enable_spotlight: Mapped[bool] = mapped_column(Boolean, default=True)
    spotlight_color: Mapped[str] = mapped_column(String(50), default="rgba(212, 175, 55, 0.18)")
    hero_tagline_ar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hero_tagline_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invoice_footer_ar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invoice_footer_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="branding")


class SystemLookup(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "system_lookups"
    __table_args__ = (UniqueConstraint("tenant_id", "category", "code", name="uq_tenant_category_code"),)

    category: Mapped[str] = mapped_column(String(60), index=True)
    code: Mapped[str] = mapped_column(String(60))
    label_ar: Mapped[str] = mapped_column(String(255))
    label_en: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
