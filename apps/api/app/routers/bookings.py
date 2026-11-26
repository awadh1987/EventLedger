import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles
from app.models.accounting import Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import utcnow
from app.models.events import Event, EventStatus
from app.models.users import User, UserType
from app.models.venue import Hall
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Availability, Quotes & 48h Holds"])


class HoldBookingRequest(BaseModel):
    hall_id: uuid.UUID
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = 200
    addon_amount: Decimal = Decimal("0.00")
    client_id: Optional[uuid.UUID] = None


class UpdateEventStatusBody(BaseModel):
    status: EventStatus


@router.get("/public/halls/availability")
async def get_halls_availability(
    request: Request,
    hall_id: uuid.UUID = Query(...),
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    avail = await AvailabilityService.check_hall_availability(db, tenant.id, hall_id, start_time, end_time)
    quote = await AvailabilityService.calculate_dynamic_quote(db, tenant.id, hall_id, start_time)
    return {"availability": avail, "quote": quote}


@router.post("/bookings/hold")
async def create_48h_hold(
    body: HoldBookingRequest,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    avail = await AvailabilityService.check_hall_availability(
        db, auth.tenant_id, body.hall_id, body.start_time, body.end_time
    )
    if not avail["available"]:
        raise HTTPException(status_code=409, detail=avail)

    primary_client_id = (
        body.client_id
        if (body.client_id and auth.user.user_type == UserType.INTERNAL_STAFF)
        else auth.user.id
    )

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, auth.tenant_id, body.hall_id, body.start_time, addon_amount=body.addon_amount
    )
    event_code = f"EVT-{datetime.now(timezone.utc).year}-{str(uuid.uuid4().int % 10000).zfill(4)}"
    hold_expires = utcnow() + timedelta(hours=48)
    event = Event(
        tenant_id=auth.tenant_id,
        hall_id=body.hall_id,
        primary_client_id=primary_client_id,
        assigned_sales_id=auth.user.id if auth.user.user_type == UserType.INTERNAL_STAFF else None,
        event_code=event_code,
        event_type=body.event_type,
        start_time=body.start_time.replace(tzinfo=None) if body.start_time.tzinfo else body.start_time,
        end_time=body.end_time.replace(tzinfo=None) if body.end_time.tzinfo else body.end_time,
        status=EventStatus.HOLD_48H,
        guest_count=body.guest_count,
    )
    db.add(event)
    await db.flush()

    invoice = Invoice(
        tenant_id=auth.tenant_id,
        event_id=event.id,
        invoice_number=f"INV-{event_code}",
        subtotal=Decimal(str(quote["subtotal"])),
        tax_amount=Decimal(str(quote["tax_amount"])),
        total_amount=Decimal(str(quote["total_amount"])),
        security_deposit_amount=Decimal(str(quote["security_deposit_amount"])),
        status=InvoiceStatus.ISSUED,
    )
    db.add(invoice)
    await db.flush()
    db.add(
        PaymentMilestone(
            tenant_id=auth.tenant_id,
            invoice_id=invoice.id,
            title="48h Hold Confirmation Deposit (50%)",
            amount_due=(Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01")),
            due_date=hold_expires,
            status="PENDING",
        )
    )
    await db.commit()
    return {
        "event_id": str(event.id),
        "event_code": event.event_code,
        "status": "HOLD_48H",
        "hold_expires_at": hold_expires.isoformat(),
        "quote": quote,
    }


@router.get("/bookings/events")
async def list_staff_events(
    status: Optional[EventStatus] = Query(default=None),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    query = select(Event).where(Event.tenant_id == auth.tenant_id)
    if status:
        query = query.where(Event.status == status)
    events = (await db.execute(query.order_by(Event.start_time.asc()))).scalars().all()
    halls = {h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == auth.tenant_id))).scalars().all()}
    clients = {u.id: u for u in (await db.execute(select(User).where(User.tenant_id == auth.tenant_id))).scalars().all()}
    invoices = {
        i.event_id: i
        for i in (await db.execute(select(Invoice).where(Invoice.tenant_id == auth.tenant_id))).scalars().all()
    }
    return [
        {
            "id": str(ev.id),
            "event_code": ev.event_code,
            "event_type": ev.event_type,
            "hall_id": str(ev.hall_id),
            "hall_name": halls[ev.hall_id].name if ev.hall_id in halls else "",
            "hall_name_ar": halls[ev.hall_id].name_ar if ev.hall_id in halls else "",
            "client_name": clients[ev.primary_client_id].full_name if ev.primary_client_id in clients else "",
            "start_time": ev.start_time.isoformat(),
            "end_time": ev.end_time.isoformat(),
            "status": ev.status.value,
            "guest_count": ev.guest_count,
            "total_amount": float(invoices[ev.id].total_amount) if ev.id in invoices else 0.0,
        }
        for ev in events
    ]


@router.post("/bookings/events/{event_id}/status")
async def update_event_status(
    event_id: uuid.UUID,
    body: UpdateEventStatusBody,
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    ev.status = body.status
    await db.commit()
    return {"status": ev.status.value}
