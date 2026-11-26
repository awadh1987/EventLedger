'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/providers/auth-provider';
import { ArrowLeft, ArrowRight, Check, Moon, Sun } from 'lucide-react';

type PlanCode = 'BASIC' | 'PRO' | 'ENTERPRISE';
type CurrencyCode = 'YER' | 'SAR' | 'USD';

interface PlanSpec {
  code: PlanCode;
  audienceEn: string;
  audienceAr: string;
  nameEn: string;
  nameAr: string;
  monthlyUsd: number;
  summaryEn: string;
  summaryAr: string;
  limitsEn: string[];
  limitsAr: string[];
  recommended?: boolean;
}

const PLANS: PlanSpec[] = [
  {
    code: 'BASIC',
    audienceEn: 'For single-hall venues',
    audienceAr: 'للصالات المفردة',
    nameEn: 'Basic',
    nameAr: 'الباقة الأساسية',
    monthlyUsd: 79,
    summaryEn: 'Core reservation calendar, conflict prevention, milestone invoices, and client portal.',
    summaryAr: 'تقويم الحجوزات الأساسي، منع تضارب المواعيد، الفواتير المرحلية، وبوابة العملاء.',
    limitsEn: [
      '1 Venue Hall with cleaning buffer rules',
      'Up to 40 scheduled events per month',
      'Client portal with Kuraimi & e-wallet refund vault',
      '5 internal staff seats with role permissions',
    ],
    limitsAr: [
      'قاعة واحدة مع ضبط فترات التجهيز والتنظيف',
      'حتى 40 فعالية مجدولة شهرياً',
      'بوابة عملاء مع محفظة استرداد (الكريمي / جيب / جوالي)',
      '5 حسابات لموظفي الصالة بصلاحيات محددة',
    ],
  },
  {
    code: 'PRO',
    audienceEn: 'For multi-hall palaces & hotels',
    audienceAr: 'لقصور الأفراح والفنادق متعددة القاعات',
    nameEn: 'Pro',
    nameAr: 'الباقة الاحترافية',
    monthlyUsd: 189,
    recommended: true,
    summaryEn: 'Combinable hall partitions, automated double-entry ledger, interactive floor plans, and WhatsApp alerts.',
    summaryAr: 'دمج القاعات المتجاورة، محاسبة القيد المزدوج التلقائية، المخطط التفاعلي، وتنبيهات واتساب.',
    limitsEn: [
      'Up to 5 halls with partition-merge scheduling',
      'Automated 8-account hospitality double-entry ledger',
      'Interactive Konva floor plan & planner delegation',
      '48-hour hold expiry automation & WhatsApp reminders',
    ],
    limitsAr: [
      'حتى 5 قاعات مع جدولة دمج القاعات المتجاورة',
      'محاسبة قيد مزدوج تلقائية بدليل حسابات ضيافة جاهز',
      'مخطط طاولات تفاعلي وتفويض منسقي الحفلات',
      'أتمتة انتهاء الحجز المؤقت (48 ساعة) وتنبيهات واتساب',
    ],
  },
  {
    code: 'ENTERPRISE',
    audienceEn: 'For conference centers & groups',
    audienceAr: 'لمراكز المؤتمرات والمجموعات',
    nameEn: 'Enterprise',
    nameAr: 'باقة المؤسسات',
    monthlyUsd: 390,
    summaryEn: 'Unlimited halls, custom CNAME domains, offline QR VIP gate sync, and live kitchen BEO routing.',
    summaryAr: 'قاعات غير محدودة، نطاق خاص مخصص، مزامنة بوابة QR بدون إنترنت، وأوامر تشغيل المطبخ.',
    limitsEn: [
      'Unlimited halls, branches, and seasonal pricing rules',
      'Custom CNAME domain (e.g. events.yourpalace.ye)',
      'Offline-ready QR security gate & VIP guest check-in',
      'Live Kitchen BEO locks (72h prior) & dedicated onboarding',
    ],
    limitsAr: [
      'قاعات وفروع غير محدودة وقواعد تسعير موسمية',
      'نطاق مخصص بالكامل (مثل events.yourpalace.ye)',
      'ماسح بوابة QR أوفلاين لتسجيل دخول كبار الشخصيات',
      'أوامر تشغيل المطبخ الحية (BEO) ودعم تشغيل مخصص',
    ],
  },
];

const CURRENCY_MULTIPLIERS: Record<CurrencyCode, { rate: number; suffixEn: string; suffixAr: string }> = {
  USD: { rate: 1, suffixEn: 'USD', suffixAr: 'دولار' },
  SAR: { rate: 3.75, suffixEn: 'SAR', suffixAr: 'ر.س' },
  YER: { rate: 530, suffixEn: 'YER', suffixAr: 'ر.ي' },
};

function formatTierPrice(monthlyUsd: number, currency: CurrencyCode, annual: boolean, locale: 'ar' | 'en'): string {
  const discounted = annual ? monthlyUsd * 0.8 : monthlyUsd;
  const meta = CURRENCY_MULTIPLIERS[currency];
  const converted = Math.round(discounted * meta.rate);
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-YE' : 'en-US').format(converted);
  return currency === 'USD' ? `$${formatted}` : `${formatted} ${locale === 'ar' ? meta.suffixAr : meta.suffixEn}`;
}

