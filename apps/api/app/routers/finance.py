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
    InvoiceStatus,
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
from app.models.tenant import Tenant
from app.models.users import StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService
from app.services.availability_service import AvailabilityService
from app.services.comms_service import CommsService

router = APIRouter(prefix="/api/v1", tags=["Double-Entry Accounting & Finance"])
FINANCE_WRITE_ROLES = {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.FINANCE}


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
    remarks: Optional[str] = None


class ReturnMilestoneBody(BaseModel):
    remarks: str = Field(..., min_length=2, max_length=1000)


class AdjustInvoiceDiscountBody(BaseModel):
    discount_percent: Decimal = Field(..., ge=0, le=100)
    remarks: Optional[str] = Field(default=None, max_length=500)


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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
    halls = {
        h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == auth.tenant_id))).scalars().all()
    }
    active_halls = [h for h in halls.values() if h.lifecycle == RecordLifecycle.ACTIVE]
    out = []
    for inv in invoices:
        ev = events.get(inv.event_id)
        client = users.get(ev.primary_client_id) if ev else None
        ev_hids = AvailabilityService.extract_booked_hall_ids(ev, inv.line_items_json, active_halls) if ev else []
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
                "event_title": ev.title if ev else None,
                "hall_ids": [str(hid) for hid in ev_hids],
                "hall_name": " + ".join(halls[hid].name for hid in ev_hids if hid in halls) or None,
                "hall_name_ar": " + ".join(halls[hid].name_ar for hid in ev_hids if hid in halls) or None,
                "client_name": client.full_name if client else "",
                "client_phone": client.phone if client else None,
                "subtotal": float(inv.subtotal),
                "discount_percent": float(getattr(inv, "discount_percent", 0) or 0),
                "discount_amount": float(inv.discount_amount),
                "tax_amount": float(inv.tax_amount),
                "total_amount": float(inv.total_amount),
                "paid_amount": float(paid_amount),
                "security_deposit_amount": float(inv.security_deposit_amount),
                "deposit_status": inv.deposit_status.value,
                "refund_voucher_number": getattr(inv, "refund_voucher_number", None),
                "refund_payment_method": getattr(inv, "refund_payment_method", None),
                "refund_reference": getattr(inv, "refund_reference", None),
                "status": inv.status.value,
                "line_items": inv.line_items_json,
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
                        "reviewer_remarks": getattr(m, "reviewer_remarks", None),
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
        reference=body.reference,
    )


