import re
from datetime import datetime
from decimal import Decimal
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, hash_password, require_roles
from app.models.accounting import DepositStatus, EventExpense, Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import utcnow
from app.models.events import AuditLog, Event, EventStatus, GatePass
from app.models.events_extensions import EventContract
from app.models.tenant import RecordLifecycle, SystemLookup, Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, EventDelegate, StaffProfile, StaffRole, User, UserType
from app.models.venue import CateringMenuItem, EventInventoryAllocation, Hall, InventoryItem, PricingRule

router = APIRouter(prefix="/api/v1", tags=["Tenant Settings, Lookups, Venue & Super Admin"])


THEME_PRESETS: dict[str, dict] = {
    "OBSIDIAN_GOLD": {
        "label_ar": "السبج الذهبي الفاخر",
        "label_en": "Obsidian Gold",
        "primary_color": "#D4AF37",
        "accent_color": "#0F172A",
        "spotlight_color": "rgba(212, 175, 55, 0.18)",
        "default_theme": "DARK",
        "surface_light": "#F8FAFC",
        "surface_dark": "#020617",
        "card_light": "#FFFFFF",
        "card_dark": "#0F172A",
        "border_light": "#E2E8F0",
        "border_dark": "#1E293B",
        "button_text_color": "#020617",
        "card_radius": "0.75rem",
    },
    "ROYAL_IVORY": {
        "label_ar": "العاج الملكي الفاتح",
        "label_en": "Royal Ivory",
        "primary_color": "#B48327",
        "accent_color": "#1E293B",
        "spotlight_color": "rgba(180, 131, 39, 0.14)",
        "default_theme": "LIGHT",
        "surface_light": "#FAF8F5",
        "surface_dark": "#0C0A09",
        "card_light": "#FFFFFF",
        "card_dark": "#1C1917",
        "border_light": "#E7E5E4",
        "border_dark": "#292524",
        "button_text_color": "#FFFFFF",
        "card_radius": "0.875rem",
    },
    "EMERALD_PALACE": {
        "label_ar": "قصر الزمرد",
        "label_en": "Emerald Palace",
        "primary_color": "#10B981",
        "accent_color": "#064E3B",
        "spotlight_color": "rgba(16, 185, 129, 0.18)",
        "default_theme": "DARK",
        "surface_light": "#F0FDF4",
        "surface_dark": "#022C22",
        "card_light": "#FFFFFF",
        "card_dark": "#064E3B",
        "border_light": "#D1FAE5",
        "border_dark": "#065F46",
        "button_text_color": "#022C22",
        "card_radius": "0.75rem",
    },
    "SAPPHIRE_EXECUTIVE": {
        "label_ar": "الياقوت التنفيذي",
        "label_en": "Sapphire Executive",
        "primary_color": "#38BDF8",
        "accent_color": "#0C4A6E",
        "spotlight_color": "rgba(56, 189, 248, 0.18)",
        "default_theme": "DARK",
        "surface_light": "#F0F9FF",
        "surface_dark": "#082F49",
        "card_light": "#FFFFFF",
        "card_dark": "#0F172A",
        "border_light": "#BAE6FD",
        "border_dark": "#1E3A5F",
        "button_text_color": "#082F49",
        "card_radius": "0.625rem",
    },
    "CRIMSON_VELVET": {
        "label_ar": "المخمل القرمزي",
        "label_en": "Crimson Velvet",
        "primary_color": "#F43F5E",
        "accent_color": "#4C0519",
        "spotlight_color": "rgba(244, 63, 94, 0.18)",
        "default_theme": "DARK",
        "surface_light": "#FFF1F2",
        "surface_dark": "#19040B",
        "card_light": "#FFFFFF",
        "card_dark": "#2A0813",
        "border_light": "#FFE4E6",
        "border_dark": "#4C0519",
        "button_text_color": "#FFFFFF",
        "card_radius": "0.875rem",
    },
    "CUSTOM": {
        "label_ar": "مخصص للمنشأة",
        "label_en": "Custom Enterprise",
    },
}

DEFAULT_BRANDING_TOKENS: dict[str, str] = {
    "theme_preset": "OBSIDIAN_GOLD",
    "surface_light": THEME_PRESETS["OBSIDIAN_GOLD"]["surface_light"],
    "surface_dark": THEME_PRESETS["OBSIDIAN_GOLD"]["surface_dark"],
    "card_light": THEME_PRESETS["OBSIDIAN_GOLD"]["card_light"],
    "card_dark": THEME_PRESETS["OBSIDIAN_GOLD"]["card_dark"],
    "border_light": THEME_PRESETS["OBSIDIAN_GOLD"]["border_light"],
    "border_dark": THEME_PRESETS["OBSIDIAN_GOLD"]["border_dark"],
    "button_text_color": THEME_PRESETS["OBSIDIAN_GOLD"]["button_text_color"],
    "card_radius": THEME_PRESETS["OBSIDIAN_GOLD"]["card_radius"],
}


def resolve_branding_tokens(tenant_settings: Optional[dict]) -> dict[str, str]:
    raw = (tenant_settings or {}).get("branding_tokens")
    tokens = dict(DEFAULT_BRANDING_TOKENS)
    if isinstance(raw, dict):
        preset = str(raw.get("theme_preset") or tokens["theme_preset"]).upper()
        if preset in THEME_PRESETS and preset != "CUSTOM":
            p = THEME_PRESETS[preset]
            for k in (
                "surface_light",
                "surface_dark",
                "card_light",
                "card_dark",
                "border_light",
                "border_dark",
                "button_text_color",
                "card_radius",
            ):
                if k in p:
                    tokens[k] = p[k]
            tokens["theme_preset"] = preset
        for k in DEFAULT_BRANDING_TOKENS:
            v = raw.get(k)
            if isinstance(v, str) and v.strip():
                tokens[k] = v.strip()
    return tokens


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
    theme_preset: Optional[str] = None
    surface_light: Optional[str] = None
    surface_dark: Optional[str] = None
    card_light: Optional[str] = None
    card_dark: Optional[str] = None
    border_light: Optional[str] = None
    border_dark: Optional[str] = None
    button_text_color: Optional[str] = None
    card_radius: Optional[str] = None
    owner_avatar_url: Optional[str] = None


CATALOG_EDIT_ROLES = {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.OPS_MANAGER, StaffRole.SALES_MANAGER}


class CreateLookupBody(BaseModel):
    category: str
    code: str
    label_ar: str
    label_en: str
    sort_order: int = 0
    lifecycle: RecordLifecycle = RecordLifecycle.ACTIVE


class CreateCustomLookupBody(BaseModel):
    category: str
    label_ar: str = Field(..., min_length=1, max_length=255)
    label_en: Optional[str] = Field(default=None, max_length=255)
    code: Optional[str] = Field(default=None, max_length=60)


