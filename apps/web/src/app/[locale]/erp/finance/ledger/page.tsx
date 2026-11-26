'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Download, ExternalLink, Plus, Receipt, Upload } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, downloadAuthorizedFile, getApiOrigin } from '@/lib/api';

interface AccountRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  account_type: string;
}

interface TrialBalanceRow extends AccountRow {
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

export default function GeneralLedgerPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [tbRows, setTbRows] = useState<TrialBalanceRow[]>([]);
  const [tbBalanced, setTbBalanced] = useState(true);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

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

  const load = useCallback(async () => {
    try {
      const [accs, tb, jes, invs] = await Promise.all([
        apiFetch<AccountRow[]>('/api/v1/finance/accounts'),
        apiFetch<{ rows: TrialBalanceRow[]; is_balanced: boolean }>('/api/v1/finance/trial-balance'),
        apiFetch<JournalEntryRow[]>('/api/v1/finance/journal-entries'),
        apiFetch<InvoiceRow[]>('/api/v1/finance/invoices'),
      ]);
      setAccounts(accs);
      setTbRows(tb.rows);
      setTbBalanced(tb.is_balanced);
      setEntries(jes);
      setInvoices(invs);
      if (accs[0] && !debitAcc) setDebitAcc(accs[0].id);
      if (accs[1] && !creditAcc) setCreditAcc(accs[1].id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Finance login required');
    }
  }, [creditAcc, debitAcc]);

  useEffect(() => {
    load();
  }, [load]);

  const numericAmount = Number(amount) || 0;
  const canPost = numericAmount > 0 && debitAcc && creditAcc && debitAcc !== creditAcc;

  const verifyMilestone = async (milestoneId: string) => {
    try {
      const method = verifyMethods[milestoneId] || 'KURAIMI_BANK';
      const isDeposit = Boolean(verifyDeposits[milestoneId]);
      const reference = verifyRefs[milestoneId] || 'Verified Transfer';
      const res = await apiFetch<{ status: string; invoice_status: string; journal_entry_number: string }>(
        `/api/v1/erp/finance/milestones/${milestoneId}/verify`,
        {
          method: 'PATCH',
          body: {
            payment_method: method,
            is_security_deposit: isDeposit,
            reference,
          },
        }
      );
      setNotice(
        isRtl
          ? `تم اعتماد الدفعة وترحيل القيد المزدوج ${res.journal_entry_number} (حالة الفاتورة: ${res.invoice_status})`
          : `Verified receipt & posted Journal ${res.journal_entry_number} (Invoice: ${res.invoice_status})`
      );
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const postEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPost) return;
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
    setNotice(isRtl ? 'تم ترحيل القيد المحاسبي المتوازن بنجاح' : 'Balanced journal entry posted');
    await load();
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
      isRtl
        ? `تم استيراد ${res.imported_rows} صف (تخطي ${res.skipped_rows})`
        : `Imported ${res.imported_rows} rows (${res.skipped_rows} skipped)`
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

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <SpotlightHeading as="h1" className="text-start text-2xl">
            {isRtl ? 'دفتر الأستاذ وميزان المراجعة المزدوج' : 'Double-Entry Ledger & Trial Balance'}
          </SpotlightHeading>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadAuthorizedFile('/api/v1/exports/trial-balance.csv', 'trial-balance.csv')}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <Download className="h-4 w-4" />
              {isRtl ? 'تصدير ميزان المراجعة CSV' : 'Export Trial Balance CSV'}
            </button>
            <button
              type="button"
              onClick={() => downloadAuthorizedFile('/api/v1/exports/journal.csv', 'journal.csv')}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <Download className="h-4 w-4" />
              {isRtl ? 'تصدير القيود CSV' : 'Export Journal CSV'}
            </button>
          </div>
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {notice}
          </SpotlightCard>
        )}

        {/* Milestone Receipt Verification Queue */}
        <SpotlightCard className="space-y-4 text-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
              <Receipt className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'طابور التحقق من إيصالات الدفع والترحيل التلقائي' : 'Milestone Receipt Verification Queue'}</span>
            </SpotlightHeading>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-mono text-xs font-bold text-amber-500">
              {pendingMilestones.length} {isRtl ? 'دفعة معلقة' : 'Pending'}
            </span>
          </div>

          {pendingMilestones.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? 'تم التحقق من جميع الدفعات المجدولة.' : 'All scheduled payment milestones are verified.'}
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
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      {m.invoice_number} — {m.title} ·{' '}
                      <strong className="font-mono text-slate-900 dark:text-slate-100">
                        {Number(m.amount_due).toLocaleString()}
                      </strong>
                    </div>
                    {m.receipt_url && (
                      <a
                        href={`${getApiOrigin()}${m.receipt_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-sky-500 underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'معاينة الإيصال المرفوع' : 'View Uploaded Receipt'}</span>
                      </a>
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
                      placeholder={isRtl ? 'رقم المرجع' : 'Ref #'}
                      className="min-h-[38px] w-28 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />

                    <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(verifyDeposits[m.id])}
                        onChange={(e) => setVerifyDeposits((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                      />
                      <span>{isRtl ? 'تأمين 2100' : '2100 Deposit'}</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => verifyMilestone(m.id)}
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 font-bold text-white"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{isRtl ? 'اعتماد وترحيل القيد' : 'Verify & Post Journal'}</span>
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
                {isRtl ? 'قيد يومية مزدوج جديد' : 'Post Balanced Journal Entry'}
              </SpotlightHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={refCode}
                  onChange={(e) => setRefCode(e.target.value)}
                  placeholder={isRtl ? 'المرجع' : 'Reference'}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={isRtl ? 'المبلغ' : 'Amount'}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <select
                  value={debitAcc}
                  onChange={(e) => setDebitAcc(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{`${a.code} — ${isRtl ? a.name_ar : a.name_en} (Dr)`}</option>
                  ))}
                </select>
                <select
                  value={creditAcc}
                  onChange={(e) => setCreditAcc(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{`${a.code} — ${isRtl ? a.name_ar : a.name_en} (Cr)`}</option>
                  ))}
                </select>
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={isRtl ? 'البيان' : 'Description'}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 sm:col-span-2"
                />
              </div>
              <button
                type="submit"
                disabled={!canPost}
                className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-bold text-slate-950 disabled:opacity-40"
              >
                {isRtl ? 'ترحيل القيد (مدين = دائن)' : 'Post Balanced Entry'}
              </button>
            </form>
          </SpotlightCard>

          {/* UTF-8 BOM CSV Bulk Importer */}
          <SpotlightCard className="space-y-3 text-start">
            <SpotlightHeading as="h2" className="text-start text-lg">
              <Upload className="me-1.5 inline h-4 w-4" />
              {isRtl ? 'استيراد جماعي CSV (UTF-8 BOM)' : 'UTF-8 BOM CSV Bulk Importer'}
            </SpotlightHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={importEntity}
                onChange={(e) => setImportEntity(e.target.value as 'accounts' | 'inventory' | 'guests')}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="accounts">{isRtl ? 'دليل الحسابات' : 'Chart of Accounts'}</option>
                <option value="inventory">{isRtl ? 'المخزون والتجهيزات' : 'Inventory Items'}</option>
                <option value="guests">{isRtl ? 'قائمة الضيوف وتصاريح QR' : 'Guest List & QR Passes'}</option>
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
              {isRtl ? 'تنفيذ الاستيراد' : 'Run CSV Import'}
            </button>
          </SpotlightCard>
        </div>

        {/* Trial Balance */}
        <SpotlightCard className="space-y-3 text-start">
          <div className="flex items-center justify-between">
            <SpotlightHeading as="h2" className="text-start text-lg">
              {isRtl ? 'ميزان المراجعة' : 'Trial Balance'}
            </SpotlightHeading>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                tbBalanced ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {tbBalanced ? (isRtl ? 'متوازن ✓' : 'Balanced ✓') : isRtl ? 'غير متوازن!' : 'Unbalanced!'}
            </span>
          </div>
          <ResponsiveDataList
            data={tbRows}
            locale={locale}
            mobileCardHeader={(r) => `${r.code} — ${isRtl ? r.name_ar : r.name_en}`}
            columns={[
              { key: 'code', headerAr: 'الرمز', headerEn: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
              { key: 'name', headerAr: 'الحساب', headerEn: 'Account', render: (r) => (isRtl ? r.name_ar : r.name_en) },
              { key: 'debit', headerAr: 'مدين', headerEn: 'Debit', render: (r) => <span className="font-mono">{r.total_debit.toLocaleString()}</span> },
              { key: 'credit', headerAr: 'دائن', headerEn: 'Credit', render: (r) => <span className="font-mono">{r.total_credit.toLocaleString()}</span> },
              { key: 'bal', headerAr: 'الرصيد', headerEn: 'Balance', render: (r) => <span className="font-mono font-bold">{r.balance.toLocaleString()}</span> },
            ]}
          />
        </SpotlightCard>

        {/* Journal Entries */}
        <SpotlightCard className="space-y-3 text-start">
          <SpotlightHeading as="h2" className="text-start text-lg">
            {isRtl ? 'سجل قيود اليومية' : 'Posted Journal Entries'}
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
            ]}
          />
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
