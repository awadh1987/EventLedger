'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CalendarClock, CheckCircle2, Users, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { LookupSelect } from '@/components/ui/LookupSelect';
import type { HallInfo } from '@/lib/types';

export default function VenueStorefrontPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const router = useRouter();
  const { user } = useAuth();

  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [selectedHall, setSelectedHall] = useState('');
  const [eventType, setEventType] = useState('WEDDING');
  const [startTime, setStartTime] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16));
  const [endTime, setEndTime] = useState(() => new Date(Date.now() + 7 * 86400000 + 6 * 3600000).toISOString().slice(0, 16));
  const [guestCount, setGuestCount] = useState(300);
  const [checkResult, setCheckResult] = useState<{
    availability: { available: boolean; conflicts: { event_code: string; status: string }[] };
    quote: { total_amount: number; subtotal: number; tax_amount: number; effective_multiplier: number; currency: string };
  } | null>(null);
  const [holdMessage, setHoldMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HallInfo[]>('/api/v1/public/halls', { skipAuth: true })
      .then((list) => {
        setHalls(list);
        if (list[0]) setSelectedHall(list[0].id);
      })
      .catch(() => undefined);
  }, []);

  const checkAvailability = async () => {
    if (!selectedHall) return;
    setError(null);
    try {
      const qs = new URLSearchParams({
        hall_id: selectedHall,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
      });
      const res = await apiFetch<typeof checkResult>(`/api/v1/public/halls/availability?${qs.toString()}`, {
        skipAuth: true,
      });
      setCheckResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Availability check failed');
    }
  };

  const createHold = async () => {
    if (!user) {
      router.push(`/${locale}/login`);
      return;
    }
    setError(null);
    try {
      const res = await apiFetch<{ event_code: string; hold_expires_at: string }>('/api/v1/bookings/hold', {
        method: 'POST',
        body: {
          hall_id: selectedHall,
          event_type: eventType,
          start_time: new Date(startTime).toISOString(),
          end_time: new Date(endTime).toISOString(),
          guest_count: guestCount,
        },
      });
      setHoldMessage(
        isRtl
          ? `تم حجز القاعة مبدئياً لمدة 48 ساعة (${res.event_code})`
          : `48h Hold created (${res.event_code})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create 48h hold');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <SpotlightHeading as="h1" className="text-2xl sm:text-3xl">
          {isRtl ? 'القاعات المتاحة والتحقق الفوري من التوفر' : 'Venue Halls & Instant Availability'}
        </SpotlightHeading>

        <div className="grid gap-6 md:grid-cols-2">
          {halls.map((h) => (
            <SpotlightCard
              key={h.id}
              onClick={() => setSelectedHall(h.id)}
              className={`cursor-pointer space-y-2 ${selectedHall === h.id ? 'ring-2 ring-[var(--brand-primary,#D4AF37)]' : ''}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{isRtl ? h.name_ar : h.name}</h3>
                <span className="font-mono text-sm font-bold text-[var(--brand-primary,#D4AF37)]">
                  {h.base_price.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {isRtl ? `مآدب: ${h.capacity_banquet}` : `Banquet: ${h.capacity_banquet}`}
                </span>
                <span>{isRtl ? `مسرح: ${h.capacity_theater}` : `Theater: ${h.capacity_theater}`}</span>
                <span>{isRtl ? `تنظيف: ${h.cleaning_buffer_minutes} د` : `Buffer: ${h.cleaning_buffer_minutes}m`}</span>
              </div>
            </SpotlightCard>
          ))}
        </div>

        <SpotlightCard className="space-y-4">
          <SpotlightHeading as="h2" className="text-lg">
            {isRtl ? 'حاسبة التسعير الديناميكي وحجز 48 ساعة' : 'Dynamic Quote & 48h Hold'}
          </SpotlightHeading>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'نوع الفعالية' : 'Event Type'}</label>
              <LookupSelect
                category="EVENT_TYPE"
                locale={locale}
                value={eventType}
                onChange={setEventType}
                fallbackOptions={[
                  { code: 'WEDDING', label_ar: 'حفل زفاف', label_en: 'Wedding' },
                  { code: 'CONFERENCE', label_ar: 'مؤتمر', label_en: 'Conference' },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'وقت البدء' : 'Start Time'}</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'وقت الانتهاء' : 'End Time'}</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'عدد الضيوف' : 'Guests'}</label>
              <input
                type="number"
                value={guestCount}
                onChange={(e) => setGuestCount(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={checkAvailability}
              className="min-h-[44px] rounded-lg border border-[var(--brand-primary,#D4AF37)] px-5 py-2 text-sm font-bold text-[var(--brand-primary,#D4AF37)]"
            >
              <CalendarClock className="me-1.5 inline h-4 w-4" />
              {isRtl ? 'فحص التوفر والتسعير' : 'Check Availability & Quote'}
            </button>
            {checkResult?.availability.available && (
              <button
                type="button"
                onClick={createHold}
                className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 py-2 text-sm font-bold text-slate-950"
              >
                {isRtl ? 'تثبيت حجز مبدئي (48 ساعة)' : 'Place 48h Tentative Hold'}
              </button>
            )}
          </div>

          {checkResult && (
            <div className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
              {checkResult.availability.available ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-emerald-500">
                  <span className="flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    {isRtl ? 'القاعة متاحة في هذا الموعد' : 'Hall is available'}
                  </span>
                  <span className="font-mono font-bold">
                    {checkResult.quote.total_amount.toLocaleString()} {checkResult.quote.currency} (×
                    {checkResult.quote.effective_multiplier})
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 font-semibold text-red-500">
                  <XCircle className="h-4 w-4" />
                  {isRtl ? 'يوجد تعارض مع حجز أو فترة تنظيف/دمج قاعات' : 'Conflict with existing booking / partition buffer'}
                </div>
              )}
            </div>
          )}

          {holdMessage && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-500">{holdMessage}</p>}
          {error && <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-500">{error}</p>}
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
