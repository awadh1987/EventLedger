import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

_TEST_DB = "/tmp/eventledger_test_multihall_5yr.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "true"

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio

from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.accounting import AccountingConfig, AccountType, ChartOfAccount, default_normal_balance
from app.models.base import Base, utcnow
from app.models.tenant import SubscriptionTier, Tenant, TenantBranding
from app.models.users import StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService
from app.services.availability_service import AvailabilityService


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_mh_db():
    assert "sqlite" in str(engine.url), f"Refusing test DDL on non-sqlite URL: {engine.url}"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


async def _seed_tenant(db, slug: str):
    tenant = Tenant(
        name="قصر الاختبار | Test Palace",
        slug=slug,
        currency="YER",
        tax_rate=Decimal("0.00"),
        subscription_tier=SubscriptionTier.ENTERPRISE,
        settings={"defaultSecurityDeposit": 100000},
    )
    db.add(tenant)
    await db.flush()
    db.add(TenantBranding(tenant_id=tenant.id))

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
            tenant_id=tenant.id,
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
            tenant_id=tenant.id,
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
    await DoubleEntryService.ensure_fiscal_year_with_periods(db, tenant.id, utcnow().year)

    # Hall 1 (no forward pointer) & Hall 2 (points to Hall 1 to test bidirectional resolution), plus standalone Hall 3
    h1 = Hall(
        tenant_id=tenant.id,
        name="Hall 1 Main",
        name_ar="القاعة 1 الرئيسية",
        capacity_banquet=600,
        capacity_theater=900,
        base_price=Decimal("1000000.00"),
    )
    db.add(h1)
    await db.flush()
    h2 = Hall(
        tenant_id=tenant.id,
        name="Hall 2 Reception",
        name_ar="القاعة 2 للاستقبال",
        capacity_banquet=400,
        capacity_theater=600,
        base_price=Decimal("800000.00"),
        combinable_with_hall_id=h1.id,
    )
    h3 = Hall(
        tenant_id=tenant.id,
        name="Hall 3 Conference",
        name_ar="القاعة 3 للمؤتمرات",
        capacity_banquet=250,
        capacity_theater=400,
        base_price=Decimal("500000.00"),
    )
    admin_u = User(
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        phone=f"+967770{uuid.uuid4().hex[:6]}",
        email=f"admin@{slug}.test",
        password_hash=hash_password("Pass12345!"),
        full_name="Tenant Admin",
    )
    db.add_all([h2, h3, admin_u])
    await db.flush()
    db.add(StaffProfile(user_id=admin_u.id, role=StaffRole.ADMIN, department="MANAGEMENT"))
    await db.commit()
    return tenant, admin_u, h1, h2, h3


