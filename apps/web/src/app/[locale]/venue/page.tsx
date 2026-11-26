'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileText,
  LogIn,
  MapPin,
  Minus,
  Moon,
  Phone,
  Plus,
  ShieldCheck,
  Sun,
  Users,
  Utensils,
} from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding, type TenantBrandingConfig } from '@/components/providers/theme-branding-provider';
import { calculateVenueQuote } from '@/lib/pricing-quote';
import {
  downloadInvoiceHtml,
  printInvoicePdf,
  type InvoiceRecord,
  type PaymentMethodRecord,
} from '@/lib/invoice-pdf';

interface StorefrontHall {
  id: string;
  nameEn: string;
  nameAr: string;
  capacityTheater: number;
  capacityBanquet: number;
  basePrice: number;
  cleaningBufferMinutes: number;
}

interface StorefrontMenu {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  pricePerGuest: number;
  costPerGuest: number;
  isActive: boolean;
}

interface StorefrontAddon {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  totalStock: number;
  unitAddonPrice: number;
  isActive: boolean;
}

interface BookingConfirmation {
  event: {
    id: string;
    eventCode: string;
    titleEn: string;
    hallNameEn: string;
    hallNameAr: string;
    startTime: string;
    endTime: string;
    guestCount: number;
    totalAmount: number;
    currency: string;
  };
  invoice: InvoiceRecord;
}

const HALL_IMAGES = [
  '/images/hero_grand_ballroom.jpg',
  '/images/venue_banquet_table.jpg',
  '/images/venue_conference_hall.jpg',
];

function getDefaultFutureDate(): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + 14);
  return dt.toISOString().slice(0, 10);
}

function fmtMoney(amount: number, currency: string, locale: 'ar' | 'en'): string {
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-YE' : 'en-US').format(Math.round(amount))} ${currency}`;
}

