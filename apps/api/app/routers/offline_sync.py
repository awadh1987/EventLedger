from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.events import Event, GatePass

router = APIRouter(prefix="/api/v1/sync", tags=["Offline Desktop & Mobile Sync"])


class OfflineMutationItem(BaseModel):
    mutation_id: str
    action_type: str
    payload: dict
    recorded_at: datetime


class BatchSyncRequest(BaseModel):
    device_id: str
    mutations: list[OfflineMutationItem]


@router.get("/manifest")
async def get_offline_manifest(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant header (X-Tenant-Slug) required")
    window_start = datetime.utcnow() - timedelta(hours=6)
    window_end = datetime.utcnow() + timedelta(hours=24)
    events = (await db.execute(select(Event).where(Event.tenant_id == tenant.id, Event.start_time >= window_start, Event.start_time <= window_end))).scalars().all()
    event_ids = [e.id for e in events]
    passes = (await db.execute(select(GatePass).where(GatePass.event_id.in_(event_ids)))).scalars().all() if event_ids else []
    return {
        "tenant_slug": tenant.slug,
        "synced_at": datetime.utcnow().isoformat(),
        "events": [{"id": str(e.id), "event_code": e.event_code, "start_time": e.start_time.isoformat(), "guest_count": e.guest_count} for e in events],
        "gate_passes": [{"id": str(p.id), "qr_token": p.qr_token, "holder_name": p.holder_name, "is_checked_in": p.is_checked_in} for p in passes],
    }


@router.post("/batch")
async def process_offline_batch(body: BatchSyncRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant header required")
    processed_ids: list[str] = []
    for item in body.mutations:
        if item.action_type == "GATE_QR_CHECKIN":
            token = str((item.payload or {}).get("qr_token", "")).strip()
            if token:
                gp = (await db.execute(select(GatePass).where(GatePass.qr_token == token))).scalar_one_or_none()
                if gp and not gp.is_checked_in:
                    gp.is_checked_in = True
                    gp.checked_in_at = item.recorded_at.replace(tzinfo=None) if item.recorded_at.tzinfo else item.recorded_at
        processed_ids.append(item.mutation_id)
    await db.commit()
    return {"status": "SYNCED", "device_id": body.device_id, "processed_count": len(processed_ids), "processed_ids": processed_ids}
