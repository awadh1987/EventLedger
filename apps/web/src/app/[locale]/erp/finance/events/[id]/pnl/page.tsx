'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface ExpenseItem {
  id?: string;
  category: string;
  description: string;
  amount: number;
  payment_method?: string;
  created_at?: string;
}

interface PnlData {
  event_id: string;
  event_code: string;
  gross_revenue: number;
  discounts: number;
  net_revenue: number;
  catering_cogs: number;
  total_expenses: number;
  net_profit: number;
  margin_percent: number;
  security_deposit_held: number;
  expenses: ExpenseItem[];
}

function EventPnlInner() {
  const params = useParams<{ locale: string; id: string }>();
  const searchParams = useSearchParams();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const eventId = params?.id === '_' ? searchParams?.get('id') || '' : params?.id || '';

  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expCategory, setExpCategory] = useState('STAFFING');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState('CASH');
  const [refundMethod, setRefundMethod] = useState('KURAIMI_BANK');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!eventId) return;
    apiFetch<PnlData>(`/api/v1/finance/events/${eventId}/pnl`)
      .then((data) => {
        setPnl(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load P&L'));
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !expDesc.trim() || Number(expAmount) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ journal_entry_number: string }>(
        `/api/v1/erp/finance/events/${eventId}/expenses`,
        {
          method: 'POST',
          body: {
            category: expCategory,
            description: expDesc.trim(),
            amount: Number(expAmount),
            payment_method: expMethod,
          },
        }
      );
      setExpDesc('');
      setExpAmount('');
      setNotice(tr(`تم تسجيل المصروف وترحيل القيد ${res.journal_entry_number}`, `Expense recorded & posted (${res.journal_entry_number})`));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense');
    } finally {
      setBusy(false);
    }
  };

  const deleteExpense = async (expenseId: string) => {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/erp/finance/events/${eventId}/expenses/${expenseId}`, { method: 'DELETE' });
      setNotice(tr('تم حذف المصروف وعكس قيده في الأستاذ العام', 'Expense deleted & GL entry reversed'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete expense');
    } finally {
      setBusy(false);
    }
  };

  const refundDeposit = async () => {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ refund_amount: number; journal_entry_number: string | null }>(
        `/api/v1/erp/finance/events/${eventId}/refund-deposit`,
        { method: 'POST', body: { payment_method: refundMethod } }
      );
      setNotice(
        tr(
          `تم رد مبلغ التأمين (${res.refund_amount.toLocaleString()}) ${res.journal_entry_number ? `— قيد ${res.journal_entry_number}` : ''}`,
          `Deposit refunded (${res.refund_amount.toLocaleString()}) ${res.journal_entry_number ? `— JE ${res.journal_entry_number}` : ''}`
        )
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refund deposit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpotlightHeading as="h1" className="text-2xl">
            {tr('تقرير أرباح وخسائر الفعالية (P&L)', 'Event Profit & Loss Statement')}
            {pnl ? ` — ${pnl.event_code}` : ''}
          </SpotlightHeading>
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-xs text-emerald-500">{notice}</SpotlightCard>
        )}
        {error && <SpotlightCard className="border-red-500/40 bg-red-500/10 py-3 text-xs text-red-500">{error}</SpotlightCard>}

        {pnl && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SpotlightCard>
                <div className="text-xs text-slate-500">{tr('صافي الإيرادات', 'Net Revenue')}</div>
                <div className="mt-1 font-mono text-xl font-bold">{pnl.net_revenue.toLocaleString()}</div>
                <div className="text-[11px] text-slate-400">
                  {tr('إجمالي:', 'Gross:')} {pnl.gross_revenue.toLocaleString()} · {tr('خصم:', 'Disc:')} {pnl.discounts.toLocaleString()}
                </div>
              </SpotlightCard>
              <SpotlightCard>
                <div className="text-xs text-slate-500">{tr('إجمالي المصروفات', 'Total Expenses')}</div>
                <div className="mt-1 font-mono text-xl font-bold text-red-500">{pnl.total_expenses.toLocaleString()}</div>
                <div className="text-[11px] text-slate-400">
                  {tr('تكلفة الضيافة:', 'Catering COGS:')} {pnl.catering_cogs.toLocaleString()}
                </div>
              </SpotlightCard>
              <SpotlightCard>
                <div className="text-xs text-slate-500">{tr('صافي الربح', 'Net Profit')}</div>
                <div className="mt-1 font-mono text-xl font-bold text-emerald-500">
                  {pnl.net_profit.toLocaleString()} ({pnl.margin_percent}%)
                </div>
              </SpotlightCard>
              <SpotlightCard className="space-y-2">
                <div className="text-xs text-slate-500">{tr('أمانة التأمين المحتجزة (2100)', 'Security Deposit Held (2100)')}</div>
                <div className="font-mono text-xl font-bold text-amber-500">
                  {pnl.security_deposit_held.toLocaleString()}
                </div>
                {pnl.security_deposit_held > 0 && (
                  <div className="flex gap-1.5 pt-1">
                    <select
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="KURAIMI_BANK">KURAIMI_BANK</option>
                      <option value="CASH">CASH</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={refundDeposit}
                      className="inline-flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{tr('رد التأمين', 'Refund')}</span>
                    </button>
                  </div>
                )}
              </SpotlightCard>
            </div>

            {/* Record Event Expense + GL Posting */}
            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="text-lg">
                <Plus className="me-1.5 inline h-4 w-4" />
                {tr('تسجيل مصروف فعالية (مع ترحيل تلقائي للأستاذ العام)', 'Record Event Expense (Auto GL Posting)')}
              </SpotlightHeading>
              <form onSubmit={addExpense} className="grid gap-3 sm:grid-cols-5">
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="CATERING">{tr('تكلفة الضيافة', 'CATERING')}</option>
                  <option value="STAFFING">{tr('أجور تشغيلية', 'STAFFING')}</option>
                  <option value="DECOR">{tr('ديكور وزهور', 'DECOR')}</option>
                  <option value="UTILITIES">{tr('كهرباء ومرافق', 'UTILITIES')}</option>
                </select>
                <input
                  required
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder={tr('وصف المصروف...', 'Expense description...')}
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950 sm:col-span-2"
                />
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder={tr('المبلغ', 'Amount')}
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                <div className="flex gap-2">
                  <select
                    value={expMethod}
                    onChange={(e) => setExpMethod(e.target.value)}
                    className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="CASH">CASH</option>
                    <option value="KURAIMI_BANK">BANK</option>
                  </select>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[42px] flex-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950"
                  >
                    {tr('تسجيل', 'Add')}
                  </button>
                </div>
              </form>

              <div className="space-y-2 pt-2">
                {pnl.expenses.length === 0 ? (
                  <p className="text-xs text-slate-500">{tr('لا توجد مصروفات مسجلة لهذه الفعالية.', 'No expenses recorded yet.')}</p>
                ) : (
                  pnl.expenses.map((exp, idx) => (
                    <div
                      key={exp.id || idx}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800"
                    >
                      <div>
                        <span className="me-2 rounded bg-slate-200 px-2 py-0.5 font-mono text-[10px] font-bold dark:bg-slate-800">
                          {exp.category}
                        </span>
                        <span className="font-semibold">{exp.description}</span>
                        {exp.payment_method && <span className="ms-2 text-slate-400">({exp.payment_method})</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-red-500">{exp.amount.toLocaleString()}</span>
                        {exp.id && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => deleteExpense(exp.id!)}
                            className="rounded border border-rose-500/40 p-1.5 text-rose-500 hover:bg-rose-500/10"
                            title={tr('حذف وعكس القيد', 'Delete & Reverse')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SpotlightCard>
          </>
        )}
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}

export default function EventPnlPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 p-6 text-sm text-slate-400">Loading...</div>}>
      <EventPnlInner />
    </Suspense>
  );
}
