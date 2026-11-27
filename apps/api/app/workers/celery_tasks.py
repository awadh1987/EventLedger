import asyncio
import uuid
from celery import Celery
from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.accounting import Invoice, InvoiceStatus, JournalEntry, PaymentMilestone
from app.models.events import Event, EventStatus
from app.services.accounting_service import DoubleEntryService

celery_app = Celery("eventledger_worker", broker=settings.REDIS_URL, backend=settings.REDIS_URL)


async def _expire_hold_async(event_id_str: str) -> str:
    event_id = uuid.UUID(event_id_str)
    async with AsyncSessionLocal() as db:
        ev = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
        if not ev or ev.status != EventStatus.HOLD_48H:
            return "SKIPPED"

        inv = (
            await db.execute(select(Invoice).where(Invoice.event_id == ev.id, Invoice.tenant_id == ev.tenant_id))
        ).scalar_one_or_none()
        if inv:
            milestones = (
                await db.execute(
                    select(PaymentMilestone).where(
                        PaymentMilestone.invoice_id == inv.id,
                        PaymentMilestone.tenant_id == ev.tenant_id,
                    )
                )
            ).scalars().all()
            if any(m.status in {"PAID", "UNDER_REVIEW", "VERIFIED"} or float(m.paid_amount) > 0 for m in milestones):
                return "PAID_OR_UNDER_REVIEW"

            accrual_je = (
                await db.execute(
                    select(JournalEntry).where(
                        JournalEntry.tenant_id == ev.tenant_id,
                        JournalEntry.idempotency_key == f"INV_ACCRUAL:{inv.id}",
                        JournalEntry.status == "POSTED",
                    )
                )
            ).scalar_one_or_none()
            if accrual_je:
                await DoubleEntryService.reverse_entry(
                    db=db,
                    tenant_id=ev.tenant_id,
                    user_id=ev.primary_client_id,
                    entry_id=accrual_je.id,
                    reason="48h unpaid hold expired",
                )
            inv.status = InvoiceStatus.VOIDED

        ev.status = EventStatus.CANCELLED
        await db.commit()
        return "EXPIRED_AND_CANCELLED"


@celery_app.task(name="eventledger.expire_unpaid_48h_hold")
def expire_unpaid_48h_hold(event_id: str) -> str:
    return asyncio.run(_expire_hold_async(event_id))
