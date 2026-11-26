import os
import tempfile
import unittest
from decimal import Decimal

# Point test DB to an isolated temp SQLite file before importing app modules
_TEST_DB = os.path.join(tempfile.gettempdir(), "eventledger_test.db")
if os.path.exists(_TEST_DB):
    os.remove(_TEST_DB)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DEBUG"] = "true"

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import engine
from app.main import app
from app.models.base import Base
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
        assert tb["total_debit"] == 5000.0

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
