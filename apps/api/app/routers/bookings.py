import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import Event, EventStatus
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Availability, Quotes & 48h Holds"])


class HoldBookingRequest(BaseModel):
    hall_id: uuid.UUID
    primary_client_id: uuid.UUID
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = 200
    addon_amount: Decimal = Decimal("0.00")


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
async def create_48h_hold(body: HoldBookingRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, body.hall_id, body.start_time, body.end_time)
    if not avail["available"]:
        raise HTTPException(status_code=409, detail=avail)

    quote = await AvailabilityService.calculate_dynamic_quote(db, tenant.id, body.hall_id, body.start_time, addon_amount=body.addon_amount)
    event_code = f"EVT-{datetime.now(timezone.utc).year}-{str(uuid.uuid4().int % 10000).zfill(4)}"
    event = Event(
        tenant_id=tenant.id,
        hall_id=body.hall_id,
        primary_client_id=body.primary_client_id,
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
        tenant_id=tenant.id,
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
            invoice_id=invoice.id,
            title="48h Hold Confirmation Deposit (50%)",
            amount_due=(Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01")),
            due_date=datetime.utcnow() + timedelta(hours=48),
            status="PENDING",
        )
    )
    await db.commit()
    return {"event_id": str(event.id), "event_code": event.event_code, "status": "HOLD_48H", "quote": quote}
