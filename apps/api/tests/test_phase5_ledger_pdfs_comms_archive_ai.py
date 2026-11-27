import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

_TEST_DB = "/tmp/eventledger_test_phase5.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "true"
os.environ.pop("WHATSAPP_ACCESS_TOKEN", None)
os.environ.pop("WHATSAPP_PHONE_NUMBER_ID", None)

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio

from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.accounting import (
    AccountingConfig,
    AccountType,
    ChartOfAccount,
    DepositStatus,
    Invoice,
    InvoiceStatus,
    PaymentMilestone,
    default_normal_balance,
)
from app.models.base import Base, utcnow
from app.models.events import Event, EventStatus
from app.models.tenant import SubscriptionTier, Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_phase5_db():
    assert "sqlite" in str(engine.url), f"Refusing test DDL on non-sqlite URL: {engine.url}"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


async def _seed_coa(db, tenant_id):
    accounts = [
        ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True, False),
        ("1020", "البنك والمحافظ", "Bank & E-Wallets", AccountType.ASSET, True, False),
        ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True, True),
        ("2100", "تأمينات الأضرار", "Refundable Security Deposits", AccountType.LIABILITY, True, True),
        ("2200", "ضريبة القيمة المضافة", "Tax Payable", AccountType.LIABILITY, True, True),
        ("4000", "إيرادات القاعات", "Hall Rental Revenue", AccountType.REVENUE, True, False),
        ("4100", "إيرادات الضيافة", "Catering Revenue", AccountType.REVENUE, True, False),
        ("4200", "إيرادات الأضرار", "Damage Recovery Revenue", AccountType.REVENUE, True, False),
        ("5000", "تكلفة الضيافة", "Catering COGS", AccountType.EXPENSE, True, False),
        ("5100", "مصروفات التشغيل", "Event Operating Expenses", AccountType.EXPENSE, True, False),
    ]
    acc_ids = {}
    for code, ar, en, atype, is_sys, is_ctrl in accounts:
        acc = ChartOfAccount(
            tenant_id=tenant_id,
            code=code,
            name_ar=ar,
            name_en=en,
            account_type=atype,
            normal_balance=default_normal_balance(atype),
            is_control_account=is_ctrl,
            is_system=is_sys,
        )
        db.add(acc)
        await db.flush()
        acc_ids[code] = acc.id
    db.add(
        AccountingConfig(
            tenant_id=tenant_id,
            cash_account_id=acc_ids["1010"],
            bank_account_id=acc_ids["1020"],
            accounts_receivable_id=acc_ids["1100"],
            security_deposit_liab_id=acc_ids["2100"],
            tax_payable_account_id=acc_ids["2200"],
            hall_revenue_account_id=acc_ids["4000"],
            catering_revenue_account_id=acc_ids["4100"],
            catering_cogs_account_id=acc_ids["5000"],
            damage_recovery_account_id=acc_ids["4200"],
            general_expense_account_id=acc_ids["5100"],
        )
    )
    await DoubleEntryService.ensure_fiscal_year_with_periods(db, tenant_id, utcnow().year)
    return acc_ids


