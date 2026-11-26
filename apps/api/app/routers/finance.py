import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, require_roles
from app.models.accounting import AccountType, ChartOfAccount, Invoice, JournalEntry, JournalLine, PaymentMilestone
from app.models.events import Event
from app.models.users import StaffRole, User, UserType
from app.services.accounting_service import DoubleEntryService

router = APIRouter(prefix="/api/v1/finance", tags=["Double-Entry Accounting & Finance"])


class CreateAccountBody(BaseModel):
    code: str
    name_ar: str
    name_en: str
    account_type: AccountType


class JournalLineInput(BaseModel):
    account_id: uuid.UUID
    debit: Decimal = Decimal("0.00")
    credit: Decimal = Decimal("0.00")
    memo: Optional[str] = None


class PostJournalRequest(BaseModel):
    reference: str
    description: str
    event_id: Optional[uuid.UUID] = None
    lines: list[JournalLineInput]


class VerifyMilestoneBody(BaseModel):
    payment_method: str
    is_security_deposit: bool = False


@router.get("/accounts")
async def list_chart_of_accounts(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (
        await db.execute(
            select(ChartOfAccount)
            .where(ChartOfAccount.tenant_id == auth.tenant_id)
            .order_by(ChartOfAccount.code.asc())
        )
    ).scalars().all()
    return [
        {
            "id": str(r.id),
            "code": r.code,
            "name_ar": r.name_ar,
            "name_en": r.name_en,
            "account_type": r.account_type.value,
            "is_system": r.is_system,
            "lifecycle": r.lifecycle.value,
        }
        for r in rows
    ]


@router.post("/accounts")
async def create_account(
    body: CreateAccountBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    existing = (
        await db.execute(
            select(ChartOfAccount).where(
                ChartOfAccount.tenant_id == auth.tenant_id,
                ChartOfAccount.code == body.code.strip(),
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Account code already exists")
    acc = ChartOfAccount(
        tenant_id=auth.tenant_id,
        code=body.code.strip(),
        name_ar=body.name_ar.strip(),
        name_en=body.name_en.strip(),
        account_type=body.account_type,
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return {
        "id": str(acc.id),
        "code": acc.code,
        "name_ar": acc.name_ar,
        "name_en": acc.name_en,
        "account_type": acc.account_type.value,
        "is_system": acc.is_system,
        "lifecycle": acc.lifecycle.value,
    }


@router.get("/journal-entries")
async def list_journal_entries(
    limit: int = Query(default=50, le=200),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    entries = (
        await db.execute(
            select(JournalEntry)
            .where(JournalEntry.tenant_id == auth.tenant_id)
            .order_by(JournalEntry.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    accounts = {
        a.id: a
        for a in (
            await db.execute(select(ChartOfAccount).where(ChartOfAccount.tenant_id == auth.tenant_id))
        )
        .scalars()
        .all()
    }
    out = []
    for e in entries:
        lines = (
            await db.execute(
                select(JournalLine).where(
                    JournalLine.journal_entry_id == e.id,
                    JournalLine.tenant_id == auth.tenant_id,
                )
            )
        ).scalars().all()
        total_d = sum((Decimal(str(l.debit)) for l in lines), Decimal("0.00"))
        total_c = sum((Decimal(str(l.credit)) for l in lines), Decimal("0.00"))
        out.append(
            {
                "id": str(e.id),
                "entry_number": e.entry_number,
                "entry_date": e.entry_date.isoformat(),
                "reference": e.reference,
                "description": e.description,
                "event_id": str(e.event_id) if e.event_id else None,
                "status": e.status,
                "total_debit": float(total_d),
                "total_credit": float(total_c),
                "lines": [
                    {
                        "account_id": str(l.account_id),
                        "account_code": accounts[l.account_id].code if l.account_id in accounts else "",
                        "account_name_ar": accounts[l.account_id].name_ar if l.account_id in accounts else "",
                        "account_name_en": accounts[l.account_id].name_en if l.account_id in accounts else "",
                        "debit": float(l.debit),
                        "credit": float(l.credit),
                        "memo": l.memo,
                    }
                    for l in lines
                ],
            }
        )
    return out


@router.post("/journal-entries")
async def post_journal_entry(
    body: PostJournalRequest,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    entry = await DoubleEntryService.post_balanced_entry(
        db=db,
        tenant_id=auth.tenant_id,
        created_by_id=auth.user.id,
        reference=body.reference,
        description=body.description,
        event_id=body.event_id,
        lines=[l.model_dump() for l in body.lines],
    )
    return {"id": str(entry.id), "entry_number": entry.entry_number, "status": entry.status}


@router.get("/trial-balance")
async def get_trial_balance(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_trial_balance(db, auth.tenant_id)


@router.get("/invoices")
async def list_invoices(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    invoices = (
        await db.execute(
            select(Invoice).where(Invoice.tenant_id == auth.tenant_id).order_by(Invoice.created_at.desc())
        )
    ).scalars().all()
    events = {
        e.id: e for e in (await db.execute(select(Event).where(Event.tenant_id == auth.tenant_id))).scalars().all()
    }
    users = {
        u.id: u for u in (await db.execute(select(User).where(User.tenant_id == auth.tenant_id))).scalars().all()
    }
    out = []
    for inv in invoices:
        ev = events.get(inv.event_id)
        client = users.get(ev.primary_client_id) if ev else None
        milestones = (
            await db.execute(
                select(PaymentMilestone)
                .where(PaymentMilestone.invoice_id == inv.id, PaymentMilestone.tenant_id == auth.tenant_id)
                .order_by(PaymentMilestone.due_date.asc())
            )
        ).scalars().all()
        paid_amount = sum((Decimal(str(m.paid_amount)) for m in milestones), Decimal("0.00"))
        out.append(
            {
                "id": str(inv.id),
                "invoice_number": inv.invoice_number,
                "event_id": str(inv.event_id),
                "event_code": ev.event_code if ev else "",
                "client_name": client.full_name if client else "",
                "total_amount": float(inv.total_amount),
                "paid_amount": float(paid_amount),
                "security_deposit_amount": float(inv.security_deposit_amount),
                "deposit_status": inv.deposit_status.value,
                "status": inv.status.value,
                "milestones": [
                    {
                        "id": str(m.id),
                        "title": m.title,
                        "amount_due": float(m.amount_due),
                        "due_date": m.due_date.isoformat(),
                        "paid_amount": float(m.paid_amount),
                        "payment_method": m.payment_method,
                        "receipt_url": m.receipt_url,
                        "status": m.status,
                    }
                    for m in milestones
                ],
            }
        )
    return out


@router.post("/milestones/{milestone_id}/verify")
async def verify_milestone_payment(
    milestone_id: uuid.UUID,
    body: VerifyMilestoneBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.verify_milestone_payment(
        db=db,
        tenant_id=auth.tenant_id,
        user_id=auth.user.id,
        milestone_id=milestone_id,
        payment_method=body.payment_method,
        is_security_deposit=body.is_security_deposit,
    )


@router.get("/events/{event_id}/pnl")
async def get_event_pnl(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_event_pnl(db, auth.tenant_id, event_id)
