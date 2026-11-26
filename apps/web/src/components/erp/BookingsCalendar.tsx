'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import type { EventStatus, EventType, HallInfo, ScheduledEvent } from '@/lib/bookings-store';
import { useAuth } from '@/components/providers/auth-provider';

export type CalendarViewMode = 'month' | 'week' | 'agenda';
export type StatusVisibilityGroup = 'confirmed' | 'pending' | 'cancelled';

const STATUS_VISIBILITY_OPTIONS: Array<{
  key: StatusVisibilityGroup;
  labelEn: string;
  labelAr: string;
  descEn: string;
  descAr: string;
  textClass: string;
}> = [
  {
    key: 'confirmed',
    labelEn: 'Confirmed',
    labelAr: 'مؤكد',
    descEn: 'Confirmed & completed events',
    descAr: 'الفعاليات المؤكدة والمكتملة',
    textClass: 'text-emerald-700 dark:text-emerald-400',
  },
  {
    key: 'pending',
    labelEn: 'Pending',
    labelAr: 'قيد الانتظار',
    descEn: '48h holds, contracts & inquiries',
    descAr: 'الحجز المؤقت، العقود، والاستفسارات',
    textClass: 'text-amber-700 dark:text-amber-400',
  },
  {
    key: 'cancelled',
    labelEn: 'Cancelled',
    labelAr: 'ملغي',
    descEn: 'Cancelled reservations',
    descAr: 'الحجوزات الملغاة',
    textClass: 'text-rose-700 dark:text-rose-400',
  },
];

function getStatusVisibilityGroup(status: EventStatus): StatusVisibilityGroup {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'confirmed';
  if (status === 'CANCELLED') return 'cancelled';
  return 'pending';
}

