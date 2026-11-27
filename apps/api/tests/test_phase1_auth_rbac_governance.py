import datetime as dt
import os
import uuid
from decimal import Decimal

_TEST_DB = "/tmp/eventledger_test_phase1.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "true"

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.base import Base
from app.models.events import AuditLog, Event, EventStatus
from app.models.governance import ChangeApprovalRequest
from app.models.tenant import SubscriptionTier, Tenant
from app.models.users import ClientCategory, ClientProfile, StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.routers.public_onboarding import seed_tenant_defaults

settings.DEBUG = True


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_phase1_db():
    assert "sqlite" in str(engine.url), f"Refusing test DDL on non-sqlite URL: {engine.url}"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


async def _seed_two_tenants():
    async with AsyncSessionLocal() as db:
        t1 = Tenant(
            name="Royal Palace Hall",
            slug=f"royal-{uuid.uuid4().hex[:6]}",
            subscription_tier=SubscriptionTier.PRO,
            currency="USD",
            tax_rate=Decimal("5.00"),
            monthly_whatsapp_quota=1000,
        )
        t2 = Tenant(
            name="Emerald Ballroom",
            slug=f"emerald-{uuid.uuid4().hex[:6]}",
            subscription_tier=SubscriptionTier.ENTERPRISE,
            currency="SAR",
            tax_rate=Decimal("15.00"),
            monthly_whatsapp_quota=2000,
        )
        db.add_all([t1, t2])
        await db.flush()
        await seed_tenant_defaults(db, t1.id)
        await seed_tenant_defaults(db, t2.id)

        h1 = Hall(
            tenant_id=t1.id,
            name="Crystal Main Hall",
            name_ar="قاعة الكريستال الرئيسية",
            capacity_banquet=300,
            capacity_theater=500,
            base_price=Decimal("2500.00"),
            cleaning_buffer_minutes=60,
        )
        h2 = Hall(
            tenant_id=t2.id,
            name="Emerald Grand Hall",
            name_ar="قاعة الزمرد الكبرى",
            capacity_banquet=250,
            capacity_theater=400,
            base_price=Decimal("3200.00"),
            cleaning_buffer_minutes=60,
        )
        db.add_all([h1, h2])

        u_sfx = uuid.uuid4().hex[:6]
        super_admin = User(
            tenant_id=None,
            user_type=UserType.SUPER_ADMIN,
            full_name="Platform Super Admin",
            phone=f"+9677700{u_sfx}",
            email=f"superadmin-{u_sfx}@events-ye.services",
            password_hash=hash_password("SuperPass123!"),
            is_active=True,
        )
        owner1 = User(
            tenant_id=t1.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Royal Owner",
            phone="+967771000001",
            email="owner1@royal.local",
            password_hash=hash_password("OwnerPass123!"),
            is_active=True,
        )
        staff1 = User(
            tenant_id=t1.id,
            user_type=UserType.INTERNAL_STAFF,
            full_name="Royal Coordinator",
            phone="+967771000002",
            email="staff1@royal.local",
            password_hash=hash_password("StaffPass123!"),
            is_active=True,
        )
        db.add_all([super_admin, owner1, staff1])
        await db.flush()

        db.add(
            StaffProfile(
                user_id=owner1.id,
                role=StaffRole.OWNER,
                department="MANAGEMENT",
                max_discount_percent=Decimal("25.00"),
            )
        )
        db.add(
            StaffProfile(
                user_id=staff1.id,
                role=StaffRole.SALES,
                department="SALES",
                max_discount_percent=Decimal("10.00"),
            )
        )
        await db.commit()
        return {
            "t1": t1,
            "t2": t2,
            "h1": h1,
            "h2": h2,
            "super_admin": super_admin,
            "owner1": owner1,
            "staff1": staff1,
        }


