import enum
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthContext, hash_password, require_roles
from app.models.accounting import DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import RecordLifecycle, utcnow
from app.models.events import AuditLog, Event, EventStatus
from app.models.events_extensions import EventContract
from app.models.users import ClientCategory, ClientProfile, User, UserType
from app.models.tenant import Tenant, TenantBranding
from app.models.venue import CateringMenuItem, Hall, InventoryItem, PricingRule
from app.routers.portal import save_milestone_receipt
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Tier 2: Reservation, Partition Merge & 48h Hold Engine"])


def _to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class PaymentMethodCode(str, enum.Enum):
    KURAIMI_BANK = "KURAIMI_BANK"
    JAIB_WALLET = "JAIB_WALLET"
    JAWALI_WALLET = "JAWALI_WALLET"
    ONECASH_WALLET = "ONECASH_WALLET"
    BANK_TRANSFER = "BANK_TRANSFER"
    PAY_LATER_48H = "PAY_LATER_48H"


class HoldAddonItem(BaseModel):
    item_id: uuid.UUID
    quantity: int = Field(default=1, ge=1)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0)


DEFAULT_PAYMENT_ACCOUNTS = [
    {"code": "KURAIMI_BANK", "labelAr": "بنك الكريمي", "labelEn": "Kuraimi Bank", "account": "301234567"},
    {"code": "JAIB_WALLET", "labelAr": "محفظة جيب", "labelEn": "Jaib Wallet", "account": "770000001"},
    {"code": "JAWALI_WALLET", "labelAr": "محفظة جوالي", "labelEn": "Jawali Wallet", "account": "770000002"},
    {"code": "ONECASH_WALLET", "labelAr": "ون كاش", "labelEn": "OneCash", "account": "770000003"},
]

# Public calendar slot windows (hour ranges, local naive time)
CALENDAR_SLOTS = {
    "MORNING_09_15": (9, 15),
    "EVENING_17_23": (17, 23),
    "FULL_DAY": (9, 23),
}


