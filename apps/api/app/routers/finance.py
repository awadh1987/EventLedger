import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import ChartOfAccount, JournalEntry
from app.services.accounting_service import DoubleEntryService

router = APIRouter(prefix="/api/v1/finance", tags=["Double-Entry Accounting & Finance"])


class JournalLineInput(BaseModel):
    account_id: uuid.UUID
    debit: Decimal = Decimal("0.00")
    credit: Decimal = Decimal("0.00")
    memo: str | None = None


class PostJournalRequest(BaseModel):
    created_by_id: uuid.UUID
    reference: str
    description: str
    event_id: uuid.UUID | None = None
    lines: list[JournalLineInput]


@router.get("/accounts")
async def list_chart_of_accounts(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (await db.execute(select(ChartOfAccount).where(ChartOfAccount.tenant_id == tenant.id).order_by(ChartOfAccount.code.asc()))).scalars().all()
    return [{"id": str(r.id), "code": r.code, "name_ar": r.name_ar, "name_en": r.name_en, "account_type": r.account_type.value} for r in rows]


@router.post("/journal-entries")
async def post_journal_entry(body: PostJournalRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    entry = await DoubleEntryService.post_balanced_entry(
        db=db,
        tenant_id=tenant.id,
        created_by_id=body.created_by_id,
        reference=body.reference,
        description=body.description,
        event_id=body.event_id,
        lines=[l.model_dump() for l in body.lines],
    )
    return {"id": str(entry.id), "entry_number": entry.entry_number, "status": entry.status}
