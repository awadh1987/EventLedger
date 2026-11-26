import type { TenantBrandingConfig } from '@/components/providers/theme-branding-provider';
import type { InvoiceLineItem, InvoiceMilestone } from '@db/schema.ts';

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  eventId: string;
  eventCode: string;
  clientNameEn: string;
  clientNameAr: string;
  clientPhone: string;
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  securityDepositAmount: number;
  depositStatus: string;
  currency: string;
  status: string;
  lineItems: InvoiceLineItem[];
  milestones: InvoiceMilestone[];
  issuedAt: string;
  dueDate: string;
}

export interface PaymentMethodRecord {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  providerType: string;
  accountName: string;
  accountNumber: string;
  instructionsEn: string;
  instructionsAr: string;
  isActive: boolean;
  sortOrder: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(amount: number, currency: string, locale: 'ar' | 'en'): string {
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-YE' : 'en-US').format(amount)} ${currency}`;
}

function fmtDate(iso: string, locale: 'ar' | 'en'): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

export function buildBrandedInvoiceHtml(
  invoice: InvoiceRecord,
  branding: TenantBrandingConfig,
  locale: 'ar' | 'en',
  paymentMethods: PaymentMethodRecord[] = []
): string {
  const isRtl = locale === 'ar';
  const dir = isRtl ? 'rtl' : 'ltr';
  const primary = branding.primaryColor || '#D4AF37';
  const accent = branding.accentColor || '#0F172A';
  const venueName = isRtl ? branding.venueNameAr : branding.venueNameEn;
  const venueAlt = isRtl ? branding.venueNameEn : branding.venueNameAr;
  const address = isRtl ? branding.addressAr : branding.addressEn;
  const footer = isRtl ? branding.invoiceFooterAr : branding.invoiceFooterEn;
  const balanceDue = Math.max(0, invoice.totalAmount - invoice.paidAmount);

  const lineRows = invoice.lineItems
    .map(
      (item, idx) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-family:monospace;">${idx + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:500;color:#0f172a;">${escapeHtml(
          isRtl ? item.descriptionAr : item.descriptionEn
        )}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:monospace;">${item.quantity}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:${isRtl ? 'left' : 'right'};font-family:monospace;">${escapeHtml(
          fmtMoney(item.unitPrice, invoice.currency, locale)
        )}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:${isRtl ? 'left' : 'right'};font-weight:600;font-family:monospace;color:#0f172a;">${escapeHtml(
          fmtMoney(item.total, invoice.currency, locale)
        )}</td>
      </tr>`
    )
    .join('');

  const milestoneRows = invoice.milestones
    .map(
      (ms) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:500;">${escapeHtml(
          isRtl ? ms.titleAr : ms.titleEn
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(
          fmtDate(ms.dueDate, locale)
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(
          fmtMoney(ms.amountDue, invoice.currency, locale)
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(
          ms.paymentMethod || '—'
        )}${ms.referenceNumber ? ` · ${escapeHtml(ms.referenceNumber)}` : ''}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:${
          ms.status === 'PAID' ? '#15803d' : '#b45309'
        };">${ms.status === 'PAID' ? (isRtl ? 'مدفوعة' : 'PAID') : isRtl ? 'مستحقة' : 'PENDING'}</td>
      </tr>`
    )
    .join('');

  const activeMethodsHtml = paymentMethods
    .filter((pm) => pm.isActive)
    .slice(0, 4)
    .map(
      (pm) => `
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
        <div style="font-size:11px;font-weight:700;color:#0f172a;">${escapeHtml(
          isRtl ? pm.nameAr : pm.nameEn
        )}</div>
        <div style="font-size:11px;font-family:monospace;color:#334155;margin-top:2px;">${escapeHtml(
          pm.accountNumber
        )}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px;">${escapeHtml(pm.accountName)}</div>
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(invoice.invoiceNumber)} — ${escapeHtml(venueName)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet { max-width: 820px; margin: 0 auto; }
    .topbar { height: 6px; background: ${escapeHtml(primary)}; border-radius: 3px; margin-bottom: 20px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 18px; }
    .brand-title { font-size: 22px; font-weight: 700; color: ${escapeHtml(accent)}; margin: 0; }
    .brand-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    .inv-meta { text-align: ${isRtl ? 'left' : 'right'}; }
    .inv-code { font-size: 20px; font-weight: 700; font-family: monospace; color: #0f172a; }
    .inv-status { font-size: 12px; font-weight: 700; color: ${
      invoice.status === 'PAID' ? '#15803d' : '#b45309'
    }; margin-top: 4px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0; }
    .box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; background: #f8fafc; }
    .box-label { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
    th { background: ${escapeHtml(accent)}; color: #ffffff; padding: 10px 12px; text-align: ${
      isRtl ? 'right' : 'left'
    }; font-weight: 600; }
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 16px; }
    .totals { width: 320px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; font-size: 12px; }
    .tot-row { display: flex; justify-content: space-between; padding: 5px 0; }
    .tot-final { border-top: 2px solid ${escapeHtml(primary)}; margin-top: 6px; padding-top: 8px; font-size: 14px; font-weight: 700; }
    .methods-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
    .footer { margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #475569; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="topbar"></div>
    <div class="header">
      <div>
        <h1 class="brand-title">${escapeHtml(venueName)}</h1>
        <div class="brand-sub">${escapeHtml(venueAlt)}</div>
        <div class="brand-sub">${escapeHtml(address)} · ${escapeHtml(branding.contactPhone)} · ${escapeHtml(
          branding.contactEmail
        )}</div>
      </div>
      <div class="inv-meta">
        <div style="font-size:11px;color:#64748b;">${isRtl ? 'فاتورة ضريبية / مستند حجز' : 'TAX INVOICE & EVENT STATEMENT'}</div>
        <div class="inv-code">${escapeHtml(invoice.invoiceNumber)}</div>
        <div class="inv-status">${escapeHtml(invoice.status)} · ${escapeHtml(invoice.eventCode)}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="box">
        <div class="box-label">${isRtl ? 'بيانات العميل' : 'Billed To'}</div>
        <div style="font-size:14px;font-weight:700;">${escapeHtml(
          isRtl ? invoice.clientNameAr : invoice.clientNameEn
        )}</div>
        <div style="font-size:12px;color:#475569;margin-top:4px;font-family:monospace;">${escapeHtml(
          invoice.clientPhone
        )}</div>
      </div>
      <div class="box">
        <div class="box-label">${isRtl ? 'تواريخ وتأمين الفعالية' : 'Invoice Dates & Deposit'}</div>
        <div style="font-size:12px;display:flex;justify-content:space-between;"><span>${
          isRtl ? 'تاريخ الإصدار:' : 'Issued:'
        }</span><strong style="font-family:monospace;">${escapeHtml(fmtDate(invoice.issuedAt, locale))}</strong></div>
        <div style="font-size:12px;display:flex;justify-content:space-between;margin-top:4px;"><span>${
          isRtl ? 'تاريخ الاستحقاق:' : 'Due Date:'
        }</span><strong style="font-family:monospace;">${escapeHtml(fmtDate(invoice.dueDate, locale))}</strong></div>
        <div style="font-size:12px;display:flex;justify-content:space-between;margin-top:4px;"><span>${
          isRtl ? 'تأمين الأضرار المسترد:' : 'Security Deposit:'
        }</span><strong style="font-family:monospace;">${escapeHtml(
          fmtMoney(invoice.securityDepositAmount, invoice.currency, locale)
        )} (${escapeHtml(invoice.depositStatus)})</strong></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:40px;">#</th>
          <th>${isRtl ? 'البند والخدمة' : 'Item & Service Description'}</th>
          <th style="width:70px;text-align:center;">${isRtl ? 'الكمية' : 'Qty'}</th>
          <th style="width:130px;text-align:${isRtl ? 'left' : 'right'};">${isRtl ? 'سعر الوحدة' : 'Unit Price'}</th>
          <th style="width:140px;text-align:${isRtl ? 'left' : 'right'};">${isRtl ? 'الإجمالي' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="tot-row"><span>${isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span><span style="font-family:monospace;">${escapeHtml(
          fmtMoney(invoice.subtotal, invoice.currency, locale)
        )}</span></div>
        ${
          invoice.discountAmount > 0
            ? `<div class="tot-row"><span>${isRtl ? 'الخصم' : 'Discount'}</span><span style="font-family:monospace;">-${escapeHtml(
                fmtMoney(invoice.discountAmount, invoice.currency, locale)
              )}</span></div>`
            : ''
        }
        <div class="tot-row"><span>${isRtl ? `الضريبة (${invoice.taxRate}%)` : `Tax (${invoice.taxRate}%)`}</span><span style="font-family:monospace;">${escapeHtml(
          fmtMoney(invoice.taxAmount, invoice.currency, locale)
        )}</span></div>
        <div class="tot-row tot-final"><span>${isRtl ? 'الإجمالي المستحق' : 'Grand Total'}</span><span style="font-family:monospace;">${escapeHtml(
          fmtMoney(invoice.totalAmount, invoice.currency, locale)
        )}</span></div>
        <div class="tot-row" style="color:#15803d;"><span>${isRtl ? 'المدفوع حتى الآن' : 'Amount Paid'}</span><span style="font-family:monospace;font-weight:600;">${escapeHtml(
          fmtMoney(invoice.paidAmount, invoice.currency, locale)
        )}</span></div>
        <div class="tot-row" style="color:#b45309;font-weight:700;"><span>${
          isRtl ? 'الرصيد المتبقي' : 'Balance Due'
        }</span><span style="font-family:monospace;">${escapeHtml(
          fmtMoney(balanceDue, invoice.currency, locale)
        )}</span></div>
      </div>
    </div>

    <div style="margin-top:20px;">
      <div style="font-size:12px;font-weight:700;color:#0f172a;">${
        isRtl ? 'جدول الدفعات والمراحل (Payment Milestones)' : 'Payment Milestones Schedule'
      }</div>
      <table>
        <thead>
          <tr>
            <th>${isRtl ? 'المرحلة' : 'Milestone'}</th>
            <th>${isRtl ? 'الاستحقاق' : 'Due Date'}</th>
            <th>${isRtl ? 'المبلغ' : 'Amount'}</th>
            <th>${isRtl ? 'وسيلة الدفع والمرجع' : 'Method & Ref'}</th>
            <th>${isRtl ? 'الحالة' : 'Status'}</th>
          </tr>
        </thead>
        <tbody>
          ${milestoneRows}
        </tbody>
      </table>
    </div>

    ${
      activeMethodsHtml
        ? `<div style="margin-top:18px;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;">${
              isRtl ? 'حسابات ووسائل الدفع المعتمدة' : 'Accepted Payment Channels'
            }</div>
            <div class="methods-grid">${activeMethodsHtml}</div>
          </div>`
        : ''
    }

    <div class="footer">
      <div>${escapeHtml(footer)}</div>
      <div style="margin-top:6px;font-family:monospace;color:#64748b;">${escapeHtml(
        branding.customDomain
      )} · ${escapeHtml(invoice.invoiceNumber)}</div>
    </div>
  </div>
</body>
</html>`;
}

