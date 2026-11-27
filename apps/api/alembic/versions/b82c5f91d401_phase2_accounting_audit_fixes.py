"""phase2_accounting_audit_fixes

Revision ID: b82c5f91d401
Revises: a79d4cfabc65
Create Date: 2026-11-27 02:25:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "b82c5f91d401"
down_revision: Union[str, None] = "a79d4cfabc65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sequence_counters",
        sa.Column("doc_type", sa.String(length=20), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "doc_type", "year", name="uq_tenant_seq_doc_year"),
    )
    op.create_index(op.f("ix_sequence_counters_tenant_id"), "sequence_counters", ["tenant_id"], unique=False)

    op.create_table(
        "fiscal_years",
        sa.Column("year_label", sa.String(length=20), nullable=False),
        sa.Column("start_date", sa.DateTime(), nullable=False),
        sa.Column("end_date", sa.DateTime(), nullable=False),
        sa.Column("status", sa.Enum("OPEN", "LOCKED", "CLOSED", name="periodstatus"), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "year_label", name="uq_tenant_fiscal_year"),
    )
    op.create_index(op.f("ix_fiscal_years_tenant_id"), "fiscal_years", ["tenant_id"], unique=False)

    op.create_table(
        "accounting_periods",
        sa.Column("fiscal_year_id", sa.Uuid(), nullable=False),
        sa.Column("period_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("start_date", sa.DateTime(), nullable=False),
        sa.Column("end_date", sa.DateTime(), nullable=False),
        sa.Column("status", sa.Enum("OPEN", "LOCKED", "CLOSED", name="periodstatus"), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["fiscal_year_id"], ["fiscal_years.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "fiscal_year_id", "period_number", name="uq_tenant_fy_period"),
    )
    op.create_index(op.f("ix_accounting_periods_fiscal_year_id"), "accounting_periods", ["fiscal_year_id"], unique=False)
    op.create_index(op.f("ix_accounting_periods_tenant_id"), "accounting_periods", ["tenant_id"], unique=False)

    with op.batch_alter_table("chart_of_accounts") as batch_op:
        batch_op.add_column(
            sa.Column("normal_balance", sa.Enum("DEBIT", "CREDIT", name="normalbalance"), nullable=False, server_default="DEBIT")
        )
        batch_op.add_column(sa.Column("parent_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("is_control_account", sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table("accounting_configs") as batch_op:
        batch_op.add_column(sa.Column("damage_recovery_account_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("general_expense_account_id", sa.Uuid(), nullable=True))

    with op.batch_alter_table("journal_entries") as batch_op:
        batch_op.add_column(sa.Column("fiscal_period_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("reversed_entry_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("is_system_posting", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("idempotency_key", sa.String(length=120), nullable=True))
        batch_op.create_unique_constraint("uq_tenant_je_idempotency", ["tenant_id", "idempotency_key"])

    with op.batch_alter_table("payment_milestones") as batch_op:
        batch_op.add_column(sa.Column("is_security_deposit", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("upload_token_jti", sa.String(length=64), nullable=True))

    with op.batch_alter_table("event_expenses") as batch_op:
        batch_op.add_column(sa.Column("account_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("payment_method", sa.String(length=60), nullable=False, server_default="CASH"))
        batch_op.add_column(sa.Column("journal_entry_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("event_expenses") as batch_op:
        batch_op.drop_column("journal_entry_id")
        batch_op.drop_column("payment_method")
        batch_op.drop_column("account_id")

    with op.batch_alter_table("payment_milestones") as batch_op:
        batch_op.drop_column("upload_token_jti")
        batch_op.drop_column("is_security_deposit")

    with op.batch_alter_table("journal_entries") as batch_op:
        batch_op.drop_constraint("uq_tenant_je_idempotency", type_="unique")
        batch_op.drop_column("idempotency_key")
        batch_op.drop_column("is_system_posting")
        batch_op.drop_column("reversed_entry_id")
        batch_op.drop_column("fiscal_period_id")

    with op.batch_alter_table("accounting_configs") as batch_op:
        batch_op.drop_column("general_expense_account_id")
        batch_op.drop_column("damage_recovery_account_id")

    with op.batch_alter_table("chart_of_accounts") as batch_op:
        batch_op.drop_column("is_control_account")
        batch_op.drop_column("parent_id")
        batch_op.drop_column("normal_balance")

    op.drop_index(op.f("ix_accounting_periods_tenant_id"), table_name="accounting_periods")
    op.drop_index(op.f("ix_accounting_periods_fiscal_year_id"), table_name="accounting_periods")
    op.drop_table("accounting_periods")
    op.drop_index(op.f("ix_fiscal_years_tenant_id"), table_name="fiscal_years")
    op.drop_table("fiscal_years")
    op.drop_index(op.f("ix_sequence_counters_tenant_id"), table_name="sequence_counters")
    op.drop_table("sequence_counters")
