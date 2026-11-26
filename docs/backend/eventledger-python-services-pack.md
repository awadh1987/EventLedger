# EventLedger (إيفنت ليدجر) — Python FastAPI Services Pack
**Companion Backend Services:** `approvals_service.py`, `import_export_service.py`, and `seed.py`

Drop these modules directly into `apps/api/app/services/` and `apps/api/seed.py`.

---

## 1. Cross-ERP Draft & Approval Engine (`apps/api/app/services/approvals_service.py`)

```python
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.events import (
    ApprovalRequest,
    ApprovalStatus,
    DraftStatus,
    DraftType,
    Event,
    EventDraft,
)
from app.models.accounting import Invoice
from app.models.tenant import Tenant


class ApprovalsService:
    @staticmethod
    async def submit_draft_for_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        draft_id: uuid.UUID,
        requester_id: uuid.UUID,
        requester_type: str,
    ) -> ApprovalRequest:
        draft_res = await db.execute(select(EventDraft).where(EventDraft.id == draft_id))
        draft = draft_res.scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")

        event_res = await db.execute(
            select(Event).where(Event.id == draft.event_id, Event.tenant_id == tenant_id)
        )
        event = event_res.scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found in tenant")

        tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_res.scalar_one()

        settings = tenant.settings or {}
        lock_hours = (
            settings.get("cateringLockHours", 72)
            if draft.draft_type == DraftType.CATERING_MENU
            else settings.get("floorPlanLockHours", 24)
        )
        hours_until_event = (
            event.start_time.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
        ).total_seconds() / 3600.0
        if (event.is_locked or hours_until_event < lock_hours) and requester_type != "INTERNAL_STAFF":
            raise HTTPException(
                status_code=403,
                detail=f"Draft is locked ({lock_hours}h pre-event freeze). Submit an urgent Change Request via coordinator.",
            )

        if draft.financial_delta > Decimal("0.00") and requester_id != event.primary_client_id:
            draft.status = DraftStatus.PENDING_CLIENT_APPROVAL
            required_role = "CLIENT_PRIMARY"
        else:
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            required_role = "OPS_MANAGER"

        approval = ApprovalRequest(
            event_id=event.id,
            draft_id=draft.id,
            requested_by_id=requester_id,
            required_approver_role=required_role,
            status=ApprovalStatus.PENDING,
        )
        db.add(approval)
        await db.commit()
        await db.refresh(approval)
        return approval

    @staticmethod
    async def resolve_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        approval_id: uuid.UUID,
        approver_id: uuid.UUID,
        decision: ApprovalStatus,
        rejection_reason: str | None = None,
    ) -> dict:
        res = await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id))
        approval = res.scalar_one_or_none()
        if not approval or approval.status != ApprovalStatus.PENDING:
            raise HTTPException(status_code=400, detail="Approval request not found or already resolved")

        draft_res = await db.execute(select(EventDraft).where(EventDraft.id == approval.draft_id))
        draft = draft_res.scalar_one()

        event_res = await db.execute(
            select(Event).where(Event.id == approval.event_id, Event.tenant_id == tenant_id)
        )
        event = event_res.scalar_one()

        approval.status = decision
        approval.approved_by_id = approver_id
        approval.rejection_reason = rejection_reason
        approval.resolved_at = datetime.utcnow()

        if decision == ApprovalStatus.REJECTED:
            draft.status = DraftStatus.REJECTED
            await db.commit()
            return {"status": "REJECTED", "draft_id": str(draft.id)}

        if approval.required_approver_role == "CLIENT_PRIMARY":
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            next_gate = ApprovalRequest(
                event_id=event.id,
                draft_id=draft.id,
                requested_by_id=approver_id,
                required_approver_role="OPS_MANAGER",
                status=ApprovalStatus.PENDING,
            )
            db.add(next_gate)
            await db.commit()
            return {"status": "FORWARDED_TO_OPS", "next_approval_id": str(next_gate.id)}

        draft.status = DraftStatus.APPROVED_SYNCED

        if draft.financial_delta > Decimal("0.00"):
            inv_res = await db.execute(
                select(Invoice).where(Invoice.event_id == event.id, Invoice.tenant_id == tenant_id)
            )
            invoice = inv_res.scalar_one_or_none()
            if invoice:
                invoice.subtotal += draft.financial_delta
                invoice.total_amount += draft.financial_delta

        payload = draft.payload or {}
        if "totalSeatedGuests" in payload:
            event.guest_count = int(payload["totalSeatedGuests"])

        await db.commit()
        return {
            "status": "APPROVED_SYNCED",
            "event_id": str(event.id),
            "draft_id": str(draft.id),
            "synced_modules": ["FINANCE", "OPERATIONS_BEO", "INVENTORY"],
        }
```