class PatchLookupBody(BaseModel):
    category: Optional[str] = None
    code: Optional[str] = None
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
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.SALES_MANAGER},
            required_perm=("branding", "view"),
        )
    ),
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
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.SALES_MANAGER},
            required_perm=("branding", "edit"),
        )
    ),
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
        existing_map = dict(s.get("hall_media") or {})
        for hid, hm in body.hall_media.items():
            merged_hm = dict(existing_map.get(hid) or {})
            merged_hm.update(hm.model_dump())
            existing_map[hid] = merged_hm
        s["hall_media"] = existing_map

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


def _serialize_branding(b: TenantBranding, tenant: Optional[Tenant]) -> dict:
    s = dict(tenant.settings or {}) if tenant else {}
    tokens = resolve_branding_tokens(s)
    profile_media = dict(s.get("profile_media") or {})
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
        "theme_preset": tokens["theme_preset"],
        "tokens": tokens,
        "owner_avatar_url": profile_media.get("owner_avatar_url"),
        "presets": THEME_PRESETS,
    }


@router.get("/tenant/branding")
async def get_tenant_branding(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    b = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not b:
        b = TenantBranding(tenant_id=auth.tenant_id)
        db.add(b)
        await db.commit()
        await db.refresh(b)
    return _serialize_branding(b, tenant)


@router.put("/tenant/branding")
async def update_tenant_branding(
    body: UpdateBrandingBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("branding", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    b = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not b:
        b = TenantBranding(tenant_id=auth.tenant_id)
        db.add(b)

    core_fields = {
        "primary_color",
        "accent_color",
        "spotlight_color",
        "default_theme",
        "enable_spotlight",
        "logo_light_url",
        "logo_dark_url",
        "favicon_url",
        "hero_tagline_ar",
        "hero_tagline_en",
        "invoice_footer_ar",
        "invoice_footer_en",
    }
    token_fields = {
        "theme_preset",
        "surface_light",
        "surface_dark",
        "card_light",
        "card_dark",
        "border_light",
        "border_dark",
        "button_text_color",
        "card_radius",
    }
    data = body.model_dump(exclude_none=True)
    for field, val in data.items():
        if field in core_fields:
            setattr(b, field, val)

    s = dict(tenant.settings or {})
    tokens = resolve_branding_tokens(s)
    for field in token_fields:
        if field in data and str(data[field]).strip():
            tokens[field] = str(data[field]).strip()
    if body.theme_preset and body.theme_preset.upper() in THEME_PRESETS:
        tokens["theme_preset"] = body.theme_preset.upper()
    s["branding_tokens"] = tokens

    if "owner_avatar_url" in data:
        profile_media = dict(s.get("profile_media") or {})
        profile_media["owner_avatar_url"] = data["owner_avatar_url"] or None
        s["profile_media"] = profile_media

    tenant.settings = s
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="TENANT_BRANDING_UPDATED",
            new_value={
                "theme_preset": tokens["theme_preset"],
                "primary_color": b.primary_color,
                "default_theme": b.default_theme,
            },
        )
    )
    await db.commit()
    await db.refresh(b)
    return {"status": "UPDATED", **_serialize_branding(b, tenant)}


@router.post("/tenant/branding/reset")
async def reset_tenant_branding(
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.ADMIN}, required_perm=("branding", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    b = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not b:
        b = TenantBranding(tenant_id=auth.tenant_id)
        db.add(b)

    gold = THEME_PRESETS["OBSIDIAN_GOLD"]
    b.primary_color = gold["primary_color"]
    b.accent_color = gold["accent_color"]
    b.spotlight_color = gold["spotlight_color"]
    b.default_theme = gold["default_theme"]
    b.enable_spotlight = True

    s = dict(tenant.settings or {})
    s["branding_tokens"] = dict(DEFAULT_BRANDING_TOKENS)
    tenant.settings = s

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="TENANT_BRANDING_RESET",
            new_value={"theme_preset": "OBSIDIAN_GOLD"},
        )
    )
    await db.commit()
    await db.refresh(b)
    return {"status": "RESET", **_serialize_branding(b, tenant)}


async def _compute_lookup_usage_map(db: AsyncSession, tenant_id: uuid.UUID) -> dict[tuple[str, str], int]:
    usage: dict[tuple[str, str], int] = {}

    def _add(cat: str, raw_code: Optional[str], cnt: int):
        if raw_code:
            k = (cat, raw_code.strip().upper())
            usage[k] = usage.get(k, 0) + int(cnt or 0)

    for code_val, cnt in (
        await db.execute(select(Event.event_type, func.count(Event.id)).where(Event.tenant_id == tenant_id).group_by(Event.event_type))
    ).all():
        _add("EVENT_TYPE", code_val, cnt)

    for code_val, cnt in (
        await db.execute(
            select(InventoryItem.category, func.count(InventoryItem.id))
            .where(InventoryItem.tenant_id == tenant_id)
            .group_by(InventoryItem.category)
        )
    ).all():
        _add("INVENTORY_CATEGORY", code_val, cnt)

    for code_val, cnt in (
        await db.execute(
            select(EventExpense.category, func.count(EventExpense.id))
            .where(EventExpense.tenant_id == tenant_id)
            .group_by(EventExpense.category)
        )
    ).all():
        _add("EXPENSE_CATEGORY", code_val, cnt)

    for code_val, cnt in (
        await db.execute(
            select(PaymentMilestone.payment_method, func.count(PaymentMilestone.id))
            .where(PaymentMilestone.tenant_id == tenant_id, PaymentMilestone.payment_method.is_not(None))
            .group_by(PaymentMilestone.payment_method)
        )
    ).all():
        _add("PAYMENT_METHOD", code_val, cnt)

    for code_val, cnt in (
        await db.execute(
            select(GatePass.pass_type, func.count(GatePass.id))
            .where(GatePass.tenant_id == tenant_id)
            .group_by(GatePass.pass_type)
        )
    ).all():
        _add("GATE_PASS_TYPE", code_val, cnt)

    for code_val, cnt in (
        await db.execute(
            select(StaffProfile.department, func.count(StaffProfile.user_id))
            .join(User, StaffProfile.user_id == User.id)
            .where(User.tenant_id == tenant_id)
            .group_by(StaffProfile.department)
        )
    ).all():
        _add("DEPARTMENT", code_val, cnt)

    return usage


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
    usage_map = await _compute_lookup_usage_map(db, auth.tenant_id)
    return [
        {
            "id": str(r.id),
            "category": r.category,
            "code": r.code,
            "label_ar": r.label_ar,
            "label_en": r.label_en,
            "sort_order": r.sort_order,
            "lifecycle": r.lifecycle.value,
            "usage_count": usage_map.get((r.category, r.code), 0),
        }
        for r in rows
    ]


