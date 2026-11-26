'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Building2, CheckCircle2, Globe2, ShieldCheck, Sparkles } from 'lucide-react';
import { apiFetch, setAccessToken, setTenantSlug } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { PlanInfo, SubscriptionTier } from '@/lib/types';

const FALLBACK_PLANS: PlanInfo[] = [
  {
    tier: 'BASIC',
    name_ar: 'الباقة الأساسية',
    name_en: 'Basic',
    price_monthly_usd: 79,
    max_halls: 2,
    max_staff: 5,
    features_ar: ['إدارة الحجوزات والتقويم', 'بوابة العميل ومخطط القاعة', 'فواتير PDF ثنائية اللغة'],
    features_en: ['Bookings & smart calendar', 'Client portal & floor plan', 'Bilingual PDF invoices'],
  },
  {
    tier: 'PRO',
    name_ar: 'الباقة الاحترافية',
    name_en: 'Pro',
    price_monthly_usd: 199,
    max_halls: 8,
    max_staff: 25,
    features_ar: ['القيد المزدوج وميزان المراجعة', 'دمج القاعات والتسعير الديناميكي', 'أمر التشغيل BEO والواتساب'],
    features_en: ['Double-entry ledger & trial balance', 'Partition halls & dynamic pricing', 'Live BEO & WhatsApp sync'],
  },
  {
    tier: 'ENTERPRISE',
    name_ar: 'باقة المؤسسات',
    name_en: 'Enterprise',
    price_monthly_usd: 499,
    max_halls: 99,
    max_staff: 999,
    features_ar: ['نطاق مخصص وهوية بيضاء كاملة', 'تطبيق سطح المكتب والأندرويد دون إنترنت', 'دعم الأولوية والتدقيق المتقدم'],
    features_en: ['Custom domain & full white-label', 'Offline desktop .exe & Android .apk', 'Priority SLA & audit suite'],
  },
];

