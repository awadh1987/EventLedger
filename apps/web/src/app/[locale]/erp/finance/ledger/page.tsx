'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { ResponsiveDataList, type ColumnDef } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface LedgerAccountRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  lifecycle: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  debit: number;
  credit: number;
}

interface JournalEntryRow {
  id: string;
  entryNumber: string;
  date: string;
  reference: string;
  descriptionAr: string;
  descriptionEn: string;
  debitAccountCode: string;
  creditAccountCode: string;
  amount: number;
}

const INITIAL_ACCOUNTS: LedgerAccountRow[] = [
  { id: '1010', code: '1010', nameAr: 'الصندوق الرئيسي', nameEn: 'Main Cash Drawer', type: 'ASSET', lifecycle: 'ACTIVE', debit: 1450000, credit: 0 },
  { id: '1020', code: '1020', nameAr: 'البنك والمحافظ الإلكترونية', nameEn: 'Bank & E-Wallets (Kuraimi/Jaib)', type: 'ASSET', lifecycle: 'ACTIVE', debit: 4850000, credit: 0 },
  { id: '1100', code: '1100', nameAr: 'ذمم العملاء', nameEn: 'Accounts Receivable', type: 'ASSET', lifecycle: 'ACTIVE', debit: 1950000, credit: 0 },
  { id: '2100', code: '2100', nameAr: 'تأمينات الأضرار المستردة (أمانات)', nameEn: 'Refundable Security Deposits (Liability)', type: 'LIABILITY', lifecycle: 'ACTIVE', debit: 0, credit: 450000 },
  { id: '2200', code: '2200', nameAr: 'ضريبة القيمة المضافة المستحقة', nameEn: 'VAT / Tax Payable', type: 'LIABILITY', lifecycle: 'ACTIVE', debit: 0, credit: 375000 },
  { id: '4000', code: '4000', nameAr: 'إيرادات تأجير القاعات', nameEn: 'Hall Rental Revenue', type: 'REVENUE', lifecycle: 'ACTIVE', debit: 0, credit: 5100000 },
  { id: '4100', code: '4100', nameAr: 'إيرادات الضيافة والبوفيه', nameEn: 'Catering & Banquet Revenue', type: 'REVENUE', lifecycle: 'ACTIVE', debit: 0, credit: 2950000 },
  { id: '5000', code: '5000', nameAr: 'تكلفة المواد الغذائية والضيافة', nameEn: 'Catering COGS', type: 'EXPENSE', lifecycle: 'ACTIVE', debit: 625000, credit: 0 },
];

const INITIAL_ENTRIES: JournalEntryRow[] = [
  {
    id: 'je-1',
    entryNumber: 'JE-2026-000101',
    date: '2026-11-24',
    reference: 'INV-2026-101',
    descriptionAr: 'إثبات دفعة عربون حجز قاعة الماسة الكبرى عبر بنك الكريمي',
    descriptionEn: 'Booking deposit settlement via Al-Kuraimi Islamic Bank',
    debitAccountCode: '1020',
    creditAccountCode: '1100',
    amount: 1799700,
  },
  {
    id: 'je-2',
    entryNumber: 'JE-2026-000102',
    date: '2026-11-25',
    reference: 'DEP-2026-101',
    descriptionAr: 'تحصيل تأمين الأضرار المسترد في حساب الأمانات 2100 (التزامات)',
    descriptionEn: 'Refundable security deposit posted to Liability 2100 (Escrow)',
    debitAccountCode: '1020',
    creditAccountCode: '2100',
    amount: 150000,
  },
];

