import asyncio
import uuid
from celery import Celery
from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import Event, EventStatus

celery_app = Celery("eventledger_worker", broker=settings.REDIS_URL, backend=settings.REDIS_URL)


async def _expire_hold_async(event_id_str: str) -> str:
    event_id = uuid.UUID(event_id_str)
    async with AsyncSessionLocal() as db:
        ev = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
        if not ev or ev.status != EventStatus.HOLD_48H:
            return "SKIPPED"

        inv = (await db.execute(select(Invoice).where(Invoice.event_id == ev.id))).scalar_one_or_none()
        if inv:
            milestones = (await db.execute(select(PaymentMilestone).where(PaymentMilestone.invoice_id == inv.id))).scalars().all()
            if any(m.status in {"PAID", "UNDER_REVIEW", "VERIFIED"} or float(m.paid_amount) > 0 for m in milestones):
                return "PAID_OR_UNDER_REVIEW"

        ev.status = EventStatus.CANCELLED
        await db.commit()
        return "EXPIRED_AND_CANCELLED"


@celery_app.task(name="eventledger.expire_unpaid_48h_hold")
def expire_unpaid_48h_hold(event_id: str) -> str:
    return asyncio.run(_expire_hold_async(event_id))