@router.post("/lookups")
async def create_lookup(
    body: CreateLookupBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    cat = body.category.strip().upper()
    code = body.code.strip().upper()
    existing = (
        await db.execute(
            select(SystemLookup).where(
                SystemLookup.tenant_id == auth.tenant_id,
                SystemLookup.category == cat,
                SystemLookup.code == code,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.label_ar = body.label_ar.strip()
        existing.label_en = body.label_en.strip()
        existing.sort_order = body.sort_order
        existing.lifecycle = body.lifecycle
        row = existing
        action_name = "LOOKUP_UPSERTED"
    else:
        row = SystemLookup(
            tenant_id=auth.tenant_id,
            category=cat,
            code=code,
            label_ar=body.label_ar.strip(),
            label_en=body.label_en.strip(),
            sort_order=body.sort_order,
            lifecycle=body.lifecycle,
        )
        db.add(row)
        action_name = "LOOKUP_CREATED"
    await db.flush()
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action=action_name,
            new_value={"id": str(row.id), "category": cat, "code": code},
        )
    )
    await db.commit()
    await db.refresh(row)
    return {
        "id": str(row.id),
        "category": row.category,
        "code": row.code,
        "label_ar": row.label_ar,
        "label_en": row.label_en,
        "sort_order": row.sort_order,
        "lifecycle": row.lifecycle.value,
    }


@router.post("/lookups/custom")
async def promote_custom_lookup(
    body: CreateCustomLookupBody,
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            CATALOG_EDIT_ROLES | {StaffRole.SALES, StaffRole.FINANCE},
            required_perm=("catalog", "create"),
        )
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    cat = body.category.strip().upper()
    label_en = (body.label_en or body.label_ar).strip()
    raw_code = (body.code or re.sub(r"[^A-Z0-9]+", "_", label_en.upper()).strip("_"))[:48]
    if not raw_code:
        raw_code = f"CUSTOM_{uuid.uuid4().hex[:6].upper()}"
    existing = (
        await db.execute(
            select(SystemLookup).where(
                SystemLookup.tenant_id == auth.tenant_id,
                SystemLookup.category == cat,
                SystemLookup.code == raw_code,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.lifecycle = RecordLifecycle.ACTIVE
        existing.label_ar = body.label_ar.strip()
        existing.label_en = label_en
        row = existing
    else:
        max_order = (
            await db.execute(
                select(func.coalesce(func.max(SystemLookup.sort_order), 0)).where(
                    SystemLookup.tenant_id == auth.tenant_id, SystemLookup.category == cat
                )
            )
        ).scalar() or 0
        row = SystemLookup(
            tenant_id=auth.tenant_id,
            category=cat,
            code=raw_code,
            label_ar=body.label_ar.strip(),
            label_en=label_en,
            sort_order=int(max_order) + 1,
            lifecycle=RecordLifecycle.ACTIVE,
        )
        db.add(row)
    await db.flush()
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="LOOKUP_CUSTOM_PROMOTED",
            new_value={"id": str(row.id), "category": cat, "code": row.code},
        )
    )
    await db.commit()
    await db.refresh(row)
    return {
        "id": str(row.id),
        "category": row.category,
        "code": row.code,
        "label_ar": row.label_ar,
        "label_en": row.label_en,
        "sort_order": row.sort_order,
        "lifecycle": row.lifecycle.value,
    }


@router.patch("/lookups/{lookup_id}")
async def update_lookup(
    lookup_id: uuid.UUID,
    body: PatchLookupBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "edit"))
    ),
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
    updates = body.model_dump(exclude_none=True)
    if "category" in updates:
        updates["category"] = updates["category"].strip().upper()
    if "code" in updates:
        updates["code"] = updates["code"].strip().upper()
    for field, val in updates.items():
        setattr(row, field, val.strip() if isinstance(val, str) else val)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="LOOKUP_UPDATED",
            new_value={"id": str(row.id), **{k: str(v) for k, v in updates.items()}},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "id": str(row.id), "lifecycle": row.lifecycle.value}


@router.delete("/lookups/{lookup_id}")
async def delete_lookup(
    lookup_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "delete"))
    ),
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
    usage_map = await _compute_lookup_usage_map(db, auth.tenant_id)
    usage = usage_map.get((row.category, row.code), 0)
    if usage > 0:
        row.lifecycle = RecordLifecycle.ARCHIVED
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                actor_id=auth.user.id,
                action="LOOKUP_ARCHIVED_IN_USE",
                new_value={"id": str(row.id), "category": row.category, "code": row.code, "usage_count": usage},
            )
        )
        await db.commit()
        return {"status": "ARCHIVED_IN_USE", "usage_count": usage}
    await db.delete(row)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="LOOKUP_DELETED",
            old_value={"id": str(lookup_id), "category": row.category, "code": row.code},
        )
    )
    await db.commit()
    return {"status": "DELETED", "usage_count": 0}


