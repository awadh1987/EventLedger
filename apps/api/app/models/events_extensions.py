"""Extension models for digital contracts, guest RSVPs, and post-event damage inspections."""
import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, RecordLifecycle, TenantOwnedMixin, UUIDPkMixin, utcnow


class RsvpStatus(str, enum.Enum):
    INVITED = "INVITED"
    CONFIRMED = "CONFIRMED"
    DECLINED = "DECLINED"


class InspectionStatus(str, enum.Enum):
    PASSED = "PASSED"
    DAMAGE_CLAIMED = "DAMAGE_CLAIMED"


class EventContract(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_contracts"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True)
    contract_number: Mapped[str] = mapped_column(String(60), unique=True)
    terms_ar: Mapped[str] = mapped_column(Text)
    terms_en: Mapped[str] = mapped_column(Text)
    client_signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    client_signature_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    client_signature_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    staff_countersigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pdf_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EventGuest(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_guests"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    vip_tier: Mapped[str] = mapped_column(String(40), default="STANDARD")
    dietary_notes: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    table_label: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    rsvp_status: Mapped[RsvpStatus] = mapped_column(Enum(RsvpStatus), default=RsvpStatus.INVITED)
    gate_pass_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("gate_passes.id", ondelete="SET NULL"), nullable=True
    )
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DamageInspection(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "damage_inspections"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True)
    inspected_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    checklist_json: Mapped[dict] = mapped_column(JSON, default=dict)
    photos_json: Mapped[list] = mapped_column(JSON, default=list)
    deduction_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[InspectionStatus] = mapped_column(Enum(InspectionStatus), default=InspectionStatus.PASSED)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
    inspected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
