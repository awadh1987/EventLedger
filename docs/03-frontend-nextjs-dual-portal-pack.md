```markdown
# EventLedger (إيفنت ليدجر) — Complete Next.js 14 Dual-Portal Frontend Pack
**File Path:** `docs/03-frontend-nextjs-dual-portal-pack.md`  
**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Shadcn/UI + `next-intl` (Arabic `dir="rtl"` & English `dir="ltr"`) + `next-themes` + `react-konva`  
**Purpose:** Complete, production-ready frontend surfaces for **Ecosystem Tier 1 (SaaS Marketing, Interactive Sandbox, Self-Onboarding & Super-Admin)** and **Ecosystem Tier 2 (`<slug>` Venue Storefront Booking Engine, Client Control Panel with all 6 Tabs, ERP Master Gantt & Split-Screen Approval Diff Queue, Receipt Verification & Deposit Vault)**.

---

## 1. Typed API Client (`apps/web/src/lib/api.ts`)
Automatically injects `Authorization: Bearer <token>` and `X-Tenant-Slug` from `localStorage` or the active `/t/[slug]` route so every request is strictly tenant-scoped:

```typescript
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('eventledger_api_base_url');
    if (custom) return custom.replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1').replace(/\/+$/, '');
}

export function getActiveTenantSlug(): string {
  if (typeof window !== 'undefined') {
    const pathMatch = window.location.pathname.match(/^\/(?:ar|en)\/t\/([a-z0-9-]+)/i);
    if (pathMatch?.[1]) return pathMatch[1].toLowerCase();

    const hostParts = window.location.hostname.split('.');
    if (hostParts.length >= 3 && !['www', 'admin'].includes(hostParts[0])) {
      return hostParts[0].toLowerCase();
    }

    const stored = localStorage.getItem('eventledger_tenant_slug');
    if (stored) return stored.toLowerCase();
  }
  return 'almassa';
}

export async function apiFetch<T any>(
  endpoint: string,
  options: RequestInit = {},
  explicitSlug?: string,
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const slug = explicitSlug || getActiveTenantSlug();
  if (slug) {
    headers.set('X-Tenant-Slug', slug);
  }

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('eventledger_token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail?.message || data?.detail || `API Error ${res.status}`);
  }
  return data as T;
}

```

---

## 2. Ecosystem Tier 1: Bilingual SaaS Landing Page with Interactive Capabilities Sandbox, Multi-Currency Pricing & 1-Click Self-Onboarding (`apps/web/src/app/[locale]/(marketing)/page.tsx`)

```tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, CalendarCheck, Check, Layers, Shield, Sparkles, Wallet } from 'lucide-react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch } from '@/lib/api';

const CURRENCY_RATES: Record<string, { symbol: string; mult: number }> = {
  USD: { symbol: '$', mult: 1 },
  SAR: { symbol: 'SAR ', mult: 3.75 },
  YER: { symbol: 'YER ', mult: 530 },
};

const TIERS = [
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
    featuresAr: ['قاعات غير محدودة ونطاق CNAME مخصص', 'تطبيق ويندوز .exe وأندرويد .apk أوفلاين', 'سجل تدقيق غير قابل للتعديل ودعم مخصص'],
    featuresEn: ['Unlimited halls & custom CNAME domain', 'Offline Windows .exe & Android .apk', 'Immutable audit vault & priority SLA'],
  },
];

