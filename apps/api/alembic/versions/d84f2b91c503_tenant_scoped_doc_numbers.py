"""tenant_scoped_doc_numbers

Revision ID: d84f2b91c503
Revises: c93e7a14f802
Create Date: 2026-11-27 16:25:00.000000
"""
from typing import Sequence, Union
from alembic import op


revision: str = "d84f2b91c503"
down_revision: Union[str, None] = "c93e7a14f802"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_constraint("events_event_code_key", "events", type_="unique")
        op.create_index("ix_events_event_code", "events", ["event_code"], unique=False)
        op.create_unique_constraint("uq_events_tenant_code", "events", ["tenant_id", "event_code"])

        op.drop_constraint("invoices_invoice_number_key", "invoices", type_="unique")
        op.create_index("ix_invoices_invoice_number", "invoices", ["invoice_number"], unique=False)
        op.create_unique_constraint("uq_invoices_tenant_number", "invoices", ["tenant_id", "invoice_number"])

        op.drop_constraint("event_contracts_contract_number_key", "event_contracts", type_="unique")
        op.create_index("ix_event_contracts_contract_number", "event_contracts", ["contract_number"], unique=False)
        op.create_unique_constraint("uq_contracts_tenant_number", "event_contracts", ["tenant_id", "contract_number"])
    else:
        with op.batch_alter_table("events") as batch_op:
            batch_op.create_unique_constraint("uq_events_tenant_code", ["tenant_id", "event_code"])
        with op.batch_alter_table("invoices") as batch_op:
            batch_op.create_unique_constraint("uq_invoices_tenant_number", ["tenant_id", "invoice_number"])
        with op.batch_alter_table("event_contracts") as batch_op:
            batch_op.create_unique_constraint("uq_contracts_tenant_number", ["tenant_id", "contract_number"])


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_constraint("uq_contracts_tenant_number", "event_contracts", type_="unique")
        op.drop_index("ix_event_contracts_contract_number", table_name="event_contracts")
        op.create_unique_constraint("event_contracts_contract_number_key", "event_contracts", ["contract_number"])

        op.drop_constraint("uq_invoices_tenant_number", "invoices", type_="unique")
        op.drop_index("ix_invoices_invoice_number", table_name="invoices")
        op.create_unique_constraint("invoices_invoice_number_key", "invoices", ["invoice_number"])

        op.drop_constraint("uq_events_tenant_code", "events", type_="unique")
        op.drop_index("ix_events_event_code", table_name="events")
        op.create_unique_constraint("events_event_code_key", "events", ["event_code"])
    else:
        with op.batch_alter_table("event_contracts") as batch_op:
            batch_op.drop_constraint("uq_contracts_tenant_number", type_="unique")
        with op.batch_alter_table("invoices") as batch_op:
            batch_op.drop_constraint("uq_invoices_tenant_number", type_="unique")
        with op.batch_alter_table("events") as batch_op:
            batch_op.drop_constraint("uq_events_tenant_code", type_="unique")
