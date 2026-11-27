"""phase4_security_clients_close_op

Revision ID: f30b8d51c905
Revises: e19a4c72b604
Create Date: 2026-11-27 20:42:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f30b8d51c905"
down_revision: Union[str, None] = "e19a4c72b604"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE eventstatus ADD VALUE IF NOT EXISTS 'CLOSED'")

    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("closed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("closed_by_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("closing_remarks", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("reopened_reason", sa.Text(), nullable=True))

    with op.batch_alter_table("gate_passes") as batch_op:
        batch_op.add_column(
            sa.Column("clearance_category", sa.String(length=40), nullable=False, server_default="GUEST")
        )
        batch_op.add_column(sa.Column("holder_phone", sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column("organization", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("vehicle_plate", sa.String(length=60), nullable=True))
        batch_op.add_column(
            sa.Column("clearance_status", sa.String(length=40), nullable=False, server_default="APPROVED")
        )
        batch_op.add_column(sa.Column("remarks", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("requested_by_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("reviewed_by_id", sa.Uuid(), nullable=True))

    with op.batch_alter_table("client_profiles") as batch_op:
        batch_op.add_column(sa.Column("custom_category_label", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))

    with op.batch_alter_table("damage_inspections") as batch_op:
        batch_op.add_column(
            sa.Column("deduction_items_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )
        batch_op.add_column(
            sa.Column("approval_status", sa.String(length=40), nullable=False, server_default="FINALIZED")
        )
        batch_op.add_column(sa.Column("client_remarks", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("amendment_remarks", sa.Text(), nullable=True))

    op.create_table(
        "event_security_profiles",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("readiness_checklist_json", sa.JSON(), nullable=False),
        sa.Column("guard_headcount", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("security_lead_name", sa.String(length=150), nullable=True),
        sa.Column("security_status", sa.String(length=40), nullable=False, server_default="DRAFT"),
        sa.Column("tenant_remarks", sa.Text(), nullable=True),
        sa.Column("client_remarks", sa.Text(), nullable=True),
        sa.Column("amendment_reason", sa.Text(), nullable=True),
        sa.Column("updated_by_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_event_security_profile_event"),
    )
    op.create_index(op.f("ix_event_security_profiles_tenant_id"), "event_security_profiles", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_event_security_profiles_tenant_id"), table_name="event_security_profiles")
    op.drop_table("event_security_profiles")

    with op.batch_alter_table("damage_inspections") as batch_op:
        batch_op.drop_column("amendment_remarks")
        batch_op.drop_column("client_remarks")
        batch_op.drop_column("approval_status")
        batch_op.drop_column("deduction_items_json")

    with op.batch_alter_table("client_profiles") as batch_op:
        batch_op.drop_column("notes")
        batch_op.drop_column("custom_category_label")

    with op.batch_alter_table("gate_passes") as batch_op:
        batch_op.drop_column("reviewed_by_id")
        batch_op.drop_column("requested_by_id")
        batch_op.drop_column("remarks")
        batch_op.drop_column("clearance_status")
        batch_op.drop_column("vehicle_plate")
        batch_op.drop_column("organization")
        batch_op.drop_column("holder_phone")
        batch_op.drop_column("clearance_category")

    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("reopened_reason")
        batch_op.drop_column("closing_remarks")
        batch_op.drop_column("closed_by_id")
        batch_op.drop_column("closed_at")
