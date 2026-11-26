'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, CalendarCheck, Check, Layers, Shield, Sparkles, Wallet } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, setAccessToken, setTenantSlug, tenantPath } from '@/lib/api';
import type { SubscriptionTier } from '@/lib/types';

const CURRENCY_RATES: Record<'USD' | 'SAR' | 'YER', { symbol: string; mult: number }> = {
  USD: { symbol: '$', mult: 1 },
  SAR: { symbol: 'SAR ', mult: 3.75 },
  YER: { symbol: 'YER ', mult: 530 },
};

const TIERS: {
  code: SubscriptionTier;
  nameAr: string;
  nameEn: string;
  baseUsd: number;
  popular?: boolean;
  featuresAr: string[];
  featuresEn: string[];
}[] = [
  {
    code: 'BASIC',
    nameAr: 'الباقة الأساسية',
    nameEn: 'Basic',
    baseUsd: 79,
    featuresAr: ['قاعة واحدة وتقويم ذكي', 'بوابة عملاء ومخطط قاعة', 'فواتير PDF ثنائية اللغة'],
    featuresEn: ['1 Hall & smart calendar', 'Client portal & floor plan', 'Bilingual PDF invoices'],
  },
  {
    code: 'PRO',
    nameAr: 'الباقة الاحترافية',
    nameEn: 'Pro',
    baseUsd: 199,
    popular: true,
    featuresAr: ['حتى 5 قاعات مدمجة (Partition)', 'محاسبة قيد مزدوج وميزان مراجعة', 'ربط واتساب وأمر تشغيل BEO'],
    featuresEn: ['Up to 5 partition-merge halls', 'Double-entry ledger & trial balance', 'WhatsApp sync & live BEO'],
  },
  {
    code: 'ENTERPRISE',
    nameAr: 'باقة المؤسسات',
    nameEn: 'Enterprise',
    baseUsd: 499,
    featuresAr: [
      'نطاق CNAME مخصص وهوية بيضاء كاملة',
      'تطبيق ويندوز .exe وأندرويد .apk أوفلاين',
      'سجل تدقيق غير قابل للتعديل ودعم مخصص',
    ],
    featuresEn: [
      'Unlimited halls & custom CNAME domain',
      'Offline Windows .exe & Android .apk',
      'Immutable audit vault & priority SLA',
    ],
  },
];

