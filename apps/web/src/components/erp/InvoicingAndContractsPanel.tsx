'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileDown,
  FileSignature,
  Percent,
  RotateCcw,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, tenantPath } from '@/lib/api';
import { BackButton } from '@/components/ui/BackButton';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export interface ErpInvoiceDetail {
  id: string;
  invoice_number: string;
  event_id: string;
  event_code: string;
  event_title?: string | null;
  client_name: string;
  client_phone?: string | null;
  subtotal?: number;
  discount_percent?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_amount: number;
  paid_amount: number;
  security_deposit_amount: number;
  deposit_status: string;
  refund_voucher_number?: string | null;
  status: string;
  line_items?: unknown;
  milestones: {
    id: string;
    title: string;
    amount_due: number;
    paid_amount: number;
    payment_method: string | null;
    receipt_url?: string | null;
    is_security_deposit?: boolean;
    status: string;
    reviewer_remarks?: string | null;
  }[];
}

interface ContractModalData {
  id?: string;
  event_id: string;
  event_code: string;
  contract_number?: string;
  status: string;
  terms_ar: string;
  terms_en: string;
  remarks: string;
  amendment_remarks: string;
  client_signed_at?: string | null;
  client_signature_name?: string | null;
  staff_countersigned_at?: string | null;
}

interface Props {
  locale: 'ar' | 'en';
  tenantSlug: string | null;
  invoices: ErpInvoiceDetail[];
  onRefresh: () => Promise<void> | void;
}

function parseDisplayLineItems(raw: unknown, isRtl: boolean): { label: string; qty: string | number; total: number }[] {
  let items: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    items = raw.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      items = obj.items.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
    } else {
      for (const k of ['hall', 'additional_halls', 'catering', 'addons', 'custom_addons', 'custom']) {
        const val = obj[k];
        if (Array.isArray(val)) items.push(...val.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')));
        else if (val && typeof val === 'object') items.push(val as Record<string, unknown>);
      }
    }
  }
  return items.map((it) => ({
    label: String(
      (isRtl ? it.label_ar : it.label_en) || it.name || it.title || it.description || it.category || 'Item'
    ),
    qty: (it.quantity as number) ?? (it.qty as number) ?? 1,
    total: Number(it.total ?? it.amount ?? it.unit_price ?? 0),
  }));
}