export default function DoubleEntryLedgerPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const branding = useTenantBranding();
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  const [accounts, setAccounts] = useState<LedgerAccountRow[]>(INITIAL_ACCOUNTS);
  const [entries, setEntries] = useState<JournalEntryRow[]>(INITIAL_ENTRIES);
  const [debitCode, setDebitCode] = useState('1020');
  const [creditCode, setCreditCode] = useState('2100');
  const [debitAmount, setDebitAmount] = useState(150000);
  const [creditAmount, setCreditAmount] = useState(150000);
  const [reference, setReference] = useState('DEP-2026-104');
  const [description, setDescription] = useState(
    isRtl ? 'تحصيل تأمين مسترد في حساب الأمانات 2100' : 'Security deposit posted to Liability 2100'
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBalanced = Math.abs(debitAmount - creditAmount) < 0.01 && debitAmount > 0;

  const totals = useMemo(() => {
    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);
    return { totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }, [accounts]);

  const fmtMoney = (n: number) =>
    `${new Intl.NumberFormat(isRtl ? 'ar-YE' : 'en-US').format(n)} ${branding.currency}`;

  const handlePostJournal = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!isBalanced) {
      setError(
        isRtl
          ? 'القيد غير متوازن! يجب أن يتساوى إجمالي المدين مع إجمالي الدائن.'
          : 'Unbalanced journal entry! Total debit must equal total credit.'
      );
      return;
    }
    if (debitCode === creditCode) {
      setError(
        isRtl
          ? 'لا يمكن أن يكون حساب المدين هو نفس حساب الدائن.'
          : 'Debit account and Credit account must be distinct.'
      );
      return;
    }

    const nextNum = `JE-2026-${String(100 + entries.length + 1).padStart(6, '0')}`;
    const newEntry: JournalEntryRow = {
      id: `je-${Date.now()}`,
      entryNumber: nextNum,
      date: new Date().toISOString().slice(0, 10),
      reference,
      descriptionAr: description,
      descriptionEn: description,
      debitAccountCode: debitCode,
      creditAccountCode: creditCode,
      amount: debitAmount,
    };
    setEntries((prev) => [newEntry, ...prev]);
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.code === debitCode) return { ...a, debit: a.debit + debitAmount };
        if (a.code === creditCode) return { ...a, credit: a.credit + creditAmount };
        return a;
      })
    );
    setNotice(
      isRtl
        ? `تم ترحيل القيد المحاسبي المزدوج المتوازن (${nextNum}) بنجاح.`
        : `Balanced double-entry journal (${nextNum}) posted successfully.`
    );
  };

  const handleExportBomCsv = () => {
    const header = 'code,name_ar,name_en,account_type,lifecycle,debit,credit\n';
    const rows = accounts
      .map((a) => `${a.code},"${a.nameAr}","${a.nameEn}",${a.type},${a.lifecycle},${a.debit},${a.credit}`)
      .join('\n');
    const bomCsv = '\uFEFF' + header + rows;
    const blob = new Blob([bomCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `eventledger-trial-balance-${locale}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    const cleaned = raw.replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return;
    let added = 0;
    const nextAccounts = [...accounts];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const [code, nameAr, nameEn, typeRaw] = cols;
      if (!code || nextAccounts.some((a) => a.code === code)) continue;
      const validType = (['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(typeRaw)
        ? typeRaw
        : 'ASSET') as LedgerAccountRow['type'];
      nextAccounts.push({
        id: code,
        code,
        nameAr: nameAr || code,
        nameEn: nameEn || code,
        type: validType,
        lifecycle: 'ACTIVE',
        debit: 0,
        credit: 0,
      });
      added++;
    }
    setAccounts(nextAccounts);
    setNotice(
      isRtl
        ? `تم استيراد ${added} حسابات جديدة من ملف CSV بنجاح (مع دعم UTF-8 BOM).`
        : `Imported ${added} accounts from UTF-8 BOM CSV.`
    );
  };

  const columns: ColumnDef<LedgerAccountRow>[] = [
    {
      key: 'code',
      headerAr: 'رقم الحساب',
      headerEn: 'Code',
      render: (row) => <span className="font-mono font-semibold text-amber-600 dark:text-[#D4AF37]">{row.code}</span>,
    },
    {
      key: 'name',
      headerAr: 'اسم الحساب',
      headerEn: 'Account Title',
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{isRtl ? row.nameAr : row.nameEn}</div>
          <div className="text-[11px] text-slate-500">{isRtl ? row.nameEn : row.nameAr}</div>
        </div>
      ),
    },
    {
      key: 'type',
      headerAr: 'التصنيف',
      headerEn: 'Type',
      render: (row) => <span className="font-mono text-xs">{row.type}</span>,
    },
    {
      key: 'debit',
      headerAr: 'مدين (Debit)',
      headerEn: 'Debit',
      render: (row) => <span className="font-mono tabular-nums">{fmtMoney(row.debit)}</span>,
    },
    {
      key: 'credit',
      headerAr: 'دائن (Credit)',
      headerEn: 'Credit',
      render: (row) => <span className="font-mono tabular-nums">{fmtMoney(row.credit)}</span>,
    },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/${locale}/dashboard`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <BackIcon className="h-3.5 w-3.5" />
              <span>{isRtl ? 'لوحة العمليات' : 'ERP Console'}</span>
            </Link>
            <SpotlightHeading as="h1" className="text-lg">
              {isRtl ? 'دفتر الأستاذ العام وميزان المراجعة المزدوج' : 'Double-Entry General Ledger & Trial Balance'}
            </SpotlightHeading>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${locale}/erp/finance/events/EVT-2026-101/pnl`}
              className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200"
            >
              {isRtl ? 'ربحية الفعاليات (Event P&L)' : 'Event P&L Statement'}
            </Link>
            <label className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              <Upload className="h-3.5 w-3.5" />
              <span>{isRtl ? 'استيراد CSV (UTF-8 BOM)' : 'Import CSV (UTF-8 BOM)'}</span>
              <input type="file" accept=".csv" onChange={handleImportCsv} className="hidden" />
            </label>
            <button
              type="button"
              onClick={handleExportBomCsv}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-semibold text-slate-950"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isRtl ? 'تصدير ميزان المراجعة CSV' : 'Export Trial Balance CSV'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        {/* Trial Balance Invariant Banner */}
        <SpotlightCard className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isRtl
                  ? 'قاعدة القيد المزدوج وحساب تأمينات الأضرار (2100)'
                  : 'Double-Entry Balance Invariant & Liability Escrow (2100)'}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl
                  ? 'تُقيّد تأمينات الأضرار المستردة دائماً في حساب الالتزامات 2100 وليس في حساب إيرادات القاعات 4000.'
                  : 'Refundable security deposits post strictly to Liability Account 2100, never to Hall Revenue 4000.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 font-mono text-xs tabular-nums">
            <div>
              <span className="text-slate-500">{isRtl ? 'إجمالي المدين:' : 'Total Debit:'}</span>{' '}
              <strong className="text-slate-900 dark:text-slate-100">{fmtMoney(totals.totalDebit)}</strong>
            </div>
            <div>
              <span className="text-slate-500">{isRtl ? 'إجمالي الدائن:' : 'Total Credit:'}</span>{' '}
              <strong className="text-slate-900 dark:text-slate-100">{fmtMoney(totals.totalCredit)}</strong>
            </div>
            <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-700 dark:text-emerald-400">
              {totals.balanced ? (isRtl ? 'متوازن 100%' : 'BALANCED') : 'UNBALANCED'}
            </span>
          </div>
        </SpotlightCard>

        {error && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Post Balanced Journal Entry Form */}
        <SpotlightCard>
          <SpotlightHeading as="h2" className="text-base">
            {isRtl ? 'ترحيل قيد يومية مزدوج متوازن' : 'Post Balanced Double-Entry Journal'}
          </SpotlightHeading>
          <form onSubmit={handlePostJournal} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
            <div>
              <label className="block text-xs text-slate-500">{isRtl ? 'حساب المدين (Debit)' : 'Debit Account'}</label>
              <select
                value={debitCode}
                onChange={(e) => setDebitCode(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {isRtl ? a.nameAr : a.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">{isRtl ? 'مبلغ المدين' : 'Debit Amount'}</label>
              <input
                type="number"
                min={1}
                value={debitAmount}
                onChange={(e) => setDebitAmount(Number(e.target.value))}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">{isRtl ? 'حساب الدائن (Credit)' : 'Credit Account'}</label>
              <select
                value={creditCode}
                onChange={(e) => setCreditCode(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {isRtl ? a.nameAr : a.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">{isRtl ? 'مبلغ الدائن' : 'Credit Amount'}</label>
              <input
                type="number"
                min={1}
                value={creditAmount}
                onChange={(e) => setCreditAmount(Number(e.target.value))}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">{isRtl ? 'المرجع والبيان' : 'Reference & Memo'}</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={reference}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                <span>{isRtl ? 'ترحيل القيد' : 'Post Journal'}</span>
              </button>
            </div>
          </form>
        </SpotlightCard>

        {/* Responsive Trial Balance Table / Mobile Cards */}
        <div className="space-y-3">
          <SpotlightHeading as="h2" className="text-base">
            {isRtl ? 'ميزان المراجعة وشجرة الحسابات' : 'Trial Balance & Chart of Accounts'}
          </SpotlightHeading>
          <ResponsiveDataList
            data={accounts}
            columns={columns}
            locale={locale}
            mobileCardHeader={(row) => `${row.code} — ${isRtl ? row.nameAr : row.nameEn}`}
          />
        </div>
      </main>

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
