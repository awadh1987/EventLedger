import hashlib
import hmac
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from decimal import Decimal

_TEST_DB = os.path.join(tempfile.gettempdir(), "eventledger_test.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "true"

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.main import app
from app.models.base import Base, RecordLifecycle
from app.models.tenant import Tenant
from app.models.venue import InventoryItem
from seed import seed_all


async def _fresh_seeded_client():
    assert "sqlite" in str(engine.url), f"Refusing destructive reset on non-SQLite DB: {engine.url}"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await seed_all()


async def _login_staff(client: AsyncClient, headers: dict, email: str, password: str) -> dict:
    r = await client.post("/api/v1/auth/login", headers=headers, json={"identifier": email, "password": password})
    assert r.status_code == 200, r.text
    return {**headers, "Authorization": f"Bearer {r.json()['access_token']}"}


async def _otp_login(client: AsyncClient, headers: dict, phone: str) -> dict:
    r = await client.post("/api/v1/auth/otp-request", headers=headers, json={"identifier": phone})
    assert r.status_code == 200, r.text
    dev_otp = r.json()["dev_otp"]
    r2 = await client.post("/api/v1/auth/otp-login", headers=headers, json={"identifier": phone, "otp_code": dev_otp})
    assert r2.status_code == 200, r2.text
    return {**headers, "Authorization": f"Bearer {r2.json()['access_token']}"}


@pytest.mark.asyncio
async def test_booking_accrual_addon_pricing_and_deposit_lifecycle():
    await _fresh_seeded_client()
    tenant_headers = {"X-Tenant-Slug": "almassa"}

    async with AsyncSessionLocal() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "almassa"))).scalar_one()
        inv_item = InventoryItem(
            tenant_id=tenant.id,
            name="Royal Floral Arch",
            category="DECOR",
            total_stock=5,
            unit_addon_price=Decimal("25000.00"),
            lifecycle=RecordLifecycle.ACTIVE,
        )
        db.add(inv_item)
        await db.commit()
        addon_item_id = str(inv_item.id)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        fin_headers = await _login_staff(client, tenant_headers, "finance@almassa.eventledger.local", "Finance@2026")
        ops_headers = await _login_staff(client, tenant_headers, "ops@almassa.eventledger.local", "Ops@2026")

        pub_tenant = (await client.get("/api/v1/public/tenants/almassa")).json()
        hall_id = pub_tenant["halls"][0]["id"]
        catering_id = pub_tenant["catering_items"][0]["id"]

        tb_before = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        ar_before = next(r for r in tb_before["rows"] if r["code"] == "1100")["balance"]

        hold_start = (datetime.now(timezone.utc) + timedelta(days=60)).replace(hour=17, minute=0, second=0, microsecond=0)
        hold_end = hold_start + timedelta(hours=5)

        # Client attempts to tamper unit_price to 0.01 -> backend MUST use InventoryItem.unit_addon_price (25000 * 2 = 50000)
        r = await client.post(
            "/api/v1/bookings/hold",
            headers=tenant_headers,
            json={
                "hall_id": hall_id,
                "event_type": "WEDDING",
                "start_time": hold_start.isoformat(),
                "end_time": hold_end.isoformat(),
                "guest_count": 200,
                "catering_item_id": catering_id,
                "addons": [{"item_id": addon_item_id, "quantity": 2, "unit_price": 0.01}],
                "client_full_name": "سامي الحداد",
                "client_phone": "+967771234999",
                "client_category": "INDIVIDUAL_B2C",
            },
        )
        assert r.status_code == 200, r.text
        hold = r.json()
        assert hold["portal_auth_hint"] == "OTP_LOGIN_REQUIRED"
        assert hold["quote"]["addons_total"] == 50000.0

        # Hardcoded "Client@2026" must fail
        r_bad_pw = await client.post(
            "/api/v1/auth/login",
            headers=tenant_headers,
            json={"identifier": "+967771234999", "password": "Client@2026"},
        )
        assert r_bad_pw.status_code == 401

        # Verify Invoice Accrual JE posted immediately: 1100 AR increased by invoice total_amount
        tb_after_hold = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        assert tb_after_hold["is_balanced"] is True
        ar_after_hold = next(r for r in tb_after_hold["rows"] if r["code"] == "1100")["balance"]
        assert abs((ar_after_hold - ar_before) - hold["invoice"]["total_amount"]) < 0.01

        # Dedicated security deposit milestone created separately
        deposit_ms = [m for m in hold["milestones"] if m["is_security_deposit"] is True]
        installment_ms = [m for m in hold["milestones"] if m["is_security_deposit"] is False]
        assert len(deposit_ms) == 1
        assert len(installment_ms) == 2
        assert abs(sum(m["amount_due"] for m in installment_ms) - hold["invoice"]["total_amount"]) < 0.01

        # Public upload requires one-time upload_token; invalid token rejected, valid succeeds once, replay rejected
        first_ms = installment_ms[0]
        r_no_tok = await client.post(
            f"/api/v1/public/milestones/{first_ms['id']}/receipt",
            headers=tenant_headers,
            files={"receipt": ("r.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )
        assert r_no_tok.status_code == 401

        r_up = await client.post(
            f"/api/v1/public/milestones/{first_ms['id']}/receipt",
            headers=tenant_headers,
            data={"upload_token": first_ms["upload_token"], "payment_method": "KURAIMI_BANK", "transfer_reference": "REF-101"},
            files={"receipt": ("r.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )
        assert r_up.status_code == 200, r_up.text
        receipt_api_url = r_up.json()["receipt_url"]
        assert receipt_api_url.startswith("/api/v1/portal/milestones/")

        # Replay with same one-time token fails (403)
        r_replay = await client.post(
            f"/api/v1/public/milestones/{first_ms['id']}/receipt",
            headers=tenant_headers,
            data={"upload_token": first_ms["upload_token"]},
            files={"receipt": ("r.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )
        assert r_replay.status_code == 403

        # Static /uploads mount is gone, and protected receipt route requires event auth
        assert (await client.get("/uploads/receipts/anything.png")).status_code == 404
        assert (await client.get(receipt_api_url, headers=tenant_headers)).status_code == 401
        assert (await client.get(receipt_api_url, headers=fin_headers)).status_code == 200

        # Verify installments + reject duplicate verification across both endpoints (409)
        for ms in installment_ms:
            r_v = await client.patch(
                f"/api/v1/erp/finance/milestones/{ms['id']}/verify",
                headers=fin_headers,
                json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False},
            )
            assert r_v.status_code == 200, r_v.text

        r_dup1 = await client.patch(
            f"/api/v1/erp/finance/milestones/{first_ms['id']}/verify",
            headers=fin_headers,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False},
        )
        assert r_dup1.status_code == 409
        r_dup2 = await client.post(
            f"/api/v1/finance/milestones/{first_ms['id']}/verify",
            headers=fin_headers,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False},
        )
        assert r_dup2.status_code == 409

        # After full invoice installment payment, 1100 AR returns to ar_before (never negative!)
        tb_paid = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        ar_paid = next(r for r in tb_paid["rows"] if r["code"] == "1100")["balance"]
        assert abs(ar_paid - ar_before) < 0.01
        assert ar_paid >= 0

        # Verify security deposit milestone -> credits 2100 liability
        sec_before = next(r for r in tb_paid["rows"] if r["code"] == "2100")["balance"]
        r_sec = await client.patch(
            f"/api/v1/erp/finance/milestones/{deposit_ms[0]['id']}/verify",
            headers=fin_headers,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": True},
        )
        assert r_sec.status_code == 200, r_sec.text

        tb_sec = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        sec_after = next(r for r in tb_sec["rows"] if r["code"] == "2100")["balance"]
        assert abs((sec_after - sec_before) - deposit_ms[0]["amount_due"]) < 0.01

        # Damage inspection deduction (20,000) -> Dr 2100 / Cr 4200, then refund remaining balance
        deduct = 20000.0
        r_insp = await client.post(
            f"/api/v1/erp/ops/events/{hold['event_id']}/inspection",
            headers=ops_headers,
            json={"status": "DAMAGE_CLAIMED", "deduction_amount": deduct, "notes": "Broken chandelier"},
        )
        assert r_insp.status_code == 200, r_insp.text
        assert r_insp.json()["deposit_status"] == "DEDUCTED"

        r_ref = await client.post(
            f"/api/v1/erp/finance/events/{hold['event_id']}/refund-deposit",
            headers=fin_headers,
            json={"payment_method": "KURAIMI_BANK"},
        )
        assert r_ref.status_code == 200, r_ref.text
        assert r_ref.json()["deposit_status"] == "REFUNDED"
        expected_refund = deposit_ms[0]["amount_due"] - deduct
        assert abs(r_ref.json()["refund_amount"] - expected_refund) < 0.01

        # Duplicate refund blocked with 409
        r_ref_dup = await client.post(
            f"/api/v1/erp/finance/events/{hold['event_id']}/refund-deposit",
            headers=fin_headers,
            json={"payment_method": "KURAIMI_BANK"},
        )
        assert r_ref_dup.status_code == 409

        # 2100 liability returned exactly to sec_before
        tb_end = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        assert tb_end["is_balanced"] is True
        sec_end = next(r for r in tb_end["rows"] if r["code"] == "2100")["balance"]
        assert abs(sec_end - sec_before) < 0.01


@pytest.mark.asyncio
async def test_gl_controls_period_lock_reversal_statements_and_expenses():
    await _fresh_seeded_client()
    tenant_headers = {"X-Tenant-Slug": "almassa"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        fin_headers = await _login_staff(client, tenant_headers, "finance@almassa.eventledger.local", "Finance@2026")
        accs = (await client.get("/api/v1/finance/accounts", headers=fin_headers)).json()
        by_code = {a["code"]: a for a in accs}

        # 1. Control accounts (1100, 2100, 2200) must reject manual postings (400)
        for ctrl in ("1100", "2100", "2200"):
            r_ctrl = await client.post(
                "/api/v1/finance/journal-entries",
                headers=fin_headers,
                json={
                    "reference": f"MAN-{ctrl}",
                    "description": "Attempt manual control posting",
                    "lines": [
                        {"account_id": by_code["1020"]["id"], "debit": 1000, "credit": 0},
                        {"account_id": by_code[ctrl]["id"], "debit": 0, "credit": 1000},
                    ],
                },
            )
            assert r_ctrl.status_code == 400, f"Expected 400 for {ctrl}, got {r_ctrl.status_code}"

        # 2. Valid manual posting to non-control equity account 3000 -> Reverse -> 409 on 2nd reverse
        r_je = await client.post(
            "/api/v1/finance/journal-entries",
            headers=fin_headers,
            json={
                "reference": "CAP-01",
                "description": "Owner capital injection",
                "lines": [
                    {"account_id": by_code["1020"]["id"], "debit": 50000, "credit": 0},
                    {"account_id": by_code["3000"]["id"], "debit": 0, "credit": 50000},
                ],
            },
        )
        assert r_je.status_code == 200, r_je.text
        je_id = r_je.json()["id"]

        r_rev = await client.post(
            f"/api/v1/finance/journal-entries/{je_id}/reverse",
            headers=fin_headers,
            json={"reason": "Entered by mistake"},
        )
        assert r_rev.status_code == 200, r_rev.text
        assert r_rev.json()["status"] == "REVERSED"

        r_rev2 = await client.post(
            f"/api/v1/finance/journal-entries/{je_id}/reverse",
            headers=fin_headers,
            json={"reason": "Second reverse"},
        )
        assert r_rev2.status_code == 409

        # Account ledger & Financial Statements stay balanced
        r_led = await client.get(f"/api/v1/finance/accounts/{by_code['1020']['id']}/ledger", headers=fin_headers)
        assert r_led.status_code == 200
        assert len(r_led.json()["transactions"]) >= 2

        r_stmt = await client.get("/api/v1/finance/statements", headers=fin_headers)
        assert r_stmt.status_code == 200
        stmt = r_stmt.json()
        assert stmt["balance_sheet"]["is_balanced"] is True
        assert abs(stmt["balance_sheet"]["total_assets"] - stmt["balance_sheet"]["total_liabilities_and_equity"]) < 0.01

        # 3. Event Expenses CRUD updates GL & P&L
        events = (await client.get("/api/v1/bookings/events", headers=fin_headers)).json()
        ev_id = events[0]["id"]
        pnl_before = (await client.get(f"/api/v1/finance/events/{ev_id}/pnl", headers=fin_headers)).json()

        r_exp = await client.post(
            f"/api/v1/erp/finance/events/{ev_id}/expenses",
            headers=fin_headers,
            json={"category": "FLORAL", "description": "Extra roses", "amount": 15000, "payment_method": "CASH"},
        )
        assert r_exp.status_code == 200, r_exp.text
        exp_id = r_exp.json()["id"]

        pnl_after = (await client.get(f"/api/v1/finance/events/{ev_id}/pnl", headers=fin_headers)).json()
        assert abs((pnl_after["total_expenses"] - pnl_before["total_expenses"]) - 15000.0) < 0.01

        r_del = await client.delete(f"/api/v1/erp/finance/events/{ev_id}/expenses/{exp_id}", headers=fin_headers)
        assert r_del.status_code == 200
        pnl_reverted = (await client.get(f"/api/v1/finance/events/{ev_id}/pnl", headers=fin_headers)).json()
        assert abs(pnl_reverted["total_expenses"] - pnl_before["total_expenses"]) < 0.01

        # 4. Locking current Fiscal Period blocks journal entry creation (400), then unlocking restores it
        fys = (await client.get("/api/v1/finance/fiscal-years", headers=fin_headers)).json()
        now_month = datetime.now(timezone.utc).month
        cur_period = next(p for p in fys[0]["periods"] if p["period_number"] == now_month)

        r_lock = await client.patch(
            f"/api/v1/finance/periods/{cur_period['id']}",
            headers=fin_headers,
            json={"status": "LOCKED"},
        )
        assert r_lock.status_code == 200

        r_blocked = await client.post(
            "/api/v1/finance/journal-entries",
            headers=fin_headers,
            json={
                "reference": "LOCKED-TEST",
                "description": "Should fail in locked period",
                "lines": [
                    {"account_id": by_code["1020"]["id"], "debit": 100, "credit": 0},
                    {"account_id": by_code["3000"]["id"], "debit": 0, "credit": 100},
                ],
            },
        )
        assert r_blocked.status_code == 400

        r_unlock = await client.patch(
            f"/api/v1/finance/periods/{cur_period['id']}",
            headers=fin_headers,
            json={"status": "OPEN"},
        )
        assert r_unlock.status_code == 200


@pytest.mark.asyncio
async def test_approvals_rbac_financial_delta_tax_idor_and_whatsapp_hmac():
    await _fresh_seeded_client()
    tenant_headers = {"X-Tenant-Slug": "almassa"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        fin_headers = await _login_staff(client, tenant_headers, "finance@almassa.eventledger.local", "Finance@2026")
        sales_headers = await _login_staff(client, tenant_headers, "ops@almassa.eventledger.local", "Ops@2026")
        pub_tenant = (await client.get("/api/v1/public/tenants/almassa")).json()
        hall_id = pub_tenant["halls"][0]["id"]

        # Create booking for Client A
        hold_a_start = (datetime.now(timezone.utc) + timedelta(days=75)).replace(hour=17, minute=0, second=0, microsecond=0)
        hold_a = (
            await client.post(
                "/api/v1/bookings/hold",
                headers=tenant_headers,
                json={
                    "hall_id": hall_id,
                    "event_type": "WEDDING",
                    "start_time": hold_a_start.isoformat(),
                    "end_time": (hold_a_start + timedelta(hours=4)).isoformat(),
                    "guest_count": 150,
                    "client_full_name": "عميل أ",
                    "client_phone": "+967770001111",
                },
            )
        ).json()

        # Register Client B (unrelated client in same tenant)
        r_reg_b = await client.post(
            "/api/v1/auth/register-client",
            headers=tenant_headers,
            json={
                "full_name": "عميل ب",
                "phone": "+967770002222",
                "password": "ClientB@Password123",
            },
        )
        assert r_reg_b.status_code in (200, 201), r_reg_b.text
        client_b_headers = {**tenant_headers, "Authorization": f"Bearer {r_reg_b.json()['access_token']}"}
        client_a_headers = await _otp_login(client, tenant_headers, "+967770001111")

        # IDOR: Client B cannot read or sign Client A's contract, drafts, messages, or invoice PDF
        ev_a_id = hold_a["event_id"]
        inv_a_id = hold_a["invoice"]["id"]
        assert (await client.get(f"/api/v1/portal/events/{ev_a_id}/contract", headers=client_b_headers)).status_code == 403
        assert (
            await client.post(
                f"/api/v1/portal/events/{ev_a_id}/contract/sign",
                headers=client_b_headers,
                json={"signature_name": "Intruder"},
            )
        ).status_code == 403
        assert (await client.get(f"/api/v1/exports/invoices/{inv_a_id}/pdf", headers=client_b_headers)).status_code == 403
        assert (await client.get(f"/api/v1/events/{ev_a_id}/drafts", headers=client_b_headers)).status_code == 403
        assert (await client.get(f"/api/v1/events/{ev_a_id}/messages", headers=client_b_headers)).status_code == 403
        assert (await client.get("/api/v1/portal/audit-logs", headers=client_b_headers)).json() == []

        # Client A succeeds on their own contract & PDF
        assert (await client.get(f"/api/v1/portal/events/{ev_a_id}/contract", headers=client_a_headers)).status_code == 200
        assert (await client.get(f"/api/v1/exports/invoices/{inv_a_id}/pdf", headers=client_a_headers)).status_code == 200

        # Staff creates draft with financial_delta=+10000 and submits -> requires CLIENT_PRIMARY approval
        r_draft = await client.post(
            f"/api/v1/events/{ev_a_id}/drafts",
            headers=sales_headers,
            json={"draft_type": "ADDON_REQUEST", "payload": {"note": "Extra lighting"}, "financial_delta": 10000},
        )
        assert r_draft.status_code == 200, r_draft.text
        draft_id = r_draft.json()["draft_id"]

        r_sub = await client.post(f"/api/v1/drafts/{draft_id}/submit", headers=sales_headers)
        assert r_sub.status_code == 200
        approval_id = r_sub.json()["approval_id"]
        assert r_sub.json()["required_approver_role"] == "CLIENT_PRIMARY"

        # Unauthorized actors (Sales Rep & Client B) CANNOT resolve Client A's approval -> 403
        assert (
            await client.post(
                f"/api/v1/approvals/{approval_id}/resolve",
                headers=sales_headers,
                json={"decision": "APPROVED"},
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/approvals/{approval_id}/resolve",
                headers=client_b_headers,
                json={"decision": "APPROVED"},
            )
        ).status_code == 403

        # Client A approves -> invoice subtotal +10000, tax +500 (5% Al-Massa), total +10500, GL synced & balanced
        tb_before_app = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        ar_before_app = next(r for r in tb_before_app["rows"] if r["code"] == "1100")["balance"]

        r_ok = await client.post(
            f"/api/v1/approvals/{approval_id}/resolve",
            headers=client_a_headers,
            json={"decision": "APPROVED"},
        )
        assert r_ok.status_code == 200, r_ok.text
        res_json = r_ok.json()
        assert res_json["status"] == "FORWARDED_TO_OPS"
        next_approval_id = res_json["next_approval_id"]

        # Only OPS_MANAGER / OWNER can resolve the second gate (FINANCE or Client A gets 403)
        assert (
            await client.post(
                f"/api/v1/approvals/{next_approval_id}/resolve",
                headers=fin_headers,
                json={"decision": "APPROVED"},
            )
        ).status_code == 403
        r_ops_ok = await client.post(
            f"/api/v1/approvals/{next_approval_id}/resolve",
            headers=sales_headers,
            json={"decision": "APPROVED"},
        )
        assert r_ops_ok.status_code == 200, r_ops_ok.text
        assert r_ops_ok.json()["status"] == "APPROVED_SYNCED"

        invs = (await client.get("/api/v1/finance/invoices", headers=fin_headers)).json()
        inv_a = next(i for i in invs if i["id"] == inv_a_id)
        assert abs((inv_a["total_amount"] - hold_a["invoice"]["total_amount"]) - 10500.0) < 0.01

        tb_after_app = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        assert tb_after_app["is_balanced"] is True
        ar_after_app = next(r for r in tb_after_app["rows"] if r["code"] == "1100")["balance"]
        assert abs((ar_after_app - ar_before_app) - 10500.0) < 0.01

        # WhatsApp webhook enforces X-Hub-Signature-256
        body_bytes = json.dumps({"entry": []}).encode("utf-8")
        r_no_sig = await client.post("/api/v1/webhooks/whatsapp", content=body_bytes, headers={"Content-Type": "application/json"})
        assert r_no_sig.status_code == 403

        orig_secret = settings.WHATSAPP_APP_SECRET
        settings.WHATSAPP_APP_SECRET = "test-wa-secret"
        try:
            sig = "sha256=" + hmac.new(b"test-wa-secret", body_bytes, hashlib.sha256).hexdigest()
            r_sig = await client.post(
                "/api/v1/webhooks/whatsapp",
                content=body_bytes,
                headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig},
            )
            assert r_sig.status_code == 200, r_sig.text
        finally:
            settings.WHATSAPP_APP_SECRET = orig_secret
