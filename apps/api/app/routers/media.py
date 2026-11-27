import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles
from app.models.tenant import Tenant, TenantBranding
from app.models.users import StaffRole, User, UserType
from app.models.venue import Hall

router = APIRouter(tags=["media"])

MEDIA_ROOT = Path("/opt/eventledger/media")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES

STAFF_MEDIA_ROLES = {
    StaffRole.OWNER,
    StaffRole.SALES_MANAGER,
    StaffRole.SALES_REP,
    StaffRole.FINANCE,
    StaffRole.OPS_MANAGER,
}
ADMIN_MEDIA_ROLES = {StaffRole.OWNER, StaffRole.SALES_MANAGER, StaffRole.OPS_MANAGER}


def _safe_filename(original: str) -> str:
    ext = Path(original or "file.bin").suffix.lower()
    if not re.match(r"^\.[a-z0-9]{1,8}$", ext):
        ext = ".bin"
    return f"{uuid.uuid4().hex}{ext}"


async def _resolve_tenant(
    request: Request,
    db: AsyncSession,
    auth: AuthContext | None = None,
) -> Tenant:
    if auth is not None and auth.tenant_id:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))
        ).scalar_one_or_none()
        if tenant:
            return tenant

    slug = (request.headers.get("x-tenant-slug") or "").strip().lower()
    if not slug:
        host = (
            request.headers.get("x-forwarded-host")
            or request.headers.get("host")
            or ""
        ).split(":")[0].lower()
        if host.endswith(".events-ye.services"):
            slug = host.replace(".events-ye.services", "")

    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == slug))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


class ProfileMediaUpdate(BaseModel):
    avatar_url: str | None = None
    logo_light_url: str | None = None
    logo_dark_url: str | None = None
    favicon_url: str | None = None


class HallMediaItem(BaseModel):
    url: str
    media_type: str = Field(default="image", pattern="^(image|video|youtube)$")
    caption_ar: str | None = None
    caption_en: str | None = None


class HallMediaUpdate(BaseModel):
    cover_image_url: str | None = None
    items: list[HallMediaItem] = Field(default_factory=list)


@router.post("/erp/uploads/media")
async def upload_media_file(
    request: Request,
    file: UploadFile = File(...),
    folder: str = Form(default="general"),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, STAFF_MEDIA_ROLES)),
):
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")

    tenant = await _resolve_tenant(request, db, auth)
    safe_folder = re.sub(r"[^a-z0-9_-]", "", folder.lower()) or "general"
    target_dir = MEDIA_ROOT / tenant.slug / safe_folder
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = _safe_filename(file.filename or "upload")
    dest_path = target_dir / filename

    size_bytes = 0
    with dest_path.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size_bytes += len(chunk)
            if size_bytes > 100 * 1024 * 1024:
                dest_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="File exceeds 100MB limit")
            out.write(chunk)

    public_url = f"https://{tenant.slug}.events-ye.services/media/{tenant.slug}/{safe_folder}/{filename}"
    media_type = "video" if content_type in ALLOWED_VIDEO_TYPES else "image"
    return {
        "url": public_url,
        "media_type": media_type,
        "content_type": content_type,
        "size_bytes": size_bytes,
    }


@router.put("/erp/settings/profile-media")
async def update_profile_and_brand_media(
    payload: ProfileMediaUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, ADMIN_MEDIA_ROLES)),
):
    tenant = await _resolve_tenant(request, db, auth)
    branding = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if not branding:
        branding = TenantBranding(id=uuid.uuid4(), tenant_id=tenant.id)
        db.add(branding)

    if payload.logo_light_url is not None:
        branding.logo_light_url = payload.logo_light_url
    if payload.logo_dark_url is not None:
        branding.logo_dark_url = payload.logo_dark_url
    if payload.favicon_url is not None:
        branding.favicon_url = payload.favicon_url

    settings = dict(tenant.settings or {})
    profile_media = dict(settings.get("profile_media") or {})
    if payload.avatar_url is not None:
        profile_media["owner_avatar_url"] = payload.avatar_url
        if hasattr(auth.user, "avatar_url"):
            auth.user.avatar_url = payload.avatar_url
    if payload.logo_light_url is not None:
        profile_media["logo_light_url"] = payload.logo_light_url
    if payload.logo_dark_url is not None:
        profile_media["logo_dark_url"] = payload.logo_dark_url
    settings["profile_media"] = profile_media
    tenant.settings = settings

    await db.commit()
    return {"status": "ok", "profile_media": profile_media}


@router.put("/venue/halls/{hall_id}/media")
async def update_hall_media(
    hall_id: uuid.UUID,
    payload: HallMediaUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, STAFF_MEDIA_ROLES)),
):
    tenant = await _resolve_tenant(request, db, auth)
    hall = (
        await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if not hall:
        raise HTTPException(status_code=404, detail="Hall not found")

    settings = dict(tenant.settings or {})
    hall_media_map: dict[str, Any] = dict(settings.get("hall_media") or {})
    hall_media_map[str(hall.id)] = {
        "hall_id": str(hall.id),
        "hall_name": hall.name,
        "hall_name_ar": hall.name_ar,
        "cover_image_url": payload.cover_image_url,
        "items": [item.model_dump() for item in payload.items],
    }
    settings["hall_media"] = hall_media_map
    tenant.settings = settings
    await db.commit()
    return {"status": "ok", "hall_media": hall_media_map[str(hall.id)]}


@router.get("/public/venue/media")
async def get_public_venue_media(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _resolve_tenant(request, db)
    branding = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    ).scalar_one_or_none()
    halls = (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()
    settings = dict(tenant.settings or {})
    hall_media_map = settings.get("hall_media") or {}
    profile_media = settings.get("profile_media") or {}

    return {
        "tenant_slug": tenant.slug,
        "venue_name": tenant.name,
        "profile_media": {
            "owner_avatar_url": profile_media.get("owner_avatar_url"),
            "logo_light_url": (branding.logo_light_url if branding else None) or profile_media.get("logo_light_url"),
            "logo_dark_url": (branding.logo_dark_url if branding else None) or profile_media.get("logo_dark_url"),
            "favicon_url": branding.favicon_url if branding else None,
        },
        "halls": [
            {
                "id": str(h.id),
                "name": h.name,
                "name_ar": h.name_ar,
                "capacity_banquet": h.capacity_banquet,
                "capacity_theater": h.capacity_theater,
                "base_price": float(h.base_price) if h.base_price is not None else 0,
                "media": hall_media_map.get(str(h.id), {"cover_image_url": None, "items": []}),
            }
            for h in halls
        ],
    }