class CreateHallBody(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    name_ar: str = Field(..., min_length=2, max_length=255)
    capacity_banquet: int = Field(default=300, ge=10)
    capacity_theater: int = Field(default=500, ge=10)
    base_price: Decimal = Field(default=Decimal("500000.00"), ge=0)
    cleaning_buffer_minutes: int = Field(default=120, ge=0)
    combinable_with_hall_id: Optional[uuid.UUID] = None
    lifecycle: RecordLifecycle = RecordLifecycle.ACTIVE


class UpdateHallBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    name_ar: Optional[str] = Field(default=None, min_length=2, max_length=255)
    capacity_banquet: Optional[int] = Field(default=None, ge=10)
    capacity_theater: Optional[int] = Field(default=None, ge=10)
    base_price: Optional[Decimal] = Field(default=None, ge=0)
    cleaning_buffer_minutes: Optional[int] = Field(default=None, ge=0)
    combinable_with_hall_id: Optional[uuid.UUID] = None
    lifecycle: Optional[RecordLifecycle] = None


class CreateInventoryBody(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    category: str = Field(default="DECOR", min_length=2, max_length=80)
    total_stock: int = Field(default=10, ge=0)
    unit_addon_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    lifecycle: RecordLifecycle = RecordLifecycle.ACTIVE


class UpdateInventoryBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    category: Optional[str] = Field(default=None, min_length=2, max_length=80)
    total_stock: Optional[int] = Field(default=None, ge=0)
    unit_addon_price: Optional[Decimal] = Field(default=None, ge=0)
    lifecycle: Optional[RecordLifecycle] = None


class CreateCateringBody(BaseModel):
    name_ar: str = Field(..., min_length=2, max_length=255)
    name_en: str = Field(..., min_length=2, max_length=255)
    price_per_guest: Decimal = Field(..., ge=0)
    cost_per_guest: Decimal = Field(default=Decimal("0.00"), ge=0)
    recipe_bom: Optional[list] = None
    lifecycle: RecordLifecycle = RecordLifecycle.ACTIVE


class UpdateCateringBody(BaseModel):
    name_ar: Optional[str] = Field(default=None, min_length=2, max_length=255)
    name_en: Optional[str] = Field(default=None, min_length=2, max_length=255)
    price_per_guest: Optional[Decimal] = Field(default=None, ge=0)
    cost_per_guest: Optional[Decimal] = Field(default=None, ge=0)
    recipe_bom: Optional[list] = None
    lifecycle: Optional[RecordLifecycle] = None


class CreatePricingRuleBody(BaseModel):
    hall_id: Optional[uuid.UUID] = None
    name: str = Field(..., min_length=2, max_length=255)
    days_of_week: list[int] = Field(default_factory=list)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    multiplier: Decimal = Field(default=Decimal("1.00"), ge=Decimal("0.10"), le=Decimal("9.99"))
    is_active: bool = True


class UpdatePricingRuleBody(BaseModel):
    hall_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    days_of_week: Optional[list[int]] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    multiplier: Optional[Decimal] = Field(default=None, ge=Decimal("0.10"), le=Decimal("9.99"))
    is_active: Optional[bool] = None


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
async def list_venue_halls(
    include_inactive: bool = Query(default=True),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    hq = select(Hall).where(Hall.tenant_id == auth.tenant_id)
    if not include_inactive:
        hq = hq.where(Hall.lifecycle == RecordLifecycle.ACTIVE)
    rows = (await db.execute(hq)).scalars().all()
    ev_counts = dict(
        (
            await db.execute(
                select(Event.hall_id, func.count(Event.id))
                .where(Event.tenant_id == auth.tenant_id)
                .group_by(Event.hall_id)
            )
        ).all()
    )
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
            "events_count": int(ev_counts.get(h.id, 0)),
        }
        for h in rows
    ]


@router.post("/venue/halls")
async def create_venue_hall(
    body: CreateHallBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    partner_hall: Optional[Hall] = None
    if body.combinable_with_hall_id:
        partner_hall = (
            await db.execute(
                select(Hall).where(
                    Hall.id == body.combinable_with_hall_id,
                    Hall.tenant_id == auth.tenant_id,
                    Hall.lifecycle == RecordLifecycle.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if not partner_hall:
            raise HTTPException(status_code=404, detail="Combinable partner hall not found or inactive")
    hall = Hall(
        tenant_id=auth.tenant_id,
        name=body.name.strip(),
        name_ar=body.name_ar.strip(),
        capacity_banquet=body.capacity_banquet,
        capacity_theater=body.capacity_theater,
        base_price=body.base_price,
        cleaning_buffer_minutes=body.cleaning_buffer_minutes,
        combinable_with_hall_id=body.combinable_with_hall_id,
        lifecycle=body.lifecycle,
    )
    db.add(hall)
    await db.flush()
    if partner_hall and partner_hall.combinable_with_hall_id is None and body.lifecycle == RecordLifecycle.ACTIVE:
        partner_hall.combinable_with_hall_id = hall.id
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="HALL_CREATED",
            new_value={"hall_id": str(hall.id), "name": hall.name},
        )
    )
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
        "events_count": 0,
    }


@router.patch("/venue/halls/{hall_id}")
async def update_venue_hall(
    hall_id: uuid.UUID,
    body: UpdateHallBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "edit"))
    ),
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
    old_partner_id = hall.combinable_with_hall_id
    new_partner_hall: Optional[Hall] = None
    if "combinable_with_hall_id" in updates and updates["combinable_with_hall_id"] is not None:
        if updates["combinable_with_hall_id"] == hall.id:
            raise HTTPException(status_code=400, detail="Hall cannot combine with itself")
        new_partner_hall = (
            await db.execute(
                select(Hall).where(
                    Hall.id == updates["combinable_with_hall_id"],
                    Hall.tenant_id == auth.tenant_id,
                    Hall.lifecycle == RecordLifecycle.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if not new_partner_hall:
            raise HTTPException(status_code=404, detail="Combinable partner hall not found or inactive")
    for field, val in updates.items():
        if isinstance(val, str):
            val = val.strip()
        setattr(hall, field, val)
    if "combinable_with_hall_id" in updates:
        if old_partner_id and old_partner_id != hall.combinable_with_hall_id:
            prev_p = (
                await db.execute(select(Hall).where(Hall.id == old_partner_id, Hall.tenant_id == auth.tenant_id))
            ).scalar_one_or_none()
            if prev_p and prev_p.combinable_with_hall_id == hall.id:
                prev_p.combinable_with_hall_id = None
        if new_partner_hall and new_partner_hall.combinable_with_hall_id is None and hall.lifecycle == RecordLifecycle.ACTIVE:
            new_partner_hall.combinable_with_hall_id = hall.id
    if hall.lifecycle != RecordLifecycle.ACTIVE:
        hall.combinable_with_hall_id = None
        linked_halls = (
            await db.execute(
                select(Hall).where(Hall.tenant_id == auth.tenant_id, Hall.combinable_with_hall_id == hall.id)
            )
        ).scalars().all()
        for lh in linked_halls:
            lh.combinable_with_hall_id = None
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="HALL_UPDATED",
            new_value={"hall_id": str(hall.id), "lifecycle": hall.lifecycle.value},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "id": str(hall.id), "lifecycle": hall.lifecycle.value}


@router.delete("/venue/halls/{hall_id}")
async def delete_venue_hall(
    hall_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "delete"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    hall = (
        await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not hall:
        raise HTTPException(status_code=404, detail="Hall not found")
    ev_cnt = (
        await db.execute(select(func.count(Event.id)).where(Event.tenant_id == auth.tenant_id, Event.hall_id == hall.id))
    ).scalar() or 0
    linked_halls = (
        await db.execute(
            select(Hall).where(Hall.tenant_id == auth.tenant_id, Hall.combinable_with_hall_id == hall.id)
        )
    ).scalars().all()
    for lh in linked_halls:
        lh.combinable_with_hall_id = None
    if ev_cnt > 0:
        hall.lifecycle = RecordLifecycle.ARCHIVED
        hall.combinable_with_hall_id = None
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                actor_id=auth.user.id,
                action="HALL_ARCHIVED_IN_USE",
                new_value={"hall_id": str(hall.id), "events_count": int(ev_cnt)},
            )
        )
        await db.commit()
        return {"status": "ARCHIVED_IN_USE", "events_count": int(ev_cnt)}
    await db.delete(hall)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="HALL_DELETED",
            old_value={"hall_id": str(hall_id), "name": hall.name},
        )
    )
    await db.commit()
    return {"status": "DELETED", "events_count": 0}


@router.get("/venue/inventory")
async def list_venue_inventory(
    include_inactive: bool = Query(default=True),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    q = select(InventoryItem).where(InventoryItem.tenant_id == auth.tenant_id)
    if not include_inactive:
        q = q.where(InventoryItem.lifecycle == RecordLifecycle.ACTIVE)
    rows = (await db.execute(q.order_by(InventoryItem.name.asc()))).scalars().all()
    alloc_counts = dict(
        (
            await db.execute(
                select(EventInventoryAllocation.item_id, func.count(EventInventoryAllocation.id))
                .where(EventInventoryAllocation.tenant_id == auth.tenant_id)
                .group_by(EventInventoryAllocation.item_id)
            )
        ).all()
    )
    return [
        {
            "id": str(i.id),
            "name": i.name,
            "category": i.category,
            "total_stock": i.total_stock,
            "unit_addon_price": float(i.unit_addon_price),
            "lifecycle": i.lifecycle.value,
            "allocated_count": int(alloc_counts.get(i.id, 0)),
        }
        for i in rows
    ]


@router.post("/venue/inventory")
async def create_venue_inventory(
    body: CreateInventoryBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    item = InventoryItem(
        tenant_id=auth.tenant_id,
        name=body.name.strip(),
        category=body.category.strip().upper(),
        total_stock=body.total_stock,
        unit_addon_price=body.unit_addon_price,
        lifecycle=body.lifecycle,
    )
    db.add(item)
    await db.flush()
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="INVENTORY_ITEM_CREATED",
            new_value={"item_id": str(item.id), "name": item.name, "category": item.category},
        )
    )
    await db.commit()
    await db.refresh(item)
    return {
        "id": str(item.id),
        "name": item.name,
        "category": item.category,
        "total_stock": item.total_stock,
        "unit_addon_price": float(item.unit_addon_price),
        "lifecycle": item.lifecycle.value,
        "allocated_count": 0,
    }


