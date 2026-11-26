import csv
import io
import uuid
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import ChartOfAccount, AccountType, Invoice
from app.models.tenant import Tenant, TenantBranding


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
    async def import_chart_of_accounts_csv(
        db: AsyncSession, tenant_id: uuid.UUID, file_bytes: bytes
    ) -> dict:
        text = file_bytes.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        created, errors = 0, []

        for idx, row in enumerate(reader, start=2):
            try:
                code = row["code"].strip()
                acc_type = AccountType(row["account_type"].strip().upper())
                existing = await db.execute(
                    select(ChartOfAccount).where(
                        ChartOfAccount.tenant_id == tenant_id, ChartOfAccount.code == code
                    )
                )
                if existing.scalar_one_or_none():
                    continue
                db.add(
                    ChartOfAccount(
                        tenant_id=tenant_id,
                        code=code,
                        name_ar=row["name_ar"].strip(),
                        name_en=row["name_en"].strip(),
                        account_type=acc_type,
                    )
                )
                created += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})

        await db.commit()
        return {"imported": created, "errors": errors}

    @staticmethod
    async def render_invoice_pdf(
        db: AsyncSession, tenant_id: uuid.UUID, invoice_id: uuid.UUID, locale: str = "ar"
    ) -> bytes:
        inv_res = await db.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
        )
        invoice = inv_res.scalar_one_or_none()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_res.scalar_one()
        brand_res = await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant_id))
        branding = brand_res.scalar_one_or_none()

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
        try:
            from weasyprint import HTML
            return HTML(string=html_content).write_pdf()
        except Exception:
            return html_content.encode("utf-8")
