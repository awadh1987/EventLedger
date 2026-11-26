from decimal import Decimal
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, hash_password, require_roles
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import AuditLog, Event
from app.models.tenant import RecordLifecycle, SystemLookup, Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, StaffRole, User, UserType
from app.models.venue import Hall, InventoryItem, PricingRule

router = APIRouter(prefix="/api/v1", tags=["Tenant Settings, Lookups, Venue & Super Admin"])


class UpdateBrandingBody(BaseModel):
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    spotlight_color: Optional[str] = None
    default_theme: Optional[str] = None
    enable_spotlight: Optional[bool] = None
    logo_light_url: Optional[str] = None
    logo_dark_url: Optional[str] = None
    favicon_url: Optional[str] = None
    hero_tagline_ar: Optional[str] = None
    hero_tagline_en: Optional[str] = None
    invoice_footer_ar: Optional[str] = None
    invoice_footer_en: Optional[str] = None


class CreateLookupBody(BaseModel):
    category: str
    code: str
    label_ar: str
    label_en: str
    sort_order: int = 0


class PatchLookupBody(BaseModel):
    label_ar: Optional[str] = None
    label_en: Optional[str] = None
    sort_order: Optional[int] = None
    lifecycle: Optional[RecordLifecycle] = None


class StorefrontOfferBody(BaseModel):
    id: Optional[str] = None
    title_ar: str
    title_en: str
    description_ar: Optional[str] = None
    description_en: Optional[str] = None
    discount_percent: Optional[float] = None
    package_price: Optional[float] = None
    valid_until: Optional[str] = None
    badge_text: Optional[str] = None
    banner_image_url: Optional[str] = None


class HallMediaBody(BaseModel):
    gallery_urls: list[str] = Field(default_factory=list)
    video_url: Optional[str] = None
    amenities: list[str] = Field(default_factory=list)


class UpdateStorefrontBody(BaseModel):
    heroTitleAr: Optional[str] = None
    heroTitleEn: Optional[str] = None
    heroSubtitleAr: Optional[str] = None
    heroSubtitleEn: Optional[str] = None
    heroVideoUrl: Optional[str] = None
    heroBannerUrl: Optional[str] = None
    contactPhone: Optional[str] = None
    whatsappNumber: Optional[str] = None
    addressAr: Optional[str] = None
    addressEn: Optional[str] = None
    socialLinks: Optional[dict[str, str]] = None
    hall_media: Optional[dict[str, HallMediaBody]] = None
    offers: Optional[list[StorefrontOfferBody]] = None