@router.patch("/venue/inventory/{item_id}")
async def update_venue_inventory(
    item_id: uuid.UUID,
    body: UpdateInventoryBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    item = (
        await db.execute(select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    updates = body.model_dump(exclude_unset=True)
    if "category" in updates and updates["category"]:
        updates["category"] = updates["category"].strip().upper()
    for field, val in updates.items():
        setattr(item, field, val.strip() if isinstance(val, str) else val)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="INVENTORY_ITEM_UPDATED",
            new_value={"item_id": str(item.id), "lifecycle": item.lifecycle.value},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "id": str(item.id), "lifecycle": item.lifecycle.value}


@router.delete("/venue/inventory/{item_id}")
async def delete_venue_inventory(
    item_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "delete"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    item = (
        await db.execute(select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    alloc_cnt = (
        await db.execute(
            select(func.count(EventInventoryAllocation.id)).where(
                EventInventoryAllocation.tenant_id == auth.tenant_id,
                EventInventoryAllocation.item_id == item.id,
            )
        )
    ).scalar() or 0
    if alloc_cnt > 0:
        item.lifecycle = RecordLifecycle.ARCHIVED
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                actor_id=auth.user.id,
                action="INVENTORY_ITEM_ARCHIVED_IN_USE",
                new_value={"item_id": str(item.id), "allocated_count": int(alloc_cnt)},
            )
        )
        await db.commit()
        return {"status": "ARCHIVED_IN_USE", "allocated_count": int(alloc_cnt)}
    await db.delete(item)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="INVENTORY_ITEM_DELETED",
            old_value={"item_id": str(item_id), "name": item.name},
        )
    )
    await db.commit()
    return {"status": "DELETED", "allocated_count": 0}


@router.get("/venue/catering")
async def list_venue_catering(
    include_inactive: bool = Query(default=True),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    q = select(CateringMenuItem).where(CateringMenuItem.tenant_id == auth.tenant_id)
    if not include_inactive:
        q = q.where(CateringMenuItem.lifecycle == RecordLifecycle.ACTIVE)
    rows = (await db.execute(q.order_by(CateringMenuItem.price_per_guest.asc()))).scalars().all()
    return [
        {
            "id": str(c.id),
            "name_ar": c.name_ar,
            "name_en": c.name_en,
            "price_per_guest": float(c.price_per_guest),
            "cost_per_guest": float(c.cost_per_guest),
            "recipe_bom": c.recipe_bom,
            "lifecycle": c.lifecycle.value,
        }
        for c in rows
    ]


@router.post("/venue/catering")
async def create_venue_catering(
    body: CreateCateringBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    cat = CateringMenuItem(
        tenant_id=auth.tenant_id,
        name_ar=body.name_ar.strip(),
        name_en=body.name_en.strip(),
        price_per_guest=body.price_per_guest,
        cost_per_guest=body.cost_per_guest,
        recipe_bom=body.recipe_bom,
        lifecycle=body.lifecycle,
    )
    db.add(cat)
    await db.flush()
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CATERING_ITEM_CREATED",
            new_value={"catering_id": str(cat.id), "name_en": cat.name_en},
        )
    )
    await db.commit()
    await db.refresh(cat)
    return {
        "id": str(cat.id),
        "name_ar": cat.name_ar,
        "name_en": cat.name_en,
        "price_per_guest": float(cat.price_per_guest),
        "cost_per_guest": float(cat.cost_per_guest),
        "recipe_bom": cat.recipe_bom,
        "lifecycle": cat.lifecycle.value,
    }


@router.patch("/venue/catering/{item_id}")
async def update_venue_catering(
    item_id: uuid.UUID,
    body: UpdateCateringBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    cat = (
        await db.execute(
            select(CateringMenuItem).where(CateringMenuItem.id == item_id, CateringMenuItem.tenant_id == auth.tenant_id)
        )
    ).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Catering package not found")
    updates = body.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(cat, field, val.strip() if isinstance(val, str) else val)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CATERING_ITEM_UPDATED",
            new_value={"catering_id": str(cat.id), "lifecycle": cat.lifecycle.value},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "id": str(cat.id), "lifecycle": cat.lifecycle.value}


@router.delete("/venue/catering/{item_id}")
async def delete_venue_catering(
    item_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "delete"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    cat = (
        await db.execute(
            select(CateringMenuItem).where(CateringMenuItem.id == item_id, CateringMenuItem.tenant_id == auth.tenant_id)
        )
    ).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Catering package not found")
    inv_rows = (
        await db.execute(
            select(Invoice.line_items_json).where(
                Invoice.tenant_id == auth.tenant_id, Invoice.line_items_json.is_not(None)
            )
        )
    ).scalars().all()
    in_use = any(
        isinstance(li, dict)
        and isinstance(li.get("catering"), dict)
        and str(li["catering"].get("catering_item_id") or "") == str(item_id)
        for li in inv_rows
    )
    if in_use:
        cat.lifecycle = RecordLifecycle.ARCHIVED
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                actor_id=auth.user.id,
                action="CATERING_ITEM_ARCHIVED_IN_USE",
                new_value={"catering_id": str(cat.id)},
            )
        )
        await db.commit()
        return {"status": "ARCHIVED_IN_USE"}
    await db.delete(cat)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CATERING_ITEM_DELETED",
            old_value={"catering_id": str(item_id), "name_en": cat.name_en},
        )
    )
    await db.commit()
    return {"status": "DELETED"}


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
            "start_date": r.start_date.isoformat() if r.start_date else None,
            "end_date": r.end_date.isoformat() if r.end_date else None,
            "multiplier": float(r.multiplier),
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.post("/venue/pricing-rules")
async def create_pricing_rule(
    body: CreatePricingRuleBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    if body.hall_id:
        hall_ok = (
            await db.execute(select(Hall.id).where(Hall.id == body.hall_id, Hall.tenant_id == auth.tenant_id))
        ).scalar_one_or_none()
        if not hall_ok:
            raise HTTPException(status_code=404, detail="Target hall not found")
    rule = PricingRule(
        tenant_id=auth.tenant_id,
        hall_id=body.hall_id,
        name=body.name.strip(),
        days_of_week=[d for d in body.days_of_week if 0 <= d <= 6],
        start_date=body.start_date.replace(tzinfo=None) if body.start_date and body.start_date.tzinfo else body.start_date,
        end_date=body.end_date.replace(tzinfo=None) if body.end_date and body.end_date.tzinfo else body.end_date,
        multiplier=body.multiplier,
        is_active=body.is_active,
    )
    db.add(rule)
    await db.flush()
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="PRICING_RULE_CREATED",
            new_value={"rule_id": str(rule.id), "name": rule.name, "multiplier": float(rule.multiplier)},
        )
    )
    await db.commit()
    await db.refresh(rule)
    return {
        "id": str(rule.id),
        "hall_id": str(rule.hall_id) if rule.hall_id else None,
        "name": rule.name,
        "days_of_week": rule.days_of_week,
        "start_date": rule.start_date.isoformat() if rule.start_date else None,
        "end_date": rule.end_date.isoformat() if rule.end_date else None,
        "multiplier": float(rule.multiplier),
        "is_active": rule.is_active,
    }


