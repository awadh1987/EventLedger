import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import ARRAY, JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, RecordLifecycle, TenantOwnedMixin, UUIDPkMixin


class Hall(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "halls"

    name: Mapped[str] = mapped_column(String(255))
    name_ar: Mapped[str] = mapped_column(String(255))
    capacity_banquet: Mapped[int] = mapped_column(Integer)
    capacity_theater: Mapped[int] = mapped_column(Integer)
    base_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    cleaning_buffer_minutes: Mapped[int] = mapped_column(Integer, default=120)
    combinable_with_hall_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


class PricingRule(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "pricing_rules"

    hall_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("halls.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    days_of_week: Mapped[list[int]] = mapped_column(
        JSON().with_variant(ARRAY(Integer), "postgresql"), default=list
    )
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    multiplier: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=Decimal("1.00"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class InventoryItem(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "inventory_items"

    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(80))
    total_stock: Mapped[int] = mapped_column(Integer, default=0)
    unit_addon_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)


class EventInventoryAllocation(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_inventory_allocations"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_items.id"))
    quantity_reserved: Mapped[int] = mapped_column(Integer)


class CateringMenuItem(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "catering_menu_items"

    name_ar: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255))
    price_per_guest: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    cost_per_guest: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    recipe_bom: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
