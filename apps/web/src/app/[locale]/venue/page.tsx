'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, CheckCircle2, Clock, Layers, Sparkles, Users, XCircle } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuthSession } from '@/components/providers/auth-provider';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, tenantPath } from '@/lib/api';

interface HallDto {
  id: string;
  name: string;
  name_ar: string;
  capacity_banquet: number;
  capacity_theater: number;
  base_price: number;
  cleaning_buffer_minutes: number;
  combinable_with_hall_id?: string | null;
}

interface CateringItemDto {
  id: string;
  name_ar: string;
  name_en: string;
  price_per_guest: number;
}

interface OccupiedSlotDto {
  event_id: string;
  event_code: string;
  hall_id: string;
  event_type: string;
  status: string;
  start_time: string;
  end_time: string;
  guest_count: number;
}

interface AvailabilityQuoteResponse {
  availability?: {
    available: boolean;
    conflicts: { event_id: string; event_code: string; status: string }[];
  };
  quote?: {
    base_price: number;
    effective_multiplier: number;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    security_deposit_amount: number;
    catering_total?: number;
    merged_hall_addon?: number;
    currency: string;
  };
  occupied_slots?: OccupiedSlotDto[];
}

export default function TenantVenueStorefrontPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const router = useRouter();
  const { tenantSlug } = useAuthSession();

  const [tenantName, setTenantName] = useState('Al-Massa Royal Venues');
  const [heroTagline, setHeroTagline] = useState<string | null>(null);
  const [currency, setCurrency] = useState('YER');
  const [halls, setHalls] = useState<HallDto[]>([]);
  const [cateringItems, setCateringItems] = useState<CateringItemDto[]>([]);
  const [occupiedSlots, setOccupiedSlots] = useState<OccupiedSlotDto[]>([]);
  const [selectedHallId, setSelectedHallId] = useState<string>('');
  const [mergePartition, setMergePartition] = useState(false);

  const [bookingForm, setBookingForm] = useState(() => {
    const start = new Date(Date.now() + 14 * 86400000);
    start.setHours(16, 0, 0, 0);
    const end = new Date(start.getTime() + 6 * 3600000);
    return {
      event_type: 'WEDDING',
      start_time: start.toISOString().slice(0, 16),
      end_time: end.toISOString().slice(0, 16),
      guest_count: 350,
      catering_item_id: '',
      client_full_name: '',
      client_phone: '',
      client_email: '',
      client_category: 'INDIVIDUAL_B2C',
      company_name: '',
      tax_id: '',
    };
  });

  const [quoteResult, setQuoteResult] = useState<AvailabilityQuoteResponse | null>(null);
  const [holdCreated, setHoldCreated] = useState<{ event_code: string; event_id: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStorefront = useCallback(async () => {
    try {
      const [tenantData, availData] = await Promise.all([
        apiFetch<{
          name: string;
          currency: string;
          branding?: { heroTaglineAr?: string | null; heroTaglineEn?: string | null };
          halls?: HallDto[];
          catering_items?: CateringItemDto[];
        }>(`/api/v1/public/tenants/${tenantSlug}`, { skipAuth: true }, tenantSlug),
        apiFetch<{ occupied_slots?: OccupiedSlotDto[] }>('/api/v1/public/halls/availability', { skipAuth: true }, tenantSlug),
      ]);
      setTenantName(tenantData.name);
      setCurrency(tenantData.currency);
      setHeroTagline(
        isRtl ? tenantData.branding?.heroTaglineAr || null : tenantData.branding?.heroTaglineEn || null
      );
      if (Array.isArray(tenantData.halls) && tenantData.halls.length > 0) {
        setHalls(tenantData.halls);
        setSelectedHallId((prev) => prev || tenantData.halls![0].id);
      }
      if (Array.isArray(tenantData.catering_items)) {
        setCateringItems(tenantData.catering_items);
      }
      if (Array.isArray(availData.occupied_slots)) {
        setOccupiedSlots(availData.occupied_slots);
      }
    } catch {
      // Keep graceful defaults if backend is offline
    }
  }, [isRtl, tenantSlug]);

  useEffect(() => {
    loadStorefront();
  }, [loadStorefront]);

  const selectedHall = halls.find((h) => h.id === selectedHallId);
  const partnerHall = selectedHall?.combinable_with_hall_id
    ? halls.find((h) => h.id === selectedHall.combinable_with_hall_id)
    : undefined;

  const handleCheckQuote = async () => {
    if (!selectedHallId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({
        hall_id: selectedHallId,
        start_time: new Date(bookingForm.start_time).toISOString(),
        end_time: new Date(bookingForm.end_time).toISOString(),
        merge_combinable_hall: String(mergePartition),
        guest_count: String(bookingForm.guest_count),
      });
      if (bookingForm.catering_item_id) {
        qs.set('catering_item_id', bookingForm.catering_item_id);
      }
      const data = await apiFetch<AvailabilityQuoteResponse>(
        `/api/v1/public/halls/availability?${qs.toString()}`,
        { skipAuth: true },
        tenantSlug
      );
      setQuoteResult(data);
      if (Array.isArray(data.occupied_slots)) {
        setOccupiedSlots(data.occupied_slots);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Availability check failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePlace48hHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHallId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const created = await apiFetch<{ event_code: string; event_id: string }>(
        '/api/v1/bookings/hold',
        {
          method: 'POST',
          skipAuth: true,
          body: {
            hall_id: selectedHallId,
            merge_combinable_hall: mergePartition,
            event_type: bookingForm.event_type,
            start_time: new Date(bookingForm.start_time).toISOString(),
            end_time: new Date(bookingForm.end_time).toISOString(),
            guest_count: Number(bookingForm.guest_count),
            catering_item_id: bookingForm.catering_item_id || null,
            client_full_name: bookingForm.client_full_name,
            client_phone: bookingForm.client_phone,
            client_email: bookingForm.client_email || null,
            client_category: bookingForm.client_category,
            company_name: bookingForm.company_name || null,
            tax_id: bookingForm.tax_id || null,
          },
        },
        tenantSlug
      );
      setHoldCreated(created);
      await loadStorefront();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Booking conflict or validation error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} title={tenantName} />

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
        {/* White-Label Tenant Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-start">
          <div>
            <span dir="ltr" className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs font-bold text-amber-500 dark:text-amber-400">
              <Sparkles className="h-3.5 w-3.5" />
              /{tenantSlug}
            </span>
            <SpotlightHeading as="h1" className="mt-2 text-start text-2xl sm:text-4xl">
              {tenantName} — {isRtl ? 'القاعات والحجز الفوري' : 'Venue Halls & Instant Reservation'}
            </SpotlightHeading>
            {heroTagline && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{heroTagline}</p>}
          </div>
        </div>

        {/* Hall Selection Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {halls.map((hall) => {
            const active = hall.id === selectedHallId;
            return (
              <SpotlightCard
                key={hall.id}
                onClick={() => {
                  setSelectedHallId(hall.id);
                  setMergePartition(false);
                  setQuoteResult(null);
                }}
                className={`cursor-pointer text-start ${
                  active ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{isRtl ? hall.name_ar : hall.name}</h2>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {isRtl ? `مآدب: ${hall.capacity_banquet}` : `Banquet: ${hall.capacity_banquet}`}
                      </span>
                      <span>{isRtl ? `مسرح: ${hall.capacity_theater}` : `Theater: ${hall.capacity_theater}`}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {isRtl ? `تنظيف: ${hall.cleaning_buffer_minutes} د` : `Buffer: ${hall.cleaning_buffer_minutes}m`}
                      </span>
                    </div>
                  </div>
                  <div dir="ltr" className="font-mono text-lg font-extrabold text-[var(--brand-primary,#D4AF37)]">
                    {Number(hall.base_price).toLocaleString()} {currency}
                  </div>
                </div>
              </SpotlightCard>
            );
          })}
        </div>

        {/* Partition Hall Merge Toggle */}
        {partnerHall && (
          <SpotlightCard className="flex flex-wrap items-center justify-between gap-4 border-amber-500/30 bg-amber-500/5 text-start">
            <div className="flex items-center gap-3">
              <Layers className="h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400" />
              <div>
                <div className="text-sm font-bold">
                  {isRtl
                    ? `دمج القاعتين معاً (${selectedHall?.name_ar} + ${partnerHall.name_ar})`
                    : `Merge Partition Halls (${selectedHall?.name} + ${partnerHall.name})`}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  {isRtl
                    ? `سعة مدمجة: ${(selectedHall?.capacity_banquet || 0) + partnerHall.capacity_banquet} ضيف مع خصم 15% على القاعة المدمجة`
                    : `Combined Capacity: ${(selectedHall?.capacity_banquet || 0) + partnerHall.capacity_banquet} Banquet Guests (15% bundle discount)`}
                </div>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={mergePartition}
                onChange={(e) => {
                  setMergePartition(e.target.checked);
                  setQuoteResult(null);
                }}
              />
              <span>{isRtl ? 'تفعيل دمج القاعتين (خصم 15%)' : 'Enable Merge (15% Discount)'}</span>
            </label>
          </SpotlightCard>
        )}

        {/* Dynamic Quote Calculator & 1-Click 48h Hold Reservation Form */}
        <SpotlightCard className="text-start">
          <SpotlightHeading as="h2" className="mb-4 text-start text-xl">
            {isRtl ? 'حاسبة التسعير الفوري وحجز 48 ساعة مبدئي' : 'Dynamic Quote & 48-Hour Tentative Hold'}
          </SpotlightHeading>

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handlePlace48hHold} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'نوع المناسبة' : 'Event Type'}
                </label>
                <select
                  value={bookingForm.event_type}
                  onChange={(e) => setBookingForm({ ...bookingForm, event_type: e.target.value })}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="WEDDING">{isRtl ? 'حفل زفاف' : 'Wedding'}</option>
                  <option value="CONFERENCE">{isRtl ? 'مؤتمر / ندوة' : 'Conference'}</option>
                  <option value="GALA">{isRtl ? 'حفل عشاء رسمي' : 'Gala Dinner'}</option>
                  <option value="GRADUATION">{isRtl ? 'حفل تخرج' : 'Graduation'}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'وقت البداية' : 'Start Time'}
                </label>
                <input
                  type="datetime-local"
                  required
                  value={bookingForm.start_time}
                  onChange={(e) => setBookingForm({ ...bookingForm, start_time: e.target.value })}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'وقت النهاية' : 'End Time'}
                </label>
                <input
                  type="datetime-local"
                  required
                  value={bookingForm.end_time}
                  onChange={(e) => setBookingForm({ ...bookingForm, end_time: e.target.value })}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'عدد الضيوف' : 'Guest Count'}
                </label>
                <input
                  type="number"
                  min={10}
                  required
                  value={bookingForm.guest_count}
                  onChange={(e) => setBookingForm({ ...bookingForm, guest_count: Number(e.target.value) })}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'باقة الضيافة (اختياري)' : 'Catering Package'}
                </label>
                <select
                  value={bookingForm.catering_item_id}
                  onChange={(e) => {
                    setBookingForm({ ...bookingForm, catering_item_id: e.target.value });
                    setQuoteResult(null);
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">{isRtl ? 'بدون ضيافة' : 'Hall Only'}</option>
                  {cateringItems.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {isRtl ? cat.name_ar : cat.name_en} ({Number(cat.price_per_guest).toLocaleString()} / {isRtl ? 'ضيف' : 'guest'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'اسم العميل / الجهة' : 'Client Full Name'}
                </label>
                <input
                  required
                  minLength={2}
                  value={bookingForm.client_full_name}
                  onChange={(e) => setBookingForm({ ...bookingForm, client_full_name: e.target.value })}
                  placeholder={isRtl ? 'أحمد عبدالله' : 'Ahmed Abdullah'}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'رقم الجوال / واتساب' : 'Phone / WhatsApp'}
                </label>
                <input
                  required
                  minLength={7}
                  dir="ltr"
                  value={bookingForm.client_phone}
                  onChange={(e) => setBookingForm({ ...bookingForm, client_phone: e.target.value })}
                  placeholder="+967771234567"
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'البريد الإلكتروني (اختياري)' : 'Email (Optional)'}
                </label>
                <input
                  type="email"
                  dir="ltr"
                  value={bookingForm.client_email}
                  onChange={(e) => setBookingForm({ ...bookingForm, client_email: e.target.value })}
                  placeholder="client@example.com"
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'فئة الحجز' : 'Client Profile'}
                </label>
                <select
                  value={bookingForm.client_category}
                  onChange={(e) => setBookingForm({ ...bookingForm, client_category: e.target.value })}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="INDIVIDUAL_B2C">{isRtl ? 'أفراد (B2C)' : 'Individual (B2C)'}</option>
                  <option value="CORPORATE_B2B">{isRtl ? 'شركات ومؤسسات (B2B)' : 'Corporate (B2B)'}</option>
                </select>
              </div>
            </div>

            {bookingForm.client_category === 'CORPORATE_B2B' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'اسم الشركة / المؤسسة' : 'Company Name'}
                  </label>
                  <input
                    value={bookingForm.company_name}
                    onChange={(e) => setBookingForm({ ...bookingForm, company_name: e.target.value })}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'الرقم الضريبي' : 'Tax ID'}
                  </label>
                  <input
                    dir="ltr"
                    value={bookingForm.tax_id}
                    onChange={(e) => setBookingForm({ ...bookingForm, tax_id: e.target.value })}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleCheckQuote}
                disabled={loading || !selectedHallId}
                className="min-h-[44px] rounded-xl border border-[var(--brand-primary,#D4AF37)] px-5 py-2.5 text-xs font-bold text-[var(--brand-primary,#D4AF37)] disabled:opacity-50"
              >
                {isRtl ? 'فحص التوفر واحتساب السعر' : 'Check Availability & Calculate Quote'}
              </button>

              <button
                type="submit"
                disabled={loading || !selectedHallId}
                className="min-h-[44px] rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 py-2.5 text-xs font-bold text-slate-950 shadow disabled:opacity-50"
              >
                {isRtl ? 'تثبيت حجز مبدئي لمدة 48 ساعة (HOLD_48H)' : 'Place 48-Hour Tentative Hold'}
              </button>
            </div>
          </form>

          {quoteResult?.availability && quoteResult?.quote && (
            <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 font-bold ${
                    quoteResult.availability.available ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {quoteResult.availability.available ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {quoteResult.availability.available
                    ? isRtl
                      ? 'القاعة متاحة في هذا الموعد'
                      : 'Slot Available'
                    : isRtl
                      ? 'يوجد تضارب في الموعد أو هامش التنظيف'
                      : 'Schedule or Partition Buffer Conflict'}
                </span>
                <span dir="ltr" className="font-mono text-sm font-bold text-amber-500 dark:text-amber-400">
                  {isRtl ? 'الإجمالي:' : 'Total:'} {Number(quoteResult.quote.total_amount).toLocaleString()} {currency}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 dark:border-slate-800 sm:grid-cols-5">
                <div>
                  <div className="text-slate-500">{isRtl ? 'السعر الأساسي' : 'Base Hall'}</div>
                  <div className="font-mono font-semibold">{Number(quoteResult.quote.base_price).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-slate-500">{isRtl ? 'معامل الموسم' : 'Multiplier'}</div>
                  <div className="font-mono font-semibold">×{quoteResult.quote.effective_multiplier}</div>
                </div>
                <div>
                  <div className="text-slate-500">{isRtl ? 'دمج القاعة' : 'Partition Merge'}</div>
                  <div className="font-mono font-semibold">
                    {Number(quoteResult.quote.merged_hall_addon || 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">{isRtl ? 'الضيافة' : 'Catering'}</div>
                  <div className="font-mono font-semibold">
                    {Number(quoteResult.quote.catering_total || 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">{isRtl ? 'تأمين مسترد (2100)' : 'Refundable Deposit'}</div>
                  <div className="font-mono font-semibold">
                    {Number(quoteResult.quote.security_deposit_amount).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {holdCreated && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-bold">
                    {isRtl
                      ? `تم إنشاء الحجز المبدئي: ${holdCreated.event_code}`
                      : `48h Hold Created: ${holdCreated.event_code}`}
                  </div>
                  <div>
                    {isRtl
                      ? 'يمكنك الآن تسجيل الدخول لبوابة العميل لتوقيع العقد ورفع إيصال العربون خلال 48 ساعة.'
                      : 'Open Client Portal to sign the contract and upload the 50% deposit receipt within 48h.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push(tenantPath(locale, tenantSlug, '/portal/dashboard'))}
                className="min-h-[40px] rounded-lg bg-emerald-500 px-4 py-2 font-bold text-slate-950"
              >
                {isRtl ? 'الانتقال لبوابة العميل' : 'Open Client Portal'}
              </button>
            </div>
          )}
        </SpotlightCard>

        {/* Live Occupied Calendar Slots */}
        <SpotlightCard className="text-start">
          <SpotlightHeading as="h3" className="mb-3 flex items-center gap-2 text-start text-base">
            <Calendar className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
            <span>{isRtl ? 'المواعيد المحجوزة حالياً في التقويم' : 'Current Calendar Holds & Confirmed Events'}</span>
          </SpotlightHeading>
          {occupiedSlots.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? 'لا توجد حجوزات قادمة مسجلة حالياً.' : 'No upcoming occupied slots currently scheduled.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {occupiedSlots.map((slot) => {
                const slotHall = halls.find((h) => h.id === slot.hall_id);
                return (
                  <div
                    key={slot.event_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div>
                      <span className="font-mono font-bold text-amber-500 dark:text-amber-400">{slot.event_code}</span>
                      {slotHall && (
                        <span className="ms-2 text-slate-600 dark:text-slate-400">
                          ({isRtl ? slotHall.name_ar : slotHall.name})
                        </span>
                      )}
                    </div>
                    <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                      {slot.start_time.slice(0, 16).replace('T', ' ')}
                    </span>
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold dark:bg-slate-800">
                      {slot.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
