```markdown
# EventLedger (إيفنت ليدجر) — Complete Backend FastAPI Engines & Routers Pack
**File Path:** `docs/02-backend-fastapi-engines-and-routers.md`  
**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Pydantic v2 + Celery + Redis + WeasyPrint  
**Purpose:** Provides all missing backend engines for both **Ecosystem Tier 1 (EventLedger SaaS & Venue Tenants)** and **Ecosystem Tier 2 (`<slug>` Venues & End Clients)**, closing every gap found in the live UI audit.

---

## 1. Extended SQLAlchemy 2.0 Models (`apps/api/app/models/events_extensions.py`)

Add these models to `apps/api/app/models/` and import them in `alembic/env.py` and `seed.py` to support **Digital Contracts & E-Signatures**, **Guest RSVP + Table/Dietary Assignments**, and **Post-Event Damage Inspections**:

```python
import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.tenant import Base


class RsvpStatus(str, enum.Enum):
    INVITED = "INVITED"
    CONFIRMED = "CONFIRMED"
    DECLINED = "DECLINED"


class InspectionStatus(str, enum.Enum):
    PASSED = "PASSED"
    DAMAGE_CLAIMED = "DAMAGE_CLAIMED"


class EventContract(Base):
    __tablename__ = "event_contracts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True)
    contract_number: Mapped[str] = mapped_column(String(60), unique=True)
    terms_ar: Mapped[str] = mapped_column(Text)
    terms_en: Mapped[str] = mapped_column(Text)
    client_signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    client_signature_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    client_signature_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    staff_countersigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EventGuest(Base):
    __tablename__ = "event_guests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    vip_tier: Mapped[str] = mapped_column(String(40), default="STANDARD")  # STANDARD, VIP, FAMILY, SPEAKER
    dietary_notes: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    table_label: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    rsvp_status: Mapped[RsvpStatus] = mapped_column(Enum(RsvpStatus), default=RsvpStatus.INVITED)
    gate_pass_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("gate_passes.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DamageInspection(Base):
    __tablename__ = "damage_inspections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True)
    inspected_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    checklist_json: Mapped[dict] = mapped_column(JSON, default=dict)
    photos_json: Mapped[list] = mapped_column(JSON, default=list)
    deduction_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[InspectionStatus] = mapped_column(Enum(InspectionStatus), default=InspectionStatus.PASSED)
    inspected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

```

---

## 2. Tier 1 SaaS Super-Admin & Public `<slug>` Directory (`apps/api/app/routers/admin.py`)

```python
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import AuthContext, require_roles
from app.models.accounting import Invoice
from app.models.events import Event
from app.models.tenant import SubscriptionTier, Tenant, TenantBranding
from app.models.users import User, UserType
from app.models.venue import Hall

router = APIRouter(prefix="/api/v1", tags=["Tier 1: SaaS Super-Admin & Tenant Directory"])


class UpdateTenantAdminBody(BaseModel):
    is_active: Optional[bool] = None
    subscription_tier: Optional[SubscriptionTier] = None
    custom_domain: Optional[str] = None
    custom_domain_verified: Optional[bool] = None
    max_halls: Optional[int] = None
    monthly_whatsapp_quota: Optional[int] = None


@router.get("/public/tenants/{slug}")
async def get_public_tenant_by_slug(slug: str, db: AsyncSession = Depends(get_db)):
    clean_slug = slug.strip().lower()
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == clean_slug, Tenant.is_active == True))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Venue workspace not found or inactive")

    branding = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    ).scalar_one_or_none()
    halls = (
        await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))
    ).scalars().all()

    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "custom_domain": tenant.custom_domain,
        "currency": tenant.currency,
        "tax_rate": float(tenant.tax_rate),
        "subscription_tier": tenant.subscription_tier.value,
        "payment_accounts": tenant.payment_accounts or [
            {"code": "KURAIMI_BANK", "labelAr": "بنك الكريمي", "labelEn": "Kuraimi Bank", "account": "301234567"},
            {"code": "JAIB_WALLET", "labelAr": "محفظة جيب", "labelEn": "Jaib Wallet", "account": "770000001"},
            {"code": "JAWALI_WALLET", "labelAr": "محفظة جوالي", "labelEn": "Jawali Wallet", "account": "770000002"},
            {"code": "ONECASH_WALLET", "labelAr": "ون كاش", "labelEn": "OneCash", "account": "770000003"},
        ],
        "branding": {
            "primaryColor": branding.primary_color if branding else "#D4AF37",
            "accentColor": branding.accent_color if branding else "#0F172A",
            "defaultTheme": branding.default_theme if branding else "DARK",
            "enableSpotlight": branding.enable_spotlight if branding else True,
            "spotlightColor": branding.spotlight_color if branding else "rgba(212, 175, 55, 0.18)",
            "logoLightUrl": branding.logo_light_url if branding else None,
            "logoDarkUrl": branding.logo_dark_url if branding else None,
            "faviconUrl": branding.favicon_url if branding else None,
        },
        "halls": [
            {
                "id": str(h.id),
                "name": h.name,
                "name_ar": h.name_ar,
                "capacity_banquet": h.capacity_banquet,
                "capacity_theater": h.capacity_theater,
                "base_price": float(h.base_price),
                "cleaning_buffer_minutes": h.cleaning_buffer_minutes,
                "combinable_with_hall_id": str(h.combinable_with_hall_id) if h.combinable_with_hall_id else None,
            }
            for h in halls
        ],
    }


