'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardList, Loader2, QrCode, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import type { ScheduledEvent } from '@/lib/bookings-store';

interface ApprovalDraft {
  id: string;
  eventId: string;
  eventCode: string;
  draftType: string;
  titleEn: string;
  titleAr: string;
  requestedByName: string;
  financialDelta: number;
  currency: string;
  status: string;
  notes: string;
}

interface GatePass {
  id: string;
  eventId: string;
  eventCode: string;
  passType: string;
  holderName: string;
  holderIdNumber: string;
  qrToken: string;
  isCheckedIn: boolean;
  checkedInAt: string | null;
}

interface AuditLogEntry {
  id: number;
  actorName: string;
  eventCode: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export function OperationsBeoPanel({
  locale,
  events,
  onDataChanged,
}: {
  locale: 'ar' | 'en';
  events: ScheduledEvent[];
  onDataChanged?: () => void;
}) {
  const isRtl = locale === 'ar';
  const { authFetch } = useAuth();

  const [drafts, setDrafts] = useState<ApprovalDraft[]>([]);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [passEventId, setPassEventId] = useState('');
  const [passType, setPassType] = useState('VIP_PASS');
  const [holderName, setHolderName] = useState('');
  const [holderIdNumber, setHolderIdNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadOps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/v1/portal', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Failed to load operations data');
      setDrafts(Array.isArray(data?.drafts) ? data.drafts : []);
      setPasses(Array.isArray(data?.passes) ? data.passes : []);
      setLogs(Array.isArray(data?.auditLogs) ? data.auditLogs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operations');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadOps();
  }, [loadOps]);

  useEffect(() => {
    if (!passEventId && events.length > 0) {
      setPassEventId(events[0].id);
    }
  }, [events, passEventId]);

  const handleApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_approval', id, decision }),
      });
      if (res.ok) {
        await loadOps();
        onDataChanged?.();
      }
    } catch {
      // ignore
    }
  };

  const handleIssuePass = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEv = events.find((ev) => ev.id === passEventId);
    if (!targetEv || !holderName.trim()) return;
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'issue_gate_pass',
          eventId: targetEv.id,
          eventCode: targetEv.eventCode,
          passType,
          holderName: holderName.trim(),
          holderIdNumber: holderIdNumber.trim(),
        }),
      });
      if (res.ok) {
        setHolderName('');
        setHolderIdNumber('');
        await loadOps();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleCheckIn = async (id: string) => {
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_gate_pass', id }),
      });
      if (res.ok) await loadOps();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <Loader2 className="me-2 h-4 w-4 animate-spin" />
        <span>{isRtl ? 'جاري تحميل أوامر التشغيل والاعتمادات...' : 'Loading operations console...'}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* Dual-Approval Queue & VIP QR Gate Passes */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Dual-Approval Requests */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-[var(--brand-primary,#D4AF37)]" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'طابور الاعتماد المزدوج للإضافات' : 'Dual-Approval Change Requests'}
            </h3>
          </div>

          <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
            {drafts.length === 0 ? (
              <p className="py-6 text-xs text-slate-500">
                {isRtl ? 'لا توجد طلبات تعديل معلقة.' : 'No change requests yet.'}
              </p>
            ) : (
              drafts.map((d) => (
                <div key={d.id} className="space-y-2 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-500">
                      {d.eventCode} · {d.draftType}
                    </span>
                    <span
                      className={`font-semibold ${
                        d.status === 'APPROVED'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : d.status === 'REJECTED'
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? d.titleAr : d.titleEn}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {d.requestedByName} ·{' '}
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      +{new Intl.NumberFormat(isRtl ? 'ar-YE' : 'en-US').format(d.financialDelta)} {d.currency}
                    </span>
                  </div>
                  {d.status === 'PENDING' && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleApproval(d.id, 'APPROVED')}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'اعتماد وإضافة للفاتورة' : 'Approve & Sync Invoice'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApproval(d.id, 'REJECTED')}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'رفض' : 'Reject'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* VIP & Vendor QR Gate Passes */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <QrCode className="h-4 w-4 text-amber-600 dark:text-[var(--brand-primary,#D4AF37)]" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'تصاريح الدخول QR لكبار الشخصيات والموردين' : 'VIP & Vendor QR Gate Passes'}
            </h3>
          </div>

          <form onSubmit={handleIssuePass} className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <select
              value={passEventId}
              onChange={(e) => setPassEventId(e.target.value)}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.eventCode} — {isRtl ? ev.titleAr : ev.titleEn}
                </option>
              ))}
            </select>
            <select
              value={passType}
              onChange={(e) => setPassType(e.target.value)}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
            >
              <option value="VIP_PASS">VIP_PASS</option>
              <option value="VENDOR_PASS">VENDOR_PASS</option>
              <option value="FAMILY_PASS">FAMILY_PASS</option>
            </select>
            <input
              required
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder={isRtl ? 'اسم حامل التصريح' : 'Pass holder full name'}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[36px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-semibold text-slate-950 hover:opacity-90 disabled:opacity-50"
            >
              {isRtl ? 'إصدار تصريح QR' : 'Issue QR Pass'}
            </button>
          </form>

          <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
            {passes.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{p.holderName}</div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {p.qrToken} · {p.passType}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleCheckIn(p.id)}
                  className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-semibold ${
                    p.isCheckedIn
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200'
                  }`}
                >
                  {p.isCheckedIn ? (isRtl ? 'تم الدخول' : 'Checked In') : isRtl ? 'تسجيل دخول' : 'Check In'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Banquet Event Orders (BEO) & Audit Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <ClipboardList className="h-4 w-4 text-amber-600 dark:text-[var(--brand-primary,#D4AF37)]" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'أوامر التشغيل المباشرة للقاعات (Live BEO)' : 'Live Banquet Event Orders (BEO)'}
            </h3>
          </div>
          <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
            {events
              .filter((e) => e.status !== 'CANCELLED')
              .slice(0, 6)
              .map((ev) => (
                <div key={ev.id} className="py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? ev.titleAr : ev.titleEn}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {ev.eventCode} · {isRtl ? ev.hallNameAr : ev.hallNameEn} · {ev.guestCount}{' '}
                      {isRtl ? 'ضيف' : 'guests'}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">
                    {isRtl ? ev.notesAr : ev.notesEn}
                  </p>
                </div>
              ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="border-b border-slate-200 pb-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
            {isRtl ? 'سجل التدقيق غير القابل للتعديل' : 'Immutable Audit Trail'}
          </h3>
          <div className="mt-3 max-h-[340px] space-y-2.5 overflow-y-auto text-xs">
            {logs.map((log) => (
              <div key={log.id} className="border-b border-slate-100 pb-2 last:border-b-0 dark:border-slate-800">
                <div className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                  {log.action}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {log.actorName}
                  {log.eventCode ? ` · ${log.eventCode}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
