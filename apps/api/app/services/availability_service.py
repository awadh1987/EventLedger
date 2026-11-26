import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import Event, EventStatus
from app.models.tenant import Tenant
from app.models.venue import Hall, PricingRule


class AvailabilityService:
    BLOCKING_STATUSES = [EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]

    @staticmethod
    async def check_hall_availability(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> dict:
        naive_start = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
        naive_end = end_time.replace(tzinfo=None) if end_time.tzinfo else end_time

        hall = (
            await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not hall:
            return {"available": False, "reason": "HALL_NOT_FOUND", "checked_hall_ids": [], "conflicts": []}

        target_hall_ids = [hall.id]
        if hall.combinable_with_hall_id:
            target_hall_ids.append(hall.combinable_with_hall_id)

        linked = (
            await db.execute(
                select(Hall.id).where(Hall.tenant_id == tenant_id, Hall.combinable_with_hall_id == hall.id)
            )
        ).all()
        for (linked_id,) in linked:
            if linked_id not in target_hall_ids:
                target_hall_ids.append(linked_id)

        buffer_delta = timedelta(minutes=hall.cleaning_buffer_minutes)
        expanded_start = naive_start - buffer_delta
        expanded_end = naive_end + buffer_delta

        candidates = (
            await db.execute(
                select(Event).where(
                    Event.tenant_id == tenant_id,
                    Event.hall_id.in_(target_hall_ids),
                    Event.status.in_(AvailabilityService.BLOCKING_STATUSES),
                )
            )
        ).scalars().all()

        hall_map = {
            h.id: h
            for h in (
                await db.execute(select(Hall).where(Hall.tenant_id == tenant_id, Hall.id.in_(target_hall_ids)))
            ).scalars().all()
        }

        conflicts = []
        for ev in candidates:
            ev_hall = hall_map.get(ev.hall_id)
            ev_buf = timedelta(minutes=ev_hall.cleaning_buffer_minutes if ev_hall else 0)
            ev_start = ev.start_time - ev_buf
            ev_end = ev.end_time + ev_buf
            if expanded_start < ev_end and expanded_end > ev_start:
                conflicts.append({"event_id": str(ev.id), "event_code": ev.event_code, "status": ev.status.value})

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
