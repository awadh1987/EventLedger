'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderTree,
  Lock,
  Plus,
  Receipt,
  RotateCcw,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, downloadAuthorizedFile } from '@/lib/api';

type LedgerTab = 'LEDGER_TB' | 'STATEMENTS' | 'FISCAL_PERIODS' | 'COA';

interface AccountRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  account_type: string;
  normal_balance?: string;
  is_control_account?: boolean;
  is_system?: boolean;
  lifecycle?: string;
}

interface TrialBalanceRow extends AccountRow {
  account_id?: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

interface JournalEntryRow {
  id: string;
  entry_number: string;
  entry_date: string;
  reference: string | null;
  description: string;
  status: string;
  is_system_posting?: boolean;
  reversed_entry_id?: string | null;
  total_debit: number;
  total_credit: number;
}

interface InvoiceMilestoneRow {
  id: string;
  title: string;
  amount_due: number;
  due_date: string;
  paid_amount: number;
  payment_method: string | null;
  receipt_url: string | null;
  is_security_deposit?: boolean;
  status: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  event_id: string;
  event_code: string;
  client_name: string;
  total_amount: number;
  paid_amount: number;
  security_deposit_amount: number;
  deposit_status: string;
  status: string;
  milestones: InvoiceMilestoneRow[];
}

interface AccountLedgerData {
  account: AccountRow;
  opening_balance: number;
  closing_balance: number;
  transactions: {
    journal_entry_id: string;
    entry_number: string;
    entry_date: string;
    reference: string | null;
    description: string;
    memo: string | null;
    status: string;
    debit: number;
    credit: number;
    running_balance: number;
  }[];
}

interface StatementsData {
  income_statement: {
    revenues: TrialBalanceRow[];
    expenses: TrialBalanceRow[];
    total_revenue: number;
    total_expenses: number;
    net_income: number;
  };
  balance_sheet: {
    assets: TrialBalanceRow[];
    liabilities: TrialBalanceRow[];
    equity: TrialBalanceRow[];
    current_net_income: number;
    total_assets: number;
    total_liabilities: number;
    total_equity: number;
    total_liabilities_and_equity: number;
    is_balanced: boolean;
  };
}

interface FiscalYearRow {
  id: string;
  year_label: string;
  status: string;
  periods: {
    id: string;
    period_number: number;
    name: string;
    start_date: string;
    end_date: string;
    status: 'OPEN' | 'LOCKED' | 'CLOSED';
  }[];
}

export default function GeneralLedgerPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [activeTab, setActiveTab] = useState<LedgerTab>('LEDGER_TB');
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [tbRows, setTbRows] = useState<TrialBalanceRow[]>([]);
  const [tbBalanced, setTbBalanced] = useState(true);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [statements, setStatements] = useState<StatementsData | null>(null);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([]);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [verifyMethods, setVerifyMethods] = useState<Record<string, string>>({});
  const [verifyDeposits, setVerifyDeposits] = useState<Record<string, boolean>>({});
  const [verifyRefs, setVerifyRefs] = useState<Record<string, string>>({});

  const [refCode, setRefCode] = useState('');
  const [desc, setDesc] = useState('');
  const [debitAcc, setDebitAcc] = useState('');
  const [creditAcc, setCreditAcc] = useState('');
  const [amount, setAmount] = useState('0');

  const [importEntity, setImportEntity] = useState<'accounts' | 'inventory' | 'guests'>('accounts');
  const [importEventId, setImportEventId] = useState('');
  const [importPreview, setImportPreview] = useState<string[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Account Ledger Drawer State
  const [ledgerDrawer, setLedgerDrawer] = useState<AccountLedgerData | null>(null);

  // Create Account Modal State
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newAcc, setNewAcc] = useState({
    code: '',
    name_ar: '',
    name_en: '',
    account_type: 'EXPENSE',
    is_control_account: false,
  });

  // Fiscal Year Creator
  const [newYearInput, setNewYearInput] = useState(String(new Date().getFullYear() + 1));

