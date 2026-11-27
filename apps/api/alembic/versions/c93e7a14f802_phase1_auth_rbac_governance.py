"""phase1_auth_rbac_governance

Revision ID: c93e7a14f802
Revises: b82c5f91d401
Create Date: 2026-11-27 16:08:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "c93e7a14f802"
down_revision: Union[str, None] = "b82c5f91d401"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        for role_val in ("ADMIN", "SALES", "STAFF", "OTHER"):
            op.execute(f"ALTER TYPE staffrole ADD VALUE IF NOT EXISTS '{role_val}'")
        op.drop_constraint("users_email_key", "users", type_="unique")
        op.drop_index("ix_users_phone", table_name="users")
        op.create_index("ix_users_phone", "users", ["phone"], unique=False)
        op.create_index("ix_users_email", "users", ["email"], unique=False)
        op.create_unique_constraint("uq_users_tenant_phone", "users", ["tenant_id", "phone"])
        op.create_unique_constraint("uq_users_tenant_email", "users", ["tenant_id", "email"])
        op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_platform_phone ON users (phone) WHERE tenant_id IS NULL")
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_platform_email ON users (email) WHERE tenant_id IS NULL AND email IS NOT NULL"
        )
    else:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_index("ix_users_phone")
            batch_op.create_index("ix_users_phone", ["phone"], unique=False)
            batch_op.create_index("ix_users_email", ["email"], unique=False)
            batch_op.create_unique_constraint("uq_users_tenant_phone", ["tenant_id", "phone"])
            batch_op.create_unique_constraint("uq_users_tenant_email", ["tenant_id", "email"])

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("phone_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("last_login_at", sa.DateTime(), nullable=True))

    with op.batch_alter_table("staff_profiles") as batch_op:
        batch_op.add_column(sa.Column("custom_role_title", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("permissions_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))

    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("title", sa.String(length=255), nullable=True))

    op.create_table(
        "change_approval_requests",
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("scope", sa.String(length=40), nullable=False),
        sa.Column("target_entity_type", sa.String(length=60), nullable=False),
        sa.Column("target_entity_id", sa.Uuid(), nullable=False),
        sa.Column("request_title", sa.String(length=255), nullable=False),
        sa.Column("current_values", sa.JSON(), nullable=False),
        sa.Column("proposed_values", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("requester_id", sa.Uuid(), nullable=False),
        sa.Column("requester_remarks", sa.Text(), nullable=True),
        sa.Column("reviewer_id", sa.Uuid(), nullable=True),
        sa.Column("reviewer_remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_change_approval_requests_requester_id"), "change_approval_requests", ["requester_id"], unique=False)
    op.create_index(op.f("ix_change_approval_requests_scope"), "change_approval_requests", ["scope"], unique=False)
    op.create_index(op.f("ix_change_approval_requests_status"), "change_approval_requests", ["status"], unique=False)
    op.create_index(op.f("ix_change_approval_requests_target_entity_id"), "change_approval_requests", ["target_entity_id"], unique=False)
    op.create_index(op.f("ix_change_approval_requests_target_entity_type"), "change_approval_requests", ["target_entity_type"], unique=False)
    op.create_index(op.f("ix_change_approval_requests_tenant_id"), "change_approval_requests", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_change_approval_requests_tenant_id"), table_name="change_approval_requests")
    op.drop_index(op.f("ix_change_approval_requests_target_entity_type"), table_name="change_approval_requests")
    op.drop_index(op.f("ix_change_approval_requests_target_entity_id"), table_name="change_approval_requests")
    op.drop_index(op.f("ix_change_approval_requests_status"), table_name="change_approval_requests")
    op.drop_index(op.f("ix_change_approval_requests_scope"), table_name="change_approval_requests")
    op.drop_index(op.f("ix_change_approval_requests_requester_id"), table_name="change_approval_requests")
    op.drop_table("change_approval_requests")

    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("title")

    with op.batch_alter_table("staff_profiles") as batch_op:
        batch_op.drop_column("permissions_json")
        batch_op.drop_column("custom_role_title")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("last_login_at")
        batch_op.drop_column("phone_verified")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS uq_users_platform_email")
        op.execute("DROP INDEX IF EXISTS uq_users_platform_phone")
        op.drop_constraint("uq_users_tenant_email", "users", type_="unique")
        op.drop_constraint("uq_users_tenant_phone", "users", type_="unique")
        op.drop_index("ix_users_email", table_name="users")
        op.drop_index("ix_users_phone", table_name="users")
        op.create_index("ix_users_phone", "users", ["phone"], unique=True)
        op.create_unique_constraint("users_email_key", "users", ["email"])
    else:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_constraint("uq_users_tenant_email", type_="unique")
            batch_op.drop_constraint("uq_users_tenant_phone", type_="unique")
            batch_op.drop_index("ix_users_email")
            batch_op.drop_index("ix_users_phone")
            batch_op.create_index("ix_users_phone", ["phone"], unique=True)