export default function SaasMarketingLandingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'SAR' | 'YER'>('USD');
  const [activeSandboxTab, setActiveSandboxTab] = useState<'BOOKING' | 'PORTAL' | 'LEDGER'>('BOOKING');
  const [form, setForm] = useState({
    venue_name: '',
    slug: '',
    owner_name: '',
    owner_phone: '',
    owner_email: '',
    owner_password: 'VenueOwner@2026',
    currency: 'YER',
    subscription_tier: 'PRO',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rate = CURRENCY_RATES[displayCurrency];

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch('/public/tenants/register', {
        method: 'POST',
        body: JSON.stringify({ ...form, owner_email: form.owner_email || null }),
      });
      localStorage.setItem('eventledger_tenant_slug', data.slug);
      window.location.href = `/${locale}/t/${data.slug}/erp/dashboard`;
    } catch (err: any) {
      setErrorMsg(err.message || 'Provisioning failed');
      setSubmitting(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-7xl space-y-20 px-4 py-12 sm:px-6">
      {/* Hero Section */}
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1 text-xs font-bold text-amber-400">
            <Sparkles className="h-3.5 w-3.5"/>
            {isRtl ? 'منصة سحابية متعددة المستأجرين + تطبيقات أصلية' : 'Multi-Tenant SaaS ERP + Native Desktop & Android'}
          </span>

          <SpotlightHeading as="h1" className="text-3xl leading-tight sm:text-5xl">
            {isRtl
              ? 'نظام إدارة قاعات الأفراح والمؤتمرات وبوابة العملاء المتكاملة'
              : 'Enterprise Venue, Wedding Hall & Conference SaaS ERP'}
          </SpotlightHeading>

          <p className="text-sm text-slate-600 dark:text-slate-400 sm:text-base">
            {isRtl
              ? 'حجوزات ذكية تمنع تضارب القاعات المدمجة، محاسبة قيد مزدوج، بوابة عملاء تفاعلية، مخطط قاعات Konva، وفواتير PDF ثنائية اللغة مع دعم العمل دون إنترنت.'
              : 'Smart partition-hall availability, double-entry accounting, interactive Konva floor plans, bilingual PDFs, and offline desktop/mobile apps.'}
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              href="#onboarding"
              className="rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:opacity-90"
            >
              {isRtl ? 'أنشئ مساحة قاعتك الآن' : 'Launch Your Venue Workspace'}
            </a>
            <Link className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-[var(--brand-primary,#D4AF37)]" href="{`/${locale}/t/almassa/venue`}">
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

      {/* Capabilities Interactive Sandbox */}
      <section id="capabilities" className="space-y-6">
        <div className="text-center">
          <SpotlightHeading as="h2" className="text-2xl sm:text-3xl">
            {isRtl ? 'قدرات النظام المتكاملة للمنشآت والعملاء' : 'Dual-Ecosystem Capabilities'}
          </SpotlightHeading>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {[
            { id: 'BOOKING', ar: 'محرك الحجز والقاعات المدمجة', en: 'Partition Booking Engine', icon: CalendarCheck },
            { id: 'PORTAL', ar: 'بوابة العميل ومخطط القاعة', en: 'Client Portal & Floor Plan', icon: Layers },
            { id: 'LEDGER', ar: 'القيد المزدوج والتأمينات', en: 'Double-Entry & Deposit Vault', icon: Wallet },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSandboxTab(tab.id as any)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                  activeSandboxTab === tab.id
                    ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                    : 'border border-slate-800 bg-slate-900 text-slate-300'
                }`}
              >
                <Icon className="h-4 w-4"/>
                <span>{isRtl ? tab.ar : tab.en}</span>
              </button>
            );
          })}
        </div>

        <SpotlightCard className="p-6">
          {activeSandboxTab === 'BOOKING' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">01. Partition Hall Merge</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'دمج قاعة الماسة (500) + الياسمين (300) تلقائياً ومنع الحجز المتعارض مع هوامش التنظيف.'
                    : 'Automatically merges Grand Diamond (500) + Royal Jasmine (300) and blocks overlapping buffers.'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">02. Dynamic Seasonal Pricing</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'مضاعفات أسعار تلقائية لعطلة نهاية الأسبوع (الخميس/الجمعة) والمواسم والأعياد.'
                    : 'Automatic weekend (Thu/Fri) and Eid/seasonal pricing multipliers.'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">03. 48-Hour Tentative Holds</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'حجز مبدئي لمدة 48 ساعة مع تذكير واتساب وإلغاء تلقائي في حال عدم سداد العربون.'
                    : '48-hour Redis + Celery tentative hold with automated expiry if deposit remains unpaid.'}
                </p>
              </div>
            </div>
          )}

          {activeSandboxTab === 'PORTAL' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">01. Konva Floor Plan Studio</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'توزيع الكوشة والطاولات بالسحب والإفلات مع حساب السعة وفارق التكلفة فوراً.'
                    : 'Drag-and-drop Kosha/Stage and VIP/Guest tables with live seat count & cost delta.'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">02. Planner & Vendor Delegation</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'تفويض منسق الحفل بصلاحيات محددة مع اشتراط موافقة العميل على أي تكلفة إضافية.'
                    : 'Delegate Wedding Planners with granular switches while locking financial sign-off to Primary Client.'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">03. QR Guest Passes & E-Contract</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'توقيع العقد إلكترونياً وإصدار بطاقات دخول QR لكل ضيف وفريق تصوير.'
                    : 'Digital contract e-signature and instant QR entry passes for VIPs, guests, and vendors.'}
                </p>
              </div>
            </div>
          )}

          {activeSandboxTab === 'LEDGER' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">01. Liability 2100 Deposit Vault</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'عزل تأمينات الأضرار المستردة في حساب التزامات 2100 وعدم خلطها بالإيرادات.'
                    : 'Segregates refundable security deposits into Liability 2100 until post-event inspection.'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">02. Per-Event P&L & Recipe BOM</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'حساب صافي ربح كل مناسبة مقارنة بتكلفة البوفيه والمصروفات التشغيلية.'
                    : 'Real-time net profit margin per event against catering BOM COGS and direct expenses.'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-xs font-bold text-amber-400">03. Local E-Wallets & BOM CSV</div>
                <p className="mt-1 text-xs text-slate-400">
                  {isRtl
                    ? 'دعم بنك الكريمي، جيب، جوالي، ون كاش، وتصدير ملفات Excel عربية بترميز UTF-8 BOM.'
                    : 'Supports Kuraimi, Jaib, Jawali, OneCash, and Arabic-safe UTF-8 BOM CSV exports.'}
                </p>
              </div>
            </div>
          )}
        </SpotlightCard>
      </section>

      {/* Multi-Currency Pricing Tiers */}
      <section id="pricing" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SpotlightHeading as="h2" className="text-2xl sm:text-3xl">
            {isRtl ? 'باقات الاشتراك للمنشآت والقاعات' : 'Transparent SaaS Pricing Tiers'}
          </SpotlightHeading>

          <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
            {(['USD', 'SAR', 'YER'] as const).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => setDisplayCurrency(curr)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  displayCurrency === curr ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : 'text-slate-400'
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
              <SpotlightCard ${ '' 'border-[var(--brand-primary,#D4AF37)] : ? className="{`flex" flex-col justify-between key="{tier.code}" ring-1 ring-[var(--brand-primary,#D4AF37)]' selected }`}>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold">{isRtl ? tier.nameAr : tier.nameEn}</span>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-amber-400">
                      {tier.code}
                    </span>
                  </div>
                  <div className="mt-4 font-mono text-3xl font-extrabold text-[var(--brand-primary,#D4AF37)]">
                    {rate.symbol}
                    {amount}
                    <span className="text-xs font-normal text-slate-400">{isRtl ? ' / شهرياً' : ' / mo'}</span>
                  </div>
                  <ul className="mt-5 space-y-2.5 text-xs text-slate-300">
                    {(isRtl ? tier.featuresAr : tier.featuresEn).map((feat) => (
                      <li key={feat} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400"/>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, subscription_tier: tier.code })}
                  className={`mt-6 w-full rounded-xl py-2.5 text-xs font-bold transition ${
                    selected
                      ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                      : 'border border-slate-700 bg-slate-950 text-slate-200 hover:border-[var(--brand-primary,#D4AF37)]'
                  }`}
                >
                  {selected
                    ? isRtl ? '✔ الباقة المختارة' : '✔ Selected Plan'
                    : isRtl ? 'اختيار الباقة' : 'Select Plan'}
                </button>
              </SpotlightCard>
            );
          })}
        </div>
      </section>

      {/* Instant Venue Self-Onboarding */}
      <section id="onboarding" className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <SpotlightHeading as="h2" className="text-2xl">
            {isRtl ? 'التفعيل الفوري لمنصة الصالة' : 'Instant Venue Self-Onboarding'}
          </SpotlightHeading>
          <p className="text-sm text-slate-400">
            {isRtl
              ? 'يقوم النظام تلقائياً بتجهيز النطاق الفرعي، دليل الحسابات المزدوج، إعدادات المحاسبة، وحساب المالك.'
              : 'Automatically provisions your subdomain, default double-entry Chart of Accounts, AccountingConfig, and OWNER account.'}
          </p>
          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-amber-400"/>
              <span>https://{form.slug || 'your-venue'}.eventledger.cloud</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400"/>
              <span>{isRtl ? 'عزل كامل لبيانات كل منشأة (Strict tenant_id)' : 'Strict multi-tenant database isolation'}</span>
            </div>
          </div>
        </div>

        <SpotlightCard className="lg:col-span-3">
          <form onSubmit={handleProvision} className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
              <span>{isRtl ? 'الباقة المختارة:' : 'Selected Subscription Tier:'}</span>
              <strong className="font-mono text-amber-400">{form.subscription_tier}</strong>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold">{isRtl ? 'اسم الصالة / المركز' : 'Venue Name'}</label>
              <input
                required
                value={form.venue_name}
                onChange={(e) => setForm({ ...form, venue_name: e.target.value })}
                placeholder="Al-Nakheel Royal Palace"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold">{isRtl ? 'المعرف (Subdomain Slug)' : 'Subdomain Slug'}</label>
                <input
                  required
                  dir="ltr"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  placeholder="alnakheel"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">{isRtl ? 'العملة' : 'Currency'}</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">{isRtl ? 'كلمة المرور' : 'Password'}</label>
                <input
                  type="password"
                  required
                  value={form.owner_password}
                  onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[var(--brand-primary,#D4AF37)] py-3 text-sm font-bold text-slate-950 shadow transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? isRtl ? 'جاري إنشاء المنشأة...' : 'Provisioning Venue...'
                : isRtl ? 'تفعيل المنصة والدخول إلى ERP' : 'Provision Venue & Launch ERP'}
            </button>
          </form>
        </SpotlightCard>
      </section>
    </div>
  );
}

```

---

## 3. Ecosystem Tier 2: `<slug>` Venue Storefront with Partition Merger, Live Availability Slots & 1-Click `Place 48h Hold` Checkout (`apps/web/src/app/[locale]/venue/page.tsx`)

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, CheckCircle2, Clock, Layers, Users } from 'lucide-react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { useAuthSession } from '@/components/providers/auth-provider';
import { apiFetch } from '@/lib/api';

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

export default function TenantVenueStorefrontPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const router = useRouter();
  const { tenantSlug } = useAuthSession();

  const [tenantName, setTenantName] = useState('Al-Massa Grand Palace');
  const [currency, setCurrency] = useState('YER');
  const [halls, setHalls] = useState<HallDto[]>([]);
  const [occupiedSlots, setOccupiedSlots] = useState<any[]>([]);
  const [selectedHallId, setSelectedHallId] = useState<string>('');
  const [mergePartition, setMergePartition] = useState(false);

  const [bookingForm, setBookingForm] = useState({
    event_type: 'WEDDING',
    start_time: '2026-12-10T16:00',
    end_time: '2026-12-10T22:00',
    guest_count: 350,
    client_full_name: '',
    client_phone: '',
    client_category: 'INDIVIDUAL_B2C',
    company_name: '',
  });

  const [quoteResult, setQuoteResult] = useState<any>(null);
  const [holdCreated, setHoldCreated] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch(`/public/tenants/${tenantSlug}`, {}, tenantSlug)
      .then((data) => {
        setTenantName(data.name);
        setCurrency(data.currency);
        if (Array.isArray(data.halls) && data.halls.length > 0) {
          setHalls(data.halls);
          setSelectedHallId(data.halls[0].id);
        }
      })
      .catch(() => {});

    apiFetch('/public/halls/availability', {}, tenantSlug)
      .then((data) => Array.isArray(data.occupied_slots) && setOccupiedSlots(data.occupied_slots))
      .catch(() => {});
  }, [tenantSlug]);

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
      const data = await apiFetch(`/public/halls/availability?${qs.toString()}`, {}, tenantSlug);
      setQuoteResult(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Availability check failed');
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
      const created = await apiFetch(
        '/bookings/hold',
        {
          method: 'POST',
          body: JSON.stringify({
            hall_id: selectedHallId,
            merge_combinable_hall: mergePartition,
            event_type: bookingForm.event_type,
            start_time: new Date(bookingForm.start_time).toISOString(),
            end_time: new Date(bookingForm.end_time).toISOString(),
            guest_count: Number(bookingForm.guest_count),
            client_full_name: bookingForm.client_full_name,
            client_phone: bookingForm.client_phone,
            client_category: bookingForm.client_category,
            company_name: bookingForm.company_name || null,
          }),
        },
        tenantSlug,
      );
      setHoldCreated(created);
    } catch (err: any) {
      setErrorMsg(err.message || 'Booking conflict or validation error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-mono text-xs text-amber-400">/{tenantSlug}</span>
          <SpotlightHeading as="h1" className="text-2xl sm:text-4xl">
            {tenantName} — {isRtl ? 'القاعات والحجز الفوري' : 'Venue Halls & Instant Reservation'}
          </SpotlightHeading>
        </div>
      </div>

      {/* Hall Selection Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {halls.map((hall) => {
          const active = hall.id === selectedHallId;
          return (
            <SpotlightCard key="{hall.id}" onClick="{()"> {
                setSelectedHallId(hall.id);
                setMergePartition(false);
                setQuoteResult(null);
              }}
              className={`cursor-pointer ${
                active ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">{isRtl ? hall.name_ar : hall.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5"/>
                      Banquet: {hall.capacity_banquet}
                    </span>
                    <span>Theater: {hall.capacity_theater}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5"/>
                      Buffer: {hall.cleaning_buffer_minutes}m
                    </span>
                  </div>
                </div>
                <div className="font-mono text-lg font-extrabold text-[var(--brand-primary,#D4AF37)]">
                  {Number(hall.base_price).toLocaleString()} {currency}
                </div>
              </div>
            </SpotlightCard>
          );
        })}
      </div>

      {/* Partition Hall Merge Banner */}
      {partnerHall && (
        <SpotlightCard className="flex flex-wrap items-center justify-between gap-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <Layers className="h-5 w-5 text-amber-400"/>
            <div>
              <div className="text-sm font-bold">
                {isRtl
                  ? `دمج القاعتين معاً (${selectedHall?.name_ar} + ${partnerHall.name_ar})`
                  : `Merge Partition Halls (${selectedHall?.name} + ${partnerHall.name})`}
              </div>
              <div className="text-xs text-slate-400">
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
            <span>{isRtl ? 'تفعيل الدمج' : 'Enable Merge'}</span>
          </label>
        </SpotlightCard>
      )}

      {/* Dynamic Quote & 1-Click 48h Hold Reservation Form */}
      <SpotlightCard>
        <SpotlightHeading as="h2" className="mb-4 text-xl">
          {isRtl ? 'حاسبة التسعير الفوري وحجز 48 ساعة مبدئي' : 'Dynamic Quote & 48-Hour Tentative Hold'}
        </SpotlightHeading>

        {errorMsg && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handlePlace48hHold} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'نوع المناسبة' : 'Event Type'}</label>
              <select
                value={bookingForm.event_type}
                onChange={(e) => setBookingForm({ ...bookingForm, event_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="WEDDING">{isRtl ? 'حفل زفاف' : 'Wedding'}</option>
                <option value="CONFERENCE">{isRtl ? 'مؤتمر / ندوة' : 'Conference'}</option>
                <option value="GRADUATION">{isRtl ? 'حفل تخرج' : 'Graduation'}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'وقت البداية' : 'Start Time'}</label>
              <input
                type="datetime-local"
                required
                value={bookingForm.start_time}
                onChange={(e) => setBookingForm({ ...bookingForm, start_time: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'وقت النهاية' : 'End Time'}</label>
              <input
                type="datetime-local"
                required
                value={bookingForm.end_time}
                onChange={(e) => setBookingForm({ ...bookingForm, end_time: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'عدد الضيوف' : 'Guest Count'}</label>
              <input
                type="number"
                min={10}
                required
                value={bookingForm.guest_count}
                onChange={(e) => setBookingForm({ ...bookingForm, guest_count: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-800 pt-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'اسم العميل / الجهة' : 'Client Full Name'}</label>
              <input
                required
                value={bookingForm.client_full_name}
                onChange={(e) => setBookingForm({ ...bookingForm, client_full_name: e.target.value })}
                placeholder={isRtl ? 'أحمد عبدالله' : 'Ahmed Abdullah'}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'رقم الجوال / واتساب' : 'Phone / WhatsApp'}</label>
              <input
                required
                dir="ltr"
                value={bookingForm.client_phone}
                onChange={(e) => setBookingForm({ ...bookingForm, client_phone: e.target.value })}
                placeholder="+967771234567"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'فئة الحجز' : 'Client Profile'}</label>
              <select
                value={bookingForm.client_category}
                onChange={(e) => setBookingForm({ ...bookingForm, client_category: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="INDIVIDUAL_B2C">{isRtl ? 'أفراد (B2C)' : 'Individual (B2C)'}</option>
                <option value="CORPORATE_B2B">{isRtl ? 'شركات ومؤسسات (B2B)' : 'Corporate (B2B)'}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleCheckQuote}
              disabled={loading}
              className="rounded-xl border border-[var(--brand-primary,#D4AF37)] px-5 py-2.5 text-xs font-bold text-[var(--brand-primary,#D4AF37)]"
            >
              {isRtl ? 'فحص التوفر واحتساب السعر' : 'Check Availability & Calculate Quote'}
            </button>

            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 py-2.5 text-xs font-bold text-slate-950 shadow"
            >
              {isRtl ? 'تثبيت حجز مبدئي لمدة 48 ساعة (HOLD_48H)' : 'Place 48-Hour Tentative Hold'}
            </button>
          </div>
        </form>

        {quoteResult && (
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={quoteResult.availability?.available ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
                {quoteResult.availability?.available
                  ? isRtl ? '✔ القاعة متاحة في هذا الوقت' : '✔ Slot Available'
                  : isRtl ? '✖ يوجد تضارب في الموعد' : '✖ Schedule Conflict'}
              </span>
              <span className="font-mono text-sm font-bold text-amber-400">
                {isRtl ? 'الإجمالي:' : 'Total:'} {Number(quoteResult.quote?.total_amount || 0).toLocaleString()} {currency}
              </span>
            </div>
          </div>
        )}

        {holdCreated && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs">
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="h-5 w-5"/>
              <div>
                <div className="font-bold">
                  {isRtl ? `تم إنشاء الحجز المبدئي: ${holdCreated.event_code}` : `48h Hold Created: ${holdCreated.event_code}`}
                </div>
                <div>
                  {isRtl ? 'يرجى الدخول لبوابة العميل لتوقيع العقد ورفع إيصال العربون خلال 48 ساعة.' : 'Open Client Portal to sign contract and upload 50% deposit receipt within 48h.'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/t/${tenantSlug}/portal/dashboard`)}
              className="rounded-lg bg-emerald-500 px-4 py-2 font-bold text-slate-950"
            >
              {isRtl ? 'الانتقال لبوابة العميل' : 'Open Client Portal'}
            </button>
          </div>
        )}
      </SpotlightCard>

      {/* Occupied Calendar Slots */}
      {occupiedSlots.length > 0 && (
        <SpotlightCard>
          <SpotlightHeading as="h3" className="mb-3 text-base">
            {isRtl ? 'المواعيد المحجوزة حالياً' : 'Current Calendar Holds & Confirmed Events'}
          </SpotlightHeading>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {occupiedSlots.map((slot) => (
              <div key={slot.event_id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
                <span className="font-mono font-bold text-amber-400">{slot.event_code}</span>
                <span>{slot.start_time.slice(0, 16)}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px]">{slot.status}</span>
              </div>
            ))}
          </div>
        </SpotlightCard>
      )}
    </div>
  );
}

```

```
