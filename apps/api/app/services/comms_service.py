import uuid
from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.events import Event, EventMessage, EventStatus
from app.models.users import User


class CommsService:
    @staticmethod
    async def post_message(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        event_id: uuid.UUID,
        sender_id: uuid.UUID,
        content: str,
        channel: str = "IN_APP",
        department: str | None = "ALL",
        is_internal: bool = False,
        external_id: str | None = None,
    ) -> EventMessage:
        event = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        msg = EventMessage(
            event_id=event_id,
            sender_id=sender_id,
            channel=channel,
            department=department,
            content=content,
            is_internal=is_internal,
            external_id=external_id,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg

    @staticmethod
    async def ingest_whatsapp_webhook(db: AsyncSession, payload: dict) -> dict:
        entry = (payload.get("entry") or [{}])[0]
        change = (entry.get("changes") or [{}])[0]
        messages = (change.get("value") or {}).get("messages") or []
        if not messages:
            return {"status": "ignored"}

        wa_msg = messages[0]
        raw_phone = str(wa_msg.get("from", "")).strip()
        variants = [raw_phone, f"+{raw_phone}"] if not raw_phone.startswith("+") else [raw_phone, raw_phone[1:]]
        text_body = (wa_msg.get("text") or {}).get("body") or "[WhatsApp Media]"

        user = (await db.execute(select(User).where(User.phone.in_(variants), User.is_active == True))).scalar_one_or_none()
        if not user or not user.tenant_id:
            return {"status": "unknown_sender"}

        ev = (
            await db.execute(
                select(Event)
                .where(
                    Event.tenant_id == user.tenant_id,
                    or_(Event.primary_client_id == user.id, Event.assigned_sales_id == user.id),
                    Event.status.in_([EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]),
                )
                .order_by(Event.start_time.asc())
            )
        ).scalar_one_or_none()
        if not ev:
            return {"status": "no_active_event"}

        created = await CommsService.post_message(
            db=db,
            tenant_id=user.tenant_id,
            event_id=ev.id,
            sender_id=user.id,
            content=text_body,
            channel="WHATSAPP",
            external_id=wa_msg.get("id"),
        )
        return {"status": "SYNCED", "message_id": str(created.id)}