@pytest.mark.asyncio
async def test_multi_hall_independent_and_combined_bookings():
    slug = f"mh-{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        tenant, admin_u, h1, h2, h3 = await _seed_tenant(db, slug)
        h1_id, h2_id, h3_id = str(h1.id), str(h2.id), str(h3.id)
        admin_hdr = {
            "Authorization": f"Bearer {create_access_token(admin_u.id, tenant.id, UserType.INTERNAL_STAFF, StaffRole.ADMIN)}",
            "X-Tenant-Slug": slug,
        }

    pub_hdr = {"X-Tenant-Slug": slug}
    base_day = (datetime.now(timezone.utc) + timedelta(days=20)).replace(hour=17, minute=0, second=0, microsecond=0)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Storefront resolves bidirectional combinable_with_hall_id on Hall 1 -> Hall 2
        sf = (await client.get(f"/api/v1/public/tenants/{slug}/storefront")).json()
        sf_h1 = next(h for h in sf["halls"] if h["id"] == h1_id)
        assert sf_h1["combinable_with_hall_id"] == h2_id

        # 1. Single-hall bookings on combinable Hall 1 AND Hall 2 on the SAME date & evening MUST both succeed
        r_b1 = await client.post(
            "/api/v1/bookings/hold",
            headers=pub_hdr,
            json={
                "hall_id": h1_id,
                "merge_combinable_hall": False,
                "event_type": "WEDDING",
                "start_time": base_day.isoformat(),
                "end_time": (base_day + timedelta(hours=6)).isoformat(),
                "guest_count": 300,
                "client_full_name": "Client Hall One",
                "client_phone": "+967771110001",
                "client_password": "Password123!",
            },
        )
        assert r_b1.status_code == 200, r_b1.text
        assert r_b1.json()["hall_ids"] == [h1_id]

        r_b2 = await client.post(
            "/api/v1/bookings/hold",
            headers=pub_hdr,
            json={
                "hall_id": h2_id,
                "merge_combinable_hall": False,
                "event_type": "WEDDING",
                "start_time": base_day.isoformat(),
                "end_time": (base_day + timedelta(hours=6)).isoformat(),
                "guest_count": 200,
                "client_full_name": "Client Hall Two",
                "client_phone": "+967771110002",
                "client_password": "Password123!",
            },
        )
        assert r_b2.status_code == 200, r_b2.text
        assert r_b2.json()["hall_ids"] == [h2_id]

        # Attempting combined booking on Hall 1 + Hall 2 at occupied base_day fails (409)
        r_comb_conflict = await client.post(
            "/api/v1/bookings/hold",
            headers=pub_hdr,
            json={
                "hall_id": h1_id,
                "merge_combinable_hall": True,
                "event_type": "GALA",
                "start_time": base_day.isoformat(),
                "end_time": (base_day + timedelta(hours=6)).isoformat(),
                "guest_count": 700,
                "client_full_name": "Blocked Merge Client",
                "client_phone": "+967771110003",
            },
        )
        assert r_comb_conflict.status_code == 409

        # 2. Combined Hall 1 + Hall 2 on day_b blocks BOTH Hall 1 & Hall 2 while Hall 3 remains free
        day_b = base_day + timedelta(days=5)
        r_merge = await client.post(
            "/api/v1/bookings/hold",
            headers=pub_hdr,
            json={
                "hall_id": h1_id,
                "merge_combinable_hall": True,
                "event_title": "Grand Royal Merged Wedding",
                "event_type": "WEDDING",
                "start_time": day_b.isoformat(),
                "end_time": (day_b + timedelta(hours=6)).isoformat(),
                "guest_count": 850,
                "client_full_name": "Merged Client",
                "client_phone": "+967771110004",
                "client_password": "Password123!",
            },
        )
        assert r_merge.status_code == 200, r_merge.text
        merge_data = r_merge.json()
        assert set(merge_data["hall_ids"]) == {h1_id, h2_id}
        assert merge_data["quote"]["merged_hall_addon"] == 680000.0  # 800,000 * 0.85

        # Calendar reflects EVENING_17_23 & FULL_DAY unavailable on both Hall 1 and Hall 2, but available on Hall 3
        cal = (
            await client.get(
                f"/api/v1/public/calendar/three-month?tenant_slug={slug}&start_date={day_b.date().isoformat()}&months=1"
            )
        ).json()
        h1_entry = cal["days"][h1_id][0]
        h2_entry = cal["days"][h2_id][0]
        h3_entry = cal["days"][h3_id][0]
        assert "EVENING_17_23" not in h1_entry["available_slots"]
        assert "EVENING_17_23" not in h2_entry["available_slots"]
        assert "EVENING_17_23" in h3_entry["available_slots"]

        # Single-hall booking on Hall 2 on day_b conflicts (409), while Hall 3 succeeds (200)
        assert (
            await client.post(
                "/api/v1/bookings/hold",
                headers=pub_hdr,
                json={
                    "hall_id": h2_id,
                    "event_type": "WEDDING",
                    "start_time": day_b.isoformat(),
                    "end_time": (day_b + timedelta(hours=6)).isoformat(),
                    "guest_count": 150,
                    "client_full_name": "Blocked H2 Client",
                    "client_phone": "+967771110005",
                },
            )
        ).status_code == 409

        r_h3 = await client.post(
            "/api/v1/bookings/hold",
            headers=pub_hdr,
            json={
                "hall_id": h3_id,
                "event_type": "CONFERENCE",
                "start_time": day_b.isoformat(),
                "end_time": (day_b + timedelta(hours=6)).isoformat(),
                "guest_count": 180,
                "client_full_name": "Hall 3 Conference",
                "client_phone": "+967771110006",
            },
        )
        assert r_h3.status_code == 200, r_h3.text

        # Staff events list & finance invoices show combined hall_ids & combined hall names
        staff_evs = (await client.get("/api/v1/bookings/events", headers=admin_hdr)).json()
        merged_ev_row = next(e for e in staff_evs if e["id"] == merge_data["event_id"])
        assert set(merged_ev_row["hall_ids"]) == {h1_id, h2_id}
        assert "Hall 1 Main" in merged_ev_row["hall_name"] and "Hall 2 Reception" in merged_ev_row["hall_name"]

        # 3. Explicit multi-hall selection via hall_ids=[Hall 1, Hall 3]
        day_c = base_day + timedelta(days=10)
        r_explicit = await client.post(
            "/api/v1/bookings/hold",
            headers=pub_hdr,
            json={
                "hall_id": h1_id,
                "hall_ids": [h1_id, h3_id],
                "event_type": "CONFERENCE",
                "start_time": day_c.isoformat(),
                "end_time": (day_c + timedelta(hours=5)).isoformat(),
                "guest_count": 500,
                "client_full_name": "Multi Explicit Client",
                "client_phone": "+967771110007",
            },
        )
        assert r_explicit.status_code == 200, r_explicit.text
        assert set(r_explicit.json()["hall_ids"]) == {h1_id, h3_id}
        assert r_explicit.json()["quote"]["merged_hall_addon"] == 425000.0  # 500,000 * 0.85

        # Hall 3 blocked on day_c, Hall 2 available
        assert (
            await client.post(
                "/api/v1/bookings/hold",
                headers=pub_hdr,
                json={
                    "hall_id": h3_id,
                    "event_type": "CONFERENCE",
                    "start_time": day_c.isoformat(),
                    "end_time": (day_c + timedelta(hours=5)).isoformat(),
                    "guest_count": 100,
                    "client_full_name": "Blocked H3 Client",
                    "client_phone": "+967771110008",
                },
            )
        ).status_code == 409
        assert (
            await client.post(
                "/api/v1/bookings/hold",
                headers=pub_hdr,
                json={
                    "hall_id": h2_id,
                    "event_type": "WEDDING",
                    "start_time": day_c.isoformat(),
                    "end_time": (day_c + timedelta(hours=5)).isoformat(),
                    "guest_count": 150,
                    "client_full_name": "Open H2 Client",
                    "client_phone": "+967771110009",
                },
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_5_year_booking_horizon_and_bounds():
    slug = f"yr5-{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        tenant, admin_u, h1, _, _ = await _seed_tenant(db, slug)
        h1_id = str(h1.id)
        admin_hdr = {
            "Authorization": f"Bearer {create_access_token(admin_u.id, tenant.id, UserType.INTERNAL_STAFF, StaffRole.ADMIN)}",
            "X-Tenant-Slug": slug,
        }

    pub_hdr = {"X-Tenant-Slug": slug}
    today_utc = datetime.now(timezone.utc).date()
    max_valid_date = AvailabilityService.add_calendar_months(today_utc, 60)
    beyond_5yr_date = AvailabilityService.add_calendar_months(today_utc, 61)
    past_date = today_utc - timedelta(days=2)

    d_1yr = AvailabilityService.add_calendar_months(today_utc, 12)
    d_2yr = AvailabilityService.add_calendar_months(today_utc, 24)
    d_5yr = max_valid_date

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1-year, 2-year, and exact 5-year (60-month) calendar + availability + booking all succeed
        for idx, target_d in enumerate((d_1yr, d_2yr, d_5yr), start=1):
            start_dt = datetime.combine(target_d, datetime.min.time()).replace(hour=17)
            end_dt = datetime.combine(target_d, datetime.min.time()).replace(hour=23)

            r_cal = await client.get(
                f"/api/v1/public/calendar/three-month?tenant_slug={slug}&start_date={target_d.isoformat()}&months=1"
            )
            assert r_cal.status_code == 200, r_cal.text
            assert r_cal.json()["days"][h1_id][0]["status"] == "AVAILABLE"

            r_avail = await client.get(
                "/api/v1/public/halls/availability",
                headers=pub_hdr,
                params={"hall_id": h1_id, "start_time": start_dt.isoformat(), "end_time": end_dt.isoformat()},
            )
            assert r_avail.status_code == 200, r_avail.text
            assert r_avail.json()["availability"]["available"] is True

            r_hold = await client.post(
                "/api/v1/bookings/hold",
                headers=pub_hdr,
                json={
                    "hall_id": h1_id,
                    "event_title": f"Future Horizon Y+{idx}",
                    "event_type": "WEDDING",
                    "start_time": start_dt.isoformat(),
                    "end_time": end_dt.isoformat(),
                    "guest_count": 200,
                    "client_full_name": f"Future Client {idx}",
                    "client_phone": f"+9677790055{idx:02d}",
                },
            )
            assert r_hold.status_code == 200, r_hold.text

        # Trial balance stays balanced with auto-provisioned future fiscal period accruals
        tb = (await client.get("/api/v1/finance/trial-balance", headers=admin_hdr)).json()
        assert tb["is_balanced"] is True

        # Past date rejected (400)
        past_start = datetime.combine(past_date, datetime.min.time()).replace(hour=17)
        past_end = datetime.combine(past_date, datetime.min.time()).replace(hour=23)
        assert (
            await client.get(
                "/api/v1/public/halls/availability",
                headers=pub_hdr,
                params={"hall_id": h1_id, "start_time": past_start.isoformat(), "end_time": past_end.isoformat()},
            )
        ).status_code == 400
        assert (
            await client.post(
                "/api/v1/bookings/hold",
                headers=pub_hdr,
                json={
                    "hall_id": h1_id,
                    "event_type": "WEDDING",
                    "start_time": past_start.isoformat(),
                    "end_time": past_end.isoformat(),
                    "guest_count": 100,
                    "client_full_name": "Past Client",
                    "client_phone": "+967779005598",
                },
            )
        ).status_code == 400

        # Beyond 5 years (61 months) rejected (400) on calendar, availability, and hold
        far_start = datetime.combine(beyond_5yr_date, datetime.min.time()).replace(hour=17)
        far_end = datetime.combine(beyond_5yr_date, datetime.min.time()).replace(hour=23)
        assert (
            await client.get(
                f"/api/v1/public/calendar/three-month?tenant_slug={slug}&start_date={beyond_5yr_date.isoformat()}&months=1"
            )
        ).status_code == 400
        assert (
            await client.get(
                "/api/v1/public/halls/availability",
                headers=pub_hdr,
                params={"hall_id": h1_id, "start_time": far_start.isoformat(), "end_time": far_end.isoformat()},
            )
        ).status_code == 400
        assert (
            await client.post(
                "/api/v1/bookings/hold",
                headers=pub_hdr,
                json={
                    "hall_id": h1_id,
                    "event_type": "WEDDING",
                    "start_time": far_start.isoformat(),
                    "end_time": far_end.isoformat(),
                    "guest_count": 100,
                    "client_full_name": "Too Far Client",
                    "client_phone": "+967779005599",
                },
            )
        ).status_code == 400
