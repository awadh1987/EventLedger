from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, require_roles
from app.models.base import utcnow
from app.models.events import Event, GatePass
from app.models.users import StaffRole, UserType

router = APIRouter(prefix="/api/v1", tags=["Security Gate & Offline Sync"])


class GateCheckInBody(BaseModel):
    qr_token: str


class OfflineMutationItem(BaseModel):
    mutation_id: str
    action_type: str
    payload: dict
    recorded_at: datetime


class BatchSyncRequest(BaseModel):
    device_id: str
    mutations: list[OfflineMutationItem]


@router.post("/gate/check-in")
async def gate_check_in(
    body: GateCheckInBody,
    auth: AuthContext = Depends(
        require_roles({UserType.INTERNAL_STAFF}, {StaffRole.OWNER, StaffRole.OPS_MANAGER, StaffRole.SECURITY})
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    token = body.qr_token.strip()
    gp = (
        await db.execute(select(GatePass).where(GatePass.qr_token == token, GatePass.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not gp:
        return {"result": "INVALID", "holder_name": "", "pass_type": "", "event_code": "", "checked_in_at": None}

    ev = (await db.execute(select(Event).where(Event.id == gp.event_id, Event.tenant_id == auth.tenant_id))).scalar_one_or_none()
    now = utcnow()
    if gp.is_checked_in:
        return {
            "result": "ALREADY_CHECKED_IN",
            "holder_name": gp.holder_name,
            "pass_type": gp.pass_type,
            "event_code": ev.event_code if ev else "",
            "checked_in_at": gp.checked_in_at.isoformat() if gp.checked_in_at else None,
        }
    if now < gp.valid_from - timedelta(hours=6) or now > gp.valid_until + timedelta(hours=6):
        return {
            "result": "OUTSIDE_WINDOW",
            "holder_name": gp.holder_name,
            "pass_type": gp.pass_type,
            "event_code": ev.event_code if ev else "",
            "checked_in_at": None,
        }

    gp.is_checked_in = True
    gp.checked_in_at = now
    await db.commit()
    return {
        "result": "ADMITTED",
        "holder_name": gp.holder_name,
        "pass_type": gp.pass_type,
        "event_code": ev.event_code if ev else "",
        "checked_in_at": now.isoformat(),
    }


@router.get("/sync/manifest")
async def get_offline_manifest(
    days_ahead: int = Query(default=60, ge=1, le=365),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    window_start = utcnow() - timedelta(hours=6)
    window_end = utcnow() + timedelta(days=days_ahead)
    events = (
        await db.execute(
            select(Event).where(
                Event.tenant_id == auth.tenant_id,
                Event.start_time >= window_start,
                Event.start_time <= window_end,
            )
        )
    ).scalars().all()
    event_ids = [e.id for e in events]
    ev_code_by_id = {e.id: e.event_code for e in events}
    passes = (
        (
            await db.execute(
                select(GatePass).where(GatePass.tenant_id == auth.tenant_id, GatePass.event_id.in_(event_ids))
            )
        )
        .scalars()
        .all()
        if event_ids
        else []
    )
    return {
        "tenant_id": str(auth.tenant_id),
        "synced_at": utcnow().isoformat(),
        "events": [
            {"id": str(e.id), "event_code": e.event_code, "start_time": e.start_time.isoformat(), "guest_count": e.guest_count}
            for e in events
        ],
        "gate_passes": [
            {
                "id": str(p.id),
                "event_id": str(p.event_id),
                "event_code": ev_code_by_id.get(p.event_id, ""),
                "qr_token": p.qr_token,
                "holder_name": p.holder_name,
                "pass_type": p.pass_type,
                "is_checked_in": p.is_checked_in,
                "checked_in_at": p.checked_in_at.isoformat() if p.checked_in_at else None,
            }
            for p in passes
        ],
    }


@router.post("/sync/batch")
async def process_offline_batch(
    body: BatchSyncRequest,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    processed_ids: list[str] = []
    results: list[dict] = []
    for item in body.mutations:
        res_status = "IGNORED"
        if item.action_type == "GATE_QR_CHECKIN":
            token = str((item.payload or {}).get("qr_token", "")).strip()
            if token:
                gp = (
                    await db.execute(
                        select(GatePass).where(GatePass.qr_token == token, GatePass.tenant_id == auth.tenant_id)
                    )
                ).scalar_one_or_none()
                if not gp:
                    res_status = "INVALID"
                elif gp.is_checked_in:
                    res_status = "ALREADY_CHECKED_IN"
                else:
                    gp.is_checked_in = True
                    gp.checked_in_at = (
                        item.recorded_at.replace(tzinfo=None) if item.recorded_at.tzinfo else item.recorded_at
                    )
                    res_status = "ADMITTED"
        processed_ids.append(item.mutation_id)
        results.append({"mutation_id": item.mutation_id, "result": res_status})
    await db.commit()
    return {
        "status": "SYNCED",
        "device_id": body.device_id,
        "processed_count": len(processed_ids),
        "processed_ids": processed_ids,
        "results": results,
    }