export function InvoicingAndContractsPanel({ locale, tenantSlug, invoices, onRefresh }: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-milestone verify / return inputs
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [returnTargetId, setReturnTargetId] = useState<string | null>(null);
  const [returnRemarks, setReturnRemarks] = useState('');

  // Per-invoice discount inputs
  const [discountInputs, setDiscountInputs] = useState<Record<string, string>>({});
  const [discountNotes, setDiscountNotes] = useState<Record<string, string>>({});

  // AI Contract Studio modal
  const [contractModal, setContractModal] = useState<ContractModalData | null>(null);
  const [aiNotes, setAiNotes] = useState('');

  const verifyMilestone = async (mId: string, isDeposit = false, defaultMethod?: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ journal_entry_number: string }>(`/api/v1/erp/finance/milestones/${mId}/verify`, {
        method: 'PATCH',
        body: {
          payment_method: methods[mId] || defaultMethod || 'KURAIMI_BANK',
          is_security_deposit: isDeposit,
          reference: refs[mId] || 'ERP Verified Transfer',
        },
      });
      setNotice(tr(`تم اعتماد الدفعة وترحيل القيد ${res.journal_entry_number}`, `Milestone verified & posted GL ${res.journal_entry_number}`));
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const submitReturnMilestone = async (mId: string) => {
    if (returnRemarks.trim().length < 2) {
      setError(tr('يرجى إدخال سبب الإعادة للعميل.', 'Provide clear return remarks for the client.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/erp/finance/milestones/${mId}/return`, {
        method: 'PATCH',
        body: { remarks: returnRemarks.trim() },
      });
      setNotice(tr('تمت إعادة الإيصال للعميل للتعديل وإرسال إشعار.', 'Receipt returned for amendment & client notified.'));
      setReturnTargetId(null);
      setReturnRemarks('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to return milestone');
    } finally {
      setBusy(false);
    }
  };

  const applyDiscount = async (inv: ErpInvoiceDetail) => {
    const rawPct = discountInputs[inv.id] ?? String(inv.discount_percent ?? 0);
    const pct = Number(rawPct);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      setError(tr('أدخل نسبة خصم صحيحة بين 0 و 100%', 'Enter a valid discount percentage (0–100%).'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ total_amount: number; discount_amount: number; journal_entry_number?: string | null }>(
        `/api/v1/erp/finance/invoices/${inv.id}/discount`,
        {
          method: 'PATCH',
          body: { discount_percent: pct, remarks: discountNotes[inv.id] || null },
        }
      );
      setNotice(
        tr(
          `تم تطبيق خصم ${pct}% (صافي الفاتورة: ${res.total_amount.toLocaleString()}) ${res.journal_entry_number ? `· قيد ${res.journal_entry_number}` : ''}`,
          `Discount ${pct}% applied (New Total: ${res.total_amount.toLocaleString()}) ${res.journal_entry_number ? `· GL ${res.journal_entry_number}` : ''}`
        )
      );
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply discount');
    } finally {
      setBusy(false);
    }
  };

  const shareDoc = async (
    eventId: string,
    documentType: 'INVOICE' | 'CONTRACT' | 'DEPOSIT_SETTLEMENT',
    channel: 'WHATSAPP' | 'EMAIL',
    phone?: string | null
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ delivery_status: string; whatsapp_url?: string | null; mailto_url?: string | null; download_url: string }>(
        `/api/v1/events/${eventId}/share-document`,
        {
          method: 'POST',
          body: { document_type: documentType, channel, recipient_phone: phone || null, locale },
        }
      );
      setNotice(
        tr(
          `تم تسجيل ومشاركة المستند عبر ${channel} (${res.delivery_status})`,
          `Document shared via ${channel} (${res.delivery_status})`
        )
      );
      if (channel === 'WHATSAPP' && res.whatsapp_url && typeof window !== 'undefined') {
        window.open(res.whatsapp_url, '_blank', 'noopener,noreferrer');
      } else if (channel === 'EMAIL' && res.mailto_url && typeof window !== 'undefined') {
        window.open(res.mailto_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
    } finally {
      setBusy(false);
    }
  };

  const openContractStudio = async (inv: ErpInvoiceDetail) => {
    setBusy(true);
    setError(null);
    try {
      const existing = await apiFetch<ContractModalData>(`/api/v1/portal/events/${inv.event_id}/contract`).catch(() => null);
      if (existing) {
        setContractModal({
          ...existing,
          event_code: inv.event_code,
          remarks: existing.remarks || '',
          amendment_remarks: existing.amendment_remarks || '',
        });
      } else {
        setContractModal({
          event_id: inv.event_id,
          event_code: inv.event_code,
          status: 'DRAFT',
          terms_ar: '',
          terms_en: '',
          remarks: '',
          amendment_remarks: '',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const generateAiContract = async () => {
    if (!contractModal) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<ContractModalData>(`/api/v1/events/${contractModal.event_id}/contract/generate-ai`, {
        method: 'POST',
        body: { custom_clauses_notes: aiNotes.trim() || null, language_focus: 'BOTH' },
      });
      setContractModal({
        ...data,
        event_code: contractModal.event_code,
        remarks: data.remarks || '',
        amendment_remarks: data.amendment_remarks || '',
      });
      setNotice(tr(`تم توليد مسودة العقد بالذكاء الاصطناعي (${data.contract_number})`, `AI contract draft generated (${data.contract_number})`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed');
    } finally {
      setBusy(false);
    }
  };

  const saveContractUpdates = async (nextStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'RETURNED_FOR_AMENDMENT') => {
    if (!contractModal) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<ContractModalData>(`/api/v1/events/${contractModal.event_id}/contract`, {
        method: 'PATCH',
        body: {
          terms_ar: contractModal.terms_ar,
          terms_en: contractModal.terms_en,
          status: nextStatus || contractModal.status,
          remarks: contractModal.remarks || null,
          amendment_remarks: contractModal.amendment_remarks || null,
        },
      });
      setContractModal({
        ...updated,
        event_code: contractModal.event_code,
        remarks: updated.remarks || '',
        amendment_remarks: updated.amendment_remarks || '',
      });
      setNotice(tr('تم حفظ وتحديث العقد.', 'Contract saved & updated.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save contract');
    } finally {
      setBusy(false);
    }
  };

  const countersignContract = async () => {
    if (!contractModal) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<ContractModalData>(`/api/v1/erp/events/${contractModal.event_id}/contract/countersign`, {
        method: 'POST',
      });
      setContractModal({
        ...updated,
        event_code: contractModal.event_code,
        remarks: updated.remarks || '',
        amendment_remarks: updated.amendment_remarks || '',
      });
      setNotice(tr('تم اعتماد وتوقيع العقد من إدارة المنشأة.', 'Contract countersigned by Venue Management.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Countersign failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SpotlightCard className="space-y-4 text-start">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SpotlightHeading as="h2" className="text-lg">
            {tr('لوحة الفوترة، مراجعة الإيصالات، العقود الذكية وملفات PDF', 'Invoicing, Payment Review, PDFs & AI Contract Studio')}
          </SpotlightHeading>
          <p className="text-xs text-slate-500">
            {tr(
              'عرض تفصيلي للعميل والبنود، خصم بنسبة مئوية مع ترحيل GL، إرجاع الإيصالات للتعديل، ومشاركة PDF/واتساب.',
              'Line-item breakdown, % discount with balanced GL adjustment, receipt return-for-amendment, branded PDFs & AI contracts.'
            )}
          </p>
        </div>
        <Link href={tenantPath(locale, tenantSlug, '/erp/finance/ledger')} className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline">
          {tr('دفتر الأستاذ وميزان المراجعة', 'General Ledger')}
        </Link>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {invoices.length === 0 ? (
        <p className="text-xs text-slate-500">{tr('لا توجد فواتير صادرة حتى الآن.', 'No invoices issued yet.')}</p>
      ) : (
        <div className="space-y-4">
          {invoices.map((inv) => {
            const parsedItems = parseDisplayLineItems(inv.line_items, isRtl);
            return (
              <div key={inv.id} className="space-y-3 rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800">
                {/* Invoice Header */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 font-bold">
                      <span className="font-mono text-sm text-amber-500">{inv.invoice_number}</span>
                      <span className="font-mono text-slate-500">({inv.event_code})</span>
                      {inv.event_title && <span className="text-slate-700 dark:text-slate-200">— {inv.event_title}</span>}
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold dark:bg-slate-800">{inv.status}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {tr('العميل:', 'Client:')} <strong>{inv.client_name}</strong> {inv.client_phone ? `(${inv.client_phone})` : ''} ·{' '}
                      {tr('التأمين 2100:', 'Deposit 2100:')} {Number(inv.security_deposit_amount).toLocaleString()} ({inv.deposit_status}
                      {inv.refund_voucher_number ? ` · ${inv.refund_voucher_number}` : ''})
                    </div>
                  </div>
                  <div dir="ltr" className="text-end font-mono">
                    <div className="text-sm font-extrabold">
                      {inv.paid_amount.toLocaleString()} / {inv.total_amount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Sub: {(inv.subtotal ?? inv.total_amount).toLocaleString()} · Disc: {inv.discount_percent ?? 0}% (-{(inv.discount_amount ?? 0).toLocaleString()}) · Tax: {(inv.tax_amount ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Itemized Lines */}
                {parsedItems.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-950">
                    {parsedItems.map((li, idx) => (
                      <span key={idx} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] dark:border-slate-800 dark:bg-slate-900">
                        {li.label} ×{li.qty} ({li.total.toLocaleString()})
                      </span>
                    ))}
                  </div>
                )}

                {/* Editable % Discount & Branded PDF / AI Contract Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Percent className="h-3.5 w-3.5 text-[var(--brand-primary,#D4AF37)]" />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={discountInputs[inv.id] ?? String(inv.discount_percent ?? 0)}
                      onChange={(e) => setDiscountInputs((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      aria-label="Discount percent"
                      className="min-h-[32px] w-20 rounded border border-slate-300 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <input
                      value={discountNotes[inv.id] ?? ''}
                      onChange={(e) => setDiscountNotes((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      placeholder={tr('سبب الخصم...', 'Discount note...')}
                      className="min-h-[32px] w-36 rounded border border-slate-300 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => applyDiscount(inv)}
                      className="min-h-[32px] rounded bg-[var(--brand-primary,#D4AF37)] px-2.5 text-[11px] font-bold text-slate-950"
                    >
                      {tr('تطبيق خصم %', 'Apply %')}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        downloadAuthorizedFile(`/api/v1/exports/invoices/${inv.id}/pdf?locale=${locale}`, `${inv.invoice_number}-${locale}.pdf`)
                      }
                      className="inline-flex min-h-[32px] items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      <span>{tr('PDF الفاتورة', 'Invoice PDF')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadAuthorizedFile(
                          `/api/v1/exports/events/${inv.event_id}/deposit-settlement.pdf?locale=${locale}`,
                          `deposit-settlement-${inv.event_code}-${locale}.pdf`
                        )
                      }
                      className="inline-flex min-h-[32px] items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      <span>{tr('سند التأمين PDF', 'Deposit PDF')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => shareDoc(inv.event_id, 'INVOICE', 'WHATSAPP', inv.client_phone)}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      <span>{tr('مشاركة واتساب', 'WhatsApp')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== 'undefined') {
                          navigator.clipboard.writeText(`${window.location.origin}/api/v1/exports/invoices/${inv.id}/pdf?locale=${locale}`);
                          setNotice(tr('تم نسخ رابط الفاتورة', 'Invoice PDF link copied'));
                        }
                      }}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openContractStudio(inv)}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 px-2.5 text-[11px] font-bold text-amber-700 dark:text-amber-300"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>{tr('العقد الذكي AI', 'AI Contract Studio')}</span>
                    </button>
                  </div>
                </div>

                {/* Milestones Proof Review + Return for Amendment */}
                <div className="space-y-2">
                  {inv.milestones.map((m) => (
                    <div key={m.id} className="space-y-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold">{m.title}</span>{' '}
                          <span className="font-mono text-slate-500">
                            ({Number(m.amount_due).toLocaleString()} · {m.status})
                          </span>
                          {m.is_security_deposit && (
                            <span className="ms-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
                              2100 Deposit
                            </span>
                          )}
                          {m.reviewer_remarks && (
                            <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                              {tr('ملاحظات الإعادة:', 'Return Remarks:')} {m.reviewer_remarks}
                            </div>
                          )}
                          {m.receipt_url && (
                            <button
                              type="button"
                              onClick={() => downloadAuthorizedFile(m.receipt_url!, `receipt-${m.id}.bin`)}
                              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-500 underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>{tr('معاينة الإيصال المرفوع', 'Download Proof')}</span>
                            </button>
                          )}
                        </div>

                        {m.status !== 'PAID' && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select
                              value={methods[m.id] || m.payment_method || 'KURAIMI_BANK'}
                              onChange={(e) => setMethods((p) => ({ ...p, [m.id]: e.target.value }))}
                              className="min-h-[32px] rounded border border-slate-300 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                            >
                              <option value="KURAIMI_BANK">KURAIMI_BANK</option>
                              <option value="JAIB_WALLET">JAIB_WALLET</option>
                              <option value="CASH">CASH</option>
                            </select>
                            <input
                              value={refs[m.id] ?? ''}
                              onChange={(e) => setRefs((p) => ({ ...p, [m.id]: e.target.value }))}
                              placeholder={tr('مرجع...', 'Ref #')}
                              className="min-h-[32px] w-24 rounded border border-slate-300 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => verifyMilestone(m.id, Boolean(m.is_security_deposit), m.payment_method)}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded bg-emerald-600 px-2.5 text-[11px] font-bold text-white"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{tr('اعتماد GL', 'Verify')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReturnTargetId(m.id);
                                setReturnRemarks('');
                              }}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded bg-amber-500 px-2.5 text-[11px] font-bold text-slate-950"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>{tr('إعادة للتعديل', 'Return')}</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {returnTargetId === m.id && (
                        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                          <input
                            value={returnRemarks}
                            onChange={(e) => setReturnRemarks(e.target.value)}
                            placeholder={tr('اكتب سبب إرجاع الإيصال للعميل...', 'Specify why receipt is returned for amendment...')}
                            className="min-h-[34px] flex-1 rounded border border-amber-500/50 bg-white px-2.5 text-xs dark:bg-slate-900"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => submitReturnMilestone(m.id)}
                            className="rounded bg-amber-500 px-3 py-1 text-[11px] font-bold text-slate-950"
                          >
                            {tr('إرسال للعميل', 'Send Return')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReturnTargetId(null)}
                            className="rounded border border-slate-300 px-2.5 py-1 text-[11px] dark:border-slate-700"
                          >
                            {tr('إلغاء', 'Cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI Contract Drafting & Review Modal */}
      {contractModal && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="max-h-[90vh] w-full max-w-4xl space-y-4 overflow-y-auto text-start">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSignature className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <SpotlightHeading as="h3" className="text-lg">
                  {tr(`استوديو العقود بالذكاء الاصطناعي (${contractModal.event_code})`, `AI Contract Studio (${contractModal.event_code})`)}
                </SpotlightHeading>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[10px] font-bold text-white">
                  {contractModal.contract_number || 'NEW'} · {contractModal.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setContractModal(null)} />
                <button type="button" onClick={() => setContractModal(null)} className="rounded p-1 text-slate-400 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {contractModal.amendment_remarks && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <strong>{tr('ملاحظات التعديل المطلوبة:', 'Amendment Remarks:')}</strong> {contractModal.amendment_remarks}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
              <input
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                placeholder={tr('شروط خاصة لإدراجها في التوليد الذكي (اختياري)...', 'Custom clauses/notes for AI contract generator (optional)...')}
                className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                disabled={busy}
                onClick={generateAiContract}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950"
              >
                <Sparkles className="h-4 w-4" />
                <span>{tr('توليد / تحديث العقد بالذكاء الاصطناعي', 'Generate Grounded AI Contract (AR/EN)')}</span>
              </button>
              {contractModal.contract_number && (
                <button
                  type="button"
                  onClick={() =>
                    downloadAuthorizedFile(
                      `/api/v1/exports/contracts/${contractModal.event_id}/pdf?locale=${locale}`,
                      `${contractModal.contract_number}-${locale}.pdf`
                    )
                  }
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 px-3 font-semibold dark:border-slate-700"
                >
                  <FileDown className="h-4 w-4" />
                  <span>{tr('PDF العقد', 'Contract PDF')}</span>
                </button>
              )}
            </div>

            <div className="grid gap-3 text-xs md:grid-cols-2">
              <div>
                <label className="mb-1 block font-bold">{tr('بنود العقد بالعربية (AR)', 'Arabic Contract Clauses')}</label>
                <textarea
                  dir="rtl"
                  rows={10}
                  value={contractModal.terms_ar}
                  onChange={(e) => setContractModal({ ...contractModal, terms_ar: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 leading-relaxed dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block font-bold">{tr('بنود العقد بالإنجليزية (EN)', 'English Contract Clauses')}</label>
                <textarea
                  dir="ltr"
                  rows={10}
                  value={contractModal.terms_en}
                  onChange={(e) => setContractModal({ ...contractModal, terms_en: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 leading-relaxed dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-slate-500">
                {contractModal.client_signed_at
                  ? tr(`توقيع العميل: ${contractModal.client_signature_name}`, `Signed by Client: ${contractModal.client_signature_name}`)
                  : tr('بانتظار توقيع العميل الإلكتروني', 'Awaiting Client E-Signature')}
                {contractModal.staff_countersigned_at && ` · ${tr('معتمد من الإدارة ✓', 'Countersigned ✓')}`}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !contractModal.contract_number}
                  onClick={() => saveContractUpdates('PENDING_REVIEW')}
                  className="min-h-[38px] rounded-lg border border-slate-300 px-3.5 font-bold dark:border-slate-700"
                >
                  {tr('حفظ وإرسال للمراجعة', 'Save & Send to Client')}
                </button>
                <button
                  type="button"
                  disabled={busy || !contractModal.contract_number}
                  onClick={countersignContract}
                  className="min-h-[38px] rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-40"
                >
                  {tr('اعتماد وتوقيع الإدارة', 'Staff Countersign')}
                </button>
              </div>
            </div>
          </SpotlightCard>
        </div>
      )}
    </SpotlightCard>
  );
}
