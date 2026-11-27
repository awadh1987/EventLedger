'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Shield,
  ShieldCheck,
  User,
} from 'lucide-react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { tenantPath } from '@/lib/api';
import type { HallInfo } from '@/lib/types';

export type OutlookCalView = 'MONTH' | 'WEEK' | 'DAY' | 'AGENDA';

export interface CalendarEventRow {
  id: string;
  event_code: string;
  title?: string | null;
  event_type: string;
  hall_id: string;
  hall_ids?: string[];
  hall_name: string;
  hall_name_ar: string;
  client_id?: string;
  client_name: string;
  client_phone?: string;
  start_time: string;
  end_time: string;
  status: string;
  guest_count: number;
  total_amount: number;
  paid_amount?: number;
  security_deposit_amount?: number;
  deposit_status?: string;
  is_locked?: boolean;
  closed_at?: string | null;
  closing_remarks?: string | null;
  security_status?: string;
}

interface Props {
  locale: 'ar' | 'en';
  tenantSlug: string;
  halls: HallInfo[];
  events: CalendarEventRow[];
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  onJumpToSecurity?: (eventId: string, subtab?: 'READINESS' | 'PASSES' | 'DEPOSIT_CLOSE') => void;
  onOpenInspection?: (ev: CalendarEventRow) => void;
}

const STATUS_STYLE: Record<string, string> = {
  INQUIRY: 'border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300',
  HOLD_48H: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  CONTRACT_PENDING: 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300',
  CONFIRMED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  COMPLETED: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  CLOSED: 'border-slate-500/50 bg-slate-500/20 text-slate-700 dark:text-slate-200',
  CANCELLED: 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

const WEEKDAY_HEADERS = [
  { ar: 'الأحد', en: 'Sun' },
  { ar: 'الاثنين', en: 'Mon' },
  { ar: 'الثلاثاء', en: 'Tue' },
  { ar: 'الأربعاء', en: 'Wed' },
  { ar: 'الخميس', en: 'Thu' },
  { ar: 'الجمعة', en: 'Fri' },
  { ar: 'السبت', en: 'Sat' },
];

const HOURS = Array.from({ length: 16 }, (_, idx) => idx + 8); // 08:00 - 23:00

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalHour(isoStr: string): number {
  const m = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!m) return 17;
  return Number(m[1]) + Number(m[2]) / 60;
}