@router.patch("/venue/pricing-rules/{rule_id}")
async def update_pricing_rule(
    rule_id: uuid.UUID,
    body: UpdatePricingRuleBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "edit"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rule = (
        await db.execute(select(PricingRule).where(PricingRule.id == rule_id, PricingRule.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Pricing rule not found")
    updates = body.model_dump(exclude_unset=True)
    if "hall_id" in updates and updates["hall_id"] is not None:
        hall_ok = (
            await db.execute(select(Hall.id).where(Hall.id == updates["hall_id"], Hall.tenant_id == auth.tenant_id))
        ).scalar_one_or_none()
        if not hall_ok:
            raise HTTPException(status_code=404, detail="Target hall not found")
    if "days_of_week" in updates and updates["days_of_week"] is not None:
        updates["days_of_week"] = [d for d in updates["days_of_week"] if 0 <= d <= 6]
    for dt_key in ("start_date", "end_date"):
        if dt_key in updates and updates[dt_key] is not None and updates[dt_key].tzinfo:
            updates[dt_key] = updates[dt_key].replace(tzinfo=None)
    for field, val in updates.items():
        setattr(rule, field, val.strip() if isinstance(val, str) else val)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="PRICING_RULE_UPDATED",
            new_value={"rule_id": str(rule.id), "is_active": rule.is_active},
        )
    )
    await db.commit()
    return {"status": "UPDATED", "id": str(rule.id)}


@router.delete("/venue/pricing-rules/{rule_id}")
async def delete_pricing_rule(
    rule_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "delete"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    rule = (
        await db.execute(select(PricingRule).where(PricingRule.id == rule_id, PricingRule.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Pricing rule not found")
    await db.delete(rule)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="PRICING_RULE_DELETED",
            old_value={"rule_id": str(rule_id), "name": rule.name},
        )
    )
    await db.commit()
    return {"status": "DELETED"}


@router.post("/venue/catalog/seed-defaults")
async def seed_starter_catalog_endpoint(
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CATALOG_EDIT_ROLES, required_perm=("catalog", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    from app.routers.public_onboarding import ensure_tenant_catalog_defaults

    added = await ensure_tenant_catalog_defaults(db, tenant.id, tenant.currency)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CATALOG_DEFAULTS_SEEDED",
            new_value=added,
        )
    )
    await db.commit()
    return {"status": "SEEDED", "added": added}


class CreateTenantClientBody(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=255)
    phone: str = Field(..., min_length=7, max_length=40)
    email: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, min_length=8)
    user_type: UserType = UserType.CLIENT_PRIMARY
    client_category: ClientCategory = ClientCategory.INDIVIDUAL_B2C
    custom_category_label: Optional[str] = Field(default=None, max_length=100)
    vip_tier: str = Field(default="STANDARD", max_length=30)
    company_name: Optional[str] = Field(default=None, max_length=255)
    tax_id: Optional[str] = Field(default=None, max_length=100)
    national_id_or_cr: Optional[str] = Field(default=None, max_length=100)
    billing_address: Optional[str] = None
    notes: Optional[str] = None
    refund_bank_details: Optional[dict] = None
    is_active: bool = True


class UpdateTenantClientBody(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    phone: Optional[str] = Field(default=None, min_length=7, max_length=40)
    email: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None
    vip_tier: Optional[str] = Field(default=None, max_length=30)
    client_category: Optional[ClientCategory] = None
    custom_category_label: Optional[str] = Field(default=None, max_length=100)
    company_name: Optional[str] = Field(default=None, max_length=255)
    tax_id: Optional[str] = Field(default=None, max_length=100)
    national_id_or_cr: Optional[str] = Field(default=None, max_length=100)
    billing_address: Optional[str] = None
    notes: Optional[str] = None
    refund_bank_details: Optional[dict] = None


class ResetClientPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=8)


class ArchiveClientBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


CLIENT_USER_TYPES = {UserType.CLIENT_PRIMARY, UserType.CLIENT_DELEGATE, UserType.EXTERNAL_VENDOR}
CLIENT_ARCHIVE_ROLES = {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.FINANCE}
CLIENT_ADMIN_ROLES = {
    StaffRole.OWNER,
    StaffRole.ADMIN,
    StaffRole.OPS_MANAGER,
    StaffRole.SALES_MANAGER,
    StaffRole.SALES,
    StaffRole.FINANCE,
}


def _serialize_client_row(u: User, cp: Optional[ClientProfile], st: Optional[dict] = None) -> dict:
    st = st or {}
    return {
        "id": str(u.id),
        "full_name": u.full_name,
        "email": u.email,
        "phone": u.phone,
        "user_type": u.user_type.value,
        "is_active": u.is_active,
        "phone_verified": bool(u.phone_verified),
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat(),
        "client_category": cp.client_category.value if cp else ClientCategory.INDIVIDUAL_B2C.value,
        "custom_category_label": cp.custom_category_label if cp else None,
        "company_name": cp.company_name if cp else None,
        "tax_id": cp.tax_id if cp else None,
        "national_id_or_cr": cp.national_id_or_cr if cp else None,
        "billing_address": cp.billing_address if cp else None,
        "notes": cp.notes if cp else None,
        "vip_tier": cp.vip_tier if cp else "STANDARD",
        "refund_bank_details": cp.refund_bank_details if cp else None,
        "is_archived": bool(cp.is_archived) if cp else False,
        "archived_at": cp.archived_at.isoformat() if cp and cp.archived_at else None,
        "archive_reason": cp.archive_reason if cp else None,
        "events_count": st.get("events_count", 0),
        "total_contracted": float(st.get("contracted", Decimal("0.00"))),
        "outstanding_balance": float(st.get("outstanding", Decimal("0.00"))),
    }


@router.get("/tenant/clients")
async def list_tenant_clients(
    include_archived: bool = Query(default=False),
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES, required_perm=("clients", "view"))
    ),
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
    if not include_archived:
        rows = [(u, cp) for u, cp in rows if not (cp and cp.is_archived)]

    events = (await db.execute(select(Event).where(Event.tenant_id == auth.tenant_id))).scalars().all()
    invoices = (await db.execute(select(Invoice).where(Invoice.tenant_id == auth.tenant_id))).scalars().all()
    milestones = (
        await db.execute(select(PaymentMilestone).where(PaymentMilestone.tenant_id == auth.tenant_id))
    ).scalars().all()

    inv_by_event = {inv.event_id: inv for inv in invoices if inv.status != InvoiceStatus.VOIDED}
    paid_by_inv: dict[uuid.UUID, Decimal] = {}
    for m in milestones:
        if not m.is_security_deposit:
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

    return [_serialize_client_row(u, cp, stats_by_client.get(u.id)) for u, cp in rows]


@router.post("/tenant/clients")
async def create_tenant_client(
    body: CreateTenantClientBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES, required_perm=("clients", "create"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    if body.user_type not in CLIENT_USER_TYPES:
        raise HTTPException(status_code=400, detail="Client user_type must be CLIENT_PRIMARY, CLIENT_DELEGATE, or EXTERNAL_VENDOR")
    clean_phone = body.phone.strip()
    clean_email = body.email.strip().lower() if body.email and body.email.strip() else None

    dup_phone = (
        await db.execute(select(User.id).where(User.tenant_id == auth.tenant_id, User.phone == clean_phone))
    ).scalar_one_or_none()
    if dup_phone:
        raise HTTPException(status_code=409, detail="Phone number already in use in this workspace")
    if clean_email:
        dup_email = (
            await db.execute(select(User.id).where(User.tenant_id == auth.tenant_id, User.email == clean_email))
        ).scalar_one_or_none()
        if dup_email:
            raise HTTPException(status_code=409, detail="Email already in use in this workspace")

    user = User(
        tenant_id=auth.tenant_id,
        user_type=body.user_type,
        phone=clean_phone,
        email=clean_email,
        password_hash=hash_password(body.password) if body.password else None,
        full_name=body.full_name.strip(),
        preferred_lang="ar",
        is_active=body.is_active,
    )
    db.add(user)
    await db.flush()
    cp = ClientProfile(
        user_id=user.id,
        client_category=body.client_category,
        custom_category_label=body.custom_category_label.strip() if body.custom_category_label else None,
        vip_tier=body.vip_tier.strip() or "STANDARD",
        company_name=body.company_name.strip() if body.company_name else None,
        tax_id=body.tax_id.strip() if body.tax_id else None,
        national_id_or_cr=body.national_id_or_cr.strip() if body.national_id_or_cr else None,
        billing_address=body.billing_address.strip() if body.billing_address else None,
        notes=body.notes.strip() if body.notes else None,
        refund_bank_details=body.refund_bank_details,
    )
    db.add(cp)
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CLIENT_ACCOUNT_CREATED",
            new_value={"client_id": str(user.id), "full_name": user.full_name, "phone": clean_phone},
        )
    )
    await db.commit()
    await db.refresh(user)
    return _serialize_client_row(user, cp)


@router.get("/tenant/clients/{client_id}/overview")
async def get_tenant_client_overview(
    client_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES, required_perm=("clients", "view"))
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    pair = (
        await db.execute(
            select(User, ClientProfile)
            .outerjoin(ClientProfile, User.id == ClientProfile.user_id)
            .where(
                User.id == client_id,
                User.tenant_id == auth.tenant_id,
                User.user_type.in_(CLIENT_USER_TYPES),
            )
        )
    ).first()
    if not pair:
        raise HTTPException(status_code=404, detail="Client not found")
    user, cp = pair

    del_event_ids = list(
        (
            await db.execute(
                select(EventDelegate.event_id).where(
                    EventDelegate.tenant_id == auth.tenant_id,
                    EventDelegate.user_id == client_id,
                )
            )
        )
        .scalars()
        .all()
    )
    all_events = (
        await db.execute(select(Event).where(Event.tenant_id == auth.tenant_id).order_by(Event.start_time.desc()))
    ).scalars().all()
    events = [ev for ev in all_events if ev.primary_client_id == client_id or ev.id in del_event_ids]
    event_ids = [ev.id for ev in events]
    primary_event_ids = [ev.id for ev in events if ev.primary_client_id == client_id]
    halls = {h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == auth.tenant_id))).scalars().all()}

    invoices_out = []
    contracts_out = []
    delegates_out = []
    contracted_sum = Decimal("0.00")
    outstanding_sum = Decimal("0.00")

    if event_ids:
        invs = (
            await db.execute(
                select(Invoice).where(Invoice.tenant_id == auth.tenant_id, Invoice.event_id.in_(event_ids))
            )
        ).scalars().all()
        inv_ids = [i.id for i in invs]
        ms_list = (
            (
                await db.execute(
                    select(PaymentMilestone)
                    .where(PaymentMilestone.tenant_id == auth.tenant_id, PaymentMilestone.invoice_id.in_(inv_ids))
                    .order_by(PaymentMilestone.due_date.asc())
                )
            )
            .scalars()
            .all()
            if inv_ids
            else []
        )
        ms_by_inv: dict[uuid.UUID, list[PaymentMilestone]] = {}
        for m in ms_list:
            ms_by_inv.setdefault(m.invoice_id, []).append(m)

        ev_code_map = {e.id: e.event_code for e in events}
        for inv in invs:
            ms_rows = ms_by_inv.get(inv.id, [])
            paid = sum((Decimal(str(m.paid_amount)) for m in ms_rows if not m.is_security_deposit), Decimal("0.00"))
            if inv.status != InvoiceStatus.VOIDED:
                contracted_sum += Decimal(str(inv.total_amount))
                outstanding_sum += max(Decimal("0.00"), Decimal(str(inv.total_amount)) - paid)
            invoices_out.append(
                {
                    "id": str(inv.id),
                    "event_id": str(inv.event_id),
                    "event_code": ev_code_map.get(inv.event_id, ""),
                    "invoice_number": inv.invoice_number,
                    "total_amount": float(inv.total_amount),
                    "paid_amount": float(paid),
                    "security_deposit_amount": float(inv.security_deposit_amount),
                    "deposit_status": inv.deposit_status.value,
                    "status": inv.status.value,
                    "milestones": [
                        {
                            "id": str(m.id),
                            "title": m.title,
                            "amount_due": float(m.amount_due),
                            "paid_amount": float(m.paid_amount),
                            "payment_method": m.payment_method,
                            "receipt_url": m.receipt_url,
                            "is_security_deposit": bool(m.is_security_deposit),
                            "status": m.status,
                        }
                        for m in ms_rows
                    ],
                }
            )

        contracts = (
            await db.execute(
                select(EventContract).where(
                    EventContract.tenant_id == auth.tenant_id,
                    EventContract.event_id.in_(event_ids),
                )
            )
        ).scalars().all()
        contracts_out = [
            {
                "id": str(c.id),
                "event_id": str(c.event_id),
                "event_code": ev_code_map.get(c.event_id, ""),
                "contract_number": c.contract_number,
                "client_signed_at": c.client_signed_at.isoformat() if c.client_signed_at else None,
                "client_signature_name": c.client_signature_name,
                "staff_countersigned_at": c.staff_countersigned_at.isoformat() if c.staff_countersigned_at else None,
            }
            for c in contracts
        ]

    if primary_event_ids:
        del_rows = (
            await db.execute(
                select(EventDelegate, User)
                .join(User, EventDelegate.user_id == User.id)
                .where(
                    EventDelegate.tenant_id == auth.tenant_id,
                    EventDelegate.event_id.in_(primary_event_ids),
                )
            )
        ).all()
        delegates_out = [
            {
                "id": str(d.id),
                "event_id": str(d.event_id),
                "full_name": du.full_name,
                "phone": du.phone,
                "email": du.email,
                "delegate_role": d.delegate_role.value,
                "permissions": d.permissions,
            }
            for d, du in del_rows
        ]

    log_q = (
        select(AuditLog, User.full_name)
        .join(User, AuditLog.actor_id == User.id)
        .where(AuditLog.tenant_id == auth.tenant_id)
    )
    if event_ids:
        from sqlalchemy import or_

        log_q = log_q.where(or_(AuditLog.actor_id == client_id, AuditLog.event_id.in_(event_ids)))
    else:
        log_q = log_q.where(AuditLog.actor_id == client_id)
    audit_rows = (await db.execute(log_q.order_by(AuditLog.created_at.desc()).limit(50))).all()

    return {
        "client": _serialize_client_row(
            user,
            cp,
            {"events_count": len(events), "contracted": contracted_sum, "outstanding": outstanding_sum},
        ),
        "bookings": [
            {
                "id": str(ev.id),
                "event_code": ev.event_code,
                "title": ev.title,
                "event_type": ev.event_type,
                "hall_name": halls[ev.hall_id].name if ev.hall_id in halls else "",
                "hall_name_ar": halls[ev.hall_id].name_ar if ev.hall_id in halls else "",
                "start_time": ev.start_time.isoformat(),
                "end_time": ev.end_time.isoformat(),
                "status": ev.status.value,
                "guest_count": ev.guest_count,
            }
            for ev in events
        ],
        "invoices": invoices_out,
        "contracts": contracts_out,
        "delegates": delegates_out,
        "audit_logs": [
            {
                "id": str(lg.id),
                "action": lg.action,
                "actor_name": actor_name,
                "event_id": str(lg.event_id) if lg.event_id else None,
                "new_value": lg.new_value,
                "created_at": lg.created_at.isoformat(),
            }
            for lg, actor_name in audit_rows
        ],
    }


