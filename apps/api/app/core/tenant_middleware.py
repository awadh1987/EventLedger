from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant

ROOT_DOMAIN = settings.ROOT_DOMAIN.split(":")[0].lower()


async def resolve_active_tenant_by_slug(db: AsyncSession, raw_slug: str) -> Tenant | None:
    clean = (raw_slug or "").strip().lower()
    if not clean:
        return None
    res = await db.execute(select(Tenant).where(Tenant.slug == clean, Tenant.is_active == True))  # noqa: E712
    tenant = res.scalar_one_or_none()
    if tenant is None and clean == "tenant":
        res_fallback = await db.execute(
            select(Tenant).where(Tenant.is_active == True).order_by(Tenant.created_at.asc()).limit(1)  # noqa: E712
        )
        tenant = res_fallback.scalar_one_or_none()
    return tenant


class TenantResolverMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0].lower()
        slug_header = (request.headers.get("x-tenant-slug") or "").strip().lower()
        custom_domain_header = (request.headers.get("x-tenant-custom-domain") or "").strip().lower()

        request.state.tenant = None
        request.state.tenant_mode = "PLATFORM_ROOT"

        if host == f"admin.{ROOT_DOMAIN}" or host.startswith("admin."):
            request.state.tenant_mode = "PLATFORM_SUPER_ADMIN"
            if not slug_header and not custom_domain_header:
                return await call_next(request)

        async with AsyncSessionLocal() as db:
            tenant = None
            if slug_header:
                tenant = await resolve_active_tenant_by_slug(db, slug_header)
            elif custom_domain_header:
                res = await db.execute(
                    select(Tenant).where(Tenant.custom_domain == custom_domain_header, Tenant.is_active == True)  # noqa: E712
                )
                tenant = res.scalar_one_or_none()
            elif host and host not in (ROOT_DOMAIN, f"www.{ROOT_DOMAIN}", "localhost", "127.0.0.1", "testserver"):
                if host.endswith(f".{ROOT_DOMAIN}"):
                    slug = host.replace(f".{ROOT_DOMAIN}", "")
                    tenant = await resolve_active_tenant_by_slug(db, slug)
                else:
                    res = await db.execute(
                        select(Tenant).where(Tenant.custom_domain == host, Tenant.is_active == True)  # noqa: E712
                    )
                    tenant = res.scalar_one_or_none()

            if tenant:
                request.state.tenant = tenant
                request.state.tenant_mode = "TENANT_WORKSPACE"

        return await call_next(request)
