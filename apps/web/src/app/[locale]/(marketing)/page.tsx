'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  FileSignature,
  Lock,
  QrCode,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import ThreeMonthBookingEngine from '@/components/booking/ThreeMonthBookingEngine';
import { AppHeader } from '@/components/layout/AppHeader';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ApiError, apiFetch, tenantPath } from '@/lib/api';

interface PublicDirectoryTenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  halls_count: number;
  branding: {
    primaryColor?: string;
    accentColor?: string;
    logoLightUrl?: string | null;
    logoDarkUrl?: string | null;
    heroTaglineAr?: string | null;
    heroTaglineEn?: string | null;
  };
}

interface VerifyResponse {
  valid: boolean;
  document_type: 'INVOICE' | 'CONTRACT' | 'GATE_PASS';
  number?: string;
  status?: string;
  total_amount?: number;
  pass_type?: string;
  holder_name?: string;
  tenant?: { name?: string; slug?: string };
}

export default function SaasMarketingLandingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [tenants, setTenants] = useState<PublicDirectoryTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);

  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<{ tenants: PublicDirectoryTenant[] }>('/api/v1/public/tenants', { skipAuth: true })
      .then((res) => {
        if (alive) setTenants(res.tenants || []);
      })
      .catch(() => {
        if (alive) setTenants([]);
      })
      .finally(() => {
        if (alive) setTenantsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = verifyCode.trim();
    if (!clean) return;
    setVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      const res = await apiFetch<VerifyResponse>(`/api/v1/public/verify/${encodeURIComponent(clean)}`, {
        skipAuth: true,
      });
      setVerifyResult(res);
    } catch (err) {
      setVerifyError(
        err instanceof ApiError && err.status === 404
          ? tr('الرمز غير موجود أو غير صالح.', 'Document code not recognized.')
          : err instanceof Error
            ? err.message
            : 'Verification failed'
      );
    } finally {
      setVerifying(false);
    }
  };

  const experiences = [
    {
      img: '/images/hero_grand_ballroom.jpg',
      title: tr('حفلات الزفاف والاستقبال الملكية', 'Royal Weddings & Receptions'),
      desc: tr(
        'قاعات فاخرة قابلة للدمج، كوشات مصممة حسب الطلب، وبوفيهات ضيافة متكاملة مع بطاقات دخول QR لكبار الشخصيات.',
        'Grand partitionable ballrooms, custom stage layouts, curated catering menus, and VIP QR guest invitations.'
      ),
    },
    {
      img: '/images/venue_conference_hall.jpg',
      title: tr('المؤتمرات والقمم المؤسسية', 'Corporate Summits & Conferences'),
      desc: tr(
        'تجهيزات صوت ومرئيات احترافية، فواتير ضريبية B2B، وتنسيق فترات صباحية ومسائية مع هوامش تجهيز مضمونة.',
        'Enterprise AV setups, B2B tax-compliant invoicing, and morning/evening conference slots with guaranteed buffer times.'
      ),
    },
    {
      img: '/images/venue_banquet_table.jpg',
      title: tr('حفلات التخرج ومآدب العشاء', 'Graduation & Gala Dinners'),
      desc: tr(
        'مخططات طاولات تفاعلية، تفويض منسقي الحفل بصلاحيات محددة، ومتابعة حية لكل دفعة وتأمين.',
        'Interactive Konva table seating, delegated planner workflows with dual approval, and transparent milestone billing.'
      ),
    },
  ];

  const journeySteps = [
    {
      num: '01',
      title: tr('افحص التوفر لـ 90 يوماً مباشرة', 'Check 90-Day Live Hall Availability'),
      desc: tr(
        'اختر القاعة والتاريخ والفترة الصباحية أو المسائية مع ظهور السعر الفوري حسب الموسم.',
        'Pick your venue, hall, and morning/evening slot with transparent seasonal pricing multipliers.'
      ),
    },
    {
      num: '02',
      title: tr('خصّص الضيافة والديكور ومخطط القاعة', 'Customize Catering, Decor & Floor Plan'),
      desc: tr(
        'أضف قوائم الضيافة والتجهيزات وصمّم توزيع الطاولات والكوشة في بوابة العميل.',
        'Select catering packages, decor add-ons, and arrange tables on the interactive Konva floor plan.'
      ),
    },
    {
      num: '03',
      title: tr('ثبّت بحجز 48 ساعة أو ادفع وأصدر QR', '48h Hold or Instant Deposit & VIP QR Passes'),
      desc: tr(
        'احجز فوراً لمدة 48 ساعة أو ارفع إيصال العربون، ووقّع عقدك إلكترونياً وأصدر تصاريح الضيوف.',
        'Lock a 48-hour hold or submit deposit immediately, e-sign your contract, and generate guest QR gate passes.'
      ),
    },
  ];

  const guarantees = [
    {
      icon: Lock,
      title: tr('حماية من تضارب الحجوزات', 'Zero Double-Booking Lock'),
      desc: tr(
        'منع تلقائي لتداخل القاعات المدمجة وهوامش التنظيف بين المناسبات.',
        'Partition-aware locking and automated cleaning buffers prevent any schedule overlap.'
      ),
    },
    {
      icon: ShieldCheck,
      title: tr('خزينة التأمين المسترد', 'Refundable Security Deposit Vault'),
      desc: tr(
        'عزل مبلغ التأمين في حساب التزامات مستقل يُسترد بعد فحص القاعة.',
        'Security deposits are segregated in an escrow liability account until post-event inspection.'
      ),
    },
    {
      icon: FileSignature,
      title: tr('عقود وفواتير ثنائية اللغة', 'Instant Bilingual Contracts & Invoices'),
      desc: tr(
        'توقيع رقمي موثق وفواتير PDF عربية وإنجليزية قابلة للتحقق الفوري.',
        'Digital e-signatures and verifiable Arabic/English PDF invoices issued on booking.'
      ),
    },
    {
      icon: QrCode,
      title: tr('تصاريح دخول QR للضيوف', 'Mobile QR Gate Passes'),
      desc: tr(
        'بطاقات دخول ذكية للضيوف وكبار الشخصيات والموردين عبر البوابة الأمنية.',
        'Instant scannable QR entry passes for VIPs, guests, and event vendors.'
      ),
    },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} title={tr('إيفنت ليدجر', 'EventLedger')} />

      <main className="mx-auto max-w-7xl space-y-20 px-4 py-12 sm:px-6">
        {/* Hero Section + Public Document / QR Verification */}
        <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div className="space-y-6 text-start">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1 text-xs font-bold text-amber-500 dark:text-amber-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{tr('احجز قاعتك عبر أرقى المنشآت المسجلة', 'Instant Multi-Venue Availability & Reservation')}</span>
            </span>

            <SpotlightHeading as="h1" className="text-start text-3xl leading-tight sm:text-5xl">
              {tr('منصة حجز قاعات الأفراح والمؤتمرات الفاخرة', 'Discover & Reserve Premier Wedding Halls & Conference Venues')}
            </SpotlightHeading>

            <p className="text-start text-sm text-slate-600 dark:text-slate-400 sm:text-base">
              {tr(
                'استعرض التوفر الفوري لثلاثة أشهر عبر جميع القاعات المسجلة، احسب التكلفة بالضيافة والتجهيزات، وثبّت حجزك المبدئي خلال ثوانٍ.',
                'Browse 3 months of live availability across all registered venues, calculate catering and decor packages, and lock a 48-hour hold in seconds.'
              )}
            </p>

            <div className="flex flex-wrap gap-3">
              <a
                href="#booking-calendar"
                className="inline-flex min-h-[44px] items-center rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:opacity-90"
              >
                {tr('تصفح تقويم الحجز لثلاثة أشهر', 'Browse 3-Month Booking Calendar')}
              </a>
              <a
                href="#venues"
                className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {tr('استكشاف القاعات النشطة', 'Explore Active Venues')}
              </a>
            </div>
          </div>

          <div className="space-y-4">
            <SpotlightCard className="overflow-hidden p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero_grand_ballroom.jpg"
                alt="EventLedger Grand Ballroom"
                className="h-[260px] w-full rounded-lg object-cover"
              />
            </SpotlightCard>

            {/* Public Document / Invoice / Gate Pass Verification Widget */}
            <SpotlightCard className="space-y-3 text-start">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Shield className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                <span>
                  {tr('التحقق العام من الفواتير والعقود وتصاريح الدخول (QR)', 'Public Document, Invoice & Gate Pass Verification')}
                </span>
              </div>
              <form onSubmit={handleVerify} className="flex flex-col gap-2 sm:flex-row">
                <input
                  dir="ltr"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="INV-EVT-... / CTR-EVT-... / QR Token"
                  className="min-h-[42px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="submit"
                  disabled={verifying || !verifyCode.trim()}
                  className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>{verifying ? tr('جارٍ التحقق...', 'Verifying...') : tr('تحقق', 'Verify')}</span>
                </button>
              </form>

              {verifyError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-500 dark:text-rose-300">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verifyResult && (
                <div className="space-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                  <div className="flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      {verifyResult.document_type} — {verifyResult.number || verifyResult.holder_name || 'VALID'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    {verifyResult.tenant?.name && (
                      <span>
                        {tr('المنشأة:', 'Venue:')} {verifyResult.tenant.name}
                      </span>
                    )}
                    {verifyResult.status && (
                      <span>
                        {tr('الحالة:', 'Status:')} {verifyResult.status}
                      </span>
                    )}
                    {verifyResult.total_amount !== undefined && (
                      <span dir="ltr">
                        {tr('الإجمالي:', 'Total:')} {verifyResult.total_amount.toLocaleString()}
                      </span>
                    )}
                    {verifyResult.pass_type && (
                      <span>
                        {tr('التصريح:', 'Pass:')} {verifyResult.pass_type}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </SpotlightCard>
          </div>
        </section>

        {/* Event Experience Showcase */}
        <section id="experience" className="scroll-mt-20 space-y-6">
          <div className="text-start">
            <SpotlightHeading as="h2" className="text-2xl sm:text-3xl">
              {tr('تجارب استثنائية لكل مناسبة', 'Tailored Experiences for Every Occasion')}
            </SpotlightHeading>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {experiences.map((exp) => (
              <SpotlightCard key={exp.title} className="flex flex-col justify-between gap-4 overflow-hidden !p-0 text-start">
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={exp.img} alt={exp.title} className="h-44 w-full object-cover" />
                  <div className="space-y-2 p-5">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{exp.title}</h3>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{exp.desc}</p>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <a
                    href="#booking-calendar"
                    className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-primary,#D4AF37)] hover:underline"
                  >
                    <span>{tr('تحقق من التوفر في التقويم', 'Check availability in calendar')}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </SpotlightCard>
            ))}
          </div>
        </section>

        {/* 3-Step Effortless Booking Journey */}
        <section className="space-y-6">
          <SpotlightHeading as="h2" className="text-start text-2xl sm:text-3xl">
            {tr('رحلة حجز سلسة من ٣ خطوات', '3-Step Effortless Booking Journey')}
          </SpotlightHeading>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {journeySteps.map((s) => (
              <SpotlightCard key={s.num} className="space-y-2 text-start">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-extrabold text-[var(--brand-primary,#D4AF37)]">{s.num}</span>
                  <CalendarCheck className="h-4 w-4 text-emerald-500" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{s.title}</h3>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{s.desc}</p>
              </SpotlightCard>
            ))}
          </div>
        </section>

        {/* Cross-Venue 3-Month Rolling Booking Calendar */}
        <section id="booking-calendar" className="scroll-mt-20 space-y-6">
          <ThreeMonthBookingEngine mode="GLOBAL_ROOT" locale={locale} />
        </section>

        {/* Active Venue Workspaces Directory */}
        <section id="venues" className="scroll-mt-20 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SpotlightHeading as="h2" className="text-start text-2xl sm:text-3xl">
              {tr('دليل القاعات والمنشآت النشطة', 'Active Venue Workspaces Directory')}
            </SpotlightHeading>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? `${tenants.length} منشأة نشطة` : `${tenants.length} active venues`}
            </span>
          </div>

          {tenantsLoading ? (
            <p className="text-sm text-slate-500">{tr('جارٍ تحميل القاعات...', 'Loading active venues...')}</p>
          ) : tenants.length === 0 ? (
            <SpotlightCard>
              <p className="text-sm text-slate-500">{tr('لا توجد منشآت مسجلة حالياً.', 'No active venues registered yet.')}</p>
            </SpotlightCard>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {tenants.map((t) => {
                const tagline = isRtl ? t.branding.heroTaglineAr : t.branding.heroTaglineEn;
                return (
                  <Link key={t.id} href={tenantPath(locale, t.slug, '/venue')} className="group block">
                    <SpotlightCard className="flex h-full flex-col justify-between gap-4 text-start transition group-hover:border-[var(--brand-primary,#D4AF37)]">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            dir="ltr"
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            /{t.slug}
                          </span>
                          <span className="rounded-md bg-[var(--brand-primary,#D4AF37)]/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            {t.halls_count} {isRtl ? 'قاعة' : t.halls_count === 1 ? 'Hall' : 'Halls'} · {t.currency}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.name}</h3>
                        {tagline && <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{tagline}</p>}
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-xs font-semibold text-[var(--brand-primary,#D4AF37)] dark:border-slate-800">
                        <span>{tr('فتح واجهة الحجز', 'Open Venue Storefront')}</span>
                        <ArrowUpRight className="h-4 w-4" />
                      </div>
                    </SpotlightCard>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Client Protection & Trust Guarantees */}
        <section className="space-y-6">
          <SpotlightHeading as="h2" className="text-start text-2xl sm:text-3xl">
            {tr('ضمانات الحماية والثقة للعملاء', 'Client Protection & Trust Guarantees')}
          </SpotlightHeading>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {guarantees.map((g) => {
              const Icon = g.icon;
              return (
                <SpotlightCard key={g.title} className="space-y-2 text-start">
                  <Icon className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{g.title}</h3>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{g.desc}</p>
                </SpotlightCard>
              );
            })}
          </div>
        </section>

        {/* Subtle Footer with Venue Owner Entry Point */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-8 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>EventLedger · {tr('منصة حجز القاعات والفعاليات', 'Venue & Conference Reservation Platform')}</span>
          <Link href={`/${locale}/saas-portal`} className="font-semibold text-[var(--brand-primary,#D4AF37)] hover:underline">
            {tr('هل تمتلك قاعة أو مركز مؤتمرات؟ افتح بوابة إيفنت ليدجر ←', 'Own a venue or conference center? Open EventLedger Client Portal →')}
          </Link>
        </footer>
      </main>
    </div>
  );
}
