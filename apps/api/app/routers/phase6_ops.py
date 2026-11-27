import urllib.parse
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles, verify_event_access, verify_whatsapp_signature
from app.models.accounting import ChartOfAccount, Invoice, JournalEntry
from app.models.events import AuditLog, DraftStatus, DraftType, Event, EventDraft, EventMessage, GatePass
from app.models.events_extensions import NotificationLog
from app.models.users import StaffRole, User, UserType
from app.models.venue import EventInventoryAllocation, Hall, InventoryItem
from app.services.accounting_service import DoubleEntryService
from app.services.comms_service import CommsService
from app.services.import_export_service import ImportExportService

router = APIRouter(prefix="/api/v1", tags=["CSV Import/Export, PDF, Comms & BEO"])


class PostEventMessageBody(BaseModel):
    content: str
    channel: str = "IN_APP"
    department: Optional[str] = "ALL"
    is_internal: bool = False


class ShareDocumentBody(BaseModel):
    document_type: Literal["INVOICE", "CONTRACT", "DEPOSIT_SETTLEMENT", "BEO"]
    channel: Literal["WHATSAPP", "EMAIL", "IN_APP"] = "WHATSAPP"
    recipient_phone: Optional[str] = None
    recipient_email: Optional[str] = None
    locale: Literal["ar", "en"] = "ar"
    message_note: Optional[str] = None


