import base64
import csv
import html
import io
import mimetypes
import re
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import AccountType, ChartOfAccount, Invoice, JournalEntry, PaymentMilestone
from app.models.events import DraftStatus, DraftType, Event, EventDraft, GatePass
from app.models.events_extensions import DamageInspection, EventContract
from app.models.tenant import Tenant, TenantBranding
from app.models.users import ClientProfile, User
from app.models.venue import EventInventoryAllocation, Hall, InventoryItem

MEDIA_ROOT = Path("/opt/eventledger/media")


class ImportExportService:
    @staticmethod
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

    @staticmethod
    def encode_csv_utf8_bom(rows: list[dict], fieldnames: list[str]) -> bytes:
        buf = io.StringIO()
        buf.write("\ufeff")
        writer = csv.DictWriter(buf, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in fieldnames})
        return buf.getvalue().encode("utf-8")

    @staticmethod
    def parse_csv_utf8_sig(file_bytes: bytes) -> list[dict]:
        text = file_bytes.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]

    @staticmethod
    async def import_chart_of_accounts_csv(db: AsyncSession, tenant_id: uuid.UUID, file_bytes: bytes) -> dict:
        rows = ImportExportService.parse_csv_utf8_sig(file_bytes)
        imported, skipped, errors = 0, 0, []
        for idx, row in enumerate(rows, start=2):
            try:
                code = (row.get("code") or "").strip()
                if not code:
                    skipped += 1
                    continue
                acc_type = AccountType((row.get("account_type") or "ASSET").strip().upper())
                existing = (
                    await db.execute(
                        select(ChartOfAccount).where(
                            ChartOfAccount.tenant_id == tenant_id, ChartOfAccount.code == code
                        )
                    )
                ).scalar_one_or_none()
                if existing:
                    skipped += 1
                    continue
                db.add(
                    ChartOfAccount(
                        tenant_id=tenant_id,
                        code=code,
                        name_ar=(row.get("name_ar") or code).strip(),
                        name_en=(row.get("name_en") or code).strip(),
                        account_type=acc_type,
                    )
                )
                imported += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})
        await db.commit()
        return {"entity_type": "accounts", "imported_rows": imported, "skipped_rows": skipped, "errors": errors}

    @staticmethod
    async def import_inventory_csv(db: AsyncSession, tenant_id: uuid.UUID, file_bytes: bytes) -> dict:
        rows = ImportExportService.parse_csv_utf8_sig(file_bytes)
        imported, skipped, errors = 0, 0, []
        for idx, row in enumerate(rows, start=2):
            try:
                name = (row.get("name") or "").strip()
                if not name:
                    skipped += 1
                    continue
                db.add(
                    InventoryItem(
                        tenant_id=tenant_id,
                        name=name,
                        category=(row.get("category") or "GENERAL").strip().upper(),
                        total_stock=int(row.get("total_stock") or 0),
                        unit_addon_price=Decimal(str(row.get("unit_addon_price") or "0.00")),
                    )
                )
                imported += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})
        await db.commit()
        return {"entity_type": "inventory", "imported_rows": imported, "skipped_rows": skipped, "errors": errors}

    @staticmethod
    async def import_guests_csv(
        db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID, file_bytes: bytes
    ) -> dict:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found for guest import")

        rows = ImportExportService.parse_csv_utf8_sig(file_bytes)
        imported, skipped, errors = 0, 0, []
        for idx, row in enumerate(rows, start=2):
            try:
                holder_name = (row.get("holder_name") or "").strip()
                if not holder_name:
                    skipped += 1
                    continue
                qr_token = f"QR-{event.event_code}-{uuid.uuid4().hex[:8].upper()}"
                db.add(
                    GatePass(
                        tenant_id=tenant_id,
                        event_id=event.id,
                        pass_type=(row.get("pass_type") or "VIP_PASS").strip().upper(),
                        holder_name=holder_name,
                        holder_id_number=(row.get("holder_id_number") or "").strip() or None,
                        qr_token=qr_token,
                        valid_from=event.start_time,
                        valid_until=event.end_time,
                    )
                )
                imported += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})
        await db.commit()
        return {"entity_type": "guests", "imported_rows": imported, "skipped_rows": skipped, "errors": errors}

    @staticmethod
    def _resolve_logo_data_uri(branding: Optional[TenantBranding]) -> Optional[str]:
        if not branding:
            return None
        raw_url = (branding.logo_light_url or branding.logo_dark_url or "").strip()
        if not raw_url.startswith("/media/"):
            return None
        try:
            rel = raw_url[len("/media/") :].lstrip("/")
            candidate = (MEDIA_ROOT / rel).resolve()
            if not str(candidate).startswith(str(MEDIA_ROOT.resolve())) or not candidate.is_file():
                return None
            mime, _ = mimetypes.guess_type(str(candidate))
            if not mime or not mime.startswith("image/"):
                return None
            raw = candidate.read_bytes()
            if len(raw) > 2 * 1024 * 1024:
                return None
            return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
        except Exception:
            return None

    @staticmethod
    def _base_styles(direction: str, primary: str, accent: str) -> str:
        return (
            f"@page {{ size: A4; margin: 16mm; }} "
            f"body {{ font-family: 'DejaVu Sans', sans-serif; color: #0f172a; font-size: 12px; line-height: 1.55; direction: {direction}; }} "
            f".banner {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid {primary}; padding-bottom: 12px; margin-bottom: 16px; }} "
            f".brand {{ display: flex; align-items: center; gap: 10px; }} "
            f".logo {{ max-height: 48px; max-width: 120px; border-radius: 6px; object-fit: contain; }} "
            f".title {{ color: {primary}; font-size: 19px; font-weight: bold; margin: 0; }} "
            f".subtitle {{ color: #475569; font-size: 11px; margin-top: 2px; }} "
            f".badge {{ background: {accent}; color: #fff; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: bold; }} "
            f".grid {{ display: table; width: 100%; border-collapse: separate; border-spacing: 8px; margin-bottom: 12px; }} "
            f".box {{ display: table-cell; width: 50%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc; vertical-align: top; }} "
            f".box h4 {{ margin: 0 0 6px 0; font-size: 11px; color: {primary}; text-transform: uppercase; }} "
            f"table.data {{ width: 100%; border-collapse: collapse; margin-top: 12px; }} "
            f"table.data th, table.data td {{ border: 1px solid #cbd5e1; padding: 8px 10px; text-align: start; font-size: 11px; }} "
            f"table.data th {{ background-color: #f1f5f9; font-weight: bold; color: #1e293b; }} "
            f".totrow {{ background-color: #fefce8; font-weight: bold; }} "
            f".clauses {{ white-space: pre-wrap; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #ffffff; font-size: 11px; line-height: 1.7; }} "
            f".siggrid {{ display: table; width: 100%; margin-top: 18px; border-collapse: separate; border-spacing: 12px; }} "
            f".sigbox {{ display: table-cell; width: 50%; border: 1px dashed #94a3b8; border-radius: 8px; padding: 10px; background: #f8fafc; }} "
            f".footer {{ margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 10px; color: #64748b; text-align: center; }}"
        )

    @staticmethod
    def _html_to_pdf_bytes(html_content: str) -> bytes:
        try:
            from weasyprint import HTML

            return HTML(string=html_content).write_pdf()
        except Exception:
            return html_content.encode("utf-8")

    @staticmethod
    def _extract_invoice_line_items(invoice: Invoice, is_rtl: bool) -> list[dict]:
        raw = invoice.line_items_json
        items: list[dict] = []
        if isinstance(raw, list):
            items = raw
        elif isinstance(raw, dict):
            if isinstance(raw.get("items"), list):
                items = raw["items"]
            else:
                for k in ("hall", "additional_halls", "catering", "addons", "custom_addons", "custom"):
                    val = raw.get(k)
                    if isinstance(val, list):
                        items.extend(val)
                    elif isinstance(val, dict):
                        items.append(val)
        parsed = []
        for it in items:
            if not isinstance(it, dict):
                continue
            label = (
                (it.get("label_ar") if is_rtl else it.get("label_en"))
                or it.get("name")
                or it.get("title")
                or it.get("description")
                or it.get("category")
                or ("بند خدمة" if is_rtl else "Service Line")
            )
            qty = it.get("quantity") or it.get("qty") or 1
            unit_p = Decimal(str(it.get("unit_price") or it.get("price") or 0))
            line_tot = Decimal(str(it.get("total") or it.get("amount") or (unit_p * Decimal(str(qty)))))
            parsed.append({"label": str(label), "qty": qty, "unit_price": unit_p, "total": line_tot})
        if not parsed:
            parsed.append(
                {
                    "label": "باقة الفعالية والقاعة الشاملة" if is_rtl else "Venue & Event Package Services",
                    "qty": 1,
                    "unit_price": Decimal(str(invoice.subtotal)),
                    "total": Decimal(str(invoice.subtotal)),
                }
            )
        return parsed

    @staticmethod
    async def _resolve_hall_label(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        event: Optional[Event],
        line_items_json: Optional[object],
        primary_hall: Optional[Hall],
        is_rtl: bool,
    ) -> str:
        from app.services.availability_service import AvailabilityService

        if not event:
            return (primary_hall.name_ar if is_rtl else primary_hall.name) if primary_hall else "-"
        ev_hall_ids = AvailabilityService.extract_booked_hall_ids(event, line_items_json)
        booked_map = (
            {
                h.id: h
                for h in (
                    await db.execute(select(Hall).where(Hall.id.in_(ev_hall_ids), Hall.tenant_id == tenant_id))
                ).scalars().all()
            }
            if ev_hall_ids
            else {}
        )
        return (
            " + ".join(
                (booked_map[hid].name_ar if is_rtl else booked_map[hid].name)
                for hid in ev_hall_ids
                if hid in booked_map
            )
            or ((primary_hall.name_ar if is_rtl else primary_hall.name) if primary_hall else "-")
        )

    @staticmethod
    async def render_invoice_pdf(
        db: AsyncSession, tenant_id: uuid.UUID, invoice_id: uuid.UUID, locale: str = "ar"
    ) -> bytes:
        invoice = (
            await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        tenant_label = ImportExportService._localized_tenant_name(tenant.name, locale)
        branding = (
            await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        ).scalar_one_or_none()
        event = (
            await db.execute(select(Event).where(Event.id == invoice.event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        hall = (
            (await db.execute(select(Hall).where(Hall.id == event.hall_id, Hall.tenant_id == tenant_id))).scalar_one_or_none()
            if event
            else None
        )
        client = (
            (
                await db.execute(
                    select(User).where(User.id == event.primary_client_id, User.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if event
            else None
        )
        client_prof = (
            (await db.execute(select(ClientProfile).where(ClientProfile.user_id == client.id))).scalar_one_or_none()
            if client
            else None
        )
        milestones = (
            await db.execute(
                select(PaymentMilestone)
                .where(PaymentMilestone.invoice_id == invoice.id, PaymentMilestone.tenant_id == tenant_id)
                .order_by(PaymentMilestone.due_date.asc())
            )
        ).scalars().all()

        primary = branding.primary_color if branding else "#D4AF37"
        accent = branding.accent_color if branding else "#0F172A"
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "فاتورة ضريبية وكشف حجز" if is_rtl else "Tax Invoice & Event Statement"
        footer = (branding.invoice_footer_ar if is_rtl else branding.invoice_footer_en) if branding else ""
        logo_uri = ImportExportService._resolve_logo_data_uri(branding)
        logo_html = f"<img class='logo' src='{logo_uri}' alt='Logo' />" if logo_uri else ""

        line_items = ImportExportService._extract_invoice_line_items(invoice, is_rtl)
        item_rows = "".join(
            f"<tr><td>{html.escape(it['label'])}</td><td>{it['qty']}</td>"
            f"<td>{it['unit_price']:,.2f} {tenant.currency}</td>"
            f"<td>{it['total']:,.2f} {tenant.currency}</td></tr>"
            for it in line_items
        )
        ms_rows = "".join(
            f"<tr><td>{html.escape(m.title)}{' (' + ('أمانة' if is_rtl else 'Deposit') + ')' if m.is_security_deposit else ''}</td>"
            f"<td>{m.due_date.strftime('%Y-%m-%d')}</td>"
            f"<td>{m.amount_due:,.2f} {tenant.currency}</td>"
            f"<td>{m.paid_amount:,.2f} {tenant.currency}</td>"
            f"<td>{html.escape(m.status)}</td></tr>"
            for m in milestones
        )

        hall_label = await ImportExportService._resolve_hall_label(
            db, tenant_id, event, invoice.line_items_json, hall, is_rtl
        )
        ev_label = f"{event.event_code}" + (f" — {event.title}" if event and event.title else "") if event else "-"
        ev_sched = (
            f"{event.start_time.strftime('%Y-%m-%d %H:%M')} → {event.end_time.strftime('%Y-%m-%d %H:%M')}"
            if event
            else "-"
        )
        disc_pct = Decimal(str(getattr(invoice, "discount_percent", 0) or 0))
        disc_label = (
            f"{'الخصم' if is_rtl else 'Discount'}" + (f" ({disc_pct:.2f}%)" if disc_pct > 0 else "")
        )

        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>{ImportExportService._base_styles(direction, primary, accent)}</style></head><body>"
            f"<div class='banner'><div class='brand'>{logo_html}"
            f"<div><div class='title'>{html.escape(tenant_label)}</div>"
            f"<div class='subtitle'>{title} · #{html.escape(invoice.invoice_number)} · {tenant.currency}</div></div></div>"
            f"<div class='badge'>{html.escape(invoice.status.value)}</div></div>"
            f"<div class='grid'>"
            f"<div class='box'><h4>{'بيانات العميل' if is_rtl else 'Client Details'}</h4>"
            f"<div><strong>{html.escape(client.full_name if client else '-')}</strong></div>"
            f"<div>{html.escape(client.phone if client else '-')}</div>"
            f"{'<div>' + html.escape(client_prof.company_name) + '</div>' if client_prof and client_prof.company_name else ''}"
            f"{'<div>Tax ID: ' + html.escape(client_prof.tax_id) + '</div>' if client_prof and client_prof.tax_id else ''}</div>"
            f"<div class='box'><h4>{'تفاصيل الفعالية والقاعة' if is_rtl else 'Event & Venue Details'}</h4>"
            f"<div><strong>{html.escape(ev_label)}</strong></div>"
            f"<div>{html.escape(hall_label)} · {event.guest_count if event else 0} {'ضيف' if is_rtl else 'guests'}</div>"
            f"<div dir='ltr'>{html.escape(ev_sched)}</div></div>"
            f"</div>"
            f"<table class='data'><thead><tr><th>{'البند / الخدمة' if is_rtl else 'Item / Service'}</th>"
            f"<th>{'الكمية' if is_rtl else 'Qty'}</th><th>{'سعر الوحدة' if is_rtl else 'Unit Price'}</th>"
            f"<th>{'الإجمالي' if is_rtl else 'Line Total'}</th></tr></thead><tbody>{item_rows}</tbody></table>"
            f"<table class='data'><tbody>"
            f"<tr><td>{'المجموع الفرعي' if is_rtl else 'Subtotal'}</td><td>{invoice.subtotal:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{disc_label}</td><td>-{invoice.discount_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'الضريبة' if is_rtl else 'Tax / VAT'}</td><td>{invoice.tax_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr class='totrow'><td>{'الإجمالي الصافي المستحق' if is_rtl else 'Net Invoice Total'}</td><td>{invoice.total_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'تأمين الأضرار المسترد (التزامات 2100)' if is_rtl else 'Refundable Security Deposit (Liability 2100)'}</td>"
            f"<td>{invoice.security_deposit_amount:,.2f} {tenant.currency} ({invoice.deposit_status.value})</td></tr>"
            f"</tbody></table>"
            f"<table class='data'><thead><tr><th>{'الدفعة' if is_rtl else 'Milestone'}</th><th>{'الاستحقاق' if is_rtl else 'Due Date'}</th>"
            f"<th>{'المستحق' if is_rtl else 'Due'}</th><th>{'المدفوع' if is_rtl else 'Paid'}</th>"
            f"<th>{'الحالة' if is_rtl else 'Status'}</th></tr></thead><tbody>{ms_rows}</tbody></table>"
            f"<div class='footer'>{html.escape(footer or '')}</div></body></html>"
        )
        return ImportExportService._html_to_pdf_bytes(html_content)

    @staticmethod
    async def render_contract_pdf(
        db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID, locale: str = "ar"
    ) -> bytes:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        contract = (
            await db.execute(
                select(EventContract).where(EventContract.event_id == event_id, EventContract.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        tenant_label = ImportExportService._localized_tenant_name(tenant.name, locale)
        branding = (
            await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        ).scalar_one_or_none()
        hall = (
            await db.execute(select(Hall).where(Hall.id == event.hall_id, Hall.tenant_id == tenant_id))
        ).scalar_one_or_none()
        client = (
            await db.execute(select(User).where(User.id == event.primary_client_id, User.tenant_id == tenant_id))
        ).scalar_one_or_none()
        inv = (
            await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == tenant_id))
        ).scalar_one_or_none()

        primary = branding.primary_color if branding else "#D4AF37"
        accent = branding.accent_color if branding else "#0F172A"
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "عقد إقامة وتنظيم فعالية" if is_rtl else "Event Venue & Services Agreement"
        footer = (branding.invoice_footer_ar if is_rtl else branding.invoice_footer_en) if branding else ""
        logo_uri = ImportExportService._resolve_logo_data_uri(branding)
        logo_html = f"<img class='logo' src='{logo_uri}' alt='Logo' />" if logo_uri else ""

        clauses_raw = contract.terms_ar if is_rtl else contract.terms_en
        hall_label = await ImportExportService._resolve_hall_label(
            db, tenant_id, event, inv.line_items_json if inv else None, hall, is_rtl
        )
        c_status = getattr(contract, "status", "DRAFT") or "DRAFT"
        client_sig = (
            f"{html.escape(contract.client_signature_name or '-')} ({contract.client_signed_at.strftime('%Y-%m-%d %H:%M')})"
            if contract.client_signed_at
            else ("بانتظار توقيع العميل" if is_rtl else "Pending Client Signature")
        )
        staff_sig = (
            f"{'معتمد وموقّع' if is_rtl else 'Countersigned'} ({contract.staff_countersigned_at.strftime('%Y-%m-%d %H:%M')})"
            if contract.staff_countersigned_at
            else ("بانتظار اعتماد الإدارة" if is_rtl else "Pending Venue Countersignature")
        )

        fin_summary = (
            f"{inv.total_amount:,.2f} {tenant.currency} · {'التأمين المسترد' if is_rtl else 'Security Deposit'}: "
            f"{inv.security_deposit_amount:,.2f} {tenant.currency}"
            if inv
            else "-"
        )

        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>{ImportExportService._base_styles(direction, primary, accent)}</style></head><body>"
            f"<div class='banner'><div class='brand'>{logo_html}"
            f"<div><div class='title'>{html.escape(tenant_label)} — {title}</div>"
            f"<div class='subtitle'>#{html.escape(contract.contract_number)} · {html.escape(event.event_code)}</div></div></div>"
            f"<div class='badge'>{html.escape(c_status)}</div></div>"
            f"<div class='grid'>"
            f"<div class='box'><h4>{'الطرف الأول (المنشأة)' if is_rtl else 'First Party (Venue)'}</h4>"
            f"<div><strong>{html.escape(tenant_label)}</strong></div>"
            f"<div>{'القاعة:' if is_rtl else 'Hall:'} {html.escape(hall_label)}</div>"
            f"<div>{'الموعد:' if is_rtl else 'Schedule:'} {event.start_time.strftime('%Y-%m-%d %H:%M')}</div></div>"
            f"<div class='box'><h4>{'الطرف الثاني (العميل)' if is_rtl else 'Second Party (Client)'}</h4>"
            f"<div><strong>{html.escape(client.full_name if client else '-')}</strong></div>"
            f"<div>{html.escape(client.phone if client else '-')}</div>"
            f"<div>{'القيمة المالية:' if is_rtl else 'Contract Financials:'} {html.escape(fin_summary)}</div></div>"
            f"</div>"
            f"<div class='clauses'>{html.escape(clauses_raw or '')}</div>"
            f"<div class='siggrid'>"
            f"<div class='sigbox'><strong>{'توقيع العميل الإلكتروني' if is_rtl else 'Client E-Signature'}</strong><div>{client_sig}</div></div>"
            f"<div class='sigbox'><strong>{'اعتماد إدارة المنشأة' if is_rtl else 'Venue Management Approval'}</strong><div>{staff_sig}</div></div>"
            f"</div>"
            f"<div class='footer'>{html.escape(footer or '')}</div></body></html>"
        )
        return ImportExportService._html_to_pdf_bytes(html_content)

    @staticmethod
    async def render_deposit_settlement_pdf(
        db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID, locale: str = "ar"
    ) -> bytes:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        inv = (
            await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found for event")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        tenant_label = ImportExportService._localized_tenant_name(tenant.name, locale)
        branding = (
            await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        ).scalar_one_or_none()
        client = (
            await db.execute(select(User).where(User.id == event.primary_client_id, User.tenant_id == tenant_id))
        ).scalar_one_or_none()
        insp = (
            await db.execute(
                select(DamageInspection).where(
                    DamageInspection.event_id == event_id, DamageInspection.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        je_num = None
        if getattr(inv, "refund_journal_entry_id", None):
            je = (
                await db.execute(
                    select(JournalEntry).where(
                        JournalEntry.id == inv.refund_journal_entry_id,
                        JournalEntry.tenant_id == tenant_id,
                    )
                )
            ).scalar_one_or_none()
            je_num = je.entry_number if je else None

        primary = branding.primary_color if branding else "#D4AF37"
        accent = branding.accent_color if branding else "#0F172A"
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "سند تسوية ورد مبلغ التأمين المسترد" if is_rtl else "Security Deposit Settlement & Refund Voucher"
        footer = (branding.invoice_footer_ar if is_rtl else branding.invoice_footer_en) if branding else ""
        logo_uri = ImportExportService._resolve_logo_data_uri(branding)
        logo_html = f"<img class='logo' src='{logo_uri}' alt='Logo' />" if logo_uri else ""

        held_amt = Decimal(str(inv.security_deposit_amount))
        deduct_amt = Decimal(str(insp.deduction_amount)) if insp else Decimal("0.00")
        net_refund = max(Decimal("0.00"), held_amt - deduct_amt).quantize(Decimal("0.01"))
        voucher_no = getattr(inv, "refund_voucher_number", None) or f"SETTLE-{inv.invoice_number}"

        ded_items = (insp.deduction_items_json or []) if insp else []
        ded_rows = "".join(
            f"<tr><td>{html.escape(str(it.get('description') or it.get('label') or '-'))}</td>"
            f"<td>{Decimal(str(it.get('amount') or 0)):,.2f} {tenant.currency}</td></tr>"
            for it in ded_items
            if isinstance(it, dict)
        ) or f"<tr><td colspan='2'>{'لا توجد أضرار أو خصومات مسجلة' if is_rtl else 'No damage deductions recorded'}</td></tr>"

        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>{ImportExportService._base_styles(direction, primary, accent)}</style></head><body>"
            f"<div class='banner'><div class='brand'>{logo_html}"
            f"<div><div class='title'>{html.escape(tenant_label)} — {title}</div>"
            f"<div class='subtitle'>{html.escape(voucher_no)} · {html.escape(inv.invoice_number)} · {html.escape(event.event_code)}</div></div></div>"
            f"<div class='badge'>{html.escape(inv.deposit_status.value)}</div></div>"
            f"<div class='grid'>"
            f"<div class='box'><h4>{'بيانات العميل' if is_rtl else 'Client'}</h4>"
            f"<div><strong>{html.escape(client.full_name if client else '-')}</strong></div>"
            f"<div>{html.escape(client.phone if client else '-')}</div></div>"
            f"<div class='box'><h4>{'تفاصيل التسوية المحاسبية' if is_rtl else 'Settlement Reference'}</h4>"
            f"<div>{'طريقة الصرف:' if is_rtl else 'Payout Method:'} {html.escape(getattr(inv, 'refund_payment_method', None) or '-')}</div>"
            f"<div>{'المرجع:' if is_rtl else 'Reference:'} {html.escape(getattr(inv, 'refund_reference', None) or '-')}</div>"
            f"<div>{'قيد اليومية (2100):' if is_rtl else 'GL Entry (2100):'} {html.escape(je_num or '-')}</div></div>"
            f"</div>"
            f"<table class='data'><thead><tr><th>{'بيان خصم الفحص بعد الفعالية' if is_rtl else 'Post-Event Inspection Item'}</th>"
            f"<th>{'المبلغ المخصوم' if is_rtl else 'Deducted'}</th></tr></thead><tbody>{ded_rows}</tbody></table>"
            f"<table class='data'><tbody>"
            f"<tr><td>{'تأمين الأضرار المحصل (التزامات 2100)' if is_rtl else 'Collected Security Deposit (GL 2100)'}</td><td>{held_amt:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'إجمالي الاستقطاعات / الأضرار (إيراد 4200)' if is_rtl else 'Total Damage Deductions (GL 4200)'}</td><td>-{deduct_amt:,.2f} {tenant.currency}</td></tr>"
            f"<tr class='totrow'><td>{'صافي المبلغ المسترد للعميل' if is_rtl else 'Net Refundable / Paid Out to Client'}</td><td>{net_refund:,.2f} {tenant.currency}</td></tr>"
            f"</tbody></table>"
            f"<div class='footer'>{html.escape(event.closing_remarks or footer or '')}</div></body></html>"
        )
        return ImportExportService._html_to_pdf_bytes(html_content)

    @staticmethod
    async def render_beo_pdf(
        db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID, locale: str = "ar"
    ) -> bytes:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        tenant_label = ImportExportService._localized_tenant_name(tenant.name, locale)
        hall = (await db.execute(select(Hall).where(Hall.id == event.hall_id, Hall.tenant_id == tenant_id))).scalar_one_or_none()
        branding = (
            await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        ).scalar_one_or_none()

        allocs = (
            await db.execute(
                select(EventInventoryAllocation, InventoryItem)
                .join(InventoryItem, EventInventoryAllocation.item_id == InventoryItem.id)
                .where(
                    EventInventoryAllocation.event_id == event.id,
                    EventInventoryAllocation.tenant_id == tenant_id,
                )
            )
        ).all()

        drafts = (
            await db.execute(
                select(EventDraft)
                .where(
                    EventDraft.event_id == event.id,
                    EventDraft.tenant_id == tenant_id,
                    EventDraft.status == DraftStatus.APPROVED_SYNCED,
                )
                .order_by(EventDraft.version_number.desc())
            )
        ).scalars().all()
        floor_plan = next((d.payload for d in drafts if d.draft_type == DraftType.FLOOR_PLAN), None)

        primary = branding.primary_color if branding else "#D4AF37"
        accent = branding.accent_color if branding else "#0F172A"
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "أمر تشغيل الفعالية (BEO)" if is_rtl else "Banquet Event Order (BEO)"
        beo_inv = (
            await db.execute(select(Invoice).where(Invoice.event_id == event.id, Invoice.tenant_id == tenant_id))
        ).scalar_one_or_none()
        hall_label = await ImportExportService._resolve_hall_label(
            db, tenant_id, event, beo_inv.line_items_json if beo_inv else None, hall, is_rtl
        )
        logo_uri = ImportExportService._resolve_logo_data_uri(branding)
        logo_html = f"<img class='logo' src='{logo_uri}' alt='Logo' />" if logo_uri else ""

        inv_rows = "".join(
            f"<tr><td>{html.escape(item.name)}</td><td>{alloc.quantity_reserved}</td></tr>" for alloc, item in allocs
        ) or f"<tr><td colspan='2'>{'لا توجد تجهيزات مخصصة' if is_rtl else 'No reserved inventory items'}</td></tr>"

        elements_count = len((floor_plan or {}).get("elements", []))
        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>{ImportExportService._base_styles(direction, primary, accent)}</style></head><body>"
            f"<div class='banner'><div class='brand'>{logo_html}"
            f"<div><div class='title'>{html.escape(tenant_label)} — {title}</div>"
            f"<div class='subtitle'>{html.escape(event.event_code)} | {html.escape(hall_label)} | {event.guest_count} {'ضيف' if is_rtl else 'guests'}</div></div></div></div>"
            f"<p><strong>{'الوقت' if is_rtl else 'Schedule'}:</strong> {event.start_time.isoformat()} → {event.end_time.isoformat()}</p>"
            f"<p><strong>{'عناصر المخطط المعتمد' if is_rtl else 'Approved Floor Plan Elements'}:</strong> {elements_count}</p>"
            f"<table class='data'><thead><tr><th>{'التجهيز' if is_rtl else 'Equipment / Item'}</th>"
            f"<th>{'الكمية' if is_rtl else 'Qty'}</th></tr></thead><tbody>{inv_rows}</tbody></table></body></html>"
        )
        return ImportExportService._html_to_pdf_bytes(html_content)