@pytest.mark.asyncio
async def test_cross_tenant_booking_step3_password_and_login():
    seeded = await _seed_two_tenants()
    t1, t2, h1, h2 = seeded["t1"], seeded["t2"], seeded["h1"], seeded["h2"]

    start1 = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=10)).replace(
        hour=16, minute=0, second=0, microsecond=0
    )
    end1 = start1 + dt.timedelta(hours=5)
    start2 = start1 + dt.timedelta(days=2)
    end2 = start2 + dt.timedelta(hours=5)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Book in Tenant 1 with Step 3 REGISTER password + event_title -> issues JWT directly
        hold1 = await client.post(
            "/api/v1/bookings/hold",
            headers={"X-Tenant-Slug": t1.slug},
            json={
                "hall_id": str(h1.id),
                "start_time": start1.isoformat(),
                "end_time": end1.isoformat(),
                "event_title": "Al-Harbi Royal Wedding",
                "event_type": "WEDDING",
                "guest_count": 120,
                "client_full_name": "Tariq Client",
                "client_phone": "+967779991111",
                "client_email": "tariq@client.local",
                "client_auth_mode": "REGISTER",
                "client_password": "ClientPass123!",
            },
        )
        assert hold1.status_code == 200, hold1.text
        d1 = hold1.json()
        assert d1["title"] == "Al-Harbi Royal Wedding"
        assert d1["portal_auth_hint"] == "AUTHENTICATED"
        assert d1["access_token"]
        assert d1["user"]["phone"] == "+967779991111"

        # 2. Repeat hold in SAME tenant with same phone/email (no 409!) and LOGIN password mode
        hold1_again = await client.post(
            "/api/v1/bookings/hold",
            headers={"X-Tenant-Slug": t1.slug},
            json={
                "hall_id": str(h1.id),
                "start_time": (start1 + dt.timedelta(days=1)).isoformat(),
                "end_time": (end1 + dt.timedelta(days=1)).isoformat(),
                "event_title": "Second Reception",
                "event_type": "RECEPTION",
                "guest_count": 90,
                "client_full_name": "Tariq Client",
                "client_phone": "+967779991111",
                "client_email": "tariq@client.local",
                "client_auth_mode": "LOGIN",
                "client_password": "ClientPass123!",
            },
        )
        assert hold1_again.status_code == 200, hold1_again.text
        assert hold1_again.json()["access_token"]

        # 3. Same client phone/email books in Tenant 2 -> auto-provisions tenant-2 user & EVT-YYYY-000001 cleanly
        hold2 = await client.post(
            "/api/v1/bookings/hold",
            headers={"X-Tenant-Slug": t2.slug},
            json={
                "hall_id": str(h2.id),
                "start_time": start2.isoformat(),
                "end_time": end2.isoformat(),
                "event_title": "Emerald Gala",
                "event_type": "GALA",
                "guest_count": 80,
                "client_full_name": "Tariq Client",
                "client_phone": "+967779991111",
                "client_email": "tariq@client.local",
                "client_auth_mode": "LOGIN",
                "client_password": "ClientPass123!",
            },
        )
        assert hold2.status_code == 200, hold2.text
        d2 = hold2.json()
        assert d2["access_token"]
        assert d2["user"]["tenant_slug"] == t2.slug

        # 4. Returning client password login on Tenant 2 + Platform Root login workspaces list
        login_t2 = await client.post(
            "/api/v1/auth/login",
            headers={"X-Tenant-Slug": t2.slug},
            json={"identifier": "+967779991111", "password": "ClientPass123!"},
        )
        assert login_t2.status_code == 200, login_t2.text
        assert login_t2.json()["user"]["tenant_slug"] == t2.slug
        assert login_t2.json()["user"]["last_login_at"] is not None

        login_root = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "tariq@client.local", "password": "ClientPass123!"},
        )
        assert login_root.status_code == 200, login_root.text
        workspaces = login_root.json().get("workspaces", [])
        assert len(workspaces) >= 2


