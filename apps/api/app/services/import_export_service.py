import csv
import io
import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import AccountType, ChartOfAccount, Invoice
from app.models.events import DraftStatus, DraftType, Event, EventDraft, GatePass
from app.models.tenant import Tenant, TenantBranding
from app.models.venue import EventInventoryAllocation, Hall, InventoryItem


class ImportExportService:
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
    def _html_to_pdf_bytes(html_content: str) -> bytes:
        try:
            from weasyprint import HTML

            return HTML(string=html_content).write_pdf()
        except Exception:
            return html_content.encode("utf-8")

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
        branding = (
            await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        ).scalar_one_or_none()

        primary = branding.primary_color if branding else "#D4AF37"
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "فاتورة ضريبية وكشف حجز" if is_rtl else "Tax Invoice & Event Statement"
        footer = (branding.invoice_footer_ar if is_rtl else branding.invoice_footer_en) if branding else ""

        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>@page {{ size: A4; margin: 18mm; }} "
            f"body {{ font-family: 'DejaVu Sans', sans-serif; color: #1e293b; direction: {direction}; }} "
            f".header {{ border-bottom: 3px solid {primary}; padding-bottom: 12px; margin-bottom: 20px; }} "
            f".title {{ color: {primary}; font-size: 22px; font-weight: bold; }} "
            f"table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }} "
            f"th, td {{ border: 1px solid #cbd5e1; padding: 10px; text-align: start; }} "
            f"th {{ background-color: #f8fafc; }} "
            f".footer {{ margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }}</style></head>"
            f"<body><div class='header'><div class='title'>{tenant.name} — {title}</div>"
            f"<div>#{invoice.invoice_number} | {tenant.currency}</div></div>"
            f"<table><thead><tr><th>{'البيان' if is_rtl else 'Description'}</th>"
            f"<th>{'المبلغ' if is_rtl else 'Amount'}</th></tr></thead><tbody>"
            f"<tr><td>{'المجموع الفرعي' if is_rtl else 'Subtotal'}</td><td>{invoice.subtotal:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'الخصم' if is_rtl else 'Discount'}</td><td>-{invoice.discount_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td>{'الضريبة' if is_rtl else 'Tax'}</td><td>{invoice.tax_amount:,.2f} {tenant.currency}</td></tr>"
            f"<tr><td><strong>{'الإجمالي المستحق' if is_rtl else 'Total Due'}</strong></td>"
            f"<td><strong>{invoice.total_amount:,.2f} {tenant.currency}</strong></td></tr>"
            f"<tr><td>{'تأمين الأضرار المسترد (أمانة)' if is_rtl else 'Refundable Security Deposit'}</td>"
            f"<td>{invoice.security_deposit_amount:,.2f} {tenant.currency} ({invoice.deposit_status.value})</td></tr>"
            f"</tbody></table><div class='footer'>{footer or ''}</div></body></html>"
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
        is_rtl = locale == "ar"
        direction = "rtl" if is_rtl else "ltr"
        title = "أمر تشغيل الفعالية (BEO)" if is_rtl else "Banquet Event Order (BEO)"
        hall_label = (hall.name_ar if is_rtl else hall.name) if hall else "-"

        inv_rows = "".join(
            f"<tr><td>{item.name}</td><td>{alloc.quantity_reserved}</td></tr>" for alloc, item in allocs
        ) or f"<tr><td colspan='2'>{'لا توجد تجهيزات مخصصة' if is_rtl else 'No reserved inventory items'}</td></tr>"

        elements_count = len((floor_plan or {}).get("elements", []))
        html_content = (
            f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"><head><meta charset="utf-8" />'
            f"<style>@page {{ size: A4; margin: 16mm; }} "
            f"body {{ font-family: 'DejaVu Sans', sans-serif; color: #0f172a; direction: {direction}; }} "
            f".header {{ border-bottom: 3px solid {primary}; padding-bottom: 10px; margin-bottom: 16px; }} "
            f".title {{ color: {primary}; font-size: 20px; font-weight: bold; }} "
            f"table {{ width: 100%; border-collapse: collapse; margin-top: 14px; }} "
            f"th, td {{ border: 1px solid #cbd5e1; padding: 8px; text-align: start; }}</style></head>"
            f"<body><div class='header'><div class='title'>{tenant.name} — {title}</div>"
            f"<div>{event.event_code} | {hall_label} | {event.guest_count} {'ضيف' if is_rtl else 'guests'}</div></div>"
            f"<p><strong>{'الوقت' if is_rtl else 'Schedule'}:</strong> {event.start_time.isoformat()} → {event.end_time.isoformat()}</p>"
            f"<p><strong>{'عناصر المخطط المعتمد' if is_rtl else 'Approved Floor Plan Elements'}:</strong> {elements_count}</p>"
            f"<table><thead><tr><th>{'التجهيز' if is_rtl else 'Equipment / Item'}</th>"
            f"<th>{'الكمية' if is_rtl else 'Qty'}</th></tr></thead><tbody>{inv_rows}</tbody></table></body></html>"
        )
        return ImportExportService._html_to_pdf_bytes(html_content)
