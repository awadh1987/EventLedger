"""Extension models for digital contracts, guest RSVPs, and post-event damage inspections."""
import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, Uuid
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
    __table_args__ = (UniqueConstraint("tenant_id", "contract_number", name="uq_contracts_tenant_number"),)

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True)
    contract_number: Mapped[str] = mapped_column(String(60), index=True)
    terms_ar: Mapped[str] = mapped_column(Text)
    terms_en: Mapped[str] = mapped_column(Text)
    client_signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    client_signature_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    client_signature_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    staff_countersigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    staff_countersigned_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, nullable=True)
    pdf_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="DRAFT")
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    amendment_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
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
    deduction_items_json: Mapped[list] = mapped_column(JSON, default=list)
    deduction_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approval_status: Mapped[str] = mapped_column(String(40), default="FINALIZED")
    client_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    amendment_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[InspectionStatus] = mapped_column(Enum(InspectionStatus), default=InspectionStatus.PASSED)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)
    inspected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EventSecurityProfile(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_security_profiles"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True)
    readiness_checklist_json: Mapped[dict] = mapped_column(JSON, default=dict)
    guard_headcount: Mapped[int] = mapped_column(Integer, default=4)
    security_lead_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    security_status: Mapped[str] = mapped_column(String(40), default="DRAFT")
    tenant_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    client_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    amendment_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class NotificationLog(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "notification_logs"

    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    recipient_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    recipient_address: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    channel: Mapped[str] = mapped_column(String(30), default="IN_APP")
    category: Mapped[str] = mapped_column(String(50), default="STATUS_UPDATE")
    title: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    delivery_status: Mapped[str] = mapped_column(String(40), default="DELIVERED")
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