interface BookingsCalendarProps {
  locale: 'ar' | 'en';
  events: ScheduledEvent[];
  halls: HallInfo[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onEventCreated: (event: ScheduledEvent) => void;
  onEventUpdated: (event: ScheduledEvent) => void;
  createModalOpen: boolean;
  onCreateModalChange: (open: boolean) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

const STATUS_META: Record<
  EventStatus,
  {
    labelEn: string;
    labelAr: string;
    textClass: string;
    itemSurfaceClass: string;
  }
> = {
  CONFIRMED: {
    labelEn: 'Confirmed',
    labelAr: 'مؤكد',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    itemSurfaceClass:
      'bg-emerald-50/80 border-emerald-200/90 hover:bg-emerald-100/80 dark:bg-emerald-950/40 dark:border-emerald-800/70 dark:hover:bg-emerald-950/70',
  },
  HOLD_48H: {
    labelEn: '48h Hold',
    labelAr: 'حجز مؤقت 48س',
    textClass: 'text-amber-700 dark:text-amber-400',
    itemSurfaceClass:
      'bg-amber-50/80 border-amber-200/90 hover:bg-amber-100/80 dark:bg-amber-950/35 dark:border-amber-800/70 dark:hover:bg-amber-950/65',
  },
  CONTRACT_PENDING: {
    labelEn: 'Contract Pending',
    labelAr: 'بانتظار العقد',
    textClass: 'text-orange-700 dark:text-orange-400',
    itemSurfaceClass:
      'bg-orange-50/80 border-orange-200/90 hover:bg-orange-100/80 dark:bg-orange-950/35 dark:border-orange-800/70 dark:hover:bg-orange-950/65',
  },
  INQUIRY: {
    labelEn: 'Inquiry',
    labelAr: 'استفسار',
    textClass: 'text-sky-700 dark:text-sky-400',
    itemSurfaceClass:
      'bg-sky-50/80 border-sky-200/90 hover:bg-sky-100/80 dark:bg-sky-950/35 dark:border-sky-800/70 dark:hover:bg-sky-950/65',
  },
  COMPLETED: {
    labelEn: 'Completed',
    labelAr: 'مكتمل',
    textClass: 'text-slate-600 dark:text-slate-400',
    itemSurfaceClass:
      'bg-slate-100/90 border-slate-200 hover:bg-slate-200/70 dark:bg-slate-800/60 dark:border-slate-700 dark:hover:bg-slate-800',
  },
  CANCELLED: {
    labelEn: 'Cancelled',
    labelAr: 'ملغي',
    textClass: 'text-rose-700 dark:text-rose-400',
    itemSurfaceClass:
      'bg-rose-50/70 border-rose-200/80 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:border-rose-900/70 dark:hover:bg-rose-950/55',
  },
};

const EVENT_TYPE_LABELS: Record<EventType, { en: string; ar: string }> = {
  WEDDING: { en: 'Wedding Banquet', ar: 'حفل زفاف' },
  CONFERENCE: { en: 'Conference', ar: 'مؤتمر' },
  GALA_DINNER: { en: 'Gala Dinner', ar: 'حفل عشاء رسمي' },
  CORPORATE_SUMMIT: { en: 'Corporate Summit', ar: 'قمة مؤسسية' },
  GRADUATION: { en: 'Graduation', ar: 'حفل تخرج' },
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (dt: Date) =>
    `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${fmt(start)}–${fmt(end)}`;
}

function formatStartTime(startIso: string): string {
  const dt = new Date(startIso);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function formatMoney(amount: number, currency: string, locale: 'ar' | 'en'): string {
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-YE' : 'en-US').format(amount)} ${currency}`;
}

function getMonthGridDays(anchorDate: Date): Date[] {
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // Start week on Saturday (index 6 in JS getDay()) for MENA venue calendar ergonomics
  const offset = (firstOfMonth.getDay() + 1) % 7;
  const gridStart = new Date(year, month, 1 - offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

function getWeekDays(anchorDate: Date): Date[] {
  const offset = (anchorDate.getDay() + 1) % 7;
  const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function BookingsCalendar({
  locale,
  events,
  halls,
  loading,
  error,
  onRetry,
  onEventCreated,
  onEventUpdated,
  createModalOpen,
  onCreateModalChange,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
}: BookingsCalendarProps) {
  const isRtl = locale === 'ar';
  const intlLocale = isRtl ? 'ar-EG' : 'en-US';
  const { authFetch } = useAuth();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [selectedHallId, setSelectedHallId] = useState<string>('ALL');
  const [visibleStatuses, setVisibleStatuses] = useState<Record<StatusVisibilityGroup, boolean>>({
    confirmed: true,
    pending: true,
    cancelled: true,
  });
  const [statusMenuOpen, setStatusMenuOpen] = useState<boolean>(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const [internalSearchQuery, setInternalSearchQuery] = useState<string>('');
  const searchQuery = controlledSearchQuery ?? internalSearchQuery;
  const setSearchQuery = onSearchQueryChange ?? setInternalSearchQuery;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create Booking Form State
  const [draftDate, setDraftDate] = useState<string>(() => toDateKey(new Date()));
  const [draftHallId, setDraftHallId] = useState<string>(halls[0]?.id || 'hall-diamond');
  const [draftEventType, setDraftEventType] = useState<EventType>('WEDDING');
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [draftClientName, setDraftClientName] = useState<string>('');
  const [draftClientPhone, setDraftClientPhone] = useState<string>('');
  const [draftStartTime, setDraftStartTime] = useState<string>('17:00');
  const [draftEndTime, setDraftEndTime] = useState<string>('22:00');
  const [draftGuestCount, setDraftGuestCount] = useState<number>(250);
  const [draftStatus, setDraftStatus] = useState<EventStatus>('HOLD_48H');
  const [draftNotes, setDraftNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (halls.length > 0 && !halls.some((h) => h.id === draftHallId)) {
      setDraftHallId(halls[0].id);
    }
  }, [halls, draftHallId]);

  useEffect(() => {
    if (!createModalOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCreateModalChange(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [createModalOpen, onCreateModalChange]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStatusMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [statusMenuOpen]);

  const hallAndSearchEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((ev) => {
      if (selectedHallId !== 'ALL' && ev.hallId !== selectedHallId) return false;
      if (q) {
        const haystack = [
          ev.eventCode,
          ev.titleEn,
          ev.titleAr,
          ev.clientNameEn,
          ev.clientNameAr,
          ev.hallNameEn,
          ev.hallNameAr,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [events, selectedHallId, searchQuery]);

  const statusGroupCounts = useMemo(() => {
    const counts: Record<StatusVisibilityGroup, number> = {
      confirmed: 0,
      pending: 0,
      cancelled: 0,
    };
    for (const ev of hallAndSearchEvents) {
      counts[getStatusVisibilityGroup(ev.status)] += 1;
    }
    return counts;
  }, [hallAndSearchEvents]);

  const filteredEvents = useMemo(() => {
    return hallAndSearchEvents
      .filter((ev) => visibleStatuses[getStatusVisibilityGroup(ev.status)])
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [hallAndSearchEvents, visibleStatuses]);

  // Keep an active booking selected in the inspector panel
  const selectedEvent = useMemo(() => {
    if (selectedEventId) {
      const exact = filteredEvents.find((e) => e.id === selectedEventId) || events.find((e) => e.id === selectedEventId);
      if (exact) return exact;
    }
    const nowMs = Date.now();
    return (
      filteredEvents.find((e) => new Date(e.endTime).getTime() >= nowMs && e.status !== 'CANCELLED') ||
      filteredEvents[0] ||
      null
    );
  }, [filteredEvents, events, selectedEventId]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, ScheduledEvent[]>();
    for (const ev of filteredEvents) {
      const key = toDateKey(new Date(ev.startTime));
      const existing = map.get(key) || [];
      existing.push(ev);
      map.set(key, existing);
    }
    return map;
  }, [filteredEvents]);

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const monthDays = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => getWeekDays(anchorDate), [anchorDate]);

  // Saturday -> Friday labels
  const weekdayLabels = useMemo(() => {
    const baseSat = new Date(2026, 0, 3); // Saturday Jan 3, 2026
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(baseSat.getFullYear(), baseSat.getMonth(), baseSat.getDate() + i)));
  }, [intlLocale]);

  const headerPeriodLabel = useMemo(() => {
    if (viewMode === 'week') {
      const first = weekDays[0];
      const last = weekDays[6];
      const fmt = new Intl.DateTimeFormat(intlLocale, { month: 'short', day: 'numeric' });
      return `${fmt.format(first)} – ${fmt.format(last)}, ${last.getFullYear()}`;
    }
    return new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(anchorDate);
  }, [viewMode, weekDays, anchorDate, intlLocale]);

  const stepPeriod = (delta: number) => {
    setAnchorDate((prev) => {
      if (viewMode === 'week') {
        return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + delta * 7);
      }
      return new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
    });
  };

  const jumpToToday = () => {
    const now = new Date();
    setAnchorDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  };

  const openCreateForDate = (date: Date) => {
    setDraftDate(toDateKey(date));
    setFormError(null);
    onCreateModalChange(true);
  };

  const toggleStatusVisibility = (group: StatusVisibilityGroup) => {
    setVisibleStatuses((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  const resetFilters = () => {
    setSelectedHallId('ALL');
    setVisibleStatuses({ confirmed: true, pending: true, cancelled: true });
    setSearchQuery('');
  };

  const handleStatusUpdate = async (eventId: string, nextStatus: EventStatus) => {
    setUpdatingStatus(true);
    setActionError(null);
    try {
      const res = await authFetch('/api/v1/bookings/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: eventId, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.detail || (isRtl ? 'تعذر تحديث حالة الحجز' : 'Failed to update booking status'));
        return;
      }
      if (data?.event) {
        onEventUpdated(data.event);
      }
    } catch {
      setActionError(isRtl ? 'خطأ في الاتصال بالخادم' : 'Network error updating booking');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const startIso = new Date(`${draftDate}T${draftStartTime}:00`).toISOString();
      const endIso = new Date(`${draftDate}T${draftEndTime}:00`).toISOString();

      const res = await authFetch('/api/v1/bookings/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hallId: draftHallId,
          eventType: draftEventType,
          title: draftTitle,
          clientName: draftClientName,
          clientPhone: draftClientPhone,
          startTime: startIso,
          endTime: endIso,
          guestCount: Number(draftGuestCount),
          status: draftStatus,
          notes: draftNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.detail || (isRtl ? 'تعذر حفظ الحجز' : 'Unable to create booking'));
        return;
      }

      if (data?.event) {
        onEventCreated(data.event);
        setSelectedEventId(data.event.id);
        const createdDate = new Date(data.event.startTime);
        setAnchorDate(new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate()));
        setDraftTitle('');
        setDraftClientName('');
        setDraftClientPhone('');
        setDraftNotes('');
        onCreateModalChange(false);
      }
    } catch {
      setFormError(isRtl ? 'تعذر الاتصال بالخادم' : 'Network error creating booking');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedHallObj = useMemo(
    () => halls.find((h) => h.id === selectedEvent?.hallId) || null,
    [halls, selectedEvent]
  );

  const draftHallObj = useMemo(
    () => halls.find((h) => h.id === draftHallId) || halls[0] || null,
    [halls, draftHallId]
  );

  const visibleStatusCount = Object.values(visibleStatuses).filter(Boolean).length;
  const allStatusesVisible = visibleStatusCount === 3;
  const hasActiveFilters = selectedHallId !== 'ALL' || !allStatusesVisible || searchQuery.trim().length > 0;

  return (
    <section
      aria-label={isRtl ? 'تقويم حجوزات الصالات' : 'Venue Bookings Calendar'}
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Calendar Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => stepPeriod(-1)}
              aria-label={isRtl ? 'الفترة السابقة' : 'Previous period'}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={jumpToToday}
              className="h-9 whitespace-nowrap rounded-md px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              {isRtl ? 'اليوم' : 'Today'}
            </button>
            <button
              type="button"
              onClick={() => stepPeriod(1)}
              aria-label={isRtl ? 'الفترة التالية' : 'Next period'}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>

          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {headerPeriodLabel}
          </h2>
        </div>

        {/* View Switcher */}
        <div
          role="tablist"
          aria-label={isRtl ? 'طريقة عرض التقويم' : 'Calendar view mode'}
          className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950"
        >
          {(
            [
              { id: 'month', labelEn: 'Month', labelAr: 'شهري' },
              { id: 'week', labelEn: 'Week', labelAr: 'أسبوعي' },
              { id: 'agenda', labelEn: 'Agenda', labelAr: 'جدول الحجوزات' },
            ] as const
          ).map((tab) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setViewMode(tab.id)}
                className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
                  active
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {isRtl ? tab.labelAr : tab.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        {/* Hall Segmented Filter */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => setSelectedHallId('ALL')}
            className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
              selectedHallId === 'ALL'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {isRtl ? 'كل القاعات' : 'All Halls'}
          </button>
          {halls.map((hall) => {
            const active = selectedHallId === hall.id;
            return (
              <button
                key={hall.id}
                type="button"
                onClick={() => setSelectedHallId(hall.id)}
                className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
                  active
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {isRtl ? hall.nameAr : hall.nameEn}
              </button>
            );
          })}
        </div>

        {/* Status Visibility Filter & Reset */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-initial">
          {!onSearchQueryChange && (
            <div className="relative min-w-[200px] flex-1 sm:w-56 sm:flex-initial">
              <Search
                aria-hidden="true"
                className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${
                  isRtl ? 'right-3' : 'left-3'
                }`}
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isRtl ? 'بحث بالعنوان أو العميل أو القاعة...' : 'Search title, client, or hall...'}
                aria-label={isRtl ? 'بحث في الحجوزات' : 'Search bookings'}
                className={`h-10 w-full rounded-lg border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 ${
                  isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'
                }`}
              />
            </div>
          )}

          {/* Multi-Select Status Visibility Filter Dropdown */}
          <div ref={statusMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setStatusMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={statusMenuOpen}
              aria-label={isRtl ? 'تصفية حالات الفعاليات المعروضة' : 'Toggle visible event statuses'}
              className={`inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
                !allStatusesVisible
                  ? 'border-[var(--brand-primary,#D4AF37)] bg-amber-50/60 text-slate-900 dark:bg-amber-950/30 dark:text-slate-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>{isRtl ? 'الحالات' : 'Status'}</span>
              {!allStatusesVisible && (
                <>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-amber-800 dark:text-[#D4AF37]">
                    {visibleStatusCount}/3
                  </span>
                </>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${
                  statusMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {statusMenuOpen && (
              <div
                role="menu"
                aria-label={isRtl ? 'إظهار أو إخفاء حالات الفعاليات' : 'Show or hide event statuses'}
                className="absolute end-0 z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-2.5 pb-2 pt-1 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'إظهار الحالات' : 'Visible Statuses'}
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setVisibleStatuses({ confirmed: true, pending: true, cancelled: false })}
                      className="font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      {isRtl ? 'النشطة فقط' : 'Active only'}
                    </button>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      /
                    </span>
                    <button
                      type="button"
                      onClick={() => setVisibleStatuses({ confirmed: true, pending: true, cancelled: true })}
                      className="font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      {isRtl ? 'الكل' : 'All'}
                    </button>
                  </div>
                </div>

                <div className="mt-1 space-y-0.5">
                  {STATUS_VISIBILITY_OPTIONS.map((opt) => {
                    const checked = visibleStatuses[opt.key];
                    const count = statusGroupCounts[opt.key];
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        onClick={() => toggleStatusVisibility(opt.key)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:hover:bg-slate-800/70"
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                              checked
                                ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                                : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'
                            }`}
                          >
                            {checked && <Check className="h-3 w-3 stroke-[2.5]" />}
                          </span>
                          <span className="min-w-0">
                            <span className={`block text-xs font-semibold ${opt.textClass}`}>
                              {isRtl ? opt.labelAr : opt.labelEn}
                            </span>
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                              {isRtl ? opt.descAr : opt.descEn}
                            </span>
                          </span>
                        </div>
                        <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
            >
              {isRtl ? 'إعادة ضبط' : 'Reset'}
            </button>
          )}
        </div>
      </div>

      {/* Inline Notice When All Status Groups Are Hidden */}
      {!loading && visibleStatusCount === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <span>
            {isRtl
              ? 'جميع حالات الفعاليات مخفية حالياً. فعّل حالة واحدة على الأقل لعرض الحجوزات.'
              : 'All event statuses are currently hidden. Enable at least one status to display bookings.'}
          </span>
          <button
            type="button"
            onClick={() => setVisibleStatuses({ confirmed: true, pending: true, cancelled: true })}
            className="shrink-0 whitespace-nowrap font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-[#D4AF37]"
          >
            {isRtl ? 'إظهار كل الحالات' : 'Show All Statuses'}
          </button>
        </div>
      )}

      {/* Inline Notice When Active Search Matches Zero Events in Month/Week View */}
      {!loading && visibleStatusCount > 0 && filteredEvents.length === 0 && searchQuery.trim().length > 0 && viewMode !== 'agenda' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <span>
            {isRtl
              ? `لا توجد فعاليات مطابقة لعبارة البحث "${searchQuery.trim()}".`
              : `No scheduled events match "${searchQuery.trim()}".`}
          </span>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="shrink-0 whitespace-nowrap font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-[#D4AF37]"
          >
            {isRtl ? 'مسح البحث' : 'Clear search'}
          </button>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-center justify-between gap-4 border-b border-rose-200 bg-rose-50 px-5 py-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 whitespace-nowrap rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-200"
          >
            {isRtl ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      {/* Main Split Workspace: Calendar Canvas + Selected Event Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_350px]">
        {/* Left/Start Primary Calendar Canvas */}
        <div className="min-w-0 border-b border-slate-200 xl:border-b-0 xl:border-e dark:border-slate-800">
          {loading ? (
            <div className="p-5">
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 35 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/60"
                  />
                ))}
              </div>
            </div>
          ) : filteredEvents.length === 0 && viewMode === 'agenda' ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <CalendarIcon className="h-8 w-8 text-slate-400 dark:text-slate-500" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isRtl ? 'لا توجد حجوزات مطابقة للتصفية الحالية' : 'No scheduled events match your filters'}
              </h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
                {isRtl
                  ? 'جرّب تغيير القاعة أو الحالة، أو أضف حجزاً جديداً مباشرة في التقويم.'
                  : 'Try adjusting the hall or status filter, or schedule a new venue booking directly.'}
              </p>
              <div className="mt-4 flex items-center gap-3">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="min-h-[40px] whitespace-nowrap rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {isRtl ? 'مسح التصفية' : 'Reset Filters'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openCreateForDate(new Date())}
                  className="min-h-[40px] whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90"
                >
                  {isRtl ? 'جدولة حجز جديد' : 'New Booking'}
                </button>
              </div>
            </div>
          ) : viewMode === 'month' ? (
            <div>
              {/* Weekday Header Row */}
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60">
                {weekdayLabels.map((dayLabel, i) => (
                  <div
                    key={i}
                    className="px-2.5 py-2.5 text-center text-xs font-medium text-slate-500 dark:text-slate-400"
                  >
                    {dayLabel}
                  </div>
                ))}
              </div>

              {/* 6-Week Calendar Grid */}
              <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 rtl:divide-x-reverse dark:divide-slate-800">
                {monthDays.map((day) => {
                  const key = toDateKey(day);
                  const inCurrentMonth = day.getMonth() === anchorDate.getMonth();
                  const isToday = key === todayKey;
                  const dayEvents = eventsByDay.get(key) || [];
                  const visibleEvents = dayEvents.slice(0, 3);
                  const hiddenCount = dayEvents.length - visibleEvents.length;

                  return (
                    <div
                      key={key}
                      className={`group flex min-h-[112px] flex-col p-2 transition-colors sm:min-h-[124px] ${
                        inCurrentMonth
                          ? 'bg-white dark:bg-slate-900'
                          : 'bg-slate-50/60 text-slate-400 dark:bg-slate-950/50 dark:text-slate-600'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-1">
                        <span
                          className={`font-mono text-xs tabular-nums ${
                            isToday
                              ? 'font-bold text-amber-700 underline decoration-2 underline-offset-4 dark:text-[#D4AF37]'
                              : inCurrentMonth
                              ? 'font-medium text-slate-700 dark:text-slate-300'
                              : 'text-slate-400 dark:text-slate-600'
                          }`}
                        >
                          {day.getDate()}
                        </span>

                        <button
                          type="button"
                          onClick={() => openCreateForDate(day)}
                          aria-label={isRtl ? `إضافة حجز بتاريخ ${key}` : `Schedule booking on ${key}`}
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex flex-1 flex-col gap-1">
                        {visibleEvents.map((ev) => {
                          const meta = STATUS_META[ev.status];
                          const isSelected = selectedEvent?.id === ev.id;
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => setSelectedEventId(ev.id)}
                              className={`w-full rounded-md border px-2 py-1 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
                                meta.itemSurfaceClass
                              } ${
                                isSelected
                                  ? 'ring-2 ring-[var(--brand-primary,#D4AF37)] ring-offset-1 ring-offset-white dark:ring-offset-slate-900'
                                  : ''
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                                  {isRtl ? ev.titleAr : ev.titleEn}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-600 dark:text-slate-400">
                                <span className="font-mono tabular-nums">{formatStartTime(ev.startTime)}</span>
                                <span aria-hidden="true">·</span>
                                <span className={`truncate font-medium ${meta.textClass}`}>
                                  {isRtl ? meta.labelAr : meta.labelEn}
                                </span>
                              </div>
                            </button>
                          );
                        })}

                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setAnchorDate(day);
                              setViewMode('week');
                            }}
                            className="mt-0.5 px-1 text-start text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                          >
                            {isRtl ? `+${hiddenCount} حجوزات أخرى` : `+${hiddenCount} more`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : viewMode === 'week' ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {weekDays.map((day) => {
                const key = toDateKey(day);
                const isToday = key === todayKey;
                const dayEvents = eventsByDay.get(key) || [];
                const dayTitle = new Intl.DateTimeFormat(intlLocale, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                }).format(day);

                return (
                  <div key={key} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[170px_minmax(0,1fr)]">
                    <div className="flex items-center justify-between sm:flex-col sm:items-start sm:justify-start">
                      <div>
                        <div
                          className={`text-sm font-semibold ${
                            isToday
                              ? 'text-amber-700 dark:text-[#D4AF37]'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {dayTitle}
                        </div>
                        <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {dayEvents.length}{' '}
                          {isRtl ? (dayEvents.length === 1 ? 'حجز' : 'حجوزات') : dayEvents.length === 1 ? 'booking' : 'bookings'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCreateForDate(day)}
                        className="mt-1 inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'إضافة' : 'Add'}</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {dayEvents.length === 0 ? (
                        <div className="py-2 text-xs text-slate-400 dark:text-slate-500">
                          {isRtl ? 'القاعات متاحة بالكامل في هذا اليوم' : 'All halls available on this date'}
                        </div>
                      ) : (
                        dayEvents.map((ev) => {
                          const meta = STATUS_META[ev.status];
                          const isSelected = selectedEvent?.id === ev.id;
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => setSelectedEventId(ev.id)}
                              className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
                                meta.itemSurfaceClass
                              } ${isSelected ? 'ring-2 ring-[var(--brand-primary,#D4AF37)]' : ''}`}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                  <span className="font-mono font-medium tabular-nums text-slate-700 dark:text-slate-200">
                                    {formatTimeRange(ev.startTime, ev.endTime)}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{isRtl ? ev.hallNameAr : ev.hallNameEn}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    +{ev.cleaningBufferMinutes}m {isRtl ? 'تجهيز' : 'buffer'}
                                  </span>
                                </div>
                                <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {isRtl ? ev.titleAr : ev.titleEn}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                  <span>{isRtl ? ev.clientNameAr : ev.clientNameEn}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    {ev.guestCount} {isRtl ? 'ضيف' : 'guests'}
                                  </span>
                                </div>
                              </div>

                              <div className="text-end">
                                <div className={`text-xs font-semibold ${meta.textClass}`}>
                                  {isRtl ? meta.labelAr : meta.labelEn}
                                </div>
                                <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                  {ev.eventCode}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* High-Density Agenda Table View */
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">{isRtl ? 'الفعالية' : 'Event'}</th>
                    <th className="px-4 py-3 text-start font-medium">{isRtl ? 'التاريخ والوقت' : 'Date & Time'}</th>
                    <th className="px-4 py-3 text-start font-medium">{isRtl ? 'القاعة' : 'Hall'}</th>
                    <th className="px-4 py-3 text-end font-medium">{isRtl ? 'الضيوف' : 'Guests'}</th>
                    <th className="px-4 py-3 text-end font-medium">{isRtl ? 'الإجمالي' : 'Total'}</th>
                    <th className="px-4 py-3 text-start font-medium">{isRtl ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredEvents.map((ev) => {
                    const meta = STATUS_META[ev.status];
                    const isSelected = selectedEvent?.id === ev.id;
                    const dateStr = new Intl.DateTimeFormat(intlLocale, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    }).format(new Date(ev.startTime));

                    return (
                      <tr
                        key={ev.id}
                        onClick={() => setSelectedEventId(ev.id)}
                        className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                          isSelected ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {isRtl ? ev.titleAr : ev.titleEn}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono tabular-nums">{ev.eventCode}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{isRtl ? ev.clientNameAr : ev.clientNameEn}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200">{dateStr}</div>
                          <div className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            {formatTimeRange(ev.startTime, ev.endTime)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300">
                          {isRtl ? ev.hallNameAr : ev.hallNameEn}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-end font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {ev.guestCount}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoney(ev.totalAmount, ev.currency, locale)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`font-semibold ${meta.textClass}`}>
                            {isRtl ? meta.labelAr : meta.labelEn}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right/End Event Inspector Panel */}
        <aside
          aria-label={isRtl ? 'تفاصيل الحجز المحدد' : 'Selected booking details'}
          className="flex flex-col justify-between p-5"
        >
          {selectedEvent ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-medium tabular-nums text-slate-700 dark:text-slate-300">
                    {selectedEvent.eventCode}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={`font-semibold ${STATUS_META[selectedEvent.status].textClass}`}>
                    {isRtl
                      ? STATUS_META[selectedEvent.status].labelAr
                      : STATUS_META[selectedEvent.status].labelEn}
                  </span>
                </div>
                <h3 className="mt-1.5 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
                  {isRtl ? selectedEvent.titleAr : selectedEvent.titleEn}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {isRtl
                    ? EVENT_TYPE_LABELS[selectedEvent.eventType]?.ar || selectedEvent.eventType
                    : EVENT_TYPE_LABELS[selectedEvent.eventType]?.en || selectedEvent.eventType}
                </p>
              </div>

              {/* Operational Details List */}
              <dl className="divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'القاعة' : 'Hall'}</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {isRtl ? selectedEvent.hallNameAr : selectedEvent.hallNameEn}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'التاريخ' : 'Date'}</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {new Intl.DateTimeFormat(intlLocale, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    }).format(new Date(selectedEvent.startTime))}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'الوقت والتجهيز' : 'Time & Buffer'}</dt>
                  <dd className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {formatTimeRange(selectedEvent.startTime, selectedEvent.endTime)} (+{selectedEvent.cleaningBufferMinutes}m)
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'الضيوف' : 'Guest Count'}</dt>
                  <dd className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {selectedEvent.guestCount}
                    {selectedHallObj ? ` / ${selectedHallObj.capacityTheater}` : ''}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'العميل' : 'Client'}</dt>
                  <dd className="text-end">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {isRtl ? selectedEvent.clientNameAr : selectedEvent.clientNameEn}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400" dir="ltr">
                      {selectedEvent.clientPhone}
                    </div>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'مسؤول المبيعات' : 'Sales Owner'}</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {isRtl ? selectedEvent.assignedSalesAr : selectedEvent.assignedSalesEn}
                  </dd>
                </div>
              </dl>

              {/* Financial Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'التحصيل المالي' : 'Payment Settlement'}
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {Math.min(100, Math.round((selectedEvent.paidAmount / Math.max(1, selectedEvent.totalAmount)) * 100))}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-[var(--brand-primary,#D4AF37)] transition-all duration-200"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((selectedEvent.paidAmount / Math.max(1, selectedEvent.totalAmount)) * 100)
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums">
                    {isRtl ? 'المدفوع:' : 'Paid:'} {formatMoney(selectedEvent.paidAmount, selectedEvent.currency, locale)}
                  </span>
                  <span className="font-mono tabular-nums">
                    {isRtl ? 'المتبقي:' : 'Due:'}{' '}
                    {formatMoney(
                      Math.max(0, selectedEvent.totalAmount - selectedEvent.paidAmount),
                      selectedEvent.currency,
                      locale
                    )}
                  </span>
                </div>
              </div>

              {/* Notes */}
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isRtl ? 'ملاحظات التشغيل' : 'Operations Notes'}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {isRtl ? selectedEvent.notesAr : selectedEvent.notesEn}
                </p>
              </div>

              {actionError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                  {actionError}
                </div>
              )}

              {/* Quick Status Actions */}
              {selectedEvent.status !== 'COMPLETED' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedEvent.status !== 'CONFIRMED' && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleStatusUpdate(selectedEvent.id, 'CONFIRMED')}
                      className="min-h-[40px] flex-1 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {isRtl ? 'تأكيد الحجز' : 'Confirm Booking'}
                    </button>
                  )}
                  {selectedEvent.status === 'INQUIRY' && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleStatusUpdate(selectedEvent.id, 'HOLD_48H')}
                      className="min-h-[40px] flex-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {isRtl ? 'حجز مؤقت 48س' : 'Place 48h Hold'}
                    </button>
                  )}
                  {selectedEvent.status !== 'CANCELLED' && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleStatusUpdate(selectedEvent.id, 'CANCELLED')}
                      className="min-h-[40px] whitespace-nowrap rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      {isRtl ? 'إلغاء' : 'Cancel'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <Clock className="h-7 w-7 text-slate-400 dark:text-slate-600" />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'اختر فعالية من التقويم لعرض تفاصيلها' : 'Select a scheduled event to view details'}
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Create Booking Modal */}
      {createModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-booking-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCreateModalChange(false);
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 id="new-booking-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {isRtl ? 'جدولة حجز جديد' : 'Schedule New Booking'}
              </h3>
              <button
                type="button"
                onClick={() => onCreateModalChange(false)}
                aria-label={isRtl ? 'إغلاق' : 'Close'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 p-5">
              {formError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'القاعة' : 'Venue Hall'}
                  </span>
                  <select
                    required
                    value={draftHallId}
                    onChange={(e) => setDraftHallId(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {halls.map((h) => (
                      <option key={h.id} value={h.id}>
                        {isRtl ? h.nameAr : h.nameEn}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'نوع الفعالية' : 'Event Type'}
                  </span>
                  <select
                    required
                    value={draftEventType}
                    onChange={(e) => setDraftEventType(e.target.value as EventType)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((typeKey) => (
                      <option key={typeKey} value={typeKey}>
                        {isRtl ? EVENT_TYPE_LABELS[typeKey].ar : EVENT_TYPE_LABELS[typeKey].en}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isRtl ? 'عنوان الفعالية' : 'Event Title'}
                </span>
                <input
                  required
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder={isRtl ? 'مثال: حفل زفاف عائلة المتوكل' : 'e.g. Al-Mutawakel Wedding Banquet'}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'اسم العميل' : 'Client Name'}
                  </span>
                  <input
                    required
                    type="text"
                    value={draftClientName}
                    onChange={(e) => setDraftClientName(e.target.value)}
                    placeholder={isRtl ? 'الاسم الكامل' : 'Full name or organization'}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'رقم الهاتف' : 'Phone Number'}
                  </span>
                  <input
                    type="tel"
                    dir="ltr"
                    value={draftClientPhone}
                    onChange={(e) => setDraftClientPhone(e.target.value)}
                    placeholder="+967770000000"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'التاريخ' : 'Date'}
                  </span>
                  <input
                    required
                    type="date"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'من الساعة' : 'Start Time'}
                  </span>
                  <input
                    required
                    type="time"
                    value={draftStartTime}
                    onChange={(e) => setDraftStartTime(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'إلى الساعة' : 'End Time'}
                  </span>
                  <input
                    required
                    type="time"
                    value={draftEndTime}
                    onChange={(e) => setDraftEndTime(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {isRtl ? 'عدد الضيوف' : 'Guest Count'}
                    </span>
                    {draftHallObj && (
                      <span className="font-mono text-[11px] font-normal tabular-nums text-slate-500">
                        {isRtl ? `حد أقصى ${draftHallObj.capacityTheater}` : `Max ${draftHallObj.capacityTheater}`}
                      </span>
                    )}
                  </span>
                  <input
                    required
                    type="number"
                    min={10}
                    max={draftHallObj?.capacityTheater || 800}
                    value={draftGuestCount}
                    onChange={(e) => setDraftGuestCount(Number(e.target.value))}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isRtl ? 'الحالة الأولية' : 'Initial Status'}
                  </span>
                  <select
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value as EventStatus)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="HOLD_48H">{isRtl ? 'حجز مؤقت 48 ساعة' : '48h Hold'}</option>
                    <option value="INQUIRY">{isRtl ? 'استفسار مبدئي' : 'Inquiry'}</option>
                    <option value="CONTRACT_PENDING">{isRtl ? 'بانتظار العقد' : 'Contract Pending'}</option>
                    <option value="CONFIRMED">{isRtl ? 'مؤكد' : 'Confirmed'}</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isRtl ? 'ملاحظات إضافية' : 'Operational Notes'}
                </span>
                <textarea
                  rows={2}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder={isRtl ? 'تجهيزات المسرح، الضيافة، أو ملاحظات خاصة...' : 'Stage setup, catering menu, or special requests...'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onCreateModalChange(false)}
                  className="min-h-[40px] whitespace-nowrap rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {submitting
                    ? isRtl
                      ? 'جاري الحفظ...'
                      : 'Saving...'
                    : isRtl
                    ? 'حفظ الحجز'
                    : 'Save Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
