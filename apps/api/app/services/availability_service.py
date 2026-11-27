import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import Invoice
from app.models.base import RecordLifecycle
from app.models.events import Event, EventStatus
from app.models.tenant import Tenant
from app.models.venue import Hall, PricingRule


class AvailabilityService:
    BLOCKING_STATUSES = [EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]
    MAX_BOOKING_HORIZON_MONTHS = 60

    @staticmethod
    def add_calendar_months(base_date: date, months: int) -> date:
        total_months = (base_date.year * 12 + (base_date.month - 1)) + months
        year = total_months // 12
        month = (total_months % 12) + 1
        max_day = calendar.monthrange(year, month)[1]
        return date(year, month, min(base_date.day, max_day))

    @staticmethod
    def validate_booking_horizon(
        naive_start: datetime,
        naive_end: datetime,
        now_utc: Optional[datetime] = None,
    ) -> None:
        if naive_end <= naive_start:
            raise HTTPException(status_code=400, detail="end_time must be after start_time")
        now = now_utc or datetime.now(timezone.utc).replace(tzinfo=None)
        if naive_start < now - timedelta(minutes=15):
            raise HTTPException(status_code=400, detail="Booking start_time cannot be in the past")
        max_date = AvailabilityService.add_calendar_months(now.date(), AvailabilityService.MAX_BOOKING_HORIZON_MONTHS)
        if naive_start.date() > max_date or naive_end.date() > max_date + timedelta(days=1):
            raise HTTPException(
                status_code=400,
                detail="Booking date cannot exceed 5 years (60 months) in advance",
            )

    @staticmethod
    def resolve_combinable_partner_ids(active_halls: list[Hall], hall_id: uuid.UUID) -> list[uuid.UUID]:
        active_map = {h.id: h for h in active_halls}
        target = active_map.get(hall_id)
        if not target:
            return []
        partners: list[uuid.UUID] = []
        if target.combinable_with_hall_id and target.combinable_with_hall_id in active_map and target.combinable_with_hall_id != hall_id:
            partners.append(target.combinable_with_hall_id)
        for other in active_halls:
            if other.id != hall_id and other.combinable_with_hall_id == hall_id and other.id not in partners:
                partners.append(other.id)
        return partners

    @staticmethod
    def extract_booked_hall_ids(
        ev: Event,
        line_items_json: Optional[object],
        active_halls: Optional[list[Hall]] = None,
    ) -> list[uuid.UUID]:
        ids: list[uuid.UUID] = [ev.hall_id]
        if isinstance(line_items_json, dict):
            raw_list = line_items_json.get("hall_ids")
            if isinstance(raw_list, list):
                for raw in raw_list:
                    try:
                        parsed = uuid.UUID(str(raw))
                    except (ValueError, TypeError):
                        continue
                    if parsed not in ids:
                        ids.append(parsed)
            add_halls = line_items_json.get("additional_halls")
            if isinstance(add_halls, list):
                for row in add_halls:
                    if isinstance(row, dict) and row.get("hall_id"):
                        try:
                            parsed = uuid.UUID(str(row["hall_id"]))
                        except (ValueError, TypeError):
                            continue
                        if parsed not in ids:
                            ids.append(parsed)
            if (
                not raw_list
                and not add_halls
                and float(line_items_json.get("merged_hall_addon") or 0) > 0
                and active_halls
            ):
                for pid in AvailabilityService.resolve_combinable_partner_ids(active_halls, ev.hall_id):
                    if pid not in ids:
                        ids.append(pid)
        return ids

    @staticmethod
    async def load_event_hall_ids_map(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        events: list[Event],
        active_halls: Optional[list[Hall]] = None,
    ) -> dict[uuid.UUID, list[uuid.UUID]]:
        if not events:
            return {}
        inv_rows = (
            await db.execute(
                select(Invoice.event_id, Invoice.line_items_json).where(
                    Invoice.tenant_id == tenant_id,
                    Invoice.event_id.in_([e.id for e in events]),
                )
            )
        ).all()
        inv_map = {eid: lij for eid, lij in inv_rows}
        return {
            ev.id: AvailabilityService.extract_booked_hall_ids(ev, inv_map.get(ev.id), active_halls)
            for ev in events
        }

    @staticmethod
    async def resolve_requested_halls(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        primary_hall_id: uuid.UUID,
        hall_ids: Optional[list[uuid.UUID]] = None,
        merge_combinable_hall: bool = False,
    ) -> list[Hall]:
        active_halls = (
            await db.execute(
                select(Hall).where(Hall.tenant_id == tenant_id, Hall.lifecycle == RecordLifecycle.ACTIVE)
            )
        ).scalars().all()
        hall_map = {h.id: h for h in active_halls}
        if primary_hall_id not in hall_map:
            raise HTTPException(status_code=404, detail="Hall not found or inactive")

        req_ids: list[uuid.UUID] = [primary_hall_id]
        for hid in hall_ids or []:
            if hid not in hall_map:
                raise HTTPException(status_code=404, detail=f"Hall {hid} not found or inactive")
            if hid not in req_ids:
                req_ids.append(hid)
        if merge_combinable_hall:
            for pid in AvailabilityService.resolve_combinable_partner_ids(active_halls, primary_hall_id):
                if pid not in req_ids:
                    req_ids.append(pid)
        return [hall_map[hid] for hid in req_ids]

    @staticmethod
    async def check_hall_availability(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        end_time: datetime,
        *,
        hall_ids: Optional[list[uuid.UUID]] = None,
        merge_combinable_hall: bool = False,
    ) -> dict:
        naive_start = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
        naive_end = end_time.replace(tzinfo=None) if end_time.tzinfo else end_time

        active_halls = (
            await db.execute(
                select(Hall).where(Hall.tenant_id == tenant_id, Hall.lifecycle == RecordLifecycle.ACTIVE)
            )
        ).scalars().all()
        hall_map = {h.id: h for h in active_halls}
        hall = hall_map.get(hall_id)
        if not hall:
            return {"available": False, "reason": "HALL_NOT_FOUND", "checked_hall_ids": [], "conflicts": []}

        target_hall_ids: list[uuid.UUID] = [hall.id]
        for hid in hall_ids or []:
            if hid not in hall_map:
                return {"available": False, "reason": "HALL_NOT_FOUND", "checked_hall_ids": [], "conflicts": []}
            if hid not in target_hall_ids:
                target_hall_ids.append(hid)
        if merge_combinable_hall:
            for pid in AvailabilityService.resolve_combinable_partner_ids(active_halls, hall.id):
                if pid not in target_hall_ids:
                    target_hall_ids.append(pid)

        max_buf_mins = max((hall_map[hid].cleaning_buffer_minutes or 0 for hid in target_hall_ids), default=0)
        search_pad = timedelta(minutes=max_buf_mins) + timedelta(hours=6)

        candidates = (
            await db.execute(
                select(Event).where(
                    Event.tenant_id == tenant_id,
                    Event.status.in_(AvailabilityService.BLOCKING_STATUSES),
                    Event.end_time >= naive_start - search_pad,
                    Event.start_time <= naive_end + search_pad,
                )
            )
        ).scalars().all()

        ev_halls_map = await AvailabilityService.load_event_hall_ids_map(db, tenant_id, candidates, active_halls)
        target_set = set(target_hall_ids)

        conflicts = []
        for ev in candidates:
            overlap_halls = target_set & set(ev_halls_map.get(ev.id, [ev.hall_id]))
            if not overlap_halls:
                continue
            conflict_buf = max((hall_map[hid].cleaning_buffer_minutes or 0 for hid in overlap_halls if hid in hall_map), default=0)
            pad = timedelta(minutes=conflict_buf)
            if (naive_start - pad) < (ev.end_time + pad) and (naive_end + pad) > (ev.start_time - pad):
                conflicts.append(
                    {
                        "event_id": str(ev.id),
                        "event_code": ev.event_code,
                        "status": ev.status.value,
                        "conflicting_hall_ids": [str(h) for h in overlap_halls],
                    }
                )

        return {
            "available": len(conflicts) == 0,
            "checked_hall_ids": [str(h) for h in target_hall_ids],
            "conflicts": conflicts,
        }

    @staticmethod
    async def calculate_dynamic_quote(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        addon_amount: Decimal = Decimal("0.00"),
        discount_amount: Decimal = Decimal("0.00"),
    ) -> dict:
        naive_start = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
        hall = (
            await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not hall:
            raise HTTPException(status_code=404, detail="Hall not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        rules = (
            await db.execute(
                select(PricingRule).where(
                    PricingRule.tenant_id == tenant_id,
                    PricingRule.is_active == True,  # noqa: E712
                    or_(PricingRule.hall_id == hall_id, PricingRule.hall_id.is_(None)),
                )
            )
        ).scalars().all()

        sun_dow = (naive_start.weekday() + 1) % 7
        multiplier = Decimal("1.00")
        applied_rules: list[dict] = []
        for r in rules:
            if not r.days_of_week or sun_dow in r.days_of_week:
                if (not r.start_date or naive_start >= r.start_date) and (not r.end_date or naive_start <= r.end_date):
                    multiplier *= Decimal(str(r.multiplier))
                    applied_rules.append({"name": r.name, "multiplier": float(r.multiplier)})

        base_price = Decimal(str(hall.base_price))
        adjusted = (base_price * multiplier).quantize(Decimal("0.01"))
        subtotal = max(Decimal("0.00"), adjusted + addon_amount - discount_amount)
        tax_amount = (subtotal * (Decimal(str(tenant.tax_rate)) / Decimal("100.00"))).quantize(Decimal("0.01"))
        total_amount = subtotal + tax_amount
        deposit_amount = Decimal(str((tenant.settings or {}).get("defaultSecurityDeposit", 0)))

        return {
            "base_price": float(base_price),
            "effective_multiplier": float(multiplier),
            "applied_rules": applied_rules,
            "subtotal": float(subtotal),
            "tax_amount": float(tax_amount),
            "total_amount": float(total_amount),
            "security_deposit_amount": float(deposit_amount),
            "currency": tenant.currency,
        }