export default function TenantVenueStorefrontPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const altLocale = isRtl ? 'en' : 'ar';
  const DirectionArrow = isRtl ? ArrowLeft : ArrowRight;

  const { resolvedTheme, setTheme } = useTheme();
  const { user, signInWithGoogle, authFetch } = useAuth();
  const liveBranding = useTenantBranding();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [storefrontBranding, setStorefrontBranding] = useState<TenantBrandingConfig>(liveBranding);
  const [halls, setHalls] = useState<StorefrontHall[]>([]);
  const [menus, setMenus] = useState<StorefrontMenu[]>([]);
  const [addons, setAddons] = useState<StorefrontAddon[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);

  // Interactive Quote, Booking & Client Portal Registration Form
  const [selectedHallId, setSelectedHallId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<'WEDDING' | 'CONFERENCE' | 'GALA_DINNER' | 'CORPORATE'>('WEDDING');
  const [eventDate, setEventDate] = useState(getDefaultFutureDate);
  const [startHour, setStartHour] = useState('17:00');
  const [endHour, setEndHour] = useState('22:00');
  const [guestCount, setGuestCount] = useState(250);
  const [selectedMenuId, setSelectedMenuId] = useState<string>('');
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});

  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientCategory, setClientCategory] = useState<'INDIVIDUAL_B2C' | 'CORPORATE_B2B'>('INDIVIDUAL_B2C');
  const [companyName, setCompanyName] = useState('');
  const [nationalIdOrCr, setNationalIdOrCr] = useState('');
  const [taxId, setTaxId] = useState('');
  const [refundMethod, setRefundMethod] = useState('KURAIMI_BANK');
  const [refundAccountNumber, setRefundAccountNumber] = useState('');
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState('KURAIMI_BANK');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [copiedMethodId, setCopiedMethodId] = useState<string | null>(null);

  const handleCopyAccount = (id: string, accountNumber: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(accountNumber).catch(() => undefined);
    }
    setCopiedMethodId(id);
    setTimeout(() => setCopiedMethodId((curr) => (curr === id ? null : curr)), 2000);
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (user?.displayName && !clientName) {
      setClientName(user.displayName);
    }
  }, [user, clientName]);

  const loadStorefront = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/tenant/storefront', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        if (data?.branding) setStorefrontBranding((prev) => ({ ...prev, ...data.branding }));
        const loadedHalls: StorefrontHall[] = Array.isArray(data?.halls) ? data.halls : [];
        const loadedMenus: StorefrontMenu[] = Array.isArray(data?.cateringMenus) ? data.cateringMenus : [];
        const loadedAddons: StorefrontAddon[] = Array.isArray(data?.inventoryItems) ? data.inventoryItems : [];
        const loadedMethods: PaymentMethodRecord[] = Array.isArray(data?.paymentMethods) ? data.paymentMethods : [];
        setHalls(loadedHalls);
        setMenus(loadedMenus);
        setAddons(loadedAddons);
        setPaymentMethods(loadedMethods);
        if (loadedHalls.length > 0 && !selectedHallId) {
          setSelectedHallId(loadedHalls[0].id);
        }
        if (loadedMethods.length > 0) {
          setPreferredPaymentMethod(loadedMethods[0].code);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedHallId]);

  useEffect(() => {
    loadStorefront();
  }, [loadStorefront]);

  const branding = liveBranding.venueNameEn ? liveBranding : storefrontBranding;
  const venueName = isRtl ? branding.venueNameAr : branding.venueNameEn;
  const venueTagline = isRtl ? branding.taglineAr : branding.taglineEn;
  const venueAddress = isRtl ? branding.addressAr : branding.addressEn;
  const currency = branding.currency || 'YER';

  const selectedHall = useMemo(
    () => halls.find((h) => h.id === selectedHallId) || halls[0] || null,
    [halls, selectedHallId]
  );

  const selectedMenu = useMemo(
    () => menus.find((m) => m.id === selectedMenuId) || null,
    [menus, selectedMenuId]
  );

  const quote = useMemo(() => {
    return calculateVenueQuote({
      hallBasePrice: selectedHall ? selectedHall.basePrice : 0,
      eventDate,
      startHour,
      guestCount,
      cateringPricePerGuest: selectedMenu ? selectedMenu.pricePerGuest : 0,
      addons: addons.map((item) => ({
        unitPrice: item.unitAddonPrice,
        quantity: addonQty[item.id] || 0,
      })),
      taxRate: branding.taxRate ?? 5,
      defaultSecurityDeposit: branding.defaultSecurityDeposit ?? 150000,
    });
  }, [addons, addonQty, branding.defaultSecurityDeposit, branding.taxRate, eventDate, guestCount, selectedHall, selectedMenu, startHour]);

  const adjustAddon = (id: string, delta: number, maxQty: number) => {
    setAddonQty((prev) => {
      const current = prev[id] || 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [id]: next };
    });
  };

  const scrollToBooking = (hallId?: string) => {
    if (hallId) setSelectedHallId(hallId);
    const el = document.getElementById('book-and-register');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedHall) {
      setFormError(isRtl ? 'يرجى اختيار قاعة أولاً.' : 'Please select a hall first.');
      return;
    }

    if (!title.trim() || !clientName.trim() || clientPhone.replace(/\D/g, '').length < 7) {
      setFormError(
        isRtl
          ? 'يرجى استكمال عنوان الفعالية، الاسم الكامل، ورقم جوال صالح.'
          : 'Please complete the event title, full name, and a valid phone number.'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (!user) {
        const signedIn = await signInWithGoogle();
        if (!signedIn) {
          setFormError(
            isRtl
              ? 'يلزم تسجيل الدخول بحساب Google لتثبيت الحجز وتفعيل حسابك في بوابة العميل.'
              : 'Please sign in with Google to confirm your reservation and activate your Client Portal account.'
          );
          setSubmitting(false);
          return;
        }
      }

      const selectedAddons = Object.entries(addonQty)
        .filter(([, q]) => q > 0)
        .map(([id, quantity]) => ({ id, quantity }));

      const res = await authFetch('/api/v1/tenant/storefront', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hallId: selectedHall.id,
          title: title.trim(),
          eventType,
          eventDate,
          startHour,
          endHour,
          guestCount,
          cateringMenuId: selectedMenuId || null,
          addons: selectedAddons,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          clientCategory,
          companyName: companyName.trim(),
          nationalIdOrCr: nationalIdOrCr.trim(),
          taxId: taxId.trim(),
          refundMethod,
          refundAccountNumber: refundAccountNumber.trim(),
          preferredPaymentMethod,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.detail || (isRtl ? 'تعذر إرسال طلب الحجز.' : 'Unable to submit booking request.'));
        setSubmitting(false);
        return;
      }

      setConfirmation({
        event: data.event,
        invoice: data.invoice,
      });
    } catch {
      setFormError(isRtl ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#070B14] dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#070B14]/95">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
          <Link
            href={`/${locale}/venue`}
            className="shrink-0 whitespace-nowrap text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {venueName}
          </Link>

          <nav
            aria-label={isRtl ? 'التنقل في بوابة الصالة' : 'Venue storefront navigation'}
            className="hidden items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400 md:flex"
          >
            <a href="#halls" className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'القاعات' : 'Halls'}
            </a>
            <a href="#catering" className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'الضيافة والإضافات' : 'Catering & Add-Ons'}
            </a>
            <a href="#payments" className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'قنوات الدفع' : 'Payments'}
            </a>
            <Link
              href={`/${locale}/portal/dashboard`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'بوابة العميل' : 'Client Portal'}
            </Link>
            <Link
              href={`/${locale}/dashboard`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'لوحة الإدارة' : 'ERP Console'}
            </Link>
            <Link
              href={`/${altLocale}/venue`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'English' : 'العربية'}
            </Link>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => scrollToBooking()}
              className="min-h-[40px] shrink-0 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90"
            >
              {isRtl ? 'احجز قاعتك الآن' : 'Reserve a Hall'}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* Architectural Venue Hero */}
        <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800">
          <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-12 lg:py-16">
            <div className="space-y-6 lg:col-span-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>{branding.customDomain}</span>
                <span aria-hidden="true" className="mx-2">·</span>
                <span>{isRtl ? 'حجز فوري + فاتورة رسمية' : 'Instant Quote & Tax Invoice'}</span>
              </p>

              <h1
                className="font-bold leading-[1.12] tracking-tight text-slate-900 dark:text-slate-100"
                style={{ fontSize: 'clamp(2.1rem, 3.8vw, 3.3rem)', textWrap: 'balance' }}
              >
                {venueName}
              </h1>

              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400 sm:text-base">
                {venueTagline}
              </p>

              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{venueAddress}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
                  <span className="font-mono tabular-nums" dir="ltr">{branding.contactPhone}</span>
                  <span aria-hidden="true">·</span>
                  <span>{branding.contactEmail}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => scrollToBooking()}
                  className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90"
                >
                  <span>{isRtl ? 'احسب التكلفة واحجز فوراً' : 'Calculate Quote & Book'}</span>
                  <DirectionArrow className="h-4 w-4" />
                </button>
                <Link
                  href={`/${locale}/portal/dashboard`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap text-sm font-medium text-slate-700 underline-offset-4 hover:text-slate-950 hover:underline dark:text-slate-300 dark:hover:text-white"
                >
                  <span>{isRtl ? 'دخول بوابة العميل الحالية' : 'Open Client Portal'}</span>
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span>{isRtl ? 'حجز مؤقت فوري لمدة 48 ساعة' : 'Instant 48h Hold Lock'}</span>
                <span aria-hidden="true">·</span>
                <span>{isRtl ? `ضريبة ${branding.taxRate}% واضحة` : `${branding.taxRate}% Transparent Tax`}</span>
                {mounted && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                      className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300"
                    >
                      {resolvedTheme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                      <span>{resolvedTheme === 'dark' ? (isRtl ? 'نهاري' : 'Light') : isRtl ? 'ليلي' : 'Dark'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800">
                <img
                  src="/images/hero_grand_ballroom.jpg"
                  alt={venueName}
                  className="aspect-[16/10] w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-6 pb-5 pt-16 text-white">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="text-xs text-amber-300">
                        {isRtl ? 'حجز مباشر بعلامة الصالة التجارية' : 'Official White-Label Booking Portal'}
                      </div>
                      <div className="mt-1 text-base font-semibold">
                        {isRtl
                          ? `${halls.length || 3} قاعات فاخرة · قوائم ضيافة ملكية · فواتير PDF فورية`
                          : `${halls.length || 3} Signature Halls · Royal Catering · Instant Branded Invoices`}
                      </div>
                    </div>
                    <div className="font-mono text-xs tabular-nums text-slate-200">
                      {isRtl
                        ? `التأمين المسترد: ${fmtMoney(branding.defaultSecurityDeposit, currency, locale)}`
                        : `Security Deposit: ${fmtMoney(branding.defaultSecurityDeposit, currency, locale)}`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Halls Showcase */}
        <section id="halls" className="mx-auto max-w-[1280px] scroll-mt-20 px-6 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                {isRtl ? 'القاعات المتاحة للحجز' : 'Signature Spaces'}
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
                {isRtl ? 'اختر القاعة المناسبة لحجم فعاليتك' : 'Select the ideal hall for your event'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl
                ? 'تشمل الأسعار التجهيز القياسي مع تطبيق معامل +20% لذروة الخميس والجمعة.'
                : 'Base rates include standard setup. Weekend peak (+20%) applies automatically on Thu & Fri.'}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            {loading && halls.length === 0 ? (
              <div className="col-span-3 rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                {isRtl ? 'جارٍ تحميل القاعات والأسعار...' : 'Loading halls and live rates...'}
              </div>
            ) : (
              halls.map((hall, index) => {
                const isSelected = selectedHall?.id === hall.id;
                const imgSrc = HALL_IMAGES[index % HALL_IMAGES.length];
                return (
                  <article
                    key={hall.id}
                    className={`flex flex-col overflow-hidden rounded-xl border transition-colors ${
                      isSelected
                        ? 'border-[var(--brand-primary,#D4AF37)] bg-white dark:bg-slate-900'
                        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70'
                    }`}
                  >
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-900">
                      <img
                        src={imgSrc}
                        alt={isRtl ? hall.nameAr : hall.nameEn}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-1 flex-col justify-between p-5">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                            {isRtl ? hall.nameAr : hall.nameEn}
                          </h3>
                          {isSelected && (
                            <span className="text-xs font-semibold text-amber-700 dark:text-[#D4AF37]">
                              {isRtl ? 'محددة' : 'Selected'}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {isRtl ? hall.nameEn : hall.nameAr}
                        </p>

                        <dl className="mt-4 divide-y divide-slate-200 border-t border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                          <div className="flex items-center justify-between py-2">
                            <dt className="text-slate-500 dark:text-slate-400">
                              {isRtl ? 'السعة (مسرح / ولائم)' : 'Capacity (Theater / Banquet)'}
                            </dt>
                            <dd className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                              {hall.capacityTheater} / {hall.capacityBanquet}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <dt className="text-slate-500 dark:text-slate-400">
                              {isRtl ? 'فترة التجهيز والتنظيف' : 'Turnaround Buffer'}
                            </dt>
                            <dd className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                              {hall.cleaningBufferMinutes} {isRtl ? 'دقيقة' : 'min'}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <dt className="text-slate-500 dark:text-slate-400">
                              {isRtl ? 'السعر الأساسي' : 'Base Rate'}
                            </dt>
                            <dd className="font-mono text-sm font-semibold tabular-nums text-amber-700 dark:text-[#D4AF37]">
                              {fmtMoney(hall.basePrice, currency, locale)}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <button
                        type="button"
                        onClick={() => scrollToBooking(hall.id)}
                        className={`mt-5 min-h-[40px] w-full rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                          isSelected
                            ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                            : 'border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        {isSelected
                          ? isRtl
                            ? 'متابعة الحجز لهذه القاعة'
                            : 'Continue with This Hall'
                          : isRtl
                          ? 'اختيار القاعة وحساب العرض'
                          : 'Select Hall & Build Quote'}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* Catering Menus & Add-On Equipment */}
        <section
          id="catering"
          className="scroll-mt-20 border-y border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-[#0B1120]"
        >
          <div className="mx-auto max-w-[1280px] space-y-10 px-6">
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                {isRtl ? 'قوائم الضيافة والتجهيزات الإضافية' : 'Catering Packages & Equipment Add-Ons'}
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {isRtl ? 'خصّص تفاصيل الضيافة والتجهيزات مباشرة في عرض السعر' : 'Customize banquet catering and add-on equipment live'}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              {/* Catering Packages */}
              <div className="space-y-3 lg:col-span-6">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Utensils className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{isRtl ? 'باقات البوفيه والضيافة (للضيف)' : 'Banquet Catering Menus (Per Guest)'}</span>
                  </h3>
                  {selectedMenuId && (
                    <button
                      type="button"
                      onClick={() => setSelectedMenuId('')}
                      className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
                    >
                      {isRtl ? 'إلغاء الضيافة' : 'Remove catering'}
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {menus.map((menu) => {
                    const active = selectedMenuId === menu.id;
                    return (
                      <button
                        key={menu.id}
                        type="button"
                        onClick={() => setSelectedMenuId(active ? '' : menu.id)}
                        className={`w-full rounded-xl border p-4 text-start transition-colors ${
                          active
                            ? 'border-[var(--brand-primary,#D4AF37)] bg-amber-50/40 dark:bg-[#D4AF37]/10'
                            : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {isRtl ? menu.nameAr : menu.nameEn}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                              {isRtl ? menu.descriptionAr : menu.descriptionEn}
                            </p>
                          </div>
                          <div className="shrink-0 text-end">
                            <div className="font-mono text-sm font-bold tabular-nums text-amber-700 dark:text-[#D4AF37]">
                              {fmtMoney(menu.pricePerGuest, currency, locale)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {isRtl ? '/ ضيف' : '/ guest'}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Add-on Inventory Items */}
              <div className="space-y-3 lg:col-span-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Building2 className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{isRtl ? 'التجهيزات والإضافات الاختيارية' : 'Optional Equipment & Decor Add-Ons'}</span>
                </h3>
                <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/60">
                  {addons.map((item) => {
                    const qty = addonQty[item.id] || 0;
                    const itemLabel = isRtl ? item.nameAr : item.nameEn;
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {itemLabel}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono tabular-nums">{fmtMoney(item.unitAddonPrice, currency, locale)}</span>
                            <span aria-hidden="true" className="mx-1.5">·</span>
                            <span>{item.category}</span>
                            <span aria-hidden="true" className="mx-1.5">·</span>
                            <span className="font-mono tabular-nums">
                              {isRtl ? `متاح ${item.totalStock}` : `${item.totalStock} avail`}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => adjustAddon(item.id, -1, item.totalStock)}
                            disabled={qty <= 0}
                            aria-label={isRtl ? `إنقاص ${itemLabel}` : `Decrease ${itemLabel}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustAddon(item.id, 1, item.totalStock)}
                            disabled={qty >= item.totalStock}
                            aria-label={isRtl ? `زيادة ${itemLabel}` : `Increase ${itemLabel}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Accepted Payment Channels Directory */}
        <section id="payments" className="mx-auto max-w-[1280px] scroll-mt-20 px-6 py-14">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
              {isRtl ? 'وسائل الدفع والاسترداد المعتمدة' : 'Verified Payment & Refund Channels'}
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {isRtl ? 'قنوات سداد رسمية مدمجة في الفواتير' : 'Official settlement accounts printed on every invoice'}
            </h2>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paymentMethods.map((pm) => {
              const copied = copiedMethodId === pm.id;
              return (
                <div
                  key={pm.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? pm.nameAr : pm.nameEn}
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {pm.providerType}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="font-mono text-sm font-semibold tabular-nums text-amber-700 dark:text-[#D4AF37]" dir="ltr">
                      {pm.accountNumber}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyAccount(pm.id, pm.accountNumber)}
                      aria-label={isRtl ? `نسخ حساب ${pm.nameAr}` : `Copy ${pm.nameEn} account`}
                      className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      <span>{copied ? (isRtl ? 'تم النسخ' : 'Copied') : isRtl ? 'نسخ' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{pm.accountName}</div>
                  {(isRtl ? pm.instructionsAr : pm.instructionsEn) && (
                    <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      {isRtl ? pm.instructionsAr : pm.instructionsEn}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Interactive Booking, Live Quote & Client Portal Registration */}
        <section
          id="book-and-register"
          className="scroll-mt-20 border-t border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-[#0B1120]"
        >
          <div className="mx-auto max-w-[1280px] px-6">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                {isRtl ? 'حجز الفعالية وتفعيل بوابة العميل' : 'Event Reservation & Client Portal Registration'}
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
                {isRtl
                  ? 'أكمل بيانات الحجز واحصل على فاتورتك الرسمية وحسابك فوراً'
                  : 'Reserve your slot, register your Client Portal, and issue your invoice'}
              </h2>
            </div>

            {confirmation ? (
              <div className="mt-8 rounded-2xl border border-emerald-300 bg-emerald-50/60 p-8 dark:border-emerald-800/60 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="text-sm font-semibold">
                        {isRtl ? 'تم تثبيت الحجز المؤقت وتفعيل حسابك في بوابة العميل' : '48-Hour Hold Locked & Client Portal Activated'}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                      {confirmation.event.titleEn}
                    </h3>
                    <p className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                      {confirmation.event.eventCode} · {confirmation.invoice.invoiceNumber} ·{' '}
                      {isRtl ? confirmation.event.hallNameAr : confirmation.event.hallNameEn}
                    </p>
                  </div>

                  <div className="text-end">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isRtl ? 'إجمالي الفاتورة' : 'Invoice Total'}
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {fmtMoney(confirmation.invoice.totalAmount, confirmation.invoice.currency, locale)}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-emerald-200 pt-6 dark:border-emerald-900/60">
                  <button
                    type="button"
                    onClick={() => printInvoicePdf(confirmation.invoice, branding, locale, paymentMethods)}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 py-2.5 text-xs font-semibold text-slate-950 hover:opacity-90"
                  >
                    <FileText className="h-4 w-4" />
                    <span>{isRtl ? 'تصدير الفاتورة PDF بالعلامة التجارية' : 'Export Branded Invoice PDF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => downloadInvoiceHtml(confirmation.invoice, branding, locale, paymentMethods)}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Download className="h-4 w-4" />
                    <span>{isRtl ? 'تنزيل نسخة HTML' : 'Download HTML Copy'}</span>
                  </button>

                  <Link
                    href={`/${locale}/portal/dashboard`}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    <span>{isRtl ? 'فتح بوابة العميل وسداد الدفعة' : 'Open Client Portal & Pay Deposit'}</span>
                    <DirectionArrow className="h-4 w-4" />
                  </Link>

                  <button
                    type="button"
                    onClick={() => setConfirmation(null)}
                    className="text-xs font-medium text-slate-600 underline-offset-4 hover:underline dark:text-slate-400"
                  >
                    {isRtl ? 'إنشاء حجز آخر' : 'Make Another Booking'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit} className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
                {/* Left 7 Cols: Event Details + Client Portal Registration */}
                <div className="space-y-6 lg:col-span-7">
                  {/* Block 1: Event Schedule & Hall */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6 dark:border-slate-800 dark:bg-slate-900/60">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <Calendar className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                      <span>{isRtl ? '1. تفاصيل الفعالية والموعد' : '1. Event Schedule & Hall'}</span>
                    </h3>

                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'اسم أو عنوان الفعالية' : 'Event Title'}
                        </label>
                        <input
                          required
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder={isRtl ? 'مثال: حفل زفاف آل الشامي الملكي' : 'e.g. Al-Shami Royal Wedding Reception'}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[var(--brand-primary,#D4AF37)] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'القاعة' : 'Hall'}
                        </label>
                        <select
                          value={selectedHall?.id || ''}
                          onChange={(e) => setSelectedHallId(e.target.value)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          {halls.map((h) => (
                            <option key={h.id} value={h.id}>
                              {isRtl ? `${h.nameAr} (حتى ${h.capacityTheater})` : `${h.nameEn} (up to ${h.capacityTheater})`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'نوع الفعالية' : 'Event Type'}
                        </label>
                        <select
                          value={eventType}
                          onChange={(e) => setEventType(e.target.value as typeof eventType)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="WEDDING">{isRtl ? 'حفل زفاف' : 'Wedding'}</option>
                          <option value="CONFERENCE">{isRtl ? 'مؤتمر وندوة' : 'Conference'}</option>
                          <option value="GALA_DINNER">{isRtl ? 'عشاء رسمي' : 'Gala Dinner'}</option>
                          <option value="CORPORATE">{isRtl ? 'فعالية شركات' : 'Corporate Event'}</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'التاريخ' : 'Event Date'}
                        </label>
                        <input
                          required
                          type="date"
                          value={eventDate}
                          onChange={(e) => setEventDate(e.target.value)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'عدد الضيوف المتوقع' : 'Expected Guests'}
                        </label>
                        <input
                          required
                          type="number"
                          min={20}
                          max={selectedHall?.capacityTheater || 800}
                          value={guestCount}
                          onChange={(e) => setGuestCount(Math.max(1, Number(e.target.value || 0)))}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'وقت البدء' : 'Start Time'}
                        </label>
                        <input
                          required
                          type="time"
                          value={startHour}
                          onChange={(e) => setStartHour(e.target.value)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'وقت الانتهاء' : 'End Time'}
                        </label>
                        <input
                          required
                          type="time"
                          value={endHour}
                          onChange={(e) => setEndHour(e.target.value)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Block 2: Client Portal Registration & Refund Vault */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <Users className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                        <span>{isRtl ? '2. تسجيل حساب بوابة العميل ومحفظة الاسترداد' : '2. Client Portal Registration & Refund Vault'}</span>
                      </h3>
                      <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-slate-950">
                        <button
                          type="button"
                          onClick={() => setClientCategory('INDIVIDUAL_B2C')}
                          className={`rounded-md px-3 py-1 font-medium ${
                            clientCategory === 'INDIVIDUAL_B2C'
                              ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {isRtl ? 'أفراد B2C' : 'Individual B2C'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setClientCategory('CORPORATE_B2B')}
                          className={`rounded-md px-3 py-1 font-medium ${
                            clientCategory === 'CORPORATE_B2B'
                              ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {isRtl ? 'شركات B2B' : 'Corporate B2B'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'الاسم الكامل للعميل' : 'Full Name'}
                        </label>
                        <input
                          required
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                          placeholder={isRtl ? 'أحمد عبدالله الشامي' : 'Ahmed Abdullah Al-Shami'}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'رقم الجوال / واتساب' : 'Phone / WhatsApp'}
                        </label>
                        <input
                          required
                          dir="ltr"
                          value={clientPhone}
                          onChange={(e) => setClientPhone(e.target.value)}
                          placeholder="+967 771 234 567"
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      {clientCategory === 'CORPORATE_B2B' && (
                        <>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                              {isRtl ? 'اسم الشركة / الجهة' : 'Company / Organization'}
                            </label>
                            <input
                              value={companyName}
                              onChange={(e) => setCompanyName(e.target.value)}
                              placeholder={isRtl ? 'شركة سبأ للاتصالات' : 'Saba Telecom Corp'}
                              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                              {isRtl ? 'الرقم الضريبي (VAT)' : 'Tax ID (VAT)'}
                            </label>
                            <input
                              dir="ltr"
                              value={taxId}
                              onChange={(e) => setTaxId(e.target.value)}
                              placeholder="TAX-901244"
                              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                        </>
                      )}

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {clientCategory === 'CORPORATE_B2B'
                            ? isRtl
                              ? 'رقم السجل التجاري'
                              : 'Commercial Reg. (CR)'
                            : isRtl
                            ? 'رقم الهوية الوطنية / الجواز'
                            : 'National ID / Passport'}
                        </label>
                        <input
                          dir="ltr"
                          value={nationalIdOrCr}
                          onChange={(e) => setNationalIdOrCr(e.target.value)}
                          placeholder="0101-882910"
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'قناة السداد المفضلة' : 'Preferred Payment Channel'}
                        </label>
                        <select
                          value={preferredPaymentMethod}
                          onChange={(e) => setPreferredPaymentMethod(e.target.value)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          {paymentMethods.map((pm) => (
                            <option key={pm.id} value={pm.code}>
                              {isRtl ? pm.nameAr : pm.nameEn}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'قناة استرداد التأمين (Refund Vault)' : 'Security Deposit Refund Channel'}
                        </label>
                        <select
                          value={refundMethod}
                          onChange={(e) => setRefundMethod(e.target.value)}
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="KURAIMI_BANK">{isRtl ? 'بنك الكريمي الإسلامي' : 'Al-Kuraimi Islamic Bank'}</option>
                          <option value="JAIB">{isRtl ? 'محفظة جيب (Jaib)' : 'Jaib E-Wallet'}</option>
                          <option value="JAWALI">{isRtl ? 'محفظة جوالي (Jawali)' : 'Jawali E-Wallet'}</option>
                          <option value="ONECASH">{isRtl ? 'ون كاش (OneCash)' : 'OneCash Wallet'}</option>
                          <option value="BANK_IBAN">{isRtl ? 'حوالة بنكية (IBAN)' : 'Bank IBAN Transfer'}</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'رقم حساب الاسترداد' : 'Refund Account / Wallet #'}
                        </label>
                        <input
                          dir="ltr"
                          value={refundAccountNumber}
                          onChange={(e) => setRefundAccountNumber(e.target.value)}
                          placeholder="3011998822"
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          {isRtl ? 'ملاحظات التجهيز أو التنسيق' : 'Setup & Coordination Notes'}
                        </label>
                        <textarea
                          rows={2}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={
                            isRtl
                              ? 'ترتيب الكوشة، متطلبات الضيافة الخاصة، أو وقت دخول المنسق...'
                              : 'Stage setup preferences, special dietary requests, or planner arrival notes...'
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right 5 Cols: Live Itemized Quote & Checkout Summary */}
                <div className="lg:col-span-5">
                  <div className="sticky top-24 rounded-xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          {isRtl ? 'ملخص عرض السعر والفاتورة' : 'Live Itemized Quote'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {selectedHall ? (isRtl ? selectedHall.nameAr : selectedHall.nameEn) : '—'}
                          {quote.isWeekendPeak && (
                            <span className="ms-1.5 font-medium text-amber-700 dark:text-[#D4AF37]">
                              · {isRtl ? 'ذروة نهاية الأسبوع +20%' : 'Weekend Peak +20%'}
                            </span>
                          )}
                        </p>
                      </div>
                      <CreditCard className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    </div>

                    <dl className="mt-4 space-y-2.5 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-slate-600 dark:text-slate-400">
                          {isRtl ? 'إيجار القاعة' : 'Hall Reservation'}
                        </dt>
                        <dd className="font-mono font-medium tabular-nums">
                          {fmtMoney(quote.hallTotal, currency, locale)}
                        </dd>
                      </div>

                      {selectedMenu && (
                        <div className="flex items-center justify-between">
                          <dt className="text-slate-600 dark:text-slate-400">
                            {isRtl ? selectedMenu.nameAr : selectedMenu.nameEn} ({guestCount})
                          </dt>
                          <dd className="font-mono font-medium tabular-nums">
                            {fmtMoney(quote.cateringTotal, currency, locale)}
                          </dd>
                        </div>
                      )}

                      {quote.addonsTotal > 0 && (
                        <div className="flex items-center justify-between">
                          <dt className="text-slate-600 dark:text-slate-400">
                            {isRtl ? 'التجهيزات والإضافات' : 'Equipment Add-Ons'}
                          </dt>
                          <dd className="font-mono font-medium tabular-nums">
                            {fmtMoney(quote.addonsTotal, currency, locale)}
                          </dd>
                        </div>
                      )}

                      <div className="flex items-center justify-between border-t border-slate-200 pt-2.5 text-xs dark:border-slate-800">
                        <dt className="text-slate-500 dark:text-slate-400">
                          {isRtl ? `ضريبة القيمة المضافة (${quote.taxRate}%)` : `VAT / Tax (${quote.taxRate}%)`}
                        </dt>
                        <dd className="font-mono tabular-nums">
                          {fmtMoney(quote.taxAmount, currency, locale)}
                        </dd>
                      </div>

                      <div className="flex items-center justify-between border-t-2 border-[var(--brand-primary,#D4AF37)] pt-3 text-base font-bold">
                        <dt>{isRtl ? 'الإجمالي المستحق' : 'Grand Total'}</dt>
                        <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {fmtMoney(quote.grandTotal, currency, locale)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">
                          {isRtl ? 'دفعة التأكيد (50% خلال 48 ساعة)' : 'Confirmation Deposit (50% / 48h)'}
                        </span>
                        <span className="font-mono font-semibold tabular-nums text-amber-700 dark:text-[#D4AF37]">
                          {fmtMoney(quote.confirmationDeposit, currency, locale)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">
                          {isRtl ? 'تأمين الأضرار المسترد (معزول)' : 'Refundable Security Deposit'}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {fmtMoney(quote.securityDeposit, currency, locale)}
                        </span>
                      </div>
                    </div>

                    {formError && (
                      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                        {formError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {!user ? <LogIn className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      <span>
                        {submitting
                          ? isRtl
                            ? 'جارٍ تثبيت الحجز وإصدار الفاتورة...'
                            : 'Locking Slot & Issuing Invoice...'
                          : !user
                          ? isRtl
                            ? 'تسجيل الدخول بـ Google وتأكيد الحجز'
                            : 'Sign in with Google & Lock 48h Hold'
                          : isRtl
                          ? 'تأكيد الحجز المؤقت وتفعيل بوابة العميل'
                          : 'Lock 48h Hold & Activate Client Portal'}
                      </span>
                    </button>

                    <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        {isRtl
                          ? 'منع فوري لتضارب المواعيد · إصدار فاتورة PDF فورية'
                          : 'Real-time conflict check · Instant PDF tax invoice'}
                      </span>
                    </div>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