export default function SaasLandingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const altLocale = isRtl ? 'en' : 'ar';
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.cloud').split(':')[0];

  const { resolvedTheme, setTheme } = useTheme();
  const { user, signInWithGoogle, authFetch } = useAuth();
  const [mounted, setMounted] = useState(false);

  const [annualBilling, setAnnualBilling] = useState(true);
  const [heroImgError, setHeroImgError] = useState(false);
  const [confImgError, setConfImgError] = useState(false);
  const [banquetImgError, setBanquetImgError] = useState(false);

  const [form, setForm] = useState<{
    venue_name: string;
    slug: string;
    owner_name: string;
    owner_phone: string;
    owner_email: string;
    currency: CurrencyCode;
    subscription_tier: PlanCode;
  }>({
    venue_name: '',
    slug: '',
    owner_name: '',
    owner_phone: '',
    owner_email: '',
    currency: 'YER',
    subscription_tier: 'PRO',
  });

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<{
    slug: string;
    venue_name: string;
    workspace_url: string;
    subscription_tier: string;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const DirectionArrow = isRtl ? ArrowLeft : ArrowRight;

  const scrollToProvision = (tier?: PlanCode) => {
    if (tier) {
      setForm((prev) => ({ ...prev, subscription_tier: tier }));
    }
    const el = document.getElementById('provision');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (form.slug.trim().length < 3) {
      setErrorMsg(
        isRtl
          ? 'يجب أن يتكون اسم النطاق الفرعي من 3 أحرف إنجليزية على الأقل.'
          : 'Subdomain slug must be at least 3 lowercase characters.'
      );
      return;
    }

    if (form.owner_phone.replace(/\D/g, '').length < 7) {
      setErrorMsg(
        isRtl
          ? 'يرجى إدخال رقم جوال صالح مع رمز الدولة.'
          : 'Please enter a valid phone number including country code.'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (!user) {
        const signedIn = await signInWithGoogle();
        if (!signedIn) {
          setErrorMsg(
            isRtl
              ? 'يرجى تسجيل الدخول بحساب Google لإكمال إنشاء مساحة الصالة.'
              : 'Please sign in with Google to complete workspace provisioning.'
          );
          setSubmitting(false);
          return;
        }
      }

      const res = await authFetch('/api/v1/public/tenants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_email: form.owner_email.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.detail || (isRtl ? 'تعذر إنشاء مساحة الصالة.' : 'Unable to provision workspace.'));
        setSubmitting(false);
        return;
      }

      setProvisioned({
        slug: data.slug,
        venue_name: data.venue_name || form.venue_name,
        workspace_url: data.workspace_url || `https://${data.slug}.${rootDomain}`,
        subscription_tier: data.subscription_tier || form.subscription_tier,
      });
    } catch {
      setErrorMsg(isRtl ? 'تعذر الاتصال بالخادم، يرجى المحاولة مجدداً.' : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#070B14] dark:text-slate-100"
    >
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#070B14]/90">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            href={`/${locale}`}
            className="shrink-0 whitespace-nowrap text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {isRtl ? 'إيفنت ليدجر' : 'EventLedger'}
          </Link>

          {/* Zone 2: 4-5 Clean Typography Nav Links */}
          <nav
            aria-label={isRtl ? 'التنقل الرئيسي' : 'Primary navigation'}
            className="hidden items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-400 md:flex"
          >
            <a
              href="#capabilities"
              className="shrink-0 whitespace-nowrap underline-offset-8 transition-colors hover:text-slate-900 hover:underline dark:hover:text-slate-100"
            >
              {isRtl ? 'القدرات' : 'Capabilities'}
            </a>
            <a
              href="#pricing"
              className="shrink-0 whitespace-nowrap underline-offset-8 transition-colors hover:text-slate-900 hover:underline dark:hover:text-slate-100"
            >
              {isRtl ? 'الباقات' : 'Pricing'}
            </a>
            <Link
              href={`/${locale}/venue`}
              className="shrink-0 whitespace-nowrap underline-offset-8 transition-colors hover:text-slate-900 hover:underline dark:hover:text-slate-100"
            >
              {isRtl ? 'بوابة حجز الصالة' : 'Venue Booking'}
            </Link>
            <Link
              href={`/${locale}/dashboard`}
              className="shrink-0 whitespace-nowrap underline-offset-8 transition-colors hover:text-slate-900 hover:underline dark:hover:text-slate-100"
            >
              {isRtl ? 'لوحة التحكم ERP' : 'Live ERP'}
            </Link>
            <Link
              href={`/${altLocale}`}
              className="shrink-0 whitespace-nowrap underline-offset-8 transition-colors hover:text-slate-900 hover:underline dark:hover:text-slate-100"
            >
              {isRtl ? 'English' : 'العربية'}
            </Link>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => scrollToProvision()}
              className="min-h-[40px] shrink-0 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#070B14]"
            >
              {isRtl ? 'أنشئ منصة صالتك' : 'Create Venue Portal'}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* HERO SECTION — Asymmetric 2-Column Split + Full-Width Proof Strip */}
        <section className="mx-auto max-w-[1280px] px-6 pb-16 pt-12 lg:pb-24 lg:pt-16">
          <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12 lg:gap-12">
            {/* Editorial Proposition Column */}
            <div className="flex flex-col justify-between lg:col-span-5">
              <div className="space-y-6">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{isRtl ? 'نظام سحابي متعدد الصالات' : 'Multi-Tenant Venue & Conference ERP'}</span>
                  <span aria-hidden="true" className="mx-2">
                    ·
                  </span>
                  <span>{isRtl ? 'عربي RTL وإنجليزي' : 'Bilingual Arabic RTL & English'}</span>
                </p>

                <h1
                  className="max-w-xl font-bold leading-[1.12] tracking-tight text-slate-900 dark:text-slate-100"
                  style={{
                    fontSize: 'clamp(2.25rem, 4vw, 3.5rem)',
                    textWrap: 'balance',
                  }}
                >
                  {isRtl
                    ? 'نظام متكامل لحجوزات القاعات، المخططات التفاعلية، والمحاسبة المزدوجة'
                    : 'Unified Venue Scheduling, Floor Plans, and Double-Entry Finance'}
                </h1>

                <p className="max-w-lg text-[15px] leading-relaxed text-slate-600 dark:text-slate-400 sm:text-base">
                  {isRtl
                    ? 'أدِر حجوزات صالات الأفراح ومراكز المؤتمرات من نطاقك الخاص. امنع تضارب المواعيد بفترات التجهيز التلقائية، امنح عملاءك بوابة تفاعلية لتوزيع الطاولات والاعتمادات، واربط كل دفعة بدليل الحسابات مباشرة.'
                    : 'Run wedding palaces, banquet halls, and conference centers under your own subdomain. Prevent double-bookings with automated cleaning buffers, hand clients an interactive seating portal, and post every payment into a balanced general ledger.'}
                </p>

                <div className="flex flex-wrap items-center gap-5 pt-2">
                  <button
                    type="button"
                    onClick={() => scrollToProvision('PRO')}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#070B14]"
                  >
                    <span>{isRtl ? 'تفعيل نطاق الصالة الآن' : 'Provision Your Subdomain'}</span>
                    <DirectionArrow className="h-4 w-4" />
                  </button>

                  <Link
                    href={`/${locale}/dashboard`}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-slate-700 underline-offset-4 transition-colors hover:text-slate-950 hover:underline dark:text-slate-300 dark:hover:text-white"
                  >
                    <span>{isRtl ? 'استعراض تقويم التشغيل المباشر' : 'Explore Live ERP Calendar'}</span>
                  </Link>
                </div>
              </div>

              {/* Quiet Utility Controls (Language on mobile + Theme toggle) */}
              <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-slate-200 pt-5 text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
                <span>
                  {isRtl ? 'نطاق جاهز خلال 3 دقائق' : 'Dedicated workspace live in 3 minutes'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{isRtl ? 'يدعم YER و SAR و USD' : 'Supports YER, SAR & USD'}</span>
                {mounted && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                      className="inline-flex items-center gap-1.5 font-medium text-slate-700 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                    >
                      {resolvedTheme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                      <span>{resolvedTheme === 'dark' ? (isRtl ? 'الوضع النهاري' : 'Light') : isRtl ? 'الوضع الليلي' : 'Dark'}</span>
                    </button>
                  </>
                )}
                <Link
                  href={`/${altLocale}`}
                  className="font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-300 md:hidden"
                >
                  {isRtl ? 'English' : 'العربية'}
                </Link>
              </div>
            </div>

            {/* Dominant Visual Carrier (16:9 Architectural Ballroom Photograph) */}
            <div className="lg:col-span-7">
              <div className="relative h-full min-h-[340px] overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800 lg:min-h-[460px]">
                {!heroImgError ? (
                  <img
                    src="/images/hero_grand_ballroom.jpg"
                    alt={
                      isRtl
                        ? 'قاعة الماسة الكبرى مجهزة لحفل عشاء رسمي بإضاءة ذهبية وموائد ضيافة فاخرة'
                        : 'Grand ballroom interior set for a formal gala with champagne gold chandeliers and banquet seating'
                    }
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgError(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[340px] w-full flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950/50 p-8 text-center">
                    <span className="text-lg font-semibold text-amber-300">
                      {isRtl ? 'قصر الماسة للمؤتمرات والأفراح' : 'Al-Massa Grand Palace'}
                    </span>
                    <span className="mt-1 text-xs text-slate-400">
                      {isRtl ? 'قاعة الماسة الكبرى — 800 ضيف' : 'Grand Diamond Hall — 800 Capacity'}
                    </span>
                  </div>
                )}

                {/* Measured Dark Scrim for High-Contrast Venue Snapshot */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-6 pb-5 pt-16 text-white">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="text-xs text-amber-300/95">
                        {isRtl ? 'بيئة تشغيل حية · قصر الماسة' : 'Live Production Tenant · Al-Massa Grand Palace'}
                      </div>
                      <div className="mt-1 text-base font-semibold text-white">
                        {isRtl ? 'قاعة الماسة الكبرى + قاعة الياسمين الملكية' : 'Grand Diamond Hall + Royal Jasmine Hall'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-slate-200">
                      <span>{isRtl ? 'سعة 800 ضيف' : '800 theater seats'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{isRtl ? 'فترة تجهيز 120د' : '120m buffer'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{isRtl ? 'حجز مؤقت 48س' : '48h auto-hold'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4-Column Quantitative Proof Strip Below Hero Split */}
          <div className="mt-10 grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="px-6 py-5">
              <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">0</div>
              <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                {isRtl ? 'تضارب في الحجوزات' : 'Double-Booking Conflicts'}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'تحقق تلقائي من فترات التنظيف والدمج' : 'Enforced cleaning buffers & hall partitions'}
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">48h</div>
              <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                {isRtl ? 'دورة الحجز المؤقت الآلية' : 'Automated Hold Window'}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'تنبيه دفع 50% ثم تحرير القاعة تلقائياً' : '50% deposit alerts & automatic slot release'}
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">8</div>
              <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                {isRtl ? 'حسابات ضيافة تؤسس فوراً' : 'Seeded Ledger Accounts'}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'الصندوق، المحافظ، الضريبة، وتأمين الأضرار' : 'Cash, e-wallets, VAT & refundable deposits'}
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">72h</div>
              <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                {isRtl ? 'قفل طلبات البوفيه والمطبخ' : 'Kitchen BEO Lock Cutoff'}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'أوامر تشغيل دقيقة لعدد الضيوف والمواد' : 'Locks catering counts & BOM before event day'}
              </div>
            </div>
          </div>
        </section>

        {/* CAPABILITIES SECTION — Asymmetric 12-Column Editorial Bento Grid */}
        <section
          id="capabilities"
          className="border-t border-slate-200 bg-white py-20 dark:border-slate-800/80 dark:bg-[#0B1120]"
        >
          <div className="mx-auto max-w-[1280px] px-6">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                {isRtl ? 'البنية التشغيلية للمنصة' : 'Operational Architecture'}
              </p>
              <h2
                className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl"
                style={{ textWrap: 'balance' }}
              >
                {isRtl
                  ? 'أربع منظومات مترابطة تدير دورة الفعالية من الاستفسار حتى إغلاق القيد المالي'
                  : 'Four connected engines covering every event from first hold to final ledger close'}
              </h2>
            </div>

            {/* Asymmetric Bento Grid (7+5, then 5+7) */}
            <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* 01. Large Feature with Conference Hall Visual */}
              <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-7">
                <div className="p-7">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {isRtl ? 'الجدولة ومنع التضارب' : 'Availability & Dynamic Pricing'}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? '01. تقويم القاعات المدمجة والتسعير الذكي' : '01. Partition-Merge Scheduling & Dynamic Quotes'}
                  </h3>
                  <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'اربط القاعات القابلة للفتح معاً لمنع حجز أي جزء متعارض، طبّق معاملات ذروة نهاية الأسبوع (+20%) تلقائياً، وراقب فترات التنظيف والتجهيز (90–120 دقيقة) مباشرة على التقويم التشغيلي.'
                      : 'Link combinable halls so adjacent bookings never collide, apply weekend and peak multipliers automatically, and visualize turnaround buffers (90–120 minutes) across Month, Week, and Agenda views.'}
                  </p>
                </div>
                <div className="aspect-[16/9] w-full overflow-hidden border-t border-slate-200 dark:border-slate-800">
                  {!confImgError ? (
                    <img
                      src="/images/venue_conference_hall.jpg"
                      alt={
                        isRtl
                          ? 'قاعة مؤتمرات حديثة بمدرجات منظمة وإضاءة معمارية دافئة'
                          : 'Modern executive conference hall with acoustic walnut paneling and theater seating'
                      }
                      referrerPolicy="no-referrer"
                      onError={() => setConfImgError(true)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                      {isRtl ? 'قاعة المؤتمرات التنفيذية' : 'Executive Conference Auditorium'}
                    </div>
                  )}
                </div>
              </article>

              {/* 02. Double-Entry Finance Card */}
              <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-7 dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-5">
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {isRtl ? 'النظام المالي والمحاسبي' : 'Double-Entry Accounting'}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? '02. محاسبة قيد مزدوج جاهزة لكل صالة' : '02. Automated Hospitality Ledger & Refund Vault'}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'بمجرد إنشاء نطاق الصالة، يبني النظام دليل حسابات مخصصاً يعزل تأمينات الأضرار المستردة عن الإيرادات والضريبة، ويوثق دفعات الكريمي وجيب وجوالي والتحويلات البنكية.'
                      : 'Every new tenant starts with a pre-configured Chart of Accounts that separates refundable damage deposits from hall and catering revenue, while tracking Kuraimi, Jaib, Jawali, OneCash, and IBAN payouts.'}
                  </p>
                </div>

                {/* Clean Ledger Preview Table (Tabular Figures, Hairline Dividers, Zero Pills) */}
                <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <span>{isRtl ? 'الحساب' : 'Ledger Account'}</span>
                    <span>{isRtl ? 'التصنيف' : 'Type'}</span>
                  </div>
                  <div className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                    {[
                      { code: '1020', ar: 'البنك والمحافظ الإلكترونية', en: 'Bank & E-Wallets', typeAr: 'أصول', typeEn: 'Asset' },
                      { code: '2100', ar: 'تأمينات الأضرار المستردة', en: 'Refundable Deposits', typeAr: 'التزامات', typeEn: 'Liability' },
                      { code: '4000', ar: 'إيرادات تأجير القاعات', en: 'Hall Rental Revenue', typeAr: 'إيرادات', typeEn: 'Revenue' },
                      { code: '4100', ar: 'إيرادات الضيافة والبوفيه', en: 'Catering Revenue', typeAr: 'إيرادات', typeEn: 'Revenue' },
                    ].map((row) => (
                      <div key={row.code} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="font-mono text-[11px] tabular-nums text-amber-700 dark:text-[#D4AF37]">
                            {row.code}
                          </span>
                          <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                            {isRtl ? row.ar : row.en}
                          </span>
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                          {isRtl ? row.typeAr : row.typeEn}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              {/* 03. Client Control Panel & Delegation */}
              <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-7 dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-5">
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {isRtl ? 'بوابة العميل والاعتمادات' : 'Client Portal & Approvals'}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? '03. تفويض المنظمين وسجل التدقيق غير القابل للتعديل' : '03. Planner Delegation & Immutable Audit Trail'}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'يفوّض العميل الأساسي منسق الحفل لتعديل مخطط الطاولات أو طلب إضافات مدفوعة دون كشف الفواتير، مع تحويل كل تعديل لمسودة رسمية تتطلب موافقة صريحة موثقة بالوقت.'
                      : 'Primary clients grant wedding planners or co-hosts scoped access to edit floor plans and request add-ons while hiding billing totals. Every revision enters an approval queue with timestamped audit logs.'}
                  </p>
                </div>

                <dl className="mt-6 divide-y divide-slate-200 border-t border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'ملفات B2C و B2B' : 'B2C & Corporate B2B'}</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {isRtl ? 'الهوية، السجل التجاري، والرقم الضريبي' : 'National ID, CR & VAT invoicing'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'المصادقة الثنائية' : '2FA OTP Security'}</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {isRtl ? 'دخول آمن عبر واتساب ورسائل SMS' : 'SMS & WhatsApp one-time login codes'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'حوكمة الإضافات' : 'Add-On Governance'}</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {isRtl ? 'تحديث تلقائي للفاتورة بعد الاعتماد' : 'Auto-syncs invoice delta on sign-off'}
                    </dd>
                  </div>
                </dl>
              </article>

              {/* 04. Banquet Operations & Offline Gate with Editorial Dining Visual */}
              <article className="grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60 sm:grid-cols-2 lg:col-span-7">
                <div className="flex flex-col justify-between p-7">
                  <div>
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {isRtl ? 'التشغيل الميداني والبوابة' : 'Banquet Ops & Gate Security'}
                    </div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? '04. أوامر تشغيل المطبخ وبوابة QR الأوفلاين' : '04. Live Kitchen BEO & Offline QR Gate'}
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {isRtl
                        ? 'يحصل الشيف وفريق الضيافة على جدول كميات دقيق قبل الفعالية بـ 72 ساعة، بينما يمسح فريق الأمن بطاقات QR لكبار الشخصيات والمدعوين حتى عند انقطاع الإنترنت.'
                        : 'Chefs and banquet teams receive locked guest counts and recipe BOMs 72 hours out, while security gates scan VIP QR passes cleanly even during local internet outages.'}
                    </p>
                  </div>

                  <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                    <Link
                      href={`/${locale}/portal/dashboard`}
                      className="inline-flex items-center gap-1.5 font-semibold text-slate-900 underline-offset-4 hover:underline dark:text-slate-100"
                    >
                      <span>{isRtl ? 'استكشف لوحة تحكم العميل' : 'Inspect Client Control Panel'}</span>
                      <DirectionArrow className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>

                <div className="min-h-[240px] overflow-hidden border-t border-slate-200 sm:border-s sm:border-t-0 dark:border-slate-800">
                  {!banquetImgError ? (
                    <img
                      src="/images/venue_banquet_table.jpg"
                      alt={
                        isRtl
                          ? 'تجهيز طاولة ضيافة فاخرة بأدوات مائدة ذهبية وإضاءة شموع'
                          : 'Formal gala banquet table setting with obsidian linen and brushed champagne gold cutlery'
                      }
                      referrerPolicy="no-referrer"
                      onError={() => setBanquetImgError(true)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                      {isRtl ? 'ضيافة الماسة الملكية' : 'Royal Banquet Operations'}
                    </div>
                  )}
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* CASE STUDY PROOF — Adjacent to Capabilities & Above Pricing */}
        <section id="proof" className="border-t border-slate-200 bg-slate-50 py-16 dark:border-slate-800/80 dark:bg-[#070B14]">
          <div className="mx-auto max-w-[1280px] px-6">
            <div className="grid grid-cols-1 items-center gap-10 rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900/70 lg:grid-cols-12 lg:p-10">
              <div className="space-y-4 lg:col-span-7">
                <div className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                  {isRtl ? 'دراسة حالة تشغيلية · صنعاء' : 'Production Case Study · Sanaa'}
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {isRtl
                    ? 'كيف أدار قصر الماسة للمؤتمرات 3 قاعات مترابطة دون أي تضارب أو خطأ محاسبي'
                    : 'How Al-Massa Grand Palace unified 3 halls and eliminated manual reconciliation'}
                </h2>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {isRtl
                    ? 'قبل الانتقال إلى إيفنت ليدجر، كانت المبيعات تدير الحجوزات المؤقتة عبر جداول منفصلة وتستغرق 6 أيام لمتابعة دفعة التأكيد. بعد تفعيل الحجز المؤقت الآلي وربط القيود المزدوجة، انخفض زمن تأكيد الحجز إلى 19 ساعة وأصبح كل تعديل في عدد الضيوف ينعكس فوراً في المطبخ والحسابات.'
                    : 'Before moving to EventLedger, sales tracked 48-hour holds on spreadsheets and averaged 6 days to verify 50% confirmation deposits. With automated hold expiries and direct double-entry posting, confirmation turnaround dropped to 19 hours with zero reconciliation discrepancies.'}
                </p>
                <div className="pt-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'أ. طارق المنصور' : 'Tariq Al-Mansoor'}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {isRtl ? 'المدير العام، قصر الماسة للمؤتمرات والأفراح' : 'General Manager, Al-Massa Grand Palace'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 divide-y divide-slate-200 border-t border-slate-200 pt-6 lg:col-span-5 lg:border-s lg:border-t-0 lg:ps-8 lg:pt-0 dark:divide-slate-800 dark:border-slate-800">
                <div className="py-3.5 first:pt-0">
                  <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    6d → 19h
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'متوسط زمن تحويل الحجز المؤقت إلى مؤكد' : 'Average hold-to-deposit confirmation time'}
                  </div>
                </div>
                <div className="py-3.5">
                  <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    1,470
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'إجمالي السعة الاستيعابية المدارة عبر 3 قاعات' : 'Combined theater seats managed across 3 halls'}
                  </div>
                </div>
                <div className="pt-4">
                  <Link
                    href={`/${locale}/dashboard`}
                    className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap text-xs font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-[#D4AF37]"
                  >
                    <span>{isRtl ? 'افتح جدول حجوزات قصر الماسة المباشر' : 'Open Al-Massa Live Schedule Dashboard'}</span>
                    <DirectionArrow className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING TIERS — Named by Target Audience + Concrete Limits + Billing Toggle Inside Section */}
        <section
          id="pricing"
          className="border-t border-slate-200 bg-white py-20 dark:border-slate-800/80 dark:bg-[#0B1120]"
        >
          <div className="mx-auto max-w-[1280px] px-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-xl space-y-2">
                <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                  {isRtl ? 'باقات الاشتراك الواضحة' : 'Transparent Subscription Tiers'}
                </p>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
                  {isRtl ? 'اختر الباقة المناسبة لحجم صالتك' : 'Built to scale from one hall to multi-venue groups'}
                </h2>
              </div>

              {/* Controls: Currency & Billing Cadence (Placed in Section Toolbar, Never in Top Bar) */}
              <div className="flex flex-wrap items-center gap-3">
                <div
                  role="group"
                  aria-label={isRtl ? 'دورة الفوترة' : 'Billing cadence'}
                  className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950"
                >
                  <button
                    type="button"
                    onClick={() => setAnnualBilling(false)}
                    className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      !annualBilling
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {isRtl ? 'شهري' : 'Monthly'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnualBilling(true)}
                    className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      annualBilling
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {isRtl ? 'سنوي (وفر 20%)' : 'Annual (Save 20%)'}
                  </button>
                </div>

                <select
                  aria-label={isRtl ? 'عملة العرض' : 'Display currency'}
                  value={form.currency}
                  onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value as CurrencyCode }))}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="YER">YER</option>
                  <option value="SAR">SAR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {PLANS.map((plan) => {
                const isSelected = form.subscription_tier === plan.code;
                const price = formatTierPrice(plan.monthlyUsd, form.currency, annualBilling, locale);
                return (
                  <div
                    key={plan.code}
                    className={`flex flex-col justify-between rounded-xl border p-7 transition-colors ${
                      isSelected
                        ? 'border-[var(--brand-primary,#D4AF37)] bg-amber-50/30 dark:bg-slate-900'
                        : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-500 dark:text-slate-400">
                          {isRtl ? plan.audienceAr : plan.audienceEn}
                        </span>
                        {plan.recommended && (
                          <span className="font-semibold text-amber-700 dark:text-[#D4AF37]">
                            {isRtl ? 'الأكثر اختياراً' : 'Most Popular'}
                          </span>
                        )}
                      </div>

                      <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">
                        {isRtl ? plan.nameAr : plan.nameEn}
                      </h3>

                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className="font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {price}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {isRtl ? '/ شهرياً' : '/ month'}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                        {isRtl ? plan.summaryAr : plan.summaryEn}
                      </p>

                      <ul className="mt-6 space-y-3 border-t border-slate-200 pt-5 text-xs text-slate-700 dark:border-slate-800 dark:text-slate-300">
                        {(isRtl ? plan.limitsAr : plan.limitsEn).map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2.5">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-[#D4AF37]" />
                            <span className="leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() => scrollToProvision(plan.code)}
                      className={`mt-8 min-h-[42px] w-full whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] ${
                        isSelected
                          ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950 hover:opacity-90'
                          : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {isSelected
                        ? isRtl
                          ? 'الباقة المختارة — تابع التفعيل'
                          : 'Selected — Continue Below'
                        : isRtl
                        ? `اختر ${plan.nameAr}`
                        : `Select ${plan.nameEn}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* INSTANT SELF-ONBOARDING / SUBDOMAIN PROVISIONING */}
        <section id="provision" className="border-t border-slate-200 bg-slate-50 py-20 dark:border-slate-800/80 dark:bg-[#070B14]">
          <div className="mx-auto max-w-[1280px] px-6">
            <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12">
              {/* Provisioning Checklist Column */}
              <div className="space-y-6 lg:col-span-5">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                    {isRtl ? 'التشغيل الفوري للنظام' : 'Instant Tenant Provisioning'}
                  </p>
                  <h2
                    className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl"
                    style={{ textWrap: 'balance' }}
                  >
                    {isRtl ? 'أنشئ نطاق صالتك وابدأ استقبال الحجوزات اليوم' : 'Launch your dedicated venue workspace in one step'}
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'بمجرد تأكيد البيانات، يجهز النظام قاعدة بيانات معزولة تماماً لصالتك مع دليل الحسابات الافتراضي وصلاحية المالك.'
                      : 'Submitting this form provisions an isolated tenant workspace, seeds your hospitality accounting chart, and creates your Owner staff account automatically.'}
                  </p>
                </div>

                <ol className="divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
                  {[
                    {
                      num: '01.',
                      titleAr: 'نطاق فرعي مخصص باسم الصالة',
                      titleEn: 'Dedicated venue subdomain',
                      descAr: 'رابط مباشر لفريق التشغيل وبوابة العملاء.',
                      descEn: 'Branded URL for internal ERP staff and your clients.',
                    },
                    {
                      num: '02.',
                      titleAr: 'تأسيس دليل الحسابات المزدوج (8 حسابات)',
                      titleEn: 'Pre-seeded 8-account ledger',
                      descAr: 'الصندوق، المحافظ الإلكترونية، الإيرادات، والضريبة جاهزة للترحيل.',
                      descEn: 'Cash, e-wallets, hall/catering revenue, VAT, and deposits ready.',
                    },
                    {
                      num: '03.',
                      titleAr: 'حساب المالك وإعدادات القفل الافتراضية',
                      titleEn: 'Owner access & default operational locks',
                      descAr: 'حجز مؤقت 48 ساعة، قفل المخطط 24 ساعة، وقفل الضيافة 72 ساعة.',
                      descEn: '48h hold expiry, 24h floor plan lock, and 72h catering cutoff.',
                    },
                  ].map((step) => (
                    <li key={step.num} className="py-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        <span className="me-2 font-mono text-xs text-amber-700 dark:text-[#D4AF37]">{step.num}</span>
                        {isRtl ? step.titleAr : step.titleEn}
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {isRtl ? step.descAr : step.descEn}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Interactive Onboarding Form Column */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 sm:p-8 lg:col-span-7">
                {provisioned ? (
                  <div className="space-y-6 py-4">
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {isRtl ? 'تم التفعيل بنجاح' : 'Workspace Provisioned'}
                      </p>
                      <h3 className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {provisioned.venue_name}
                      </h3>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        {isRtl
                          ? 'تم إنشاء النطاق الفرعي وتأسيس دليل الحسابات المزدوج وحساب المالك بنجاح.'
                          : 'Your subdomain, default 8-account hospitality ledger, and Owner account are ready.'}
                      </p>
                    </div>

                    <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50 px-4 text-xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex items-center justify-between py-3">
                        <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'رابط المنصة' : 'Workspace URL'}</dt>
                        <dd className="font-mono font-medium text-slate-900 dark:text-slate-100" dir="ltr">
                          {provisioned.workspace_url}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-3">
                        <dt className="text-slate-500 dark:text-slate-400">{isRtl ? 'الباقة المفعّلة' : 'Subscription Tier'}</dt>
                        <dd className="font-mono font-medium text-amber-700 dark:text-[#D4AF37]">
                          {provisioned.subscription_tier}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/${locale}/dashboard`}
                        className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-2.5 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90"
                      >
                        <span>{isRtl ? 'الدخول إلى لوحة التشغيل والتقويم' : 'Open ERP Operations Dashboard'}</span>
                        <DirectionArrow className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setProvisioned(null);
                          setForm((prev) => ({ ...prev, venue_name: '', slug: '' }));
                        }}
                        className="min-h-[44px] whitespace-nowrap rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {isRtl ? 'تسجيل صالة أخرى' : 'Register Another Venue'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4 dark:border-slate-800">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {isRtl ? 'بيانات الصالة والحساب الرئيسي' : 'Venue & Owner Details'}
                      </h3>
                      <span className="font-mono text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                        {form.subscription_tier}
                      </span>
                    </div>

                    {errorMsg && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200">
                        {errorMsg}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'اسم الصالة أو المركز' : 'Venue or Palace Name'}
                        </span>
                        <input
                          required
                          type="text"
                          value={form.venue_name}
                          onChange={(e) => setForm((prev) => ({ ...prev, venue_name: e.target.value }))}
                          placeholder={isRtl ? 'قصر الماسة للمؤتمرات والأفراح' : 'Al-Massa Grand Palace'}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'النطاق الفرعي (Subdomain)' : 'Subdomain Slug'}
                        </span>
                        <div
                          dir="ltr"
                          className="flex h-11 items-center overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950"
                        >
                          <input
                            required
                            type="text"
                            value={form.slug}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                              }))
                            }
                            placeholder="almassa"
                            className="h-full w-full bg-transparent px-3.5 font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
                          />
                          <span className="flex h-full items-center border-s border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                            .{rootDomain}
                          </span>
                        </div>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'اسم المالك أو المدير' : 'Owner Full Name'}
                        </span>
                        <input
                          required
                          type="text"
                          value={form.owner_name}
                          onChange={(e) => setForm((prev) => ({ ...prev, owner_name: e.target.value }))}
                          placeholder={isRtl ? 'أ. طارق المنصور' : 'Tariq Al-Mansoor'}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'رقم الجوال (واتساب / OTP)' : 'Mobile Phone (WhatsApp / OTP)'}
                        </span>
                        <input
                          required
                          type="tel"
                          dir="ltr"
                          value={form.owner_phone}
                          onChange={(e) => setForm((prev) => ({ ...prev, owner_phone: e.target.value }))}
                          placeholder="+967770000001"
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <label className="block space-y-1.5 sm:col-span-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'الباقة' : 'Plan'}
                        </span>
                        <select
                          value={form.subscription_tier}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, subscription_tier: e.target.value as PlanCode }))
                          }
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="BASIC">{isRtl ? 'الأساسية (Basic)' : 'Basic'}</option>
                          <option value="PRO">{isRtl ? 'الاحترافية (Pro)' : 'Pro'}</option>
                          <option value="ENTERPRISE">{isRtl ? 'المؤسسات (Enterprise)' : 'Enterprise'}</option>
                        </select>
                      </label>

                      <label className="block space-y-1.5 sm:col-span-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'العملة الافتراضية' : 'Currency'}
                        </span>
                        <select
                          value={form.currency}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, currency: e.target.value as CurrencyCode }))
                          }
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="YER">YER</option>
                          <option value="SAR">SAR</option>
                          <option value="USD">USD</option>
                        </select>
                      </label>

                      <label className="block space-y-1.5 sm:col-span-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {isRtl ? 'البريد (اختياري)' : 'Email (Optional)'}
                        </span>
                        <input
                          type="email"
                          dir="ltr"
                          value={form.owner_email}
                          onChange={(e) => setForm((prev) => ({ ...prev, owner_email: e.target.value }))}
                          placeholder="owner@venue.ye"
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </label>
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <span>
                          {submitting
                            ? isRtl
                              ? 'جاري تأسيس مساحة الصالة...'
                              : 'Provisioning Workspace...'
                            : isRtl
                            ? 'إنشاء النطاق وتفعيل المنصة'
                            : 'Create Workspace Now'}
                        </span>
                        {!submitting && <DirectionArrow className="h-4 w-4" />}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Architectural Footer */}
      <footer className="border-t border-slate-200 bg-white dark:border-slate-800/80 dark:bg-[#0B1120]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-6 py-8 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'إيفنت ليدجر' : 'EventLedger'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{isRtl ? 'نظام سحابي متكامل للقاعات والمؤتمرات' : 'Venue & Conference Operations ERP'}</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <a href="#capabilities" className="hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'القدرات' : 'Capabilities'}
            </a>
            <a href="#pricing" className="hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'الباقات' : 'Pricing'}
            </a>
            <Link href={`/${locale}/dashboard`} className="hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'لوحة التشغيل' : 'ERP Dashboard'}
            </Link>
            <Link href={`/${locale}/portal/dashboard`} className="hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'بوابة العميل' : 'Client Portal'}
            </Link>
            <Link href={`/${altLocale}`} className="hover:text-slate-900 dark:hover:text-slate-100">
              {isRtl ? 'English' : 'العربية'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