@router.patch("/tenant/clients/{client_id}")
async def update_tenant_client(
    client_id: uuid.UUID,
    body: UpdateTenantClientBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES, required_perm=("clients", "edit"))
    ),
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
                await db.execute(
                    select(User.id).where(
                        User.tenant_id == auth.tenant_id, User.phone == clean_phone, User.id != user.id
                    )
                )
            ).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=409, detail="Phone number already in use")
            user.phone = clean_phone
    if body.email is not None:
        clean_email = body.email.strip().lower() or None
        if clean_email and clean_email != user.email:
            dup_em = (
                await db.execute(
                    select(User.id).where(
                        User.tenant_id == auth.tenant_id, User.email == clean_email, User.id != user.id
                    )
                )
            ).scalar_one_or_none()
            if dup_em:
                raise HTTPException(status_code=409, detail="Email already in use")
        user.email = clean_email
    if body.is_active is not None:
        user.is_active = body.is_active

    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == user.id))).scalar_one_or_none()
    if not cp:
        cp = ClientProfile(user_id=user.id, client_category=body.client_category or ClientCategory.INDIVIDUAL_B2C)
        db.add(cp)
    for field in (
        "vip_tier",
        "client_category",
        "custom_category_label",
        "company_name",
        "tax_id",
        "national_id_or_cr",
        "billing_address",
        "notes",
        "refund_bank_details",
    ):
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
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, CLIENT_ADMIN_ROLES, required_perm=("clients", "edit"))
    ),
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


