'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch, getAccessToken, localizedVenueName, setTenantSlug, tenantPath } from '@/lib/api';
import { useAuthSession } from '@/components/providers/auth-provider';
import { BackButton } from '@/components/ui/BackButton';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { AuthUser } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Locale = 'ar' | 'en';
type DayStatus = 'AVAILABLE' | 'HOLD_48H' | 'UNAVAILABLE';
type SlotCode = 'MORNING_09_15' | 'EVENING_17_23' | 'FULL_DAY';
type PayMethod =
  | 'KURAIMI_BANK'
  | 'JAIB_WALLET'
  | 'JAWALI_WALLET'
  | 'ONECASH_WALLET'
  | 'BANK_TRANSFER'
  | 'PAY_LATER_48H';

interface CalHall {
  id: string;
  name: string;
  name_ar: string;
  capacity_banquet: number;
  capacity_theater: number;
  base_price: number;
  combinable_with_hall_id: string | null;
  cleaning_buffer_minutes: number;
}

interface CatalogFields {
  tax_rate?: number;
  default_security_deposit?: number;
  catering_items?: CateringItem[];
  addon_items?: AddonItem[];
  payment_accounts?: PaymentAccount[];
}

interface CalTenant extends CatalogFields {
  id: string;
  name: string;
  slug: string;
  currency: string;
  branding: { primaryColor?: string; accentColor?: string };
  halls: CalHall[];
}

interface CalDay {
  date: string;
  status: DayStatus;
  dynamic_price: number;
  multiplier: number;
  occupied_events: { public_status: string; start_time: string; end_time: string }[];
  available_slots: SlotCode[];
}

interface CalendarResponse {
  tenants: CalTenant[];
  days: Record<string, CalDay[]>;
}

interface CateringItem {
  id: string;
  name_ar: string;
  name_en: string;
  price_per_guest: number;
}

interface PaymentAccount {
  code: string;
  labelAr: string;
  labelEn: string;
  account: string;
}

type TenantDetail = CatalogFields;

interface HoldResponse {
  event_code: string;
  title?: string | null;
  hold_expires_at: string;
  portal_auth_hint?: string;
  access_token?: string | null;
  user?: AuthUser | null;
  quote: { total_amount: number; security_deposit_amount: number; currency: string };
  invoice: { invoice_number: string };
  contract: { contract_number: string };
  milestones: { id: string; title: string; amount_due: number; due_date: string; status: string; upload_token?: string | null }[];
  payment_accounts: PaymentAccount[];
}

interface AddonItem {
  id: string;
  name: string;
  category: string;
  total_stock: number;
  unit_addon_price: number;
}

interface ReceiptResponse {
  status: string;
  receipt_url: string;
}

export interface StorefrontOffer {
  id: string;
  title_ar: string;
  title_en: string;
  discount_percent?: number | null;
  package_price?: number | null;
}

export interface ThreeMonthBookingEngineProps {
  mode: 'GLOBAL_ROOT' | 'TENANT_STOREFRONT';
  locale: Locale;
  /** Required (and locked) when mode === 'TENANT_STOREFRONT'. */
  tenantSlug?: string;
  selectedHallId?: string;
  appliedOffer?: StorefrontOffer | null;
}

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const SESSIONS: { code: SlotCode; start: string; end: string; ar: string; en: string }[] = [
  { code: 'EVENING_17_23', start: '17:00', end: '23:00', ar: 'حفل مسائي ١٧:٠٠–٢٣:٠٠', en: 'Evening Banquet 17:00–23:00' },
  { code: 'MORNING_09_15', start: '09:00', end: '15:00', ar: 'مؤتمر صباحي ٠٩:٠٠–١٥:٠٠', en: 'Morning Conference 09:00–15:00' },
  { code: 'FULL_DAY', start: '09:00', end: '23:00', ar: 'يوم كامل', en: 'Full Day' },
];

const PAY_OPTIONS: { code: PayMethod; ar: string; en: string }[] = [
  { code: 'KURAIMI_BANK', ar: 'بنك الكريمي', en: 'Kuraimi Bank' },
  { code: 'JAIB_WALLET', ar: 'محفظة جيب', en: 'Jaib Wallet' },
  { code: 'JAWALI_WALLET', ar: 'محفظة جوالي', en: 'Jawali Wallet' },
  { code: 'ONECASH_WALLET', ar: 'ون كاش', en: 'OneCash' },
  { code: 'BANK_TRANSFER', ar: 'تحويل بنكي (IBAN)', en: 'Bank IBAN' },
];

const TXT = {
  title: { ar: 'تقويم التوفر والحجز الموجّه (حتى 5 سنوات)', en: 'Availability & Guided Reservation (Up to 5 Years)' },
  horizonBadge: { ar: 'الحجز المسبق متاح حتى 5 سنوات (60 شهراً)', en: '5-Year (60-Month) Advance Booking Open' },
  jumpYear: { ar: 'السنة', en: 'Year' },
  jumpMonth: { ar: 'الشهر', en: 'Month' },
  allVenues: { ar: 'كل القاعات والمقار', en: 'All Venues' },
  allHalls: { ar: 'كل القاعات', en: 'All Halls' },
  combine: { ar: 'دمج القاعات', en: 'Combine Halls' },
  combineMulti: { ar: 'دمج قاعات إضافية (+85% لكل قاعة مدمجة)', en: 'Combine Additional Halls (+85% per extra hall)' },
  switchHallStep1: { ar: 'تغيير أو اختيار القاعة لهذا التاريخ', en: 'Select / Switch Primary Hall for This Date' },
  prev: { ar: '‹ الأشهر الثلاثة السابقة', en: '‹ Previous 3 Months' },
  next: { ar: 'الأشهر الثلاثة التالية ›', en: 'Next 3 Months ›' },
  today: { ar: 'اليوم', en: 'Today' },
  green: { ar: 'أخضر = متاح', en: 'Green = Available' },
  amber: { ar: 'عنبري = حجز مؤقت 48 ساعة / محدود', en: 'Amber = 48h Hold / Limited' },
  rose: { ar: 'وردي = محجوز / غير متاح', en: 'Rose = Booked / Unavailable' },
  selectedHall: { ar: '✔ القاعة المختارة', en: '✔ Selected Hall' },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  noData: { ar: 'لا توجد قاعات متاحة.', en: 'No venues or halls available.' },
  back: { ar: 'السابق', en: 'Back' },
  continue: { ar: 'التالي', en: 'Continue' },
  guests: { ar: 'عدد الضيوف', en: 'Guest Count' },
  session: { ar: 'الفترة', en: 'Session' },
  venue: { ar: 'المقر', en: 'Venue' },
  hall: { ar: 'القاعة', en: 'Hall' },
  catering: { ar: 'باقة الضيافة (للفرد)', en: 'Catering Package (per guest)' },
  none: { ar: 'بدون ضيافة', en: 'No catering' },
  addons: { ar: 'المعدات والديكور', en: 'Equipment & Decor' },
  hallPrice: { ar: 'سعر القاعة', en: 'Hall price' },
  multiplier: { ar: 'معامل الموسم/العطلة', en: 'Seasonal multiplier' },
  cateringTotal: { ar: 'الضيافة', en: 'Catering' },
  addonsTotal: { ar: 'الإضافات', en: 'Add-ons' },
  mergedAddon: { ar: 'القاعة المدمجة', en: 'Merged hall' },
  subtotal: { ar: 'الإجمالي قبل الضريبة', en: 'Subtotal' },
  tax: { ar: 'الضريبة', en: 'Tax' },
  total: { ar: 'الإجمالي', en: 'Total' },
  deposit: { ar: 'التأمين المسترد', en: 'Refundable security deposit' },
  depositLater: { ar: 'يُحدَّد عند التأكيد', en: 'Confirmed at hold' },
  fullName: { ar: 'الاسم الكامل', en: 'Full Name' },
  phone: { ar: 'الجوال / واتساب', en: 'Phone / WhatsApp' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  clientType: { ar: 'نوع العميل', en: 'Client Type' },
  b2c: { ar: 'فرد', en: 'Individual' },
  b2b: { ar: 'شركة', en: 'Corporate' },
  company: { ar: 'اسم الشركة', en: 'Company Name' },
  taxId: { ar: 'الرقم الضريبي', en: 'Tax ID' },
  portalNote: { ar: 'سيتم إنشاء حسابك في بوابة العميل تلقائياً.', en: 'A client portal account is created for you automatically.' },
  holdOpt: { ar: 'حجز مؤقت لمدة 48 ساعة', en: '48-Hour Tentative Hold' },
  payNowOpt: { ar: 'دفع العربون الآن', en: 'Immediate Deposit Payment' },
  copy: { ar: 'نسخ', en: 'Copy' },
  copied: { ar: 'تم النسخ', en: 'Copied' },
  receipt: { ar: 'إرفاق إيصال الدفع', en: 'Attach payment receipt' },
  receiptNote: { ar: 'سيتم رفع الإيصال تلقائياً فور إنشاء الحجز.', en: 'The receipt is uploaded automatically as soon as the booking is created.' },
  noAddons: { ar: 'لم تنشر هذه القاعة أي إضافات بعد.', en: 'This venue has not published any add-ons yet.' },
  noCatering: { ar: 'لا توجد باقات ضيافة منشورة.', en: 'No catering packages published yet.' },
  transferRef: { ar: 'رقم الحوالة / المرجع', en: 'Transfer reference' },
  holdDesc: { ar: 'نثبّت التاريخ لمدة 48 ساعة دون دفع الآن.', en: 'We keep the date for 48 hours with no payment now.' },
  payNowDesc: { ar: 'ادفع العربون الآن وأرفق الإيصال ليراجعه الحسابات فوراً.', en: 'Pay the deposit now and attach the receipt so Finance can review it immediately.' },
  receiptUploaded: { ar: 'تم رفع الإيصال — الحالة: قيد المراجعة (UNDER_REVIEW)', en: 'Receipt uploaded — status: UNDER_REVIEW' },
  receiptFailed: { ar: 'تم إنشاء الحجز لكن فشل رفع الإيصال؛ يمكنك رفعه من البوابة.', en: 'Booking created, but the receipt upload failed; you can upload it from the portal.' },
  stock: { ar: 'المتوفر', en: 'In stock' },
  refRequired: { ar: 'أدخل رقم الحوالة أو أرفق الإيصال.', en: 'Enter the transfer reference or attach the receipt.' },
  submit: { ar: 'تأكيد الحجز', en: 'Submit Booking' },
  submitting: { ar: 'جارٍ الإرسال…', en: 'Submitting…' },
  success: { ar: 'تم إنشاء الحجز المؤقت بنجاح', en: 'Your booking hold was created' },
  enterPortal: { ar: 'الدخول إلى بوابة العميل', en: 'Enter Client Portal' },
  invoice: { ar: 'الفاتورة', en: 'Invoice' },
  contract: { ar: 'العقد', en: 'Contract' },
  expires: { ar: 'ينتهي الحجز', en: 'Hold expires' },
  step: { ar: 'الخطوة', en: 'Step' },
  stepNames: {
    ar: ['التاريخ والفترة', 'الضيافة والمعدات', 'بيانات العميل', 'الحجز والدفع'],
    en: ['Date & Session', 'Catering & Add-ons', 'Client Details', 'Hold & Payment'],
  },
  capacity: { ar: 'سعة', en: 'Capacity' },
  buffer: { ar: 'تنظيف', en: 'Buffer' },
  min: { ar: 'د', en: 'min' },
  invalid: { ar: 'يرجى استكمال الحقول المطلوبة.', en: 'Please complete the required fields.' },
} as const;

type TxtKey = Exclude<keyof typeof TXT, 'stepNames'>;

const MAX_HORIZON_MONTHS = 60;
const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const addHorizonMonths = (d: Date, n: number) => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), maxDay));
};
const money = (v: number, cur: string) => `${Math.round(v).toLocaleString('en-US')} ${cur}`;

