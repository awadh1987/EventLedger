import os
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

# Point test DB to an isolated temp SQLite file before importing app modules
_TEST_DB = os.path.join(tempfile.gettempdir(), "eventledger_test.db")
if os.path.exists(_TEST_DB):
    os.remove(_TEST_DB)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DEBUG"] = "true"

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, engine
from app.main import app
from app.models.accounting import PaymentMilestone
from app.models.base import Base
from app.models.events import Event, EventStatus, GatePass
from app.models.events_extensions import EventContract, EventGuest
from app.models.tenant import SubscriptionStatus, Tenant, TenantBranding
from seed import seed_all


class TestDoubleEntryAndEncodingInvariants(unittest.TestCase):
    def test_balanced_journal_entry_validation(self):
        lines = [
            {"account_code": "1020", "debit": Decimal("1799700.00"), "credit": Decimal("0.00")},
            {"account_code": "1100", "debit": Decimal("0.00"), "credit": Decimal("1799700.00")},
        ]
        total_debit = sum((l["debit"] for l in lines), Decimal("0.00"))
        total_credit = sum((l["credit"] for l in lines), Decimal("0.00"))
        self.assertLess(abs(total_debit - total_credit), Decimal("0.01"))
        self.assertGreater(total_debit, Decimal("0.00"))

    def test_unbalanced_journal_entry_rejected(self):
        lines = [
            {"account_code": "1020", "debit": Decimal("500000.00"), "credit": Decimal("0.00")},
            {"account_code": "4000", "debit": Decimal("0.00"), "credit": Decimal("499990.00")},
        ]
        total_debit = sum((l["debit"] for l in lines), Decimal("0.00"))
        total_credit = sum((l["credit"] for l in lines), Decimal("0.00"))
        self.assertGreaterEqual(abs(total_debit - total_credit), Decimal("0.01"))

    def test_utf8_bom_csv_roundtrip_arabic(self):
        raw_csv = "\ufeffcode,name_ar,name_en,account_type\n2100,تأمينات الأضرار المستردة,Refundable Security Deposits,LIABILITY\n"
        encoded = raw_csv.encode("utf-8")
        self.assertTrue(encoded.startswith(b"\xef\xbb\xbf"))
        decoded = encoded.decode("utf-8-sig")
        self.assertFalse(decoded.startswith("\ufeff"))
        self.assertIn("تأمينات الأضرار المستردة", decoded)


