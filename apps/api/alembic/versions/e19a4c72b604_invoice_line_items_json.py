"""invoice_line_items_json

Revision ID: e19a4c72b604
Revises: d84f2b91c503
Create Date: 2026-11-27 17:02:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "e19a4c72b604"
down_revision: Union[str, None] = "d84f2b91c503"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("line_items_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("invoices", "line_items_json")