@router.get("/admin/tenants")
async def list_all_tenants(
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    tenants = (await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))).scalars().all()
    items = []
    for t in tenants:
        halls_count = (await db.execute(select(func.count(Hall.id)).where(Hall.tenant_id == t.id))).scalar() or 0
        events_count = (await db.execute(select(func.count(Event.id)).where(Event.tenant_id == t.id))).scalar() or 0
        users_count = (await db.execute(select(func.count(User.id)).where(User.tenant_id == t.id))).scalar() or 0
        gmv = (await db.execute(select(func.coalesce(func.sum(Invoice.total_amount), 0)).where(Invoice.tenant_id == t.id))).scalar() or 0
        items.append(
            {
                "id": str(t.id),
                "name": t.name,
                "slug": t.slug,
                "custom_domain": t.custom_domain,
                "custom_domain_verified": getattr(t, "custom_domain_verified", False),
                "subscription_tier": t.subscription_tier.value,
                "currency": t.currency,
                "is_active": t.is_active,
                "halls_count": halls_count,
                "events_count": events_count,
                "users_count": users_count,
                "total_gmv": float(gmv),
                "created_at": t.created_at.isoformat(),
            }
        )
    return {"tenants": items}


@router.patch("/admin/tenants/{tenant_id}")
async def update_tenant_admin(
    tenant_id: uuid.UUID,
    body: UpdateTenantAdminBody,
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    for field, val in body.model_dump(exclude_none=True).items():
        if hasattr(tenant, field):
            setattr(tenant, field, val)

    await db.commit()
    return {"status": "UPDATED", "tenant_id": str(tenant.id), "is_active": tenant.is_active}

```

---

## 3. Complete Multi-Hall Partition Reservation & 48h Hold Engine (`apps/api/app/routers/bookings.py`)

Upgrades `/api/v1/bookings/hold` so **public storefront visitors** (without needing a pre-existing UUID) can submit their `full_name`, `phone`, `client_category` (`INDIVIDUAL_B2C` or `CORPORATE_B2B`), select single or **merged partition halls** (`merge_combinable_hall=True`), select catering per-guest packages, and generate a `HOLD_48H` booking + `Invoice` + `PaymentMilestone` + `EventContract` + `AuditLog` in a single atomic transaction:

```python
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.core.security import hash_password
from app.models.accounting import DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import AuditLog, Event, EventStatus
from app.models.events_extensions import EventContract
from app.models.users import ClientCategory, ClientProfile, User, UserType
from app.models.venue import CateringMenuItem, Hall
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Tier 2: Reservation, Partition Merge & 48h Hold Engine"])


class PublicHoldBookingRequest(BaseModel):
    hall_id: uuid.UUID
    merge_combinable_hall: bool = False
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = Field(default=250, ge=10)
    catering_item_id: Optional[uuid.UUID] = None
    addon_amount: Decimal = Decimal("0.00")
    # Client details (creates or reuses CLIENT_PRIMARY account automatically)
    client_full_name: str = Field(..., min_length=2)
    client_phone: str = Field(..., min_length=7)
    client_email: Optional[str] = None
    client_category: ClientCategory = ClientCategory.INDIVIDUAL_B2C
    company_name: Optional[str] = None
    tax_id: Optional[str] = None


@router.get("/public/halls/availability")
async def get_public_availability_and_calendar(
    request: Request,
    hall_id: Optional[uuid.UUID] = Query(default=None),
    start_time: Optional[datetime] = Query(default=None),
    end_time: Optional[datetime] = Query(default=None),
    merge_combinable_hall: bool = Query(default=False),
    guest_count: int = Query(default=250),
    catering_item_id: Optional[uuid.UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    halls = (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()
    upcoming = (
        await db.execute(
            select(Event)
            .where(
                Event.tenant_id == tenant.id,
                Event.status.in_([EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]),
            )
            .order_by(Event.start_time.asc())
        )
    ).scalars().all()

    calendar_blocks = [
        {
            "event_id": str(e.id),
            "event_code": e.event_code,
            "hall_id": str(e.hall_id),
            "event_type": e.event_type,
            "status": e.status.value,
            "start_time": e.start_time.isoformat(),
            "end_time": e.end_time.isoformat(),
            "guest_count": e.guest_count,
        }
        for e in upcoming
    ]

    if not hall_id or not start_time or not end_time:
        return {"halls": [{"id": str(h.id), "name": h.name, "name_ar": h.name_ar} for h in halls], "occupied_slots": calendar_blocks}

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, hall_id, start_time, end_time)

    # Calculate combined hall + catering quote
    catering_total = Decimal("0.00")
    if catering_item_id:
        cat_item = (
            await db.execute(select(CateringMenuItem).where(CateringMenuItem.id == catering_item_id, CateringMenuItem.tenant_id == tenant.id))
        ).scalar_one_or_none()
        if cat_item:
            catering_total = Decimal(str(cat_item.price_per_guest)) * Decimal(str(guest_count))

    merged_hall_addon = Decimal("0.00")
    if merge_combinable_hall:
        primary_hall = (await db.execute(select(Hall).where(Hall.id == hall_id))).scalar_one_or_none()
        if primary_hall and primary_hall.combinable_with_hall_id:
            partner_hall = (await db.execute(select(Hall).where(Hall.id == primary_hall.combinable_with_hall_id))).scalar_one_or_none()
            if partner_hall:
                merged_hall_addon = Decimal(str(partner_hall.base_price)) * Decimal("0.85")  # 15% partition merge bundle discount

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, tenant.id, hall_id, start_time, addon_amount=catering_total + merged_hall_addon
    )
    quote["catering_total"] = float(catering_total)
    quote["merged_hall_addon"] = float(merged_hall_addon)

    return {"availability": avail, "quote": quote, "occupied_slots": calendar_blocks}


@router.post("/bookings/hold")
async def create_public_or_staff_48h_hold(
    body: PublicHoldBookingRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, body.hall_id, body.start_time, body.end_time)
    if not avail["available"]:
        raise HTTPException(status_code=409, detail={"message": "Hall schedule conflict detected", "conflicts": avail["conflicts"]})

    # Find or create CLIENT_PRIMARY user in this tenant
    clean_phone = body.client_phone.strip()
    client_user = (
        await db.execute(select(User).where(User.tenant_id == tenant.id, User.phone == clean_phone))
    ).scalar_one_or_none()

    if not client_user:
        client_user = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_PRIMARY,
            email=body.client_email.strip().lower() if body.client_email else None,
            phone=clean_phone,
            password_hash=hash_password("Client@2026"),
            full_name=body.client_full_name.strip(),
            preferred_lang="ar",
        )
        db.add(client_user)
        await db.flush()
        db.add(
            ClientProfile(
                user_id=client_user.id,
                client_category=body.client_category,
                company_name=body.company_name,
                tax_id=body.tax_id,
            )
        )

    catering_total = Decimal("0.00")
    if body.catering_item_id:
        cat_item = (
            await db.execute(select(CateringMenuItem).where(CateringMenuItem.id == body.catering_item_id, CateringMenuItem.tenant_id == tenant.id))
        ).scalar_one_or_none()
        if cat_item:
            catering_total = Decimal(str(cat_item.price_per_guest)) * Decimal(str(body.guest_count))

    merged_hall_addon = Decimal("0.00")
    if body.merge_combinable_hall:
        primary_hall = (await db.execute(select(Hall).where(Hall.id == body.hall_id))).scalar_one_or_none()
        if primary_hall and primary_hall.combinable_with_hall_id:
            partner_hall = (await db.execute(select(Hall).where(Hall.id == primary_hall.combinable_with_hall_id))).scalar_one_or_none()
            if partner_hall:
                merged_hall_addon = Decimal(str(partner_hall.base_price)) * Decimal("0.85")

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, tenant.id, body.hall_id, body.start_time, addon_amount=body.addon_amount + catering_total + merged_hall_addon
    )

    event_code = f"EVT-{datetime.now(timezone.utc).year}-{str(uuid.uuid4().int % 10000).zfill(4)}"
    event = Event(
        tenant_id=tenant.id,
        hall_id=body.hall_id,
        primary_client_id=client_user.id,
        event_code=event_code,
        event_type=body.event_type,
        start_time=body.start_time.replace(tzinfo=None) if body.start_time.tzinfo else body.start_time,
        end_time=body.end_time.replace(tzinfo=None) if body.end_time.tzinfo else body.end_time,
        status=EventStatus.HOLD_48H,
        guest_count=body.guest_count,
    )
    db.add(event)
    await db.flush()

    invoice = Invoice(
        tenant_id=tenant.id,
        event_id=event.id,
        invoice_number=f"INV-{event_code}",
        subtotal=Decimal(str(quote["subtotal"])),
        tax_amount=Decimal(str(quote["tax_amount"])),
        total_amount=Decimal(str(quote["total_amount"])),
        security_deposit_amount=Decimal(str(quote["security_deposit_amount"])),
        deposit_status=DepositStatus.UNPAID,
        status=InvoiceStatus.ISSUED,
    )
    db.add(invoice)
    await db.flush()

    deposit_due = (Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01"))
    balance_due = Decimal(str(quote["total_amount"])) - deposit_due

    db.add_all([
        PaymentMilestone(
            invoice_id=invoice.id,
            title="الدفعة الأولى لتأكيد الحجز (50%) / Booking Confirmation Deposit",
            amount_due=deposit_due,
            due_date=datetime.utcnow() + timedelta(hours=48),
            status="PENDING",
        ),
        PaymentMilestone(
            invoice_id=invoice.id,
            title="الدفعة النهائية قبل المناسبة (50%) / Final Balance",
            amount_due=balance_due,
            due_date=event.start_time - timedelta(days=7),
            status="PENDING",
        ),
    ])

    db.add(
        EventContract(
            tenant_id=tenant.id,
            event_id=event.id,
            contract_number=f"CTR-{event_code}",
            terms_ar="يلتزم الطرف الثاني بسداد دفعة التأكيد خلال 48 ساعة لتثبيت الحجز نهائياً، ويُسترد مبلغ التأمين بعد فحص القاعة.",
            terms_en="Second Party agrees to pay the 50% confirmation deposit within 48 hours. Security deposit is refunded post-inspection.",
        )
    )

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            event_id=event.id,
            actor_id=client_user.id,
            action="HOLD_48H_CREATED",
            new_value={"event_code": event_code, "total_amount": quote["total_amount"], "merged_halls": body.merge_combinable_hall},
        )
    )
    await db.commit()

    # Schedule Redis TTL + Celery 48h auto-expiry
    try:
        import redis.asyncio as aioredis
        from app.workers.celery_tasks import expire_unpaid_48h_hold

        r = aioredis.from_url(settings.REDIS_URL)
        await r.setex(f"hold:event:{event.id}", 48 * 3600, event_code)
        await r.aclose()
        expire_unpaid_48h_hold.apply_async(args=[str(event.id)], countdown=48 * 3600)
    except Exception:
        pass

    return {
        "event_id": str(event.id),
        "event_code": event.event_code,
        "client_id": str(client_user.id),
        "status": "HOLD_48H",
        "expires_in_hours": 48,
        "quote": quote,
    }

