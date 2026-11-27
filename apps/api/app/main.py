import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.tenant_middleware import TenantResolverMiddleware
import app.models.events_extensions  # noqa: F401
from app.routers import (
    admin,
    approvals,
    auth,
    bookings,
    finance,
    lifecycle_ops,
    offline_sync,
    phase6_ops,
    portal,
    public_onboarding,
    tenant_settings,
)

app = FastAPI(
    title="EventLedger (إيفنت ليدجر) API",
    version="3.0.0",
    description="Multi-Tenant Venue, Wedding Hall & Conference ERP + Client Portal API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantResolverMiddleware)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

app.include_router(public_onboarding.router)
app.include_router(admin.router)
app.include_router(auth.auth_router)
app.include_router(portal.portal_router)
app.include_router(bookings.router)
app.include_router(approvals.router)
app.include_router(finance.router)
app.include_router(lifecycle_ops.router)
app.include_router(phase6_ops.router)
app.include_router(tenant_settings.router)
app.include_router(offline_sync.router)


@app.get("/health")
async def health_check():
    db_status = "ok"
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"
    return {"status": "ok", "service": "EventLedger Python FastAPI", "database": db_status}
