"""Governance models for tiered change-approval workflows (Tenant Admin & Super Admin)."""
import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin, utcnow


class GovernanceScope(str, enum.Enum):
    TENANT_ADMIN = "TENANT_ADMIN"
    SUPER_ADMIN = "SUPER_ADMIN"


class GovernanceRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RETURNED_FOR_AMENDMENT = "RETURNED_FOR_AMENDMENT"


class GovernanceTargetType(str, enum.Enum):
    EVENT = "EVENT"
    CLIENT = "CLIENT"
    TENANT = "TENANT"


class ChangeApprovalRequest(UUIDPkMixin, Base):
    __tablename__ = "change_approval_requests"

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    scope: Mapped[str] = mapped_column(String(40), index=True)
    target_entity_type: Mapped[str] = mapped_column(String(60), index=True)
    target_entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    request_title: Mapped[str] = mapped_column(String(255))
    current_values: Mapped[dict] = mapped_column(JSON, default=dict)
    proposed_values: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(40), default=GovernanceRequestStatus.PENDING.value, index=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    requester_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewer_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