class PublicHoldBookingRequest(BaseModel):
    payment_mode: Literal["HOLD_48H", "IMMEDIATE_DEPOSIT"] = "HOLD_48H"
    transfer_reference: Optional[str] = Field(default=None, max_length=80)
    selected_payment_method: Optional[PaymentMethodCode] = None
    addons: list[HoldAddonItem] = Field(default_factory=list)
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
    addons_total = sum(
        (a.unit_price * Decimal(a.quantity) for a in body.addons), Decimal("0.00")
    ).quantize(Decimal("0.01"))
    pay_method = body.selected_payment_method.value if body.selected_payment_method else None
    immediate = body.payment_mode == "IMMEDIATE_DEPOSIT"
    transfer_ref = (body.transfer_reference or "").strip() or None
    if immediate:
        if not pay_method or pay_method == PaymentMethodCode.PAY_LATER_48H.value:
            raise HTTPException(
                status_code=400, detail="IMMEDIATE_DEPOSIT requires a real selected_payment_method"
            )
    elif not pay_method:
        pay_method = PaymentMethodCode.PAY_LATER_48H.value

    quote = await AvailabilityService.calculate_dynamic_quote(
        db,
        tenant.id,
        body.hall_id,
        naive_start,
        addon_amount=body.addon_amount + catering_total + merged_hall_addon + addons_total,
    )
    quote["catering_total"] = float(catering_total)
    quote["merged_hall_addon"] = float(merged_hall_addon)
    quote["addons_total"] = float(addons_total)

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

    milestones = [
        PaymentMilestone(
            tenant_id=tenant.id,
            invoice_id=invoice.id,
            title=(
                "الدفعة الأولى لتأكيد الحجز (50%) / Booking Confirmation Deposit"
                + (f" | Ref: {transfer_ref}" if immediate and transfer_ref else "")
            ),
            amount_due=deposit_due,
            due_date=hold_expires,
            payment_method=pay_method,
            status="UNDER_REVIEW" if immediate else "PENDING",
        ),
        PaymentMilestone(
            tenant_id=tenant.id,
            invoice_id=invoice.id,
            title="الدفعة النهائية قبل المناسبة (50%) / Final Balance",
            amount_due=balance_due,
            due_date=event.start_time - timedelta(days=7),
            payment_method=pay_method,
            status="PENDING",
        ),
    ]
    db.add_all(milestones)

    contract = EventContract(
        tenant_id=tenant.id,
        event_id=event.id,
        contract_number=f"CTR-{event_code}",
        terms_ar="يلتزم الطرف الثاني بسداد دفعة التأكيد خلال 48 ساعة لتثبيت الحجز نهائياً، ويُسترد مبلغ التأمين بعد فحص القاعة.",
        terms_en="Second Party agrees to pay the 50% confirmation deposit within 48 hours. Security deposit is refunded post-inspection.",
    )
    db.add(contract)
    await db.flush()

    milestones_out = [
        {
            "id": str(m.id),
            "title": m.title,
            "amount_due": float(m.amount_due),
            "due_date": m.due_date.isoformat(),
            "payment_method": m.payment_method,
            "status": m.status,
        }
        for m in milestones
    ]
    invoice_out = {
        "id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
        "subtotal": float(invoice.subtotal),
        "tax_amount": float(invoice.tax_amount),
        "total_amount": float(invoice.total_amount),
        "security_deposit_amount": float(invoice.security_deposit_amount),
        "status": invoice.status.value,
    }
    contract_out = {
        "id": str(contract.id),
        "contract_number": contract.contract_number,
        "terms_ar": contract.terms_ar,
        "terms_en": contract.terms_en,
    }
    payment_accounts = tenant.payment_accounts or DEFAULT_PAYMENT_ACCOUNTS

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
                "selected_payment_method": pay_method,
                "payment_mode": body.payment_mode,
                "catering_item_id": str(body.catering_item_id) if body.catering_item_id else None, "transfer_reference": transfer_ref,
                "addons": [
                    {"item_id": str(a.item_id), "quantity": a.quantity, "unit_price": float(a.unit_price)}
                    for a in body.addons
                ],
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
        "booking": {
            "event_id": str(event.id),
            "event_code": event.event_code,
            "hall_id": str(event.hall_id),
            "event_type": event.event_type,
            "status": "HOLD_48H",
            "start_time": naive_start.isoformat(),
            "end_time": naive_end.isoformat(),
            "guest_count": event.guest_count,
            "selected_payment_method": pay_method,
        },
        "invoice": invoice_out,
        "milestones": milestones_out,
        "contract": contract_out,
        "payment_accounts": payment_accounts,
    }


def _slot_busy(day: date, slot: tuple[int, int], ev_start: datetime, ev_end: datetime) -> bool:
    s = datetime.combine(day, time(slot[0]))
    e = datetime.combine(day, time(slot[1]))
    return s < ev_end and e > ev_start


