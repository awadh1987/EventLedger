import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles, verify_event_access, verify_whatsapp_signature
from app.models.accounting import ChartOfAccount, Invoice, JournalEntry
from app.models.events import DraftStatus, DraftType, Event, EventDraft, EventMessage, GatePass
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
        if auth.staff_role not in (StaffRole.OWNER, StaffRole.FINANCE) and auth.user.user_type != UserType.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Only OWNER or FINANCE may import Chart of Accounts")
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
    pdf_bytes = await ImportExportService.render_beo_pdf(db, auth.tenant_id, event_id, locale)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="beo-{event_id}-{locale}.pdf"'},
    )


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
