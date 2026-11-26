'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

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
  expenses: { category: string; description: string; amount: number }[];
}

function EventPnlInner() {
  const params = useParams<{ locale: string; id: string }>();
  const searchParams = useSearchParams();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const eventId = params?.id === '_' ? searchParams?.get('id') || '' : params?.id || '';

  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    apiFetch<PnlData>(`/api/v1/finance/events/${eventId}/pnl`)
      .then(setPnl)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load P&L'));
  }, [eventId]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <SpotlightHeading as="h1" className="text-2xl">
          {isRtl ? 'تقرير أرباح وخسائر الفعالية (P&L)' : 'Event Profit & Loss Statement'}
        </SpotlightHeading>

        {error && <SpotlightCard className="border-red-500/40 bg-red-500/10 text-xs text-red-500">{error}</SpotlightCard>}

        {pnl && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SpotlightCard>
              <div className="text-xs text-slate-500">{isRtl ? 'صافي الإيرادات' : 'Net Revenue'}</div>
              <div className="mt-1 font-mono text-xl font-bold">{pnl.net_revenue.toLocaleString()}</div>
            </SpotlightCard>
            <SpotlightCard>
              <div className="text-xs text-slate-500">{isRtl ? 'إجمالي المصروفات' : 'Total Expenses'}</div>
              <div className="mt-1 font-mono text-xl font-bold text-red-500">{pnl.total_expenses.toLocaleString()}</div>
            </SpotlightCard>
            <SpotlightCard>
              <div className="text-xs text-slate-500">{isRtl ? 'صافي الربح' : 'Net Profit'}</div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-500">
                {pnl.net_profit.toLocaleString()} ({pnl.margin_percent}%)
              </div>
            </SpotlightCard>
            <SpotlightCard>
              <div className="text-xs text-slate-500">{isRtl ? 'أمانة التأمين المحتجزة (2100)' : 'Security Deposit Held (2100)'}</div>
              <div className="mt-1 font-mono text-xl font-bold text-amber-500">
                {pnl.security_deposit_held.toLocaleString()}
              </div>
            </SpotlightCard>
          </div>
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