@router.get("/public/calendar/three-month")
async def get_three_month_calendar(
    tenant_slug: Optional[str] = Query(default=None),
    hall_id: Optional[uuid.UUID] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    months: int = Query(default=3, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    first_day = start_date or datetime.now(timezone.utc).date()
    total_days = 30 * months
    last_day = first_day + timedelta(days=total_days - 1)
    win_start = datetime.combine(first_day, time.min)
    win_end = datetime.combine(last_day + timedelta(days=1), time.min)

    tq = select(Tenant).where(Tenant.is_active == True)  # noqa: E712
    if tenant_slug:
        tq = tq.where(Tenant.slug == tenant_slug.strip().lower())
    tenants = (await db.execute(tq.order_by(Tenant.name))).scalars().all()
    if tenant_slug and not tenants:
        raise HTTPException(status_code=404, detail="Venue workspace not found or inactive")
    tenant_ids = [t.id for t in tenants]

    halls, brandings, rules, events = [], {}, [], []
    if tenant_ids:
        hq = select(Hall).where(Hall.tenant_id.in_(tenant_ids))
        if hall_id:
            hq = hq.where(Hall.id == hall_id)
        halls = (await db.execute(hq)).scalars().all()
        brandings = {
            b.tenant_id: b
            for b in (
                await db.execute(select(TenantBranding).where(TenantBranding.tenant_id.in_(tenant_ids)))
            ).scalars().all()
        }
        rules = (
            await db.execute(
                select(PricingRule).where(
                    PricingRule.tenant_id.in_(tenant_ids),
                    PricingRule.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all()
        events = (
            await db.execute(
                select(Event).where(
                    Event.tenant_id.in_(tenant_ids),
                    Event.status.in_(AvailabilityService.BLOCKING_STATUSES),
                    Event.end_time > win_start - timedelta(days=1),
                    Event.start_time < win_end + timedelta(days=1),
                )
            )
        ).scalars().all()

    catering_by_tenant: dict[uuid.UUID, list[CateringMenuItem]] = {}
    addons_by_tenant: dict[uuid.UUID, list[InventoryItem]] = {}
    if tenant_ids:
        for c in (
            await db.execute(
                select(CateringMenuItem).where(
                    CateringMenuItem.tenant_id.in_(tenant_ids),
                    CateringMenuItem.lifecycle == RecordLifecycle.ACTIVE,
                )
            )
        ).scalars().all():
            catering_by_tenant.setdefault(c.tenant_id, []).append(c)
        for a in (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.tenant_id.in_(tenant_ids),
                    InventoryItem.lifecycle == RecordLifecycle.ACTIVE,
                    InventoryItem.unit_addon_price > 0,
                )
            )
        ).scalars().all():
            addons_by_tenant.setdefault(a.tenant_id, []).append(a)

    all_halls = {h.id: h for h in halls}
    # Combinable partners block each other; include them even when hall_id filter applied.
    partner_of: dict[uuid.UUID, set[uuid.UUID]] = {h.id: set() for h in halls}
    for h in halls:
        if h.combinable_with_hall_id:
            partner_of[h.id].add(h.combinable_with_hall_id)
        for o in halls:
            if o.combinable_with_hall_id == h.id:
                partner_of[h.id].add(o.id)

    events_by_hall: dict[uuid.UUID, list[Event]] = {}
    for ev in events:
        events_by_hall.setdefault(ev.hall_id, []).append(ev)

    days_out: dict[str, list[dict]] = {}
    for h in halls:
        buf = timedelta(minutes=h.cleaning_buffer_minutes or 0)
        relevant = list(events_by_hall.get(h.id, []))
        for pid in partner_of[h.id]:
            relevant.extend(events_by_hall.get(pid, []))
        hall_rules = [r for r in rules if r.tenant_id == h.tenant_id and (r.hall_id is None or r.hall_id == h.id)]

        entries = []
        for i in range(total_days):
            day = first_day + timedelta(days=i)
            day_start = datetime.combine(day, time.min)
            day_end = day_start + timedelta(days=1)
            sun_dow = (day.weekday() + 1) % 7

            multiplier = Decimal("1.00")
            for r in hall_rules:
                if r.days_of_week and sun_dow not in r.days_of_week:
                    continue
                if r.start_date and day < r.start_date.date():
                    continue
                if r.end_date and day > r.end_date.date():
                    continue
                multiplier *= Decimal(str(r.multiplier))
            dynamic_price = (Decimal(str(h.base_price)) * multiplier).quantize(Decimal("0.01"))

            day_events = [ev for ev in relevant if ev.start_time < day_end and ev.end_time > day_start]
            occupied = []
            busy_slots: set[str] = set()
            has_hold = False
            has_firm = False
            for ev in day_events:
                is_hold = ev.status == EventStatus.HOLD_48H
                has_hold = has_hold or is_hold
                has_firm = has_firm or not is_hold
                for name, rng in CALENDAR_SLOTS.items():
                    if _slot_busy(day, rng, ev.start_time - buf, ev.end_time + buf):
                        busy_slots.add(name)
                occupied.append(
                    {
                        "hall_id": str(ev.hall_id),
                        "public_status": "TENTATIVE_HOLD" if is_hold else "BOOKED",
                        "start_time": max(ev.start_time, day_start).isoformat(),
                        "end_time": min(ev.end_time, day_end).isoformat(),
                    }
                )

            if "FULL_DAY" not in busy_slots and not (
                {"MORNING_09_15", "EVENING_17_23"} & busy_slots
            ):
                free = ["MORNING_09_15", "EVENING_17_23", "FULL_DAY"]
            else:
                free = [s for s in ("MORNING_09_15", "EVENING_17_23") if s not in busy_slots]

            if not free:
                status = "HOLD_48H" if has_hold and not has_firm else "UNAVAILABLE"
            elif has_hold:
                status = "HOLD_48H"
            else:
                status = "AVAILABLE"

            entries.append(
                {
                    "date": day.isoformat(),
                    "status": status,
                    "dynamic_price": float(dynamic_price),
                    "multiplier": float(multiplier),
                    "occupied_events": occupied,
                    "available_slots": free,
                }
            )
        days_out[str(h.id)] = entries

    halls_by_tenant: dict[uuid.UUID, list[Hall]] = {}
    for h in all_halls.values():
        halls_by_tenant.setdefault(h.tenant_id, []).append(h)

    def _branding(t: Tenant) -> dict:
        b = brandings.get(t.id)
        return {
            "primaryColor": b.primary_color if b else "#D4AF37",
            "accentColor": b.accent_color if b else "#0F172A",
            "logoLightUrl": b.logo_light_url if b else None,
            "logoDarkUrl": b.logo_dark_url if b else None,
        }

    return {
        "start_date": first_day.isoformat(),
        "end_date": last_day.isoformat(),
        "months": months,
        "tenants": [
            {
                "id": str(t.id),
                "name": t.name,
                "slug": t.slug,
                "currency": t.currency,
                "branding": _branding(t),
                "tax_rate": float(t.tax_rate),
                "default_security_deposit": float((t.settings or {}).get("defaultSecurityDeposit", 0)),
                "payment_accounts": t.payment_accounts or DEFAULT_PAYMENT_ACCOUNTS,
                "catering_items": [
                    {
                        "id": str(c.id),
                        "name_ar": c.name_ar,
                        "name_en": c.name_en,
                        "price_per_guest": float(c.price_per_guest),
                    }
                    for c in catering_by_tenant.get(t.id, [])
                ],
                "addon_items": [
                    {
                        "id": str(a.id),
                        "name": a.name,
                        "category": a.category,
                        "total_stock": a.total_stock,
                        "unit_addon_price": float(a.unit_addon_price),
                    }
                    for a in addons_by_tenant.get(t.id, [])
                ],
                "halls": [
                    {
                        "id": str(h.id),
                        "name": h.name,
                        "name_ar": h.name_ar,
                        "capacity_banquet": h.capacity_banquet,
                        "capacity_theater": h.capacity_theater,
                        "base_price": float(h.base_price),
                        "combinable_with_hall_id": str(h.combinable_with_hall_id)
                        if h.combinable_with_hall_id
                        else None,
                        "cleaning_buffer_minutes": h.cleaning_buffer_minutes,
                    }
                    for h in halls_by_tenant.get(t.id, [])
                ],
            }
            for t in tenants
        ],
        "days": days_out,
    }


@router.post("/public/milestones/{milestone_id}/receipt")
async def upload_public_milestone_receipt(
    milestone_id: uuid.UUID,
    request: Request,
    receipt: UploadFile = File(...),
    payment_method: Optional[str] = Form(default=None),
    transfer_reference: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Unauthenticated receipt upload for a milestone just created by POST /bookings/hold."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    milestone = (
        await db.execute(
            select(PaymentMilestone).where(
                PaymentMilestone.id == milestone_id, PaymentMilestone.tenant_id == tenant.id
            )
        )
    ).scalar_one_or_none()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    if milestone.status not in ("PENDING", "UNDER_REVIEW"):
        raise HTTPException(status_code=409, detail="Milestone no longer accepts receipts")
    client_id = (
        await db.execute(
            select(Event.primary_client_id)
            .join(Invoice, Invoice.event_id == Event.id)
            .where(Invoice.id == milestone.invoice_id)
        )
    ).scalar_one_or_none()
    return await save_milestone_receipt(db, milestone, receipt, payment_method, transfer_reference, client_id)


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