@pytest.mark.asyncio
async def test_phase5_ledger_discount_pdfs_comms_archive_and_ai_contract():
    slug = f"p5-{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="قصر النخبة للمؤتمرات | Elite Palace",
            slug=slug,
            currency="USD",
            tax_rate=Decimal("10.00"),
            subscription_tier=SubscriptionTier.ENTERPRISE,
        )
        db.add(tenant)
        await db.flush()
        db.add(TenantBranding(tenant_id=tenant.id, primary_color="#D4AF37", accent_color="#0F172A"))
        acc_ids = await _seed_coa(db, tenant.id)

        hall = Hall(
            tenant_id=tenant.id,
            name="Royal Ballroom",
            name_ar="القاعة الملكية",
            capacity_banquet=400,
            capacity_theater=550,
            base_price=Decimal("2000.00"),
        )
        db.add(hall)
        await db.flush()

        admin_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            phone="+967770005501",
            email="admin@p5.test",
            password_hash=hash_password("Pass12345!"),
            full_name="Tenant Admin P5",
        )
        sales_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            phone="+967770005502",
            email="sales@p5.test",
            password_hash=hash_password("Pass12345!"),
            full_name="Sales Rep P5",
        )
        client_u = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_PRIMARY,
            phone="+967770005599",
            email="client@p5.test",
            password_hash=hash_password("Client12345!"),
            full_name="Tariq Al-Mansoor",
        )
        db.add_all([admin_u, sales_u, client_u])
        await db.flush()

        db.add(StaffProfile(user_id=admin_u.id, role=StaffRole.ADMIN, department="ADMIN"))
        db.add(StaffProfile(user_id=sales_u.id, role=StaffRole.SALES, department="SALES", max_discount_percent=Decimal("5.00")))
        db.add(ClientProfile(user_id=client_u.id, client_category=ClientCategory.INDIVIDUAL_B2C))

        start = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=10)
        ev = Event(
            tenant_id=tenant.id,
            hall_id=hall.id,
            primary_client_id=client_u.id,
            event_code="EVT-P5-2026-001",
            title="Al-Mansoor Summit",
            event_type="CONFERENCE",
            start_time=start,
            end_time=start + timedelta(hours=6),
            status=EventStatus.CONFIRMED,
            guest_count=200,
        )
        db.add(ev)
        await db.flush()

        # Subtotal 2000 + 10% tax = 2200 + 500 refundable deposit
        inv = Invoice(
            tenant_id=tenant.id,
            event_id=ev.id,
            invoice_number="INV-P5-0001",
            subtotal=Decimal("2000.00"),
            discount_percent=Decimal("0.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("200.00"),
            total_amount=Decimal("2200.00"),
            security_deposit_amount=Decimal("500.00"),
            deposit_status=DepositStatus.UNPAID,
            status=InvoiceStatus.ISSUED,
            line_items_json=[
                {"label_ar": "القاعة الملكية", "label_en": "Royal Ballroom", "quantity": 1, "unit_price": 1500, "total": 1500},
                {"label_ar": "ضيافة VIP", "label_en": "VIP Catering", "quantity": 50, "unit_price": 10, "total": 500},
            ],
        )
        db.add(inv)
        await db.flush()

        ms_rev = PaymentMilestone(
            tenant_id=tenant.id,
            invoice_id=inv.id,
            title="Package Full Settlement",
            amount_due=Decimal("2200.00"),
            due_date=start - timedelta(days=5),
            is_security_deposit=False,
        )
        ms_dep = PaymentMilestone(
            tenant_id=tenant.id,
            invoice_id=inv.id,
            title="Refundable Deposit (2100)",
            amount_due=Decimal("500.00"),
            due_date=start - timedelta(days=2),
            is_security_deposit=True,
        )
        db.add_all([ms_rev, ms_dep])
        await DoubleEntryService.post_invoice_accrual(
            db, tenant.id, admin_u.id, inv, Decimal("1500.00"), Decimal("500.00"), ev.event_code
        )
        await db.commit()

        tenant_id, event_id, inv_id = tenant.id, ev.id, inv.id
        ms_rev_id, ms_dep_id = ms_rev.id, ms_dep.id
        client_id = client_u.id

    admin_hdr = {
        "Authorization": f"Bearer {create_access_token(admin_u.id, tenant_id, UserType.INTERNAL_STAFF, StaffRole.ADMIN)}",
        "X-Tenant-Slug": slug,
    }
    sales_hdr = {
        "Authorization": f"Bearer {create_access_token(sales_u.id, tenant_id, UserType.INTERNAL_STAFF, StaffRole.SALES)}",
        "X-Tenant-Slug": slug,
    }
    client_hdr = {
        "Authorization": f"Bearer {create_access_token(client_id, tenant_id, UserType.CLIENT_PRIMARY)}",
        "X-Tenant-Slug": slug,
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Admin COA Create/Edit & Manual Journal Entry Post/Reverse & Period Close
        r_coa = await client.post(
            "/api/v1/finance/accounts",
            headers=admin_hdr,
            json={"code": "5250", "name_ar": "صيانة صوتيات", "name_en": "Audio Maintenance", "account_type": "EXPENSE"},
        )
        assert r_coa.status_code == 200, r_coa.text
        new_acc_id = r_coa.json()["id"]

        r_edit = await client.patch(
            f"/api/v1/finance/accounts/{new_acc_id}",
            headers=admin_hdr,
            json={"name_en": "AV Maintenance Updated"},
        )
        assert r_edit.status_code == 200

        r_je = await client.post(
            "/api/v1/finance/journal-entries",
            headers=admin_hdr,
            json={
                "reference": "MAINT-01",
                "description": "Audio cable check",
                "lines": [
                    {"account_id": new_acc_id, "debit": 100.0, "credit": 0},
                    {"account_id": str(acc_ids["1010"]), "debit": 0, "credit": 100.0},
                ],
            },
        )
        assert r_je.status_code == 200, r_je.text
        je_id = r_je.json()["id"]
        assert (await client.post(f"/api/v1/finance/journal-entries/{je_id}/reverse", headers=admin_hdr, json={"reason": "Test reversal"})).status_code == 200

        # 2. Editable % Discount (10% discount on 2000 -> 1800 taxable + 180 tax = 1980) + balanced GL
        r_disc = await client.patch(
            f"/api/v1/erp/finance/invoices/{inv_id}/discount",
            headers=admin_hdr,
            json={"discount_percent": 10, "remarks": "Corporate VIP discount"},
        )
        assert r_disc.status_code == 200, r_disc.text
        assert r_disc.json()["total_amount"] == 1980.0
        assert r_disc.json()["discount_amount"] == 200.0

        tb = (await client.get("/api/v1/finance/trial-balance", headers=admin_hdr)).json()
        assert tb["is_balanced"] is True
        stmts = (await client.get("/api/v1/finance/statements", headers=admin_hdr)).json()
        assert stmts["balance_sheet"]["is_balanced"] is True

        # 3. Milestone Return-for-Amendment -> client sees remarks -> re-verify & post GL
        r_ret = await client.patch(
            f"/api/v1/erp/finance/milestones/{ms_rev_id}/return",
            headers=admin_hdr,
            json={"remarks": "Transfer photo blurry, upload clearer receipt"},
        )
        assert r_ret.status_code == 200, r_ret.text
        assert r_ret.json()["status"] == "RETURNED_FOR_AMENDMENT"

        portal_evs = (await client.get("/api/v1/portal/events", headers=client_hdr)).json()
        assert portal_evs[0]["invoice"]["milestones"][0]["status"] == "RETURNED_FOR_AMENDMENT"
        assert "blurry" in portal_evs[0]["invoice"]["milestones"][0]["reviewer_remarks"]

        # Verify revenue milestone (1980) + deposit milestone (500 -> Cr 2100)
        assert (
            await client.patch(
                f"/api/v1/erp/finance/milestones/{ms_rev_id}/verify",
                headers=admin_hdr,
                json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False, "reference": "REF-REV"},
            )
        ).status_code == 200
        assert (
            await client.patch(
                f"/api/v1/erp/finance/milestones/{ms_dep_id}/verify",
                headers=admin_hdr,
                json={"payment_method": "KURAIMI_BANK", "is_security_deposit": True, "reference": "REF-DEP"},
            )
        ).status_code == 200

        # 4. Archiving blocked while event CONFIRMED & deposit HELD
        r_block_active = await client.post(f"/api/v1/tenant/clients/{client_id}/archive", headers=admin_hdr, json={})
        assert r_block_active.status_code == 400

        # Finalize damage inspection ($120 deduction -> Dr 2100 / Cr 4200) -> net refundable 380
        r_insp = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/inspection",
            headers=admin_hdr,
            json={
                "status": "DAMAGE_CLAIMED",
                "deduction_items": [{"category": "AV", "description": "Broken wireless mic", "amount": 120}],
                "notes": "Confirmed by tech team",
                "workflow_action": "FINALIZE",
            },
        )
        assert r_insp.status_code == 200, r_insp.text
        assert r_insp.json()["deposit_status"] == "DEDUCTED"

        # Still blocked before refund payout!
        assert (
            await client.post(f"/api/v1/tenant/clients/{client_id}/archive", headers=admin_hdr, json={})
        ).status_code == 400

        # Refund remaining deposit $380 (Dr 2100 / Cr 1020) + voucher number
        r_ref = await client.post(
            f"/api/v1/erp/finance/events/{event_id}/refund-deposit",
            headers=admin_hdr,
            json={"payment_method": "KURAIMI_BANK", "reference": "TXN-REF-380"},
        )
        assert r_ref.status_code == 200, r_ref.text
        assert r_ref.json()["refund_amount"] == 380.0
        assert r_ref.json()["voucher_number"].startswith("DEP-")

        # GL 2100 Liability balance must now be exactly 0.00!
        tb_after = (await client.get("/api/v1/finance/trial-balance", headers=admin_hdr)).json()
        assert tb_after["is_balanced"] is True
        row_2100 = next(r for r in tb_after["rows"] if r["code"] == "2100")
        assert abs(row_2100["balance"]) < 0.01

        # Close Operation (CLOSED)
        r_close = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/close-operation",
            headers=admin_hdr,
            json={"closing_remarks": "Handed over & deposit settled"},
        )
        assert r_close.status_code == 200, r_close.text

        # 5. AI Contract Generation -> Client Return -> Staff Countersign -> Client E-Sign
        r_ai = await client.post(
            f"/api/v1/events/{event_id}/contract/generate-ai",
            headers=admin_hdr,
            json={"custom_clauses_notes": "No confetti cannons inside ballroom."},
        )
        assert r_ai.status_code == 200, r_ai.text
        ai_c = r_ai.json()
        assert "EVT-P5-2026-001" in ai_c["terms_en"]
        assert "1,980.00" in ai_c["terms_en"]
        assert "500.00" in ai_c["terms_ar"]
        assert ai_c["ai_metadata_json"]["engine"] == "STRICT_DB_GROUNDED_AI_DRAFTER_V1"

        # Client requests contract amendment
        r_c_ret = await client.patch(
            f"/api/v1/events/{event_id}/contract",
            headers=client_hdr,
            json={"status": "RETURNED_FOR_AMENDMENT", "amendment_remarks": "Clarify load-in time at 14:00"},
        )
        assert r_c_ret.status_code == 200
        assert r_c_ret.json()["status"] == "RETURNED_FOR_AMENDMENT"

        assert (
            await client.post(f"/api/v1/erp/events/{event_id}/contract/countersign", headers=admin_hdr)
        ).status_code == 200
        r_sign = await client.post(
            f"/api/v1/portal/events/{event_id}/contract/sign",
            headers=client_hdr,
            json={"signature_name": "Tariq Al-Mansoor"},
        )
        assert r_sign.status_code == 200

        # 6. Branded PDFs (Invoice, Contract, Deposit Settlement) in AR & EN
        for pdf_url in (
            f"/api/v1/exports/invoices/{inv_id}/pdf?locale=ar",
            f"/api/v1/exports/invoices/{inv_id}/pdf?locale=en",
            f"/api/v1/exports/contracts/{event_id}/pdf?locale=ar",
            f"/api/v1/exports/contracts/{event_id}/pdf?locale=en",
            f"/api/v1/exports/events/{event_id}/deposit-settlement.pdf?locale=ar",
            f"/api/v1/exports/events/{event_id}/deposit-settlement.pdf?locale=en",
        ):
            rp = await client.get(pdf_url, headers=admin_hdr)
            assert rp.status_code == 200, pdf_url
            assert rp.headers["content-type"].startswith("application/pdf")
            assert rp.content.startswith(b"%PDF-"), f"Invalid PDF signature on {pdf_url}"

        # 7. Notifications & WhatsApp Safe Fallback + Document Share
        r_share = await client.post(
            f"/api/v1/events/{event_id}/share-document",
            headers=admin_hdr,
            json={"document_type": "DEPOSIT_SETTLEMENT", "channel": "WHATSAPP", "locale": "ar"},
        )
        assert r_share.status_code == 200, r_share.text
        assert r_share.json()["delivery_status"] == "SIMULATED_FALLBACK"
        assert "wa.me/" in (r_share.json()["whatsapp_url"] or "")

        r_notifs = await client.get("/api/v1/notifications", headers=client_hdr)
        assert r_notifs.status_code == 200
        assert r_notifs.json()["unread_count"] >= 1
        assert (await client.post("/api/v1/notifications/read-all", headers=client_hdr)).status_code == 200
        assert (await client.get("/api/v1/notifications", headers=client_hdr)).json()["unread_count"] == 0

        # 8. One-Time Client Archiving RBAC & History Preservation
        # SALES cannot archive (403)
        r_sales_arch = await client.post(f"/api/v1/tenant/clients/{client_id}/archive", headers=sales_hdr, json={})
        assert r_sales_arch.status_code == 403

        # ADMIN can archive once ended & deposit settled
        r_arch = await client.post(
            f"/api/v1/tenant/clients/{client_id}/archive",
            headers=admin_hdr,
            json={"reason": "One-time corporate conference concluded"},
        )
        assert r_arch.status_code == 200, r_arch.text
        assert r_arch.json()["status"] == "ARCHIVED"

        # Hidden by default, shown on include_archived=true
        active_clients = (await client.get("/api/v1/tenant/clients", headers=admin_hdr)).json()
        assert not any(c["id"] == str(client_id) for c in active_clients)

        all_clients = (await client.get("/api/v1/tenant/clients?include_archived=true", headers=admin_hdr)).json()
        arch_row = next(c for c in all_clients if c["id"] == str(client_id))
        assert arch_row["is_archived"] is True

        # Historical records (bookings, invoices, GL) intact!
        ev_hist = (await client.get("/api/v1/bookings/events", headers=admin_hdr)).json()
        assert any(e["id"] == str(event_id) and e["status"] == "CLOSED" for e in ev_hist)

        # Unarchive works cleanly
        r_unarch = await client.post(f"/api/v1/tenant/clients/{client_id}/unarchive", headers=admin_hdr)
        assert r_unarch.status_code == 200
        assert any(c["id"] == str(client_id) for c in (await client.get("/api/v1/tenant/clients", headers=admin_hdr)).json())