  const buildDateQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (fromDate) p.set('from_date', `${fromDate}T00:00:00`);
    if (toDate) p.set('to_date', `${toDate}T23:59:59`);
    const q = p.toString();
    return q ? `?${q}` : '';
  }, [fromDate, toDate]);

  const load = useCallback(async () => {
    try {
      const dq = buildDateQuery();
      const [accs, tb, jes, invs, stmts, fys] = await Promise.all([
        apiFetch<AccountRow[]>('/api/v1/finance/accounts'),
        apiFetch<{ rows: TrialBalanceRow[]; is_balanced: boolean }>(`/api/v1/finance/trial-balance${dq}`),
        apiFetch<JournalEntryRow[]>('/api/v1/finance/journal-entries'),
        apiFetch<InvoiceRow[]>('/api/v1/finance/invoices'),
        apiFetch<StatementsData>(`/api/v1/finance/statements${dq}`),
        apiFetch<FiscalYearRow[]>('/api/v1/finance/fiscal-years'),
      ]);
      setAccounts(accs);
      setTbRows(tb.rows);
      setTbBalanced(tb.is_balanced);
      setEntries(jes);
      setInvoices(invs);
      setStatements(stmts);
      setFiscalYears(fys);
      const manualAccs = accs.filter((a) => !a.is_control_account && a.lifecycle === 'ACTIVE');
      if (manualAccs[0] && !debitAcc) setDebitAcc(manualAccs[0].id);
      if (manualAccs[1] && !creditAcc) setCreditAcc(manualAccs[1].id);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Finance login required');
    }
  }, [buildDateQuery, creditAcc, debitAcc]);

  useEffect(() => {
    load();
  }, [load]);

  const manualAccounts = accounts.filter((a) => !a.is_control_account);
  const numericAmount = Number(amount) || 0;
  const canPost = numericAmount > 0 && debitAcc && creditAcc && debitAcc !== creditAcc;

  const verifyMilestone = async (milestoneId: string, defaultDeposit = false) => {
    setErrorMsg(null);
    setNotice(null);
    try {
      const method = verifyMethods[milestoneId] || 'KURAIMI_BANK';
      const isDeposit = verifyDeposits[milestoneId] ?? defaultDeposit;
      const reference = verifyRefs[milestoneId] || 'Verified Transfer';
      const res = await apiFetch<{ status: string; invoice_status: string; journal_entry_number: string }>(
        `/api/v1/erp/finance/milestones/${milestoneId}/verify`,
        {
          method: 'PATCH',
          body: { payment_method: method, is_security_deposit: isDeposit, reference },
        }
      );
      setNotice(
        tr(
          `تم اعتماد الدفعة وترحيل القيد المزدوج ${res.journal_entry_number} (حالة الفاتورة: ${res.invoice_status})`,
          `Verified receipt & posted Journal ${res.journal_entry_number} (Invoice: ${res.invoice_status})`
        )
      );
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const postEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPost) return;
    setErrorMsg(null);
    setNotice(null);
    try {
      await apiFetch('/api/v1/finance/journal-entries', {
        method: 'POST',
        body: {
          reference: refCode || 'MANUAL',
          description: desc || 'Manual journal entry',
          lines: [
            { account_id: debitAcc, debit: numericAmount, credit: 0 },
            { account_id: creditAcc, debit: 0, credit: numericAmount },
          ],
        },
      });
      setRefCode('');
      setDesc('');
      setAmount('0');
      setNotice(tr('تم ترحيل القيد المحاسبي المتوازن بنجاح', 'Balanced journal entry posted'));
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to post entry');
    }
  };

  const reverseEntry = async (entryId: string, entryNumber: string) => {
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ reversal_entry_number: string }>(
        `/api/v1/finance/journal-entries/${entryId}/reverse`,
        { method: 'POST', body: { reason: `Manual reversal of ${entryNumber}` } }
      );
      setNotice(
        tr(
          `تم عكس القيد ${entryNumber} عبر القيد العكسي ${res.reversal_entry_number}`,
          `Reversed ${entryNumber} via ${res.reversal_entry_number}`
        )
      );
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reversal failed');
    }
  };

  const openAccountLedger = async (accountId: string) => {
    setErrorMsg(null);
    try {
      const dq = buildDateQuery();
      const data = await apiFetch<AccountLedgerData>(`/api/v1/finance/accounts/${accountId}/ledger${dq}`);
      setLedgerDrawer(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load account ledger');
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiFetch('/api/v1/finance/accounts', { method: 'POST', body: newAcc });
      setShowCreateAccount(false);
      setNewAcc({ code: '', name_ar: '', name_en: '', account_type: 'EXPENSE', is_control_account: false });
      setNotice(tr('تم إنشاء الحساب المحاسبي بنجاح', 'Account created'));
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create account');
    }
  };

  const togglePeriodStatus = async (periodId: string, nextStatus: 'OPEN' | 'LOCKED' | 'CLOSED') => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/v1/finance/periods/${periodId}`, { method: 'PATCH', body: { status: nextStatus } });
      setNotice(tr(`تم تحديث حالة الفترة إلى ${nextStatus}`, `Period updated to ${nextStatus}`));
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update period');
    }
  };

  const createFiscalYear = async () => {
    const yr = Number(newYearInput);
    if (!yr) return;
    setErrorMsg(null);
    try {
      await apiFetch('/api/v1/finance/fiscal-years', { method: 'POST', body: { year: yr } });
      setNotice(tr(`تم إنشاء السنة المالية ${yr}`, `Created fiscal year ${yr}`));
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create fiscal year');
    }
  };

  const handleFileSelect = async (f: File) => {
    setImportFile(f);
    const text = await f.text();
    const clean = text.replace(/^\uFEFF/, '');
    setImportPreview(clean.split(/\r?\n/).filter(Boolean).slice(0, 5));
  };

  const runCsvImport = async () => {
    if (!importFile) return;
    const fd = new FormData();
    fd.append('file', importFile);
    if (importEntity === 'guests' && importEventId) fd.append('event_id', importEventId);
    const res = await apiFetch<{ imported_rows: number; skipped_rows: number }>(`/api/v1/import/${importEntity}`, {
      method: 'POST',
      formData: fd,
    });
    setNotice(
      tr(
        `تم استيراد ${res.imported_rows} صف (تخطي ${res.skipped_rows})`,
        `Imported ${res.imported_rows} rows (${res.skipped_rows} skipped)`
      )
    );
    setImportFile(null);
    setImportPreview([]);
    await load();
  };

  const pendingMilestones = invoices.flatMap((inv) =>
    inv.milestones
      .filter((m) => m.status !== 'PAID')
      .map((m) => ({
        ...m,
        invoice_number: inv.invoice_number,
        event_code: inv.event_code,
        client_name: inv.client_name,
      }))
  );

  const tabs: { id: LedgerTab; ar: string; en: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'LEDGER_TB', ar: 'دفتر الأستاذ وميزان المراجعة', en: 'Ledger & Trial Balance', icon: BookOpen },
    { id: 'STATEMENTS', ar: 'القوائم المالية', en: 'Balance Sheet & P&L', icon: FileSpreadsheet },
    { id: 'FISCAL_PERIODS', ar: 'السنوات والفترات المالية', en: 'Fiscal Periods', icon: CalendarClock },
    { id: 'COA', ar: 'دليل الحسابات', en: 'Chart of Accounts', icon: FolderTree },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <SpotlightHeading as="h1" className="text-start text-2xl">
            {tr('دفتر الأستاذ وميزان المراجعة المزدوج', 'Double-Entry Ledger & Trial Balance')}
          </SpotlightHeading>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadAuthorizedFile('/api/v1/exports/trial-balance.csv', 'trial-balance.csv')}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <Download className="h-4 w-4" />
              {tr('تصدير ميزان المراجعة CSV', 'Export Trial Balance CSV')}
            </button>
            <button
              type="button"
              onClick={() => downloadAuthorizedFile('/api/v1/exports/journal.csv', 'journal.csv')}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <Download className="h-4 w-4" />
              {tr('تصدير القيود CSV', 'Export Journal CSV')}
            </button>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex gap-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
          {tabs.map((tb) => {
            const active = activeTab === tb.id;
            const Icon = tb.icon;
            return (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tb.id)}
                className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-3 text-xs transition ${
                  active
                    ? 'border-[var(--brand-primary)] font-semibold text-slate-900 dark:text-white'
                    : 'border-transparent font-medium text-slate-500 hover:text-[var(--brand-primary,#D4AF37)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{isRtl ? tb.ar : tb.en}</span>
              </button>
            );
          })}
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {notice}
          </SpotlightCard>
        )}
        {errorMsg && (
          <SpotlightCard className="border-rose-500/40 bg-rose-500/10 py-3 text-start text-xs text-rose-500">
            {errorMsg}
          </SpotlightCard>
        )}

        {activeTab === 'LEDGER_TB' && (
          <>
            {/* Milestone Receipt Verification Queue */}
            <SpotlightCard className="space-y-4 text-start">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
                  <Receipt className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{tr('طابور التحقق من إيصالات الدفع والترحيل التلقائي', 'Milestone Receipt Verification Queue')}</span>
                </SpotlightHeading>
                <span className="rounded-full bg-amber-500/15 px-3 py-1 font-mono text-xs font-bold text-amber-500">
                  {pendingMilestones.length} {tr('دفعة معلقة', 'Pending')}
                </span>
              </div>

              {pendingMilestones.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tr('تم التحقق من جميع الدفعات المجدولة.', 'All scheduled payment milestones are verified.')}
                </p>
              ) : (
                <div className="space-y-3">
                  {pendingMilestones.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 font-bold">
                          <span className="font-mono text-amber-500">{m.event_code}</span>
                          <span>{m.client_name}</span>
                          <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-[10px] dark:bg-slate-800">
                            {m.status}
                          </span>
                          {m.is_security_deposit && (
                            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                              2100 Deposit
                            </span>
                          )}
                        </div>
                        <div className="text-slate-600 dark:text-slate-400">
                          {m.invoice_number} — {m.title} ·{' '}
                          <strong className="font-mono text-slate-900 dark:text-slate-100">
                            {Number(m.amount_due).toLocaleString()}
                          </strong>
                        </div>
                        {m.receipt_url && (
                          <button
                            type="button"
                            onClick={() => downloadAuthorizedFile(m.receipt_url!, `receipt-${m.id}.bin`)}
                            className="inline-flex items-center gap-1 font-semibold text-sky-500 underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>{tr('تحميل الإيصال المرفوع (محمي)', 'Download Uploaded Receipt')}</span>
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={verifyMethods[m.id] || 'KURAIMI_BANK'}
                          onChange={(e) => setVerifyMethods((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="KURAIMI_BANK">KURAIMI_BANK</option>
                          <option value="JAIB_WALLET">JAIB_WALLET</option>
                          <option value="JAWALI_WALLET">JAWALI_WALLET</option>
                          <option value="ONECASH_WALLET">ONECASH_WALLET</option>
                          <option value="CASH">CASH</option>
                        </select>

                        <input
                          value={verifyRefs[m.id] ?? ''}
                          onChange={(e) => setVerifyRefs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          placeholder={tr('رقم المرجع', 'Ref #')}
                          className="min-h-[38px] w-28 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        />

                        <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700">
                          <input
                            type="checkbox"
                            checked={verifyDeposits[m.id] ?? Boolean(m.is_security_deposit)}
                            onChange={(e) => setVerifyDeposits((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                          />
                          <span>{tr('تأمين 2100', '2100 Deposit')}</span>
                        </label>

                        <button
                          type="button"
                          onClick={() => verifyMilestone(m.id, Boolean(m.is_security_deposit))}
                          className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 font-bold text-white"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>{tr('اعتماد وترحيل القيد', 'Verify & Post Journal')}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SpotlightCard>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Post Balanced Entry */}
              <SpotlightCard className="text-start">
                <form onSubmit={postEntry} className="space-y-3">
                  <SpotlightHeading as="h2" className="text-start text-lg">
                    <Plus className="me-1.5 inline h-4 w-4" />
                    {tr('قيد يومية مزدوج جديد', 'Post Balanced Journal Entry')}
                  </SpotlightHeading>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={refCode}
                      onChange={(e) => setRefCode(e.target.value)}
                      placeholder={tr('المرجع', 'Reference')}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={tr('المبلغ', 'Amount')}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <select
                      value={debitAcc}
                      onChange={(e) => setDebitAcc(e.target.value)}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {manualAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{`${a.code} — ${isRtl ? a.name_ar : a.name_en} (Dr)`}</option>
                      ))}
                    </select>
                    <select
                      value={creditAcc}
                      onChange={(e) => setCreditAcc(e.target.value)}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {manualAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{`${a.code} — ${isRtl ? a.name_ar : a.name_en} (Cr)`}</option>
                      ))}
                    </select>
                    <input
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      placeholder={tr('البيان', 'Description')}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 sm:col-span-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!canPost}
                    className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-bold text-slate-950 disabled:opacity-40"
                  >
                    {tr('ترحيل القيد (مدين = دائن)', 'Post Balanced Entry')}
                  </button>
                </form>
              </SpotlightCard>

              {/* UTF-8 BOM CSV Bulk Importer */}
              <SpotlightCard className="space-y-3 text-start">
                <SpotlightHeading as="h2" className="text-start text-lg">
                  <Upload className="me-1.5 inline h-4 w-4" />
                  {tr('استيراد جماعي CSV (UTF-8 BOM)', 'UTF-8 BOM CSV Bulk Importer')}
                </SpotlightHeading>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={importEntity}
                    onChange={(e) => setImportEntity(e.target.value as 'accounts' | 'inventory' | 'guests')}
                    className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="accounts">{tr('دليل الحسابات', 'Chart of Accounts')}</option>
                    <option value="inventory">{tr('المخزون والتجهيزات', 'Inventory Items')}</option>
                    <option value="guests">{tr('قائمة الضيوف وتصاريح QR', 'Guest List & QR Passes')}</option>
                  </select>
                  {importEntity === 'guests' && (
                    <input
                      value={importEventId}
                      onChange={(e) => setImportEventId(e.target.value)}
                      placeholder="Event UUID"
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  )}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileSelect(f);
                    }}
                    className="text-xs sm:col-span-2"
                  />
                </div>
                {importPreview.length > 0 && (
                  <pre dir="ltr" className="overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-200">
                    {importPreview.join('\n')}
                  </pre>
                )}
                <button
                  type="button"
                  disabled={!importFile}
                  onClick={runCsvImport}
                  className="min-h-[44px] w-full rounded-lg border border-[var(--brand-primary,#D4AF37)] text-xs font-bold text-[var(--brand-primary,#D4AF37)] disabled:opacity-40"
                >
                  {tr('تنفيذ الاستيراد', 'Run CSV Import')}
                </button>
              </SpotlightCard>
            </div>

            {/* Trial Balance */}
            <SpotlightCard className="space-y-3 text-start">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SpotlightHeading as="h2" className="text-start text-lg">
                  {tr('ميزان المراجعة', 'Trial Balance')}
                </SpotlightHeading>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <span
                    className={`rounded-full px-3 py-1 font-bold ${
                      tbBalanced ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {tbBalanced ? tr('متوازن ✓', 'Balanced ✓') : tr('غير متوازن!', 'Unbalanced!')}
                  </span>
                </div>
              </div>
              <ResponsiveDataList
                data={tbRows.map((r) => ({ ...r, id: r.account_id || r.id }))}
                locale={locale}
                mobileCardHeader={(r) => `${r.code} — ${isRtl ? r.name_ar : r.name_en}`}
                columns={[
                  { key: 'code', headerAr: 'الرمز', headerEn: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
                  {
                    key: 'name',
                    headerAr: 'الحساب',
                    headerEn: 'Account',
                    render: (r) => (
                      <div className="flex items-center gap-2">
                        <span>{isRtl ? r.name_ar : r.name_en}</span>
                        {r.is_control_account && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
                            CTRL
                          </span>
                        )}
                      </div>
                    ),
                  },
                  { key: 'debit', headerAr: 'مدين', headerEn: 'Debit', render: (r) => <span className="font-mono">{r.total_debit.toLocaleString()}</span> },
                  { key: 'credit', headerAr: 'دائن', headerEn: 'Credit', render: (r) => <span className="font-mono">{r.total_credit.toLocaleString()}</span> },
                  { key: 'bal', headerAr: 'الرصيد', headerEn: 'Balance', render: (r) => <span className="font-mono font-bold">{r.balance.toLocaleString()}</span> },
                  {
                    key: 'drill',
                    headerAr: 'كشف',
                    headerEn: 'Ledger',
                    render: (r) => (
                      <button
                        type="button"
                        onClick={() => openAccountLedger(r.account_id || r.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                      >
                        {tr('حركة الحساب', 'Drill Down')}
                      </button>
                    ),
                  },
                ]}
              />
            </SpotlightCard>

            {/* Journal Entries */}
            <SpotlightCard className="space-y-3 text-start">
              <SpotlightHeading as="h2" className="text-start text-lg">
                {tr('سجل قيود اليومية', 'Posted Journal Entries')}
              </SpotlightHeading>
              <ResponsiveDataList
                data={entries}
                locale={locale}
                mobileCardHeader={(r) => r.entry_number}
                columns={[
                  { key: 'num', headerAr: 'رقم القيد', headerEn: 'Entry #', render: (r) => <span className="font-mono text-xs">{r.entry_number}</span> },
                  { key: 'ref', headerAr: 'المرجع', headerEn: 'Reference', render: (r) => r.reference || '-' },
                  { key: 'desc', headerAr: 'البيان', headerEn: 'Description', render: (r) => r.description },
                  { key: 'amt', headerAr: 'المبلغ', headerEn: 'Amount', render: (r) => <span className="font-mono">{r.total_debit.toLocaleString()}</span> },
                  {
                    key: 'status',
                    headerAr: 'الحالة',
                    headerEn: 'Status',
                    render: (r) => (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.status === 'REVERSED' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                        }`}
                      >
                        {r.status}
                      </span>
                    ),
                  },
                  {
                    key: 'rev',
                    headerAr: 'إجراء',
                    headerEn: 'Action',
                    render: (r) =>
                      r.status === 'POSTED' && !r.reversed_entry_id ? (
                        <button
                          type="button"
                          onClick={() => reverseEntry(r.id, r.entry_number)}
                          className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-500"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>{tr('عكس', 'Reverse')}</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">-</span>
                      ),
                  },
                ]}
              />
            </SpotlightCard>
          </>
        )}

        {activeTab === 'STATEMENTS' && statements && (
          <div className="grid gap-6 lg:grid-cols-2 text-start">
            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="text-lg">
                {tr('قائمة الدخل (Income Statement)', 'Income Statement')}
              </SpotlightHeading>
              <div className="space-y-2 text-xs">
                <div className="font-bold text-emerald-500">{tr('الإيرادات', 'Revenues')}</div>
                {statements.income_statement.revenues.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-200/50 py-1 dark:border-slate-800">
                    <span>{r.code} — {isRtl ? r.name_ar : r.name_en}</span>
                    <span className="font-mono">{r.balance.toLocaleString()}</span>
                  </div>
                ))}
                <div className="font-bold text-rose-500 pt-2">{tr('المصروفات', 'Expenses')}</div>
                {statements.income_statement.expenses.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-200/50 py-1 dark:border-slate-800">
                    <span>{r.code} — {isRtl ? r.name_ar : r.name_en}</span>
                    <span className="font-mono">{r.balance.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 text-sm font-extrabold">
                  <span>{tr('صافي الربح / (الخسارة)', 'Net Income')}</span>
                  <span className="font-mono text-[var(--brand-primary,#D4AF37)]">
                    {statements.income_statement.net_income.toLocaleString()}
                  </span>
                </div>
              </div>
            </SpotlightCard>

            <SpotlightCard className="space-y-4">
              <div className="flex items-center justify-between">
                <SpotlightHeading as="h2" className="text-lg">
                  {tr('قائمة المركز المالي (Balance Sheet)', 'Balance Sheet')}
                </SpotlightHeading>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    statements.balance_sheet.is_balanced ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}
                >
                  {statements.balance_sheet.is_balanced ? 'A = L + E ✓' : 'Out of Balance'}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="font-bold text-sky-500">{tr('الأصول', 'Assets')}</div>
                {statements.balance_sheet.assets.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-200/50 py-1 dark:border-slate-800">
                    <span>{r.code} — {isRtl ? r.name_ar : r.name_en}</span>
                    <span className="font-mono">{r.balance.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1">
                  <span>{tr('إجمالي الأصول', 'Total Assets')}</span>
                  <span className="font-mono">{statements.balance_sheet.total_assets.toLocaleString()}</span>
                </div>

                <div className="font-bold text-amber-500 pt-3">{tr('الالتزامات', 'Liabilities')}</div>
                {statements.balance_sheet.liabilities.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-200/50 py-1 dark:border-slate-800">
                    <span>{r.code} — {isRtl ? r.name_ar : r.name_en}</span>
                    <span className="font-mono">{r.balance.toLocaleString()}</span>
                  </div>
                ))}
                <div className="font-bold text-emerald-500 pt-3">{tr('حقوق الملكية والأرباح', 'Equity & Current Earnings')}</div>
                {statements.balance_sheet.equity.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-200/50 py-1 dark:border-slate-800">
                    <span>{r.code} — {isRtl ? r.name_ar : r.name_en}</span>
                    <span className="font-mono">{r.balance.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between border-b border-slate-200/50 py-1 dark:border-slate-800">
                  <span>{tr('صافي ربح الفترة', 'Current Period Net Income')}</span>
                  <span className="font-mono">{statements.balance_sheet.current_net_income.toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-2 text-sm font-extrabold">
                  <span>{tr('إجمالي الالتزامات وحقوق الملكية', 'Total Liabilities & Equity')}</span>
                  <span className="font-mono text-[var(--brand-primary,#D4AF37)]">
                    {statements.balance_sheet.total_liabilities_and_equity.toLocaleString()}
                  </span>
                </div>
              </div>
            </SpotlightCard>
          </div>
        )}

        {activeTab === 'FISCAL_PERIODS' && (
          <SpotlightCard className="space-y-5 text-start">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SpotlightHeading as="h2" className="text-lg">
                {tr('إدارة السنوات والفترات المحاسبية وقفل الترحيل', 'Fiscal Years & Accounting Period Locks')}
              </SpotlightHeading>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={newYearInput}
                  onChange={(e) => setNewYearInput(e.target.value)}
                  className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={createFiscalYear}
                  className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 py-1.5 text-xs font-bold text-slate-950"
                >
                  {tr('+ سنة مالية', '+ Add Fiscal Year')}
                </button>
              </div>
            </div>

            {fiscalYears.map((fy) => (
              <div key={fy.id} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-base font-extrabold">{fy.year_label}</span>
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
                    {fy.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {fy.periods.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                      <div>
                        <div className="font-mono font-bold">{p.name}</div>
                        <div className="text-[10px] text-slate-500">{p.status}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePeriodStatus(p.id, p.status === 'OPEN' ? 'LOCKED' : 'OPEN')}
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold ${
                          p.status === 'OPEN' ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500'
                        }`}
                      >
                        {p.status === 'OPEN' ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        <span>{p.status === 'OPEN' ? tr('قفل', 'Lock') : tr('فتح', 'Open')}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </SpotlightCard>
        )}

        {activeTab === 'COA' && (
          <SpotlightCard className="space-y-4 text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h2" className="text-lg">
                {tr('دليل الحسابات (Chart of Accounts)', 'Chart of Accounts')}
              </SpotlightHeading>
              <button
                type="button"
                onClick={() => setShowCreateAccount(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 py-2 text-xs font-bold text-slate-950"
              >
                <Plus className="h-4 w-4" />
                <span>{tr('إضافة حساب', 'Create Account')}</span>
              </button>
            </div>
            <ResponsiveDataList
              data={accounts}
              locale={locale}
              mobileCardHeader={(a) => `${a.code} — ${isRtl ? a.name_ar : a.name_en}`}
              columns={[
                { key: 'code', headerAr: 'الرمز', headerEn: 'Code', render: (a) => <span className="font-mono text-xs font-bold">{a.code}</span> },
                { key: 'name', headerAr: 'اسم الحساب', headerEn: 'Account Name', render: (a) => (isRtl ? a.name_ar : a.name_en) },
                { key: 'type', headerAr: 'النوع', headerEn: 'Type', render: (a) => <span className="font-mono text-xs">{a.account_type}</span> },
                { key: 'norm', headerAr: 'الطبيعة', headerEn: 'Normal', render: (a) => <span className="font-mono text-xs">{a.normal_balance || '-'}</span> },
                {
                  key: 'ctrl',
                  headerAr: 'رقابي',
                  headerEn: 'Control',
                  render: (a) =>
                    a.is_control_account ? (
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-500">CONTROL</span>
                    ) : (
                      '-'
                    ),
                },
              ]}
            />
          </SpotlightCard>
        )}
      </main>

      {/* Account Ledger Drill-Down Modal */}
      {ledgerDrawer && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="max-h-[85vh] w-full max-w-4xl space-y-4 overflow-y-auto text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h3" className="text-lg">
                {ledgerDrawer.account.code} — {isRtl ? ledgerDrawer.account.name_ar : ledgerDrawer.account.name_en}
              </SpotlightHeading>
              <button type="button" onClick={() => setLedgerDrawer(null)} className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <span>{tr('الرصيد الافتتاحي:', 'Opening:')} <strong className="font-mono">{ledgerDrawer.opening_balance.toLocaleString()}</strong></span>
              <span>{tr('الرصيد الختامي:', 'Closing:')} <strong className="font-mono text-[var(--brand-primary,#D4AF37)]">{ledgerDrawer.closing_balance.toLocaleString()}</strong></span>
            </div>
            <div className="space-y-2 text-xs">
              {ledgerDrawer.transactions.length === 0 ? (
                <p className="text-slate-500">{tr('لا توجد حركات مسجلة.', 'No posted transactions.')}</p>
              ) : (
                ledgerDrawer.transactions.map((tx, i) => (
                  <div key={`${tx.journal_entry_id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                    <div>
                      <span className="me-2 font-mono font-bold text-amber-500">{tx.entry_number}</span>
                      <span>{tx.description}</span>
                      <div className="text-[11px] text-slate-500">{tx.entry_date.slice(0, 10)} · {tx.reference || '-'}</div>
                    </div>
                    <div className="flex gap-4 font-mono">
                      <span className="text-emerald-500">+{tx.debit.toLocaleString()} Dr</span>
                      <span className="text-rose-500">-{tx.credit.toLocaleString()} Cr</span>
                      <span className="font-bold">{tx.running_balance.toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SpotlightCard>
        </div>
      )}

      {/* Create Account Modal */}
      {showCreateAccount && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h3" className="text-base">{tr('إضافة حساب جديد', 'Create GL Account')}</SpotlightHeading>
              <button type="button" onClick={() => setShowCreateAccount(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="space-y-3 text-xs">
              <input required placeholder={tr('رمز الحساب (مثل 5200)', 'Code (e.g. 5200)')} value={newAcc.code} onChange={(e) => setNewAcc({ ...newAcc, code: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-950" />
              <input required placeholder={tr('الاسم بالعربية', 'Arabic Name')} value={newAcc.name_ar} onChange={(e) => setNewAcc({ ...newAcc, name_ar: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
              <input required placeholder={tr('الاسم بالإنجليزية', 'English Name')} value={newAcc.name_en} onChange={(e) => setNewAcc({ ...newAcc, name_en: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
              <select value={newAcc.account_type} onChange={(e) => setNewAcc({ ...newAcc, account_type: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
                <option value="ASSET">ASSET</option>
                <option value="LIABILITY">LIABILITY</option>
                <option value="EQUITY">EQUITY</option>
                <option value="REVENUE">REVENUE</option>
                <option value="EXPENSE">EXPENSE</option>
              </select>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={newAcc.is_control_account} onChange={(e) => setNewAcc({ ...newAcc, is_control_account: e.target.checked })} />
                <span>{tr('حساب رقابي (يمنع الترحيل اليدوي المباشر)', 'Control Account (system postings only)')}</span>
              </label>
              <button type="submit" className="min-h-[40px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] font-bold text-slate-950">
                {tr('حفظ الحساب', 'Create Account')}
              </button>
            </form>
          </SpotlightCard>
        </div>
      )}

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
