import re
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, hash_password, require_roles
from app.core.tenant_middleware import resolve_active_tenant_by_slug
from app.models.accounting import Invoice
from app.models.base import RecordLifecycle
from app.models.events import Event, GatePass
from app.models.events_extensions import EventContract
from app.models.tenant import SubscriptionStatus, SubscriptionTier, Tenant, TenantBranding
from app.models.users import StaffProfile, StaffRole, User, UserType
from app.models.venue import CateringMenuItem, Hall, InventoryItem
from app.routers.tenant_settings import resolve_branding_tokens
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Tier 1: SaaS Super-Admin & Tenant Directory"])


class UpdateTenantAdminBody(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    currency: Optional[str] = None
    tax_rate: Optional[Decimal] = None
    is_active: Optional[bool] = None
    subscription_tier: Optional[SubscriptionTier] = None
    subscription_status: Optional[SubscriptionStatus] = None
    custom_domain: Optional[str] = None
    custom_domain_verified: Optional[bool] = None
    max_halls: Optional[int] = None
    monthly_whatsapp_quota: Optional[int] = None
    whatsapp_monthly_quota: Optional[int] = None
    whatsapp_used_this_month: Optional[int] = None


class ResetOwnerPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=8)


@router.get("/public/tenants")
async def list_public_tenants(db: AsyncSession = Depends(get_db)):
    tenants = (
        await db.execute(select(Tenant).where(Tenant.is_active == True).order_by(Tenant.name))  # noqa: E712
    ).scalars().all()
    items = []
    for t in tenants:
        branding = (
            await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == t.id))
        ).scalar_one_or_none()
        halls_count = (
            await db.execute(
                select(func.count(Hall.id)).where(Hall.tenant_id == t.id, Hall.lifecycle == RecordLifecycle.ACTIVE)
            )
        ).scalar() or 0
        tokens = resolve_branding_tokens(t.settings)
        items.append(
            {
                "id": str(t.id),
                "name": t.name,
                "slug": t.slug,
                "currency": t.currency,
                "halls_count": halls_count,
                "branding": {
                    "primaryColor": branding.primary_color if branding else "#D4AF37",
                    "accentColor": branding.accent_color if branding else "#0F172A",
                    "themePreset": tokens["theme_preset"],
                    "tokens": tokens,
                    "logoLightUrl": branding.logo_light_url if branding else None,
                    "logoDarkUrl": branding.logo_dark_url if branding else None,
                    "heroTaglineAr": branding.hero_tagline_ar if branding else None,
                    "heroTaglineEn": branding.hero_tagline_en if branding else None,
                },
            }
        )
    return {"tenants": items}


@router.get("/public/verify/{code}")
async def verify_public_document(code: str, db: AsyncSession = Depends(get_db)):
    clean = code.strip()

    async def _tenant_info(tid: uuid.UUID) -> dict:
        t = (await db.execute(select(Tenant).where(Tenant.id == tid))).scalar_one_or_none()
        return {"name": t.name, "slug": t.slug} if t else {}

    inv = (await db.execute(select(Invoice).where(Invoice.invoice_number == clean))).scalar_one_or_none()
    if inv:
        return {
            "valid": True,
            "document_type": "INVOICE",
            "number": inv.invoice_number,
            "status": inv.status.value,
            "total_amount": float(inv.total_amount),
            "issued_at": inv.created_at.isoformat(),
            "tenant": await _tenant_info(inv.tenant_id),
        }

    ctr = (
        await db.execute(select(EventContract).where(EventContract.contract_number == clean))
    ).scalar_one_or_none()
    if ctr:
        return {
            "valid": True,
            "document_type": "CONTRACT",
            "number": ctr.contract_number,
            "status": "SIGNED" if ctr.client_signed_at else "PENDING_SIGNATURE",
            "countersigned": ctr.staff_countersigned_at is not None,
            "issued_at": ctr.created_at.isoformat(),
            "tenant": await _tenant_info(ctr.tenant_id),
        }

    gp = (await db.execute(select(GatePass).where(GatePass.qr_token == clean))).scalar_one_or_none()
    if gp:
        return {
            "valid": True,
            "document_type": "GATE_PASS",
            "pass_type": gp.pass_type,
            "holder_name": gp.holder_name,
            "valid_from": gp.valid_from.isoformat(),
            "valid_until": gp.valid_until.isoformat(),
            "is_checked_in": gp.is_checked_in,
            "tenant": await _tenant_info(gp.tenant_id),
        }

    raise HTTPException(status_code=404, detail="Document code not recognized")


