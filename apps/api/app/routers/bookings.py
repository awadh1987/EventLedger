import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthContext, hash_password, require_roles
from app.models.accounting import DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import utcnow
from app.models.events import AuditLog, Event, EventStatus
from app.models.events_extensions import EventContract
from app.models.users import ClientCategory, ClientProfile, User, UserType
from app.models.venue import CateringMenuItem, Hall
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Tier 2: Reservation, Partition Merge & 48h Hold Engine"])


def _to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class PublicHoldBookingRequest(BaseModel):
    hall_id: uuid.UUID
    merge_combinable_hall: bool = False
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = Field(default=250, ge=10)
    catering_item_id: Optional[uuid.UUID] = None
    addon_amount: Decimal = Decimal("0.00")
    client_full_name: str = Field(..., min_length=2)
    client_phone: str = Field(..., min_length=7)
    client_email: Optional[str] = None
    client_category: ClientCategory = ClientCategory.INDIVIDUAL_B2C
    company_name: Optional[str] = None
    tax_id: Optional[str] = None


class UpdateEventStatusBody(BaseModel):
    status: EventStatus


async def _compute_addons(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    hall_id: uuid.UUID,
    guest_count: int,
    catering_item_id: Optional[uuid.UUID],
    merge_combinable_hall: bool,
) -> tuple[Decimal, Decimal]:
    catering_total = Decimal("0.00")
    if catering_item_id:
        cat_item = (
            await db.execute(
                select(CateringMenuItem).where(
                    CateringMenuItem.id == catering_item_id,
                    CateringMenuItem.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if cat_item:
            catering_total = (Decimal(str(cat_item.price_per_guest)) * Decimal(str(guest_count))).quantize(
                Decimal("0.01")
            )

    merged_hall_addon = Decimal("0.00")
    if merge_combinable_hall:
        primary_hall = (
            await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if primary_hall and primary_hall.combinable_with_hall_id:
            partner_hall = (
                await db.execute(
                    select(Hall).where(
                        Hall.id == primary_hall.combinable_with_hall_id,
                        Hall.tenant_id == tenant_id,
                    )
                )
            ).scalar_one_or_none()
            if partner_hall:
                merged_hall_addon = (Decimal(str(partner_hall.base_price)) * Decimal("0.85")).quantize(
                    Decimal("0.01")
                )

    return catering_total, merged_hall_addon


@router.get("/public/halls/availability")
async def get_public_availability_and_calendar(
    request: Request,
    hall_id: Optional[uuid.UUID] = Query(default=None),
    start_time: Optional[datetime] = Query(default=None),
    end_time: Optional[datetime] = Query(default=None),
    merge_combinable_hall: bool = Query(default=False),
    guest_count: int = Query(default=250, ge=10),
    catering_item_id: Optional[uuid.UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    halls = (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()
    upcoming = (
        await db.execute(
            select(Event)
            .where(
                Event.tenant_id == tenant.id,
                Event.status.in_([EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]),
            )
            .order_by(Event.start_time.asc())
        )
    ).scalars().all()

    calendar_blocks = [
        {
            "event_id": str(e.id),
            "event_code": e.event_code,
            "hall_id": str(e.hall_id),
            "event_type": e.event_type,
            "status": e.status.value,
            "start_time": e.start_time.isoformat(),
            "end_time": e.end_time.isoformat(),
            "guest_count": e.guest_count,
        }
        for e in upcoming
    ]

    if not hall_id or not start_time or not end_time:
        return {
            "halls": [{"id": str(h.id), "name": h.name, "name_ar": h.name_ar} for h in halls],
            "occupied_slots": calendar_blocks,
        }

    naive_start = _to_naive_utc(start_time)
    naive_end = _to_naive_utc(end_time)
    if naive_end <= naive_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, hall_id, naive_start, naive_end)
    catering_total, merged_hall_addon = await _compute_addons(
        db, tenant.id, hall_id, guest_count, catering_item_id, merge_combinable_hall
    )

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, tenant.id, hall_id, naive_start, addon_amount=catering_total + merged_hall_addon
    )
    quote["catering_total"] = float(catering_total)
    quote["merged_hall_addon"] = float(merged_hall_addon)

    return {"availability": avail, "quote": quote, "occupied_slots": calendar_blocks}


@router.post("/bookings/hold")
async def create_public_or_staff_48h_hold(
    body: PublicHoldBookingRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    naive_start = _to_naive_utc(body.start_time)
    naive_end = _to_naive_utc(body.end_time)
    if naive_end <= naive_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, body.hall_id, naive_start, naive_end)
    if not avail["available"]:
        raise HTTPException(
            status_code=409,
            detail={"message": "Hall schedule conflict detected", "conflicts": avail["conflicts"]},
        )

    clean_phone = body.client_phone.strip()
    clean_email = body.client_email.strip().lower() if body.client_email else None

    client_user = (
        await db.execute(select(User).where(User.tenant_id == tenant.id, User.phone == clean_phone))
    ).scalar_one_or_none()

    if not client_user:
        phone_conflict = (await db.execute(select(User.id).where(User.phone == clean_phone))).scalar_one_or_none()
        if phone_conflict:
            raise HTTPException(status_code=409, detail="Phone number is already registered in another workspace")
        if clean_email:
            email_conflict = (await db.execute(select(User.id).where(User.email == clean_email))).scalar_one_or_none()
            if email_conflict:
                raise HTTPException(status_code=409, detail="Email is already registered in another workspace")

        client_user = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_PRIMARY,
            email=clean_email,
            phone=clean_phone,
            password_hash=hash_password("Client@2026"),
            full_name=body.client_full_name.strip(),
            preferred_lang="ar",
        )
        db.add(client_user)
        await db.flush()
        db.add(
            ClientProfile(
                user_id=client_user.id,
                client_category=body.client_category,
                company_name=body.company_name,
                tax_id=body.tax_id,
            )
        )

    catering_total, merged_hall_addon = await _compute_addons(
        db, tenant.id, body.hall_id, body.guest_count, body.catering_item_id, body.merge_combinable_hall
    )

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, tenant.id, body.hall_id, naive_start, addon_amount=body.addon_amount + catering_total + merged_hall_addon
    )
    quote["catering_total"] = float(catering_total)
    quote["merged_hall_addon"] = float(merged_hall_addon)

    event_code = f"EVT-{datetime.now(timezone.utc).year}-{str(uuid.uuid4().int % 10000).zfill(4)}"
    hold_expires = utcnow() + timedelta(hours=48)
    event = Event(
        tenant_id=tenant.id,
        hall_id=body.hall_id,
        primary_client_id=client_user.id,
        event_code=event_code,
        event_type=body.event_type,
        start_time=naive_start,
        end_time=naive_end,
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
        deposit_status=DepositStatus.UNPAID,
        status=InvoiceStatus.ISSUED,
    )
    db.add(invoice)
    await db.flush()

    deposit_due = (Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01"))
    balance_due = Decimal(str(quote["total_amount"])) - deposit_due

    db.add_all(
        [
            PaymentMilestone(
                tenant_id=tenant.id,
                invoice_id=invoice.id,
                title="الدفعة الأولى لتأكيد الحجز (50%) / Booking Confirmation Deposit",
                amount_due=deposit_due,
                due_date=hold_expires,
                status="PENDING",
            ),
            PaymentMilestone(
                tenant_id=tenant.id,
                invoice_id=invoice.id,
                title="الدفعة النهائية قبل المناسبة (50%) / Final Balance",
                amount_due=balance_due,
                due_date=event.start_time - timedelta(days=7),
                status="PENDING",
            ),
        ]
    )

    db.add(
        EventContract(
            tenant_id=tenant.id,
            event_id=event.id,
            contract_number=f"CTR-{event_code}",
            terms_ar="يلتزم الطرف الثاني بسداد دفعة التأكيد خلال 48 ساعة لتثبيت الحجز نهائياً، ويُسترد مبلغ التأمين بعد فحص القاعة.",
            terms_en="Second Party agrees to pay the 50% confirmation deposit within 48 hours. Security deposit is refunded post-inspection.",
        )
    )

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            event_id=event.id,
            actor_id=client_user.id,
            action="HOLD_48H_CREATED",
            new_value={
                "event_code": event_code,
                "total_amount": quote["total_amount"],
                "merged_halls": body.merge_combinable_hall,
            },
        )
    )
    await db.commit()

    # Schedule Redis TTL + Celery 48h auto-expiry without blocking if broker is offline
    try:
        import redis.asyncio as aioredis
        from app.workers.celery_tasks import expire_unpaid_48h_hold

        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=0.2, socket_timeout=0.2)
        await r.setex(f"hold:event:{event.id}", 48 * 3600, event_code)
        await r.aclose()
        expire_unpaid_48h_hold.apply_async(args=[str(event.id)], countdown=48 * 3600, retry=False)
    except Exception:
        pass

    return {
        "event_id": str(event.id),
        "event_code": event.event_code,
        "client_id": str(client_user.id),
        "status": "HOLD_48H",
        "expires_in_hours": 48,
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
