import os
import uuid
from datetime import datetime, timedelta, timezone

_TEST_DB = "/tmp/eventledger_test_phase4.db"
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
from app.models.events import Event, EventStatus
from app.models.tenant import SubscriptionTier, Tenant
from app.models.users import StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_phase4_db():
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


@pytest.mark.asyncio
async def test_phase4_calendar_clients_security_deposit_and_close_operation():
    slug = f"p4-{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Phase 4 Royal Venue",
            slug=slug,
            subscription_tier=SubscriptionTier.ENTERPRISE,
            currency="USD",
            settings={"defaultSecurityDeposit": 300},
        )
        db.add(tenant)
        await db.flush()
        await _seed_coa(db, tenant.id)

        admin_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Tenant Admin",
            phone="+967774400001",
            email="admin@p4.local",
            password_hash=hash_password("AdminPass123!"),
        )
        sec_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Head of Security",
            phone="+967774400002",
            email="sec@p4.local",
            password_hash=hash_password("SecPass123!"),
        )
        hall = Hall(
            tenant_id=tenant.id,
            name="Sapphire Grand Hall",
            name_ar="قاعة الياقوت الكبرى",
            capacity_banquet=350,
            capacity_theater=500,
            base_price=1500,
            cleaning_buffer_minutes=120,
        )
        db.add_all([admin_u, sec_u, hall])
        await db.flush()
        db.add_all([
            StaffProfile(user_id=admin_u.id, role=StaffRole.ADMIN, department="MANAGEMENT"),
            StaffProfile(user_id=sec_u.id, role=StaffRole.SECURITY, department="SECURITY"),
        ])
        await db.commit()

    admin_hdr = {
        "Authorization": f"Bearer {create_access_token(user_id=admin_u.id, tenant_id=tenant.id, user_type=UserType.INTERNAL_STAFF, staff_role=StaffRole.ADMIN)}",
        "X-Tenant-Slug": slug,
    }
    sec_hdr = {
        "Authorization": f"Bearer {create_access_token(user_id=sec_u.id, tenant_id=tenant.id, user_type=UserType.INTERNAL_STAFF, staff_role=StaffRole.SECURITY)}",
        "X-Tenant-Slug": slug,
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create Client via Rich Clients Control Panel + custom classification & notes
        res_cli = await client.post(
            "/api/v1/tenant/clients",
            headers=admin_hdr,
            json={
                "full_name": "Tariq Al-Harbi",
                "phone": "+967779112233",
                "email": "tariq@p4.local",
                "password": "ClientPass123!",
                "client_category": "CORPORATE_B2B",
                "custom_category_label": "Diplomatic Mission",
                "vip_tier": "ROYAL_TIER",
                "company_name": "Harbi Holdings",
                "tax_id": "TAX-7788",
                "notes": "Requires VIP rear entrance",
            },
        )
        assert res_cli.status_code in (200, 201), res_cli.text
        client_id = res_cli.json()["id"]
        assert res_cli.json()["custom_category_label"] == "Diplomatic Mission"
        assert res_cli.json()["notes"] == "Requires VIP rear entrance"

        # 2. Book an event today (so gate check-in is within time window) & verify enriched calendar payload
        now_utc = datetime.now(timezone.utc)
        ev_start = (now_utc + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        ev_end = ev_start + timedelta(hours=4)

        res_hold = await client.post(
            "/api/v1/bookings/hold",
            headers={"X-Tenant-Slug": slug},
            json={
                "hall_id": str(hall.id),
                "event_title": "Diplomatic Reception",
                "event_type": "GALA",
                "start_time": ev_start.replace(tzinfo=None).isoformat(),
                "end_time": ev_end.replace(tzinfo=None).isoformat(),
                "guest_count": 200,
                "payment_mode": "HOLD_48H",
                "selected_payment_method": "PAY_LATER_48H",
                "client_full_name": "Tariq Al-Harbi",
                "client_phone": "+967779112233",
                "client_email": "tariq@p4.local",
                "client_password": "ClientPass123!",
                "client_auth_mode": "LOGIN",
            },
        )
        assert res_hold.status_code in (200, 201), res_hold.text
        hold = res_hold.json()
        event_id = hold["event_id"]
        client_hdr = {"Authorization": f"Bearer {hold['access_token']}", "X-Tenant-Slug": slug}

        # Verify enriched Outlook calendar payload includes owner name, title, security_status & deposit_status
        cal_evs = (await client.get("/api/v1/bookings/events", headers=admin_hdr)).json()
        ev_row = next(e for e in cal_evs if e["id"] == event_id)
        assert ev_row["client_name"] == "Tariq Al-Harbi"
        assert ev_row["title"] == "Diplomatic Reception"
        assert ev_row["security_status"] == "DRAFT"
        assert ev_row["deposit_status"] == "UNPAID"

        # Verify 360 client dossier
        ov_res = await client.get(f"/api/v1/tenant/clients/{client_id}/overview", headers=admin_hdr)
        assert ov_res.status_code == 200, ov_res.text
        ov = ov_res.json()
        assert len(ov["bookings"]) == 1
        assert len(ov["invoices"]) == 1
        assert len(ov["contracts"]) == 1

        # 3. Events & Halls Security Control Plane: Readiness + Bidirectional Return-for-Amendment
        res_rd1 = await client.put(
            f"/api/v1/security/events/{event_id}/readiness",
            headers=sec_hdr,
            json={
                "readiness_checklist_json": {"fire_and_exits": True, "cctv_and_lighting": True},
                "guard_headcount": 6,
                "security_lead_name": "Capt. Nasser",
                "security_status": "RETURNED_FOR_AMENDMENT",
                "tenant_remarks": "Need plate numbers for catering trucks",
                "amendment_reason": "Upload vendor vehicle plate & ID",
            },
        )
        assert res_rd1.status_code == 200, res_rd1.text
        assert res_rd1.json()["security_status"] == "RETURNED_FOR_AMENDMENT"

        res_c_rem = await client.patch(
            f"/api/v1/security/events/{event_id}/client-remarks",
            headers=client_hdr,
            json={"client_remarks": "Truck plate YEM-4421 confirmed", "resubmit": True},
        )
        assert res_c_rem.status_code == 200
        assert res_c_rem.json()["security_status"] == "PENDING_REVIEW"

        res_rd2 = await client.put(
            f"/api/v1/security/events/{event_id}/readiness",
            headers=sec_hdr,
            json={
                "readiness_checklist_json": {"fire_and_exits": True, "cctv_and_lighting": True, "guard_roster_assigned": True},
                "guard_headcount": 6,
                "security_lead_name": "Capt. Nasser",
                "security_status": "CLEARED",
                "tenant_remarks": "All gates cleared",
            },
        )
        assert res_rd2.status_code == 200
        assert res_rd2.json()["security_status"] == "CLEARED"

        # Client requests custom vendor clearance -> PENDING_APPROVAL -> gate check-in blocked -> return -> amend -> approve -> admitted -> revoke -> blocked
        res_pass = await client.post(
            f"/api/v1/security/events/{event_id}/passes",
            headers=client_hdr,
            json={
                "clearance_category": "AUDIO_CREW",
                "holder_name": "Samir Lighting Tech",
                "organization": "ProStage YE",
                "vehicle_plate": "YEM-4421",
                "remarks": "Main stage setup",
            },
        )
        assert res_pass.status_code in (200, 201), res_pass.text
        pass_obj = res_pass.json()
        assert pass_obj["clearance_status"] == "PENDING_APPROVAL"

        # Gate blocks pending pass
        g1 = await client.post("/api/v1/gate/check-in", headers=sec_hdr, json={"qr_token": pass_obj["qr_token"]})
        assert g1.json()["result"] == "CLEARANCE_PENDING_APPROVAL"

        # Staff returns for amendment with remarks -> client amends & resubmits -> staff approves -> gate admits -> revoke blocks
        p_ret = await client.patch(
            f"/api/v1/security/passes/{pass_obj['id']}",
            headers=sec_hdr,
            json={"clearance_status": "RETURNED_FOR_AMENDMENT", "remarks": "Missing national ID number"},
        )
        assert p_ret.json()["clearance_status"] == "RETURNED_FOR_AMENDMENT"

        p_amend = await client.patch(
            f"/api/v1/security/passes/{pass_obj['id']}",
            headers=client_hdr,
            json={"holder_id_number": "ID-998811", "remarks": "ID added", "resubmit": True},
        )
        assert p_amend.json()["clearance_status"] == "PENDING_APPROVAL"
        assert p_amend.json()["holder_id_number"] == "ID-998811"

        p_app = await client.patch(
            f"/api/v1/security/passes/{pass_obj['id']}",
            headers=sec_hdr,
            json={"clearance_status": "APPROVED"},
        )
        assert p_app.json()["clearance_status"] == "APPROVED"

        g2 = await client.post("/api/v1/gate/check-in", headers=sec_hdr, json={"qr_token": pass_obj["qr_token"]})
        assert g2.json()["result"] == "ADMITTED"

        # Revoked pass cannot check in via batch or gate
        p_rev = await client.patch(
            f"/api/v1/security/passes/{pass_obj['id']}",
            headers=sec_hdr,
            json={"clearance_status": "REVOKED", "is_checked_in": False, "remarks": "Shift ended"},
        )
        assert p_rev.json()["clearance_status"] == "REVOKED"
        g3 = await client.post("/api/v1/gate/check-in", headers=sec_hdr, json={"qr_token": pass_obj["qr_token"]})
        assert g3.json()["result"] == "CLEARANCE_REVOKED"

        # 4. Security Deposit Lifecycle: Verify deposit held -> Itemized inspection -> Client Return for Amendment -> Finalize -> Refund -> Close Operation -> Reopen
        sec_ms = next(m for m in hold["milestones"] if m["is_security_deposit"])
        r_ver = await client.patch(
            f"/api/v1/erp/finance/milestones/{sec_ms['id']}/verify",
            headers=admin_hdr,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": True},
        )
        assert r_ver.status_code == 200, r_ver.text

        # Close operation while deposit is still HELD must fail with 400 unless force_close=True
        r_close_blocked = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/close-operation",
            headers=admin_hdr,
            json={"closing_remarks": "Attempt early close", "force_close": False},
        )
        assert r_close_blocked.status_code == 400

        # Draft/Client Review itemized deduction
        r_insp1 = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/inspection",
            headers=admin_hdr,
            json={
                "status": "DAMAGE_CLAIMED",
                "deduction_items": [
                    {"category": "DECOR_STAIN", "description": "Carpet stain repair", "amount": 50.0, "remarks": "Main aisle"},
                ],
                "notes": "Submitted for client confirmation",
                "workflow_action": "SUBMIT_FOR_CLIENT_REVIEW",
            },
        )
        assert r_insp1.status_code == 200, r_insp1.text
        assert r_insp1.json()["approval_status"] == "PENDING_CLIENT_REVIEW"

        # Client returns inspection for amendment
        r_cli_resp = await client.post(
            f"/api/v1/portal/events/{event_id}/inspection/respond",
            headers=client_hdr,
            json={"decision": "RETURN_FOR_AMENDMENT", "client_remarks": "Carpet stain cleaned before exit, please adjust to $25"},
        )
        assert r_cli_resp.status_code == 200
        assert r_cli_resp.json()["approval_status"] == "RETURNED_FOR_AMENDMENT"

        # Tenant adjusts deduction to 25 and finalizes
        r_insp_fin = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/inspection",
            headers=admin_hdr,
            json={
                "status": "DAMAGE_CLAIMED",
                "deduction_items": [
                    {"category": "DECOR_STAIN", "description": "Spot steam clean", "amount": 25.0},
                ],
                "notes": "Adjusted after review with client",
                "workflow_action": "FINALIZE",
            },
        )
        assert r_insp_fin.status_code == 200, r_insp_fin.text
        assert r_insp_fin.json()["approval_status"] == "FINALIZED"
        assert r_insp_fin.json()["deposit_status"] == "DEDUCTED"
        assert r_insp_fin.json()["deduction_amount"] == 25.0

        r_refund = await client.post(
            f"/api/v1/erp/finance/events/{event_id}/refund-deposit",
            headers=admin_hdr,
            json={"payment_method": "KURAIMI_BANK", "remarks": "Net balance refunded to client"},
        )
        assert r_refund.status_code == 200, r_refund.text
        assert r_refund.json()["refund_amount"] == 275.0

        r_close_final = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/close-operation",
            headers=admin_hdr,
            json={"closing_remarks": "All settled, venue handed over cleanly"},
        )
        assert r_close_final.status_code == 200
        assert r_close_final.json()["status"] == "CLOSED"
        assert r_close_final.json()["is_locked"] is True

        # Portal sees CLOSED status & remarks
        portal_evs = (await client.get("/api/v1/portal/events", headers=client_hdr)).json()
        p_ev = next(x for x in portal_evs if x["id"] == event_id)
        assert p_ev["status"] == "CLOSED"
        assert p_ev["closing_remarks"] == "All settled, venue handed over cleanly"

        # Controlled Reopen by Admin
        r_reopen1 = await client.post(
            f"/api/v1/erp/ops/events/{event_id}/reopen-operation",
            headers=admin_hdr,
            json={"reason": "Client requested itemized PDF addendum"},
        )
        assert r_reopen1.status_code == 200
        assert r_reopen1.json()["is_locked"] is False
        assert r_reopen1.json()["status"] == "COMPLETED"
