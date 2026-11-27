import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, require_roles
from app.models.accounting import (
    AccountingConfig,
    AccountingPeriod,
    AccountType,
    ChartOfAccount,
    DepositStatus,
    EventExpense,
    FiscalYear,
    Invoice,
    JournalEntry,
    JournalLine,
    NormalBalance,
    PaymentMilestone,
    PeriodStatus,
    default_normal_balance,
)
from app.models.base import RecordLifecycle
from app.models.events import AuditLog, Event
from app.models.events_extensions import DamageInspection, InspectionStatus
from app.models.users import StaffRole, User, UserType
from app.services.accounting_service import DoubleEntryService

router = APIRouter(prefix="/api/v1", tags=["Double-Entry Accounting & Finance"])


class CreateAccountBody(BaseModel):
    code: str
    name_ar: str
    name_en: str
    account_type: AccountType
    normal_balance: Optional[NormalBalance] = None
    parent_id: Optional[uuid.UUID] = None
    is_control_account: bool = False


class PatchAccountBody(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    lifecycle: Optional[RecordLifecycle] = None


class JournalLineInput(BaseModel):
    account_id: uuid.UUID
    debit: Decimal = Field(default=Decimal("0.00"), ge=0)
    credit: Decimal = Field(default=Decimal("0.00"), ge=0)
    memo: Optional[str] = None


class PostJournalRequest(BaseModel):
    reference: str
    description: str
    event_id: Optional[uuid.UUID] = None
    entry_date: Optional[datetime] = None
    idempotency_key: Optional[str] = None
    lines: list[JournalLineInput]


class ReverseJournalBody(BaseModel):
    reason: Optional[str] = None


class VerifyMilestoneBody(BaseModel):
    payment_method: str
    is_security_deposit: bool = False
    reference: str = "Verified Transfer"


class CreateFiscalYearBody(BaseModel):
    year: int = Field(..., ge=2000, le=2100)


class PatchPeriodBody(BaseModel):
    status: PeriodStatus


class RefundDepositBody(BaseModel):
    payment_method: str = "KURAIMI_BANK"
    reference: str = "Security Deposit Refund"


class CreateEventExpenseBody(BaseModel):
    category: str = Field(..., min_length=2, max_length=80)
    description: str = Field(..., min_length=2)
    amount: Decimal = Field(..., gt=0)
    account_id: Optional[uuid.UUID] = None
    payment_method: str = "CASH"


@router.get("/finance/accounts")
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
            "normal_balance": (r.normal_balance or default_normal_balance(r.account_type)).value,
            "parent_id": str(r.parent_id) if r.parent_id else None,
            "is_control_account": r.is_control_account,
            "is_system": r.is_system,
            "lifecycle": r.lifecycle.value,
        }
        for r in rows
    ]


