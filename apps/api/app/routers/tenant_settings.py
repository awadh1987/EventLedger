import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles
from app.models.tenant import RecordLifecycle, SystemLookup, TenantBranding
from app.models.users import StaffRole, UserType
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