@router.post("/import/{entity_type}")
async def bulk_import_csv(
    entity_type: str,
    file: UploadFile = File(...),
    event_id: Optional[uuid.UUID] = Form(default=None),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    raw = await file.read()
    if entity_type == "accounts":
        if auth.staff_role not in (StaffRole.OWNER, StaffRole.ADMIN, StaffRole.FINANCE) and auth.user.user_type != UserType.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Only OWNER, ADMIN, or FINANCE may import Chart of Accounts")
        return await ImportExportService.import_chart_of_accounts_csv(db, auth.tenant_id, raw)
    if entity_type == "inventory":
        if auth.staff_role not in (StaffRole.OWNER, StaffRole.OPS_MANAGER, StaffRole.FINANCE) and auth.user.user_type != UserType.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Insufficient role for inventory import")
        return await ImportExportService.import_inventory_csv(db, auth.tenant_id, raw)
    if entity_type == "guests":
        if not event_id:
            raise HTTPException(status_code=400, detail="event_id is required for guest list import")
        return await ImportExportService.import_guests_csv(db, auth.tenant_id, event_id, raw)
    raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {entity_type}")


@router.get("/exports/{export_type}.csv")
async def export_csv(
    export_type: str,
    event_id: Optional[uuid.UUID] = Query(default=None),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    if export_type == "accounts":
        rows = (
            await db.execute(
                select(ChartOfAccount)
                .where(ChartOfAccount.tenant_id == auth.tenant_id)
                .order_by(ChartOfAccount.code.asc())
            )
        ).scalars().all()
        data = [
            {"code": r.code, "name_ar": r.name_ar, "name_en": r.name_en, "account_type": r.account_type.value}
            for r in rows
        ]
        csv_bytes = ImportExportService.encode_csv_utf8_bom(data, ["code", "name_ar", "name_en", "account_type"])
    elif export_type == "trial-balance":
        tb = await DoubleEntryService.get_trial_balance(db, auth.tenant_id)
        csv_bytes = ImportExportService.encode_csv_utf8_bom(
            tb["rows"], ["code", "name_ar", "name_en", "account_type", "total_debit", "total_credit", "balance"]
        )
    elif export_type == "journal":
        entries = (
            await db.execute(
                select(JournalEntry)
                .where(JournalEntry.tenant_id == auth.tenant_id)
                .order_by(JournalEntry.created_at.desc())
            )
        ).scalars().all()
        data = [
            {
                "entry_number": e.entry_number,
                "entry_date": e.entry_date.isoformat(),
                "reference": e.reference or "",
                "description": e.description,
                "status": e.status,
            }
            for e in entries
        ]
        csv_bytes = ImportExportService.encode_csv_utf8_bom(
            data, ["entry_number", "entry_date", "reference", "description", "status"]
        )
    elif export_type == "guests":
        q = select(GatePass).where(GatePass.tenant_id == auth.tenant_id)
        if event_id:
            q = q.where(GatePass.event_id == event_id)
        passes = (await db.execute(q)).scalars().all()
        data = [
            {
                "holder_name": p.holder_name,
                "holder_id_number": p.holder_id_number or "",
                "pass_type": p.pass_type,
                "qr_token": p.qr_token,
                "is_checked_in": str(p.is_checked_in),
            }
            for p in passes
        ]
        csv_bytes = ImportExportService.encode_csv_utf8_bom(
            data, ["holder_name", "holder_id_number", "pass_type", "qr_token", "is_checked_in"]
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported CSV export type")

    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{export_type}.csv"'},
    )


@router.get("/exports/invoices/{invoice_id}/pdf")
async def export_invoice_pdf(
    invoice_id: uuid.UUID,
    locale: str = Query(default="ar", pattern="^(ar|en)$"),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    inv = (
        await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await verify_event_access(db, auth, inv.event_id, required_delegate_perm="canViewFinance")
    pdf_bytes = await ImportExportService.render_invoice_pdf(db, auth.tenant_id, invoice_id, locale)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice-{invoice_id}-{locale}.pdf"'},
    )


@router.get("/exports/events/{event_id}/beo.pdf")
async def export_beo_pdf(
    event_id: uuid.UUID,
    locale: str = Query(default="ar", pattern="^(ar|en)$"),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (
        await db.execute(select(Event.id).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    pdf_bytes = await ImportExportService.render_beo_pdf(db, auth.tenant_id, event_id, locale)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="beo-{event_id}-{locale}.pdf"'},
    )


@router.get("/exports/contracts/{event_id}/pdf")
async def export_contract_pdf(
    event_id: uuid.UUID,
    locale: str = Query(default="ar", pattern="^(ar|en)$"),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)
    pdf_bytes = await ImportExportService.render_contract_pdf(db, auth.tenant_id, event_id, locale)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="contract-{event_id}-{locale}.pdf"'},
    )


@router.get("/exports/events/{event_id}/deposit-settlement.pdf")
async def export_deposit_settlement_pdf(
    event_id: uuid.UUID,
    locale: str = Query(default="ar", pattern="^(ar|en)$"),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id, required_delegate_perm="canViewFinance")
    pdf_bytes = await ImportExportService.render_deposit_settlement_pdf(db, auth.tenant_id, event_id, locale)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="deposit-settlement-{event_id}-{locale}.pdf"'},
    )


@router.get("/notifications")
async def list_notifications(
    limit: int = Query(default=30, ge=1, le=100),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        return {"unread_count": 0, "items": []}

    q = select(NotificationLog).where(NotificationLog.tenant_id == auth.tenant_id)
    if auth.user.user_type == UserType.INTERNAL_STAFF or auth.user.user_type == UserType.SUPER_ADMIN:
        q = q.where(
            or_(
                NotificationLog.recipient_user_id == auth.user.id,
                NotificationLog.recipient_user_id.is_(None),
                NotificationLog.channel == "WHATSAPP",
            )
        )
    else:
        q = q.where(NotificationLog.recipient_user_id == auth.user.id)

    rows = (await db.execute(q.order_by(NotificationLog.created_at.desc()).limit(limit))).scalars().all()
    unread = sum(1 for r in rows if not r.is_read)
    return {
        "unread_count": unread,
        "items": [
            {
                "id": str(r.id),
                "event_id": str(r.event_id) if r.event_id else None,
                "channel": r.channel,
                "category": r.category,
                "title": r.title,
                "content": r.content,
                "delivery_status": r.delivery_status,
                "provider_message_id": r.provider_message_id,
                "recipient_address": r.recipient_address,
                "is_read": r.is_read,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    q = select(NotificationLog).where(
        NotificationLog.id == notification_id,
        NotificationLog.tenant_id == auth.tenant_id,
    )
    if auth.user.user_type not in (UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN):
        q = q.where(NotificationLog.recipient_user_id == auth.user.id)
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.is_read = True
    await db.commit()
    return {"status": "READ"}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        return {"status": "OK"}
    q = select(NotificationLog).where(NotificationLog.tenant_id == auth.tenant_id, NotificationLog.is_read == False)  # noqa: E712
    if auth.user.user_type in (UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN):
        q = q.where(
            or_(
                NotificationLog.recipient_user_id == auth.user.id,
                NotificationLog.recipient_user_id.is_(None),
                NotificationLog.channel == "WHATSAPP",
            )
        )
    else:
        q = q.where(NotificationLog.recipient_user_id == auth.user.id)
    rows = (await db.execute(q)).scalars().all()
    for r in rows:
        r.is_read = True
    await db.commit()
    return {"status": "ALL_READ", "count": len(rows)}


@router.post("/events/{event_id}/share-document")
async def share_event_document(
    event_id: uuid.UUID,
    body: ShareDocumentBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = await verify_event_access(db, auth, event_id)
    client = (await db.execute(select(User).where(User.id == ev.primary_client_id))).scalar_one_or_none()
    inv = (
        await db.execute(select(Invoice).where(Invoice.event_id == ev.id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()

    if body.document_type == "INVOICE":
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found for event")
        dl_url = f"/api/v1/exports/invoices/{inv.id}/pdf?locale={body.locale}"
        doc_title = f"Invoice {inv.invoice_number}" if body.locale == "en" else f"فاتورة {inv.invoice_number}"
    elif body.document_type == "CONTRACT":
        dl_url = f"/api/v1/exports/contracts/{ev.id}/pdf?locale={body.locale}"
        doc_title = f"Contract {ev.event_code}" if body.locale == "en" else f"عقد الفعالية {ev.event_code}"
    elif body.document_type == "DEPOSIT_SETTLEMENT":
        dl_url = f"/api/v1/exports/events/{ev.id}/deposit-settlement.pdf?locale={body.locale}"
        doc_title = f"Deposit Settlement {ev.event_code}" if body.locale == "en" else f"سند تسوية التأمين {ev.event_code}"
    else:
        dl_url = f"/api/v1/exports/events/{ev.id}/beo.pdf?locale={body.locale}"
        doc_title = f"BEO {ev.event_code}" if body.locale == "en" else f"أمر التشغيل BEO {ev.event_code}"

    target_phone = (body.recipient_phone or (client.phone if client else "") or "").strip() or None
    target_email = (body.recipient_email or (client.email if client else "") or "").strip() or None
    note = f"\n{body.message_note.strip()}" if body.message_note and body.message_note.strip() else ""
    msg = (
        f"{doc_title} — {ev.event_code}\nDownload: {dl_url}{note}"
        if body.locale == "en"
        else f"{doc_title} — {ev.event_code}\nرابط المستند: {dl_url}{note}"
    )

    dispatch = await CommsService.notify_and_whatsapp(
        db,
        auth.tenant_id,
        title=f"مشاركة مستند · {doc_title}",
        content=msg,
        category="DOCUMENT_SHARE",
        event_id=ev.id,
        recipient_user_id=client.id if client else None,
        recipient_phone=target_phone,
        send_whatsapp=(body.channel == "WHATSAPP"),
        channel=body.channel,
    )
    if body.channel == "EMAIL" and target_email:
        db.add(
            NotificationLog(
                tenant_id=auth.tenant_id,
                event_id=ev.id,
                recipient_user_id=client.id if client else None,
                recipient_address=target_email,
                channel="EMAIL",
                category="DOCUMENT_SHARE",
                title=f"Email Dispatch: {doc_title}",
                content=msg,
                delivery_status="SIMULATED_FALLBACK",
                provider_message_id=f"sim-mail-{uuid.uuid4().hex[:10]}",
                is_read=True,
            )
        )
    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="DOCUMENT_SHARED",
            new_value={"document_type": body.document_type, "channel": body.channel, "delivery_status": dispatch["delivery_status"]},
        )
    )
    await db.commit()
    mailto_url = (
        f"mailto:{urllib.parse.quote(target_email)}?subject={urllib.parse.quote(doc_title)}&body={urllib.parse.quote(msg)}"
        if target_email
        else None
    )
    return {
        "status": "SHARED",
        "document_type": body.document_type,
        "channel": body.channel,
        "delivery_status": dispatch["delivery_status"],
        "download_url": dl_url,
        "whatsapp_url": dispatch["whatsapp_url"],
        "mailto_url": mailto_url,
    }


@router.get("/events/{event_id}/messages")
async def list_event_messages(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)
    q = (
        select(EventMessage, User.full_name)
        .join(User, EventMessage.sender_id == User.id)
        .where(EventMessage.event_id == event_id, EventMessage.tenant_id == auth.tenant_id)
    )
    if auth.user.user_type != UserType.INTERNAL_STAFF:
        q = q.where(EventMessage.is_internal == False)  # noqa: E712
    rows = (await db.execute(q.order_by(EventMessage.created_at.asc()))).all()
    return [
        {
            "id": str(m.id),
            "sender_id": str(m.sender_id),
            "sender_name": sender_name,
            "channel": m.channel,
            "department": m.department,
            "mentions": CommsService.extract_mentions(m.content),
            "content": m.content,
            "is_internal": m.is_internal,
            "created_at": m.created_at.isoformat(),
        }
        for m, sender_name in rows
    ]


@router.post("/events/{event_id}/messages")
async def create_event_message(
    event_id: uuid.UUID,
    body: PostEventMessageBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id, required_delegate_perm="canChat")
    is_internal = body.is_internal if auth.user.user_type == UserType.INTERNAL_STAFF else False
    msg = await CommsService.post_message(
        db, auth.tenant_id, event_id, auth.user.id, body.content, body.channel, body.department, is_internal
    )
    return {
        "id": str(msg.id),
        "status": "SENT",
        "mentions": CommsService.extract_mentions(msg.content),
    }


@router.get("/webhooks/whatsapp")
async def verify_whatsapp_webhook(
    hub_mode: str = Query(default="", alias="hub.mode"),
    hub_verify_token: str = Query(default="", alias="hub.verify_token"),
    hub_challenge: str = Query(default="", alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN:
        return PlainTextResponse(content=hub_challenge)
    raise HTTPException(status_code=403, detail="Invalid WhatsApp verify token")


@router.post("/webhooks/whatsapp")
async def whatsapp_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    raw_body = await request.body()
    sig = request.headers.get("x-hub-signature-256")
    if not verify_whatsapp_signature(raw_body, sig):
        raise HTTPException(status_code=403, detail="Invalid or missing WhatsApp webhook signature")
    payload = await request.json()
    return await CommsService.ingest_whatsapp_webhook(db, payload)


@router.get("/ops/beo")
async def get_live_beo(
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF})),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    events = (
        await db.execute(select(Event).where(Event.tenant_id == auth.tenant_id).order_by(Event.start_time.asc()))
    ).scalars().all()
    halls = {h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == auth.tenant_id))).scalars().all()}
    orders = []
    for ev in events:
        drafts = (
            await db.execute(
                select(EventDraft)
                .where(
                    EventDraft.event_id == ev.id,
                    EventDraft.tenant_id == auth.tenant_id,
                    EventDraft.status == DraftStatus.APPROVED_SYNCED,
                )
                .order_by(EventDraft.version_number.desc())
            )
        ).scalars().all()
        allocs = (
            await db.execute(
                select(EventInventoryAllocation, InventoryItem.name)
                .join(InventoryItem, EventInventoryAllocation.item_id == InventoryItem.id)
                .where(
                    EventInventoryAllocation.event_id == ev.id,
                    EventInventoryAllocation.tenant_id == auth.tenant_id,
                )
            )
        ).all()
        notes = (
            await db.execute(
                select(EventMessage)
                .where(
                    EventMessage.event_id == ev.id,
                    EventMessage.tenant_id == auth.tenant_id,
                    EventMessage.is_internal == True,  # noqa: E712
                )
                .order_by(EventMessage.created_at.desc())
                .limit(10)
            )
        ).scalars().all()
        hall = halls.get(ev.hall_id)
        floor_plan = next((d.payload for d in drafts if d.draft_type == DraftType.FLOOR_PLAN), None)
        catering = next((d.payload for d in drafts if d.draft_type == DraftType.CATERING_MENU), None)
        timeline = next((d.payload.get("items", []) for d in drafts if d.draft_type == DraftType.TIMELINE_BEO), [])
        orders.append(
            {
                "event_id": str(ev.id),
                "event_code": ev.event_code,
                "title": ev.title,
                "event_type": ev.event_type,
                "hall_name": hall.name if hall else "",
                "hall_name_ar": hall.name_ar if hall else "",
                "start_time": ev.start_time.isoformat(),
                "end_time": ev.end_time.isoformat(),
                "guest_count": ev.guest_count,
                "status": ev.status.value,
                "floor_plan": floor_plan,
                "catering": catering,
                "timeline": timeline,
                "inventory": [{"item_name": name, "quantity": a.quantity_reserved} for a, name in allocs],
                "internal_notes": [
                    {"id": str(n.id), "department": n.department, "content": n.content, "created_at": n.created_at.isoformat()}
                    for n in notes
                ],
            }
        )
    return {"orders": orders}
