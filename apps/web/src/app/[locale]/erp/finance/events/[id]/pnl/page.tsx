'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Plus, TrendingUp } from 'lucide-react';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { ResponsiveDataList, type ColumnDef } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface PnlLineItem {
  id: string;
  category: 'REVENUE' | 'EXPENSE';
  accountCode: string;
  titleAr: string;
  titleEn: string;
  amount: number;
}

const INITIAL_LINES: PnlLineItem[] = [
  { id: 'rev-1', category: 'REVENUE', accountCode: '4000', titleAr: 'إيراد إيجار قاعة الماسة الكبرى (ذروة نهاية الأسبوع)', titleEn: 'Grand Diamond Hall Rental (Weekend Peak)', amount: 1800000 },
  { id: 'rev-2', category: 'REVENUE', accountCode: '4100', titleAr: 'بوفيه الضيافة الملكي (250 ضيف)', titleEn: 'Royal Banquet Catering (250 Guests)', amount: 1625000 },
  { id: 'rev-3', category: 'REVENUE', accountCode: '4000', titleAr: 'إضافات الإضاءة والكراسي الذهبية', titleEn: 'Stage Lighting & Gold Chiavari Chairs Add-Ons', amount: 175000 },
  { id: 'exp-1', category: 'EXPENSE', accountCode: '5000', titleAr: 'تكلفة المواد الغذائية والمطبخ (COGS)', titleEn: 'Kitchen & Food Ingredients COGS', amount: 880000 },
  { id: 'exp-2', category: 'EXPENSE', accountCode: '5100', titleAr: 'أجور طاقم الضيافة والأمن الإضافي', titleEn: 'Banquet Waitstaff & Security Overtime', amount: 195000 },
  { id: 'exp-3', category: 'EXPENSE', accountCode: '5200', titleAr: 'وقود المولدات والتكييف المركزي للفعالية', titleEn: 'Generator Fuel & HVAC Utility Allocation', amount: 115000 },
];

export default function EventPnlPage() {
  const params = useParams<{ locale?: string; id?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const eventId = params?.id || 'EVT-2026-101';
  const isRtl = locale === 'ar';
  const branding = useTenantBranding();
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  const [lines, setLines] = useState<PnlLineItem[]>(INITIAL_LINES);
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState(45000);

  const summary = useMemo(() => {
    const netRevenue = lines.filter((l) => l.category === 'REVENUE').reduce((s, l) => s + l.amount, 0);
    const totalExpenses = lines.filter((l) => l.category === 'EXPENSE').reduce((s, l) => s + l.amount, 0);
    const netProfit = netRevenue - totalExpenses;
    const marginPercent = netRevenue > 0 ? Number(((netProfit / netRevenue) * 100).toFixed(2)) : 0;
    return { netRevenue, totalExpenses, netProfit, marginPercent };
  }, [lines]);

  const fmtMoney = (n: number) =>
    `${new Intl.NumberFormat(isRtl ? 'ar-YE' : 'en-US').format(n)} ${branding.currency}`;

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim() || expAmount <= 0) return;
    setLines((prev) => [
      ...prev,
      {
        id: `exp-${Date.now()}`,
        category: 'EXPENSE',
        accountCode: '5000',
        titleAr: expTitle.trim(),
        titleEn: expTitle.trim(),
        amount: expAmount,
      },
    ]);
    setExpTitle('');
  };

  const columns: ColumnDef<PnlLineItem>[] = [
    {
      key: 'code',
      headerAr: 'الحساب',
      headerEn: 'Account',
      render: (row) => <span className="font-mono font-semibold">{row.accountCode}</span>,
    },
    {
      key: 'category',
      headerAr: 'النوع',
      headerEn: 'Category',
      render: (row) => (
        <span
          className={`font-mono text-xs font-semibold ${
            row.category === 'REVENUE' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {row.category}
        </span>
      ),
    },
    {
      key: 'title',
      headerAr: 'البيان',
      headerEn: 'Line Item',
      render: (row) => <span>{isRtl ? row.titleAr : row.titleEn}</span>,
    },
    {
      key: 'amount',
      headerAr: 'المبلغ',
      headerEn: 'Amount',
      render: (row) => (
        <span className="font-mono font-semibold tabular-nums">
          {row.category === 'EXPENSE' ? '-' : '+'}
          {fmtMoney(row.amount)}
        </span>
      ),
    },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/${locale}/erp/finance/ledger`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200"
            >
              <BackIcon className="h-3.5 w-3.5" />
              <span>{isRtl ? 'دفتر الأستاذ' : 'General Ledger'}</span>
            </Link>
            <SpotlightHeading as="h1" className="text-lg">
              {isRtl ? `قائمة الأرباح والخسائر للفعالية (${eventId})` : `Event Profit & Loss Statement (${eventId})`}
            </SpotlightHeading>
          </div>
          <Link
            href={`/${locale === 'ar' ? 'en' : 'ar'}/erp/finance/events/${eventId}/pnl`}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300"
          >
            {isRtl ? 'English' : 'العربية'}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <SpotlightCard>
            <div className="text-xs text-slate-500">{isRtl ? 'صافي الإيرادات' : 'Net Revenue'}</div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {fmtMoney(summary.netRevenue)}
            </div>
          </SpotlightCard>
          <SpotlightCard>
            <div className="text-xs text-slate-500">{isRtl ? 'إجمالي المصروفات المباشرة' : 'Direct Event Expenses'}</div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {fmtMoney(summary.totalExpenses)}
            </div>
          </SpotlightCard>
          <SpotlightCard>
            <div className="text-xs text-slate-500">{isRtl ? 'صافي ربح الفعالية' : 'Net Event Profit'}</div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtMoney(summary.netProfit)}
            </div>
          </SpotlightCard>
          <SpotlightCard>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
              <span>{isRtl ? 'هامش الربح التشغيلي' : 'Profit Margin'}</span>
            </div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-600 dark:text-[#D4AF37]">
              {summary.marginPercent}%
            </div>
          </SpotlightCard>
        </div>

        <SpotlightCard>
          <form onSubmit={handleAddExpense} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs text-slate-500">
                {isRtl ? 'تسجيل مصروف تشغيلي مباشر للفعالية' : 'Record Direct Event Expense (COGS)'}
              </label>
              <input
                required
                value={expTitle}
                onChange={(e) => setExpTitle(e.target.value)}
                placeholder={isRtl ? 'مثال: ضيافة قهوة عربية وبخور ملكي' : 'e.g. Floral stage centerpiece arrangement'}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs text-slate-500">{isRtl ? 'المبلغ' : 'Amount'}</label>
              <input
                type="number"
                min={1}
                value={expAmount}
                onChange={(e) => setExpAmount(Number(e.target.value))}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950"
            >
              <Plus className="h-4 w-4" />
              <span>{isRtl ? 'إضافة مصروف' : 'Add Expense'}</span>
            </button>
          </form>
        </SpotlightCard>

        <ResponsiveDataList
          data={lines}
          columns={columns}
          locale={locale}
          mobileCardHeader={(row) => `${row.accountCode} — ${isRtl ? row.titleAr : row.titleEn}`}
        />
      </main>

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