---

## 2. UTF-8 BOM CSV Bulk Importer & WeasyPrint Bilingual PDF Exporter (`apps/api/app/services/import_export_service.py`)

```python
import csv
import io
import uuid
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from weasyprint import HTML
from app.models.accounting import ChartOfAccount, AccountType, Invoice
from app.models.tenant import Tenant, TenantBranding


class ImportExportService:
    @staticmethod
    async def import_chart_of_accounts_csv(
        db: AsyncSession, tenant_id: uuid.UUID, file_bytes: bytes
    ) -> dict:
        text = file_bytes.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        created, errors = 0, []

        for idx, row in enumerate(reader, start=2):
            try:
                code = row["code"].strip()
                acc_type = AccountType(row["account_type"].strip().upper())
                existing = await db.execute(
                    select(ChartOfAccount).where(
                        ChartOfAccount.tenant_id == tenant_id, ChartOfAccount.code == code
                    )
                )
                if existing.scalar_one_or_none():
                    continue
                db.add(
                    ChartOfAccount(
                        tenant_id=tenant_id,
                        code=code,
                        name_ar=row["name_ar"].strip(),
                        name_en=row["name_en"].strip(),
                        account_type=acc_type,
                    )
                )
                created += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})

        await db.commit()
        return {"imported": created, "errors": errors}

    @staticmethod
    async def render_invoice_pdf(
        db: AsyncSession, tenant_id: uuid.UUID, invoice_id: uuid.UUID, locale: str = "ar"
    ) -> bytes:
        inv_res = await db.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
        )
        invoice = inv_res.scalar_one_or_none()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_res.scalar_one()
        brand_res = await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        branding = brand_res.scalar_one_or_none()

        primary = branding.primary_color if branding else "#D4AF37"
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "فاتورة ضريبية وكشف حجز" if is_rtl else "Tax Invoice & Event Statement"
        footer = (branding.invoice_footer_ar if is_rtl else branding.invoice_footer_en) if branding else ""

        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>@page {{ size: A4; margin: 18mm; }} "
            f"body {{ font-family: 'DejaVu Sans', sans-serif; color: #1e293b; direction: {direction}; }} "
            f".header {{ border-bottom: 3px solid {primary}; padding-bottom: 12px; margin-bottom: 20px; }} "
            f".title {{ color: {primary}; font-size: 22px; font-weight: bold; }} "
            f"table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }} "
            f"th, td {{ border: 1px solid #cbd5e1; padding: 10px; text-align: start; }} "
            f"th {{ background-color: #f8fafc; }} "
            f".footer {{ margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }}</style></head>"
            f"<body><div class='header'><div class='title'>{tenant.name} — {title}</div>"
            f"<div>#{invoice.invoice_number} | {tenant.currency}</div></div>"
            f"<table><thead><tr><th>{'البيان' if is_rtl else 'Description'}</th>"
            f"<th>{'المبلغ' if is_rtl else 'Amount'}</th></tr></thead><tbody>"
            f"<tr><td>{'المجموع الفرعي' if is_rtl else 'Subtotal'}</td><td>{invoice.subtotal:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'الخصم' if is_rtl else 'Discount'}</td><td>-{invoice.discount_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'الضريبة' if is_rtl else 'Tax'}</td><td>{invoice.tax_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td><strong>{'الإجمالي المستحق' if is_rtl else 'Total Due'}</strong></td>"
            f"<td><strong>{invoice.total_amount:,.2f} {tenant.currency}</strong></td></tr>"
            f"<tr><td>{'تأمين الأضرار المسترد (أمانة)' if is_rtl else 'Refundable Security Deposit'}</td>"
            f"<td>{invoice.security_deposit_amount:,.2f} {tenant.currency} ({invoice.deposit_status.value})</td></tr>"
            f"</tbody></table><div class='footer'>{footer or 'Generated by EventLedger'}</div></body></html>"
        )
        return HTML(string=html_content).write_pdf()
```

---

## 3. Python Async Database Seeder (`apps/api/seed.py`)

