'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import type { ScheduledEvent } from '@/lib/bookings-store';
import {
  downloadInvoiceHtml,
  downloadInvoicesCsv,
  printInvoicePdf,
  type InvoiceRecord,
  type PaymentMethodRecord,
} from '@/lib/invoice-pdf';

interface ChartAccount {
  code: string;
  nameAr: string;
  nameEn: string;
  type: string;
}

interface FinanceInvoicingPanelProps {
  locale: 'ar' | 'en';
  events: ScheduledEvent[];
  onDataChanged?: () => void;
}

export function FinanceInvoicingPanel({
  locale,
  events,
  onDataChanged,
}: FinanceInvoicingPanelProps) {
  const isRtl = locale === 'ar';
  const { authFetch } = useAuth();
  const branding = useTenantBranding();

  const [subTab, setSubTab] = useState<'invoices' | 'methods' | 'accounts'>('invoices');
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRecord[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create invoice state
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  // Pay milestone modal state
  const [payingTarget, setPayingTarget] = useState<{
    invoiceId: string;
    milestoneId: string;
    label: string;
    amount: number;
  } | null>(null);
  const [payMethodCode, setPayMethodCode] = useState('KURAIMI_BANK');
  const [payReference, setPayReference] = useState('');

  // Payment method editor
  const [pmForm, setPmForm] = useState({
    id: '',
    code: '',
    nameEn: '',
    nameAr: '',
    providerType: 'EWALLET',
    accountName: '',
    accountNumber: '',
    instructionsEn: '',
    instructionsAr: '',
    isActive: true,
    sortOrder: 7,
  });

  const loadFinance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/v1/tenant/finance', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Failed to load finance data');
      setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
      setMethods(Array.isArray(data?.paymentMethods) ? data.paymentMethods : []);
      setAccounts(Array.isArray(data?.chartOfAccounts) ? data.chartOfAccounts : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load financial data');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  useEffect(() => {
    if (!selectedEventId && events.length > 0) {
      setSelectedEventId(events[0].id);
    }
  }, [events, selectedEventId]);

  const totals = useMemo(() => {
    const totalBilled = invoices.reduce((s, inv) => s + inv.totalAmount, 0);
    const totalPaid = invoices.reduce((s, inv) => s + inv.paidAmount, 0);
    const heldDeposits = invoices
      .filter((inv) => inv.depositStatus === 'HELD' || inv.depositStatus === 'INSPECTION_PASSED')
      .reduce((s, inv) => s + inv.securityDepositAmount, 0);
    return {
      totalBilled,
      totalPaid,
      outstanding: Math.max(0, totalBilled - totalPaid),
      heldDeposits,
    };
  }, [invoices]);

  const fmtMoney = (n: number, curr = branding.currency) =>
    `${new Intl.NumberFormat(isRtl ? 'ar-YE' : 'en-US').format(n)} ${curr}`;

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_invoice',
          eventId: selectedEventId,
          discountAmount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to create invoice');
      setDiscountAmount(0);
      setNotice(
        isRtl
          ? `تم إصدار الفاتورة ${data.invoice.invoiceNumber} بنجاح.`
          : `Invoice ${data.invoice.invoiceNumber} issued successfully.`
      );
      await loadFinance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invoice');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingTarget) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          invoiceId: payingTarget.invoiceId,
          milestoneId: payingTarget.milestoneId,
          paymentMethod: payMethodCode,
          referenceNumber: payReference.trim() || `TXN-${String(Date.now()).slice(-6)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to record payment');
      setPayingTarget(null);
      setPayReference('');
      setNotice(isRtl ? 'تم توثيق السداد وتحديث حالة الفاتورة والفعالية.' : 'Payment recorded and synced with event status.');
      await loadFinance();
      onDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record payment');
    } finally {
      setSaving(false);
    }
  };

  const handleDepositChange = async (invoiceId: string, depositStatus: string) => {
    setError(null);
    try {
      const res = await authFetch('/api/v1/tenant/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_deposit_status', invoiceId, depositStatus }),
      });
      if (res.ok) {
        await loadFinance();
      }
    } catch {
      // ignore
    }
  };

  const handleSavePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_payment_method',
          ...pmForm,
          id: pmForm.id || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to save payment method');
      setPmForm({
        id: '',
        code: '',
        nameEn: '',
        nameAr: '',
        providerType: 'EWALLET',
        accountName: '',
        accountNumber: '',
        instructionsEn: '',
        instructionsAr: '',
        isActive: true,
        sortOrder: methods.length + 1,
      });
      setNotice(isRtl ? 'تم حفظ وسيلة الدفع بنجاح.' : 'Payment channel saved.');
      await loadFinance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save payment method');
    } finally {
      setSaving(false);
    }
  };

  const toggleMethodActive = async (pm: PaymentMethodRecord) => {
    try {
      const res = await authFetch('/api/v1/tenant/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_payment_method',
          ...pm,
          isActive: !pm.isActive,
        }),
      });
      if (res.ok) {
        await loadFinance();
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-5">
      {/* 4-Column Financial Summary Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl ? 'إجمالي الفواتير المصدرة' : 'Total Billed'}
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {loading ? '—' : fmtMoney(totals.totalBilled)}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl ? 'المتحصلات النقدية والبنكية' : 'Collected Revenue'}
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {loading ? '—' : fmtMoney(totals.totalPaid)}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl ? 'ذمم العملاء المتبقية' : 'Accounts Receivable'}
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {loading ? '—' : fmtMoney(totals.outstanding)}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl ? 'عهدة تأمينات الأضرار' : 'Security Deposit Escrow'}
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {loading ? '—' : fmtMoney(totals.heldDeposits)}
          </div>
        </div>
      </div>

      {/* Sub-Tabs & Export Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSubTab('invoices')}
            className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-xs font-medium transition-colors ${
              subTab === 'invoices'
                ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>{isRtl ? `الفواتير والـ PDF (${invoices.length})` : `Invoices & PDF (${invoices.length})`}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('methods')}
            className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-xs font-medium transition-colors ${
              subTab === 'methods'
                ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" />
            <span>{isRtl ? `وسائل الدفع (${methods.length})` : `Payment Methods (${methods.length})`}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('accounts')}
            className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-xs font-medium transition-colors ${
              subTab === 'accounts'
                ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>{isRtl ? 'شجرة الحسابات' : 'Chart of Accounts'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => downloadInvoicesCsv(invoices, locale)}
          disabled={invoices.length === 0}
          className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>{isRtl ? 'تصدير سجل الفواتير CSV' : 'Export Invoices CSV'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="me-2 h-4 w-4 animate-spin" />
          <span>{isRtl ? 'جاري تحميل النظام المالي...' : 'Loading financial workspace...'}</span>
        </div>
      ) : subTab === 'invoices' ? (
        <div className="space-y-5">
          {/* Quick Invoice Issuer Bar */}
          <form
            onSubmit={handleCreateInvoice}
            className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="min-w-[240px] flex-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'إصدار فاتورة لفعالية مجدولة' : 'Issue Invoice for Scheduled Event'}
              </label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.eventCode} — {isRtl ? ev.titleAr : ev.titleEn} ({isRtl ? ev.clientNameAr : ev.clientNameEn})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? `خصم (${branding.currency})` : `Discount (${branding.currency})`}
              </label>
              <input
                type="number"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(Number(e.target.value))}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !selectedEventId}
              className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>{isRtl ? 'إصدار فاتورة جديدة' : 'Generate Invoice'}</span>
            </button>
          </form>

          {/* Invoices List with Milestones, Escrow & Branded PDF Export */}
          <div className="space-y-4">
            {invoices.map((inv) => {
              const balance = Math.max(0, inv.totalAmount - inv.paidAmount);
              return (
                <div
                  key={inv.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {inv.invoiceNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{inv.eventCode}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            inv.status === 'PAID'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {isRtl ? inv.clientNameAr : inv.clientNameEn}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {inv.clientPhone}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => printInvoicePdf(inv, branding, 'ar', methods)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'PDF عربي' : 'PDF (AR)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => printInvoicePdf(inv, branding, 'en', methods)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'PDF إنجليزي' : 'PDF (EN)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadInvoiceHtml(inv, branding, locale, methods)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'تحميل' : 'Download'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Line Items & Financial Totals */}
                  <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {isRtl ? 'بنود الفاتورة ومراحل الدفع' : 'Invoice Line Items & Milestones'}
                      </div>
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                        {inv.lineItems.map((li) => (
                          <div key={li.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <span className="text-slate-700 dark:text-slate-300">
                              {isRtl ? li.descriptionAr : li.descriptionEn} × {li.quantity}
                            </span>
                            <span className="shrink-0 font-mono font-medium tabular-nums">
                              {fmtMoney(li.total, inv.currency)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                        {inv.milestones.map((ms) => (
                          <div
                            key={ms.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {isRtl ? ms.titleAr : ms.titleEn}
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {fmtMoney(ms.amountDue, inv.currency)}
                                {ms.paymentMethod ? ` · ${ms.paymentMethod}` : ''}
                                {ms.referenceNumber ? ` · ${ms.referenceNumber}` : ''}
                              </div>
                            </div>

                            {ms.status === 'PAID' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>{isRtl ? 'مسددة' : 'Paid'}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingTarget({
                                    invoiceId: inv.id,
                                    milestoneId: ms.id,
                                    label: isRtl ? ms.titleAr : ms.titleEn,
                                    amount: ms.amountDue,
                                  });
                                  setPayMethodCode(methods.find((m) => m.isActive)?.code || 'KURAIMI_BANK');
                                }}
                                className="min-h-[32px] whitespace-nowrap rounded-md bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90"
                              >
                                {isRtl ? 'توثيق سداد' : 'Record Payment'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Totals & Security Deposit Escrow Control */}
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                      <div className="flex justify-between">
                        <span className="text-slate-500">{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span>
                        <span className="font-mono tabular-nums">{fmtMoney(inv.subtotal, inv.currency)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">
                          {isRtl ? `الضريبة (${inv.taxRate}%)` : `Tax (${inv.taxRate}%)`}
                        </span>
                        <span className="font-mono tabular-nums">{fmtMoney(inv.taxAmount, inv.currency)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold dark:border-slate-800">
                        <span>{isRtl ? 'الإجمالي المستحق' : 'Total Due'}</span>
                        <span className="font-mono tabular-nums">{fmtMoney(inv.totalAmount, inv.currency)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                        <span>{isRtl ? 'المدفوع' : 'Paid'}</span>
                        <span className="font-mono font-semibold tabular-nums">
                          {fmtMoney(inv.paidAmount, inv.currency)}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-400">
                        <span>{isRtl ? 'المتبقي' : 'Balance'}</span>
                        <span className="font-mono tabular-nums">{fmtMoney(balance, inv.currency)}</span>
                      </div>

                      <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>{isRtl ? 'تأمين الأضرار' : 'Security Deposit'}</span>
                          </span>
                          <span className="font-mono font-semibold tabular-nums">
                            {fmtMoney(inv.securityDepositAmount, inv.currency)}
                          </span>
                        </div>
                        <select
                          value={inv.depositStatus}
                          onChange={(e) => handleDepositChange(inv.id, e.target.value)}
                          className="mt-2 min-h-[34px] w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-800 dark:bg-slate-900"
                        >
                          <option value="UNPAID">{isRtl ? 'غير مدفوع (UNPAID)' : 'UNPAID'}</option>
                          <option value="HELD">{isRtl ? 'محجوز بالعهدة (HELD)' : 'HELD IN ESCROW'}</option>
                          <option value="INSPECTION_PASSED">
                            {isRtl ? 'اجتاز المعاينة (INSPECTION_PASSED)' : 'INSPECTION PASSED'}
                          </option>
                          <option value="REFUNDED">{isRtl ? 'تم الاسترداد (REFUNDED)' : 'REFUNDED TO CLIENT'}</option>
                          <option value="DEDUCTED">{isRtl ? 'مخصوم أضرار (DEDUCTED)' : 'DEDUCTED'}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : subTab === 'methods' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {methods.map((pm) => (
              <div key={pm.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? pm.nameAr : pm.nameEn}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="font-mono text-[11px] text-slate-500">{pm.providerType}</span>
                  </div>
                  <div className="font-mono text-xs text-slate-700 dark:text-slate-300">
                    {pm.accountName} · <span className="font-semibold">{pm.accountNumber}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isRtl ? pm.instructionsAr : pm.instructionsEn}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => toggleMethodActive(pm)}
                    className={`font-semibold ${
                      pm.isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {pm.isActive ? (isRtl ? 'مفعّل' : 'Active') : isRtl ? 'معطّل' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPmForm({ ...pm })}
                    className="font-medium text-amber-700 hover:underline dark:text-[var(--brand-primary,#D4AF37)]"
                  >
                    {isRtl ? 'تعديل' : 'Edit'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleSavePaymentMethod}
            className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {pmForm.id
                  ? isRtl
                    ? 'تعديل وسيلة الدفع'
                    : 'Edit Payment Channel'
                  : isRtl
                  ? 'إضافة وسيلة دفع جديدة'
                  : 'Add Payment Channel'}
              </h3>
              {pmForm.id && (
                <button
                  type="button"
                  onClick={() =>
                    setPmForm({
                      id: '',
                      code: '',
                      nameEn: '',
                      nameAr: '',
                      providerType: 'EWALLET',
                      accountName: '',
                      accountNumber: '',
                      instructionsEn: '',
                      instructionsAr: '',
                      isActive: true,
                      sortOrder: methods.length + 1,
                    })
                  }
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {isRtl ? 'جديد' : 'New'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'الاسم (عربي)' : 'Name (Arabic)'}
                </label>
                <input
                  required
                  value={pmForm.nameAr}
                  onChange={(e) => setPmForm((f) => ({ ...f, nameAr: e.target.value }))}
                  placeholder="محفظة فلوسك"
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'}
                </label>
                <input
                  required
                  value={pmForm.nameEn}
                  onChange={(e) => setPmForm((f) => ({ ...f, nameEn: e.target.value }))}
                  placeholder="Floosak Wallet"
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'النوع' : 'Provider Type'}
                </label>
                <select
                  value={pmForm.providerType}
                  onChange={(e) => setPmForm((f) => ({ ...f, providerType: e.target.value }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
                >
                  <option value="BANK">BANK</option>
                  <option value="EWALLET">EWALLET</option>
                  <option value="CARD">CARD / POS</option>
                  <option value="CASH">CASH</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'الكود' : 'Channel Code'}
                </label>
                <input
                  value={pmForm.code}
                  onChange={(e) => setPmForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="FLOOSAK_WALLET"
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'اسم صاحب الحساب' : 'Account Holder Name'}
              </label>
              <input
                required
                value={pmForm.accountName}
                onChange={(e) => setPmForm((f) => ({ ...f, accountName: e.target.value }))}
                placeholder="Al-Massa Grand Palace"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'رقم الحساب / المحفظة / IBAN' : 'Account / Merchant / IBAN'}
              </label>
              <input
                required
                value={pmForm.accountNumber}
                onChange={(e) => setPmForm((f) => ({ ...f, accountNumber: e.target.value }))}
                placeholder="301234567"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'تعليمات التحويل للعميل (عربي)' : 'Instructions (Arabic)'}
              </label>
              <input
                value={pmForm.instructionsAr}
                onChange={(e) => setPmForm((f) => ({ ...f, instructionsAr: e.target.value }))}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'تعليمات التحويل للعميل (إنجليزي)' : 'Instructions (English)'}
              </label>
              <input
                value={pmForm.instructionsEn}
                onChange={(e) => setPmForm((f) => ({ ...f, instructionsEn: e.target.value }))}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>{pmForm.id ? (isRtl ? 'تحديث الوسيلة' : 'Update Channel') : isRtl ? 'حفظ وسيلة الدفع' : 'Save Channel'}</span>
            </button>
          </form>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-start text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-3 text-start font-medium">{isRtl ? 'رقم الحساب' : 'Account Code'}</th>
                <th className="px-4 py-3 text-start font-medium">{isRtl ? 'اسم الحساب (عربي)' : 'Arabic Title'}</th>
                <th className="px-4 py-3 text-start font-medium">{isRtl ? 'اسم الحساب (إنجليزي)' : 'English Title'}</th>
                <th className="px-4 py-3 text-end font-medium">{isRtl ? 'التصنيف المحاسبي' : 'Account Type'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {accounts.map((acc) => (
                <tr key={acc.code} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono font-semibold tabular-nums">{acc.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{acc.nameAr}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{acc.nameEn}</td>
                  <td className="px-4 py-3 text-end font-mono text-[11px] font-semibold text-slate-500">
                    {acc.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Payment Modal */}
      {payingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmPayment}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {isRtl ? 'توثيق سداد دفعة فاتورة' : 'Record Milestone Payment'}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {payingTarget.label} ·{' '}
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {fmtMoney(payingTarget.amount)}
                </span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'وسيلة الدفع المستخدمة' : 'Payment Channel'}
              </label>
              <select
                value={payMethodCode}
                onChange={(e) => setPayMethodCode(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                {methods
                  .filter((m) => m.isActive)
                  .map((m) => (
                    <option key={m.id} value={m.code}>
                      {isRtl ? m.nameAr : m.nameEn} ({m.accountNumber})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'رقم الحوالة / سند القبض' : 'Transfer / Receipt Reference'}
              </label>
              <input
                required
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="KRM-9920144"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPayingTarget(null)}
                className="min-h-[38px] rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 hover:opacity-90 disabled:opacity-50"
              >
                {isRtl ? 'تأكيد السداد' : 'Confirm Settlement'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
