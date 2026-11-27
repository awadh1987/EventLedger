import os
import uuid

_TEST_DB = "/tmp/eventledger_test_phase2.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "true"

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.base import Base
from app.models.events import AuditLog
from app.models.tenant import SubscriptionTier, Tenant
from app.models.users import StaffProfile, StaffRole, User, UserType


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_phase2_db():
    assert "sqlite" in str(engine.url), f"Refusing test DDL on non-sqlite URL: {engine.url}"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


@pytest.mark.asyncio
async def test_multi_theme_branding_presets_tokens_rbac_and_reset():
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Emerald Ballroom",
            slug=f"brand-{uuid.uuid4().hex[:6]}",
            subscription_tier=SubscriptionTier.PRO,
            currency="USD",
        )
        db.add(tenant)
        await db.flush()

        admin_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Tenant Admin",
            phone="+967772200001",
            email="admin@brand.local",
            password_hash=hash_password("AdminPass123!"),
        )
        staff_u = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Floor Staff",
            phone="+967772200002",
            email="staff@brand.local",
            password_hash=hash_password("StaffPass123!"),
        )
        db.add_all([admin_u, staff_u])
        await db.flush()
        db.add_all([
            StaffProfile(user_id=admin_u.id, role=StaffRole.ADMIN, department="MANAGEMENT"),
            StaffProfile(user_id=staff_u.id, role=StaffRole.STAFF, department="OPS"),
        ])
        await db.commit()

    admin_tok = create_access_token(
        user_id=admin_u.id,
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        staff_role=StaffRole.ADMIN,
    )
    staff_tok = create_access_token(
        user_id=staff_u.id,
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        staff_role=StaffRole.STAFF,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Authenticated GET /tenant/branding returns presets and default tokens
        res_get = await client.get(
            "/api/v1/tenant/branding",
            headers={"Authorization": f"Bearer {admin_tok}", "X-Tenant-Slug": tenant.slug},
        )
        assert res_get.status_code == 200, res_get.text
        data_get = res_get.json()
        assert data_get["theme_preset"] == "OBSIDIAN_GOLD"
        assert "EMERALD_PALACE" in data_get["presets"]
        assert "ROYAL_IVORY" in data_get["presets"]

        # 2. Staff without branding permission cannot PUT or reset branding
        res_deny = await client.put(
            "/api/v1/tenant/branding",
            headers={"Authorization": f"Bearer {staff_tok}", "X-Tenant-Slug": tenant.slug},
            json={"theme_preset": "EMERALD_PALACE", "primary_color": "#10B981"},
        )
        assert res_deny.status_code == 403

        # 3. Tenant ADMIN updates preset + surface/card/radius tokens
        res_put = await client.put(
            "/api/v1/tenant/branding",
            headers={"Authorization": f"Bearer {admin_tok}", "X-Tenant-Slug": tenant.slug},
            json={
                "theme_preset": "EMERALD_PALACE",
                "primary_color": "#10B981",
                "accent_color": "#064E3B",
                "surface_dark": "#022C22",
                "card_dark": "#064E3B",
                "card_radius": "1rem",
            },
        )
        assert res_put.status_code == 200, res_put.text
        d_put = res_put.json()
        assert d_put["status"] == "UPDATED"
        assert d_put["theme_preset"] == "EMERALD_PALACE"
        assert d_put["tokens"]["surface_dark"] == "#022C22"
        assert d_put["tokens"]["card_radius"] == "1rem"

        # 4. Public endpoint exposes themePreset and tokens to Storefront / Portal
        pub_res = await client.get(f"/api/v1/public/tenants/{tenant.slug}")
        assert pub_res.status_code == 200, pub_res.text
        pub_brand = pub_res.json()["branding"]
        assert pub_brand["themePreset"] == "EMERALD_PALACE"
        assert pub_brand["primaryColor"] == "#10B981"
        assert pub_brand["tokens"]["card_radius"] == "1rem"

        # 5. Reset restores OBSIDIAN_GOLD defaults and writes audit log
        res_reset = await client.post(
            "/api/v1/tenant/branding/reset",
            headers={"Authorization": f"Bearer {admin_tok}", "X-Tenant-Slug": tenant.slug},
        )
        assert res_reset.status_code == 200, res_reset.text
        assert res_reset.json()["status"] == "RESET"
        assert res_reset.json()["theme_preset"] == "OBSIDIAN_GOLD"
        assert res_reset.json()["primary_color"] == "#D4AF37"

    async with AsyncSessionLocal() as db:
        logs = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.tenant_id == tenant.id,
                    AuditLog.action.in_(["TENANT_BRANDING_UPDATED", "TENANT_BRANDING_RESET"]),
                )
            )
        ).scalars().all()
        assert len(logs) == 2
