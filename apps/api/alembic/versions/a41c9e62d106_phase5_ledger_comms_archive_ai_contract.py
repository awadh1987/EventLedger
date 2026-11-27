"""Phase 5: ledger discount/return, deposit refund voucher, AI contract metadata, notification logs, client archival."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a41c9e62d106"
down_revision: Union[str, Sequence[str], None] = "f30b8d51c905"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name: str, col_name: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == col_name for c in insp.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()

    # 1. ClientProfile archiving fields
    if not _column_exists(bind, "client_profiles", "is_archived"):
        op.add_column(
            "client_profiles",
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if not _column_exists(bind, "client_profiles", "archived_at"):
        op.add_column("client_profiles", sa.Column("archived_at", sa.DateTime(), nullable=True))
    if not _column_exists(bind, "client_profiles", "archived_by_id"):
        op.add_column("client_profiles", sa.Column("archived_by_id", sa.Uuid(), nullable=True))
    if not _column_exists(bind, "client_profiles", "archive_reason"):
        op.add_column("client_profiles", sa.Column("archive_reason", sa.Text(), nullable=True))

    # 2. Invoice discount_percent + deposit refund voucher metadata
    if not _column_exists(bind, "invoices", "discount_percent"):
        op.add_column(
            "invoices",
            sa.Column("discount_percent", sa.Numeric(5, 2), nullable=False, server_default=sa.text("0.00")),
        )
    if not _column_exists(bind, "invoices", "refund_voucher_number"):
        op.add_column("invoices", sa.Column("refund_voucher_number", sa.String(length=60), nullable=True))
    if not _column_exists(bind, "invoices", "refund_payment_method"):
        op.add_column("invoices", sa.Column("refund_payment_method", sa.String(length=60), nullable=True))
    if not _column_exists(bind, "invoices", "refund_reference"):
        op.add_column("invoices", sa.Column("refund_reference", sa.String(length=160), nullable=True))
    if not _column_exists(bind, "invoices", "refund_journal_entry_id"):
        op.add_column("invoices", sa.Column("refund_journal_entry_id", sa.Uuid(), nullable=True))

    # 3. PaymentMilestone reviewer remarks
    if not _column_exists(bind, "payment_milestones", "reviewer_remarks"):
        op.add_column("payment_milestones", sa.Column("reviewer_remarks", sa.Text(), nullable=True))

    # 4. EventContract AI & bidirectional review metadata
    if not _column_exists(bind, "event_contracts", "staff_countersigned_by_id"):
        op.add_column("event_contracts", sa.Column("staff_countersigned_by_id", sa.Uuid(), nullable=True))
    if not _column_exists(bind, "event_contracts", "status"):
        op.add_column(
            "event_contracts",
            sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'DRAFT'")),
        )
    if not _column_exists(bind, "event_contracts", "remarks"):
        op.add_column("event_contracts", sa.Column("remarks", sa.Text(), nullable=True))
    if not _column_exists(bind, "event_contracts", "amendment_remarks"):
        op.add_column("event_contracts", sa.Column("amendment_remarks", sa.Text(), nullable=True))
    if not _column_exists(bind, "event_contracts", "ai_metadata_json"):
        op.add_column("event_contracts", sa.Column("ai_metadata_json", sa.JSON(), nullable=True))

    # 5. NotificationLog table
    insp = sa.inspect(bind)
    if not insp.has_table("notification_logs"):
        op.create_table(
            "notification_logs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="SET NULL"), nullable=True),
            sa.Column("recipient_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("recipient_address", sa.String(length=120), nullable=True),
            sa.Column("channel", sa.String(length=30), nullable=False, server_default=sa.text("'IN_APP'")),
            sa.Column("category", sa.String(length=50), nullable=False, server_default=sa.text("'STATUS_UPDATE'")),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("delivery_status", sa.String(length=40), nullable=False, server_default=sa.text("'DELIVERED'")),
            sa.Column("provider_message_id", sa.String(length=120), nullable=True),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_notification_logs_tenant_id", "notification_logs", ["tenant_id"])
        op.create_index("ix_notification_logs_event_id", "notification_logs", ["event_id"])
        op.create_index("ix_notification_logs_recipient_user_id", "notification_logs", ["recipient_user_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_logs_recipient_user_id", table_name="notification_logs")
    op.drop_index("ix_notification_logs_event_id", table_name="notification_logs")
    op.drop_index("ix_notification_logs_tenant_id", table_name="notification_logs")
    op.drop_table("notification_logs")
    for col in ("ai_metadata_json", "amendment_remarks", "remarks", "status", "staff_countersigned_by_id"):
        op.drop_column("event_contracts", col)
    op.drop_column("payment_milestones", "reviewer_remarks")
    for col in (
        "refund_journal_entry_id",
        "refund_reference",
        "refund_payment_method",
        "refund_voucher_number",
        "discount_percent",
    ):
        op.drop_column("invoices", col)
    for col in ("archive_reason", "archived_by_id", "archived_at", "is_archived"):
        op.drop_column("client_profiles", col)
