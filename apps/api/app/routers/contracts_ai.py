import re
import uuid
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, require_roles, verify_event_access
from app.models.accounting import Invoice, PaymentMilestone
from app.models.base import utcnow
from app.models.events import AuditLog, Event
from app.models.events_extensions import EventContract
from app.models.tenant import Tenant
from app.models.users import ClientProfile, StaffRole, User, UserType
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService
from app.services.availability_service import AvailabilityService
from app.services.comms_service import CommsService

router = APIRouter(prefix="/api/v1", tags=["AI Contract Studio & Review"])

CONTRACT_AUTHOR_ROLES = {
    StaffRole.OWNER,
    StaffRole.ADMIN,
    StaffRole.SALES_MANAGER,
    StaffRole.SALES_REP,
    StaffRole.SALES,
    StaffRole.OPS_MANAGER,
    StaffRole.FINANCE,
}


class GenerateAiContractBody(BaseModel):
    custom_clauses_notes: Optional[str] = None
    cancellation_policy: Optional[str] = None
    language_focus: Literal["BOTH", "AR", "EN"] = "BOTH"
    force_regenerate_unsigned: bool = True


class PatchContractBody(BaseModel):
    terms_ar: Optional[str] = None
    terms_en: Optional[str] = None
    status: Optional[Literal["DRAFT", "PENDING_REVIEW", "RETURNED_FOR_AMENDMENT", "APPROVED"]] = None
    remarks: Optional[str] = None
    amendment_remarks: Optional[str] = None


def _localized_tenant_name(raw_name: str, locale: str) -> str:
    parts = [p.strip() for p in (raw_name or "").split("|") if p.strip()]
    if len(parts) > 1:
        if locale == "ar":
            ar_part = next((p for p in parts if re.search(r"[\u0600-\u06FF]", p)), None)
            if ar_part:
                return ar_part
        else:
            en_part = next((p for p in parts if re.search(r"[A-Za-z]", p) and not re.search(r"[\u0600-\u06FF]", p)), None)
            if en_part:
                return en_part
    return (raw_name or "").strip()


def _format_line_items_summary(inv: Optional[Invoice], currency: str, is_ar: bool) -> str:
    if not inv:
        return "لم تصدر فاتورة بعد." if is_ar else "No invoice generated yet."
    raw = inv.line_items_json
    items: list[dict] = []
    if isinstance(raw, list):
        items = [x for x in raw if isinstance(x, dict)]
    elif isinstance(raw, dict):
        if isinstance(raw.get("items"), list):
            items = [x for x in raw["items"] if isinstance(x, dict)]
        else:
            for k in ("hall", "additional_halls", "catering", "addons", "custom_addons", "custom"):
                val = raw.get(k)
                if isinstance(val, list):
                    items.extend(x for x in val if isinstance(x, dict))
                elif isinstance(val, dict):
                    items.append(val)
    if not items:
        return (
            f"باقة إيجار القاعة وتجهيزات الفعالية الأساسية بقيمة {Decimal(str(inv.subtotal)):,.2f} {currency}."
            if is_ar
            else f"Standard Venue Hall & Core Event Package totaling {Decimal(str(inv.subtotal)):,.2f} {currency}."
        )
    parts = []
    for it in items:
        label = (
            (it.get("label_ar") if is_ar else it.get("label_en"))
            or it.get("name")
            or it.get("title")
            or it.get("description")
            or ("بند" if is_ar else "Item")
        )
        qty = it.get("quantity") or it.get("qty") or 1
        amt = Decimal(str(it.get("total") or it.get("amount") or it.get("unit_price") or 0))
        parts.append(f"- {label} (x{qty}): {amt:,.2f} {currency}")
    return "\n".join(parts)