const STATUS_RANK: Record<DayStatus, number> = { AVAILABLE: 0, HOLD_48H: 1, UNAVAILABLE: 2 };

const STATUS_CLASS: Record<DayStatus, string> = {
  AVAILABLE:
    'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 cursor-pointer',
  HOLD_48H: 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 cursor-pointer',
  UNAVAILABLE: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100 cursor-not-allowed opacity-80',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function ThreeMonthBookingEngine({
  mode,
  locale,
  tenantSlug,
  selectedHallId,
  appliedOffer,
}: ThreeMonthBookingEngineProps) {
  const isAr = locale === 'ar';
  const t = useCallback((k: TxtKey) => TXT[k][locale], [locale]);
  const locked = mode === 'TENANT_STOREFRONT';
  const router = useRouter();
  const { user: authUser, loginSession } = useAuthSession();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const minAnchor = useMemo(() => monthStart(new Date()), []);
  const maxHorizonDate = useMemo(() => addHorizonMonths(new Date(), MAX_HORIZON_MONTHS), []);
  const maxAnchor = useMemo(() => monthStart(maxHorizonDate), [maxHorizonDate]);
  const [anchor, setAnchor] = useState<Date>(() => monthStart(new Date()));
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [venueSlug, setVenueSlug] = useState<string>(locked ? (tenantSlug ?? '') : 'ALL');
  const [hallFilter, setHallFilter] = useState<string>(selectedHallId || 'ALL');
  const [merge, setMerge] = useState(false);
  const [extraHallIds, setExtraHallIds] = useState<string[]>([]);

  useEffect(() => {
    if (selectedHallId) setHallFilter(selectedHallId);
  }, [selectedHallId]);

  useEffect(() => {
    if (locked && tenantSlug) setVenueSlug(tenantSlug);
  }, [locked, tenantSlug]);

  const [selected, setSelected] = useState<{ date: string; slug: string; hallId: string } | null>(null);
  const [step, setStep] = useState(1);
  const wizardRef = useRef<HTMLDivElement>(null);

  const clampAnchor = useCallback(
    (d: Date) => {
      const m = monthStart(d);
      if (m.getTime() < minAnchor.getTime()) return minAnchor;
      if (m.getTime() > maxAnchor.getTime()) return maxAnchor;
      return m;
    },
    [minAnchor, maxAnchor]
  );

  // Wizard state
  const [slot, setSlot] = useState<SlotCode>('EVENING_17_23');
  const [guests, setGuests] = useState(250);
  const [eventType, setEventType] = useState('WEDDING');
  const [eventTitle, setEventTitle] = useState('');
  const [cateringId, setCateringId] = useState<string>('');
  const [cateringGuests, setCateringGuests] = useState<number | null>(null);
  const [cateringNotes, setCateringNotes] = useState('');
  const [customCateringTitle, setCustomCateringTitle] = useState('');
  const [customCateringPrice, setCustomCateringPrice] = useState('0');
  const [customCateringNotes, setCustomCateringNotes] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [customAddons, setCustomAddons] = useState<
    { id: string; title: string; quantity: number; unit_price: number; notes: string }[]
  >([]);
  const [draftAddonTitle, setDraftAddonTitle] = useState('');
  const [draftAddonQty, setDraftAddonQty] = useState('1');
  const [draftAddonPrice, setDraftAddonPrice] = useState('0');
  const [draftAddonNotes, setDraftAddonNotes] = useState('');
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [clientAuthMode, setClientAuthMode] = useState<'REGISTER' | 'LOGIN'>('REGISTER');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientConfirmPassword, setClientConfirmPassword] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [inlineAuthBusy, setInlineAuthBusy] = useState(false);
  const [inlineAuthMsg, setInlineAuthMsg] = useState<string | null>(null);
  const [category, setCategory] = useState<'INDIVIDUAL_B2C' | 'CORPORATE_B2B'>('INDIVIDUAL_B2C');
  const [company, setCompany] = useState('');
  const [taxId, setTaxId] = useState('');
  const [payMode, setPayMode] = useState<'HOLD' | 'PAY_NOW'>('HOLD');
  const [payMethod, setPayMethod] = useState<PayMethod>('KURAIMI_BANK');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [transferRef, setTransferRef] = useState('');
  const [receiptState, setReceiptState] = useState<'NONE' | 'UPLOADED' | 'FAILED'>('NONE');
  const [copiedCode, setCopiedCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<HoldResponse | null>(null);

  /* ---------------- data loading ---------------- */

  useEffect(() => {
    if (locked && !tenantSlug) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start_date: fmtDate(anchor), months: '4' });
    if (locked && tenantSlug) params.set('tenant_slug', tenantSlug);
    else if (venueSlug !== 'ALL') params.set('tenant_slug', venueSlug);
    apiFetch<CalendarResponse>(`/public/calendar/three-month?${params.toString()}`, {
      skipAuth: true,
      signal: ctrl.signal,
    })
      .then(setCalendar)
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [anchor, venueSlug, locked, tenantSlug]);

  // Registered venues list (kept from an unfiltered load so pills remain visible).
  const [allVenues, setAllVenues] = useState<CalTenant[]>([]);
  useEffect(() => {
    if (!calendar) return;
    if (venueSlug === 'ALL' || allVenues.length === 0) setAllVenues(calendar.tenants);
  }, [calendar, venueSlug, allVenues.length]);

  const tenants = calendar?.tenants ?? [];
  const visibleTenants = useMemo(
    () => (locked ? tenants : venueSlug === 'ALL' ? tenants : tenants.filter((x) => x.slug === venueSlug)),
    [locked, tenants, venueSlug]
  );
  const visibleHalls = useMemo(
    () =>
      visibleTenants.flatMap((tn) =>
        tn.halls.filter((h) => hallFilter === 'ALL' || h.id === hallFilter).map((h) => ({ tenant: tn, hall: h }))
      ),
    [visibleTenants, hallFilter]
  );
  const hallLookup = useMemo(() => {
    const m = new Map<string, { tenant: CalTenant; hall: CalHall }>();
    tenants.forEach((tn) => tn.halls.forEach((h) => m.set(h.id, { tenant: tn, hall: h })));
    return m;
  }, [tenants]);

  const getPartnerHall = useCallback(
    (hall: CalHall, tenantHalls: CalHall[]): CalHall | undefined => {
      if (hall.combinable_with_hall_id) {
        const direct = tenantHalls.find((h) => h.id === hall.combinable_with_hall_id);
        if (direct) return direct;
      }
      return tenantHalls.find((h) => h.id !== hall.id && h.combinable_with_hall_id === hall.id);
    },
    []
  );

  const dayIndex = useMemo(() => {
    const idx = new Map<string, CalDay>();
    const bestHall = new Map<string, string>();
    const hallDays = calendar?.days ?? {};
    const todayStr = fmtDate(new Date());
    const maxHorizonStr = fmtDate(maxHorizonDate);
    const hallDayLookup = new Map<string, Map<string, CalDay>>();
    visibleHalls.forEach(({ hall }) => {
      const m = new Map<string, CalDay>();
      (hallDays[hall.id] ?? []).forEach((d) => m.set(d.date, d));
      hallDayLookup.set(hall.id, m);
    });

    visibleHalls.forEach(({ tenant: tn, hall }) => {
      const combineWith: CalHall[] = [];
      if (hallFilter === hall.id && extraHallIds.length > 0) {
        extraHallIds.forEach((eid) => {
          if (eid !== hall.id) {
            const eh = tn.halls.find((x) => x.id === eid);
            if (eh) combineWith.push(eh);
          }
        });
      } else if (merge) {
        const partnerH = getPartnerHall(hall, tn.halls);
        if (partnerH) combineWith.push(partnerH);
      }

      (hallDays[hall.id] ?? []).forEach((d) => {
        let effective: CalDay =
          d.date < todayStr || d.date > maxHorizonStr ? { ...d, status: 'UNAVAILABLE', available_slots: [] } : d;

        if (combineWith.length > 0 && effective.status !== 'UNAVAILABLE') {
          let sharedSlots = [...effective.available_slots];
          let statusRank = STATUS_RANK[effective.status];
          let addPrice = 0;
          for (const eh of combineWith) {
            const ehDay = (hallDays[eh.id] ?? []).find((x) => x.date === d.date);
            if (!ehDay || ehDay.status === 'UNAVAILABLE') {
              sharedSlots = [];
              statusRank = STATUS_RANK.UNAVAILABLE;
              break;
            }
            sharedSlots = sharedSlots.filter((s) => ehDay.available_slots.includes(s));
            statusRank = Math.max(statusRank, STATUS_RANK[ehDay.status]);
            addPrice += Math.round(eh.base_price * 0.85 * 100) / 100;
          }
          const combinedStatus: DayStatus =
            sharedSlots.length === 0
              ? 'UNAVAILABLE'
              : statusRank === STATUS_RANK.HOLD_48H
                ? 'HOLD_48H'
                : 'AVAILABLE';
          effective = {
            ...effective,
            status: combinedStatus,
            available_slots: sharedSlots,
            dynamic_price: effective.dynamic_price + addPrice,
          };
        }

        const cur = idx.get(d.date);
        const betterStatus = !cur || STATUS_RANK[effective.status] < STATUS_RANK[cur.status];
        const sameStatus = cur && effective.status === cur.status && effective.status !== 'UNAVAILABLE';
        const moreSlots = sameStatus && effective.available_slots.length > (cur?.available_slots.length ?? 0);
        const sameSlotsCheaper =
          sameStatus &&
          effective.available_slots.length === (cur?.available_slots.length ?? 0) &&
          effective.dynamic_price < (cur?.dynamic_price ?? Infinity);

        if (betterStatus || moreSlots || sameSlotsCheaper) {
          idx.set(d.date, effective);
          bestHall.set(d.date, hall.id);
        }
      });
    });
    return { idx, bestHall };
  }, [calendar, visibleHalls, maxHorizonDate, hallFilter, extraHallIds, merge, getPartnerHall]);

  const selectedCtx = selected ? hallLookup.get(selected.hallId) : undefined;
  const selectedVenueHalls = selectedCtx?.tenant.halls ?? [];
  const rawSelectedDay: CalDay | undefined = selected
    ? (calendar?.days[selected.hallId] ?? []).find((d) => d.date === selected.date)
    : undefined;

  const activeExtraHalls = useMemo(() => {
    if (!selectedCtx) return [] as CalHall[];
    return extraHallIds
      .filter((eid) => eid !== selectedCtx.hall.id)
      .map((eid) => selectedCtx.tenant.halls.find((h) => h.id === eid))
      .filter((h): h is CalHall => Boolean(h));
  }, [selectedCtx, extraHallIds]);

  const partner = selectedCtx ? getPartnerHall(selectedCtx.hall, selectedCtx.tenant.halls) : undefined;
  const canMerge = selectedVenueHalls.length > 1;

  const selectedDay: CalDay | undefined = useMemo(() => {
    if (!selected || !rawSelectedDay) return undefined;
    if (activeExtraHalls.length === 0) return rawSelectedDay;
    let slots = [...rawSelectedDay.available_slots];
    let stRank = STATUS_RANK[rawSelectedDay.status];
    for (const eh of activeExtraHalls) {
      const ehDay = (calendar?.days[eh.id] ?? []).find((d) => d.date === selected.date);
      if (!ehDay || ehDay.status === 'UNAVAILABLE') {
        slots = [];
        stRank = STATUS_RANK.UNAVAILABLE;
        break;
      }
      slots = slots.filter((s) => ehDay.available_slots.includes(s));
      stRank = Math.max(stRank, STATUS_RANK[ehDay.status]);
    }
    return {
      ...rawSelectedDay,
      available_slots: slots,
      status: slots.length === 0 ? 'UNAVAILABLE' : stRank === STATUS_RANK.HOLD_48H ? 'HOLD_48H' : 'AVAILABLE',
    };
  }, [selected, rawSelectedDay, activeExtraHalls, calendar]);

  // Load catering + payment accounts for chosen tenant.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    apiFetch<TenantDetail>(`/public/tenants/${selected.slug}`, { skipAuth: true }, selected.slug)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [selected]);

  /* ---------------- derived pricing ---------------- */

  const currency = selectedCtx?.tenant.currency ?? 'YER';

  // Catalog comes from the calendar payload; the per-tenant endpoint refreshes it when available.
  const cateringItems: CateringItem[] = detail?.catering_items ?? selectedCtx?.tenant.catering_items ?? [];
  const addonItems: AddonItem[] = detail?.addon_items ?? selectedCtx?.tenant.addon_items ?? [];
  const taxRate = detail?.tax_rate ?? selectedCtx?.tenant.tax_rate ?? 0;
  const securityDeposit = detail?.default_security_deposit ?? selectedCtx?.tenant.default_security_deposit ?? 0;
  const paymentAccounts: PaymentAccount[] = detail?.payment_accounts ?? selectedCtx?.tenant.payment_accounts ?? [];

  const effectiveCateringGuests = cateringGuests !== null ? cateringGuests : guests;

  const pricing = useMemo(() => {
    const hallPrice = selectedDay?.dynamic_price ?? 0;
    const cat = cateringItems.find((c) => c.id === cateringId);
    const customCatPrice = cateringId === '__OTHER__' ? Math.max(0, Number(customCateringPrice) || 0) : 0;
    const catering = cat
      ? cat.price_per_guest * effectiveCateringGuests
      : cateringId === '__OTHER__'
        ? customCatPrice * effectiveCateringGuests
        : 0;
    const standardAddons = addonItems.reduce((s, a) => s + a.unit_addon_price * (qty[a.id] ?? 0), 0);
    const freeCustomAddons = customAddons.reduce((s, a) => s + Math.max(0, a.unit_price) * Math.max(1, a.quantity), 0);
    const addons = standardAddons + freeCustomAddons;
    const mergedAddon = activeExtraHalls.reduce((s, eh) => s + Math.round(eh.base_price * 0.85 * 100) / 100, 0);
    const rawSubtotal = hallPrice + catering + addons + mergedAddon;
    const discount =
      appliedOffer?.discount_percent && appliedOffer.discount_percent > 0
        ? Math.round(rawSubtotal * (appliedOffer.discount_percent / 100) * 100) / 100
        : 0;
    const subtotal = Math.max(0, rawSubtotal - discount);
    const tax = subtotal * (taxRate / 100);
    return { hallPrice, catering, addons, mergedAddon, discount, subtotal, tax, total: subtotal + tax };
  }, [
    selectedDay,
    cateringItems,
    addonItems,
    cateringId,
    customCateringPrice,
    effectiveCateringGuests,
    qty,
    customAddons,
    activeExtraHalls,
    taxRate,
    appliedOffer,
  ]);

  /* ---------------- actions ---------------- */

  const handleHallSelectionChange = useCallback(
    (newHallFilter: string) => {
      setHallFilter(newHallFilter);
      if (newHallFilter === 'ALL') {
        setExtraHallIds([]);
        setMerge(false);
        return;
      }
      const nextCtx = hallLookup.get(newHallFilter);
      const nextPartner = nextCtx ? getPartnerHall(nextCtx.hall, nextCtx.tenant.halls) : undefined;
      const nextExtras = merge && nextPartner ? [nextPartner.id] : [];
      setExtraHallIds(nextExtras);
      if (selected && nextCtx) {
        const dEntry = (calendar?.days[newHallFilter] ?? []).find((d) => d.date === selected.date);
        if (dEntry && dEntry.status !== 'UNAVAILABLE') {
          setSelected({ date: selected.date, slug: nextCtx.tenant.slug, hallId: newHallFilter });
          const firstFree = SESSIONS.find((s) => dEntry.available_slots.includes(s.code));
          if (firstFree && !dEntry.available_slots.includes(slot)) {
            setSlot(firstFree.code);
          }
          setFormError(null);
        }
      }
    },
    [hallLookup, getPartnerHall, merge, selected, calendar, slot]
  );

  const toggleGlobalMerge = useCallback(
    (checked: boolean) => {
      setMerge(checked);
      if (!checked) {
        setExtraHallIds([]);
        return;
      }
      const targetHid = selected?.hallId || (hallFilter !== 'ALL' ? hallFilter : undefined);
      const ctx = targetHid ? hallLookup.get(targetHid) : undefined;
      if (ctx) {
        const p = getPartnerHall(ctx.hall, ctx.tenant.halls);
        const fallbackSibling = p || ctx.tenant.halls.find((h) => h.id !== ctx.hall.id);
        setExtraHallIds(fallbackSibling ? [fallbackSibling.id] : []);
      }
    },
    [selected, hallFilter, hallLookup, getPartnerHall]
  );

  const toggleExtraHallId = useCallback(
    (hid: string) => {
      setExtraHallIds((prev) => {
        const exists = prev.includes(hid);
        const next = exists ? prev.filter((x) => x !== hid) : [...prev, hid];
        setMerge(next.length > 0);
        return next;
      });
    },
    []
  );

  const pickDay = (date: string) => {
    const day = dayIndex.idx.get(date);
    const hallId = hallFilter !== 'ALL' && hallLookup.has(hallFilter) ? hallFilter : dayIndex.bestHall.get(date);
    if (!day || !hallId || day.status === 'UNAVAILABLE') return;
    const ctx = hallLookup.get(hallId);
    if (!ctx) return;
    setSelected({ date, slug: ctx.tenant.slug, hallId });
    if (merge && extraHallIds.length === 0) {
      const p = getPartnerHall(ctx.hall, ctx.tenant.halls);
      const fallbackSibling = p || ctx.tenant.halls.find((h) => h.id !== ctx.hall.id);
      if (fallbackSibling) setExtraHallIds([fallbackSibling.id]);
    }
    setStep(1);
    setResult(null);
    setFormError(null);
    setCateringId('');
    setQty({});
    const free = day.available_slots;
    const first = SESSIONS.find((s) => free.includes(s.code));
    if (first) setSlot(first.code);
    setTimeout(() => wizardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const hallName = (h: CalHall) => (isAr ? h.name_ar : h.name);

  const copyAccount = async (code: string, account: string) => {
    try {
      await navigator.clipboard.writeText(account);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  useEffect(() => {
    if (authUser && (authUser.user_type === 'CLIENT_PRIMARY' || authUser.user_type === 'CLIENT_DELEGATE')) {
      setFullName((prev) => prev || authUser.full_name || '');
      setPhone((prev) => prev || authUser.phone || '');
      setEmail((prev) => prev || authUser.email || '');
    }
  }, [authUser]);

  const validateStep = (s: number): boolean => {
    if (s === 1) return guests >= 10 && Boolean(selectedDay?.available_slots.includes(slot) || selectedDay?.status === 'HOLD_48H');
    if (s === 3) {
      if (fullName.trim().length < 2 || phone.trim().length < 7) return false;
      if (category === 'CORPORATE_B2B' && (!company.trim() || !taxId.trim())) return false;
      const isSignedClient = Boolean(authUser && (authUser.user_type === 'CLIENT_PRIMARY' || authUser.user_type === 'CLIENT_DELEGATE'));
      if (!isSignedClient && clientAuthMode === 'REGISTER') {
        if (clientPassword.length < 8 || clientPassword !== clientConfirmPassword) return false;
      }
      if (!isSignedClient && clientAuthMode === 'LOGIN' && !loginPassword && !clientPassword) return false;
    }
    return true;
  };

  const handleInlineClientSignIn = async () => {
    if (!selected || !loginIdentifier.trim() || !loginPassword) return;
    setInlineAuthBusy(true);
    setFormError(null);
    setInlineAuthMsg(null);
    try {
      const loginRes = await apiFetch<{ status: string; access_token?: string; user?: AuthUser }>(
        '/api/v1/auth/login',
        {
          method: 'POST',
          skipAuth: true,
          body: { identifier: loginIdentifier.trim(), password: loginPassword, tenant_slug: selected.slug },
        },
        selected.slug
      );
      if (loginRes.access_token && loginRes.user) {
        loginSession(loginRes.access_token, loginRes.user, selected.slug);
        setFullName(loginRes.user.full_name || '');
        setPhone(loginRes.user.phone || '');
        setEmail(loginRes.user.email || '');
        setClientPassword(loginPassword);
        try {
          const meRes = await apiFetch<{
            profile?: { client_category?: string; company_name?: string | null; tax_id?: string | null } | null;
          }>('/api/v1/portal/me', {}, selected.slug);
          if (meRes.profile?.client_category === 'CORPORATE_B2B') {
            setCategory('CORPORATE_B2B');
            setCompany(meRes.profile.company_name || '');
            setTaxId(meRes.profile.tax_id || '');
          }
        } catch {
          // ignore optional profile fetch error
        }
        setInlineAuthMsg(isAr ? 'تم تسجيل الدخول وتعبئة بياناتك بنجاح ✓' : 'Signed in and details auto-filled ✓');
      } else if (loginRes.status === 'OTP_REQUIRED') {
        setFormError(isAr ? 'يتطلب هذا الحساب رمز تحقق 2FA عبر صفحة الدخول.' : 'This account requires 2FA OTP via Client Portal Login.');
      }
    } catch (e: unknown) {
      setFormError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setInlineAuthBusy(false);
    }
  };

  const goNext = () => {
    if (!validateStep(step)) {
      setFormError(t('invalid'));
      return;
    }
    setFormError(null);
    setStep((s) => Math.min(4, s + 1));
  };

  const submit = async () => {
    if (!selected || !selectedCtx) return;
    if (!validateStep(3)) {
      setStep(3);
      setFormError(t('invalid'));
      return;
    }
    if (payMode === 'PAY_NOW' && !transferRef.trim() && !receiptFile) {
      setFormError(t('refRequired'));
      return;
    }
    const sess = SESSIONS.find((s) => s.code === slot) ?? SESSIONS[0];
    setSubmitting(true);
    setFormError(null);
    try {
      const addons = addonItems
        .filter((a) => (qty[a.id] ?? 0) > 0)
        .map((a) => ({ item_id: a.id, quantity: qty[a.id], unit_price: a.unit_addon_price }));
      const res = await apiFetch<HoldResponse>(
        '/bookings/hold',
        {
          method: 'POST',
          skipAuth: true,
          body: {
            hall_id: selected.hallId,
            hall_ids: [selected.hallId, ...activeExtraHalls.map((h) => h.id)],
            merge_combinable_hall: activeExtraHalls.length > 0 || (merge && Boolean(partner)),
            event_title: eventTitle.trim() || null,
            event_type: eventType.trim() || (sess.code === 'MORNING_09_15' ? 'CONFERENCE' : 'WEDDING'),
            start_time: `${selected.date}T${sess.start}:00`,
            end_time: `${selected.date}T${sess.end}:00`,
            guest_count: guests,
            catering_item_id: cateringId && cateringId !== '__OTHER__' ? cateringId : null,
            catering_guest_count: effectiveCateringGuests,
            catering_notes: cateringNotes.trim() || null,
            custom_catering:
              cateringId === '__OTHER__' && customCateringTitle.trim()
                ? {
                  title: customCateringTitle.trim(),
                  price_per_guest: Math.max(0, Number(customCateringPrice) || 0),
                  notes: customCateringNotes.trim() || null,
                }
                : null,
            custom_addons: customAddons.map((a) => ({
              title: a.title,
              quantity: Math.max(1, a.quantity),
              unit_price: Math.max(0, a.unit_price),
              notes: a.notes || null,
            })),
            offer_id: appliedOffer?.id || null,
            addons,
            payment_mode: payMode === 'HOLD' ? 'HOLD_48H' : 'IMMEDIATE_DEPOSIT',
            selected_payment_method: payMode === 'HOLD' ? 'PAY_LATER_48H' : payMethod,
            transfer_reference: payMode === 'PAY_NOW' ? transferRef.trim() || null : null,
            client_full_name: fullName.trim(),
            client_phone: phone.trim(),
            client_email: email.trim() || null,
            client_password:
              clientAuthMode === 'LOGIN'
                ? (loginPassword || clientPassword || undefined)
                : clientPassword.length >= 8
                  ? clientPassword
                  : undefined,
            client_auth_mode:
              authUser && (authUser.user_type === 'CLIENT_PRIMARY' || authUser.user_type === 'CLIENT_DELEGATE')
                ? 'GUEST_AUTO'
                : clientAuthMode,
            client_category: category,
            company_name: category === 'CORPORATE_B2B' ? company.trim() : null,
            tax_id: category === 'CORPORATE_B2B' ? taxId.trim() : null,
          },
        },
        selected.slug
      );
      if (res.access_token && res.user) {
        loginSession(res.access_token, res.user, selected.slug);
      }
      setResult(res);
      setReceiptState('NONE');
      const firstMilestone = res.milestones[0];
      if (payMode === 'PAY_NOW' && receiptFile && firstMilestone) {
        try {
          const fd = new FormData();
          fd.append('receipt', receiptFile);
          if (firstMilestone.upload_token) fd.append('upload_token', firstMilestone.upload_token);
          fd.append('payment_method', payMethod);
          if (transferRef.trim()) fd.append('transfer_reference', transferRef.trim());
          const up = await apiFetch<ReceiptResponse>(
            `/public/milestones/${firstMilestone.id}/receipt`,
            { method: 'POST', formData: fd, skipAuth: true },
            selected.slug
          );
          setReceiptState(up.status === 'UNDER_REVIEW' ? 'UPLOADED' : 'FAILED');
        } catch {
          setReceiptState('FAILED');
        }
      }
    } catch (e: unknown) {
      setFormError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- render helpers ---------------- */

  const months = [0, 1, 2].map((i) => addMonths(anchor, i));
  const monthLabel = (d: Date) =>
    d.toLocaleDateString(isAr ? 'ar-YE-u-nu-latn' : 'en-US', { month: 'long', year: 'numeric' });
  const weekdays = isAr
    ? ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${active
      ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-900 font-semibold'
      : 'border-slate-300 bg-white text-slate-700 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
    }`;
  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
  const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

  const venueForHalls = locked
    ? tenants.find((x) => x.slug === tenantSlug) || tenants[0]
    : venueSlug === 'ALL'
      ? undefined
      : tenants.find((x) => x.slug === venueSlug);
  const hallChoices = venueForHalls ? venueForHalls.halls : visibleTenants.flatMap((x) => x.halls);

  const renderMonth = (m: Date) => {
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const cells: (number | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= count; d++) cells.push(d);
    return (
      <SpotlightCard key={fmtDate(m)} className="!p-3">
        <SpotlightHeading as="h3" className="mb-2 text-center text-base">
          {monthLabel(m)}
        </SpotlightHeading>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500">
          {weekdays.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />;
            const ds = fmtDate(new Date(m.getFullYear(), m.getMonth(), d));
            const day = dayIndex.idx.get(ds);
            const isSel = selected?.date === ds;
            const cls = day ? STATUS_CLASS[day.status] : 'bg-slate-100 text-slate-400 dark:bg-slate-800';
            return (
              <button
                type="button"
                key={ds}
                disabled={!day || day.status === 'UNAVAILABLE'}
                onClick={() => pickDay(ds)}
                aria-label={ds}
                aria-pressed={isSel}
                className={`flex h-12 flex-col items-center justify-center rounded-md text-xs transition ${cls} ${isSel ? 'ring-2 ring-[var(--brand-primary,#D4AF37)] ring-offset-1' : ''
                  }`}
              >
                <span className="font-semibold">{d}</span>
                {day && day.status !== 'UNAVAILABLE' && (
                  <span className="text-[9px] leading-none opacity-80">
                    {day.dynamic_price >= 1000 ? `${Math.round(day.dynamic_price / 1000)}k` : Math.round(day.dynamic_price)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </SpotlightCard>
    );
  };

  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between text-sm ${strong ? 'font-bold' : ''}`}>
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span>{value}</span>
    </div>
  );

  /* ---------------- render ---------------- */

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} className="w-full space-y-4" aria-label={t('title')}>
      <SpotlightHeading as="h2" className="text-xl">
        {t('title')}
      </SpotlightHeading>

      {/* 1. Filter bar */}
      <SpotlightCard>
        {mode === 'GLOBAL_ROOT' ? (
          <div className="space-y-3">
            <div>
              <span className={labelCls}>{t('venue')}</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={pill(venueSlug === 'ALL')}
                  onClick={() => {
                    setVenueSlug('ALL');
                    handleHallSelectionChange('ALL');
                  }}
                >
                  {t('allVenues')}
                </button>
                {allVenues.map((v) => (
                  <button
                    type="button"
                    key={v.slug}
                    className={pill(venueSlug === v.slug)}
                    onClick={() => {
                      setVenueSlug(v.slug);
                      handleHallSelectionChange('ALL');
                    }}
                  >
                    {localizedVenueName(v.name, locale) || v.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className={labelCls}>{t('hall')}</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={pill(hallFilter === 'ALL')} onClick={() => handleHallSelectionChange('ALL')}>
                  {t('allHalls')}
                </button>
                {hallChoices.map((h) => (
                  <button type="button" key={h.id} className={pill(hallFilter === h.id)} onClick={() => handleHallSelectionChange(h.id)}>
                    {hallName(h)}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={merge} onChange={(e) => toggleGlobalMerge(e.target.checked)} />
              {t('combine')}
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={labelCls}>{t('hall')}</span>
              {hallChoices.length > 1 && (
                <button
                  type="button"
                  className={pill(hallFilter === 'ALL')}
                  onClick={() => handleHallSelectionChange('ALL')}
                >
                  {t('allHalls')} ({hallChoices.length})
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hallChoices.map((h) => {
                const active = hallFilter === h.id;
                return (
                  <button
                    type="button"
                    key={h.id}
                    onClick={() => handleHallSelectionChange(active ? 'ALL' : h.id)}
                    className={`rounded-xl border p-3 text-start transition ${active
                      ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)]/10'
                      : 'border-slate-200 dark:border-slate-700'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{hallName(h)}</span>
                      {active && (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] text-white">
                          {t('selectedHall')}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                      <span className="rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                        {t('capacity')} {h.capacity_banquet}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                        {t('buffer')} {h.cleaning_buffer_minutes} {t('min')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {hallChoices.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={merge} onChange={(e) => toggleGlobalMerge(e.target.checked)} />
                {t('combine')}
              </label>
            )}
          </div>
        )}
      </SpotlightCard>

      {/* 2. Calendar header + 5-year jump + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={anchor.getTime() <= minAnchor.getTime()}
            className={`${pill(false)} disabled:cursor-not-allowed disabled:opacity-40`}
            onClick={() => setAnchor((a) => clampAnchor(addMonths(a, -3)))}
          >
            {t('prev')}
          </button>
          <button type="button" className={pill(false)} onClick={() => setAnchor(minAnchor)}>
            {t('today')}
          </button>
          <button
            type="button"
            disabled={anchor.getTime() >= maxAnchor.getTime()}
            className={`${pill(false)} disabled:cursor-not-allowed disabled:opacity-40`}
            onClick={() => setAnchor((a) => clampAnchor(addMonths(a, 3)))}
          >
            {t('next')}
          </button>
          <div className="flex items-center gap-1.5">
            <label htmlFor="tmbe-jump-year" className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t('jumpYear')}
            </label>
            <select
              id="tmbe-jump-year"
              aria-label={t('jumpYear')}
              value={anchor.getFullYear()}
              onChange={(e) => {
                const yr = Number(e.target.value);
                setAnchor(clampAnchor(new Date(yr, anchor.getMonth(), 1)));
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {Array.from(
                { length: maxAnchor.getFullYear() - minAnchor.getFullYear() + 1 },
                (_, idx) => minAnchor.getFullYear() + idx
              ).map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
            <label htmlFor="tmbe-jump-month" className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t('jumpMonth')}
            </label>
            <select
              id="tmbe-jump-month"
              aria-label={t('jumpMonth')}
              value={anchor.getMonth()}
              onChange={(e) => {
                const mo = Number(e.target.value);
                setAnchor(clampAnchor(new Date(anchor.getFullYear(), mo, 1)));
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {Array.from({ length: 12 }, (_, mo) => {
                const candidate = new Date(anchor.getFullYear(), mo, 1);
                const outOfBounds = candidate.getTime() < minAnchor.getTime() || candidate.getTime() > maxAnchor.getTime();
                return (
                  <option key={mo} value={mo} disabled={outOfBounds}>
                    {candidate.toLocaleDateString(isAr ? 'ar-YE-u-nu-latn' : 'en-US', { month: 'long' })}
                  </option>
                );
              })}
            </select>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            {t('horizonBadge')}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded bg-emerald-400" />
            {t('green')}
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded bg-amber-400" />
            {t('amber')}
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded bg-rose-400" />
            {t('rose')}
          </span>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">{t('loading')}</p>}
      {!loading && !error && visibleHalls.length === 0 && <p className="text-sm text-slate-500">{t('noData')}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {mounted
          ? months.map(renderMonth)
          : [0, 1, 2].map((i) => (
            <SpotlightCard key={i} className="h-64 animate-pulse !p-3">
              <div className="h-full rounded-lg bg-slate-100 dark:bg-slate-800/40" />
            </SpotlightCard>
          ))}
      </div>

      {selected && selectedCtx && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100">
          {isAr
            ? `✔ تم اختيار ${localizedVenueName(selectedCtx.tenant.name, locale)} — ${selectedCtx.hall.name_ar}${activeExtraHalls.length > 0 ? ` + ${activeExtraHalls.map((h) => h.name_ar).join(' + ')}` : ''} بتاريخ ${selected.date}`
            : `✔ ${localizedVenueName(selectedCtx.tenant.name, locale)} — ${selectedCtx.hall.name}${activeExtraHalls.length > 0 ? ` + ${activeExtraHalls.map((h) => h.name).join(' + ')}` : ''} selected for ${selected.date}`}
        </p>
      )}

      {/* 3. Wizard */}
      <div ref={wizardRef}>
        {selected && selectedCtx && selectedDay && (
          <SpotlightCard>
            {result ? (
              <div className="space-y-3">
                <SpotlightHeading as="h3">{t('success')}</SpotlightHeading>
                <div className="grid gap-1 text-sm">
                  {row(t('invoice'), result.invoice.invoice_number)}
                  {row(t('contract'), result.contract.contract_number)}
                  {row(t('total'), money(result.quote.total_amount, result.quote.currency), true)}
                  {row(t('deposit'), money(result.quote.security_deposit_amount, result.quote.currency))}
                  {row(t('expires'), new Date(result.hold_expires_at + 'Z').toLocaleString(isAr ? 'ar-YE-u-nu-latn' : 'en-US'))}
                </div>
                {payMode === 'PAY_NOW' && (receiptState === 'UPLOADED' || transferRef.trim()) ? (
                  <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                    {isAr
                      ? 'تم تسجيل إثبات دفع العربون وهو قيد المراجعة من قسم المالية (UNDER_REVIEW)، ما يحمي الموعد من الإلغاء التلقائي أثناء المراجعة.'
                      : 'Immediate deposit proof is submitted and UNDER_REVIEW with Finance, protecting this slot from 48-hour auto-expiry during verification.'}
                  </p>
                ) : (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    {isAr
                      ? `حجز مؤقت (HOLD_48H): يرجى رفع إيصال دفعة التأكيد قبل ${new Date(result.hold_expires_at + 'Z').toLocaleString('ar-YE-u-nu-latn')} لتجنب تحرير الموعد تلقائياً.`
                      : `48-Hour Provisional Hold: upload your confirmation deposit receipt before ${new Date(result.hold_expires_at + 'Z').toLocaleString('en-US')} to avoid automatic release.`}
                  </p>
                )}
                {result.portal_auth_hint === 'OTP_LOGIN_REQUIRED' && (
                  <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    {isAr
                      ? 'للدخول إلى بوابة العميل وتوقيع العقد، استخدم تسجيل الدخول برمز التحقق (OTP) عبر رقم هاتفك.'
                      : 'To access the Client Portal and sign your contract, use OTP login with your phone number.'}
                  </p>
                )}
                <ul className="space-y-1 text-sm">
                  {result.milestones.map((m) => (
                    <li key={m.title} className="flex justify-between gap-2">
                      <span>{m.title}</span>
                      <span>{money(m.amount_due, result.quote.currency)}</span>
                    </li>
                  ))}
                </ul>
                {receiptState === 'UPLOADED' && (
                  <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                    {t('receiptUploaded')}
                  </p>
                )}
                {receiptState === 'FAILED' && (
                  <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                    {t('receiptFailed')}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      setTenantSlug(selected.slug);
                      localStorage.setItem(
                        'el_pending_booking',
                        JSON.stringify({
                          booking_code: result.event_code,
                          client_phone: phone.trim(),
                          client_name: fullName.trim(),
                          tenant_slug: selected.slug,
                        })
                      );
                    }
                    const hasToken = Boolean(getAccessToken());
                    router.push(
                      hasToken
                        ? tenantPath(locale, selected.slug, '/portal/dashboard')
                        : `${tenantPath(locale, selected.slug, '/portal/login')}?booking=${encodeURIComponent(result.event_code)}`
                    );
                  }}
                  className="inline-block rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-sm font-semibold text-slate-900"
                >
                  {t('enterPortal')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <ol className="flex flex-wrap gap-2 text-xs" aria-label="steps">
                  {TXT.stepNames[locale].map((name, i) => (
                    <li
                      key={name}
                      className={`rounded-full px-3 py-1 ${step === i + 1
                        ? 'bg-[var(--brand-primary,#D4AF37)] font-semibold text-slate-900'
                        : step > i + 1
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                        }`}
                    >
                      {t('step')} {i + 1}: {name}
                    </li>
                  ))}
                </ol>

                {step === 1 && (
                  <div className="space-y-3">
                    <div className="grid gap-1 text-sm">
                      {row(t('venue'), localizedVenueName(selectedCtx.tenant.name, locale))}
                      {row(
                        t('hall'),
                        hallName(selectedCtx.hall) +
                          (activeExtraHalls.length > 0
                            ? ` + ${activeExtraHalls.map((h) => hallName(h)).join(' + ')}`
                            : '')
                      )}
                      {row('📅', selected.date)}
                    </div>
                    {selectedVenueHalls.length > 1 && (
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                        <span className={labelCls}>{t('switchHallStep1')}</span>
                        <div className="flex flex-wrap gap-2">
                          {selectedVenueHalls.map((vh) => {
                            const hDay = (calendar?.days[vh.id] ?? []).find((d) => d.date === selected.date);
                            const isPrimary = selected.hallId === vh.id;
                            const isExtra = activeExtraHalls.some((eh) => eh.id === vh.id);
                            const isAvail = Boolean(hDay && hDay.status !== 'UNAVAILABLE');
                            return (
                              <button
                                type="button"
                                key={vh.id}
                                disabled={!isAvail || isExtra}
                                onClick={() => {
                                  if (!isAvail || isExtra) return;
                                  setSelected({ date: selected.date, slug: selectedCtx.tenant.slug, hallId: vh.id });
                                  setExtraHallIds((prev) => prev.filter((id) => id !== vh.id));
                                  if (hDay) {
                                    const free = hDay.available_slots;
                                    const first = SESSIONS.find((s) => free.includes(s.code));
                                    if (first && !free.includes(slot)) setSlot(first.code);
                                  }
                                }}
                                className={`${pill(isPrimary)} disabled:cursor-not-allowed disabled:opacity-40`}
                              >
                                {hallName(vh)} ({vh.capacity_banquet})
                              </button>
                            );
                          })}
                        </div>
                        <span className={`${labelCls} pt-1`}>{t('combineMulti')}</span>
                        <div className="flex flex-wrap gap-2">
                          {selectedVenueHalls
                            .filter((vh) => vh.id !== selected.hallId)
                            .map((vh) => {
                              const hDay = (calendar?.days[vh.id] ?? []).find((d) => d.date === selected.date);
                              const isAvail = Boolean(hDay && hDay.status !== 'UNAVAILABLE');
                              const isChecked = activeExtraHalls.some((eh) => eh.id === vh.id);
                              const isPartner = partner?.id === vh.id;
                              return (
                                <button
                                  type="button"
                                  key={vh.id}
                                  disabled={!isAvail}
                                  onClick={() => toggleExtraHallId(vh.id)}
                                  className={`${pill(isChecked)} disabled:cursor-not-allowed disabled:opacity-40`}
                                >
                                  {isChecked ? '✔ ' : '+ '}
                                  {hallName(vh)}
                                  {isPartner ? (isAr ? ' · قابلة للدمج' : ' · Combinable') : ''}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                    <div>
                      <span className={labelCls}>{t('session')}</span>
                      <div className="flex flex-wrap gap-2">
                        {SESSIONS.map((s) => {
                          const ok = selectedDay.available_slots.includes(s.code);
                          return (
                            <button
                              type="button"
                              key={s.code}
                              disabled={!ok}
                              onClick={() => setSlot(s.code)}
                              className={`${pill(slot === s.code)} ${ok ? '' : 'cursor-not-allowed opacity-40'}`}
                            >
                              {isAr ? s.ar : s.en}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>
                        {isAr ? 'نوع المناسبة' : 'Event Type'}
                      </label>
                      <SelectOrOther
                        value={eventType}
                        onChange={(v) => setEventType(v || 'WEDDING')}
                        locale={locale}
                        options={[
                          { value: 'WEDDING', labelAr: 'حفل زفاف', labelEn: 'Wedding' },
                          { value: 'CONFERENCE', labelAr: 'مؤتمر / ندوة', labelEn: 'Conference / Summit' },
                          { value: 'GALA', labelAr: 'حفل عشاء رسمي', labelEn: 'Gala Dinner' },
                          { value: 'ENGAGEMENT', labelAr: 'حفل خطوبة', labelEn: 'Engagement' },
                        ]}
                        placeholderAr="اختر نوع المناسبة..."
                        placeholderEn="Select event type..."
                        otherPlaceholderAr="أدخل نوع مناسبة مخصص..."
                        otherPlaceholderEn="Enter custom event type..."
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="tmbe-title">
                        {isAr ? 'عنوان المناسبة (اختياري)' : 'Event Title (optional)'}
                      </label>
                      <input
                        id="tmbe-title"
                        maxLength={255}
                        placeholder={isAr ? 'مثال: حفل زفاف آل ... أو مؤتمر ...' : 'e.g. Royal Wedding Reception or Annual Summit'}
                        value={eventTitle}
                        onChange={(e) => setEventTitle(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="tmbe-guests">
                        {t('guests')}
                      </label>
                      <input
                        id="tmbe-guests"
                        type="number"
                        min={10}
                        value={guests}
                        onChange={(e) => setGuests(Math.max(0, Number(e.target.value) || 0))}
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelCls} htmlFor="tmbe-cat">
                          {t('catering')}
                        </label>
                        <select
                          id="tmbe-cat"
                          className={inputCls}
                          value={cateringId}
                          onChange={(e) => setCateringId(e.target.value)}
                        >
                          <option value="">{t('none')}</option>
                          {cateringItems.map((c) => (
                            <option key={c.id} value={c.id}>
                              {isAr ? c.name_ar : c.name_en} — {money(c.price_per_guest, currency)}
                            </option>
                          ))}
                          <option value="__OTHER__">
                            {isAr ? 'أخرى (ضيافة مخصصة / مجانية)' : 'Other (Custom / Free Catering Entry)'}
                          </option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="tmbe-cat-guests">
                          {isAr ? 'عدد وجبات الضيافة القابل للتعديل' : 'Editable Catering Guest Count'}
                        </label>
                        <input
                          id="tmbe-cat-guests"
                          type="number"
                          min={0}
                          value={effectiveCateringGuests}
                          onChange={(e) => setCateringGuests(Math.max(0, Number(e.target.value) || 0))}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {cateringId === '__OTHER__' && (
                      <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                        <div className="text-xs font-bold text-amber-700 dark:text-amber-300">
                          {isAr ? 'تفاصيل الضيافة المخصصة (اترك السعر 0 للطلب المجاني / حسب التسعير)' : 'Custom Catering Request (0 = Free / Quoted)'}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <input
                            value={customCateringTitle}
                            onChange={(e) => setCustomCateringTitle(e.target.value)}
                            placeholder={isAr ? 'وصف الضيافة (مثال: بوفيه تقليدي خاص)...' : 'Custom catering description...'}
                            className={`${inputCls} sm:col-span-2`}
                          />
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={customCateringPrice}
                            onChange={(e) => setCustomCateringPrice(e.target.value)}
                            placeholder={isAr ? 'السعر/ضيف (0 = مجاني)' : 'Price/guest (0 = Free)'}
                            className={inputCls}
                          />
                        </div>
                        <input
                          value={customCateringNotes}
                          onChange={(e) => setCustomCateringNotes(e.target.value)}
                          placeholder={isAr ? 'ملاحظات الأصناف أو التقديم...' : 'Dietary or service notes...'}
                          className={inputCls}
                        />
                      </div>
                    )}

                    <div>
                      <label className={labelCls} htmlFor="tmbe-cat-notes">
                        {isAr ? 'ملاحظات الضيافة والتجهيزات (اختياري)' : 'Catering & Service Notes (optional)'}
                      </label>
                      <input
                        id="tmbe-cat-notes"
                        value={cateringNotes}
                        onChange={(e) => setCateringNotes(e.target.value)}
                        placeholder={isAr ? 'مثال: وقت التقديم، متطلبات خاصة...' : 'Serving schedule, special instructions...'}
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <span className={labelCls}>{t('addons')}</span>
                      {addonItems.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('noAddons')}</p>
                      ) : (
                        <ul className="space-y-2">
                          {addonItems.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span>
                                {a.name} · {money(a.unit_addon_price, currency)}
                                <span className="text-xs text-slate-500">
                                  {' '}
                                  ({t('stock')}: {a.total_stock})
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-label="-"
                                  className={pill(false)}
                                  onClick={() => setQty((q) => ({ ...q, [a.id]: Math.max(0, (q[a.id] ?? 0) - 1) }))}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={a.total_stock}
                                  value={qty[a.id] ?? 0}
                                  onChange={(e) =>
                                    setQty((q) => ({
                                      ...q,
                                      [a.id]: Math.min(a.total_stock, Math.max(0, Number(e.target.value) || 0)),
                                    }))
                                  }
                                  className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                                />
                                <button
                                  type="button"
                                  aria-label="+"
                                  className={pill(false)}
                                  onClick={() =>
                                    setQty((q) => ({ ...q, [a.id]: Math.min(a.total_stock, (q[a.id] ?? 0) + 1) }))
                                  }
                                >
                                  +
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Free "Other" Custom Add-On Entries */}
                    <div className="space-y-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
                      <div className="text-xs font-bold text-amber-700 dark:text-amber-300">
                        {isAr ? 'إضافة بند مخصص ("أخرى" - مجاني أو بتسعيرة مخصصة)' : 'Free / Custom "Other" Add-Ons'}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-6">
                        <input
                          value={draftAddonTitle}
                          onChange={(e) => setDraftAddonTitle(e.target.value)}
                          placeholder={isAr ? 'اسم البند (مثال: ركن قهوة إضافي)...' : 'Custom item title...'}
                          className={`${inputCls} sm:col-span-2`}
                        />
                        <input
                          type="number"
                          min={1}
                          value={draftAddonQty}
                          onChange={(e) => setDraftAddonQty(e.target.value)}
                          placeholder={isAr ? 'الكمية' : 'Qty'}
                          className={inputCls}
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={draftAddonPrice}
                          onChange={(e) => setDraftAddonPrice(e.target.value)}
                          placeholder={isAr ? 'السعر (0=مجاني)' : 'Price (0=Free)'}
                          className={inputCls}
                        />
                        <input
                          value={draftAddonNotes}
                          onChange={(e) => setDraftAddonNotes(e.target.value)}
                          placeholder={isAr ? 'ملاحظات...' : 'Notes...'}
                          className={inputCls}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!draftAddonTitle.trim()) return;
                            setCustomAddons((prev) => [
                              ...prev,
                              {
                                id: `${Date.now()}-${prev.length}`,
                                title: draftAddonTitle.trim(),
                                quantity: Math.max(1, Number(draftAddonQty) || 1),
                                unit_price: Math.max(0, Number(draftAddonPrice) || 0),
                                notes: draftAddonNotes.trim(),
                              },
                            ]);
                            setDraftAddonTitle('');
                            setDraftAddonQty('1');
                            setDraftAddonPrice('0');
                            setDraftAddonNotes('');
                          }}
                          className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 py-2 text-xs font-bold text-slate-950"
                        >
                          {isAr ? '+ إضافة بند' : '+ Add Custom'}
                        </button>
                      </div>
                      {customAddons.length > 0 && (
                        <ul className="space-y-1.5 pt-1">
                          {customAddons.map((ca) => (
                            <li
                              key={ca.id}
                              className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-1.5 text-xs dark:bg-slate-900/70"
                            >
                              <span>
                                <strong>{ca.title}</strong> × {ca.quantity} ·{' '}
                                {ca.unit_price === 0 ? (isAr ? 'مجاني / حسب الاتفاق' : 'Free / Quoted') : money(ca.unit_price, currency)}
                                {ca.notes ? ` — ${ca.notes}` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => setCustomAddons((prev) => prev.filter((x) => x.id !== ca.id))}
                                className="text-rose-500 underline"
                              >
                                {isAr ? 'حذف' : 'Remove'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="space-y-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      {row(t('hallPrice'), money(pricing.hallPrice, currency))}
                      {row(t('multiplier'), `×${selectedDay.multiplier.toFixed(2)}`)}
                      {pricing.mergedAddon > 0 && row(t('mergedAddon'), money(pricing.mergedAddon, currency))}
                      {row(t('cateringTotal'), money(pricing.catering, currency))}
                      {row(t('addonsTotal'), money(pricing.addons, currency))}
                      {pricing.discount > 0 &&
                        row(
                          `${isAr ? appliedOffer?.title_ar : appliedOffer?.title_en} (-${appliedOffer?.discount_percent}%)`,
                          `-${money(pricing.discount, currency)}`
                        )}
                      {row(t('subtotal'), money(pricing.subtotal, currency))}
                      {row(`${t('tax')} (${taxRate}%)`, money(pricing.tax, currency))}
                      {row(t('total'), money(pricing.total, currency), true)}
                      {row(t('deposit'), money(securityDeposit, currency))}
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-3">
                    {authUser && (authUser.user_type === 'CLIENT_PRIMARY' || authUser.user_type === 'CLIENT_DELEGATE') ? (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                        {isAr
                          ? `مسجل الدخول كـ ${authUser.full_name} (${authUser.phone})`
                          : `Signed in as ${authUser.full_name} (${authUser.phone})`}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={pill(clientAuthMode === 'REGISTER')}
                            onClick={() => {
                              setClientAuthMode('REGISTER');
                              setFormError(null);
                            }}
                          >
                            {isAr ? 'حساب عميل جديد' : 'New Client Account'}
                          </button>
                          <button
                            type="button"
                            className={pill(clientAuthMode === 'LOGIN')}
                            onClick={() => {
                              setClientAuthMode('LOGIN');
                              setFormError(null);
                            }}
                          >
                            {isAr ? 'عميل مسجل — تسجيل الدخول' : 'Returning Client Sign In'}
                          </button>
                        </div>

                        {clientAuthMode === 'LOGIN' && (
                          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <label className={labelCls} htmlFor="tmbe-login-id">
                                  {isAr ? 'الجوال أو البريد الإلكتروني' : 'Phone or Email'}
                                </label>
                                <input
                                  id="tmbe-login-id"
                                  dir="ltr"
                                  className={inputCls}
                                  value={loginIdentifier}
                                  onChange={(e) => setLoginIdentifier(e.target.value)}
                                />
                              </div>
                              <div>
                                <label className={labelCls} htmlFor="tmbe-login-pw">
                                  {isAr ? 'كلمة المرور' : 'Password'}
                                </label>
                                <input
                                  id="tmbe-login-pw"
                                  type="password"
                                  className={inputCls}
                                  value={loginPassword}
                                  onChange={(e) => setLoginPassword(e.target.value)}
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={inlineAuthBusy || !loginIdentifier.trim() || !loginPassword}
                              onClick={handleInlineClientSignIn}
                              className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                            >
                              {inlineAuthBusy
                                ? isAr
                                  ? 'جارٍ التحقق...'
                                  : 'Signing in...'
                                : isAr
                                  ? 'دخول وتعبئة البيانات'
                                  : 'Sign In & Auto-Fill'}
                            </button>
                            {inlineAuthMsg && <p className="text-xs font-semibold text-emerald-600">{inlineAuthMsg}</p>}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label className={labelCls} htmlFor="tmbe-name">
                        {t('fullName')}
                      </label>
                      <input id="tmbe-name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelCls} htmlFor="tmbe-phone">
                          {t('phone')}
                        </label>
                        <input
                          id="tmbe-phone"
                          inputMode="tel"
                          dir="ltr"
                          className={inputCls}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="tmbe-email">
                          {t('email')}
                        </label>
                        <input
                          id="tmbe-email"
                          type="email"
                          dir="ltr"
                          className={inputCls}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    {!(authUser && (authUser.user_type === 'CLIENT_PRIMARY' || authUser.user_type === 'CLIENT_DELEGATE')) &&
                      clientAuthMode === 'REGISTER' && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={labelCls} htmlFor="tmbe-cpw">
                              {isAr ? 'كلمة مرور البوابة (8+ أحرف)' : 'Portal Password (min 8 chars)'}
                            </label>
                            <input
                              id="tmbe-cpw"
                              type="password"
                              minLength={8}
                              className={inputCls}
                              value={clientPassword}
                              onChange={(e) => setClientPassword(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className={labelCls} htmlFor="tmbe-cpw2">
                              {isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                            </label>
                            <input
                              id="tmbe-cpw2"
                              type="password"
                              minLength={8}
                              className={inputCls}
                              value={clientConfirmPassword}
                              onChange={(e) => setClientConfirmPassword(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    <div>
                      <span className={labelCls}>{t('clientType')}</span>
                      <div className="flex gap-2">
                        <button type="button" className={pill(category === 'INDIVIDUAL_B2C')} onClick={() => setCategory('INDIVIDUAL_B2C')}>
                          {t('b2c')}
                        </button>
                        <button type="button" className={pill(category === 'CORPORATE_B2B')} onClick={() => setCategory('CORPORATE_B2B')}>
                          {t('b2b')}
                        </button>
                      </div>
                    </div>
                    {category === 'CORPORATE_B2B' && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className={labelCls} htmlFor="tmbe-company">
                            {t('company')}
                          </label>
                          <input id="tmbe-company" className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
                        </div>
                        <div>
                          <label className={labelCls} htmlFor="tmbe-tax">
                            {t('taxId')}
                          </label>
                          <input id="tmbe-tax" className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-slate-500">{t('portalNote')}</p>
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setPayMode('HOLD')}
                        className={`rounded-xl border p-3 text-start text-sm ${payMode === 'HOLD'
                          ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)]/10'
                          : 'border-slate-200 dark:border-slate-700'
                          }`}
                      >
                        <span className="block font-semibold">{t('holdOpt')}</span>
                        <span className="text-xs text-slate-500">{t('holdDesc')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayMode('PAY_NOW')}
                        className={`rounded-xl border p-3 text-start text-sm ${payMode === 'PAY_NOW'
                          ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)]/10'
                          : 'border-slate-200 dark:border-slate-700'
                          }`}
                      >
                        <span className="block font-semibold">{t('payNowOpt')}</span>
                        <span className="text-xs text-slate-500">{t('payNowDesc')}</span>
                      </button>
                    </div>
                    {payMode === 'PAY_NOW' && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {PAY_OPTIONS.map((p) => (
                            <button type="button" key={p.code} className={pill(payMethod === p.code)} onClick={() => setPayMethod(p.code)}>
                              {isAr ? p.ar : p.en}
                            </button>
                          ))}
                        </div>
                        {(() => {
                          const acct = paymentAccounts.find((a) => a.code === payMethod);
                          if (!acct) return null;
                          return (
                            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                              <span dir="ltr" className="font-mono">
                                {isAr ? acct.labelAr : acct.labelEn}: {acct.account}
                              </span>
                              <button type="button" className={pill(false)} onClick={() => copyAccount(acct.code, acct.account)}>
                                {copiedCode === acct.code ? t('copied') : t('copy')}
                              </button>
                            </div>
                          );
                        })()}
                        <div>
                          <label className={labelCls} htmlFor="tmbe-ref">
                            {t('transferRef')}
                          </label>
                          <input
                            id="tmbe-ref"
                            dir="ltr"
                            maxLength={80}
                            className={inputCls}
                            value={transferRef}
                            onChange={(e) => setTransferRef(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className={labelCls} htmlFor="tmbe-receipt">
                            {t('receipt')}
                          </label>
                          <input
                            id="tmbe-receipt"
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                            className="text-sm"
                          />
                          {receiptFile && <p className="mt-1 text-xs text-slate-500">{receiptFile.name}</p>}
                          <p className="mt-1 text-xs text-slate-500">{t('receiptNote')}</p>
                        </div>
                      </div>
                    )}
                    <div className="space-y-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      {row(t('total'), money(pricing.total, currency), true)}
                    </div>
                  </div>
                )}

                {formError && <p role="alert" className="text-sm text-rose-600">{formError}</p>}

                <div className="flex justify-between gap-2">
                  {step > 1 ? (
                    <BackButton
                      locale={locale}
                      labelAr={t('back')}
                      labelEn={t('back')}
                      onClick={() => setStep((s) => Math.max(1, s - 1))}
                    />
                  ) : (
                    <span />
                  )}
                  {step < 4 ? (
                    <button type="button" className={pill(true)} onClick={goNext}>
                      {t('continue')}
                    </button>
                  ) : (
                    <button type="button" className={pill(true)} disabled={submitting} onClick={submit}>
                      {submitting ? t('submitting') : t('submit')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </SpotlightCard>
        )}
      </div>
    </section>
  );
}