export function OutlookHallCalendar({
  locale,
  tenantSlug,
  halls,
  events,
  selectedEventId,
  onSelectEvent,
  onJumpToSecurity,
  onOpenInspection,
}: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [calView, setCalView] = useState<OutlookCalView>('WEEK');
  const [cursorDate, setCursorDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [hallFilter, setHallFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const scopedEvents = useMemo(() => {
    return events.filter((ev) => {
      const hids = ev.hall_ids && ev.hall_ids.length > 0 ? ev.hall_ids : [ev.hall_id];
      if (hallFilter !== 'ALL' && !hids.includes(hallFilter)) return false;
      if (statusFilter !== 'ALL' && ev.status !== statusFilter) return false;
      return true;
    });
  }, [events, hallFilter, statusFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const ev of scopedEvents) {
      const key = ev.start_time.slice(0, 10);
      const list = map.get(key) || [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [scopedEvents]);

  const shiftCursor = (direction: -1 | 1) => {
    setCursorDate((prev) => {
      const next = new Date(prev);
      if (calView === 'MONTH') {
        next.setMonth(next.getMonth() + direction);
      } else if (calView === 'WEEK') {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setDate(next.getDate() + direction);
      }
      return next;
    });
  };

  const monthCells = useMemo(() => {
    const firstOfMonth = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    const startOffset = firstOfMonth.getDay(); // 0=Sun..6=Sat
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startOffset);
    return Array.from({ length: 42 }, (_, idx) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + idx);
      const iso = toIsoDate(d);
      return {
        iso,
        date: d,
        inCurrentMonth: d.getMonth() === cursorDate.getMonth(),
        events: eventsByDate.get(iso) || [],
      };
    });
  }, [cursorDate, eventsByDate]);

  const weekDays = useMemo(() => {
    const startOfWeek = new Date(cursorDate);
    startOfWeek.setDate(cursorDate.getDate() - cursorDate.getDay());
    return Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + idx);
      const iso = toIsoDate(d);
      return {
        iso,
        date: d,
        weekdayIndex: d.getDay(),
        events: eventsByDate.get(iso) || [],
      };
    });
  }, [cursorDate, eventsByDate]);

  const headerTitle = useMemo(() => {
    const fmtLocale = isRtl ? 'ar-SA' : 'en-US';
    if (calView === 'MONTH') {
      return cursorDate.toLocaleDateString(fmtLocale, { month: 'long', year: 'numeric' });
    }
    if (calView === 'WEEK' && weekDays.length === 7) {
      const s = weekDays[0].date.toLocaleDateString(fmtLocale, { month: 'short', day: 'numeric' });
      const e = weekDays[6].date.toLocaleDateString(fmtLocale, { month: 'short', day: 'numeric', year: 'numeric' });
      return `${s} – ${e}`;
    }
    return cursorDate.toLocaleDateString(fmtLocale, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }, [calView, cursorDate, isRtl, weekDays]);

  const renderEventRichCard = (ev: CalendarEventRow, compact = false) => {
    const selected = selectedEventId === ev.id;
    const displayTitle = ev.title ? `${ev.title}` : ev.client_name || ev.event_code;
    const timeRange = `${ev.start_time.slice(11, 16)}–${ev.end_time.slice(11, 16)}`;
    return (
      <button
        key={ev.id}
        type="button"
        onClick={() => onSelectEvent(ev.id)}
        className={`w-full rounded-lg border p-1.5 text-start transition ${STATUS_STYLE[ev.status] || STATUS_STYLE.CONFIRMED
          } ${selected ? 'ring-2 ring-[var(--brand-primary,#D4AF37)]' : 'hover:opacity-95'}`}
      >
        <div className="flex items-center justify-between gap-1 text-[10px] font-bold">
          <span className="truncate font-mono">{timeRange} · {ev.event_code}</span>
          {ev.is_locked && <Lock className="h-3 w-3 shrink-0" />}
        </div>
        <div className="truncate text-[11px] font-bold leading-tight">{displayTitle}</div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] opacity-90">
          <User className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{ev.client_name || tr('غير محدد', 'Unassigned')}</span>
        </div>
        {!compact && (
          <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] opacity-85">
            <span className="truncate">{isRtl ? ev.hall_name_ar : ev.hall_name}</span>
            <span>{ev.guest_count} {tr('ضيف', 'g')}</span>
          </div>
        )}
      </button>
    );
  };

  const activeDayIso = toIsoDate(cursorDate);
  const visibleDayHalls = hallFilter === 'ALL' ? halls : halls.filter((h) => h.id === hallFilter);

  return (
    <SpotlightCard className="space-y-4 text-start">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
            <span>{tr('الجدول والتقويم التفاعلي', 'Interactive Hall Schedule & Calendar')}</span>
          </SpotlightHeading>
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => shiftCursor(-1)}
              aria-label="Previous"
              className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCursorDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
              }}
              className="rounded px-2 py-0.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {tr('اليوم', 'Today')}
            </button>
            <button
              type="button"
              onClick={() => shiftCursor(1)}
              aria-label="Next"
              className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <span className="px-2 font-bold text-slate-800 dark:text-slate-100">{headerTitle}</span>
            <select
              aria-label={tr('السنة', 'Year')}
              value={cursorDate.getFullYear()}
              onChange={(e) => {
                const yr = Number(e.target.value);
                setCursorDate((prev) => new Date(yr, prev.getMonth(), Math.min(prev.getDate(), 28)));
              }}
              className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-xs font-bold dark:border-slate-700"
            >
              {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 1 + i).map((yr) => (
                <option key={yr} value={yr} className="bg-white dark:bg-slate-900">
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-[34px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">{tr('كل الحالات', 'All Statuses')}</option>
            {['HOLD_48H', 'CONTRACT_PENDING', 'CONFIRMED', 'COMPLETED', 'CLOSED', 'CANCELLED'].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <div className="flex gap-1 rounded-lg border border-slate-300 p-1 text-xs dark:border-slate-700">
            {(
              [
                { id: 'MONTH', ar: 'شهر', en: 'Month' },
                { id: 'WEEK', ar: 'أسبوع', en: 'Week' },
                { id: 'DAY', ar: 'يوم', en: 'Day' },
                { id: 'AGENDA', ar: 'أجندة', en: 'Agenda' },
              ] as { id: OutlookCalView; ar: string; en: string }[]
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setCalView(v.id)}
                className={`rounded px-2.5 py-1 font-semibold ${calView === v.id ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : ''
                  }`}
              >
                {tr(v.ar, v.en)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hall Filter Pills */}
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={() => setHallFilter('ALL')}
          className={`rounded-full border px-3 py-1 font-semibold ${hallFilter === 'ALL'
            ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-950'
            : 'border-slate-300 dark:border-slate-700'
            }`}
        >
          {tr('كل القاعات', 'All Halls')} ({events.length})
        </button>
        {halls.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => setHallFilter(h.id)}
            className={`rounded-full border px-3 py-1 font-semibold ${hallFilter === h.id
              ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-950'
              : 'border-slate-300 dark:border-slate-700'
              }`}
          >
            {isRtl ? h.name_ar : h.name}
          </button>
        ))}
      </div>

      {/* MONTH VIEW (7-column weekday aligned Outlook grid) */}
      {calView === 'MONTH' && (
        <div className="overflow-x-auto">
          <div className="min-w-[760px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100 text-center text-[11px] font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {WEEKDAY_HEADERS.map((wd) => (
                <div key={wd.en} className="border-e border-slate-200 py-2 last:border-e-0 dark:border-slate-800">
                  {tr(wd.ar, wd.en)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthCells.map((cell) => {
                const isToday = cell.iso === todayIso;
                return (
                  <div
                    key={cell.iso}
                    className={`min-h-[120px] border-b border-e border-slate-200 p-1.5 text-xs dark:border-slate-800 ${!cell.inCurrentMonth ? 'bg-slate-50/70 opacity-60 dark:bg-slate-950/60' : 'bg-white dark:bg-slate-900/40'
                      }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setCursorDate(cell.date);
                          setCalView('DAY');
                        }}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold ${isToday
                          ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                          : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                      >
                        {cell.date.getDate()}
                      </button>
                      {cell.events.length > 0 && (
                        <span className="font-mono text-[10px] text-slate-400">{cell.events.length}</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {cell.events.map((ev) => renderEventRichCard(ev, false))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* WEEK VIEW (Outlook 7-day time grid 08:00 - 23:00 + owner/hall/title/status) */}
      {calView === 'WEEK' && (
        <div className="overflow-x-auto">
          <div className="min-w-[820px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            {/* Day Header Row */}
            <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-100 text-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-center border-e border-slate-200 p-2 font-mono text-[11px] font-bold text-slate-500 dark:border-slate-800">
                <Clock className="h-4 w-4" />
              </div>
              {weekDays.map((wd) => {
                const isToday = wd.iso === todayIso;
                const hdr = WEEKDAY_HEADERS[wd.weekdayIndex];
                return (
                  <button
                    key={wd.iso}
                    type="button"
                    onClick={() => {
                      setCursorDate(wd.date);
                      setCalView('DAY');
                    }}
                    className={`border-e border-slate-200 p-2 text-center last:border-e-0 dark:border-slate-800 ${isToday ? 'bg-[var(--brand-primary,#D4AF37)]/15' : ''
                      }`}
                  >
                    <div className="text-[11px] font-semibold text-slate-500">{tr(hdr.ar, hdr.en)}</div>
                    <div className="font-mono text-sm font-extrabold">{wd.iso.slice(5)}</div>
                    <div className="text-[10px] text-amber-500">
                      {wd.events.length > 0 ? `${wd.events.length} ${tr('فعاليات', 'ev')}` : ''}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Hourly Time Grid */}
            <div className="max-h-[540px] overflow-y-auto">
              {HOURS.map((hr) => (
                <div key={hr} className="grid grid-cols-8 border-b border-slate-200/70 last:border-b-0 dark:border-slate-800/70">
                  <div dir="ltr" className="border-e border-slate-200 p-2 text-center font-mono text-[11px] text-slate-400 dark:border-slate-800">
                    {String(hr).padStart(2, '0')}:00
                  </div>
                  {weekDays.map((wd) => {
                    const slotEvents = wd.events.filter((ev) => {
                      const startH = parseLocalHour(ev.start_time);
                      return Math.floor(startH) === hr;
                    });
                    return (
                      <div
                        key={`${wd.iso}-${hr}`}
                        className={`min-h-[46px] border-e border-slate-200/70 p-1 last:border-e-0 dark:border-slate-800/70 ${wd.iso === todayIso ? 'bg-amber-500/[0.03]' : ''
                          }`}
                      >
                        <div className="space-y-1">{slotEvents.map((ev) => renderEventRichCard(ev, true))}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DAY VIEW (Multi-Hall Time Grid) */}
      {calView === 'DAY' && (
        <div className="overflow-x-auto">
          <div className="min-w-[640px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div
              className="grid border-b border-slate-200 bg-slate-100 text-xs font-bold dark:border-slate-800 dark:bg-slate-900"
              style={{ gridTemplateColumns: `90px repeat(${Math.max(1, visibleDayHalls.length)}, minmax(0, 1fr))` }}
            >
              <div className="border-e border-slate-200 p-2.5 text-center font-mono text-slate-500 dark:border-slate-800">
                {activeDayIso}
              </div>
              {visibleDayHalls.map((h) => (
                <div key={h.id} className="border-e border-slate-200 p-2.5 text-center last:border-e-0 dark:border-slate-800">
                  <div>{isRtl ? h.name_ar : h.name}</div>
                  <div className="font-mono text-[10px] text-slate-400">
                    +{h.cleaning_buffer_minutes}m {tr('تنظيف', 'clean')}
                  </div>
                </div>
              ))}
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {HOURS.map((hr) => (
                <div
                  key={hr}
                  className="grid border-b border-slate-200/70 last:border-b-0 dark:border-slate-800/70"
                  style={{ gridTemplateColumns: `90px repeat(${Math.max(1, visibleDayHalls.length)}, minmax(0, 1fr))` }}
                >
                  <div dir="ltr" className="border-e border-slate-200 p-2 text-center font-mono text-[11px] text-slate-400 dark:border-slate-800">
                    {String(hr).padStart(2, '0')}:00
                  </div>
                  {visibleDayHalls.map((h) => {
                    const dayEvs = (eventsByDate.get(activeDayIso) || []).filter((ev) => {
                      const hids = ev.hall_ids && ev.hall_ids.length > 0 ? ev.hall_ids : [ev.hall_id];
                      return hids.includes(h.id) && Math.floor(parseLocalHour(ev.start_time)) === hr;
                    });
                    return (
                      <div key={`${h.id}-${hr}`} className="min-h-[48px] border-e border-slate-200/70 p-1 last:border-e-0 dark:border-slate-800/70">
                        <div className="space-y-1">{dayEvs.map((ev) => renderEventRichCard(ev, false))}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AGENDA VIEW */}
      {calView === 'AGENDA' && (
        <div className="space-y-2">
          {scopedEvents.length === 0 ? (
            <p className="text-xs text-slate-500">{tr('لا توجد حجوزات مطابقة.', 'No matching events.')}</p>
          ) : (
            scopedEvents.map((ev) => (
              <div
                key={ev.id}
                onClick={() => onSelectEvent(ev.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectEvent(ev.id);
                }}
                className={`flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-start text-xs transition ${selectedEventId === ev.id
                  ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]'
                  : 'border-slate-200 dark:border-slate-800'
                  }`}
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 font-bold">
                    <span className="font-mono text-amber-500">{ev.event_code}</span>
                    <span>{ev.title || ev.client_name}</span>
                    {ev.is_locked && (
                      <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-white">
                        <Lock className="h-2.5 w-2.5" /> {tr('مغلقة', 'CLOSED')}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500">
                    <strong>{ev.client_name}</strong> · {isRtl ? ev.hall_name_ar : ev.hall_name} · {ev.guest_count}{' '}
                    {tr('ضيف', 'guests')} ·{' '}
                    <span className="font-mono">
                      {tr('الأمن:', 'Sec:')} {ev.security_status || 'DRAFT'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                    {ev.start_time.slice(0, 16).replace('T', ' ')} → {ev.end_time.slice(11, 16)}
                  </span>
                  <span className={`rounded border px-2 py-0.5 font-bold ${STATUS_STYLE[ev.status] || STATUS_STYLE.CONFIRMED}`}>
                    {ev.status}
                  </span>
                  {onJumpToSecurity && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToSecurity(ev.id, 'PASSES');
                      }}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold hover:border-amber-500 dark:border-slate-700"
                    >
                      <Shield className="h-3 w-3" /> {tr('الأمن', 'Security')}
                    </button>
                  )}
                  {onOpenInspection && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInspection(ev);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-300"
                    >
                      <ShieldCheck className="h-3 w-3" /> {tr('التأمين', 'Deposit')}
                    </button>
                  )}
                  <Link
                    href={tenantPath(locale, tenantSlug, `/erp/finance/events/${ev.id}/pnl`)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-700"
                  >
                    P&L
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </SpotlightCard>
  );
}