export default function SaasMarketingLandingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'SAR' | 'YER'>('USD');
  const [activeSandboxTab, setActiveSandboxTab] = useState<'BOOKING' | 'PORTAL' | 'LEDGER'>('BOOKING');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    venue_name: '',
    slug: '',
    owner_name: '',
    owner_phone: '',
    owner_email: '',
    owner_password: 'VenueOwner@2026',
    currency: 'YER',
    subscription_tier: 'PRO' as SubscriptionTier,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rate = CURRENCY_RATES[displayCurrency];

  useEffect(() => {
    const clean = form.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
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
  }, [form.slug]);

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch<{
        tenant_id: string;
        slug: string;
        workspace_url: string;
        access_token: string;
      }>('/api/v1/public/tenants/register', {
        method: 'POST',
        skipAuth: true,
        body: {
          ...form,
          slug: form.slug.toLowerCase().trim(),
          owner_email: form.owner_email.trim() || null,
          preferred_lang: locale,
        },
      });
      setAccessToken(data.access_token);
      setTenantSlug(data.slug);
      window.location.href = tenantPath(locale, data.slug, '/erp/dashboard');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Provisioning failed');
      setSubmitting(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} title={isRtl ? 'إيفنت ليدجر' : 'EventLedger'} />

      <main className="mx-auto max-w-7xl space-y-20 px-4 py-12 sm:px-6">
        {/* Hero Section */}
        <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div className="space-y-6 text-start">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1 text-xs font-bold text-amber-500 dark:text-amber-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {isRtl ? 'منصة سحابية متعددة المستأجرين + تطبيقات أصلية' : 'Multi-Tenant SaaS ERP + Native Desktop & Android'}
              </span>
            </span>

            <SpotlightHeading as="h1" className="text-start text-3xl leading-tight sm:text-5xl">
              {isRtl
                ? 'نظام إدارة قاعات الأفراح والمؤتمرات وبوابة العملاء المتكاملة'
                : 'Enterprise Venue, Wedding Hall & Conference SaaS ERP'}
            </SpotlightHeading>

            <p className="text-start text-sm text-slate-600 dark:text-slate-400 sm:text-base">
              {isRtl
                ? 'حجوزات ذكية تمنع تضارب القاعات المدمجة، محاسبة قيد مزدوج، بوابة عملاء تفاعلية، مخطط قاعات Konva، وفواتير PDF ثنائية اللغة مع دعم العمل دون إنترنت.'
                : 'Smart partition-hall availability, double-entry accounting, interactive Konva floor plans, bilingual PDFs, and offline desktop/mobile apps.'}
            </p>

            <div className="flex flex-wrap gap-3">
              <a
                href="#onboarding"
                className="min-h-[44px] rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:opacity-90"
              >
                {isRtl ? 'أنشئ مساحة قاعتك الآن' : 'Launch Your Venue Workspace'}
              </a>
              <Link
                href={tenantPath(locale, 'almassa', '/venue')}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {isRtl ? 'استكشف قاعة الماسة (تجريبي)' : 'Explore Al-Massa Demo Storefront'}
              </Link>
            </div>
          </div>

          <SpotlightCard className="overflow-hidden p-2">
            <img
              src="/images/hero_grand_ballroom.jpg"
              alt="EventLedger Grand Ballroom"
              className="h-[340px] w-full rounded-lg object-cover"
            />
          </SpotlightCard>
        </section>

        {/* Interactive Capabilities Sandbox */}
        <section id="capabilities" className="space-y-6">
          <div className="text-center">
            <SpotlightHeading as="h2" className="text-2xl sm:text-3xl">
              {isRtl ? 'قدرات النظام المتكاملة للمنشآت والعملاء' : 'Dual-Ecosystem Capabilities'}
            </SpotlightHeading>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {[
              { id: 'BOOKING' as const, ar: 'محرك الحجز والقاعات المدمجة', en: 'Partition Booking Engine', icon: CalendarCheck },
              { id: 'PORTAL' as const, ar: 'بوابة العميل ومخطط القاعة', en: 'Client Portal & Floor Plan', icon: Layers },
              { id: 'LEDGER' as const, ar: 'القيد المزدوج والتأمينات', en: 'Double-Entry & Deposit Vault', icon: Wallet },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSandboxTab(tab.id)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                    activeSandboxTab === tab.id
                      ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                      : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{isRtl ? tab.ar : tab.en}</span>
                </button>
              );
            })}
          </div>

          <SpotlightCard className="p-6 text-start">
            {activeSandboxTab === 'BOOKING' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">01. Partition Hall Merge</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'دمج قاعة الماسة (500) + الياسمين (300) تلقائياً ومنع الحجز المتعارض مع هوامش التنظيف.'
                      : 'Automatically merges Grand Diamond (500) + Royal Jasmine (300) and blocks overlapping buffers.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">02. Dynamic Seasonal Pricing</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'مضاعفات أسعار تلقائية لعطلة نهاية الأسبوع (الخميس/الجمعة) والمواسم والأعياد.'
                      : 'Automatic weekend (Thu/Fri) and Eid/seasonal pricing multipliers.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">03. 48-Hour Tentative Holds</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'حجز مبدئي لمدة 48 ساعة مع تذكير واتساب وإلغاء تلقائي في حال عدم سداد العربون.'
                      : '48-hour Redis + Celery tentative hold with automated expiry if deposit remains unpaid.'}
                  </p>
                </div>
              </div>
            )}

            {activeSandboxTab === 'PORTAL' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">01. Konva Floor Plan Studio</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'توزيع الكوشة والطاولات بالسحب والإفلات مع حساب السعة وفارق التكلفة فوراً.'
                      : 'Drag-and-drop Kosha/Stage and VIP/Guest tables with live seat count & cost delta.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">02. Planner & Vendor Delegation</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'تفويض منسق الحفل بصلاحيات محددة مع اشتراط موافقة العميل على أي تكلفة إضافية.'
                      : 'Delegate Wedding Planners with granular switches while locking financial sign-off to Primary Client.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">03. QR Guest Passes & E-Contract</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'توقيع العقد إلكترونياً وإصدار بطاقات دخول QR لكل ضيف وفريق تصوير.'
                      : 'Digital contract e-signature and instant QR entry passes for VIPs, guests, and vendors.'}
                  </p>
                </div>
              </div>
            )}

            {activeSandboxTab === 'LEDGER' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">01. Liability 2100 Deposit Vault</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'عزل تأمينات الأضرار المستردة في حساب التزامات 2100 وعدم خلطها بالإيرادات.'
                      : 'Segregates refundable security deposits into Liability 2100 until post-event inspection.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">02. Per-Event P&L & Recipe BOM</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'حساب صافي ربح كل مناسبة مقارنة بتكلفة البوفيه والمصروفات التشغيلية.'
                      : 'Real-time net profit margin per event against catering BOM COGS and direct expenses.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-bold text-amber-500 dark:text-amber-400">03. Local E-Wallets & BOM CSV</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {isRtl
                      ? 'دعم بنك الكريمي، جيب، جوالي، ون كاش، وتصدير ملفات Excel عربية بترميز UTF-8 BOM.'
                      : 'Supports Kuraimi, Jaib, Jawali, OneCash, and Arabic-safe UTF-8 BOM CSV exports.'}
                  </p>
                </div>
              </div>
            )}
          </SpotlightCard>
        </section>

        {/* Multi-Currency SaaS Pricing Tiers */}
        <section id="pricing" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SpotlightHeading as="h2" className="text-start text-2xl sm:text-3xl">
              {isRtl ? 'باقات الاشتراك للمنشآت والقاعات' : 'Transparent SaaS Pricing Tiers'}
            </SpotlightHeading>

            <div className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              {(['USD', 'SAR', 'YER'] as const).map((curr) => (
                <button
                  key={curr}
                  type="button"
                  onClick={() => setDisplayCurrency(curr)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    displayCurrency === curr
                      ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {curr}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {TIERS.map((tier) => {
              const selected = form.subscription_tier === tier.code;
              const amount = Math.round(tier.baseUsd * rate.mult).toLocaleString();
              return (
                <SpotlightCard
                  key={tier.code}
                  className={`flex flex-col justify-between text-start ${
                    selected ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]' : ''
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-bold">{isRtl ? tier.nameAr : tier.nameEn}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-amber-500 dark:bg-slate-800 dark:text-amber-400">
                        {tier.code}
                      </span>
                    </div>
                    <div dir="ltr" className="mt-4 text-start font-mono text-3xl font-extrabold text-[var(--brand-primary,#D4AF37)]">
                      {rate.symbol}
                      {amount}
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        {isRtl ? ' / شهرياً' : ' / mo'}
                      </span>
                    </div>
                    <ul className="mt-5 space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
                      {(isRtl ? tier.featuresAr : tier.featuresEn).map((feat) => (
                        <li key={feat} className="flex items-center gap-2">
                          <Check className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, subscription_tier: tier.code });
                      document.getElementById('onboarding')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className={`mt-6 min-h-[44px] w-full rounded-xl py-2.5 text-xs font-bold transition ${
                      selected
                        ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                        : 'border border-slate-300 bg-slate-50 text-slate-800 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                    }`}
                  >
                    {selected
                      ? isRtl
                        ? '✔ الباقة المختارة'
                        : '✔ Selected Plan'
                      : isRtl
                        ? 'اختيار الباقة'
                        : 'Select Plan'}
                  </button>
                </SpotlightCard>
              );
            })}
          </div>
        </section>

        {/* Instant 1-Click Venue Self-Onboarding */}
        <section id="onboarding" className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="space-y-4 text-start lg:col-span-2">
            <SpotlightHeading as="h2" className="text-start text-2xl">
              {isRtl ? 'التفعيل الفوري لمنصة الصالة' : 'Instant Venue Self-Onboarding'}
            </SpotlightHeading>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {isRtl
                ? 'يقوم النظام تلقائياً بتجهيز النطاق الفرعي، دليل الحسابات المزدوج، إعدادات المحاسبة، وحساب المالك.'
                : 'Automatically provisions your subdomain, default double-entry Chart of Accounts, AccountingConfig, and OWNER account.'}
            </p>
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                <span dir="ltr">{`https://${form.slug || 'your-venue'}.eventledger.cloud`}</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
                <span>{isRtl ? 'عزل كامل لبيانات كل منشأة (Strict tenant_id)' : 'Strict multi-tenant database isolation'}</span>
              </div>
            </div>
          </div>

          <SpotlightCard className="text-start lg:col-span-3">
            <form onSubmit={handleProvision} className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <span>{isRtl ? 'الباقة المختارة:' : 'Selected Subscription Tier:'}</span>
                <strong className="font-mono text-amber-500 dark:text-amber-400">{form.subscription_tier}</strong>
              </div>

              {errorMsg && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500 dark:text-rose-300">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold">{isRtl ? 'اسم الصالة / المركز' : 'Venue Name'}</label>
                <input
                  required
                  value={form.venue_name}
                  onChange={(e) => setForm({ ...form, venue_name: e.target.value })}
                  placeholder={isRtl ? 'قصر النخيل الملكي' : 'Al-Nakheel Royal Palace'}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    {isRtl ? 'المعرف (Subdomain Slug)' : 'Subdomain Slug'}
                  </label>
                  <input
                    required
                    dir="ltr"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                    placeholder="alnakheel"
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                  {slugAvailable !== null && (
                    <p className={`mt-1 text-[11px] ${slugAvailable ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {slugAvailable
                        ? isRtl
                          ? 'النطاق متاح'
                          : 'Slug available'
                        : isRtl
                          ? 'النطاق محجوز أو غير صالح'
                          : 'Slug unavailable'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">{isRtl ? 'العملة' : 'Currency'}</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="YER">YER</option>
                    <option value="SAR">SAR</option>
                    <option value="USD">USD</option>
                    <option value="AED">AED</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">{isRtl ? 'اسم المالك' : 'Owner Full Name'}</label>
                  <input
                    required
                    value={form.owner_name}
                    onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">{isRtl ? 'رقم الجوال / واتساب' : 'Owner Phone'}</label>
                  <input
                    required
                    dir="ltr"
                    value={form.owner_phone}
                    onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
                    placeholder="+967770001122"
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">{isRtl ? 'البريد الإلكتروني' : 'Owner Email'}</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={form.owner_email}
                    onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">{isRtl ? 'كلمة المرور' : 'Password'}</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={form.owner_password}
                    onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] w-full rounded-xl bg-[var(--brand-primary,#D4AF37)] py-3 text-sm font-bold text-slate-950 shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting
                  ? isRtl
                    ? 'جاري إنشاء المنشأة...'
                    : 'Provisioning Venue...'
                  : isRtl
                    ? 'تفعيل المنصة والدخول إلى ERP'
                    : 'Provision Venue & Launch ERP'}
              </button>
            </form>
          </SpotlightCard>
        </section>
      </main>
    </div>
  );
}
