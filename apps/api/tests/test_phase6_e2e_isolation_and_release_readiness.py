import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

_TEST_DB = "/tmp/eventledger_test_phase6.db"
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
    AccountingPeriod,
    AccountType,
    ChartOfAccount,
    DepositStatus,
    Invoice,
    InvoiceStatus,
    JournalEntry,
    JournalLine,
    PaymentMilestone,
    default_normal_balance,
)
from app.models.base import Base, utcnow
from app.models.events import Event, EventStatus, GatePass
from app.models.events_extensions import EventContract, NotificationLog
from app.models.tenant import SubscriptionTier, Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_phase6_db():
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
    fy_periods = await DoubleEntryService.ensure_fiscal_year_with_periods(db, tenant_id, utcnow().year)
    return acc_ids, fy_periods


async def _seed_tenant_bundle(db, *, slug: str, name: str, phone_prefix: str):
    tenant = Tenant(
        name=name,
        slug=slug,
        currency="USD",
        tax_rate=Decimal("10.00"),
        subscription_tier=SubscriptionTier.ENTERPRISE,
    )
    db.add(tenant)
    await db.flush()
    db.add(TenantBranding(tenant_id=tenant.id, primary_color="#D4AF37", accent_color="#0F172A"))
    acc_ids, periods = await _seed_coa(db, tenant.id)

    hall = Hall(
        tenant_id=tenant.id,
        name="Grand Hall",
        name_ar="القاعة الكبرى",
        capacity_banquet=350,
        capacity_theater=500,
        base_price=Decimal("1500.00"),
    )
    db.add(hall)
    await db.flush()

    admin_u = User(
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        phone=f"{phone_prefix}01",
        email=f"admin@{slug}.test",
        password_hash=hash_password("Pass12345!"),
        full_name=f"Admin {slug}",
    )
    client_u = User(
        tenant_id=tenant.id,
        user_type=UserType.CLIENT_PRIMARY,
        phone=f"{phone_prefix}02",
        email=f"client@{slug}.test",
        password_hash=hash_password("Client12345!"),
        full_name=f"Client {slug}",
    )
    other_client_u = User(
        tenant_id=tenant.id,
        user_type=UserType.CLIENT_PRIMARY,
        phone=f"{phone_prefix}03",
        email=f"other@{slug}.test",
        password_hash=hash_password("Client12345!"),
        full_name=f"Other Client {slug}",
    )
    db.add_all([admin_u, client_u, other_client_u])
    await db.flush()

    db.add(StaffProfile(user_id=admin_u.id, role=StaffRole.ADMIN, department="ADMIN"))
    db.add(ClientProfile(user_id=client_u.id, client_category=ClientCategory.INDIVIDUAL_B2C))
    db.add(ClientProfile(user_id=other_client_u.id, client_category=ClientCategory.INDIVIDUAL_B2C))

    start = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=12)
    ev = Event(
        tenant_id=tenant.id,
        hall_id=hall.id,
        primary_client_id=client_u.id,
        event_code=f"EVT-{slug.upper()}-001",
        title=f"Event {slug}",
        event_type="CONFERENCE",
        start_time=start,
        end_time=start + timedelta(hours=5),
        status=EventStatus.CONFIRMED,
        guest_count=150,
    )
    db.add(ev)
    await db.flush()

    inv = Invoice(
        tenant_id=tenant.id,
        event_id=ev.id,
        invoice_number=f"INV-{slug.upper()}-001",
        subtotal=Decimal("1500.00"),
        discount_percent=Decimal("0.00"),
        discount_amount=Decimal("0.00"),
        tax_amount=Decimal("150.00"),
        total_amount=Decimal("1650.00"),
        security_deposit_amount=Decimal("400.00"),
        deposit_status=DepositStatus.UNPAID,
        status=InvoiceStatus.ISSUED,
        line_items_json=[
            {"label_ar": "القاعة الكبرى", "label_en": "Grand Hall", "quantity": 1, "unit_price": 1500, "total": 1500},
        ],
    )
    db.add(inv)
    await db.flush()

    ms = PaymentMilestone(
        tenant_id=tenant.id,
        invoice_id=inv.id,
        title="Booking Deposit",
        amount_due=Decimal("825.00"),
        due_date=start - timedelta(days=3),
        is_security_deposit=False,
    )
    db.add(ms)

    contract = EventContract(
        tenant_id=tenant.id,
        event_id=ev.id,
        contract_number=f"CNT-{slug.upper()}-001",
        terms_ar="شروط تعاقد تجريبية",
        terms_en="Test agreement terms",
        status="DRAFT",
    )
    gate_pass = GatePass(
        tenant_id=tenant.id,
        event_id=ev.id,
        pass_type="VIP_GUEST",
        clearance_category="GUEST",
        holder_name="VIP Holder",
        clearance_status="APPROVED",
        qr_token=f"QR-{slug}-{uuid.uuid4().hex[:8]}",
        valid_from=start - timedelta(hours=1),
        valid_until=start + timedelta(hours=6),
    )
    notif = NotificationLog(
        tenant_id=tenant.id,
        event_id=ev.id,
        recipient_user_id=client_u.id,
        channel="IN_APP",
        category="STATUS_UPDATE",
        title="Test Notice",
        content="Tenant isolated notice",
        delivery_status="DELIVERED",
    )
    je = JournalEntry(
        tenant_id=tenant.id,
        entry_number=f"JE-{slug.upper()}-001",
        reference="SEED-JE",
        description="Seed balanced entry",
        event_id=ev.id,
        fiscal_period_id=periods[0].id if isinstance(periods, list) and periods else None,
        created_by_id=admin_u.id,
        lines=[
            JournalLine(tenant_id=tenant.id, account_id=acc_ids["1100"], debit=Decimal("100.00"), credit=Decimal("0.00")),
            JournalLine(tenant_id=tenant.id, account_id=acc_ids["4000"], debit=Decimal("0.00"), credit=Decimal("100.00")),
        ],
    )
    db.add_all([contract, gate_pass, notif, je])
    await db.flush()

    period = (
        await db.execute(
            AccountingPeriod.__table__.select().where(AccountingPeriod.tenant_id == tenant.id)
        )
    ).first()

    return {
        "tenant_id": tenant.id,
        "slug": slug,
        "hall_id": hall.id,
        "admin_id": admin_u.id,
        "client_id": client_u.id,
        "other_client_id": other_client_u.id,
        "event_id": ev.id,
        "invoice_id": inv.id,
        "milestone_id": ms.id,
        "acc_id": acc_ids["5100"],
        "period_id": period.id if period else None,
        "je_id": je.id,
        "pass_id": gate_pass.id,
        "notif_id": notif.id,
    }


