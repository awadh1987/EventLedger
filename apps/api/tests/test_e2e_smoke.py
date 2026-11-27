import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

_TEST_DB = os.path.join(tempfile.gettempdir(), "eventledger_test.db")
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_TEST_DB}")
os.environ.setdefault("DEBUG", "true")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, engine
from app.main import app
from app.models.accounting import (
    AccountingConfig,
    DepositStatus,
    Invoice,
    InvoiceStatus,
    JournalEntry,
    PaymentMilestone,
)
from app.models.base import Base
from app.models.events import AuditLog, Event, EventStatus
from app.models.tenant import Tenant
from app.workers.celery_tasks import _expire_hold_async
from seed import seed_all


async def _reset_and_seed_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await seed_all()


@pytest.mark.asyncio
async def test_full_platform_e2e_smoke():
    await _reset_and_seed_db()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # =====================================================================
        # 1. System Health & Super-Admin Governance
        # =====================================================================
        r_health = await client.get("/health")
        assert r_health.status_code == 200
        assert r_health.json()["status"] == "ok"
        assert r_health.json()["database"] == "ok"

        r_sa_login = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "admin@eventledger.cloud", "password": "SuperAdmin@2026"},
        )
        assert r_sa_login.status_code == 200, r_sa_login.text
        sa_headers = {"Authorization": f"Bearer {r_sa_login.json()['access_token']}"}

        r_admin_list = await client.get("/api/v1/admin/tenants", headers=sa_headers)
        assert r_admin_list.status_code == 200
        admin_data = r_admin_list.json()
        assert "kpis" in admin_data
        assert admin_data["kpis"]["total_tenants"] >= 1
        assert "active_tenants" in admin_data["kpis"]
        assert "total_events" in admin_data["kpis"]
        assert "total_gmv" in admin_data["kpis"]
        almassa_id = admin_data["tenants"][0]["id"]

        r_sa_patch = await client.patch(
            f"/api/v1/admin/tenants/{almassa_id}",
            headers=sa_headers,
            json={
                "whatsapp_monthly_quota": 15000,
                "max_halls": 20,
                "custom_domain": "portal.almassa-smoke.ye",
            },
        )
        assert r_sa_patch.status_code == 200, r_sa_patch.text

        r_admin_after = await client.get("/api/v1/admin/tenants", headers=sa_headers)
        updated_t = next(t for t in r_admin_after.json()["tenants"] if t["id"] == almassa_id)
        assert updated_t["whatsapp_monthly_quota"] == 15000
        assert updated_t["max_halls"] == 20
        assert updated_t["custom_domain"] == "portal.almassa-smoke.ye"

        # =====================================================================
        # 2. Tier 1 — Venue Owner Self-Onboarding & Storefront Customization
        # =====================================================================
        r_reg = await client.post(
            "/api/v1/public/tenants/register",
            json={
                "venue_name": "Smoke Royal Palace",
                "slug": "smoke-palace",
                "owner_name": "Tariq Owner",
                "owner_phone": "+967778889900",
                "owner_email": "owner@smokepalace.local",
                "owner_password": "SmokeOwner@2026",
                "currency": "YER",
                "subscription_tier": "ENTERPRISE",
            },
        )
        assert r_reg.status_code == 200, r_reg.text
        reg_json = r_reg.json()
        assert reg_json["slug"] == "smoke-palace"
        assert reg_json["user"]["staff_role"] == "OWNER"
        smoke_tid = uuid.UUID(reg_json["tenant_id"])
        owner_headers = {
            "Authorization": f"Bearer {reg_json['access_token']}",
            "X-Tenant-Slug": "smoke-palace",
        }
        tenant_headers = {"X-Tenant-Slug": "smoke-palace"}

        # Verify seeded COA and AccountingConfig
        r_coa = await client.get("/api/v1/finance/accounts", headers=owner_headers)
        assert r_coa.status_code == 200
        coa_codes = {a["code"] for a in r_coa.json()}
        for expected_code in ("1010", "1020", "1100", "2100", "2200", "3000", "3100", "4000", "4100", "4200", "5000", "5100"):
            assert expected_code in coa_codes

        async with AsyncSessionLocal() as db:
            cfg = (
                await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == smoke_tid))
            ).scalar_one_or_none()
            assert cfg is not None
            assert cfg.accounts_receivable_id is not None
            assert cfg.security_deposit_liab_id is not None
            # Enable 5% tax_rate on smoke-palace so tax ledger posting & approval tax sync are exercised
            smoke_t = (await db.execute(select(Tenant).where(Tenant.id == smoke_tid))).scalar_one()
            smoke_t.tax_rate = Decimal("5.00")
            await db.commit()

        # Create a hall & inventory add-on
        r_hall = await client.post(
            "/api/v1/venue/halls",
            headers=owner_headers,
            json={
                "name": "Emerald Ballroom",
                "name_ar": "قاعة الزمرد الكبرى",
                "capacity_banquet": 400,
                "capacity_theater": 650,
                "base_price": 1000000.00,
                "cleaning_buffer_minutes": 120,
            },
        )
        assert r_hall.status_code == 200, r_hall.text
        hall_id = r_hall.json()["id"]

        inv_csv = "\ufeffname,category,total_stock,unit_addon_price\nRoyal Crystal Chandelier,DECOR,20,25000.00\n"
        r_inv_imp = await client.post(
            "/api/v1/import/inventory",
            headers=owner_headers,
            files={"file": ("inventory.csv", inv_csv.encode("utf-8"), "text/csv")},
        )
        assert r_inv_imp.status_code == 200, r_inv_imp.text
        assert r_inv_imp.json()["imported_rows"] == 1

        r_inv_list = await client.get("/api/v1/venue/inventory", headers=owner_headers)
        assert r_inv_list.status_code == 200
        addon_item = r_inv_list.json()[0]
        addon_item_id = addon_item["id"]

        # Customize white-label branding + storefront hero media, hall gallery, and offer
        r_brand = await client.put(
            "/api/v1/tenant/branding",
            headers=owner_headers,
            json={
                "logo_light_url": "https://cdn.smokepalace.ye/logo-light.png",
                "logo_dark_url": "https://cdn.smokepalace.ye/logo-dark.png",
                "favicon_url": "https://cdn.smokepalace.ye/favicon.ico",
            },
        )
        assert r_brand.status_code == 200

        r_sf_put = await client.put(
            "/api/v1/erp/settings/storefront",
            headers=owner_headers,
            json={
                "heroTitleAr": "قصر الدخان الملكي",
                "heroTitleEn": "Smoke Royal Palace",
                "heroBannerUrl": "https://cdn.smokepalace.ye/hero-banner.jpg",
                "heroVideoUrl": "https://cdn.smokepalace.ye/hero-tour.mp4",
                "hall_media": {
                    hall_id: {
                        "gallery_urls": [
                            "https://cdn.smokepalace.ye/hall-1.jpg",
                            "https://cdn.smokepalace.ye/hall-2.jpg",
                        ],
                        "video_url": "https://cdn.smokepalace.ye/hall-video.mp4",
                        "amenities": ["VIP Bridal Suite", "4K LED Wall"],
                    }
                },
                "offers": [
                    {
                        "title_ar": "عرض الصيف الملكي 10%",
                        "title_en": "Royal Summer Offer 10%",
                        "discount_percent": 10.0,
                        "badge_text": "SAVE 10%",
                    }
                ],
            },
        )
        assert r_sf_put.status_code == 200, r_sf_put.text

        # Verify public storefront payload
        r_sf_pub = await client.get("/api/v1/public/tenants/smoke-palace/storefront")
        assert r_sf_pub.status_code == 200, r_sf_pub.text
        sf = r_sf_pub.json()
        assert sf["branding"]["logoLightUrl"] == "https://cdn.smokepalace.ye/logo-light.png"
        assert sf["branding"]["logoDarkUrl"] == "https://cdn.smokepalace.ye/logo-dark.png"
        assert sf["branding"]["faviconUrl"] == "https://cdn.smokepalace.ye/favicon.ico"
        assert sf["branding"]["heroBannerUrl"] == "https://cdn.smokepalace.ye/hero-banner.jpg"
        assert sf["branding"]["heroVideoUrl"] == "https://cdn.smokepalace.ye/hero-tour.mp4"
        assert sf["halls"][0]["gallery_urls"] == [
            "https://cdn.smokepalace.ye/hall-1.jpg",
            "https://cdn.smokepalace.ye/hall-2.jpg",
        ]
        assert len(sf["offers"]) == 1
        offer_id = sf["offers"][0]["id"]

        # =====================================================================
        # 3. Tier 2 — End-Client Registration, Hold Booking & Celery Expiry
        # =====================================================================
        r_cli_reg = await client.post(
            "/api/v1/auth/register-client",
            headers=tenant_headers,
            json={
                "full_name": "Yemen Corp Events",
                "phone": "+967779991122",
                "email": "corp@yemencorp.ye",
                "password": "CorpClient@2026",
                "client_category": "CORPORATE_B2B",
                "company_name": "Yemen Telecom Group",
                "tax_id": "TAX-YE-9001",
            },
        )
        assert r_cli_reg.status_code in (200, 201), r_cli_reg.text
        client_headers = {
            "Authorization": f"Bearer {r_cli_reg.json()['access_token']}",
            "X-Tenant-Slug": "smoke-palace",
        }

        # Hold #1 (15 days from now so it stays inside 60-day sync/manifest window)
        hold1_start = (datetime.now(timezone.utc) + timedelta(days=15)).replace(hour=17, minute=0, second=0, microsecond=0)
        r_hold1 = await client.post(
            "/api/v1/bookings/hold",
            headers=tenant_headers,
            json={
                "hall_id": hall_id,
                "event_type": "CONFERENCE",
                "start_time": hold1_start.isoformat(),
                "end_time": (hold1_start + timedelta(hours=5)).isoformat(),
                "guest_count": 300,
                "addons": [{"item_id": addon_item_id, "quantity": 2}],
                "offer_id": offer_id,
                "client_full_name": "Yemen Corp Events",
                "client_phone": "+967779991122",
                "client_category": "CORPORATE_B2B",
                "company_name": "Yemen Telecom Group",
                "tax_id": "TAX-YE-9001",
            },
        )
        assert r_hold1.status_code == 200, r_hold1.text
        hold1 = r_hold1.json()
        event1_id = hold1["event_id"]
        invoice1_id = hold1["invoice"]["id"]

        assert hold1["quote"]["addons_total"] == 50000.0
        assert hold1["quote"]["discount_amount"] > 0
        deposit_ms_1 = [m for m in hold1["milestones"] if m["is_security_deposit"] is True]
        installments_1 = [m for m in hold1["milestones"] if m["is_security_deposit"] is False]
        assert len(deposit_ms_1) == 1
        assert len(installments_1) == 2

        # Verify invoice accrual GL entry posted immediately & TB balanced
        r_tb1 = await client.get("/api/v1/finance/trial-balance", headers=owner_headers)
        assert r_tb1.status_code == 200
        tb1 = r_tb1.json()
        assert tb1["is_balanced"] is True
        ar_after_hold1 = next(r for r in tb1["rows"] if r["code"] == "1100")["balance"]
        assert abs(ar_after_hold1 - hold1["invoice"]["total_amount"]) < 0.01

        # Hold #2 (unpaid, day + 25) -> expire via _expire_hold_async worker
        hold2_start = (datetime.now(timezone.utc) + timedelta(days=25)).replace(hour=17, minute=0, second=0, microsecond=0)
        r_hold2 = await client.post(
            "/api/v1/bookings/hold",
            headers=tenant_headers,
            json={
                "hall_id": hall_id,
                "event_type": "WEDDING",
                "start_time": hold2_start.isoformat(),
                "end_time": (hold2_start + timedelta(hours=5)).isoformat(),
                "guest_count": 200,
                "client_full_name": "Unpaid Hold Client",
                "client_phone": "+967779993344",
            },
        )
        assert r_hold2.status_code == 200, r_hold2.text
        hold2 = r_hold2.json()
        event2_id = hold2["event_id"]
        invoice2_id = hold2["invoice"]["id"]

        expire_res_2 = await _expire_hold_async(event2_id)
        assert expire_res_2 == "EXPIRED_AND_CANCELLED"

        async with AsyncSessionLocal() as db:
            ev2 = (await db.execute(select(Event).where(Event.id == uuid.UUID(event2_id)))).scalar_one()
            inv2 = (await db.execute(select(Invoice).where(Invoice.id == uuid.UUID(invoice2_id)))).scalar_one()
            accrual2 = (
                await db.execute(
                    select(JournalEntry).where(
                        JournalEntry.tenant_id == smoke_tid,
                        JournalEntry.idempotency_key == f"INV_ACCRUAL:{invoice2_id}",
                    )
                )
            ).scalar_one()
            assert ev2.status == EventStatus.CANCELLED
            assert inv2.status == InvoiceStatus.VOIDED
            assert accrual2.status == "REVERSED"

        # Upload receipt on Hold #1 so milestone becomes UNDER_REVIEW -> worker must skip it!
        ms1_first = installments_1[0]
        r_up = await client.post(
            f"/api/v1/public/milestones/{ms1_first['id']}/receipt",
            headers=tenant_headers,
            data={"upload_token": ms1_first["upload_token"], "payment_method": "KURAIMI_BANK", "transfer_reference": "KR-551"},
            files={"receipt": ("receipt.png", b"\x89PNG\r\n\x1a\nsmoketest", "image/png")},
        )
        assert r_up.status_code == 200, r_up.text
        assert await _expire_hold_async(event1_id) == "PAID_OR_UNDER_REVIEW"

        # =====================================================================
        # 4. Cross-ERP Draft Approval, Verify, Deposit Lifecycle & P&L
        # =====================================================================
        r_draft = await client.post(
            f"/api/v1/events/{event1_id}/drafts",
            headers=client_headers,
            json={"draft_type": "ADDON_REQUEST", "payload": {"note": "VIP Stage Truss"}, "financial_delta": 20000},
        )
        assert r_draft.status_code == 200, r_draft.text
        draft_id = r_draft.json()["draft_id"]

        r_sub = await client.post(f"/api/v1/drafts/{draft_id}/submit", headers=client_headers)
        assert r_sub.status_code == 200, r_sub.text
        approval_id = r_sub.json()["approval_id"]

        r_app_ok = await client.post(
            f"/api/v1/approvals/{approval_id}/resolve",
            headers=owner_headers,
            json={"decision": "APPROVED"},
        )
        assert r_app_ok.status_code == 200, r_app_ok.text
        assert r_app_ok.json()["status"] == "APPROVED_SYNCED"

        # Verify invoice subtotal (+20,000), tax (+1,000 at 5%), total (+21,000), milestones & AuditLog updated
        invs_after_app = (await client.get("/api/v1/finance/invoices", headers=owner_headers)).json()
        inv1_after = next(i for i in invs_after_app if i["id"] == invoice1_id)
        assert abs(inv1_after["total_amount"] - (hold1["invoice"]["total_amount"] + 21000.0)) < 0.01

        async with AsyncSessionLocal() as db:
            adj_je = (
                await db.execute(
                    select(JournalEntry).where(
                        JournalEntry.tenant_id == smoke_tid,
                        JournalEntry.idempotency_key == f"DRAFT_SYNC:{draft_id}",
                    )
                )
            ).scalar_one_or_none()
            adj_log = (
                await db.execute(
                    select(AuditLog).where(
                        AuditLog.tenant_id == smoke_tid,
                        AuditLog.event_id == uuid.UUID(event1_id),
                        AuditLog.action == "DRAFT_APPROVED_AND_SYNCED",
                    )
                )
            ).scalar_one_or_none()
            assert adj_je is not None
            assert adj_log is not None

        # Verify all installment milestones (including updated amount_due), test 409 duplicate verify
        installments_after = [m for m in inv1_after["milestones"] if not m["is_security_deposit"]]
        for ms in installments_after:
            rv = await client.patch(
                f"/api/v1/erp/finance/milestones/{ms['id']}/verify",
                headers=owner_headers,
                json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False},
            )
            assert rv.status_code == 200, rv.text

        rv_dup = await client.patch(
            f"/api/v1/erp/finance/milestones/{installments_after[0]['id']}/verify",
            headers=owner_headers,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": False},
        )
        assert rv_dup.status_code == 409

        tb_after_paid = (await client.get("/api/v1/finance/trial-balance", headers=owner_headers)).json()
        assert tb_after_paid["is_balanced"] is True
        ar_after_paid = next(r for r in tb_after_paid["rows"] if r["code"] == "1100")["balance"]
        assert ar_after_paid >= 0
        assert abs(ar_after_paid) < 0.01

        # Verify security deposit -> credits 2100, add EventExpense, refund deposit -> Dr 2100 / Cr Bank
        sec_ms = next(m for m in inv1_after["milestones"] if m["is_security_deposit"])
        r_sec_ver = await client.patch(
            f"/api/v1/erp/finance/milestones/{sec_ms['id']}/verify",
            headers=owner_headers,
            json={"payment_method": "KURAIMI_BANK", "is_security_deposit": True},
        )
        assert r_sec_ver.status_code == 200, r_sec_ver.text

        tb_sec = (await client.get("/api/v1/finance/trial-balance", headers=owner_headers)).json()
        liab_2100 = next(r for r in tb_sec["rows"] if r["code"] == "2100")["balance"]
        assert abs(liab_2100 - sec_ms["amount_due"]) < 0.01

        r_exp = await client.post(
            f"/api/v1/erp/finance/events/{event1_id}/expenses",
            headers=owner_headers,
            json={"category": "CATERING", "description": "Royal Banquet Prep", "amount": 120000, "payment_method": "CASH"},
        )
        assert r_exp.status_code == 200, r_exp.text

        r_refund = await client.post(
            f"/api/v1/erp/finance/events/{event1_id}/refund-deposit",
            headers=owner_headers,
            json={"payment_method": "KURAIMI_BANK"},
        )
        assert r_refund.status_code == 200, r_refund.text
        assert r_refund.json()["deposit_status"] == DepositStatus.REFUNDED.value

        r_pnl = await client.get(f"/api/v1/finance/events/{event1_id}/pnl", headers=owner_headers)
        assert r_pnl.status_code == 200
        pnl = r_pnl.json()
        assert pnl["total_expenses"] == 120000.0
        assert pnl["net_profit"] == round(pnl["net_revenue"] - pnl["total_expenses"], 2)
        assert pnl["security_deposit_held"] == 0.0

        r_stmt = await client.get("/api/v1/finance/statements", headers=owner_headers)
        assert r_stmt.status_code == 200
        stmt = r_stmt.json()
        assert stmt["balance_sheet"]["is_balanced"] is True
        assert stmt["income_statement"]["total_expenses"] >= 120000.0

        # =====================================================================
        # 5. Live Kitchen/Ops BEO, Comms (@Kitchen), Offline Gate QR & Isolation
        # =====================================================================
        r_msg = await client.post(
            f"/api/v1/events/{event1_id}/messages",
            headers=owner_headers,
            json={
                "content": "@Kitchen Prepare 300 corporate banquet meals",
                "channel": "IN_APP",
                "department": "KITCHEN",
                "is_internal": True,
            },
        )
        assert r_msg.status_code == 200, r_msg.text
        assert "Kitchen" in r_msg.json()["mentions"]

        r_beo = await client.get("/api/v1/ops/beo", headers=owner_headers)
        assert r_beo.status_code == 200
        beo_orders = r_beo.json()["orders"]
        beo_ev1 = next(o for o in beo_orders if o["event_id"] == event1_id)
        assert any("@Kitchen Prepare 300 corporate banquet meals" in n["content"] for n in beo_ev1["internal_notes"])
        assert any(inv["item_name"] == "Royal Crystal Chandelier" and inv["quantity"] == 2 for inv in beo_ev1["inventory"])

        # Generate Gate QR passes (single + bulk CSV) & test offline sync manifest + duplicate scan rejection
        r_guest1 = await client.post(
            f"/api/v1/portal/events/{event1_id}/guests",
            headers=client_headers,
            json={"full_name": "Eng. Khalid CEO", "phone": "+967771010101", "vip_tier": "VIP"},
        )
        assert r_guest1.status_code == 200, r_guest1.text
        qr1 = r_guest1.json()["qr_token"]

        guests_csv = "\ufeffholder_name,holder_id_number,pass_type\nSara Director,ID-8821,VIP_PASS\n"
        r_guest_bulk = await client.post(
            "/api/v1/import/guests",
            headers=owner_headers,
            data={"event_id": event1_id},
            files={"file": ("guests.csv", guests_csv.encode("utf-8"), "text/csv")},
        )
        assert r_guest_bulk.status_code == 200, r_guest_bulk.text
        assert r_guest_bulk.json()["imported_rows"] == 1

        r_manifest = await client.get("/api/v1/sync/manifest", headers=owner_headers)
        assert r_manifest.status_code == 200
        manifest = r_manifest.json()
        manifest_tokens = {p["qr_token"] for p in manifest["gate_passes"]}
        assert qr1 in manifest_tokens
        assert len(manifest_tokens) >= 2

        now_iso = datetime.now(timezone.utc).isoformat()
        r_batch1 = await client.post(
            "/api/v1/sync/batch",
            headers=owner_headers,
            json={
                "device_id": "DESKTOP-GATE-01",
                "mutations": [
                    {
                        "mutation_id": "mut-1",
                        "action_type": "GATE_QR_CHECKIN",
                        "payload": {"qr_token": qr1},
                        "recorded_at": now_iso,
                    },
                    {
                        "mutation_id": "mut-2-dup",
                        "action_type": "GATE_QR_CHECKIN",
                        "payload": {"qr_token": qr1},
                        "recorded_at": now_iso,
                    },
                ],
            },
        )
        assert r_batch1.status_code == 200, r_batch1.text
        res_list = r_batch1.json()["results"]
        assert res_list[0]["result"] == "ADMITTED"
        assert res_list[1]["result"] == "ALREADY_CHECKED_IN"

        # Register second tenant (other-palace) & verify strict cross-tenant isolation (403 Forbidden)
        r_other = await client.post(
            "/api/v1/public/tenants/register",
            json={
                "venue_name": "Other Palace",
                "slug": "other-palace",
                "owner_name": "Other Owner",
                "owner_phone": "+967770009988",
                "owner_email": "owner@otherpalace.local",
                "owner_password": "OtherOwner@2026",
            },
        )
        assert r_other.status_code == 200, r_other.text
        other_token = r_other.json()["access_token"]
        cross_headers = {
            "Authorization": f"Bearer {other_token}",
            "X-Tenant-Slug": "smoke-palace",
        }
        assert (await client.get("/api/v1/finance/accounts", headers=cross_headers)).status_code == 403
        assert (await client.get("/api/v1/bookings/events", headers=cross_headers)).status_code == 403
        assert (await client.get("/api/v1/ops/beo", headers=cross_headers)).status_code == 403
        assert (await client.get("/api/v1/sync/manifest", headers=cross_headers)).status_code == 403