export default function MarketingLandingPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const router = useRouter();

  const [plans, setPlans] = useState<PlanInfo[]>(FALLBACK_PLANS);
  const [venueName, setVenueName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('VenueOwner@2026');
  const [currency, setCurrency] = useState('YER');
  const [tier, setTier] = useState<SubscriptionTier>('PRO');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PlanInfo[]>('/api/v1/public/plans', { skipAuth: true })
      .then((d) => Array.isArray(d) && d.length > 0 && setPlans(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean.length < 3) {
      setSlugAvailable(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<{ available: boolean }>(`/api/v1/public/tenants/check-slug?slug=${encodeURIComponent(clean)}`, {
        skipAuth: true,
      })
        .then((res) => setSlugAvailable(res.available))
        .catch(() => setSlugAvailable(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [slug]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        tenant_id: string;
        slug: string;
        workspace_url: string;
        access_token: string;
      }>('/api/v1/public/tenants/register', {
        method: 'POST',
        skipAuth: true,
        body: {
          venue_name: venueName,
          slug: slug.toLowerCase().trim(),
          owner_name: ownerName,
          owner_phone: ownerPhone,
          owner_email: ownerEmail || null,
          owner_password: ownerPassword,
          currency,
          subscription_tier: tier,
          preferred_lang: locale,
        },
      });
      setAccessToken(res.access_token);
      setTenantSlug(res.slug);
      router.push(`/${locale}/erp/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} title={isRtl ? 'إيفنت ليدجر' : 'EventLedger'} />

      <main className="mx-auto max-w-7xl space-y-16 px-4 py-10">
        {/* Hero */}
        <section className="grid items-center gap-8 lg:grid-cols-2">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-primary,#D4AF37)]/40 bg-[var(--brand-primary,#D4AF37)]/10 px-3 py-1 text-xs font-semibold text-[var(--brand-primary,#D4AF37)]">
              <Sparkles className="h-3.5 w-3.5" />
              {isRtl ? 'منصة سحابية متعددة المستأجرين + تطبيقات أصلية' : 'Multi-Tenant SaaS ERP + Native Desktop & Android'}
            </span>
            <SpotlightHeading as="h1" className="text-3xl leading-tight sm:text-5xl">
              {isRtl
                ? 'نظام إدارة قاعات الأفراح والمؤتمرات وبوابة العملاء المتكاملة'
                : 'Enterprise Venue, Wedding Hall & Conference SaaS ERP'}
            </SpotlightHeading>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 sm:text-base">
              {isRtl
                ? 'حجوزات ذكية، محاسبة القيد المزدوج، بوابة عملاء تفاعلية، مخطط قاعات Konva، وفواتير PDF ثنائية اللغة مع دعم العمل دون إنترنت.'
                : 'Smart partition-hall availability, double-entry accounting, interactive Konva floor plans, bilingual PDFs, and offline desktop/mobile apps.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#onboard"
                className="min-h-[44px] rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-bold text-slate-950"
              >
                {isRtl ? 'أنشئ مساحة قاعتك الآن' : 'Launch Your Venue Workspace'}
              </a>
              <Link
                href={`/${locale}/venue`}
                className="min-h-[44px] rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 hover:border-[var(--brand-primary)] dark:border-slate-700 dark:text-slate-200"
              >
                {isRtl ? 'استكشف قاعة الماسة (تجريبي)' : 'Explore Al-Massa Demo Storefront'}
              </Link>
            </div>
          </div>

          <SpotlightCard className="overflow-hidden p-0">
            <img
              src="/images/hero_grand_ballroom.jpg"
              alt="EventLedger Grand Ballroom"
              className="h-72 w-full object-cover sm:h-96"
            />
          </SpotlightCard>
        </section>

        {/* Pricing Tiers */}
        <section className="space-y-6">
          <div className="text-center">
            <SpotlightHeading as="h2" className="text-2xl sm:text-3xl">
              {isRtl ? 'باقات الاشتراك للمنشآت والقاعات' : 'Transparent SaaS Pricing Tiers'}
            </SpotlightHeading>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {plans.map((p) => (
              <SpotlightCard
                key={p.tier}
                className={`flex flex-col justify-between space-y-5 ${
                  p.tier === tier ? 'ring-2 ring-[var(--brand-primary,#D4AF37)]' : ''
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold">{isRtl ? p.name_ar : p.name_en}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-mono dark:bg-slate-800">
                      {p.tier}
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-[var(--brand-primary,#D4AF37)]">
                    ${p.price_monthly_usd}
                    <span className="text-xs font-normal text-slate-500">/{isRtl ? 'شهرياً' : 'mo'}</span>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                    {(isRtl ? p.features_ar : p.features_en).map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTier(p.tier);
                    document.getElementById('onboard')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-[var(--brand-primary,#D4AF37)] py-2 text-xs font-bold text-[var(--brand-primary,#D4AF37)] hover:bg-[var(--brand-primary,#D4AF37)] hover:text-slate-950"
                >
                  {isRtl ? 'اختر هذه الباقة' : 'Select Plan'}
                </button>
              </SpotlightCard>
            ))}
          </div>
        </section>

        {/* Self-Onboarding Form */}
        <section id="onboard" className="grid gap-8 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <SpotlightHeading as="h2" className="text-2xl">
              {isRtl ? 'التسجيل الفوري وإنشاء النطاق الفرعي' : 'Instant Venue Self-Onboarding'}
            </SpotlightHeading>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {isRtl
                ? 'يتم تلقائياً إنشاء دليل الحسابات المزدوج، إعدادات المحاسبة، القوائم الافتراضية، وحساب المالك.'
                : 'Automatically provisions your subdomain, default double-entry Chart of Accounts, AccountingConfig, lookups, and OWNER account.'}
            </p>
            <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                <span>{`https://${slug || 'your-venue'}.eventledger.cloud`}</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>{isRtl ? 'عزل بيانات كامل لكل مستأجر (tenant_id)' : 'Strict multi-tenant database isolation'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-sky-500" />
                <span>{isRtl ? 'يدعم العربية RTL والإنجليزية LTR' : 'Full Arabic RTL & English LTR'}</span>
              </div>
            </div>
          </div>

          <SpotlightCard className="lg:col-span-3">
            <form onSubmit={handleRegister} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'اسم القاعة أو المركز' : 'Venue Name'}</label>
                <input
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  required
                  placeholder={isRtl ? 'قصر النخيل للمناسبات' : 'Al-Nakheel Royal Palace'}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'النطاق الفرعي (Slug)' : 'Subdomain Slug'}</label>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required
                  placeholder="alnakheel"
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
                />
                {slugAvailable !== null && (
                  <p className={`mt-1 text-[11px] ${slugAvailable ? 'text-emerald-500' : 'text-red-500'}`}>
                    {slugAvailable
                      ? isRtl
                        ? 'النطاق متاح'
                        : 'Subdomain available'
                      : isRtl
                        ? 'النطاق محجوز أو غير صالح'
                        : 'Subdomain unavailable'}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'العملة' : 'Currency'}</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="YER">YER</option>
                  <option value="SAR">SAR</option>
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'اسم المالك' : 'Owner Full Name'}</label>
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  required
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'رقم الجوال' : 'Owner Phone'}</label>
                <input
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  required
                  placeholder="+967770001122"
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'البريد الإلكتروني' : 'Owner Email'}</label>
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">{isRtl ? 'كلمة المرور' : 'Password'}</label>
                <input
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  required
                  minLength={8}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {error && <p className="sm:col-span-2 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] sm:col-span-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
              >
                {submitting
                  ? isRtl
                    ? 'جارٍ التجهيز...'
                    : 'Provisioning Workspace...'
                  : isRtl
                    ? 'إنشاء القاعة والدخول للوحة التحكم'
                    : 'Provision Venue & Launch ERP'}
              </button>
            </form>
          </SpotlightCard>
        </section>
      </main>
    </div>
  );
}