@router.get("/erp/settings/storefront")
async def get_erp_storefront_settings(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.SALES_MANAGER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    s = tenant.settings or {}
    return {
        "meta": s.get("storefront_meta") or {},
        "hall_media": s.get("hall_media") or {},
        "offers": s.get("storefront_offers") or [],
    }


@router.put("/erp/settings/storefront")
async def update_erp_storefront_settings(
    body: UpdateStorefrontBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.SALES_MANAGER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    s = dict(tenant.settings or {})
    meta = dict(s.get("storefront_meta") or {})
    for k in (
        "heroTitleAr",
        "heroTitleEn",
        "heroSubtitleAr",
        "heroSubtitleEn",
        "heroVideoUrl",
        "heroBannerUrl",
        "contactPhone",
        "whatsappNumber",
        "addressAr",
        "addressEn",
        "socialLinks",
    ):
        val = getattr(body, k)
        if val is not None:
            meta[k] = val
    s["storefront_meta"] = meta

    if body.hall_media is not None:
        s["hall_media"] = {hid: hm.model_dump() for hid, hm in body.hall_media.items()}

    if body.offers is not None:
        normalized_offers = []
        for o in body.offers:
            od = o.model_dump()
            if not od.get("id"):
                od["id"] = str(uuid.uuid4())
            normalized_offers.append(od)
        s["storefront_offers"] = normalized_offers

    tenant.settings = s
    await db.commit()
    return {"status": "UPDATED", "meta": meta, "hall_media": s.get("hall_media") or {}, "offers": s.get("storefront_offers") or []}


@router.get("/tenant/branding")
async def get_tenant_branding(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    b = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not b:
        b = TenantBranding(tenant_id=auth.tenant_id)
        db.add(b)
        await db.commit()
        await db.refresh(b)
    return {
        "primary_color": b.primary_color,
        "accent_color": b.accent_color,
        "spotlight_color": b.spotlight_color,
        "default_theme": b.default_theme,
        "enable_spotlight": b.enable_spotlight,
        "logo_light_url": b.logo_light_url,
        "logo_dark_url": b.logo_dark_url,
        "favicon_url": b.favicon_url,
        "hero_tagline_ar": b.hero_tagline_ar,
        "hero_tagline_en": b.hero_tagline_en,
        "invoice_footer_ar": b.invoice_footer_ar,
        "invoice_footer_en": b.invoice_footer_en,
    }


@router.put("/tenant/branding")
async def update_tenant_branding(
    body: UpdateBrandingBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    b = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not b:
        b = TenantBranding(tenant_id=auth.tenant_id)
        db.add(b)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(b, field, val)
    await db.commit()
    return {"status": "UPDATED"}


@router.get("/lookups")
async def list_lookups(
    category: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    q = select(SystemLookup).where(SystemLookup.tenant_id == auth.tenant_id)
    if category:
        q = q.where(SystemLookup.category == category.strip().upper())
    if not include_inactive:
        q = q.where(SystemLookup.lifecycle == RecordLifecycle.ACTIVE)
    rows = (await db.execute(q.order_by(SystemLookup.category.asc(), SystemLookup.sort_order.asc()))).scalars().all()
    return [
        {
            "id": str(r.id),
            "category": r.category,
            "code": r.code,
            "label_ar": r.label_ar,
            "label_en": r.label_en,
            "sort_order": r.sort_order,
            "lifecycle": r.lifecycle.value,
        }
        for r in rows
    ]


@router.post("/lookups")
async def create_lookup(
    body: CreateLookupBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    row = SystemLookup(
        tenant_id=auth.tenant_id,
        category=body.category.strip().upper(),
        code=body.code.strip().upper(),
        label_ar=body.label_ar.strip(),
        label_en=body.label_en.strip(),
        sort_order=body.sort_order,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": str(row.id), "code": row.code, "lifecycle": row.lifecycle.value}


@router.patch("/lookups/{lookup_id}")
async def update_lookup(
    lookup_id: uuid.UUID,
    body: PatchLookupBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    row = (
        await db.execute(
            select(SystemLookup).where(SystemLookup.id == lookup_id, SystemLookup.tenant_id == auth.tenant_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Lookup not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(row, field, val)
    await db.commit()
    return {"status": "UPDATED"}


class CreateHallBody(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    name_ar: str = Field(..., min_length=2, max_length=255)
    capacity_banquet: int = Field(default=300, ge=10)
    capacity_theater: int = Field(default=500, ge=10)
    base_price: Decimal = Field(default=Decimal("500000.00"), ge=0)
    cleaning_buffer_minutes: int = Field(default=120, ge=0)
    combinable_with_hall_id: Optional[uuid.UUID] = None


class UpdateHallBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    name_ar: Optional[str] = Field(default=None, min_length=2, max_length=255)
    capacity_banquet: Optional[int] = Field(default=None, ge=10)
    capacity_theater: Optional[int] = Field(default=None, ge=10)
    base_price: Optional[Decimal] = Field(default=None, ge=0)
    cleaning_buffer_minutes: Optional[int] = Field(default=None, ge=0)
    combinable_with_hall_id: Optional[uuid.UUID] = None
    lifecycle: Optional[RecordLifecycle] = None


@router.get("/tenant/overview")
async def get_tenant_overview(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    halls_count = (await db.execute(select(func.count(Hall.id)).where(Hall.tenant_id == tenant.id))).scalar() or 0
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "currency": tenant.currency,
        "subscription_tier": tenant.subscription_tier.value,
        "subscription_status": tenant.subscription_status.value,
        "max_halls": tenant.max_halls,
        "halls_count": halls_count,
        "monthly_whatsapp_quota": tenant.monthly_whatsapp_quota,
        "whatsapp_used_this_month": tenant.whatsapp_used_this_month,
    }


@router.get("/venue/halls")
async def list_venue_halls(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (await db.execute(select(Hall).where(Hall.tenant_id == auth.tenant_id))).scalars().all()
    return [
        {
            "id": str(h.id),
            "name": h.name,
            "name_ar": h.name_ar,
            "capacity_banquet": h.capacity_banquet,
            "capacity_theater": h.capacity_theater,
            "base_price": float(h.base_price),
            "cleaning_buffer_minutes": h.cleaning_buffer_minutes,
            "combinable_with_hall_id": str(h.combinable_with_hall_id) if h.combinable_with_hall_id else None,
            "lifecycle": h.lifecycle.value,
        }
        for h in rows
    ]


@router.post("/venue/halls")
async def create_venue_hall(
    body: CreateHallBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.OPS_MANAGER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    if body.combinable_with_hall_id:
        partner = (
            await db.execute(
                select(Hall.id).where(Hall.id == body.combinable_with_hall_id, Hall.tenant_id == auth.tenant_id)
            )
        ).scalar_one_or_none()
        if not partner:
            raise HTTPException(status_code=404, detail="Combinable partner hall not found")
    hall = Hall(
        tenant_id=auth.tenant_id,
        name=body.name.strip(),
        name_ar=body.name_ar.strip(),
        capacity_banquet=body.capacity_banquet,
        capacity_theater=body.capacity_theater,
        base_price=body.base_price,
        cleaning_buffer_minutes=body.cleaning_buffer_minutes,
        combinable_with_hall_id=body.combinable_with_hall_id,
    )
    db.add(hall)
    await db.commit()
    await db.refresh(hall)
    return {
        "id": str(hall.id),
        "name": hall.name,
        "name_ar": hall.name_ar,
        "capacity_banquet": hall.capacity_banquet,
        "capacity_theater": hall.capacity_theater,
        "base_price": float(hall.base_price),
        "cleaning_buffer_minutes": hall.cleaning_buffer_minutes,
        "combinable_with_hall_id": str(hall.combinable_with_hall_id) if hall.combinable_with_hall_id else None,
        "lifecycle": hall.lifecycle.value,
    }


@router.patch("/venue/halls/{hall_id}")
async def update_venue_hall(
    hall_id: uuid.UUID,
    body: UpdateHallBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.OPS_MANAGER})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    hall = (
        await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not hall:
        raise HTTPException(status_code=404, detail="Hall not found")
    updates = body.model_dump(exclude_unset=True)
    if "combinable_with_hall_id" in updates and updates["combinable_with_hall_id"] is not None:
        if updates["combinable_with_hall_id"] == hall.id:
            raise HTTPException(status_code=400, detail="Hall cannot combine with itself")
        partner = (
            await db.execute(
                select(Hall.id).where(Hall.id == updates["combinable_with_hall_id"], Hall.tenant_id == auth.tenant_id)
            )
        ).scalar_one_or_none()
        if not partner:
            raise HTTPException(status_code=404, detail="Combinable partner hall not found")
    for field, val in updates.items():
        if isinstance(val, str):
            val = val.strip()
        setattr(hall, field, val)
    await db.commit()
    return {"status": "UPDATED", "id": str(hall.id)}


@router.get("/venue/inventory")
async def list_venue_inventory(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (await db.execute(select(InventoryItem).where(InventoryItem.tenant_id == auth.tenant_id))).scalars().all()
    return [
        {
            "id": str(i.id),
            "name": i.name,
            "category": i.category,
            "total_stock": i.total_stock,
            "unit_addon_price": float(i.unit_addon_price),
            "lifecycle": i.lifecycle.value,
        }
        for i in rows
    ]


@router.get("/venue/pricing-rules")
async def list_pricing_rules(auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rows = (await db.execute(select(PricingRule).where(PricingRule.tenant_id == auth.tenant_id))).scalars().all()
    return [
        {
            "id": str(r.id),
            "hall_id": str(r.hall_id) if r.hall_id else None,
            "name": r.name,
            "days_of_week": r.days_of_week,
            "multiplier": float(r.multiplier),
            "is_active": r.is_active,
        }
        for r in rows
    ]


class UpdateTenantClientBody(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    phone: Optional[str] = Field(default=None, min_length=7, max_length=40)
    is_active: Optional[bool] = None
    vip_tier: Optional[str] = Field(default=None, max_length=30)
    client_category: Optional[ClientCategory] = None
    company_name: Optional[str] = Field(default=None, max_length=255)
    tax_id: Optional[str] = Field(default=None, max_length=100)
    national_id_or_cr: Optional[str] = Field(default=None, max_length=100)


class ResetClientPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=8)


CLIENT_USER_TYPES = {UserType.CLIENT_PRIMARY, UserType.CLIENT_DELEGATE, UserType.EXTERNAL_VENDOR}
CLIENT_ADMIN_ROLES = {StaffRole.OWNER, StaffRole.SALES_MANAGER, StaffRole.FINANCE}


@router.get("/tenant/clients")
async def list_tenant_clients(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    rows = (
        await db.execute(
            select(User, ClientProfile)
            .outerjoin(ClientProfile, User.id == ClientProfile.user_id)
            .where(User.tenant_id == auth.tenant_id, User.user_type.in_(CLIENT_USER_TYPES))
            .order_by(User.created_at.desc())
        )
    ).all()

    events = (await db.execute(select(Event).where(Event.tenant_id == auth.tenant_id))).scalars().all()
    invoices = (await db.execute(select(Invoice).where(Invoice.tenant_id == auth.tenant_id))).scalars().all()
    milestones = (
        await db.execute(select(PaymentMilestone).where(PaymentMilestone.tenant_id == auth.tenant_id))
    ).scalars().all()

    inv_by_event = {inv.event_id: inv for inv in invoices}
    paid_by_inv: dict[uuid.UUID, Decimal] = {}
    for m in milestones:
        paid_by_inv[m.invoice_id] = paid_by_inv.get(m.invoice_id, Decimal("0.00")) + Decimal(str(m.paid_amount))

    stats_by_client: dict[uuid.UUID, dict] = {}
    for ev in events:
        st = stats_by_client.setdefault(
            ev.primary_client_id, {"events_count": 0, "contracted": Decimal("0.00"), "outstanding": Decimal("0.00")}
        )
        st["events_count"] += 1
        inv = inv_by_event.get(ev.id)
        if inv:
            tot = Decimal(str(inv.total_amount))
            paid = paid_by_inv.get(inv.id, Decimal("0.00"))
            st["contracted"] += tot
            st["outstanding"] += max(Decimal("0.00"), tot - paid)

    return [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "email": u.email,
            "phone": u.phone,
            "user_type": u.user_type.value,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
            "client_category": cp.client_category.value if cp else ClientCategory.INDIVIDUAL_B2C.value,
            "company_name": cp.company_name if cp else None,
            "tax_id": cp.tax_id if cp else None,
            "national_id_or_cr": cp.national_id_or_cr if cp else None,
            "vip_tier": cp.vip_tier if cp else "STANDARD",
            "refund_bank_details": cp.refund_bank_details if cp else None,
            "events_count": stats_by_client.get(u.id, {}).get("events_count", 0),
            "total_contracted": float(stats_by_client.get(u.id, {}).get("contracted", Decimal("0.00"))),
            "outstanding_balance": float(stats_by_client.get(u.id, {}).get("outstanding", Decimal("0.00"))),
        }
        for u, cp in rows
    ]


@router.patch("/tenant/clients/{client_id}")
async def update_tenant_client(
    client_id: uuid.UUID,
    body: UpdateTenantClientBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    user = (
        await db.execute(
            select(User).where(
                User.id == client_id,
                User.tenant_id == auth.tenant_id,
                User.user_type.in_(CLIENT_USER_TYPES),
            )
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Client not found")

    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.phone is not None:
        clean_phone = body.phone.strip()
        if clean_phone != user.phone:
            dup = (
                await db.execute(select(User.id).where(User.phone == clean_phone, User.id != user.id))
            ).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=409, detail="Phone number already in use")
            user.phone = clean_phone
    if body.is_active is not None:
        user.is_active = body.is_active

    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == user.id))).scalar_one_or_none()
    if not cp:
        cp = ClientProfile(user_id=user.id, client_category=body.client_category or ClientCategory.INDIVIDUAL_B2C)
        db.add(cp)
    for field in ("vip_tier", "client_category", "company_name", "tax_id", "national_id_or_cr"):
        val = getattr(body, field)
        if val is not None:
            setattr(cp, field, val.strip() if isinstance(val, str) else val)

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CLIENT_ACCOUNT_UPDATED",
            new_value={"client_id": str(user.id), **body.model_dump(exclude_none=True, mode="json")},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "client_id": str(user.id), "is_active": user.is_active}


@router.post("/tenant/clients/{client_id}/reset-password")
async def reset_tenant_client_password(
    client_id: uuid.UUID,
    body: ResetClientPasswordBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    user = (
        await db.execute(
            select(User).where(
                User.id == client_id,
                User.tenant_id == auth.tenant_id,
                User.user_type.in_(CLIENT_USER_TYPES),
            )
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Client not found")

    user.password_hash = hash_password(body.new_password)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CLIENT_PASSWORD_RESET",
            new_value={"client_id": str(user.id)},
        )
    )
    await db.commit()
    return {"status": "PASSWORD_RESET", "client_id": str(user.id)}
