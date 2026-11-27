import enum
import secrets
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.tenant_middleware import resolve_active_tenant_by_slug
from app.core.security import (
    AuthContext,
    create_access_token,
    create_receipt_upload_token,
    get_optional_auth,
    hash_password,
    require_roles,
    verify_password,
    verify_receipt_upload_token,
)
from app.models.accounting import DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import RecordLifecycle, utcnow
from app.models.events import AuditLog, DraftStatus, DraftType, Event, EventDraft, EventStatus
from app.models.events_extensions import EventContract, EventSecurityProfile
from app.models.tenant import Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, StaffRole, User, UserType
from app.models.venue import CateringMenuItem, EventInventoryAllocation, Hall, InventoryItem, PricingRule
from app.routers.portal import save_milestone_receipt
from app.services.accounting_service import DoubleEntryService
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
    unit_price: Optional[Decimal] = Field(default=None, ge=0)


class CustomCateringInput(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    price_per_guest: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class CustomAddonInput(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    quantity: int = Field(default=1, ge=1)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


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
    hall_ids: list[uuid.UUID] = Field(default_factory=list)
    merge_combinable_hall: bool = False
    event_title: Optional[str] = Field(default=None, max_length=255)
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = Field(default=250, ge=10)
    catering_item_id: Optional[uuid.UUID] = None
    catering_guest_count: Optional[int] = Field(default=None, ge=0)
    catering_notes: Optional[str] = Field(default=None, max_length=500)
    custom_catering: Optional[CustomCateringInput] = None
    custom_addons: list[CustomAddonInput] = Field(default_factory=list)
    offer_id: Optional[str] = None
    addon_amount: Decimal = Decimal("0.00")
    client_full_name: str = Field(..., min_length=2)
    client_phone: str = Field(..., min_length=7)
    client_email: Optional[str] = None
    client_password: Optional[str] = Field(default=None, min_length=8)
    client_auth_mode: Literal["REGISTER", "LOGIN", "GUEST_AUTO"] = "GUEST_AUTO"
    client_category: ClientCategory = ClientCategory.INDIVIDUAL_B2C
    company_name: Optional[str] = None
    tax_id: Optional[str] = None


class UpdateEventStatusBody(BaseModel):
    status: EventStatus


class UpdateEventDetailsBody(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    event_type: Optional[str] = Field(default=None, max_length=50)
    guest_count: Optional[int] = Field(default=None, ge=1)
    remarks: Optional[str] = Field(default=None, max_length=500)


async def _compute_addons(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    hall_id: uuid.UUID,
    guest_count: int,
    catering_item_id: Optional[uuid.UUID],
    merge_combinable_hall: bool,
    hall_ids: Optional[list[uuid.UUID]] = None,
) -> tuple[Decimal, Decimal, list[dict]]:
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
    additional_halls: list[dict] = []
    if merge_combinable_hall or (hall_ids and any(hid != hall_id for hid in hall_ids)):
        requested_halls = await AvailabilityService.resolve_requested_halls(
            db,
            tenant_id,
            hall_id,
            hall_ids=hall_ids,
            merge_combinable_hall=merge_combinable_hall,
        )
        for extra_hall in requested_halls[1:]:
            eh_price = (Decimal(str(extra_hall.base_price)) * Decimal("0.85")).quantize(Decimal("0.01"))
            merged_hall_addon += eh_price
            additional_halls.append(
                {
                    "hall_id": str(extra_hall.id),
                    "name": extra_hall.name,
                    "name_ar": extra_hall.name_ar,
                    "label_en": f"{extra_hall.name} (Combined Hall)",
                    "label_ar": f"{extra_hall.name_ar} (قاعة مدمجة)",
                    "quantity": 1,
                    "unit_price": float(eh_price),
                    "total": float(eh_price),
                }
            )

    return catering_total, merged_hall_addon, additional_halls


@router.get("/public/halls/availability")
async def get_public_availability_and_calendar(
    request: Request,
    hall_id: Optional[uuid.UUID] = Query(default=None),
    hall_ids: Optional[str] = Query(default=None),
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

    halls = (
        await db.execute(select(Hall).where(Hall.tenant_id == tenant.id, Hall.lifecycle == RecordLifecycle.ACTIVE))
    ).scalars().all()
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
    ev_halls_map = await AvailabilityService.load_event_hall_ids_map(db, tenant.id, upcoming, halls)

    calendar_blocks = [
        {
            "event_id": str(e.id),
            "event_code": e.event_code,
            "hall_id": str(e.hall_id),
            "hall_ids": [str(hid) for hid in ev_halls_map.get(e.id, [e.hall_id])],
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
    AvailabilityService.validate_booking_horizon(naive_start, naive_end)

    parsed_hall_ids: list[uuid.UUID] = []
    if hall_ids and hall_ids.strip():
        for part in hall_ids.split(","):
            clean_p = part.strip()
            if clean_p:
                try:
                    parsed_hall_ids.append(uuid.UUID(clean_p))
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=f"Invalid hall UUID in hall_ids: {clean_p}") from exc

    avail = await AvailabilityService.check_hall_availability(
        db,
        tenant.id,
        hall_id,
        naive_start,
        naive_end,
        hall_ids=parsed_hall_ids or None,
        merge_combinable_hall=merge_combinable_hall,
    )
    catering_total, merged_hall_addon, additional_halls = await _compute_addons(
        db,
        tenant.id,
        hall_id,
        guest_count,
        catering_item_id,
        merge_combinable_hall,
        hall_ids=parsed_hall_ids or None,
    )

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, tenant.id, hall_id, naive_start, addon_amount=catering_total + merged_hall_addon
    )
    quote["catering_total"] = float(catering_total)
    quote["merged_hall_addon"] = float(merged_hall_addon)
    quote["additional_halls"] = additional_halls

    return {"availability": avail, "quote": quote, "occupied_slots": calendar_blocks}


@router.post("/bookings/hold")
async def create_public_or_staff_48h_hold(
    body: PublicHoldBookingRequest,
    request: Request,
    opt_auth: Optional[AuthContext] = Depends(get_optional_auth),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    naive_start = _to_naive_utc(body.start_time)
    naive_end = _to_naive_utc(body.end_time)
    AvailabilityService.validate_booking_horizon(naive_start, naive_end)

    requested_halls = await AvailabilityService.resolve_requested_halls(
        db,
        tenant.id,
        body.hall_id,
        hall_ids=body.hall_ids or None,
        merge_combinable_hall=body.merge_combinable_hall,
    )
    requested_hall_ids = [h.id for h in requested_halls]
    hall_row = requested_halls[0]

    # Lock all requested hall rows in deterministic order to serialize concurrent single/multi-hall bookings
    await db.execute(
        select(Hall.id)
        .where(Hall.id.in_(sorted(requested_hall_ids)), Hall.tenant_id == tenant.id)
        .order_by(Hall.id)
        .with_for_update()
    )

    avail = await AvailabilityService.check_hall_availability(
        db,
        tenant.id,
        body.hall_id,
        naive_start,
        naive_end,
        hall_ids=requested_hall_ids,
        merge_combinable_hall=body.merge_combinable_hall,
    )
    if not avail["available"]:
        raise HTTPException(
            status_code=409,
            detail={"message": "Hall schedule conflict detected", "conflicts": avail["conflicts"]},
        )

    clean_phone = body.client_phone.strip()
    clean_email = body.client_email.strip().lower() if body.client_email else None

    client_user: Optional[User] = None
    issued_token: Optional[str] = None

    if (
        opt_auth is not None
        and opt_auth.user.tenant_id == tenant.id
        and opt_auth.user.user_type in (UserType.CLIENT_PRIMARY, UserType.CLIENT_DELEGATE)
    ):
        client_user = opt_auth.user
        client_user.last_login_at = utcnow()
        issued_token = create_access_token(client_user.id, tenant.id, client_user.user_type, None)

    if not client_user:
        client_user = (
            await db.execute(select(User).where(User.tenant_id == tenant.id, User.phone == clean_phone))
        ).scalar_one_or_none()
    if not client_user and clean_email:
        client_user = (
            await db.execute(select(User).where(User.tenant_id == tenant.id, User.email == clean_email))
        ).scalar_one_or_none()

    if client_user:
        if not issued_token:
            if body.client_auth_mode == "LOGIN":
                if not body.client_password or not verify_password(body.client_password, client_user.password_hash):
                    raise HTTPException(status_code=401, detail="Invalid password for this account")
                client_user.last_login_at = utcnow()
                issued_token = create_access_token(client_user.id, tenant.id, client_user.user_type, None)
            elif body.client_password:
                if verify_password(body.client_password, client_user.password_hash):
                    client_user.last_login_at = utcnow()
                    issued_token = create_access_token(client_user.id, tenant.id, client_user.user_type, None)
                elif body.client_auth_mode == "REGISTER":
                    raise HTTPException(
                        status_code=401,
                        detail="An account with this phone or email already exists in this venue. Please sign in as a returning client.",
                    )
    else:
        resolved_pw_hash: Optional[str] = None
        src_profile: Optional[ClientProfile] = None
        if body.client_auth_mode == "LOGIN":
            if not body.client_password:
                raise HTTPException(status_code=401, detail="Password is required for returning client sign in")
            ident_filters = [User.phone == clean_phone]
            if clean_email:
                ident_filters.append(User.email == clean_email)
            other_clients = (
                await db.execute(
                    select(User).where(
                        User.user_type.in_([UserType.CLIENT_PRIMARY, UserType.CLIENT_DELEGATE]),
                        or_(*ident_filters),
                        User.is_active == True,  # noqa: E712
                    )
                )
            ).scalars().all()
            matched_cand = next(
                (c for c in other_clients if verify_password(body.client_password, c.password_hash)), None
            )
            if not matched_cand:
                raise HTTPException(status_code=401, detail="Account not found or invalid password")
            resolved_pw_hash = matched_cand.password_hash
            src_profile = (
                await db.execute(select(ClientProfile).where(ClientProfile.user_id == matched_cand.id))
            ).scalar_one_or_none()
        elif body.client_password:
            resolved_pw_hash = hash_password(body.client_password)
        else:
            resolved_pw_hash = hash_password(secrets.token_urlsafe(24))

        client_user = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_PRIMARY,
            email=clean_email,
            phone=clean_phone,
            password_hash=resolved_pw_hash,
            full_name=body.client_full_name.strip(),
            preferred_lang="ar",
            last_login_at=utcnow() if body.client_password else None,
        )
        db.add(client_user)
        await db.flush()
        db.add(
            ClientProfile(
                user_id=client_user.id,
                client_category=body.client_category if not src_profile else src_profile.client_category,
                company_name=body.company_name or (src_profile.company_name if src_profile else None),
                tax_id=body.tax_id or (src_profile.tax_id if src_profile else None),
                national_id_or_cr=src_profile.national_id_or_cr if src_profile else None,
                billing_address=src_profile.billing_address if src_profile else None,
                refund_bank_details=src_profile.refund_bank_details if src_profile else None,
            )
        )
        if body.client_password:
            issued_token = create_access_token(client_user.id, tenant.id, client_user.user_type, None)

    effective_cat_guests = body.catering_guest_count if body.catering_guest_count is not None else body.guest_count
    selected_cat_item: Optional[CateringMenuItem] = None
    catering_total = Decimal("0.00")
    if body.catering_item_id:
        selected_cat_item = (
            await db.execute(
                select(CateringMenuItem).where(
                    CateringMenuItem.id == body.catering_item_id,
                    CateringMenuItem.tenant_id == tenant.id,
                    CateringMenuItem.lifecycle == RecordLifecycle.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if not selected_cat_item:
            raise HTTPException(status_code=404, detail="Selected catering package not found or inactive")
        catering_total = (Decimal(str(selected_cat_item.price_per_guest)) * Decimal(str(effective_cat_guests))).quantize(
            Decimal("0.01")
        )
    elif body.custom_catering:
        catering_total = (
            Decimal(str(body.custom_catering.price_per_guest)) * Decimal(str(effective_cat_guests))
        ).quantize(Decimal("0.01"))

    _, merged_hall_addon, additional_halls = await _compute_addons(
        db,
        tenant.id,
        body.hall_id,
        body.guest_count,
        None,
        body.merge_combinable_hall,
        hall_ids=requested_hall_ids,
    )

    # Enforce DB-authoritative pricing for addons and validate stock
    addons_total = Decimal("0.00")
    verified_addons: list[tuple[InventoryItem, int, Decimal]] = []
    for a in body.addons:
        inv_item = (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.id == a.item_id,
                    InventoryItem.tenant_id == tenant.id,
                    InventoryItem.lifecycle == RecordLifecycle.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if not inv_item:
            raise HTTPException(status_code=404, detail=f"Addon inventory item {a.item_id} not found")
        if a.quantity > inv_item.total_stock:
            raise HTTPException(
                status_code=400,
                detail=f"Requested quantity ({a.quantity}) exceeds total stock ({inv_item.total_stock}) for {inv_item.name}",
            )
        db_unit_price = Decimal(str(inv_item.unit_addon_price)).quantize(Decimal("0.01"))
        addons_total += (db_unit_price * Decimal(a.quantity)).quantize(Decimal("0.01"))
        verified_addons.append((inv_item, a.quantity, db_unit_price))

    custom_addons_total = Decimal("0.00")
    normalized_custom_addons: list[dict] = []
    for ca in body.custom_addons:
        unit_p = Decimal(str(ca.unit_price)).quantize(Decimal("0.01"))
        line_t = (unit_p * Decimal(ca.quantity)).quantize(Decimal("0.01"))
        custom_addons_total += line_t
        normalized_custom_addons.append(
            {
                "title": ca.title.strip(),
                "quantity": ca.quantity,
                "unit_price": float(unit_p),
                "line_total": float(line_t),
                "notes": ca.notes.strip() if ca.notes else None,
                "is_custom_other": True,
            }
        )
    total_addons_amount = addons_total + custom_addons_total

    # Apply valid tenant storefront offer discount if offer_id provided
    discount_amount = Decimal("0.00")
    if body.offer_id:
        offers = (tenant.settings or {}).get("storefront_offers") or []
        matched_offer = next((o for o in offers if str(o.get("id")) == str(body.offer_id)), None)
        if not matched_offer:
            raise HTTPException(status_code=400, detail="Invalid promotional offer_id")
        disc_pct = Decimal(str(matched_offer.get("discount_percent") or 0))
        if disc_pct > Decimal("0.00"):
            pre_disc = await AvailabilityService.calculate_dynamic_quote(
                db,
                tenant.id,
                body.hall_id,
                naive_start,
                addon_amount=catering_total + merged_hall_addon + total_addons_amount,
                discount_amount=Decimal("0.00"),
            )
            discount_amount = (Decimal(str(pre_disc["subtotal"])) * (disc_pct / Decimal("100.00"))).quantize(
                Decimal("0.01")
            )

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
        addon_amount=catering_total + merged_hall_addon + total_addons_amount,
        discount_amount=discount_amount,
    )
    quote["catering_total"] = float(catering_total)
    quote["merged_hall_addon"] = float(merged_hall_addon)
    quote["addons_total"] = float(total_addons_amount)
    quote["discount_amount"] = float(discount_amount)
    quote["additional_halls"] = additional_halls

    primary_adjusted = (
        Decimal(str(quote["base_price"])) * Decimal(str(quote["effective_multiplier"]))
    ).quantize(Decimal("0.01"))
    line_items_payload = {
        "hall_ids": [str(h.id) for h in requested_halls],
        "hall": {
            "hall_id": str(hall_row.id),
            "name": hall_row.name,
            "name_ar": hall_row.name_ar,
            "label_en": hall_row.name,
            "label_ar": hall_row.name_ar,
            "quantity": 1,
            "unit_price": float(primary_adjusted),
            "total": float(primary_adjusted),
            "base_price": quote["base_price"],
            "effective_multiplier": quote["effective_multiplier"],
        },
        "additional_halls": additional_halls,
        "merged_hall_addon": float(merged_hall_addon),
        "catering": (
            {
                "catering_item_id": str(selected_cat_item.id),
                "name_ar": selected_cat_item.name_ar,
                "name_en": selected_cat_item.name_en,
                "price_per_guest": float(selected_cat_item.price_per_guest),
                "servings": effective_cat_guests,
                "line_total": float(catering_total),
                "notes": body.catering_notes.strip() if body.catering_notes else None,
                "is_custom_other": False,
            }
            if selected_cat_item
            else (
                {
                    "catering_item_id": None,
                    "title": body.custom_catering.title.strip(),
                    "price_per_guest": float(Decimal(str(body.custom_catering.price_per_guest)).quantize(Decimal("0.01"))),
                    "servings": effective_cat_guests,
                    "line_total": float(catering_total),
                    "notes": body.custom_catering.notes.strip()
                    if body.custom_catering.notes
                    else (body.catering_notes.strip() if body.catering_notes else None),
                    "is_custom_other": True,
                }
                if body.custom_catering
                else None
            )
        ),
        "addons": [
            {
                "item_id": str(item.id),
                "name": item.name,
                "category": item.category,
                "quantity": q_res,
                "unit_price": float(unit_p),
                "line_total": float((unit_p * Decimal(q_res)).quantize(Decimal("0.01"))),
            }
            for item, q_res, unit_p in verified_addons
        ],
        "custom_addons": normalized_custom_addons,
        "offer_id": body.offer_id,
    }

    seq_year = utcnow().year
    event_code = await DoubleEntryService.next_sequence_number(db, tenant.id, "EVT", seq_year)
    invoice_number = await DoubleEntryService.next_sequence_number(db, tenant.id, "INV", seq_year)
    hold_expires = utcnow() + timedelta(hours=48)
    event = Event(
        tenant_id=tenant.id,
        hall_id=body.hall_id,
        primary_client_id=client_user.id,
        event_code=event_code,
        title=body.event_title.strip() if body.event_title and body.event_title.strip() else None,
        event_type=body.event_type,
        start_time=naive_start,
        end_time=naive_end,
        status=EventStatus.HOLD_48H,
        guest_count=body.guest_count,
    )
    db.add(event)
    await db.flush()

    for inv_item, qty_res, _ in verified_addons:
        db.add(
            EventInventoryAllocation(
                tenant_id=tenant.id,
                event_id=event.id,
                item_id=inv_item.id,
                quantity_reserved=qty_res,
            )
        )

    invoice = Invoice(
        tenant_id=tenant.id,
        event_id=event.id,
        invoice_number=invoice_number,
        subtotal=Decimal(str(quote["subtotal"])),
        discount_amount=discount_amount,
        tax_amount=Decimal(str(quote["tax_amount"])),
        total_amount=Decimal(str(quote["total_amount"])),
        security_deposit_amount=Decimal(str(quote["security_deposit_amount"])),
        deposit_status=DepositStatus.UNPAID,
        status=InvoiceStatus.ISSUED,
        line_items_json=line_items_payload,
    )
    db.add(invoice)
    await db.flush()
    db.add(
        EventDraft(
            tenant_id=tenant.id,
            event_id=event.id,
            created_by_id=client_user.id,
            version_number=1,
            draft_type=DraftType.PACKAGE_QUOTE,
            payload=line_items_payload,
            financial_delta=Decimal("0.00"),
            status=DraftStatus.APPROVED_SYNCED,
        )
    )

    deposit_due = (Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01"))
    balance_due = Decimal(str(quote["total_amount"])) - deposit_due
    final_due_date = max(hold_expires + timedelta(minutes=1), event.start_time - timedelta(days=7))

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
            is_security_deposit=False,
            upload_token_jti=uuid.uuid4().hex,
            status="UNDER_REVIEW" if immediate else "PENDING",
        ),
        PaymentMilestone(
            tenant_id=tenant.id,
            invoice_id=invoice.id,
            title="الدفعة النهائية قبل المناسبة (50%) / Final Balance",
            amount_due=balance_due,
            due_date=final_due_date,
            payment_method=pay_method,
            is_security_deposit=False,
            upload_token_jti=uuid.uuid4().hex,
            status="PENDING",
        ),
    ]
    sec_dep_amt = Decimal(str(quote["security_deposit_amount"])).quantize(Decimal("0.01"))
    if sec_dep_amt > Decimal("0.00"):
        milestones.append(
            PaymentMilestone(
                tenant_id=tenant.id,
                invoice_id=invoice.id,
                title="تأمين الأضرار المسترد (أمانة 2100) / Refundable Security Deposit",
                amount_due=sec_dep_amt,
                due_date=final_due_date + timedelta(seconds=1),
                payment_method=pay_method,
                is_security_deposit=True,
                upload_token_jti=uuid.uuid4().hex,
                status="PENDING",
            )
        )
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

    # Post immediate Invoice Accrual in GL within the exact same ACID transaction
    hall_and_addons_net = Decimal(str(quote["subtotal"])) - catering_total
    if hall_and_addons_net < Decimal("0.00"):
        catering_net = Decimal(str(quote["subtotal"]))
        hall_and_addons_net = Decimal("0.00")
    else:
        catering_net = catering_total
    await DoubleEntryService.post_invoice_accrual(
        db=db,
        tenant_id=tenant.id,
        created_by_id=client_user.id,
        invoice=invoice,
        hall_and_addons_net=hall_and_addons_net,
        catering_net=catering_net,
        event_code=event_code,
    )

    milestones_out = [
        {
            "id": str(m.id),
            "title": m.title,
            "amount_due": float(m.amount_due),
            "due_date": m.due_date.isoformat(),
            "payment_method": m.payment_method,
            "is_security_deposit": m.is_security_deposit,
            "status": m.status,
            "upload_token": create_receipt_upload_token(tenant.id, m.id, m.upload_token_jti)
            if m.upload_token_jti
            else None,
        }
        for m in milestones
    ]
    invoice_out = {
        "id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
        "subtotal": float(invoice.subtotal),
        "discount_amount": float(invoice.discount_amount),
        "tax_amount": float(invoice.tax_amount),
        "total_amount": float(invoice.total_amount),
        "security_deposit_amount": float(invoice.security_deposit_amount),
        "status": invoice.status.value,
        "line_items": line_items_payload,
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
                "invoice_number": invoice_number,
                "total_amount": quote["total_amount"],
                "hall_ids": [str(h.id) for h in requested_halls],
                "merged_halls": body.merge_combinable_hall or len(requested_halls) > 1,
                "selected_payment_method": pay_method,
                "payment_mode": body.payment_mode,
                "catering_item_id": str(body.catering_item_id) if body.catering_item_id else None,
                "custom_catering": line_items_payload["catering"],
                "transfer_reference": transfer_ref,
                "addons": [
                    {"item_id": str(item.id), "quantity": q_res, "unit_price": float(unit_p)}
                    for item, q_res, unit_p in verified_addons
                ],
                "custom_addons": normalized_custom_addons,
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
        "title": event.title,
        "client_id": str(client_user.id),
        "status": "HOLD_48H",
        "portal_auth_hint": "AUTHENTICATED" if issued_token else "OTP_LOGIN_REQUIRED",
        "access_token": issued_token,
        "user": (
            {
                "id": str(client_user.id),
                "tenant_id": str(tenant.id),
                "tenant_slug": tenant.slug,
                "full_name": client_user.full_name,
                "email": client_user.email,
                "phone": client_user.phone,
                "user_type": client_user.user_type.value,
                "staff_role": None,
                "preferred_lang": client_user.preferred_lang,
                "is_2fa_enabled": client_user.is_2fa_enabled,
            }
            if issued_token
            else None
        ),
        "expires_in_hours": 48,
        "hold_expires_at": hold_expires.isoformat(),
        "hall_ids": [str(h.id) for h in requested_halls],
        "quote": quote,
        "booking": {
            "event_id": str(event.id),
            "event_code": event.event_code,
            "title": event.title,
            "hall_id": str(event.hall_id),
            "hall_ids": [str(h.id) for h in requested_halls],
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
    today_utc = datetime.now(timezone.utc).date()
    min_cal_date = date(today_utc.year, today_utc.month, 1)
    max_cal_date = AvailabilityService.add_calendar_months(today_utc, AvailabilityService.MAX_BOOKING_HORIZON_MONTHS)
    first_day = start_date or today_utc
    if start_date and (start_date < min_cal_date or start_date > max_cal_date):
        raise HTTPException(
            status_code=400,
            detail="Requested calendar start_date is outside the 5-year (60-month) booking window",
        )
    total_days = 30 * months
    last_day = first_day + timedelta(days=total_days - 1)
    win_start = datetime.combine(first_day, time.min)
    win_end = datetime.combine(last_day + timedelta(days=1), time.min)

    if tenant_slug:
        resolved = await resolve_active_tenant_by_slug(db, tenant_slug)
        if not resolved:
            raise HTTPException(status_code=404, detail="Venue workspace not found or inactive")
        tenants = [resolved]
    else:
        tenants = (await db.execute(select(Tenant).where(Tenant.is_active == True).order_by(Tenant.name))).scalars().all()  # noqa: E712
    tenant_ids = [t.id for t in tenants]

    all_tenant_halls, halls, brandings, rules, events = [], [], {}, [], []
    if tenant_ids:
        all_tenant_halls = (
            await db.execute(
                select(Hall)
                .where(Hall.tenant_id.in_(tenant_ids), Hall.lifecycle == RecordLifecycle.ACTIVE)
                .order_by(Hall.name.asc())
            )
        ).scalars().all()
        halls = [h for h in all_tenant_halls if (not hall_id or h.id == hall_id)]
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

    halls_by_tenant: dict[uuid.UUID, list[Hall]] = {}
    for h in all_tenant_halls:
        halls_by_tenant.setdefault(h.tenant_id, []).append(h)

    events_by_hall: dict[uuid.UUID, list[Event]] = {}
    events_by_tenant: dict[uuid.UUID, list[Event]] = {}
    for ev in events:
        events_by_tenant.setdefault(ev.tenant_id, []).append(ev)
    for tid, t_evs in events_by_tenant.items():
        ev_halls_map = await AvailabilityService.load_event_hall_ids_map(
            db, tid, t_evs, halls_by_tenant.get(tid, [])
        )
        for ev in t_evs:
            for hid in ev_halls_map.get(ev.id, [ev.hall_id]):
                events_by_hall.setdefault(hid, []).append(ev)

    days_out: dict[str, list[dict]] = {}
    for h in halls:
        buf = timedelta(minutes=h.cleaning_buffer_minutes or 0)
        relevant = list(events_by_hall.get(h.id, []))
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

            if day < today_utc or day > max_cal_date:
                entries.append(
                    {
                        "date": day.isoformat(),
                        "status": "UNAVAILABLE",
                        "dynamic_price": float(dynamic_price),
                        "multiplier": float(multiplier),
                        "occupied_events": [],
                        "available_slots": [],
                    }
                )
                continue

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

    def _branding(t: Tenant) -> dict:
        b = brandings.get(t.id)
        return {
            "primaryColor": b.primary_color if b else "#D4AF37",
            "accentColor": b.accent_color if b else "#0F172A",
            "logoLightUrl": b.logo_light_url if b else None,
            "logoDarkUrl": b.logo_dark_url if b else None,
        }

    def _active_partner(tenant_halls: list[Hall], target_h: Hall) -> Optional[str]:
        pids = AvailabilityService.resolve_combinable_partner_ids(tenant_halls, target_h.id)
        return str(pids[0]) if pids else None

    return {
        "start_date": first_day.isoformat(),
        "end_date": last_day.isoformat(),
        "max_horizon_date": max_cal_date.isoformat(),
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
                        "combinable_with_hall_id": _active_partner(halls_by_tenant.get(t.id, []), h),
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
    upload_token: Optional[str] = Form(default=None),
    payment_method: Optional[str] = Form(default=None),
    transfer_reference: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    """One-time signed-token receipt upload for a milestone created by POST /bookings/hold."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    token = (upload_token or request.headers.get("x-upload-token") or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Signed upload_token is required")
    jti = verify_receipt_upload_token(token, tenant.id, milestone_id)

    milestone = (
        await db.execute(
            select(PaymentMilestone)
            .where(PaymentMilestone.id == milestone_id, PaymentMilestone.tenant_id == tenant.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    if not milestone.upload_token_jti or milestone.upload_token_jti != jti:
        raise HTTPException(status_code=403, detail="Upload token already used or revoked")
    if milestone.status not in ("PENDING", "UNDER_REVIEW", "RETURNED_FOR_AMENDMENT"):
        raise HTTPException(status_code=409, detail="Milestone no longer accepts receipts")
    milestone.upload_token_jti = None
    client_id = (
        await db.execute(
            select(Event.primary_client_id)
            .join(Invoice, Invoice.event_id == Event.id)
            .where(Invoice.id == milestone.invoice_id, Invoice.tenant_id == tenant.id, Event.tenant_id == tenant.id)
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
    inv_ids = [i.id for i in invoices.values()]
    paid_by_inv: dict[uuid.UUID, Decimal] = {}
    if inv_ids:
        ms_rows = (
            await db.execute(
                select(PaymentMilestone).where(
                    PaymentMilestone.tenant_id == auth.tenant_id,
                    PaymentMilestone.invoice_id.in_(inv_ids),
                    PaymentMilestone.is_security_deposit == False,  # noqa: E712
                )
            )
        ).scalars().all()
        for m in ms_rows:
            paid_by_inv[m.invoice_id] = paid_by_inv.get(m.invoice_id, Decimal("0.00")) + Decimal(str(m.paid_amount))
    sec_profiles = {
        sp.event_id: sp.security_status
        for sp in (
            await db.execute(select(EventSecurityProfile).where(EventSecurityProfile.tenant_id == auth.tenant_id))
        )
        .scalars()
        .all()
    }
    active_halls_list = [h for h in halls.values() if h.lifecycle == RecordLifecycle.ACTIVE]
    def _ev_hall_ids(ev_obj: Event) -> list[uuid.UUID]:
        inv = invoices.get(ev_obj.id)
        return AvailabilityService.extract_booked_hall_ids(ev_obj, inv.line_items_json if inv else None, active_halls_list)

    return [
        {
            "id": str(ev.id),
            "event_code": ev.event_code,
            "title": ev.title,
            "event_type": ev.event_type,
            "hall_id": str(ev.hall_id),
            "hall_ids": [str(hid) for hid in _ev_hall_ids(ev)],
            "hall_name": " + ".join(halls[hid].name for hid in _ev_hall_ids(ev) if hid in halls) or "",
            "hall_name_ar": " + ".join(halls[hid].name_ar for hid in _ev_hall_ids(ev) if hid in halls) or "",
            "client_id": str(ev.primary_client_id),
            "client_name": clients[ev.primary_client_id].full_name if ev.primary_client_id in clients else "",
            "client_phone": clients[ev.primary_client_id].phone if ev.primary_client_id in clients else "",
            "start_time": ev.start_time.isoformat(),
            "end_time": ev.end_time.isoformat(),
            "status": ev.status.value,
            "guest_count": ev.guest_count,
            "total_amount": float(invoices[ev.id].total_amount) if ev.id in invoices else 0.0,
            "paid_amount": float(paid_by_inv.get(invoices[ev.id].id, Decimal("0.00"))) if ev.id in invoices else 0.0,
            "security_deposit_amount": float(invoices[ev.id].security_deposit_amount) if ev.id in invoices else 0.0,
            "deposit_status": invoices[ev.id].deposit_status.value if ev.id in invoices else "UNPAID",
            "is_locked": bool(ev.is_locked),
            "closed_at": ev.closed_at.isoformat() if ev.closed_at else None,
            "closing_remarks": ev.closing_remarks,
            "reopened_reason": ev.reopened_reason,
            "security_status": sec_profiles.get(ev.id, "DRAFT"),
        }
        for ev in events
    ]


@router.patch("/bookings/events/{event_id}")
async def update_event_details(
    event_id: uuid.UUID,
    body: UpdateEventDetailsBody,
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.OPS_MANAGER, StaffRole.SALES_MANAGER, StaffRole.SALES},
            required_perm=("bookings", "edit"),
        )
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    old_val = {"title": ev.title, "event_type": ev.event_type, "guest_count": ev.guest_count}
    if body.title is not None:
        ev.title = body.title.strip() or None
    if body.event_type is not None and body.event_type.strip():
        ev.event_type = body.event_type.strip()
    if body.guest_count is not None:
        ev.guest_count = body.guest_count
    new_val = {"title": ev.title, "event_type": ev.event_type, "guest_count": ev.guest_count, "remarks": body.remarks}
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="EVENT_DETAILS_UPDATED",
            old_value=old_val,
            new_value=new_val,
        )
    )
    await db.commit()
    return {"status": "UPDATED", "event_id": str(ev.id), "title": ev.title, "event_type": ev.event_type, "guest_count": ev.guest_count}


@router.post("/bookings/events/{event_id}/status")
async def update_event_status(
    event_id: uuid.UUID,
    body: UpdateEventStatusBody,
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.SALES_MANAGER, StaffRole.OPS_MANAGER, StaffRole.FINANCE},
        )
    ),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    old_status = ev.status.value
    ev.status = body.status
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="EVENT_STATUS_UPDATED",
            old_value={"status": old_status},
            new_value={"status": body.status.value},
        )
    )
    await db.commit()
    return {"status": ev.status.value}