@pytest.mark.asyncio
async def test_phase6_cross_tenant_isolation_hold_upload_and_bilingual_localization():
    slug_a = f"p6a-{uuid.uuid4().hex[:6]}"
    slug_b = f"p6b-{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        a = await _seed_tenant_bundle(
            db,
            slug=slug_a,
            name="قصر الاختبار | Royal Test Venue",
            phone_prefix="+967771001",
        )
        b = await _seed_tenant_bundle(
            db,
            slug=slug_b,
            name="قاعة المنافس | Rival Palace",
            phone_prefix="+967772002",
        )
        await db.commit()

    hdr_a = {
        "Authorization": f"Bearer {create_access_token(a['admin_id'], a['tenant_id'], UserType.INTERNAL_STAFF, StaffRole.ADMIN)}",
        "X-Tenant-Slug": slug_a,
    }
    hdr_a_wrong_slug = {
        "Authorization": hdr_a["Authorization"],
        "X-Tenant-Slug": slug_b,
    }
    hdr_b_client = {
        "Authorization": f"Bearer {create_access_token(b['client_id'], b['tenant_id'], UserType.CLIENT_PRIMARY)}",
        "X-Tenant-Slug": slug_b,
    }
    hdr_b_other_client = {
        "Authorization": f"Bearer {create_access_token(b['other_client_id'], b['tenant_id'], UserType.CLIENT_PRIMARY)}",
        "X-Tenant-Slug": slug_b,
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Wrong X-Tenant-Slug rejects Tenant A token with 403
        assert (await client.get("/api/v1/finance/accounts", headers=hdr_a_wrong_slug)).status_code == 403
        assert (await client.get("/api/v1/tenant/clients", headers=hdr_a_wrong_slug)).status_code == 403

        # 2. Cross-tenant resource UUID targeting (Tenant A admin targeting Tenant B IDs -> 404)
        cross_checks = [
            ("PATCH", f"/api/v1/finance/accounts/{b['acc_id']}", {"name_en": "Tampered"}),
            ("GET", f"/api/v1/finance/accounts/{b['acc_id']}/ledger", None),
            ("PATCH", f"/api/v1/finance/periods/{b['period_id']}", {"status": "LOCKED"}),
            ("POST", f"/api/v1/finance/journal-entries/{b['je_id']}/reverse", {"reason": "Cross tenant check"}),
            ("PATCH", f"/api/v1/erp/finance/invoices/{b['invoice_id']}/discount", {"discount_percent": 5}),
            ("PATCH", f"/api/v1/erp/finance/milestones/{b['milestone_id']}/return", {"remarks": "Cross tenant check"}),
            ("GET", f"/api/v1/exports/invoices/{b['invoice_id']}/pdf", None),
            ("GET", f"/api/v1/exports/contracts/{b['event_id']}/pdf", None),
            ("GET", f"/api/v1/exports/events/{b['event_id']}/deposit-settlement.pdf", None),
            ("GET", f"/api/v1/exports/events/{b['event_id']}/beo.pdf", None),
            ("POST", f"/api/v1/notifications/{b['notif_id']}/read", None),
            ("POST", f"/api/v1/events/{b['event_id']}/share-document", {"document_type": "INVOICE", "channel": "WHATSAPP"}),
            ("GET", f"/api/v1/security/events/{b['event_id']}/overview", None),
            ("PUT", f"/api/v1/security/events/{b['event_id']}/readiness", {"guard_headcount": 2, "readiness_checklist": {}, "workflow_action": "SAVE_DRAFT"}),
            ("PATCH", f"/api/v1/security/passes/{b['pass_id']}", {"clearance_status": "REVOKED"}),
            ("POST", f"/api/v1/erp/ops/events/{b['event_id']}/inspection", {"status": "PASSED", "deduction_items": [], "workflow_action": "FINALIZE"}),
            ("POST", f"/api/v1/erp/finance/events/{b['event_id']}/refund-deposit", {"payment_method": "CASH"}),
            ("POST", f"/api/v1/erp/ops/events/{b['event_id']}/close-operation", {"closing_remarks": "Cross tenant check", "force_close": True}),
            ("GET", f"/api/v1/tenant/clients/{b['client_id']}/overview", None),
            ("POST", f"/api/v1/tenant/clients/{b['client_id']}/archive", {"reason": "Cross tenant check"}),
            ("POST", f"/api/v1/tenant/clients/{b['client_id']}/unarchive", None),
            ("POST", f"/api/v1/events/{b['event_id']}/contract/generate-ai", {"custom_clauses_notes": "Cross tenant check"}),
            ("PATCH", f"/api/v1/events/{b['event_id']}/contract", {"terms_en": "tampered"}),
            ("POST", f"/api/v1/erp/events/{b['event_id']}/contract/countersign", None),
        ]
        for method, path, payload in cross_checks:
            resp = await client.request(method, path, headers=hdr_a, json=payload)
            assert resp.status_code == 404, f"Expected 404 for {method} {path}, got {resp.status_code}: {resp.text}"

        # Same-tenant notification ownership isolation: other client gets 404, recipient client gets 200
        assert (
            await client.post(f"/api/v1/notifications/{b['notif_id']}/read", headers=hdr_b_other_client)
        ).status_code == 404
        assert (
            await client.post(f"/api/v1/notifications/{b['notif_id']}/read", headers=hdr_b_client)
        ).status_code == 200

        # 3. HOLD_48H booking -> public upload_token -> replay 403 -> finance return -> client re-upload -> verify -> PAID blocks upload (409)
        hold_start = (datetime.now(timezone.utc) + timedelta(days=45)).replace(hour=17, minute=0, second=0, microsecond=0)
        hold_end = hold_start + timedelta(hours=5)
        r_hold = await client.post(
            "/api/v1/bookings/hold",
            headers={"X-Tenant-Slug": slug_a},
            json={
                "hall_id": str(a["hall_id"]),
                "event_type": "WEDDING",
                "event_title": "Public Hold Phase 6 Test",
                "payment_mode": "HOLD_48H",
                "start_time": hold_start.isoformat(),
                "end_time": hold_end.isoformat(),
                "guest_count": 120,
                "client_full_name": "Nasser Al-Harbi",
                "client_phone": "+967779888777",
                "client_password": "HoldPassword123!",
                "client_category": "INDIVIDUAL_B2C",
            },
        )
        assert r_hold.status_code == 200, r_hold.text
        hold_data = r_hold.json()
        assert hold_data["status"] == "HOLD_48H"
        assert hold_data["hold_expires_at"] is not None
        hold_event_id = hold_data["event_id"]
        first_ms = next(m for m in hold_data["milestones"] if not m["is_security_deposit"])

        # Upload once via public one-time upload_token
        r_pub_up = await client.post(
            f"/api/v1/public/milestones/{first_ms['id']}/receipt",
            headers={"X-Tenant-Slug": slug_a},
            data={"upload_token": first_ms["upload_token"], "payment_method": "KURAIMI_BANK", "transfer_reference": "PUB-001"},
            files={"receipt": ("proof.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )
        assert r_pub_up.status_code == 200, r_pub_up.text
        assert r_pub_up.json()["status"] == "UNDER_REVIEW"

        # Replay of one-time token fails (403)
        r_pub_replay = await client.post(
            f"/api/v1/public/milestones/{first_ms['id']}/receipt",
            headers={"X-Tenant-Slug": slug_a},
            data={"upload_token": first_ms["upload_token"]},
            files={"receipt": ("proof.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )
        assert r_pub_replay.status_code == 403

        # Finance returns milestone for amendment
        r_ms_ret = await client.patch(
            f"/api/v1/erp/finance/milestones/{first_ms['id']}/return",
            headers=hdr_a,
            json={"remarks": "Receipt cropped, upload full transfer voucher"},
        )
        assert r_ms_ret.status_code == 200, r_ms_ret.text
        assert r_ms_ret.json()["status"] == "RETURNED_FOR_AMENDMENT"

        # New client logs in with chosen password -> checks hold_expires_at on portal -> re-uploads receipt
        r_login = await client.post(
            "/api/v1/auth/login",
            headers={"X-Tenant-Slug": slug_a},
            json={"identifier": "+967779888777", "password": "HoldPassword123!"},
        )
        assert r_login.status_code == 200, r_login.text
        hdr_new_client = {
            "Authorization": f"Bearer {r_login.json()['access_token']}",
            "X-Tenant-Slug": slug_a,
        }

        portal_evs = (await client.get("/api/v1/portal/events", headers=hdr_new_client)).json()
        held_ev = next(e for e in portal_evs if e["id"] == hold_event_id)
        assert held_ev["status"] == "HOLD_48H"
        assert held_ev["hold_expires_at"] is not None
        assert held_ev["invoice"]["milestones"][0]["status"] == "RETURNED_FOR_AMENDMENT"

        r_reup = await client.post(
            f"/api/v1/portal/milestones/{first_ms['id']}/receipt",
            headers=hdr_new_client,
            data={"payment_method": "BANK_TRANSFER", "transfer_reference": "FIX-002"},
            files={"receipt": ("proof2.png", b"\x89PNG\r\n\x1a\nfake2", "image/png")},
        )
        assert r_reup.status_code == 200, r_reup.text
        assert r_reup.json()["status"] == "UNDER_REVIEW"

        # Remarks cleared & finance notified
        portal_after = (await client.get("/api/v1/portal/events", headers=hdr_new_client)).json()
        held_after = next(e for e in portal_after if e["id"] == hold_event_id)
        assert held_after["invoice"]["milestones"][0]["reviewer_remarks"] is None

        fin_notifs = (await client.get("/api/v1/notifications", headers=hdr_a)).json()
        assert any(n["category"] == "PAYMENT_PROOF_UPLOADED" for n in fin_notifs["items"])

        # Finance verifies milestone -> subsequent client re-upload blocked (409)
        r_ver = await client.patch(
            f"/api/v1/erp/finance/milestones/{first_ms['id']}/verify",
            headers=hdr_a,
            json={"payment_method": "BANK_TRANSFER", "is_security_deposit": False, "reference": "FIX-002"},
        )
        assert r_ver.status_code == 200, r_ver.text

        r_paid_block = await client.post(
            f"/api/v1/portal/milestones/{first_ms['id']}/receipt",
            headers=hdr_new_client,
            data={"payment_method": "BANK_TRANSFER"},
            files={"receipt": ("proof3.png", b"\x89PNG\r\n\x1a\nfake3", "image/png")},
        )
        assert r_paid_block.status_code == 409

        # 4. Bilingual Tenant Name Localization in AI Contracts & Branded PDFs
        r_ai = await client.post(
            f"/api/v1/events/{a['event_id']}/contract/generate-ai",
            headers=hdr_a,
            json={"custom_clauses_notes": "Phase 6 bilingual clause test."},
        )
        assert r_ai.status_code == 200, r_ai.text
        ai_c = r_ai.json()
        assert "قصر الاختبار" in ai_c["terms_ar"]
        assert "Royal Test Venue" not in ai_c["terms_ar"]
        assert "Royal Test Venue" in ai_c["terms_en"]
        assert "قصر الاختبار" not in ai_c["terms_en"]

        for pdf_url in (
            f"/api/v1/exports/invoices/{a['invoice_id']}/pdf?locale=ar",
            f"/api/v1/exports/invoices/{a['invoice_id']}/pdf?locale=en",
            f"/api/v1/exports/contracts/{a['event_id']}/pdf?locale=ar",
            f"/api/v1/exports/contracts/{a['event_id']}/pdf?locale=en",
            f"/api/v1/exports/events/{a['event_id']}/deposit-settlement.pdf?locale=ar",
            f"/api/v1/exports/events/{a['event_id']}/deposit-settlement.pdf?locale=en",
            f"/api/v1/exports/events/{a['event_id']}/beo.pdf?locale=ar",
            f"/api/v1/exports/events/{a['event_id']}/beo.pdf?locale=en",
        ):
            rp = await client.get(pdf_url, headers=hdr_a)
            assert rp.status_code == 200, f"PDF failed for {pdf_url}: {rp.status_code} {rp.text}"
            assert rp.headers["content-type"].startswith("application/pdf")
            assert rp.content.startswith(b"%PDF-")