async def _build_public_storefront(db: AsyncSession, tenant: Tenant) -> dict:
    branding = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    ).scalar_one_or_none()
    halls = (
        await db.execute(
            select(Hall).where(Hall.tenant_id == tenant.id, Hall.lifecycle == RecordLifecycle.ACTIVE)
        )
    ).scalars().all()
    catering_items = (
        await db.execute(
            select(CateringMenuItem).where(
                CateringMenuItem.tenant_id == tenant.id,
                CateringMenuItem.lifecycle == RecordLifecycle.ACTIVE,
            )
        )
    ).scalars().all()
    addon_items = (
        await db.execute(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant.id,
                InventoryItem.lifecycle == RecordLifecycle.ACTIVE,
                InventoryItem.unit_addon_price > 0,
            )
        )
    ).scalars().all()

    settings_dict = tenant.settings or {}
    meta = settings_dict.get("storefront_meta") or {}
    hall_media = settings_dict.get("hall_media") or {}
    offers = settings_dict.get("storefront_offers") or []
    tokens = resolve_branding_tokens(settings_dict)
    profile_media = settings_dict.get("profile_media") or {}

    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "custom_domain": tenant.custom_domain,
        "custom_domain_verified": tenant.custom_domain_verified,
        "currency": tenant.currency,
        "tax_rate": float(tenant.tax_rate),
        "default_security_deposit": float(settings_dict.get("defaultSecurityDeposit", 0)),
        "subscription_tier": tenant.subscription_tier.value,
        "subscription_status": tenant.subscription_status.value,
        "payment_accounts": tenant.payment_accounts
        or [
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
            "themePreset": tokens["theme_preset"],
            "tokens": tokens,
            "ownerAvatarUrl": profile_media.get("owner_avatar_url"),
            "logoLightUrl": branding.logo_light_url if branding else None,
            "logoDarkUrl": branding.logo_dark_url if branding else None,
            "faviconUrl": branding.favicon_url if branding else None,
            "heroTaglineAr": branding.hero_tagline_ar if branding else None,
            "heroTaglineEn": branding.hero_tagline_en if branding else None,
            "heroTitleAr": meta.get("heroTitleAr") or tenant.name,
            "heroTitleEn": meta.get("heroTitleEn") or tenant.name,
            "heroSubtitleAr": meta.get("heroSubtitleAr") or (branding.hero_tagline_ar if branding else None),
            "heroSubtitleEn": meta.get("heroSubtitleEn") or (branding.hero_tagline_en if branding else None),
            "heroVideoUrl": meta.get("heroVideoUrl"),
            "heroBannerUrl": meta.get("heroBannerUrl"),
            "contactPhone": meta.get("contactPhone"),
            "whatsappNumber": meta.get("whatsappNumber"),
            "addressAr": meta.get("addressAr"),
            "addressEn": meta.get("addressEn"),
            "socialLinks": meta.get("socialLinks") or {},
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
                "combinable_with_hall_id": (
                    lambda pids: str(pids[0]) if pids else None
                )(AvailabilityService.resolve_combinable_partner_ids(halls, h.id)),
                **(
                    lambda hm: {
                        "gallery_urls": list(
                            dict.fromkeys(
                                ([hm["cover_image_url"]] if hm.get("cover_image_url") else [])
                                + (hm.get("gallery_urls") or [])
                                + [
                                    it.get("url")
                                    for it in (hm.get("items") or [])
                                    if isinstance(it, dict) and it.get("media_type") == "image" and it.get("url")
                                ]
                            )
                        ),
                        "video_url": hm.get("video_url")
                        or next(
                            (
                                it.get("url")
                                for it in (hm.get("items") or [])
                                if isinstance(it, dict)
                                and it.get("media_type") in ("video", "youtube")
                                and it.get("url")
                            ),
                            None,
                        ),
                        "amenities": hm.get("amenities") or [],
                    }
                )(hall_media.get(str(h.id)) or {}),
            }
            for h in halls
        ],
        "offers": offers,
        "addon_items": [
            {
                "id": str(a.id),
                "name": a.name,
                "category": a.category,
                "total_stock": a.total_stock,
                "unit_addon_price": float(a.unit_addon_price),
            }
            for a in addon_items
        ],
        "catering_items": [
            {
                "id": str(c.id),
                "name_ar": c.name_ar,
                "name_en": c.name_en,
                "price_per_guest": float(c.price_per_guest),
            }
            for c in catering_items
        ],
    }


@router.get("/public/tenants/{slug}")
async def get_public_tenant_by_slug(slug: str, db: AsyncSession = Depends(get_db)):
    tenant = await resolve_active_tenant_by_slug(db, slug)
    if not tenant:
        raise HTTPException(status_code=404, detail="Venue workspace not found or inactive")
    return await _build_public_storefront(db, tenant)


@router.get("/public/tenants/{slug}/storefront")
async def get_public_tenant_storefront(slug: str, db: AsyncSession = Depends(get_db)):
    tenant = await resolve_active_tenant_by_slug(db, slug)
    if not tenant:
        raise HTTPException(status_code=404, detail="Venue workspace not found or inactive")
    return await _build_public_storefront(db, tenant)