@router.patch("/erp/finance/milestones/{milestone_id}/return")
async def return_milestone_for_amendment(
    milestone_id: uuid.UUID,
    body: ReturnMilestoneBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ms = (
        await db.execute(
            select(PaymentMilestone).where(
                PaymentMilestone.id == milestone_id,
                PaymentMilestone.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")
    if ms.status == "PAID":
        raise HTTPException(status_code=400, detail="Verified PAID milestones cannot be returned for amendment")

    inv = (
        await db.execute(select(Invoice).where(Invoice.id == ms.invoice_id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    ev = (
        (await db.execute(select(Event).where(Event.id == inv.event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
        if inv
        else None
    )
    client = (
        (await db.execute(select(User).where(User.id == ev.primary_client_id, User.tenant_id == auth.tenant_id))).scalar_one_or_none()
        if ev
        else None
    )

    ms.status = "RETURNED_FOR_AMENDMENT"
    ms.reviewer_remarks = body.remarks.strip()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id if ev else None,
            actor_id=auth.user.id,
            action="MILESTONE_RETURNED_FOR_AMENDMENT",
            new_value={"milestone_id": str(ms.id), "title": ms.title, "remarks": ms.reviewer_remarks},
        )
    )
    if client:
        await CommsService.notify_and_whatsapp(
            db,
            auth.tenant_id,
            title=f"إيصال دفعة يحتاج تعديل · {ev.event_code if ev else ''}",
            content=f"يرجى إعادة رفع إيصال ({ms.title}): {ms.reviewer_remarks}",
            category="AMENDMENT_REQUEST",
            event_id=ev.id if ev else None,
            recipient_user_id=client.id,
            recipient_phone=client.phone,
            send_whatsapp=True,
        )
    await db.commit()
    return {
        "status": ms.status,
        "milestone_id": str(ms.id),
        "reviewer_remarks": ms.reviewer_remarks,
    }


@router.patch("/erp/finance/invoices/{invoice_id}/discount")
async def adjust_invoice_discount_percent(
    invoice_id: uuid.UUID,
    body: AdjustInvoiceDiscountBody,
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            FINANCE_WRITE_ROLES | {StaffRole.SALES_MANAGER, StaffRole.OPS_MANAGER},
        )
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    pct = Decimal(str(body.discount_percent)).quantize(Decimal("0.01"))
    if auth.staff_role not in FINANCE_WRITE_ROLES and auth.user.user_type != UserType.SUPER_ADMIN:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == auth.user.id))).scalar_one_or_none()
        cap = Decimal(str(sp.max_discount_percent)) if sp else Decimal("0.00")
        if pct > cap:
            raise HTTPException(
                status_code=403,
                detail=f"Requested discount {pct}% exceeds your staff role max cap ({cap}%)",
            )

    inv = (
        await db.execute(
            select(Invoice)
            .where(Invoice.id == invoice_id, Invoice.tenant_id == auth.tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == InvoiceStatus.VOIDED:
        raise HTTPException(status_code=400, detail="Cannot discount a VOIDED invoice")

    ev = (await db.execute(select(Event).where(Event.id == inv.event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one()

    old_discount = Decimal(str(inv.discount_amount)).quantize(Decimal("0.01"))
    old_tax = Decimal(str(inv.tax_amount)).quantize(Decimal("0.01"))
    old_total = Decimal(str(inv.total_amount)).quantize(Decimal("0.01"))
    subtotal = Decimal(str(inv.subtotal)).quantize(Decimal("0.01"))

    # Note: In event booking, subtotal stores gross or net depending on creation. Preserve original gross base = subtotal + old_discount if discount was already subtracted from subtotal, or if subtotal - old_discount matches taxable base.
    # Check relationship between old_total, subtotal, old_discount, old_tax cleanly:
    if abs((subtotal - old_discount + old_tax) - old_total) <= Decimal("0.05"):
        gross_base = subtotal
    else:
        gross_base = (subtotal + old_discount).quantize(Decimal("0.01"))

    old_taxable = max(Decimal("0.00"), gross_base - old_discount)
    if old_tax > Decimal("0.00") and old_taxable > Decimal("0.00"):
        eff_tax_rate = old_tax / old_taxable
    elif old_tax > Decimal("0.00"):
        eff_tax_rate = Decimal(str(tenant.tax_rate)) / Decimal("100.00")
    else:
        eff_tax_rate = Decimal("0.00")

    new_discount = (gross_base * (pct / Decimal("100.00"))).quantize(Decimal("0.01"))
    new_taxable = max(Decimal("0.00"), gross_base - new_discount).quantize(Decimal("0.01"))
    new_tax = (new_taxable * eff_tax_rate).quantize(Decimal("0.01"))
    new_total = (new_taxable + new_tax).quantize(Decimal("0.01"))

    milestones = (
        await db.execute(
            select(PaymentMilestone)
            .where(
                PaymentMilestone.invoice_id == inv.id,
                PaymentMilestone.tenant_id == auth.tenant_id,
                PaymentMilestone.is_security_deposit == False,  # noqa: E712
            )
            .order_by(PaymentMilestone.due_date.asc())
        )
    ).scalars().all()
    already_paid = sum((Decimal(str(m.paid_amount)) for m in milestones), Decimal("0.00"))
    if new_total < already_paid:
        raise HTTPException(
            status_code=400,
            detail=f"Discounted total ({new_total}) cannot be less than already collected payments ({already_paid})",
        )

    total_delta = (new_total - old_total).quantize(Decimal("0.01"))
    tax_delta = (new_tax - old_tax).quantize(Decimal("0.01"))
    net_delta = (total_delta - tax_delta).quantize(Decimal("0.01"))

    inv.subtotal = gross_base
    inv.discount_percent = pct
    inv.discount_amount = new_discount
    inv.tax_amount = new_tax
    inv.total_amount = new_total
    if new_total == already_paid and new_total > Decimal("0.00"):
        inv.status = InvoiceStatus.PAID

    unpaid_ms = [m for m in milestones if m.status != "PAID"]
    if unpaid_ms:
        target_remaining = (new_total - already_paid).quantize(Decimal("0.01"))
        if len(unpaid_ms) == 1:
            unpaid_ms[0].amount_due = target_remaining
        else:
            share = (target_remaining / Decimal(len(unpaid_ms))).quantize(Decimal("0.01"))
            running = Decimal("0.00")
            for idx, m in enumerate(unpaid_ms):
                if idx == len(unpaid_ms) - 1:
                    m.amount_due = (target_remaining - running).quantize(Decimal("0.01"))
                else:
                    m.amount_due = share
                    running += share

    je_number: Optional[str] = None
    if total_delta != Decimal("0.00"):
        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == auth.tenant_id))
        ).scalar_one_or_none()
        if cfg and cfg.accounts_receivable_id and cfg.hall_revenue_account_id:
            lines: list[dict] = []
            if total_delta < Decimal("0.00"):
                ar_red = abs(total_delta)
                rev_red = abs(net_delta)
                tax_red = abs(tax_delta)
                if rev_red > Decimal("0.00"):
                    lines.append({"account_id": cfg.hall_revenue_account_id, "debit": rev_red, "credit": Decimal("0.00"), "memo": f"Invoice discount {pct}%"})
                if tax_red > Decimal("0.00") and cfg.tax_payable_account_id:
                    lines.append({"account_id": cfg.tax_payable_account_id, "debit": tax_red, "credit": Decimal("0.00"), "memo": "Tax adjustment on discount"})
                elif tax_red > Decimal("0.00"):
                    lines.append({"account_id": cfg.hall_revenue_account_id, "debit": tax_red, "credit": Decimal("0.00"), "memo": "Tax adjustment on discount"})
                lines.append({"account_id": cfg.accounts_receivable_id, "debit": Decimal("0.00"), "credit": ar_red, "memo": f"AR discount {pct}%"})
            else:
                ar_inc = total_delta
                rev_inc = net_delta
                tax_inc = tax_delta
                lines.append({"account_id": cfg.accounts_receivable_id, "debit": ar_inc, "credit": Decimal("0.00"), "memo": f"AR discount revision {pct}%"})
                if rev_inc > Decimal("0.00"):
                    lines.append({"account_id": cfg.hall_revenue_account_id, "debit": Decimal("0.00"), "credit": rev_inc, "memo": "Revenue adjustment"})
                if tax_inc > Decimal("0.00") and cfg.tax_payable_account_id:
                    lines.append({"account_id": cfg.tax_payable_account_id, "debit": Decimal("0.00"), "credit": tax_inc, "memo": "Tax adjustment"})
                elif tax_inc > Decimal("0.00"):
                    lines.append({"account_id": cfg.hall_revenue_account_id, "debit": Decimal("0.00"), "credit": tax_inc, "memo": "Tax adjustment"})

            je = await DoubleEntryService.post_balanced_entry(
                db=db,
                tenant_id=auth.tenant_id,
                created_by_id=auth.user.id,
                reference=f"DISC-{inv.invoice_number}",
                description=f"Invoice {inv.invoice_number} discount adjusted to {pct}% ({body.remarks or 'ERP discount'})",
                event_id=inv.event_id,
                is_system_posting=True,
                lines=lines,
            )
            je_number = je.entry_number

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=inv.event_id,
            actor_id=auth.user.id,
            action="INVOICE_DISCOUNT_ADJUSTED",
            old_value={"total_amount": float(old_total), "discount_amount": float(old_discount)},
            new_value={
                "discount_percent": float(pct),
                "discount_amount": float(new_discount),
                "total_amount": float(new_total),
                "journal_entry_number": je_number,
                "remarks": body.remarks,
            },
        )
    )
    await db.commit()
    return {
        "status": "UPDATED",
        "invoice_id": str(inv.id),
        "discount_percent": float(inv.discount_percent),
        "discount_amount": float(inv.discount_amount),
        "tax_amount": float(inv.tax_amount),
        "total_amount": float(inv.total_amount),
        "journal_entry_number": je_number,
    }


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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.FINANCE})),
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
    je_id: Optional[uuid.UUID] = None
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
        je_id = je.id

    voucher_no = await DoubleEntryService.next_sequence_number(db, auth.tenant_id, "DEP")
    inv.deposit_status = DepositStatus.REFUNDED
    inv.refund_voucher_number = voucher_no
    inv.refund_payment_method = body.payment_method
    inv.refund_reference = body.reference
    inv.refund_journal_entry_id = je_id

    ev = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
    client = (
        (await db.execute(select(User).where(User.id == ev.primary_client_id, User.tenant_id == auth.tenant_id))).scalar_one_or_none()
        if ev
        else None
    )

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="SECURITY_DEPOSIT_REFUNDED",
            new_value={
                "voucher_number": voucher_no,
                "refund_amount": float(refund_amt),
                "deduction_amount": float(deduction),
                "journal_entry_number": je_number,
                "remarks": body.remarks,
            },
        )
    )
    if client:
        await CommsService.notify_and_whatsapp(
            db,
            auth.tenant_id,
            title=f"تم رد وتسوية التأمين · {voucher_no}",
            content=f"تم إصدار سند تسوية ورد مبلغ التأمين {voucher_no} بمبلغ {refund_amt:,.2f} عبر {body.payment_method} للفعالية {ev.event_code if ev else ''}.",
            category="DEPOSIT_SETTLEMENT",
            event_id=event_id,
            recipient_user_id=client.id,
            recipient_phone=client.phone,
            send_whatsapp=True,
        )
    await db.commit()
    return {
        "status": "REFUNDED",
        "voucher_number": voucher_no,
        "deposit_status": inv.deposit_status.value,
        "refund_amount": float(refund_amt),
        "deduction_amount": float(deduction),
        "journal_entry_number": je_number,
        "deposit_settlement_pdf_url": f"/api/v1/exports/events/{event_id}/deposit-settlement.pdf",
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
        require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES | {StaffRole.OPS_MANAGER})
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
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, FINANCE_WRITE_ROLES)),
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