export function printInvoicePdf(
  invoice: InvoiceRecord,
  branding: TenantBrandingConfig,
  locale: 'ar' | 'en',
  paymentMethods: PaymentMethodRecord[] = []
): void {
  const html = buildBrandedInvoiceHtml(invoice, branding, locale, paymentMethods);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1500);
    }
  }, 250);
}

export function downloadInvoiceHtml(
  invoice: InvoiceRecord,
  branding: TenantBrandingConfig,
  locale: 'ar' | 'en',
  paymentMethods: PaymentMethodRecord[] = []
): void {
  const html = buildBrandedInvoiceHtml(invoice, branding, locale, paymentMethods);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoice.invoiceNumber}-${locale}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadInvoicesCsv(invoices: InvoiceRecord[], locale: 'ar' | 'en'): void {
  const headers =
    locale === 'ar'
      ? ['رقم الفاتورة', 'رقم الفعالية', 'العميل', 'المجموع الفرعي', 'الضريبة', 'الإجمالي', 'المدفوع', 'التأمين', 'حالة الفاتورة', 'العملة']
      : ['Invoice #', 'Event Code', 'Client', 'Subtotal', 'Tax', 'Total', 'Paid', 'Security Deposit', 'Status', 'Currency'];

  const rows = invoices.map((inv) => [
    inv.invoiceNumber,
    inv.eventCode,
    locale === 'ar' ? inv.clientNameAr : inv.clientNameEn,
    String(inv.subtotal),
    String(inv.taxAmount),
    String(inv.totalAmount),
    String(inv.paidAmount),
    `${inv.securityDepositAmount} (${inv.depositStatus})`,
    inv.status,
    inv.currency,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eventledger-invoices-${locale}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
