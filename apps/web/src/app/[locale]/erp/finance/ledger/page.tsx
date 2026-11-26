'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, Plus, Upload } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';

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

export default function GeneralLedgerPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [tbRows, setTbRows] = useState<TrialBalanceRow[]>([]);
  const [tbBalanced, setTbBalanced] = useState(true);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);

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
      const [accs, tb, jes] = await Promise.all([
        apiFetch<AccountRow[]>('/api/v1/finance/accounts'),
        apiFetch<{ rows: TrialBalanceRow[]; is_balanced: boolean }>('/api/v1/finance/trial-balance'),
        apiFetch<JournalEntryRow[]>('/api/v1/finance/journal-entries'),
      ]);
      setAccounts(accs);
      setTbRows(tb.rows);
      setTbBalanced(tb.is_balanced);
      setEntries(jes);
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

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpotlightHeading as="h1" className="text-2xl">
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
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-xs text-emerald-400">
            {notice}
          </SpotlightCard>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Post Balanced Entry */}
          <SpotlightCard>
            <form onSubmit={postEntry} className="space-y-3">
              <SpotlightHeading as="h2" className="text-lg">
                <Plus className="me-1.5 inline h-4 w-4" />
                {isRtl ? 'قيد يومية مزدوج جديد' : 'Post Balanced Journal Entry'}
              </SpotlightHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={refCode} onChange={(e) => setRefCode(e.target.value)} placeholder={isRtl ? 'المرجع' : 'Reference'} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={isRtl ? 'المبلغ' : 'Amount'} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-950" />
                <select value={debitAcc} onChange={(e) => setDebitAcc(e.target.value)} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{`${a.code} — ${isRtl ? a.name_ar : a.name_en} (Dr)`}</option>
                  ))}
                </select>
                <select value={creditAcc} onChange={(e) => setCreditAcc(e.target.value)} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{`${a.code} — ${isRtl ? a.name_ar : a.name_en} (Cr)`}</option>
                  ))}
                </select>
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={isRtl ? 'البيان' : 'Description'} className="min-h-[44px] sm:col-span-2 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <button type="submit" disabled={!canPost} className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-bold text-slate-950 disabled:opacity-40">
                {isRtl ? 'ترحيل القيد (مدين = دائن)' : 'Post Balanced Entry'}
              </button>
            </form>
          </SpotlightCard>

          {/* UTF-8 BOM CSV Bulk Importer */}
          <SpotlightCard className="space-y-3">
            <SpotlightHeading as="h2" className="text-lg">
              <Upload className="me-1.5 inline h-4 w-4" />
              {isRtl ? 'استيراد جماعي CSV (UTF-8 BOM)' : 'UTF-8 BOM CSV Bulk Importer'}
            </SpotlightHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              <select value={importEntity} onChange={(e) => setImportEntity(e.target.value as 'accounts' | 'inventory' | 'guests')} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="accounts">{isRtl ? 'دليل الحسابات' : 'Chart of Accounts'}</option>
                <option value="inventory">{isRtl ? 'المخزون والتجهيزات' : 'Inventory Items'}</option>
                <option value="guests">{isRtl ? 'قائمة الضيوف وتصاريح QR' : 'Guest List & QR Passes'}</option>
              </select>
              {importEntity === 'guests' && (
                <input value={importEventId} onChange={(e) => setImportEventId(e.target.value)} placeholder="Event UUID" className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-mono dark:border-slate-700 dark:bg-slate-950" />
              )}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
                className="sm:col-span-2 text-xs"
              />
            </div>
            {importPreview.length > 0 && (
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-200">
                {importPreview.join('\n')}
              </pre>
            )}
            <button type="button" disabled={!importFile} onClick={runCsvImport} className="min-h-[44px] w-full rounded-lg border border-[var(--brand-primary,#D4AF37)] text-xs font-bold text-[var(--brand-primary,#D4AF37)] disabled:opacity-40">
              {isRtl ? 'تنفيذ الاستيراد' : 'Run CSV Import'}
            </button>
          </SpotlightCard>
        </div>

        {/* Trial Balance */}
        <SpotlightCard className="space-y-3">
          <div className="flex items-center justify-between">
            <SpotlightHeading as="h2" className="text-lg">
              {isRtl ? 'ميزان المراجعة' : 'Trial Balance'}
            </SpotlightHeading>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${tbBalanced ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
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
        <SpotlightCard className="space-y-3">
          <SpotlightHeading as="h2" className="text-lg">
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
