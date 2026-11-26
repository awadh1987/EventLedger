'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch, getAccessToken, setTenantSlug, tenantPath } from '@/lib/api';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

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
  hold_expires_at: string;
  quote: { total_amount: number; security_deposit_amount: number; currency: string };
  invoice: { invoice_number: string };
  contract: { contract_number: string };
  milestones: { id: string; title: string; amount_due: number; due_date: string; status: string }[];
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
  title: { ar: 'تقويم التوفر لثلاثة أشهر والحجز الموجّه', en: '3-Month Availability & Guided Reservation' },
  allVenues: { ar: 'كل القاعات والمقار', en: 'All Venues' },
  allHalls: { ar: 'كل القاعات', en: 'All Halls' },
  combine: { ar: 'دمج القاعات', en: 'Combine Halls' },
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

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
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

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [anchor, setAnchor] = useState<Date>(() => monthStart(new Date()));
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [venueSlug, setVenueSlug] = useState<string>(locked ? (tenantSlug ?? '') : 'ALL');
  const [hallFilter, setHallFilter] = useState<string>(selectedHallId || 'ALL');
  const [merge, setMerge] = useState(false);

  useEffect(() => {
    if (selectedHallId) setHallFilter(selectedHallId);
  }, [selectedHallId]);

  const [selected, setSelected] = useState<{ date: string; slug: string; hallId: string } | null>(null);
  const [step, setStep] = useState(1);
  const wizardRef = useRef<HTMLDivElement>(null);

  // Wizard state
  const [slot, setSlot] = useState<SlotCode>('EVENING_17_23');
  const [guests, setGuests] = useState(250);
  const [cateringId, setCateringId] = useState<string>('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
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
    () => (venueSlug === 'ALL' ? tenants : tenants.filter((x) => x.slug === venueSlug)),
    [tenants, venueSlug]
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

  const dayIndex = useMemo(() => {
    const idx = new Map<string, CalDay>();
    const bestHall = new Map<string, string>();
    const hallDays = calendar?.days ?? {};
    const todayStr = fmtDate(new Date());
    visibleHalls.forEach(({ hall }) => {
      (hallDays[hall.id] ?? []).forEach((d) => {
        const effective: CalDay = d.date < todayStr ? { ...d, status: 'UNAVAILABLE' } : d;
        const cur = idx.get(d.date);
        if (
          !cur ||
          STATUS_RANK[effective.status] < STATUS_RANK[cur.status] ||
          (effective.status === cur.status && effective.status !== 'UNAVAILABLE' && effective.dynamic_price < cur.dynamic_price)
        ) {
          idx.set(d.date, effective);
          bestHall.set(d.date, hall.id);
        }
      });
    });
    return { idx, bestHall };
  }, [calendar, visibleHalls]);

  const selectedCtx = selected ? hallLookup.get(selected.hallId) : undefined;
  const selectedDay: CalDay | undefined = selected
    ? (calendar?.days[selected.hallId] ?? []).find((d) => d.date === selected.date)
    : undefined;

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

  const partner = selectedCtx?.hall.combinable_with_hall_id
    ? hallLookup.get(selectedCtx.hall.combinable_with_hall_id)?.hall
    : undefined;
  const canMerge = Boolean(partner);
  const currency = selectedCtx?.tenant.currency ?? 'YER';

  // Catalog comes from the calendar payload; the per-tenant endpoint refreshes it when available.
  const cateringItems: CateringItem[] = detail?.catering_items ?? selectedCtx?.tenant.catering_items ?? [];
  const addonItems: AddonItem[] = detail?.addon_items ?? selectedCtx?.tenant.addon_items ?? [];
  const taxRate = detail?.tax_rate ?? selectedCtx?.tenant.tax_rate ?? 0;
  const securityDeposit = detail?.default_security_deposit ?? selectedCtx?.tenant.default_security_deposit ?? 0;
  const paymentAccounts: PaymentAccount[] = detail?.payment_accounts ?? selectedCtx?.tenant.payment_accounts ?? [];

  const pricing = useMemo(() => {
    const hallPrice = selectedDay?.dynamic_price ?? 0;
    const cat = cateringItems.find((c) => c.id === cateringId);
    const catering = cat ? cat.price_per_guest * guests : 0;
    const addons = addonItems.reduce((s, a) => s + a.unit_addon_price * (qty[a.id] ?? 0), 0);
    const mergedAddon = merge && partner ? Math.round(partner.base_price * 0.85 * 100) / 100 : 0;
    const rawSubtotal = hallPrice + catering + addons + mergedAddon;
    const discount =
      appliedOffer?.discount_percent && appliedOffer.discount_percent > 0
        ? Math.round(rawSubtotal * (appliedOffer.discount_percent / 100) * 100) / 100
        : 0;
    const subtotal = Math.max(0, rawSubtotal - discount);
    const tax = subtotal * (taxRate / 100);
    return { hallPrice, catering, addons, mergedAddon, discount, subtotal, tax, total: subtotal + tax };
  }, [selectedDay, cateringItems, addonItems, cateringId, guests, qty, merge, partner, taxRate, appliedOffer]);

  /* ---------------- actions ---------------- */

  const pickDay = (date: string) => {
    const day = dayIndex.idx.get(date);
    const hallId = dayIndex.bestHall.get(date);
    if (!day || !hallId || day.status === 'UNAVAILABLE') return;
    const ctx = hallLookup.get(hallId);
    if (!ctx) return;
    setSelected({ date, slug: ctx.tenant.slug, hallId });
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

  const validateStep = (s: number): boolean => {
    if (s === 1) return guests >= 10 && Boolean(selectedDay?.available_slots.includes(slot) || selectedDay?.status === 'HOLD_48H');
    if (s === 3) {
      if (fullName.trim().length < 2 || phone.trim().length < 7) return false;
      if (category === 'CORPORATE_B2B' && (!company.trim() || !taxId.trim())) return false;
    }
    return true;
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
            merge_combinable_hall: merge && canMerge,
            event_type: sess.code === 'MORNING_09_15' ? 'CONFERENCE' : 'WEDDING',
            start_time: `${selected.date}T${sess.start}:00`,
            end_time: `${selected.date}T${sess.end}:00`,
            guest_count: guests,
            catering_item_id: cateringId || null,
            addons,
            payment_mode: payMode === 'HOLD' ? 'HOLD_48H' : 'IMMEDIATE_DEPOSIT',
            selected_payment_method: payMode === 'HOLD' ? 'PAY_LATER_48H' : payMethod,
            transfer_reference: payMode === 'PAY_NOW' ? transferRef.trim() || null : null,
            client_full_name: fullName.trim(),
            client_phone: phone.trim(),
            client_email: email.trim() || null,
            client_category: category,
            company_name: category === 'CORPORATE_B2B' ? company.trim() : null,
            tax_id: category === 'CORPORATE_B2B' ? taxId.trim() : null,
          },
        },
        selected.slug
      );
      setResult(res);
      setReceiptState('NONE');
      const firstMilestone = res.milestones[0];
      if (payMode === 'PAY_NOW' && receiptFile && firstMilestone) {
        try {
          const fd = new FormData();
          fd.append('receipt', receiptFile);
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
    `rounded-full border px-3 py-1.5 text-sm transition ${
      active
        ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-900 font-semibold'
        : 'border-slate-300 bg-white text-slate-700 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
    }`;
  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
  const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

  const venueForHalls = locked
    ? tenants.find((x) => x.slug === tenantSlug)
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
                className={`flex h-12 flex-col items-center justify-center rounded-md text-xs transition ${cls} ${
                  isSel ? 'ring-2 ring-[var(--brand-primary,#D4AF37)] ring-offset-1' : ''
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
                    setHallFilter('ALL');
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
                      setHallFilter('ALL');
                    }}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className={labelCls}>{t('hall')}</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={pill(hallFilter === 'ALL')} onClick={() => setHallFilter('ALL')}>
                  {t('allHalls')}
                </button>
                {hallChoices.map((h) => (
                  <button type="button" key={h.id} className={pill(hallFilter === h.id)} onClick={() => setHallFilter(h.id)}>
                    {hallName(h)}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              {t('combine')}
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hallChoices.map((h) => {
                const active = hallFilter === h.id;
                return (
                  <button
                    type="button"
                    key={h.id}
                    onClick={() => setHallFilter(active ? 'ALL' : h.id)}
                    className={`rounded-xl border p-3 text-start transition ${
                      active
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              {t('combine')}
            </label>
          </div>
        )}
      </SpotlightCard>

      {/* 2. Calendar header + legend */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className={pill(false)} onClick={() => setAnchor((a) => addMonths(a, -3))}>
            {t('prev')}
          </button>
          <button type="button" className={pill(false)} onClick={() => setAnchor(monthStart(new Date()))}>
            {t('today')}
          </button>
          <button type="button" className={pill(false)} onClick={() => setAnchor((a) => addMonths(a, 3))}>
            {t('next')}
          </button>
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
            ? `✔ تم اختيار ${selectedCtx.tenant.name} — ${selectedCtx.hall.name_ar} بتاريخ ${selected.date}`
            : `✔ ${selectedCtx.tenant.name} — ${selectedCtx.hall.name} selected for ${selected.date}`}
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
                <ul className="space-y-1 text-sm">
                  {result.milestones.map((m) => (
                    <li key={m.title} className="flex justify-between gap-2">
                      <span>{m.title}</span>
                      <span>{money(m.amount_due, result.quote.currency)}</span>
                    </li>
                  ))}
                </ul>
                {receiptState === 'UPLOADED' && (
                  <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">
                    {t('receiptUploaded')}
                  </p>
                )}
                {receiptState === 'FAILED' && (
                  <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
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
                      className={`rounded-full px-3 py-1 ${
                        step === i + 1
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
                      {row(t('venue'), selectedCtx.tenant.name)}
                      {row(
                        t('hall'),
                        hallName(selectedCtx.hall) + (merge && partner ? ` + ${hallName(partner)}` : '')
                      )}
                      {row('📅', selected.date)}
                    </div>
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
                    {canMerge && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
                        {t('combine')} ({partner ? hallName(partner) : ''})
                      </label>
                    )}
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
                        {cateringItems.length === 0 && (
                          <option value="" disabled>
                            {t('noCatering')}
                          </option>
                        )}
                        {cateringItems.map((c) => (
                          <option key={c.id} value={c.id}>
                            {isAr ? c.name_ar : c.name_en} — {money(c.price_per_guest, currency)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span className={labelCls}>{t('addons')}</span>
                      {addonItems.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('noAddons')}</p>
                      ) : (
                        <ul className="space-y-2">
                          {addonItems.map((a) => (
                            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                              <span>
                                {a.name} · {money(a.unit_addon_price, currency)}
                                <span className="text-xs text-slate-500">
                                  {' '}
                                  ({t('stock')}: {a.total_stock})
                                </span>
                              </span>
                              <span className="flex items-center gap-2">
                                <button
                                  type="button"
                                  aria-label="-"
                                  className={pill(false)}
                                  onClick={() => setQty((q) => ({ ...q, [a.id]: Math.max(0, (q[a.id] ?? 0) - 1) }))}
                                >
                                  −
                                </button>
                                <span className="w-6 text-center">{qty[a.id] ?? 0}</span>
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
                        className={`rounded-xl border p-3 text-start text-sm ${
                          payMode === 'HOLD'
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
                        className={`rounded-xl border p-3 text-start text-sm ${
                          payMode === 'PAY_NOW'
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
                  <button
                    type="button"
                    className={pill(false)}
                    disabled={step === 1}
                    onClick={() => setStep((s) => Math.max(1, s - 1))}
                  >
                    {t('back')}
                  </button>
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
