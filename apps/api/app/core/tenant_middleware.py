from fastapi import Request
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant

ROOT_DOMAIN = settings.ROOT_DOMAIN.split(":")[0].lower()


class TenantResolverMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0].lower()
        slug_header = (request.headers.get("x-tenant-slug") or "").strip().lower()
        custom_domain_header = (request.headers.get("x-tenant-custom-domain") or "").strip().lower()

        request.state.tenant = None
        request.state.tenant_mode = "PLATFORM_ROOT"

        if host == f"admin.{ROOT_DOMAIN}":
            request.state.tenant_mode = "PLATFORM_SUPER_ADMIN"
            return await call_next(request)

        async with AsyncSessionLocal() as db:
            tenant = None
            if slug_header:
                res = await db.execute(select(Tenant).where(Tenant.slug == slug_header, Tenant.is_active == True))
                tenant = res.scalar_one_or_none()
            elif custom_domain_header:
                res = await db.execute(select(Tenant).where(Tenant.custom_domain == custom_domain_header, Tenant.is_active == True))
                tenant = res.scalar_one_or_none()
            elif host and host not in (ROOT_DOMAIN, f"www.{ROOT_DOMAIN}", "localhost", "127.0.0.1"):
                if host.endswith(f".{ROOT_DOMAIN}"):
                    slug = host.replace(f".{ROOT_DOMAIN}", "")
                    res = await db.execute(select(Tenant).where(Tenant.slug == slug, Tenant.is_active == True))
                else:
                    res = await db.execute(select(Tenant).where(Tenant.custom_domain == host, Tenant.is_active == True))
                tenant = res.scalar_one_or_none()

            if tenant:
                request.state.tenant = tenant
                request.state.tenant_mode = "TENANT_WORKSPACE"

        return await call_next(request)