@pytest.mark.asyncio
async def test_otp_login_and_tenant_users_rbac_crud():
    seeded = await _seed_two_tenants()
    t1, owner1, staff1, super_admin = (
        seeded["t1"],
        seeded["owner1"],
        seeded["staff1"],
        seeded["super_admin"],
    )
    owner_tok = create_access_token(
        user_id=owner1.id,
        tenant_id=t1.id,
        user_type=UserType.INTERNAL_STAFF,
        staff_role=StaffRole.OWNER,
    )
    staff_tok = create_access_token(
        user_id=staff1.id,
        tenant_id=t1.id,
        user_type=UserType.INTERNAL_STAFF,
        staff_role=StaffRole.SALES,
    )
    sa_tok = create_access_token(
        user_id=super_admin.id,
        tenant_id=None,
        user_type=UserType.SUPER_ADMIN,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. OTP request + login marks phone_verified and last_login_at
        otp_req = await client.post(
            "/api/v1/auth/otp-request",
            headers={"X-Tenant-Slug": t1.slug},
            json={"identifier": staff1.phone},
        )
        assert otp_req.status_code == 200, otp_req.text
        dev_code = otp_req.json()["dev_otp"]

        otp_log = await client.post(
            "/api/v1/auth/otp-login",
            headers={"X-Tenant-Slug": t1.slug},
            json={"identifier": staff1.phone, "otp_code": dev_code},
        )
        assert otp_log.status_code == 200, otp_log.text
        assert otp_log.json()["user"]["phone_verified"] is True
        assert otp_log.json()["user"]["last_login_at"] is not None

        # 2. RBAC Meta endpoint + Staff without users_rbac permission rejected
        forbidden = await client.get(
            "/api/v1/tenant/users",
            headers={"Authorization": f"Bearer {staff_tok}", "X-Tenant-Slug": t1.slug},
        )
        assert forbidden.status_code == 403

        meta = await client.get(
            "/api/v1/tenant/users/meta",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
        )
        assert meta.status_code == 200, meta.text
        assert "FINANCE" in meta.json()["roles"]
        assert "OTHER" in meta.json()["roles"]

        # 3. Create custom "OTHER" role user with custom matrix permissions
        created = await client.post(
            "/api/v1/tenant/users",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={
                "full_name": "Banquet Architect",
                "phone": "+967771112233",
                "email": "architect@royal.local",
                "password": "TempUser123!",
                "staff_role": "OTHER",
                "custom_role_title": "Lighting & Stage Lead",
                "department": "AUDIO_VISUAL",
                "permissions": {
                    "bookings": ["view", "edit"],
                    "operations": ["view", "create", "edit"],
                },
            },
        )
        assert created.status_code == 200, created.text
        new_uid = created.json()["id"]
        assert created.json()["staff_role"] == "OTHER"
        assert created.json()["custom_role_title"] == "Lighting & Stage Lead"
        assert created.json()["permissions"]["bookings"] == ["view", "edit"]

        # 4. Patch permissions & suspend, then reset password
        patched = await client.patch(
            f"/api/v1/tenant/users/{new_uid}",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={"is_active": False, "department": "STAGE_ENGINEERING"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["is_active"] is False

        reset_pw = await client.post(
            f"/api/v1/tenant/users/{new_uid}/reset-password",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={"new_password": "NewUserPass999!"},
        )
        assert reset_pw.status_code == 200

        # 5. Super Admin cross-tenant users oversight
        sa_list = await client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {sa_tok}"},
        )
        assert sa_list.status_code == 200, sa_list.text
        assert len(sa_list.json()) >= 3

        # 6. Delete clean user
        deleted = await client.delete(
            f"/api/v1/tenant/users/{new_uid}",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["status"] == "DELETED"


@pytest.mark.asyncio
async def test_tiered_governance_approvals_and_editable_event_title():
    seeded = await _seed_two_tenants()
    t1, h1, owner1, staff1, super_admin = (
        seeded["t1"],
        seeded["h1"],
        seeded["owner1"],
        seeded["staff1"],
        seeded["super_admin"],
    )
    owner_tok = create_access_token(
        user_id=owner1.id,
        tenant_id=t1.id,
        user_type=UserType.INTERNAL_STAFF,
        staff_role=StaffRole.OWNER,
    )
    staff_tok = create_access_token(
        user_id=staff1.id,
        tenant_id=t1.id,
        user_type=UserType.INTERNAL_STAFF,
        staff_role=StaffRole.SALES,
    )
    sa_tok = create_access_token(
        user_id=super_admin.id,
        tenant_id=None,
        user_type=UserType.SUPER_ADMIN,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create event & client via hold
        start = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=15)).replace(
            hour=17, minute=0, second=0, microsecond=0
        )
        hold = await client.post(
            "/api/v1/bookings/hold",
            headers={"X-Tenant-Slug": t1.slug},
            json={
                "hall_id": str(h1.id),
                "start_time": start.isoformat(),
                "end_time": (start + dt.timedelta(hours=4)).isoformat(),
                "event_title": "Original Title",
                "event_type": "CONFERENCE",
                "guest_count": 100,
                "client_full_name": "Nadia Summit",
                "client_phone": "+967778889900",
                "client_email": "nadia@summit.local",
                "client_auth_mode": "REGISTER",
                "client_password": "ClientPass123!",
            },
        )
        assert hold.status_code == 200, hold.text
        ev_id = hold.json()["event_id"]
        client_tok = hold.json()["access_token"]

        # 1. Direct staff edit event title via PATCH /bookings/events/{id}
        ev_patch = await client.patch(
            f"/api/v1/bookings/events/{ev_id}",
            headers={"Authorization": f"Bearer {staff_tok}", "X-Tenant-Slug": t1.slug},
            json={"title": "Yemen Fintech Summit 2026", "remarks": "Updated title per organizer"},
        )
        assert ev_patch.status_code == 200, ev_patch.text
        assert ev_patch.json()["title"] == "Yemen Fintech Summit 2026"

        # 2. Client submits CLIENT identity change -> goes to TENANT_ADMIN scope
        cl_req = await client.post(
            "/api/v1/governance/change-requests",
            headers={"Authorization": f"Bearer {client_tok}", "X-Tenant-Slug": t1.slug},
            json={
                "target_entity_type": "CLIENT",
                "proposed_values": {"full_name": "Nadia Al-Mansoor", "company_name": "FinTech Yemen Co"},
                "remarks": "Official CR name update",
            },
        )
        assert cl_req.status_code == 200, cl_req.text
        cl_req_id = cl_req.json()["id"]
        assert cl_req.json()["scope"] == "TENANT_ADMIN"

        # Lower staff cannot approve TENANT_ADMIN request
        deny_staff = await client.post(
            f"/api/v1/governance/change-requests/{cl_req_id}/resolve",
            headers={"Authorization": f"Bearer {staff_tok}", "X-Tenant-Slug": t1.slug},
            json={"decision": "APPROVED"},
        )
        assert deny_staff.status_code == 403

        # Tenant Owner approves CLIENT request -> updates User & creates AuditLog
        approve_cl = await client.post(
            f"/api/v1/governance/change-requests/{cl_req_id}/resolve",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={"decision": "APPROVED", "remarks": "Verified CR document"},
        )
        assert approve_cl.status_code == 200, approve_cl.text
        assert approve_cl.json()["status"] == "APPROVED"

        # 3. Tenant Owner submits TENANT change -> goes to SUPER_ADMIN scope
        tn_req = await client.post(
            "/api/v1/governance/change-requests",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={
                "target_entity_type": "TENANT",
                "proposed_values": {"name": "Royal Palace & Convention Center", "tax_rate": 7.5},
                "remarks": "Rebranding and updated VAT",
            },
        )
        assert tn_req.status_code == 200, tn_req.text
        tn_req_id = tn_req.json()["id"]
        assert tn_req.json()["scope"] == "SUPER_ADMIN"

        # Tenant Owner CANNOT self-approve TENANT change
        self_approve = await client.post(
            f"/api/v1/governance/change-requests/{tn_req_id}/resolve",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={"decision": "APPROVED"},
        )
        assert self_approve.status_code == 403

        # Super Admin returns for amendment, Owner resubmits, Super Admin approves
        returned = await client.post(
            f"/api/v1/governance/change-requests/{tn_req_id}/resolve",
            headers={"Authorization": f"Bearer {sa_tok}"},
            json={"decision": "RETURNED_FOR_AMENDMENT", "remarks": "Please confirm 5% vs 7.5%"},
        )
        assert returned.status_code == 200
        assert returned.json()["status"] == "RETURNED_FOR_AMENDMENT"

        resub = await client.patch(
            f"/api/v1/governance/change-requests/{tn_req_id}/resubmit",
            headers={"Authorization": f"Bearer {owner_tok}", "X-Tenant-Slug": t1.slug},
            json={"proposed_values": {"name": "Royal Palace & Convention Center", "tax_rate": 5.0}, "remarks": "Confirmed 5%"},
        )
        assert resub.status_code == 200
        assert resub.json()["status"] == "PENDING"

        sa_approve = await client.post(
            f"/api/v1/governance/change-requests/{tn_req_id}/resolve",
            headers={"Authorization": f"Bearer {sa_tok}"},
            json={"decision": "APPROVED", "remarks": "Approved by platform"},
        )
        assert sa_approve.status_code == 200
        assert sa_approve.json()["status"] == "APPROVED"

    async with AsyncSessionLocal() as db:
        t1_refreshed = (await db.execute(select(Tenant).where(Tenant.id == t1.id))).scalar_one()
        assert t1_refreshed.name == "Royal Palace & Convention Center"
        ev_refreshed = (await db.execute(select(Event).where(Event.id == uuid.UUID(ev_id)))).scalar_one()
        assert ev_refreshed.title == "Yemen Fintech Summit 2026"
        logs = (
            await db.execute(
                select(AuditLog).where(AuditLog.tenant_id == t1.id, AuditLog.action.like("GOVERNANCE_%"))
            )
        ).scalars().all()
        assert len(logs) >= 4