@router.post("/finance/accounts")
async def create_account(
    body: CreateAccountBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    clean_code = body.code.strip()
    existing = (
        await db.execute(
            select(ChartOfAccount).where(
                ChartOfAccount.tenant_id == auth.tenant_id,
                ChartOfAccount.code == clean_code,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Account code already exists")
    if body.parent_id:
        parent = (
            await db.execute(
                select(ChartOfAccount.id).where(
                    ChartOfAccount.id == body.parent_id,
                    ChartOfAccount.tenant_id == auth.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent account not found in tenant")

    acc = ChartOfAccount(
        tenant_id=auth.tenant_id,
        code=clean_code,
        name_ar=body.name_ar.strip(),
        name_en=body.name_en.strip(),
        account_type=body.account_type,
        normal_balance=body.normal_balance or default_normal_balance(body.account_type),
        parent_id=body.parent_id,
        is_control_account=body.is_control_account,
    )
    db.add(acc)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="COA_ACCOUNT_CREATED",
            new_value={"code": acc.code, "account_type": acc.account_type.value},
        )
    )
    await db.commit()
    await db.refresh(acc)
    return {
        "id": str(acc.id),
        "code": acc.code,
        "name_ar": acc.name_ar,
        "name_en": acc.name_en,
        "account_type": acc.account_type.value,
        "normal_balance": acc.normal_balance.value,
        "parent_id": str(acc.parent_id) if acc.parent_id else None,
        "is_control_account": acc.is_control_account,
        "is_system": acc.is_system,
        "lifecycle": acc.lifecycle.value,
    }


@router.patch("/finance/accounts/{account_id}")
async def update_account(
    account_id: uuid.UUID,
    body: PatchAccountBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    acc = (
        await db.execute(
            select(ChartOfAccount).where(
                ChartOfAccount.id == account_id,
                ChartOfAccount.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    if body.lifecycle and body.lifecycle != RecordLifecycle.ACTIVE and acc.is_system:
        raise HTTPException(status_code=400, detail="Cannot deactivate system account")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(acc, field, val.strip() if isinstance(val, str) else val)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="COA_ACCOUNT_UPDATED",
            new_value={"account_id": str(acc.id), "code": acc.code, **body.model_dump(exclude_none=True, mode="json")},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "id": str(acc.id)}


@router.get("/finance/accounts/{account_id}/ledger")
async def get_account_ledger(
    account_id: uuid.UUID,
    from_date: Optional[datetime] = Query(default=None),
    to_date: Optional[datetime] = Query(default=None),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_account_ledger(db, auth.tenant_id, account_id, from_date, to_date)


@router.get("/finance/fiscal-years")
async def list_fiscal_years(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    years = (
        await db.execute(
            select(FiscalYear)
            .where(FiscalYear.tenant_id == auth.tenant_id)
            .order_by(FiscalYear.year_label.desc())
        )
    ).scalars().all()
    periods = (
        await db.execute(
            select(AccountingPeriod)
            .where(AccountingPeriod.tenant_id == auth.tenant_id)
            .order_by(AccountingPeriod.period_number.asc())
        )
    ).scalars().all()
    by_fy: dict[uuid.UUID, list[AccountingPeriod]] = {}
    for p in periods:
        by_fy.setdefault(p.fiscal_year_id, []).append(p)
    return [
        {
            "id": str(fy.id),
            "year_label": fy.year_label,
            "start_date": fy.start_date.isoformat(),
            "end_date": fy.end_date.isoformat(),
            "status": fy.status.value,
            "periods": [
                {
                    "id": str(p.id),
                    "period_number": p.period_number,
                    "name": p.name,
                    "start_date": p.start_date.isoformat(),
                    "end_date": p.end_date.isoformat(),
                    "status": p.status.value,
                }
                for p in by_fy.get(fy.id, [])
            ],
        }
        for fy in years
    ]


@router.post("/finance/fiscal-years")
async def create_fiscal_year(
    body: CreateFiscalYearBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    fy = await DoubleEntryService.ensure_fiscal_year_with_periods(db, auth.tenant_id, body.year)
    await db.commit()
    return {"id": str(fy.id), "year_label": fy.year_label, "status": fy.status.value}


@router.patch("/finance/periods/{period_id}")
async def update_accounting_period(
    period_id: uuid.UUID,
    body: PatchPeriodBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    period = (
        await db.execute(
            select(AccountingPeriod).where(
                AccountingPeriod.id == period_id,
                AccountingPeriod.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not period:
        raise HTTPException(status_code=404, detail="Accounting period not found")
    old_status = period.status.value
    period.status = body.status
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="ACCOUNTING_PERIOD_UPDATED",
            old_value={"period": period.name, "status": old_status},
            new_value={"period": period.name, "status": body.status.value},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "period_id": str(period.id), "period_status": period.status.value}


@router.get("/finance/journal-entries")
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
                "fiscal_period_id": str(e.fiscal_period_id) if e.fiscal_period_id else None,
                "reversed_entry_id": str(e.reversed_entry_id) if e.reversed_entry_id else None,
                "is_system_posting": e.is_system_posting,
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


@router.post("/finance/journal-entries")
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
        entry_date=body.entry_date,
        is_system_posting=False,
        idempotency_key=body.idempotency_key,
        lines=[l.model_dump() for l in body.lines],
    )
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=entry.event_id,
            actor_id=auth.user.id,
            action="MANUAL_JOURNAL_POSTED",
            new_value={"entry_id": str(entry.id), "entry_number": entry.entry_number, "reference": entry.reference},
        )
    )
    await db.commit()
    await db.refresh(entry)
    return {"id": str(entry.id), "entry_number": entry.entry_number, "status": entry.status}


@router.post("/finance/journal-entries/{entry_id}/reverse")
async def reverse_journal_entry(
    entry_id: uuid.UUID,
    body: ReverseJournalBody = ReverseJournalBody(),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.reverse_entry(db, auth.tenant_id, auth.user.id, entry_id, body.reason)


@router.get("/finance/trial-balance")
async def get_trial_balance(
    from_date: Optional[datetime] = Query(default=None),
    to_date: Optional[datetime] = Query(default=None),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_trial_balance(db, auth.tenant_id, from_date, to_date)


@router.get("/finance/statements")
async def get_financial_statements(
    from_date: Optional[datetime] = Query(default=None),
    to_date: Optional[datetime] = Query(default=None),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_financial_statements(db, auth.tenant_id, from_date, to_date)


@router.get("/finance/invoices")
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
        paid_amount = sum(
            (Decimal(str(m.paid_amount)) for m in milestones if not m.is_security_deposit),
            Decimal("0.00"),
        )
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
                        "is_security_deposit": m.is_security_deposit,
                        "status": m.status,
                    }
                    for m in milestones
                ],
            }
        )
    return out


@router.post("/finance/milestones/{milestone_id}/verify")
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


@router.get("/finance/events/{event_id}/pnl")
async def get_event_pnl(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_event_pnl(db, auth.tenant_id, event_id)


@router.post("/erp/finance/events/{event_id}/refund-deposit")
async def refund_security_deposit(
    event_id: uuid.UUID,
    body: RefundDepositBody = RefundDepositBody(),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    inv = (
        await db.execute(
            select(Invoice)
            .where(Invoice.event_id == event_id, Invoice.tenant_id == auth.tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found for event")
    if inv.deposit_status == DepositStatus.REFUNDED:
        raise HTTPException(status_code=409, detail="Security deposit already refunded")
    if inv.deposit_status == DepositStatus.UNPAID:
        raise HTTPException(status_code=400, detail="Security deposit has not been collected/held")

    insp = (
        await db.execute(
            select(DamageInspection).where(
                DamageInspection.event_id == event_id,
                DamageInspection.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    deduction = (
        Decimal(str(insp.deduction_amount))
        if insp and insp.status == InspectionStatus.DAMAGE_CLAIMED
        else Decimal("0.00")
    )
    refund_amt = max(Decimal("0.00"), Decimal(str(inv.security_deposit_amount)) - deduction).quantize(Decimal("0.01"))

    je_number: Optional[str] = None
    if refund_amt > Decimal("0.00"):
        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == auth.tenant_id))
        ).scalar_one_or_none()
        if not cfg or not cfg.security_deposit_liab_id:
            raise HTTPException(status_code=400, detail="AccountingConfig missing security deposit account")
        credit_acc = cfg.cash_account_id if body.payment_method.upper() == "CASH" else cfg.bank_account_id
        if not credit_acc:
            raise HTTPException(status_code=400, detail="AccountingConfig missing cash/bank account")

        je = await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=auth.tenant_id,
            created_by_id=auth.user.id,
            reference=f"DEP-REFUND-{inv.invoice_number} — {body.reference}",
            description=f"Refund security deposit ({body.payment_method}) for {inv.invoice_number}",
            event_id=event_id,
            is_system_posting=True,
            idempotency_key=f"DEP_REFUND:{inv.id}",
            lines=[
                {
                    "account_id": cfg.security_deposit_liab_id,
                    "debit": refund_amt,
                    "credit": Decimal("0.00"),
                    "memo": "Release security deposit liability 2100",
                },
                {
                    "account_id": credit_acc,
                    "debit": Decimal("0.00"),
                    "credit": refund_amt,
                    "memo": f"Refund paid via {body.payment_method}",
                },
            ],
        )
        je_number = je.entry_number

    inv.deposit_status = DepositStatus.REFUNDED
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="SECURITY_DEPOSIT_REFUNDED",
            new_value={"refund_amount": float(refund_amt), "journal_entry_number": je_number},
        )
    )
    await db.commit()
    return {
        "status": "REFUNDED",
        "deposit_status": inv.deposit_status.value,
        "refund_amount": float(refund_amt),
        "journal_entry_number": je_number,
    }


@router.get("/erp/finance/events/{event_id}/expenses")
async def list_event_expenses(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event.id).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    rows = (
        await db.execute(
            select(EventExpense)
            .where(EventExpense.event_id == event_id, EventExpense.tenant_id == auth.tenant_id)
            .order_by(EventExpense.created_at.desc())
        )
    ).scalars().all()
    return [
        {
            "id": str(e.id),
            "event_id": str(e.event_id),
            "category": e.category,
            "description": e.description,
            "amount": float(e.amount),
            "payment_method": e.payment_method,
            "account_id": str(e.account_id) if e.account_id else None,
            "journal_entry_id": str(e.journal_entry_id) if e.journal_entry_id else None,
            "created_at": e.created_at.isoformat(),
        }
        for e in rows
    ]


@router.post("/erp/finance/events/{event_id}/expenses")
async def create_event_expense(
    event_id: uuid.UUID,
    body: CreateEventExpenseBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE, StaffRole.OPS_MANAGER})
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    cfg = (
        await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

    cat_upper = body.category.strip().upper()
    exp_acc_id = body.account_id
    if not exp_acc_id:
        exp_acc_id = (
            cfg.catering_cogs_account_id
            if cat_upper in {"CATERING", "CATERING_COGS"}
            else (cfg.general_expense_account_id or cfg.catering_cogs_account_id)
        )
    credit_acc_id = cfg.cash_account_id if body.payment_method.upper() == "CASH" else cfg.bank_account_id
    if not exp_acc_id or not credit_acc_id:
        raise HTTPException(status_code=400, detail="AccountingConfig expense or cash/bank account missing")

    amt = Decimal(str(body.amount)).quantize(Decimal("0.01"))
    je = await DoubleEntryService.post_balanced_entry(
        db=db,
        tenant_id=auth.tenant_id,
        created_by_id=auth.user.id,
        reference=f"EXP-{ev.event_code}",
        description=f"Event expense ({cat_upper}): {body.description.strip()}",
        event_id=event_id,
        is_system_posting=True,
        lines=[
            {"account_id": exp_acc_id, "debit": amt, "credit": Decimal("0.00"), "memo": body.description.strip()},
            {"account_id": credit_acc_id, "debit": Decimal("0.00"), "credit": amt, "memo": f"Paid ({body.payment_method})"},
        ],
    )
    expense = EventExpense(
        tenant_id=auth.tenant_id,
        event_id=event_id,
        category=cat_upper,
        description=body.description.strip(),
        amount=amt,
        account_id=exp_acc_id,
        payment_method=body.payment_method.strip().upper(),
        journal_entry_id=je.id,
        recorded_by=auth.user.id,
    )
    db.add(expense)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="EVENT_EXPENSE_RECORDED",
            new_value={"category": cat_upper, "amount": float(amt), "journal_entry_number": je.entry_number},
        )
    )
    await db.commit()
    await db.refresh(expense)
    return {
        "id": str(expense.id),
        "category": expense.category,
        "description": expense.description,
        "amount": float(expense.amount),
        "journal_entry_id": str(je.id),
        "journal_entry_number": je.entry_number,
    }


@router.delete("/erp/finance/events/{event_id}/expenses/{expense_id}")
async def delete_event_expense(
    event_id: uuid.UUID,
    expense_id: uuid.UUID,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    expense = (
        await db.execute(
            select(EventExpense).where(
                EventExpense.id == expense_id,
                EventExpense.event_id == event_id,
                EventExpense.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Event expense not found")

    if expense.journal_entry_id:
        orig_je = (
            await db.execute(
                select(JournalEntry)
                .where(JournalEntry.id == expense.journal_entry_id, JournalEntry.tenant_id == auth.tenant_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if orig_je and orig_je.status == "POSTED":
            orig_lines = (
                await db.execute(
                    select(JournalLine).where(
                        JournalLine.journal_entry_id == orig_je.id,
                        JournalLine.tenant_id == auth.tenant_id,
                    )
                )
            ).scalars().all()
            if orig_lines:
                rev = await DoubleEntryService.post_balanced_entry(
                    db=db,
                    tenant_id=auth.tenant_id,
                    created_by_id=auth.user.id,
                    reference=f"REV-{orig_je.entry_number}",
                    description=f"Reversal of deleted expense {expense.description}",
                    event_id=event_id,
                    is_system_posting=True,
                    idempotency_key=f"REV:{orig_je.id}",
                    lines=[
                        {
                            "account_id": l.account_id,
                            "debit": Decimal(str(l.credit)),
                            "credit": Decimal(str(l.debit)),
                            "memo": f"Reversal of {orig_je.entry_number}",
                        }
                        for l in orig_lines
                    ],
                )
                rev.reversed_entry_id = orig_je.id
                orig_je.status = "REVERSED"

    await db.delete(expense)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="EVENT_EXPENSE_DELETED",
            old_value={"expense_id": str(expense_id), "amount": float(expense.amount)},
        )
    )
    await db.commit()
    return {"status": "DELETED"}
