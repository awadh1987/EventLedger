import os
import uuid
from datetime import datetime, timedelta, timezone

_TEST_DB = "/tmp/eventledger_test_phase3.db"
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
from app.models.tenant import SubscriptionTier, Tenant
from app.models.users import StaffProfile, StaffRole, User, UserType
from app.services.accounting_service import DoubleEntryService


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_phase3_db():
    assert "sqlite" in str(engine.url), f"Refusing test DDL on non-sqlite URL: {engine.url}"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


async def _seed_tenant_coa(db, tenant_id):
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


@pytest.mark.asyncio
async def test_phase3_catalog_lookups_other_and_custom_booking_line_items():
    slug = f"p3-{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Phase 3 Palace",
            slug=slug,
            subscription_tier=SubscriptionTier.PRO,
            currency="USD",
        )
        db.add(tenant)
        await db.flush()
        await _seed_tenant_coa(db, tenant.id)

        admin_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Catalog Admin",
            phone="+967773300001",
            email="admin@p3.local",
            password_hash=hash_password("AdminPass123!"),
        )
        staff_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Basic Staff",
            phone="+967773300002",
            email="staff@p3.local",
            password_hash=hash_password("StaffPass123!"),
        )
        db.add_all([admin_u, staff_u])
        await db.flush()
        db.add_all([
            StaffProfile(user_id=admin_u.id, role=StaffRole.ADMIN, department="MANAGEMENT"),
            StaffProfile(user_id=staff_u.id, role=StaffRole.STAFF, department="OPS"),
        ])
        await db.commit()

    admin_hdr = {
        "Authorization": f"Bearer {create_access_token(user_id=admin_u.id, tenant_id=tenant.id, user_type=UserType.INTERNAL_STAFF, staff_role=StaffRole.ADMIN)}",
        "X-Tenant-Slug": slug,
    }
    staff_hdr = {
        "Authorization": f"Bearer {create_access_token(user_id=staff_u.id, tenant_id=tenant.id, user_type=UserType.INTERNAL_STAFF, staff_role=StaffRole.STAFF)}",
        "X-Tenant-Slug": slug,
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Seed starter catalog & verify idempotency
        res_seed1 = await client.post("/api/v1/venue/catalog/seed-defaults", headers=admin_hdr)
        assert res_seed1.status_code == 200, res_seed1.text
        added1 = res_seed1.json()["added"]
        assert added1["lookups"] >= 10
        assert added1["catering"] == 3
        assert added1["inventory"] == 5
        assert added1["pricing_rules"] == 1

        res_seed2 = await client.post("/api/v1/venue/catalog/seed-defaults", headers=admin_hdr)
        assert res_seed2.status_code == 200
        assert res_seed2.json()["added"] == {"lookups": 0, "catering": 0, "inventory": 0, "pricing_rules": 0}

        # Staff without catalog permission cannot mutate catalog
        res_denied = await client.post(
            "/api/v1/venue/catering",
            headers=staff_hdr,
            json={"name_ar": "مرفوض", "name_en": "Denied", "price_per_guest": 10, "cost_per_guest": 5},
        )
        assert res_denied.status_code == 403

        # 2. Custom "Other" lookup promotion & full CRUD + safe delete
        res_custom = await client.post(
            "/api/v1/lookups/custom",
            headers=admin_hdr,
            json={"category": "EVENT_TYPE", "label_ar": "أمسية شعرية", "label_en": "Poetry Gala"},
        )
        assert res_custom.status_code in (200, 201), res_custom.text
        lookup_id = res_custom.json()["id"]
        custom_code = res_custom.json()["code"]

        res_patch_lk = await client.patch(
            f"/api/v1/lookups/{lookup_id}",
            headers=admin_hdr,
            json={"label_en": "Poetry Evening Gala", "sort_order": 99},
        )
        assert res_patch_lk.status_code == 200
        assert res_patch_lk.json()["status"] == "UPDATED"
        all_lk = (await client.get("/api/v1/lookups?include_inactive=true", headers=admin_hdr)).json()
        assert next(x for x in all_lk if x["id"] == lookup_id)["label_en"] == "Poetry Evening Gala"

        # Unused lookup deletes permanently; then re-create and use it in a booking to verify ARCHIVED_IN_USE
        res_del_unused = await client.delete(f"/api/v1/lookups/{lookup_id}", headers=admin_hdr)
        assert res_del_unused.status_code == 200
        assert res_del_unused.json()["status"] == "DELETED"

        res_custom2 = await client.post(
            "/api/v1/lookups/custom",
            headers=admin_hdr,
            json={"category": "EVENT_TYPE", "code": custom_code, "label_ar": "أمسية شعرية", "label_en": "Poetry Gala"},
        )
        assert res_custom2.status_code in (200, 201)
        lookup2_id = res_custom2.json()["id"]

        # 3. Hall CRUD + DRAFT/ARCHIVED hiding on public endpoints
        res_hall_pub = await client.post(
            "/api/v1/venue/halls",
            headers=admin_hdr,
            json={
                "name": "Grand Crown Hall",
                "name_ar": "قاعة التاج الكبرى",
                "capacity_banquet": 400,
                "capacity_theater": 600,
                "base_price": 1200,
                "cleaning_buffer_minutes": 120,
                "lifecycle": "ACTIVE",
            },
        )
        assert res_hall_pub.status_code in (200, 201), res_hall_pub.text
        active_hall_id = res_hall_pub.json()["id"]

        res_hall_draft = await client.post(
            "/api/v1/venue/halls",
            headers=admin_hdr,
            json={
                "name": "Secret Draft Hall",
                "name_ar": "قاعة مسودة",
                "capacity_banquet": 100,
                "capacity_theater": 150,
                "base_price": 500,
                "cleaning_buffer_minutes": 90,
                "lifecycle": "DRAFT",
            },
        )
        assert res_hall_draft.status_code in (200, 201)
        draft_hall_id = res_hall_draft.json()["id"]

        pub_tenant = await client.get(f"/api/v1/public/tenants/{slug}")
        assert pub_tenant.status_code == 200
        pub_hall_ids = [h["id"] for h in pub_tenant.json()["halls"]]
        assert active_hall_id in pub_hall_ids
        assert draft_hall_id not in pub_hall_ids

        pub_cal = await client.get(f"/api/v1/public/calendar/three-month?tenant_slug={slug}")
        assert pub_cal.status_code == 200
        cal_hall_ids = [h["id"] for h in pub_cal.json()["tenants"][0]["halls"]]
        assert active_hall_id in cal_hall_ids
        assert draft_hall_id not in cal_hall_ids

        # Unused draft hall deletes cleanly
        res_del_draft = await client.delete(f"/api/v1/venue/halls/{draft_hall_id}", headers=admin_hdr)
        assert res_del_draft.status_code == 200
        assert res_del_draft.json()["status"] == "DELETED"

        # 4. Catering, Inventory, PricingRule CRUD
        res_cat = await client.post(
            "/api/v1/venue/catering",
            headers=admin_hdr,
            json={"name_ar": "بوفيه خاصة", "name_en": "Special Buffet", "price_per_guest": 25, "cost_per_guest": 12},
        )
        assert res_cat.status_code in (200, 201)
        cat_id = res_cat.json()["id"]
        assert (await client.patch(f"/api/v1/venue/catering/{cat_id}", headers=admin_hdr, json={"price_per_guest": 28})).status_code == 200
        assert (await client.delete(f"/api/v1/venue/catering/{cat_id}", headers=admin_hdr)).json()["status"] == "DELETED"

        res_inv = await client.post(
            "/api/v1/venue/inventory",
            headers=admin_hdr,
            json={"name": "Laser Projector", "category": "CUSTOM_FX", "total_stock": 4, "unit_addon_price": 150},
        )
        assert res_inv.status_code in (200, 201)
        inv_id = res_inv.json()["id"]
        assert (await client.patch(f"/api/v1/venue/inventory/{inv_id}", headers=admin_hdr, json={"total_stock": 6})).json()["status"] == "UPDATED"
        inv_rows = (await client.get("/api/v1/venue/inventory", headers=admin_hdr)).json()
        assert next(x for x in inv_rows if x["id"] == inv_id)["total_stock"] == 6
        assert (await client.delete(f"/api/v1/venue/inventory/{inv_id}", headers=admin_hdr)).json()["status"] == "DELETED"

        res_rule = await client.post(
            "/api/v1/venue/pricing-rules",
            headers=admin_hdr,
            json={"name": "Test Promo", "days_of_week": [5], "multiplier": 1.15, "is_active": True},
        )
        assert res_rule.status_code in (200, 201)
        rule_id = res_rule.json()["id"]
        assert (await client.patch(f"/api/v1/venue/pricing-rules/{rule_id}", headers=admin_hdr, json={"is_active": False})).json()["status"] == "UPDATED"
        rule_rows = (await client.get("/api/v1/venue/pricing-rules", headers=admin_hdr)).json()
        assert next(x for x in rule_rows if x["id"] == rule_id)["is_active"] is False
        assert (await client.delete(f"/api/v1/venue/pricing-rules/{rule_id}", headers=admin_hdr)).json()["status"] == "DELETED"

        # 5. Public Booking Hold with custom "Other" catering & custom free add-ons persisted on Invoice & Portal
        target_day = (datetime.now(timezone.utc) + timedelta(days=12)).date()
        start_iso = f"{target_day.isoformat()}T17:00:00"
        end_iso = f"{target_day.isoformat()}T23:00:00"

        hold_payload = {
            "hall_id": active_hall_id,
            "event_title": "Grand Poetry Evening",
            "event_type": custom_code,
            "start_time": start_iso,
            "end_time": end_iso,
            "guest_count": 180,
            "catering_guest_count": 150,
            "catering_notes": "Serve Arabic coffee on arrival",
            "custom_catering": {
                "title": "Chef Signature Heritage Tray",
                "price_per_guest": 10,
                "notes": "Custom halal heritage spread",
            },
            "custom_addons": [
                {"title": "Outdoor Coffee Corner", "quantity": 2, "unit_price": 0, "notes": "Complimentary request"},
                {"title": "Stage Carpet Upgrade", "quantity": 1, "unit_price": 100, "notes": "Royal crimson"},
            ],
            "payment_mode": "HOLD_48H",
            "selected_payment_method": "PAY_LATER_48H",
            "client_full_name": "Nadia Al-Mansoor",
            "client_phone": "+967779001122",
            "client_email": "nadia@p3.local",
            "client_password": "ClientPass123!",
            "client_auth_mode": "REGISTER",
        }
        res_hold = await client.post("/api/v1/bookings/hold", headers={"X-Tenant-Slug": slug}, json=hold_payload)
        assert res_hold.status_code in (200, 201), res_hold.text
        hold_data = res_hold.json()
        line_items = hold_data["invoice"]["line_items"]
        assert line_items["catering"]["title"] == "Chef Signature Heritage Tray"
        assert line_items["catering"]["is_custom_other"] is True
        assert line_items["catering"]["servings"] == 150
        assert len(line_items["custom_addons"]) == 2
        assert line_items["custom_addons"][0]["unit_price"] == 0.0

        # Active hall now has 1 event -> safe delete must ARCHIVED_IN_USE instead of deleting
        res_del_used_hall = await client.delete(f"/api/v1/venue/halls/{active_hall_id}", headers=admin_hdr)
        assert res_del_used_hall.status_code == 200
        assert res_del_used_hall.json()["status"] == "ARCHIVED_IN_USE"
        assert res_del_used_hall.json()["events_count"] >= 1

        # Lookup used in event -> safe delete must ARCHIVED_IN_USE
        res_del_used_lk = await client.delete(f"/api/v1/lookups/{lookup2_id}", headers=admin_hdr)
        assert res_del_used_lk.status_code == 200
        assert res_del_used_lk.json()["status"] == "ARCHIVED_IN_USE"

        # Verify invoice line_items visible in finance/invoices AND portal/events
        res_invs = await client.get("/api/v1/finance/invoices", headers=admin_hdr)
        assert res_invs.status_code == 200
        assert res_invs.json()[0]["line_items"]["catering"]["title"] == "Chef Signature Heritage Tray"

        portal_hdr = {"Authorization": f"Bearer {hold_data['access_token']}", "X-Tenant-Slug": slug}
        res_portal = await client.get("/api/v1/portal/events", headers=portal_hdr)
        assert res_portal.status_code == 200
        assert res_portal.json()[0]["invoice"]["line_items"]["custom_addons"][0]["title"] == "Outdoor Coffee Corner"
