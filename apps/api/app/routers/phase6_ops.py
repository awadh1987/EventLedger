import csv
import io
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import AccountType, ChartOfAccount, Invoice
from app.models.events import Event, EventDraft, EventMessage
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService
from app.services.comms_service import CommsService

router = APIRouter(prefix="/api/v1", tags=["P&L, CSV, PDF, Comms & BEO"])


class PostEventMessageBody(BaseModel):
    sender_id: uuid.UUID
    content: str
    channel: str = "IN_APP"
    department: str | None = "ALL"
    is_internal: bool = False


@router.get("/finance/events/{event_id}/pnl")
async def get_event_pnl(event_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_event_pnl(db, tenant.id, event_id)


@router.post("/import/{entity_type}")
async def bulk_import_csv(entity_type: str, request: Request, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    raw = await file.read()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    imported = 0
    for row in reader:
        if entity_type == "accounts":
            code = (row.get("code") or "").strip()
            if not code:
                continue
            acc_type_str = (row.get("account_type") or "ASSET").strip().upper()
            acc_type = AccountType(acc_type_str) if acc_type_str in AccountType._value2member_map_ else AccountType.ASSET
            db.add(ChartOfAccount(tenant_id=tenant.id, code=code, name_ar=(row.get("name_ar") or code).strip(), name_en=(row.get("name_en") or code).strip(), account_type=acc_type))
            imported += 1
    await db.commit()
    return {"entity_type": entity_type, "imported_rows": imported}


@router.get("/exports/invoices/{invoice_id}/pdf")
async def export_invoice_pdf(invoice_id: uuid.UUID, request: Request, locale: str = Query(default="ar", pattern="^(ar|en)$"), db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    inv = (await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant.id))).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    is_rtl = locale == "ar"
    html = f"<html dir='{'rtl' if is_rtl else 'ltr'}'><body><h2>{tenant.name} — #{inv.invoice_number}</h2><p>{inv.total_amount} {tenant.currency}</p></body></html>"
    try:
        import weasyprint
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
    except Exception:
        pdf_bytes = html.encode("utf-8")

    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{inv.invoice_number}-{locale}.pdf"'})


@router.get("/events/{event_id}/messages")
async def list_event_messages(event_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    msgs = (await db.execute(select(EventMessage).where(EventMessage.event_id == event_id).order_by(EventMessage.created_at.asc()))).scalars().all()
    return [{"id": str(m.id), "channel": m.channel, "department": m.department, "content": m.content, "is_internal": m.is_internal} for m in msgs]


@router.post("/events/{event_id}/messages")
async def create_event_message(event_id: uuid.UUID, body: PostEventMessageBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    msg = await CommsService.post_message(db, tenant.id, event_id, body.sender_id, body.content, body.channel, body.department, body.is_internal)
    return {"id": str(msg.id), "status": "SENT"}


@router.post("/webhooks/whatsapp")
async def whatsapp_webhook(payload: dict, db: AsyncSession = Depends(get_db)):
    return await CommsService.ingest_whatsapp_webhook(db, payload)


@router.get("/ops/beo")
async def get_live_beo(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    events = (await db.execute(select(Event).where(Event.tenant_id == tenant.id).order_by(Event.start_time.asc()))).scalars().all()
    halls = {h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()}
    orders = []
    for ev in events:
        drafts = (await db.execute(select(EventDraft).where(EventDraft.event_id == ev.id).order_by(EventDraft.version_number.desc()))).scalars().all()
        hall = halls.get(ev.hall_id)
        orders.append({
            "event_id": str(ev.id),
            "event_code": ev.event_code,
            "event_type": ev.event_type,
            "hall_name_ar": hall.name_ar if hall else "",
            "hall_name_en": hall.name if hall else "",
            "start_time": ev.start_time.isoformat(),
            "guest_count": ev.guest_count,
            "latest_draft_payload": drafts[0].payload if drafts else {},
        })
    return {"orders": orders}