@router.post("/tenant/clients/{client_id}/archive")
async def archive_one_time_client(
    client_id: uuid.UUID,
    body: ArchiveClientBody = ArchiveClientBody(),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CLIENT_ARCHIVE_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Soft-archive a completed one-time client account after their event ended & security deposit settled."""
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

    events = (
        await db.execute(
            select(Event).where(Event.tenant_id == auth.tenant_id, Event.primary_client_id == client_id)
        )
    ).scalars().all()
    if not events:
        raise HTTPException(
            status_code=400,
            detail="Client has no ended events on record; one-time client archiving requires at least one COMPLETED or CLOSED event",
        )
    ended_statuses = {EventStatus.COMPLETED, EventStatus.CLOSED}
    active_events = [e.event_code for e in events if e.status not in (ended_statuses | {EventStatus.CANCELLED})]
    if active_events:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot archive client with active/non-ended events: {', '.join(active_events)}",
        )
    if not any(e.status in ended_statuses for e in events):
        raise HTTPException(
            status_code=400,
            detail="At least one event must reach COMPLETED or CLOSED before archiving this one-time client",
        )

    ev_ids = [e.id for e in events]
    invoices = (
        await db.execute(
            select(Invoice).where(
                Invoice.tenant_id == auth.tenant_id,
                Invoice.event_id.in_(ev_ids),
                Invoice.status != InvoiceStatus.VOIDED,
            )
        )
    ).scalars().all()
    for inv in invoices:
        if inv.deposit_status in (DepositStatus.HELD, DepositStatus.INSPECTION_PASSED, DepositStatus.DEDUCTED):
            raise HTTPException(
                status_code=400,
                detail=f"Security deposit on invoice {inv.invoice_number} ({inv.deposit_status.value}) must be refunded/settled before archiving",
            )

    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == user.id))).scalar_one_or_none()
    if not cp:
        cp = ClientProfile(user_id=user.id, client_category=ClientCategory.INDIVIDUAL_B2C)
        db.add(cp)
        await db.flush()

    cp.is_archived = True
    cp.archived_at = utcnow()
    cp.archived_by_id = auth.user.id
    cp.archive_reason = (body.reason or "One-time client event completed & refundable deposit settled").strip()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="ONE_TIME_CLIENT_ARCHIVED",
            new_value={"client_id": str(user.id), "reason": cp.archive_reason, "events_count": len(events)},
        )
    )
    await db.commit()
    return {
        "status": "ARCHIVED",
        "client_id": str(user.id),
        "archived_at": cp.archived_at.isoformat(),
        "archive_reason": cp.archive_reason,
    }


@router.post("/tenant/clients/{client_id}/unarchive")
async def unarchive_client(
    client_id: uuid.UUID,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CLIENT_ARCHIVE_ROLES)),
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
    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == user.id))).scalar_one_or_none()
    if cp:
        cp.is_archived = False
        cp.archived_at = None
        cp.archived_by_id = None
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=auth.user.id,
            action="CLIENT_UNARCHIVED",
            new_value={"client_id": str(user.id)},
        )
    )
    await db.commit()
    return {"status": "ACTIVE", "client_id": str(user.id)}