def _serialize_contract(c: EventContract) -> dict:
    return {
        "id": str(c.id),
        "event_id": str(c.event_id),
        "contract_number": c.contract_number,
        "status": getattr(c, "status", "DRAFT") or "DRAFT",
        "terms_ar": c.terms_ar,
        "terms_en": c.terms_en,
        "remarks": c.remarks,
        "amendment_remarks": c.amendment_remarks,
        "ai_metadata_json": c.ai_metadata_json,
        "client_signed_at": c.client_signed_at.isoformat() if c.client_signed_at else None,
        "client_signature_name": c.client_signature_name,
        "staff_countersigned_at": c.staff_countersigned_at.isoformat() if c.staff_countersigned_at else None,
        "pdf_url": c.pdf_url or f"/api/v1/exports/contracts/{c.event_id}/pdf",
    }


@router.post("/events/{event_id}/contract/generate-ai")
async def generate_ai_contract(
    event_id: uuid.UUID,
    body: GenerateAiContractBody = GenerateAiContractBody(),
    auth: AuthContext = Depends(require_roles({UserType.INTERNAL_STAFF}, CONTRACT_AUTHOR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    ev = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    existing = (
        await db.execute(
            select(EventContract).where(
                EventContract.event_id == event_id, EventContract.tenant_id == auth.tenant_id
            )
        )
    ).scalar_one_or_none()
    if existing and existing.client_signed_at and not body.force_regenerate_unsigned:
        raise HTTPException(status_code=400, detail="Contract is already signed by client")
    if existing and existing.client_signed_at:
        raise HTTPException(status_code=400, detail="Cannot overwrite a contract that has already been e-signed by the client")

    tenant = (await db.execute(select(Tenant).where(Tenant.id == auth.tenant_id))).scalar_one()
    tenant_ar = _localized_tenant_name(tenant.name, "ar")
    tenant_en = _localized_tenant_name(tenant.name, "en")
    hall = (await db.execute(select(Hall).where(Hall.id == ev.hall_id, Hall.tenant_id == auth.tenant_id))).scalar_one_or_none()
    client = (
        await db.execute(select(User).where(User.id == ev.primary_client_id, User.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    cp = (
        (await db.execute(select(ClientProfile).where(ClientProfile.user_id == client.id))).scalar_one_or_none()
        if client
        else None
    )
    inv = (
        await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    milestones = (
        (
            await db.execute(
                select(PaymentMilestone)
                .where(PaymentMilestone.invoice_id == inv.id, PaymentMilestone.tenant_id == auth.tenant_id)
                .order_by(PaymentMilestone.due_date.asc())
            )
        )
        .scalars()
        .all()
        if inv
        else []
    )

    c_name = client.full_name if client else "-"
    c_phone = client.phone if client else "-"
    c_org = f" ({cp.company_name})" if cp and cp.company_name else ""
    ev_hall_ids = AvailabilityService.extract_booked_hall_ids(ev, inv.line_items_json if inv else None)
    all_ev_halls = (
        await db.execute(select(Hall).where(Hall.id.in_(ev_hall_ids), Hall.tenant_id == auth.tenant_id))
    ).scalars().all()
    halls_map = {h.id: h for h in all_ev_halls}
    booked_halls = [halls_map[hid] for hid in ev_hall_ids if hid in halls_map]
    hall_ar = " + ".join(h.name_ar for h in booked_halls) or (hall.name_ar if hall else "-")
    hall_en = " + ".join(h.name for h in booked_halls) or (hall.name if hall else "-")
    cap = sum(h.capacity_banquet for h in booked_halls) if booked_halls else (hall.capacity_banquet if hall else ev.guest_count)
    buf_mins = max((h.cleaning_buffer_minutes for h in booked_halls), default=(hall.cleaning_buffer_minutes if hall else 120))
    ev_title = ev.title or ev.event_type
    start_str = ev.start_time.strftime("%Y-%m-%d %H:%M")
    end_str = ev.end_time.strftime("%Y-%m-%d %H:%M")

    cur = tenant.currency
    total_amt = Decimal(str(inv.total_amount)) if inv else Decimal("0.00")
    dep_amt = Decimal(str(inv.security_deposit_amount)) if inv else Decimal("0.00")
    disc_amt = Decimal(str(inv.discount_amount)) if inv else Decimal("0.00")
    tax_amt = Decimal(str(inv.tax_amount)) if inv else Decimal("0.00")
    inv_no = inv.invoice_number if inv else "TBD"

    items_ar = _format_line_items_summary(inv, cur, True)
    items_en = _format_line_items_summary(inv, cur, False)

    ms_ar = "\n".join(
        f"- {m.title}: {Decimal(str(m.amount_due)):,.2f} {cur} (يستحق في {m.due_date.strftime('%Y-%m-%d')})"
        for m in milestones
    ) or "- دفعة تأكيد الحجز وفق الفاتورة المعتمدة."
    ms_en = "\n".join(
        f"- {m.title}: {Decimal(str(m.amount_due)):,.2f} {cur} (Due {m.due_date.strftime('%Y-%m-%d')})"
        for m in milestones
    ) or "- Booking confirmation payment per approved invoice schedule."

    settings_map = tenant.settings or {}
    catering_lock = int(settings_map.get("cateringLockHours", 72))
    floor_lock = int(settings_map.get("floorPlanLockHours", 24))
    cancel_ar = body.cancellation_policy or "يخضع الإلغاء قبل الموعد بأقل من 14 يوماً لسياسة المنشأة ورسوم الحجز الإدارية."
    cancel_en = body.cancellation_policy or "Cancellations within 14 days of the event remain subject to venue retention policies."
    custom_ar = f"\n8. شروط خاصة متفق عليها:\n{body.custom_clauses_notes.strip()}" if body.custom_clauses_notes else ""
    custom_en = f"\n8. Custom Agreed Conditions:\n{body.custom_clauses_notes.strip()}" if body.custom_clauses_notes else ""

    terms_ar = (
        f"اتفاقية تنظيم واستضافة فعالية — رقم المرجع {ev.event_code}\n\n"
        f"1. أطراف العقد:\n"
        f"- الطرف الأول (المنشأة): {tenant_ar}.\n"
        f"- الطرف الثاني (العميل): {c_name}{c_org}، هاتف: {c_phone}.\n\n"
        f"2. القاعة والموعد والفعالية:\n"
        f"- مسمى الفعالية: {ev_title} (النوع: {ev.event_type})، رمز الفعالية: {ev.event_code}.\n"
        f"- القاعة المخصصة: {hall_ar} (السعة المعتمدة: {cap} ضيف، الضيوف المتفق عليهم: {ev.guest_count} ضيف).\n"
        f"- فترة الإشغال: من {start_str} إلى {end_str} (مع فاصل تجهيز وتعقيم {buf_mins} دقيقة).\n\n"
        f"3. نطاق خدمات الضيافة والتجهيزات الإضافية (وفق الفاتورة {inv_no}):\n{items_ar}\n\n"
        f"4. القيمة المالية وجدول الدفعات:\n"
        f"- الخصم المطبق: {disc_amt:,.2f} {cur} | الضريبة: {tax_amt:,.2f} {cur} | الصافي الإجمالي المستحق: {total_amt:,.2f} {cur}.\n"
        f"- جدول الاستحقاق:\n{ms_ar}\n\n"
        f"5. مبلغ تأمين الأضرار المسترد (التزامات 2100):\n"
        f"- يلتزم الطرف الثاني بإيداع تأمين مسترد وقدره {dep_amt:,.2f} {cur} يُحفظ كأمانة حتى إتمام فحص ما بعد الفعالية وإغلاق التشغيل، ويُخصم منه فقط قيمة أي تلفيات موثقة وتُرد البقية رسمياً.\n\n"
        f"6. ضوابط التعديل والإلغاء:\n"
        f"- يُقفل تعديل قائمة الضيافة قبل {catering_lock} ساعة، ومخطط القاعة قبل {floor_lock} ساعة من بدء الفعالية.\n"
        f"- {cancel_ar}\n\n"
        f"7. الأمن والسلامة وتصاريح الدخول:\n"
        f"- تخضع كافة تصاريح الضيوف والموردين لأنظمة البوابة الأمنية والـ QR المعتمدة لدى المنشأة.{custom_ar}"
    )

    terms_en = (
        f"EVENT VENUE & SERVICES AGREEMENT — REF {ev.event_code}\n\n"
        f"1. Contracting Parties:\n"
        f"- Venue Operator (First Party): {tenant_en}.\n"
        f"- Client (Second Party): {c_name}{c_org}, Phone: {c_phone}.\n\n"
        f"2. Venue, Schedule & Scope:\n"
        f"- Event Title: {ev_title} ({ev.event_type}), Booking Code: {ev.event_code}.\n"
        f"- Assigned Hall: {hall_en} (Hall Capacity: {cap} guests, Contracted Guests: {ev.guest_count}).\n"
        f"- Event Window: {start_str} to {end_str} (with {buf_mins}-minute turnaround buffer).\n\n"
        f"3. Catering Packages & Equipment Add-Ons (Per Invoice {inv_no}):\n{items_en}\n\n"
        f"4. Financial Value & Milestone Schedule:\n"
        f"- Discount Applied: {disc_amt:,.2f} {cur} | Tax: {tax_amt:,.2f} {cur} | Net Contract Total: {total_amt:,.2f} {cur}.\n"
        f"- Payment Milestones:\n{ms_en}\n\n"
        f"5. Refundable Security Deposit (GL Liability 2100):\n"
        f"- Client shall place a refundable security deposit of {dep_amt:,.2f} {cur} held in escrow until post-event inspection and close-operation verification, after which documented damages (if any) are deducted and the remainder refunded.\n\n"
        f"6. Modification Lockout & Cancellation Policy:\n"
        f"- Catering menus lock {catering_lock} hours prior and floor plans lock {floor_lock} hours prior to event start.\n"
        f"- {cancel_en}\n\n"
        f"7. Venue Security & Access Passes:\n"
        f"- All guest and vendor clearances are governed by the venue Security Gate & QR verification protocols.{custom_en}"
    )

    ai_meta = {
        "engine": "STRICT_DB_GROUNDED_AI_DRAFTER_V1",
        "generated_at": utcnow().isoformat(),
        "generated_by": str(auth.user.id),
        "grounded_facts": {
            "event_code": ev.event_code,
            "invoice_number": inv_no,
            "total_amount": float(total_amt),
            "security_deposit_amount": float(dep_amt),
            "guest_count": ev.guest_count,
            "milestones_count": len(milestones),
        },
        "custom_clauses_notes": body.custom_clauses_notes,
        "language_focus": body.language_focus,
    }

    if existing:
        existing.terms_ar = terms_ar
        existing.terms_en = terms_en
        existing.status = "PENDING_REVIEW"
        existing.ai_metadata_json = ai_meta
        existing.pdf_url = f"/api/v1/exports/contracts/{ev.id}/pdf"
        contract = existing
    else:
        ctr_no = await DoubleEntryService.next_sequence_number(db, auth.tenant_id, "CTR")
        contract = EventContract(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            contract_number=ctr_no,
            terms_ar=terms_ar,
            terms_en=terms_en,
            status="PENDING_REVIEW",
            ai_metadata_json=ai_meta,
            pdf_url=f"/api/v1/exports/contracts/{ev.id}/pdf",
        )
        db.add(contract)
        await db.flush()

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="CONTRACT_GENERATED_BY_AI",
            new_value={"contract_number": contract.contract_number, "grounded": ai_meta["grounded_facts"]},
        )
    )
    if client:
        await CommsService.notify_and_whatsapp(
            db,
            auth.tenant_id,
            title=f"مسودة العقد جاهزة للمراجعة · {contract.contract_number}",
            content=f"تم إعداد مسودة عقد الفعالية {ev.event_code} بقيمة {total_amt:,.2f} {cur} عبر الذكاء الاصطناعي للمراجعة والتوقيع.",
            category="CONTRACT_DRAFT",
            event_id=ev.id,
            recipient_user_id=client.id,
            recipient_phone=client.phone,
            send_whatsapp=True,
        )
    await db.commit()
    await db.refresh(contract)
    return _serialize_contract(contract)


@router.patch("/events/{event_id}/contract")
async def update_or_return_contract(
    event_id: uuid.UUID,
    body: PatchContractBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = await verify_event_access(db, auth, event_id, primary_client_or_staff_only=True)

    contract = (
        await db.execute(
            select(EventContract).where(
                EventContract.event_id == event_id, EventContract.tenant_id == auth.tenant_id
            )
        )
    ).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    is_staff = auth.user.user_type in {UserType.INTERNAL_STAFF, UserType.SUPER_ADMIN}
    if not is_staff:
        if body.status != "RETURNED_FOR_AMENDMENT" or not (body.amendment_remarks and body.amendment_remarks.strip()):
            raise HTTPException(
                status_code=400,
                detail="Clients may only return an unsigned contract for amendment with clear amendment_remarks",
            )
        if contract.client_signed_at:
            raise HTTPException(status_code=400, detail="Contract is already signed and cannot be returned")
        contract.status = "RETURNED_FOR_AMENDMENT"
        contract.amendment_remarks = body.amendment_remarks.strip()
        db.add(
            AuditLog(
                tenant_id=auth.tenant_id,
                event_id=ev.id,
                actor_id=auth.user.id,
                action="CONTRACT_RETURNED_FOR_AMENDMENT",
                new_value={"contract_number": contract.contract_number, "remarks": contract.amendment_remarks},
            )
        )
        await CommsService.notify_and_whatsapp(
            db,
            auth.tenant_id,
            title=f"طلب تعديل عقد · {ev.event_code}",
            content=f"أعاد العميل عقد الفعالية {ev.event_code} للتعديل: {contract.amendment_remarks}",
            category="AMENDMENT_REQUEST",
            event_id=ev.id,
            recipient_user_id=None,
            send_whatsapp=False,
        )
        await db.commit()
        await db.refresh(contract)
        return _serialize_contract(contract)

    if body.terms_ar is not None:
        contract.terms_ar = body.terms_ar
    if body.terms_en is not None:
        contract.terms_en = body.terms_en
    if body.remarks is not None:
        contract.remarks = body.remarks
    if body.amendment_remarks is not None:
        contract.amendment_remarks = body.amendment_remarks
    if body.status is not None:
        contract.status = body.status

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="CONTRACT_UPDATED_BY_STAFF",
            new_value={"contract_number": contract.contract_number, "status": contract.status},
        )
    )
    await db.commit()
    await db.refresh(contract)
    return _serialize_contract(contract)


@router.post("/erp/events/{event_id}/contract/countersign")
async def countersign_event_contract(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(
        require_roles(
            {UserType.INTERNAL_STAFF},
            {StaffRole.OWNER, StaffRole.ADMIN, StaffRole.OPS_MANAGER, StaffRole.SALES_MANAGER, StaffRole.FINANCE},
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
    contract = (
        await db.execute(
            select(EventContract).where(
                EventContract.event_id == event_id, EventContract.tenant_id == auth.tenant_id
            )
        )
    ).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract.staff_countersigned_at = utcnow()
    contract.staff_countersigned_by_id = auth.user.id
    contract.status = "SIGNED" if contract.client_signed_at else "APPROVED"

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=ev.id,
            actor_id=auth.user.id,
            action="CONTRACT_COUNTERSIGNED_BY_STAFF",
            new_value={"contract_number": contract.contract_number, "status": contract.status},
        )
    )
    client = (await db.execute(select(User).where(User.id == ev.primary_client_id))).scalar_one_or_none()
    if client:
        await CommsService.notify_and_whatsapp(
            db,
            auth.tenant_id,
            title=f"اعتماد العقد من الإدارة · {contract.contract_number}",
            content=f"تم اعتماد وتوقيع عقد الفعالية {ev.event_code} من إدارة المنشأة.",
            category="STATUS_UPDATE",
            event_id=ev.id,
            recipient_user_id=client.id,
            recipient_phone=client.phone,
            send_whatsapp=True,
        )
    await db.commit()
    await db.refresh(contract)
    return _serialize_contract(contract)