```

---

## 4. Client Portal & Operations Lifecycle Router (`apps/api/app/routers/lifecycle_ops.py`)

Implements **Contract E-Signature**, **Guest List + Auto QR Gate Pass Generation**, **Payment Milestone Verification with Double-Entry Auto-Posting**, and **Post-Event Damage Inspection & Security Deposit Release**:

```python
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles
from app.models.accounting import DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import AuditLog, Event, EventStatus, GatePass
from app.models.events_extensions import DamageInspection, EventContract, EventGuest, InspectionStatus, RsvpStatus
from app.models.users import StaffRole, UserType
from app.services.accounting_service import DoubleEntryService

router = APIRouter(prefix="/api/v1", tags=["Tier 2: Contracts, Guests, Receipt Verify & Deposit Vault"])


class SignContractBody(BaseModel):
    signature_name: str


class AddGuestBody(BaseModel):
    full_name: str
    phone: Optional[str] = None
    vip_tier: str = "STANDARD"
    dietary_notes: Optional[str] = None
    table_label: Optional[str] = None


class VerifyMilestoneBody(BaseModel):
    payment_method: str = "KURAIMI_BANK"
    is_security_deposit: bool = False
    reference: str = "Verified Transfer"


class DamageInspectionBody(BaseModel):
    status: InspectionStatus
    deduction_amount: Decimal = Decimal("0.00")
    notes: Optional[str] = None
    checklist_json: dict = {}


