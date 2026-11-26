# EventLedger (إيفنت ليدجر) — FastAPI Routers & Main App Wiring Pack
**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Pydantic v2

Drop these files into `apps/api/app/routers/` and `apps/api/app/main.py` to wire all HTTP endpoints for Tenant Self-Onboarding, Drafts & Cross-ERP Approvals, Double-Entry Finance, CSV Bulk Import, and Bilingual PDF Export.

---

## 1. Public SaaS Onboarding & Availability Router (`apps/api/app/routers/public_onboarding.py`)

```python
import re
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.tenant import Tenant, TenantBranding, SubscriptionTier
from app.models.accounting import ChartOfAccount, AccountingConfig, AccountType
from app.models.users import User, StaffProfile, UserType, StaffRole

router = APIRouter(prefix="/api/v1/public", tags=["Public & SaaS Onboarding"])


class TenantOnboardRequest(BaseModel):
    venue_name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=3, max_length=50)
    owner_name: str = Field(..., min_length=2, max_length=150)
    owner_phone: str = Field(..., min_length=7, max_length=30)
    owner_email: str | None = None
    currency: str = Field(default="YER")
    subscription_tier: SubscriptionTier = Field(default=SubscriptionTier.PRO)


@router.post("/tenants/register")
async def register_tenant(payload: TenantOnboardRequest, db: AsyncSession = Depends(get_db)):
    clean_slug = re.sub(r"[^a-z0-9-]", "", payload.slug.lower().strip())
    if clean_slug in {"www", "admin", "api", "app", "mail", "static"}:
        raise HTTPException(status_code=400, detail="Reserved subdomain slug")

    existing = await db.execute(select(Tenant).where(Tenant.slug == clean_slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Subdomain slug is already taken")

    tenant = Tenant(
        name=payload.venue_name,
        slug=clean_slug,
        currency=payload.currency,
        subscription_tier=payload.subscription_tier,
        settings={"cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48},
    )
    db.add(tenant)
    await db.flush()

    db.add(TenantBranding(tenant_id=tenant.id))

    default_accounts = [
        ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True),
        ("1020", "البنك والمحافظ الإلكترونية", "Bank & E-Wallets", AccountType.ASSET, True),
        ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True),
        ("2100", "تأمينات الأضرار المستردة", "Refundable Security Deposits", AccountType.LIABILITY, True),
        ("2200", "ضريبة القيمة المضافة المستحقة", "Tax Payable", AccountType.LIABILITY, True),
        ("4000", "إيرادات تأجير القاعات", "Hall Rental Revenue", AccountType.REVENUE, True),
        ("4100", "إيرادات الضيافة والبوفيه", "Catering Revenue", AccountType.REVENUE, True),
        ("5000", "تكلفة المواد الغذائية والضيافة", "Catering COGS", AccountType.EXPENSE, True),
    ]
    acc_ids = {}
    for code, ar, en, atype, is_sys in default_accounts:
        acc = ChartOfAccount(
            tenant_id=tenant.id, code=code, name_ar=ar, name_en=en, account_type=atype, is_system=is_sys
        )
        db.add(acc)
        await db.flush()
        acc_ids[code] = acc.id

    db.add(
        AccountingConfig(
            tenant_id=tenant.id,
            cash_account_id=acc_ids["1010"],
            bank_account_id=acc_ids["1020"],
            accounts_receivable_id=acc_ids["1100"],
            security_deposit_liab_id=acc_ids["2100"],
            tax_payable_account_id=acc_ids["2200"],
            hall_revenue_account_id=acc_ids["4000"],
            catering_revenue_account_id=acc_ids["4100"],
            catering_cogs_account_id=acc_ids["5000"],
        )
    )

    owner = User(
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        email=payload.owner_email,
        phone=payload.owner_phone,
        full_name=payload.owner_name,
        preferred_lang="ar",
    )
    db.add(owner)
    await db.flush()
    db.add(
        StaffProfile(
            user_id=owner.id,
            role=StaffRole.OWNER,
            department="MANAGEMENT",
            max_discount_percent=Decimal("100.00"),
        )
    )

    await db.commit()
    return {
        "tenant_id": str(tenant.id),
        "slug": tenant.slug,
        "workspace_url": f"https://{tenant.slug}.eventledger.cloud",
        "owner_id": str(owner.id),
    }
```

---

## 2. Drafts & Multi-Tier Approvals Router (`apps/api/app/routers/approvals.py`)

