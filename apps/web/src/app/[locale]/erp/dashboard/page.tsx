'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Calendar, CheckCircle2, ClipboardCheck, TrendingUp } from 'lucide-react';
import { apiFetch, dynamicHref } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';

interface StaffEventRow {
  id: string;
  event_code: string;
  event_type: string;
  hall_name: string;
  hall_name_ar: string;
  client_name: string;
  start_time: string;
  status: string;
  guest_count: number;
  total_amount: number;
}

interface ApprovalRow {
  id: string;
  event_code: string;
  draft_type: string;
  financial_delta: number;
  requested_by_name: string;
  required_approver_role: string;
}

export default function ErpDashboardPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [events, setEvents] = useState<StaffEventRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [evs, apps] = await Promise.all([
        apiFetch<StaffEventRow[]>('/api/v1/bookings/events'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
      ]);
      setEvents(evs);
      setApprovals(apps);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Staff login required');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolveApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    await apiFetch(`/api/v1/approvals/${id}/resolve`, {
      method: 'POST',
      body: { decision },
    });
    await load();
  };

  const totalRevenue = events.reduce((acc, e) => acc + (e.total_amount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpotlightHeading as="h1" className="text-2xl">
            {isRtl ? 'لوحة تحكم إدارة القاعة (ERP)' : 'Venue ERP Operations Dashboard'}
          </SpotlightHeading>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/${locale}/erp/finance/ledger`}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
            >
              {isRtl ? 'دفتر الأستاذ وميزان المراجعة' : 'General Ledger'}
            </Link>
            <Link
              href={`/${locale}/erp/settings/lookups`}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
            >
              {isRtl ? 'إدارة القوائم' : 'System Lookups'}
            </Link>
          </div>
        </div>

        {error && <SpotlightCard className="border-red-500/40 bg-red-500/10 text-xs text-red-500">{error}</SpotlightCard>}

        <div className="grid gap-4 sm:grid-cols-3">
          <SpotlightCard className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Calendar className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'إجمالي الفعاليات' : 'Total Events'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{events.length}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span>{isRtl ? 'إجمالي العقود' : 'Contracted Value'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{totalRevenue.toLocaleString()}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ClipboardCheck className="h-4 w-4 text-amber-500" />
              <span>{isRtl ? 'اعتمادات معلقة' : 'Pending Approvals'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{approvals.length}</div>
          </SpotlightCard>
        </div>

        {/* Cross-ERP Approvals Queue */}
        {approvals.length > 0 && (
          <SpotlightCard className="space-y-3">
            <SpotlightHeading as="h2" className="text-lg">
              {isRtl ? 'طابور الاعتمادات والمزامنة التلقائية' : 'Cross-ERP Approvals Queue'}
            </SpotlightHeading>
            {approvals.map((ap) => (
              <div key={ap.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="text-xs">
                  <span className="font-bold">{ap.event_code}</span> — {ap.draft_type} ({ap.requested_by_name})
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolveApproval(ap.id, 'APPROVED')}
                    className="flex min-h-[40px] items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {isRtl ? 'اعتماد ومزامنة' : 'Approve & Sync'}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveApproval(ap.id, 'REJECTED')}
                    className="min-h-[40px] rounded-lg bg-red-600 px-3 text-xs font-bold text-white"
                  >
                    {isRtl ? 'رفض' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </SpotlightCard>
        )}

        <SpotlightCard className="space-y-4">
          <SpotlightHeading as="h2" className="text-lg">
            {isRtl ? 'جدول الفعاليات والحجوزات' : 'Events & Bookings'}
          </SpotlightHeading>
          <ResponsiveDataList
            data={events}
            locale={locale}
            mobileCardHeader={(r) => `${r.event_code} — ${r.client_name}`}
            columns={[
              { key: 'code', headerAr: 'الرمز', headerEn: 'Code', render: (r) => <span className="font-mono text-xs">{r.event_code}</span> },
              { key: 'hall', headerAr: 'القاعة', headerEn: 'Hall', render: (r) => (isRtl ? r.hall_name_ar : r.hall_name) },
              { key: 'client', headerAr: 'العميل', headerEn: 'Client', render: (r) => r.client_name },
              { key: 'status', headerAr: 'الحالة', headerEn: 'Status', render: (r) => <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white">{r.status}</span> },
              {
                key: 'pnl',
                headerAr: 'الربحية P&L',
                headerEn: 'P&L',
                render: (r) => (
                  <Link
                    href={
                      process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE'
                        ? `/${locale}/erp/finance/events/_/pnl/?id=${encodeURIComponent(r.id)}`
                        : dynamicHref(locale, '/erp/finance/events', r.id).replace(r.id, `${r.id}/pnl`)
                    }
                    className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline"
                  >
                    {isRtl ? 'عرض P&L' : 'View P&L'}
                  </Link>
                ),
              },
            ]}
          />
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
