from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.tenant_middleware import TenantResolverMiddleware
from app.routers import approvals, auth, bookings, finance, offline_sync, phase6_ops, portal, public_onboarding

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

app.include_router(public_onboarding.router)
app.include_router(auth.auth_router)
app.include_router(portal.portal_router)
app.include_router(bookings.router)
app.include_router(approvals.router)
app.include_router(finance.router)
app.include_router(phase6_ops.router)
app.include_router(offline_sync.router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "EventLedger Python FastAPI"}