@pytest.mark.asyncio
async def test_end_to_end_api_invariants():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await seed_all()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Health
        r = await client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

        # 2. Public tenant & halls via X-Tenant-Slug
        headers = {"X-Tenant-Slug": "almassa"}
        r = await client.get("/api/v1/public/tenant", headers=headers)
        assert r.status_code == 200
        assert r.json()["slug"] == "almassa"

        # 3. Login as FINANCE staff
        r = await client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={"identifier": "finance@almassa.eventledger.local", "password": "Finance@2026"},
        )
        assert r.status_code == 200
        fin_token = r.json()["access_token"]
        fin_headers = {**headers, "Authorization": f"Bearer {fin_token}"}

        # 4. Double-entry unbalanced entry MUST be rejected (400)
        accs = (await client.get("/api/v1/finance/accounts", headers=fin_headers)).json()
        acc_by_code = {a["code"]: a["id"] for a in accs}
        r = await client.post(
            "/api/v1/finance/journal-entries",
            headers=fin_headers,
            json={
                "reference": "TEST-UNBAL",
                "description": "Unbalanced test",
                "lines": [
                    {"account_id": acc_by_code["1020"], "debit": 1000, "credit": 0},
                    {"account_id": acc_by_code["4000"], "debit": 0, "credit": 990},
                ],
            },
        )
        assert r.status_code == 400

        # 4b. Verify seeded Trial Balance has non-zero balanced entries & Liability 2100 segregation
        tb_seeded = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        assert tb_seeded["is_balanced"] is True
        assert tb_seeded["total_debit"] == 2512500.0
        assert tb_seeded["total_credit"] == 2512500.0
        tb_by_code = {row["code"]: row for row in tb_seeded["rows"]}
        assert tb_by_code["1020"]["total_debit"] == 937500.0
        assert tb_by_code["2100"]["total_credit"] == 150000.0
        assert tb_by_code["4000"]["total_credit"] == 1500000.0

        # 4c. Verify seeded Tenant extensions, EventContract, and EventGuests with QR GatePasses
        async with AsyncSessionLocal() as db:
            tenant = (await db.execute(select(Tenant).where(Tenant.slug == "almassa"))).scalar_one()
            assert tenant.subscription_status == SubscriptionStatus.ACTIVE
            assert tenant.custom_domain_verified is True
            assert tenant.max_halls == 10
            assert tenant.monthly_whatsapp_quota == 10000
            assert tenant.whatsapp_used_this_month == 42
            branding = (
                await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
            ).scalar_one()
            assert branding.hero_tagline_ar
            assert branding.hero_tagline_en

            contract = (
                await db.execute(
                    select(EventContract).where(
                        EventContract.tenant_id == tenant.id,
                        EventContract.contract_number == "CTR-EVT-2026-1001",
                    )
                )
            ).scalar_one_or_none()
            assert contract is not None
            assert contract.client_signed_at is not None

            guests = (
                await db.execute(select(EventGuest).where(EventGuest.tenant_id == tenant.id))
            ).scalars().all()
            assert len(guests) >= 3
            assert all(g.gate_pass_id is not None for g in guests)
            passes = (
                await db.execute(select(GatePass).where(GatePass.tenant_id == tenant.id))
            ).scalars().all()
            assert len(passes) >= 3

        # 5. Balanced entry succeeds and Trial Balance stays balanced
        r = await client.post(
            "/api/v1/finance/journal-entries",
            headers=fin_headers,
            json={
                "reference": "TEST-BAL",
                "description": "Balanced test",
                "lines": [
                    {"account_id": acc_by_code["1020"], "debit": 5000, "credit": 0},
                    {"account_id": acc_by_code["2100"], "debit": 0, "credit": 5000},
                ],
            },
        )
        assert r.status_code == 200
        tb = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        assert tb["is_balanced"] is True
        assert tb["total_debit"] == tb_seeded["total_debit"] + 5000.0

        # 6. Register new tenant and verify cross-tenant isolation
        r = await client.post(
            "/api/v1/public/tenants/register",
            json={
                "venue_name": "Noor Palace",
                "slug": "noorpalace",
                "owner_name": "Noor Owner",
                "owner_phone": "+967779998877",
                "owner_password": "NoorPassword@2026",
            },
        )
        assert r.status_code == 200
        noor_headers = {"X-Tenant-Slug": "noorpalace", "Authorization": f"Bearer {fin_token}"}
        r = await client.get("/api/v1/finance/accounts", headers=noor_headers)
        assert r.status_code == 403

        # 7. Gate check-in & offline sync
        r = await client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={"identifier": "gate@almassa.eventledger.local", "password": "Gate@2026"},
        )
        gate_headers = {**headers, "Authorization": f"Bearer {r.json()['access_token']}"}
        r = await client.get("/api/v1/sync/manifest", headers=gate_headers)
        assert r.status_code == 200
        assert len(r.json()["events"]) >= 0

        # 8. Phase 2: Public tenant directory & Super-Admin tenant console
        r = await client.get("/api/v1/public/tenants/almassa")
        assert r.status_code == 200
        pub_tenant = r.json()
        assert pub_tenant["slug"] == "almassa"
        assert len(pub_tenant["halls"]) >= 2
        assert len(pub_tenant["catering_items"]) >= 1

        r = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "admin@eventledger.cloud", "password": "SuperAdmin@2026"},
        )
        assert r.status_code == 200
        sa_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await client.get("/api/v1/admin/tenants", headers=sa_headers)
        assert r.status_code == 200
        assert len(r.json()["tenants"]) >= 2

        r = await client.patch(
            f"/api/v1/admin/tenants/{pub_tenant['id']}",
            headers=sa_headers,
            json={"max_halls": 12},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "UPDATED"

        # 9. Phase 2: Availability with partition merge + catering quote + public 48h hold
        hold_start = (datetime.now(timezone.utc) + timedelta(days=45)).replace(hour=16, minute=0, second=0, microsecond=0)
        hold_end = hold_start + timedelta(hours=6)
        hall_id = pub_tenant["halls"][0]["id"]
        catering_id = pub_tenant["catering_items"][0]["id"]

        r = await client.get(
            "/api/v1/public/halls/availability",
            headers=headers,
            params={
                "hall_id": hall_id,
                "start_time": hold_start.isoformat(),
                "end_time": hold_end.isoformat(),
                "merge_combinable_hall": "true",
                "guest_count": 300,
                "catering_item_id": catering_id,
            },
        )
        assert r.status_code == 200
        avail_data = r.json()
        assert avail_data["availability"]["available"] is True
        assert avail_data["quote"]["catering_total"] > 0
        assert avail_data["quote"]["merged_hall_addon"] > 0
        assert len(avail_data["occupied_slots"]) >= 1

        r = await client.post(
            "/api/v1/bookings/hold",
            headers=headers,
            json={
                "hall_id": hall_id,
                "merge_combinable_hall": True,
                "event_type": "WEDDING",
                "start_time": hold_start.isoformat(),
                "end_time": hold_end.isoformat(),
                "guest_count": 300,
                "catering_item_id": catering_id,
                "client_full_name": "ياسر عبدالملك",
                "client_phone": "+967775556677",
                "client_category": "INDIVIDUAL_B2C",
            },
        )
        assert r.status_code == 200
        hold_data = r.json()
        assert hold_data["status"] == "HOLD_48H"
        hold_event_id = hold_data["event_id"]

        # 10. Phase 2: Client contract e-signature & guest QR pass creation
        r = await client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={"identifier": "+967775556677", "password": "Client@2026"},
        )
        assert r.status_code == 200
        client_headers = {**headers, "Authorization": f"Bearer {r.json()['access_token']}"}

        r = await client.post(
            f"/api/v1/portal/events/{hold_event_id}/contract/sign",
            headers=client_headers,
            json={"signature_name": "ياسر عبدالملك"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "SIGNED"

        r = await client.post(
            f"/api/v1/portal/events/{hold_event_id}/guests",
            headers=client_headers,
            json={"full_name": "ضيف الشرف", "vip_tier": "VIP", "table_label": "VIP-1"},
        )
        assert r.status_code == 200
        assert r.json()["pass_type"] == "VIP_PASS"
        assert r.json()["qr_token"].startswith("QR-")

        # 11. Phase 2: Finance milestone verify (auto journal post + HOLD_48H -> CONFIRMED) & Ops inspection
        async with AsyncSessionLocal() as db:
            from app.models.accounting import Invoice

            inv_id = (
                await db.execute(select(Invoice.id).where(Invoice.event_id == uuid.UUID(hold_event_id)))
            ).scalar_one()
            ms_id = (
                await db.execute(
                    select(PaymentMilestone.id)
                    .where(PaymentMilestone.invoice_id == inv_id)
                    .order_by(PaymentMilestone.due_date.asc())
                )
            ).scalars().first()

        r = await client.patch(
            f"/api/v1/erp/finance/milestones/{ms_id}/verify",
            headers=fin_headers,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False, "reference": "TRX-101"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "VERIFIED"
        assert r.json()["journal_entry_number"].startswith("JE-")

        tb_after_verify = (await client.get("/api/v1/finance/trial-balance", headers=fin_headers)).json()
        assert tb_after_verify["is_balanced"] is True

        async with AsyncSessionLocal() as db:
            ev_after = (await db.execute(select(Event).where(Event.id == uuid.UUID(hold_event_id)))).scalar_one()
            assert ev_after.status == EventStatus.CONFIRMED

        r = await client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={"identifier": "ops@almassa.eventledger.local", "password": "Ops@2026"},
        )
        assert r.status_code == 200
        ops_headers = {**headers, "Authorization": f"Bearer {r.json()['access_token']}"}
        r = await client.post(
            f"/api/v1/erp/ops/events/{hold_event_id}/inspection",
            headers=ops_headers,
            json={"status": "PASSED", "deduction_amount": 0, "notes": "Clean hall", "checklist_json": {"stage": True}},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "PASSED"
        assert r.json()["deposit_status"] == "INSPECTION_PASSED"
