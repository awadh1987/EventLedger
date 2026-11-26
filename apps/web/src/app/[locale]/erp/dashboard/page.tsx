'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  GitCompare,
  Layers,
  ShieldCheck,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuthSession } from '@/components/providers/auth-provider';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, dynamicHref, tenantPath } from '@/lib/api';
import type { HallInfo } from '@/lib/types';

interface StaffEventRow {
  id: string;
  event_code: string;
  event_type: string;
  hall_id: string;
  hall_name: string;
  hall_name_ar: string;
  client_name: string;
  start_time: string;
  end_time: string;
  status: string;
  guest_count: number;
  total_amount: number;
}

interface ApprovalRow {
  id: string;
  event_id: string;
  event_code: string;
  draft_id: string;
  draft_type: string;
  financial_delta: number;
  requested_by_name: string;
  required_approver_role: string;
  created_at: string;
  payload: Record<string, unknown>;
}

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  HOLD_48H: 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300',
  CONTRACT_PENDING: 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300',
  COMPLETED: 'border-slate-500/40 bg-slate-500/15 text-slate-600 dark:text-slate-300',
  CANCELLED: 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300',
};

export default function ErpDashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const { tenantSlug } = useAuthSession();

  const [events, setEvents] = useState<StaffEventRow[]>([]);
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Post-Event Damage Inspection modal state
  const [inspectEvent, setInspectEvent] = useState<StaffEventRow | null>(null);
  const [inspectStatus, setInspectStatus] = useState<'PASSED' | 'DAMAGE_CLAIMED'>('PASSED');
  const [deductionAmount, setDeductionAmount] = useState('0');
  const [inspectNotes, setInspectNotes] = useState('');
  const [checklist, setChecklist] = useState({
    stage_and_lighting: true,
    furniture_and_chairs: true,
    av_equipment: true,
    cleanliness_and_walls: true,
  });

  const load = useCallback(async () => {
    try {
      const [evs, apps, hallList] = await Promise.all([
        apiFetch<StaffEventRow[]>('/api/v1/bookings/events'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
        apiFetch<HallInfo[]>('/api/v1/venue/halls'),
      ]);
      setEvents(evs);
      setApprovals(apps);
      setHalls(hallList);
      setSelectedApprovalId((prev) => (apps.some((a) => a.id === prev) ? prev : apps[0]?.id || ''));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Staff login required');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedApproval = approvals.find((a) => a.id === selectedApprovalId) || approvals[0] || null;

  const resolveApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await apiFetch<{ status: string }>(`/api/v1/approvals/${id}/resolve`, {
        method: 'POST',
        body: {
          decision,
          rejection_reason: decision === 'REJECTED' ? rejectionReason || 'Rejected by ERP manager' : null,
        },
      });
      setRejectionReason('');
      setNotice(
        isRtl
          ? `تم تنفيذ قرار الاعتماد والمزامنة (${res.status})`
          : `Approval resolved & synced (${res.status})`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve approval');
    }
  };

  const submitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectEvent) return;
    try {
      const res = await apiFetch<{ status: string; deposit_status: string | null }>(
        `/api/v1/erp/ops/events/${inspectEvent.id}/inspection`,
        {
          method: 'POST',
          body: {
            status: inspectStatus,
            deduction_amount: inspectStatus === 'DAMAGE_CLAIMED' ? Number(deductionAmount) || 0 : 0,
            notes: inspectNotes || null,
            checklist_json: checklist,
          },
        }
      );
      setNotice(
        isRtl
          ? `تم تسجيل فحص القاعة (${res.status}) — حالة التأمين: ${res.deposit_status || '-'}`
          : `Damage inspection submitted (${res.status}) — Deposit status: ${res.deposit_status || '-'}`
      );
      setInspectEvent(null);
      setInspectNotes('');
      setDeductionAmount('0');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit damage inspection');
    }
  };

  const totalRevenue = events.reduce((acc, e) => acc + (e.total_amount || 0), 0);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <SpotlightHeading as="h1" className="text-start text-2xl">
            {isRtl ? 'لوحة تحكم إدارة القاعة (ERP)' : 'Venue ERP Operations Dashboard'}
          </SpotlightHeading>
          <div className="flex flex-wrap gap-2">
            <Link
              href={tenantPath(locale, tenantSlug, '/erp/finance/ledger')}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
            >
              {isRtl ? 'دفتر الأستاذ وميزان المراجعة' : 'General Ledger'}
            </Link>
            <Link
              href={tenantPath(locale, tenantSlug, '/erp/ops/beo')}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
            >
              {isRtl ? 'أمر التشغيل BEO' : 'Live BEO'}
            </Link>
            <Link
              href={tenantPath(locale, tenantSlug, '/erp/settings/lookups')}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
            >
              {isRtl ? 'إدارة القوائم' : 'System Lookups'}
            </Link>
          </div>
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {notice}
          </SpotlightCard>
        )}
        {error && (
          <SpotlightCard className="border-rose-500/40 bg-rose-500/10 py-3 text-start text-xs text-rose-500">
            {error}
          </SpotlightCard>
        )}

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Calendar className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'إجمالي الفعاليات' : 'Total Events'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{events.length}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span>{isRtl ? 'إجمالي العقود' : 'Contracted Value'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{totalRevenue.toLocaleString()}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <ClipboardCheck className="h-4 w-4 text-amber-500" />
              <span>{isRtl ? 'اعتمادات معلقة' : 'Pending Approvals'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{approvals.length}</div>
          </SpotlightCard>
        </div>

        {/* 1. Master Hall Gantt Timeline */}
        <SpotlightCard className="space-y-4 text-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
              <Layers className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'الجدول الزمني الرئيسي للقاعات (Master Hall Gantt)' : 'Master Hall Gantt Timeline'}</span>
            </SpotlightHeading>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-emerald-500">
                CONFIRMED
              </span>
              <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-amber-500">
                HOLD_48H
              </span>
              <span className="rounded border border-slate-500/40 bg-slate-500/15 px-2 py-0.5 text-slate-400">
                COMPLETED
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {halls.map((hall) => {
              const hallEvents = events.filter((e) => e.hall_id === hall.id);
              return (
                <div
                  key={hall.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{isRtl ? hall.name_ar : hall.name}</span>
                      {hall.combinable_with_hall_id && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                          {isRtl ? '⇄ قابلة للدمج' : '⇄ Partition Combinable'}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">
                      {isRtl ? `سعة ${hall.capacity_banquet} | تنظيف ${hall.cleaning_buffer_minutes}د` : `Cap ${hall.capacity_banquet} | Buffer ${hall.cleaning_buffer_minutes}m`}
                    </span>
                  </div>

                  {hallEvents.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 p-2.5 text-xs text-slate-500 dark:border-slate-800">
                      {isRtl ? 'لا توجد حجوزات مجدولة على هذه القاعة.' : 'No events scheduled on this hall.'}
                    </div>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {hallEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className={`rounded-lg border p-2.5 text-xs ${STATUS_STYLE[ev.status] || STATUS_STYLE.CONFIRMED}`}
                        >
                          <div className="flex items-center justify-between gap-2 font-bold">
                            <span className="font-mono">{ev.event_code}</span>
                            <span className="rounded bg-slate-950/20 px-1.5 py-0.5 text-[10px]">{ev.status}</span>
                          </div>
                          <div className="mt-1 truncate font-semibold">{ev.client_name}</div>
                          <div dir="ltr" className="mt-1 flex items-center justify-between font-mono text-[10px] opacity-90">
                            <span>
                              {ev.start_time.slice(0, 16).replace('T', ' ')} → {ev.end_time.slice(11, 16)}
                            </span>
                            <span>+{hall.cleaning_buffer_minutes}m</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SpotlightCard>

        {/* 2. Split-Screen Approval Diff Queue */}
        <SpotlightCard className="space-y-4 text-start">
          <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
            <GitCompare className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
            <span>{isRtl ? 'طابور الاعتمادات والمقارنة (Split-Screen Diff Queue)' : 'Split-Screen Approval Diff Queue'}</span>
          </SpotlightHeading>

          {approvals.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? 'لا توجد مسودات بانتظار الاعتماد حالياً.' : 'No pending draft approvals in queue.'}
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-5">
              {/* Queue List */}
              <div className="space-y-2 lg:col-span-2">
                {approvals.map((ap) => {
                  const active = selectedApproval?.id === ap.id;
                  return (
                    <button
                      key={ap.id}
                      type="button"
                      onClick={() => setSelectedApprovalId(ap.id)}
                      className={`w-full rounded-xl border p-3 text-start text-xs transition ${
                        active
                          ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)]/10'
                          : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span className="font-mono text-amber-500">{ap.event_code}</span>
                        <span className="font-mono">+{Number(ap.financial_delta).toLocaleString()}</span>
                      </div>
                      <div className="mt-1 font-semibold">
                        {ap.draft_type} · {ap.requested_by_name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {isRtl ? 'المعتمد المطلوب:' : 'Required:'} {ap.required_approver_role}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Split-Screen Diff Inspector */}
              {selectedApproval && (
                <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 lg:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-bold text-amber-500">
                        {selectedApproval.event_code} — {selectedApproval.draft_type}
                      </div>
                      <div className="text-xs text-slate-500">
                        {isRtl ? 'مقدم الطلب:' : 'Requested by:'} {selectedApproval.requested_by_name}
                      </div>
                    </div>
                    <span className="rounded-lg bg-amber-500/15 px-3 py-1 font-mono text-xs font-bold text-amber-500">
                      Δ +{Number(selectedApproval.financial_delta).toLocaleString()}
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-1.5 font-bold text-slate-500">
                        {isRtl ? 'الحالة السابقة (Baseline)' : 'Current Baseline'}
                      </div>
                      <div className="text-slate-500">
                        {isRtl ? 'مقارنة بالتعديلات المقترحة قبل المزامنة مع الفاتورة والمخزون.' : 'Pre-change baseline before invoice & inventory sync.'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                      <div className="mb-1.5 font-bold text-emerald-500">
                        {isRtl ? 'التعديل المقترح (Proposed Diff)' : 'Proposed Payload Diff'}
                      </div>
                      <pre dir="ltr" className="overflow-x-auto font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        {JSON.stringify(selectedApproval.payload, null, 2)}
                      </pre>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder={isRtl ? 'سبب الرفض (اختياري)...' : 'Rejection reason (optional)...'}
                      className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => resolveApproval(selectedApproval.id, 'APPROVED')}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{isRtl ? 'اعتماد ومزامنة ERP' : 'Approve & Sync ERP'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveApproval(selectedApproval.id, 'REJECTED')}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white"
                    >
                      <XCircle className="h-4 w-4" />
                      <span>{isRtl ? 'رفض' : 'Reject'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SpotlightCard>

        {/* Events & Post-Event Damage Inspection Trigger */}
        <SpotlightCard className="space-y-4 text-start">
          <SpotlightHeading as="h2" className="text-start text-lg">
            {isRtl ? 'جدول الفعاليات وفحص ما بعد المناسبة' : 'Events, P&L & Post-Event Damage Inspection'}
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
                key: 'actions',
                headerAr: 'الإجراءات',
                headerEn: 'Actions',
                render: (r) => (
                  <div className="flex flex-wrap items-center gap-2">
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
                    <button
                      type="button"
                      onClick={() => {
                        setInspectEvent(r);
                        setInspectStatus('PASSED');
                        setDeductionAmount('0');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-500"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>{isRtl ? 'فحص التأمين' : 'Inspect'}</span>
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </SpotlightCard>
      </main>

      {/* Post-Event Damage Inspection Modal */}
      {inspectEvent && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <SpotlightCard className="w-full max-w-lg space-y-4 text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-start text-lg">
                {isRtl ? `فحص القاعة وتسوية التأمين (${inspectEvent.event_code})` : `Post-Event Damage Inspection (${inspectEvent.event_code})`}
              </SpotlightHeading>
              <button
                type="button"
                onClick={() => setInspectEvent(null)}
                aria-label="Close modal"
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submitInspection} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(checklist).map(([key, val]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={(e) => setChecklist((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold">{isRtl ? 'نتيجة الفحص' : 'Inspection Result'}</label>
                  <select
                    value={inspectStatus}
                    onChange={(e) => setInspectStatus(e.target.value as 'PASSED' | 'DAMAGE_CLAIMED')}
                    className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="PASSED">{isRtl ? 'سليم — اعتماد استرداد التأمين' : 'PASSED — Release Deposit'}</option>
                    <option value="DAMAGE_CLAIMED">{isRtl ? 'أضرار — خصم من التأمين' : 'DAMAGE_CLAIMED — Deduct'}</option>
                  </select>
                </div>
                {inspectStatus === 'DAMAGE_CLAIMED' && (
                  <div>
                    <label className="mb-1 block font-semibold">{isRtl ? 'مبلغ الخصم' : 'Deduction Amount'}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={deductionAmount}
                      onChange={(e) => setDeductionAmount(e.target.value)}
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block font-semibold">{isRtl ? 'ملاحظات المشرف' : 'Inspector Notes'}</label>
                <textarea
                  rows={2}
                  value={inspectNotes}
                  onChange={(e) => setInspectNotes(e.target.value)}
                  placeholder={isRtl ? 'حالة القاعة والتجهيزات...' : 'Hall and equipment condition...'}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInspectEvent(null)}
                  className="min-h-[40px] rounded-lg border border-slate-300 px-4 font-semibold dark:border-slate-700"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 font-bold text-slate-950"
                >
                  {isRtl ? 'حفظ الفحص وإتمام الفعالية' : 'Submit Inspection & Complete'}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