```python
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant, TenantBranding, SystemLookup, SubscriptionTier
from app.models.accounting import ChartOfAccount, AccountingConfig, AccountType
from app.models.users import User, StaffProfile, ClientProfile, UserType, StaffRole, ClientCategory
from app.models.venue import Hall
from app.models.events import Event, EventStatus


async def seed_all():
    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(Tenant).where(Tenant.slug == "almassa"))
        if existing.scalar_one_or_none():
            print("Tenant 'almassa' already seeded.")
            return

        tenant = Tenant(
            name="قصر الماسة للمؤتمرات والأفراح | Al-Massa Grand Palace",
            slug="almassa",
            subscription_tier=SubscriptionTier.ENTERPRISE,
            currency="YER",
            tax_rate=Decimal("5.00"),
            settings={"cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48},
        )
        db.add(tenant)
        await db.flush()

        db.add(
            TenantBranding(
                tenant_id=tenant.id,
                primary_color="#D4AF37",
                accent_color="#0F172A",
                default_theme="DARK",
                enable_spotlight=True,
                invoice_footer_ar="شكراً لاختياركم قصر الماسة — يُعاد مبلغ التأمين بعد فحص القاعة.",
                invoice_footer_en="Thank you for choosing Al-Massa Palace — Security deposit refunded post-inspection.",
            )
        )

        accounts_spec = [
            ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True),
            ("1020", "البنك والمحافظ الإلكترونية", "Bank & E-Wallets", AccountType.ASSET, True),
            ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True),
            ("2100", "تأمينات الأضرار المستردة", "Refundable Security Deposits", AccountType.LIABILITY, True),
            ("2200", "ضريبة القيمة المضافة المستحقة", "Tax Payable", AccountType.LIABILITY, True),
            ("4000", "إيرادات تأجير القاعات", "Hall Rental Revenue", AccountType.REVENUE, True),
            ("4100", "إيرادات الضيافة والبوفيه", "Catering Revenue", AccountType.REVENUE, True),
            ("5000", "تكلفة المواد الغذائية والضيافة", "Catering COGS", AccountType.EXPENSE, True),
        ]
        acc_map = {}
        for code, ar, en, atype, is_sys in accounts_spec:
            acc = ChartOfAccount(
                tenant_id=tenant.id, code=code, name_ar=ar, name_en=en, account_type=atype, is_system=is_sys
            )
            db.add(acc)
            await db.flush()
            acc_map[code] = acc.id

        db.add(
            AccountingConfig(
                tenant_id=tenant.id,
                cash_account_id=acc_map["1010"],
                bank_account_id=acc_map["1020"],
                accounts_receivable_id=acc_map["1100"],
                security_deposit_liab_id=acc_map["2100"],
                tax_payable_account_id=acc_map["2200"],
                hall_revenue_account_id=acc_map["4000"],
                catering_revenue_account_id=acc_map["4100"],
                catering_cogs_account_id=acc_map["5000"],
            )
        )

        for idx, (code, ar, en) in enumerate([
            ("WEDDING", "حفل زفاف", "Wedding Ceremony"),
            ("CONFERENCE", "مؤتمر / ندوة", "Corporate Conference"),
            ("GRADUATION", "حفل تخرج", "Graduation Ceremony"),
        ]):
            db.add(SystemLookup(tenant_id=tenant.id, category="EVENT_TYPE", code=code, label_ar=ar, label_en=en, sort_order=idx))

        hall_a = Hall(
            tenant_id=tenant.id,
            name="Grand Diamond Hall",
            name_ar="قاعة الماسة الكبرى",
            capacity_banquet=500,
            capacity_theater=800,
            base_price=Decimal("1500000.00"),
            cleaning_buffer_minutes=120,
        )
        db.add(hall_a)
        await db.flush()

        owner = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            email="owner@almassa.eventledger.local",
            phone="+967770000001",
            full_name="أ. طارق المنصور (المدير العام)",
            preferred_lang="ar",
        )
        db.add(owner)
        await db.flush()
        db.add(StaffProfile(user_id=owner.id, role=StaffRole.OWNER, department="MANAGEMENT", max_discount_percent=Decimal("100.00")))

        client = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_PRIMARY,
            email="ahmed@client.local",
            phone="+967771112233",
            full_name="أحمد عبدالله الشامي",
            preferred_lang="ar",
        )
        db.add(client)
        await db.flush()
        db.add(
            ClientProfile(
                user_id=client.id,
                client_category=ClientCategory.INDIVIDUAL_B2C,
                national_id_or_cr="010100998877",
                refund_bank_details={"method": "Kuraimi / Jaib", "accountNumber": "301234567", "accountName": "أحمد عبدالله الشامي"},
            )
        )

        db.add(
            Event(
                tenant_id=tenant.id,
                hall_id=hall_a.id,
                primary_client_id=client.id,
                assigned_sales_id=owner.id,
                event_code="EVT-2026-1001",
                event_type="WEDDING",
                start_time=datetime.utcnow() + timedelta(days=20),
                end_time=datetime.utcnow() + timedelta(days=20, hours=6),
                status=EventStatus.CONFIRMED,
                guest_count=420,
            )
        )

        await db.commit()
        print("EventLedger Python seed completed successfully for tenant: almassa")


if __name__ == "__main__":
    asyncio.run(seed_all())
```
