import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantOwnedMixin, UUIDPkMixin, utcnow


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


class Event(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "events"

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EventDraft(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_drafts"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    version_number: Mapped[int] = mapped_column(Integer)
    draft_type: Mapped[DraftType] = mapped_column(Enum(DraftType))
    payload: Mapped[dict] = mapped_column(JSON)
    financial_delta: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[DraftStatus] = mapped_column(Enum(DraftStatus), default=DraftStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ApprovalRequest(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "approval_requests"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    draft_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("event_drafts.id", ondelete="CASCADE"))
    requested_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    required_approver_role: Mapped[str] = mapped_column(String(50))
    approved_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[ApprovalStatus] = mapped_column(Enum(ApprovalStatus), default=ApprovalStatus.PENDING)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EventMessage(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "event_messages"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    channel: Mapped[str] = mapped_column(String(30), default="IN_APP")
    department: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    attachments: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class GatePass(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "gate_passes"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    pass_type: Mapped[str] = mapped_column(String(40))
    holder_name: Mapped[str] = mapped_column(String(255))
    holder_id_number: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    qr_token: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    valid_from: Mapped[datetime] = mapped_column(DateTime)
    valid_until: Mapped[datetime] = mapped_column(DateTime)
    is_checked_in: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AuditLog(UUIDPkMixin, TenantOwnedMixin, Base):
    __tablename__ = "audit_logs"

    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(120))
    old_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