@router.get("/admin/tenants")
async def list_all_tenants(
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    tenants = (await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))).scalars().all()
    items = []
    total_events_all = 0
    total_gmv_all = 0.0
    active_tenants = 0
    for t in tenants:
        if t.is_active:
            active_tenants += 1
        halls_count = (
            await db.execute(
                select(func.count(Hall.id)).where(Hall.tenant_id == t.id, Hall.lifecycle == RecordLifecycle.ACTIVE)
            )
        ).scalar() or 0
        events_count = (await db.execute(select(func.count(Event.id)).where(Event.tenant_id == t.id))).scalar() or 0
        users_count = (await db.execute(select(func.count(User.id)).where(User.tenant_id == t.id))).scalar() or 0
        gmv = float(
            (
                await db.execute(select(func.coalesce(func.sum(Invoice.total_amount), 0)).where(Invoice.tenant_id == t.id))
            ).scalar()
            or 0
        )
        owner = (
            await db.execute(
                select(User)
                .join(StaffProfile, StaffProfile.user_id == User.id)
                .where(User.tenant_id == t.id, StaffProfile.role == StaffRole.OWNER)
                .limit(1)
            )
        ).scalar_one_or_none()
        wa_quota = int((t.settings or {}).get("whatsapp_monthly_quota", t.monthly_whatsapp_quota))
        total_events_all += events_count
        total_gmv_all += gmv
        items.append(
            {
                "id": str(t.id),
                "name": t.name,
                "slug": t.slug,
                "custom_domain": t.custom_domain,
                "custom_domain_verified": t.custom_domain_verified,
                "subscription_tier": t.subscription_tier.value,
                "subscription_status": t.subscription_status.value,
                "max_halls": t.max_halls,
                "monthly_whatsapp_quota": wa_quota,
                "whatsapp_monthly_quota": wa_quota,
                "whatsapp_used_this_month": t.whatsapp_used_this_month,
                "whatsapp_used": t.whatsapp_used_this_month,
                "currency": t.currency,
                "tax_rate": float(t.tax_rate),
                "is_active": t.is_active,
                "halls_count": halls_count,
                "events_count": events_count,
                "users_count": users_count,
                "total_gmv": gmv,
                "owner_name": owner.full_name if owner else None,
                "owner_email": owner.email if owner else None,
                "owner_phone": owner.phone if owner else None,
                "created_at": t.created_at.isoformat(),
            }
        )
    return {
        "kpis": {
            "total_tenants": len(tenants),
            "active_tenants": active_tenants,
            "total_events": total_events_all,
            "total_gmv": total_gmv_all,
        },
        "tenants": items,
    }


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

    updates = body.model_dump(exclude_none=True)
    if "name" in updates:
        updates["name"] = updates["name"].strip()
    if "slug" in updates:
        clean_slug = re.sub(r"[^a-z0-9-]", "", updates["slug"].lower().strip())
        if len(clean_slug) < 3 or clean_slug in {"www", "admin", "api", "app", "mail", "static"}:
            raise HTTPException(status_code=400, detail="Invalid or reserved tenant slug")
        if clean_slug != tenant.slug:
            dup = (
                await db.execute(select(Tenant.id).where(Tenant.slug == clean_slug, Tenant.id != tenant.id))
            ).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=409, detail="Subdomain slug is already taken")
        updates["slug"] = clean_slug
    if "currency" in updates:
        updates["currency"] = updates["currency"].strip().upper()
    if "custom_domain" in updates:
        updates["custom_domain"] = updates["custom_domain"].strip().lower() or None

    wa_quota = updates.pop("whatsapp_monthly_quota", None) or updates.get("monthly_whatsapp_quota")
    if wa_quota is not None:
        tenant.monthly_whatsapp_quota = int(wa_quota)
        tenant.settings = {**(tenant.settings or {}), "whatsapp_monthly_quota": int(wa_quota)}

    for field, val in updates.items():
        if hasattr(tenant, field):
            setattr(tenant, field, val)

    await db.commit()
    return {"status": "UPDATED", "tenant_id": str(tenant.id), "is_active": tenant.is_active}


@router.post("/admin/tenants/{tenant_id}/reset-owner-password")
async def reset_tenant_owner_password(
    tenant_id: uuid.UUID,
    body: ResetOwnerPasswordBody,
    auth: AuthContext = Depends(require_roles({UserType.SUPER_ADMIN})),
    db: AsyncSession = Depends(get_db),
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    owner = (
        await db.execute(
            select(User)
            .join(StaffProfile, StaffProfile.user_id == User.id)
            .where(User.tenant_id == tenant_id, StaffProfile.role == StaffRole.OWNER)
            .limit(1)
        )
    ).scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="Tenant owner not found")
    owner.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"status": "OWNER_PASSWORD_RESET", "tenant_id": str(tenant.id), "owner_id": str(owner.id)}