@router.post("/portal/events/{event_id}/contract/sign")
async def sign_event_contract(
    event_id: uuid.UUID,
    body: SignContractBody,
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    contract = (
        await db.execute(select(EventContract).where(EventContract.event_id == event_id, EventContract.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract.client_signed_at = datetime.utcnow()
    contract.client_signature_name = body.signature_name.strip()
    contract.client_signature_ip = request.client.host if request.client else "unknown"

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="CONTRACT_ESIGNED_BY_CLIENT",
            new_value={"contract_number": contract.contract_number, "signed_by": contract.client_signature_name},
        )
    )
    await db.commit()
    return {"status": "SIGNED", "contract_number": contract.contract_number, "signed_at": contract.client_signed_at.isoformat()}


@router.post("/portal/events/{event_id}/guests")
async def add_guest_with_qr_pass(
    event_id: uuid.UUID,
    body: AddGuestBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    ev = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    qr_token = f"QR-{ev.event_code}-{str(uuid.uuid4().int % 100000).zfill(5)}"
    gate_pass = GatePass(
        event_id=ev.id,
        pass_type="VIP_PASS" if body.vip_tier == "VIP" else "GUEST_PASS",
        holder_name=body.full_name.strip(),
        qr_token=qr_token,
        valid_from=ev.start_time - timedelta(hours=2),
        valid_until=ev.end_time + timedelta(hours=2),
    )
    db.add(gate_pass)
    await db.flush()

    guest = EventGuest(
        tenant_id=auth.tenant_id,
        event_id=ev.id,
        full_name=body.full_name.strip(),
        phone=body.phone,
        vip_tier=body.vip_tier,
        dietary_notes=body.dietary_notes,
        table_label=body.table_label,
        rsvp_status=RsvpStatus.CONFIRMED,
        gate_pass_id=gate_pass.id,
    )
    db.add(guest)
    await db.commit()
    return {"guest_id": str(guest.id), "qr_token": qr_token, "pass_type": gate_pass.pass_type}


@router.patch("/erp/finance/milestones/{milestone_id}/verify")
async def verify_payment_milestone(
    milestone_id: uuid.UUID,
    body: VerifyMilestoneBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.FINANCE})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    ms = (await db.execute(select(PaymentMilestone).where(PaymentMilestone.id == milestone_id))).scalar_one_or_none()
    if not ms:
        raise HTTPException(status_code=404, detail="Payment milestone not found")

    inv = (
        await db.execute(select(Invoice).where(Invoice.id == ms.invoice_id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found in tenant")

    ms.paid_amount = ms.amount_due
    ms.payment_method = body.payment_method
    ms.status = "PAID"
    ms.paid_at = datetime.utcnow()

    if body.is_security_deposit:
        inv.deposit_status = DepositStatus.HELD
    else:
        all_ms = (await db.execute(select(PaymentMilestone).where(PaymentMilestone.invoice_id == inv.id))).scalars().all()
        total_paid = sum((Decimal(str(m.paid_amount)) for m in all_ms), Decimal("0.00"))
        inv.status = InvoiceStatus.PAID if total_paid >= Decimal(str(inv.total_amount)) else InvoiceStatus.PARTIALLY_PAID

        # Confirm HOLD_48H event automatically on first verified deposit
        ev = (await db.execute(select(Event).where(Event.id == inv.event_id))).scalar_one_or_none()
        if ev and ev.status == EventStatus.HOLD_48H:
            ev.status = EventStatus.CONFIRMED

    # Auto-post balanced double-entry journal entry
    je = await DoubleEntryService.record_verified_payment(
        db=db,
        tenant_id=auth.tenant_id,
        user_id=auth.user.id,
        event_id=inv.event_id,
        amount=Decimal(str(ms.amount_due)),
        is_security_deposit=body.is_security_deposit,
        payment_method=body.payment_method,
        reference=f"{inv.invoice_number} — {body.reference}",
    )

    return {"status": "VERIFIED", "invoice_status": inv.status.value, "journal_entry_number": je.entry_number}


@router.post("/erp/ops/events/{event_id}/inspection")
async def submit_damage_inspection(
    event_id: uuid.UUID,
    body: DamageInspectionBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.OPS_MANAGER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    ev = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    inv = (await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == auth.tenant_id))).scalar_one_or_none()
    if inv:
        inv.deposit_status = (
            DepositStatus.INSPECTION_PASSED if body.status == InspectionStatus.PASSED else DepositStatus.DEDUCTED
        )

    ev.status = EventStatus.COMPLETED
    inspection = DamageInspection(
        tenant_id=auth.tenant_id,
        event_id=event_id,
        inspected_by_id=auth.user.id,
        checklist_json=body.checklist_json,
        deduction_amount=body.deduction_amount,
        notes=body.notes,
        status=body.status,
    )
    db.add(inspection)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="POST_EVENT_DAMAGE_INSPECTION",
            new_value={"status": body.status.value, "deduction_amount": float(body.deduction_amount)},
        )
    )
    await db.commit()
    return {"status": body.status.value, "deposit_status": inv.deposit_status.value if inv else None}

```

```

---