```python
import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.events import ApprovalStatus, DraftStatus, DraftType, Event, EventDraft
from app.services.approvals_service import ApprovalsService

router = APIRouter(prefix="/api/v1", tags=["Drafts & Approvals"])


class SaveDraftRequest(BaseModel):
    draft_type: DraftType
    payload: dict
    financial_delta: Decimal = Decimal("0.00")
    created_by_id: uuid.UUID


class ResolveApprovalRequest(BaseModel):
    approver_id: uuid.UUID
    decision: ApprovalStatus
    rejection_reason: str | None = None


@router.post("/events/{event_id}/drafts")
async def save_event_draft(
    event_id: uuid.UUID,
    body: SaveDraftRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    event_res = await db.execute(
        select(Event).where(Event.id == event_id, Event.tenant_id == tenant.id)
    )
    if not event_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Event not found")

    ver_res = await db.execute(
        select(func.coalesce(func.max(EventDraft.version_number), 0)).where(
            EventDraft.event_id == event_id, EventDraft.draft_type == body.draft_type
        )
    )
    next_version = (ver_res.scalar() or 0) + 1

    draft = EventDraft(
        event_id=event_id,
        created_by_id=body.created_by_id,
        version_number=next_version,
        draft_type=body.draft_type,
        payload=body.payload,
        financial_delta=body.financial_delta,
        status=DraftStatus.DRAFT,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return {"draft_id": str(draft.id), "version": draft.version_number, "status": draft.status}


@router.post("/drafts/{draft_id}/submit")
async def submit_draft(
    draft_id: uuid.UUID,
    requester_id: uuid.UUID,
    requester_type: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    approval = await ApprovalsService.submit_draft_for_approval(
        db=db,
        tenant_id=tenant.id,
        draft_id=draft_id,
        requester_id=requester_id,
        requester_type=requester_type,
    )
    return {
        "approval_id": str(approval.id),
        "required_approver_role": approval.required_approver_role,
        "status": approval.status,
    }


@router.post("/approvals/{approval_id}/resolve")
async def resolve_approval(
    approval_id: uuid.UUID,
    body: ResolveApprovalRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    return await ApprovalsService.resolve_approval(
        db=db,
        tenant_id=tenant.id,
        approval_id=approval_id,
        approver_id=body.approver_id,
        decision=body.decision,
        rejection_reason=body.rejection_reason,
    )
```

---

## 3. Double-Entry Finance, CSV Import & PDF Export Router (`apps/api/app/routers/finance.py`)

```python
import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import ChartOfAccount, JournalEntry, JournalLine
from app.services.accounting_service import DoubleEntryService
from app.services.import_export_service import ImportExportService

router = APIRouter(prefix="/api/v1/finance", tags=["Double-Entry Finance & Imports"])


class VerifyPaymentRequest(BaseModel):
    user_id: uuid.UUID
    event_id: uuid.UUID
    amount: Decimal
    is_security_deposit: bool = False
    payment_method: str = "BANK_TRANSFER"
    reference: str


@router.post("/payments/verify")
async def verify_payment_and_post_journal(
    body: VerifyPaymentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    entry = await DoubleEntryService.record_verified_payment(
        db=db,
        tenant_id=tenant.id,
        user_id=body.user_id,
        event_id=body.event_id,
        amount=body.amount,
        is_security_deposit=body.is_security_deposit,
        payment_method=body.payment_method,
        reference=body.reference,
    )
    return {"journal_entry_id": str(entry.id), "entry_number": entry.entry_number}


@router.get("/trial-balance")
async def get_trial_balance(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    stmt = (
        select(
            ChartOfAccount.code,
            ChartOfAccount.name_ar,
            ChartOfAccount.name_en,
            ChartOfAccount.account_type,
            func.coalesce(func.sum(JournalLine.debit), 0).label("total_debit"),
            func.coalesce(func.sum(JournalLine.credit), 0).label("total_credit"),
        )
        .outerjoin(JournalLine, JournalLine.account_id == ChartOfAccount.id)
        .outerjoin(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .where(ChartOfAccount.tenant_id == tenant.id)
        .group_by(ChartOfAccount.id)
        .order_by(ChartOfAccount.code)
    )
    rows = (await db.execute(stmt)).all()
    accounts = [
        {
            "code": r.code,
            "name_ar": r.name_ar,
            "name_en": r.name_en,
            "account_type": r.account_type,
            "debit": float(r.total_debit),
            "credit": float(r.total_credit),
        }
        for r in rows
    ]
    total_debit = sum(a["debit"] for a in accounts)
    total_credit = sum(a["credit"] for a in accounts)
    return {
        "accounts": accounts,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "is_balanced": abs(total_debit - total_credit) < 0.01,
    }


@router.post("/coa/import-csv")
async def import_coa_csv(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    content = await file.read()
    return await ImportExportService.import_chart_of_accounts_csv(db, tenant.id, content)


@router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: uuid.UUID,
    request: Request,
    locale: str = Query(default="ar", pattern="^(ar|en)$"),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    pdf_bytes = await ImportExportService.render_invoice_pdf(db, tenant.id, invoice_id, locale=locale)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="invoice-{invoice_id}-{locale}.pdf"'},
    )
```

---

## 4. FastAPI Main Entrypoint (`apps/api/app/main.py`)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.tenant_middleware import TenantResolverMiddleware
from app.routers import public_onboarding, approvals, finance

app = FastAPI(
    title="EventLedger (إيفنت ليدجر) API",
    version="3.0.0",
    description="Multi-Tenant Venue, Wedding Hall & Conference ERP + Client Portal API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to *.eventledger.cloud & custom domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantResolverMiddleware)

app.include_router(public_onboarding.router)
app.include_router(approvals.router)
app.include_router(finance.router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "EventLedger Python FastAPI"}
```
