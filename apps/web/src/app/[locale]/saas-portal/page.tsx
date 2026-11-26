'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  Laptop,
  MessageSquare,
  Palette,
  Plus,
  Shield,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { useAuthSession } from '@/components/providers/auth-provider';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, setTenantSlug, tenantPath } from '@/lib/api';
import type { AuthUser, HallInfo, SubscriptionTier } from '@/lib/types';

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

interface TenantOverview {
  id: string;
  name: string;
  slug: string;
  currency: string;
  subscription_tier: string;
  subscription_status: string;
  max_halls: number;
  halls_count: number;
  monthly_whatsapp_quota: number;
  whatsapp_used_this_month: number;
}

interface BrandingPayload {
  primary_color: string;
  accent_color: string;
  spotlight_color: string;
  default_theme: string;
  enable_spotlight: boolean;
  logo_light_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  hero_tagline_ar: string | null;
  hero_tagline_en: string | null;
}

const inputCls =
  'min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950';
const labelCls = 'mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300';

export default function SaasOwnerPortalPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const { user, isAuthenticated, tenantSlug, loginSession } = useAuthSession();
  const router = useRouter();
  const venueNameRef = useRef<HTMLInputElement>(null);
  const isOwnerOrStaff = user?.user_type === 'INTERNAL_STAFF' || user?.user_type === 'SUPER_ADMIN';

  const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'SAR' | 'YER'>('USD');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [regForm, setRegForm] = useState({
    venue_name: '',
    slug: '',
    owner_name: '',
    owner_phone: '',
    owner_email: '',
    owner_password: 'VenueOwner@2026',
    currency: 'YER',
    subscription_tier: 'PRO' as SubscriptionTier,
  });
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const [overview, setOverview] = useState<TenantOverview | null>(null);
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [branding, setBranding] = useState<BrandingPayload>({
    primary_color: '#D4AF37',
    accent_color: '#0F172A',
    spotlight_color: 'rgba(212, 175, 55, 0.18)',
    default_theme: 'DARK',
    enable_spotlight: true,
    logo_light_url: '',
    logo_dark_url: '',
    favicon_url: '',
    hero_tagline_ar: '',
    hero_tagline_en: '',
  });
  const [hallForm, setHallForm] = useState({
    name: '',
    name_ar: '',
    capacity_banquet: 300,
    capacity_theater: 500,
    base_price: 750000,
    cleaning_buffer_minutes: 120,
    combinable_with_hall_id: '',
  });
  const [editingHallId, setEditingHallId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rate = CURRENCY_RATES[displayCurrency];

  useEffect(() => {
    const clean = regForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
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
  }, [regForm.slug]);

  const loadOwnerWorkspace = useCallback(async () => {
    if (!isAuthenticated || !isOwnerOrStaff) return;
    try {
      const [ov, hl, br] = await Promise.all([
        apiFetch<TenantOverview>('/api/v1/tenant/overview'),
        apiFetch<HallInfo[]>('/api/v1/venue/halls'),
        apiFetch<BrandingPayload>('/api/v1/tenant/branding'),
      ]);
      setOverview(ov);
      setHalls(hl);
      setBranding({
        ...br,
        logo_light_url: br.logo_light_url || '',
        logo_dark_url: br.logo_dark_url || '',
        favicon_url: br.favicon_url || '',
        hero_tagline_ar: br.hero_tagline_ar || '',
        hero_tagline_en: br.hero_tagline_en || '',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : tr('تعذر تحميل بيانات المنشأة', 'Failed to load workspace'));
    }
  }, [isAuthenticated, isOwnerOrStaff]);

  useEffect(() => {
    loadOwnerWorkspace();
  }, [loadOwnerWorkspace]);

  const handleRegisterVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegBusy(true);
    setRegError(null);
    try {
      const res = await apiFetch<{ slug: string; access_token: string; user: AuthUser }>(
        '/api/v1/public/tenants/register',
        {
          method: 'POST',
          skipAuth: true,
          body: {
            ...regForm,
            slug: regForm.slug.trim().toLowerCase(),
            owner_email: regForm.owner_email.trim() || null,
            preferred_lang: locale,
          },
        }
      );
      loginSession(res.access_token, res.user, res.slug);
      setTenantSlug(res.slug);
      router.push(tenantPath(locale, res.slug, '/erp/dashboard'));
    } catch (err) {
      setRegError(err instanceof Error ? err.message : tr('فشل إنشاء المنشأة', 'Failed to register venue'));
      setRegBusy(false);
    }
  };

  const handleSaveHall = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const payload = {
        name: hallForm.name.trim(),
        name_ar: hallForm.name_ar.trim(),
        capacity_banquet: Number(hallForm.capacity_banquet),
        capacity_theater: Number(hallForm.capacity_theater),
        base_price: Number(hallForm.base_price),
        cleaning_buffer_minutes: Number(hallForm.cleaning_buffer_minutes),
        combinable_with_hall_id: hallForm.combinable_with_hall_id || null,
      };
      if (editingHallId) {
        await apiFetch(`/api/v1/venue/halls/${editingHallId}`, { method: 'PATCH', body: payload });
        setStatusMsg(tr('تم تحديث بيانات القاعة بنجاح.', 'Hall updated successfully.'));
      } else {
        await apiFetch('/api/v1/venue/halls', { method: 'POST', body: payload });
        setStatusMsg(tr('تمت إضافة القاعة بنجاح.', 'Hall added successfully.'));
      }
      setEditingHallId(null);
      setHallForm({
        name: '',
        name_ar: '',
        capacity_banquet: 300,
        capacity_theater: 500,
        base_price: 750000,
        cleaning_buffer_minutes: 120,
        combinable_with_hall_id: '',
      });
      await loadOwnerWorkspace();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : tr('فشل حفظ القاعة', 'Failed to save hall'));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await apiFetch('/api/v1/tenant/branding', {
        method: 'PUT',
        body: {
          ...branding,
          logo_light_url: branding.logo_light_url?.trim() || null,
          logo_dark_url: branding.logo_dark_url?.trim() || null,
          favicon_url: branding.favicon_url?.trim() || null,
          hero_tagline_ar: branding.hero_tagline_ar?.trim() || null,
          hero_tagline_en: branding.hero_tagline_en?.trim() || null,
        },
      });
      setStatusMsg(tr('تم حفظ إعدادات الهوية البصرية.', 'White-label branding saved.'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : tr('فشل حفظ الهوية البصرية', 'Failed to save branding'));
    } finally {
      setBusy(false);
    }
  };

  const activeSlug = overview?.slug || tenantSlug || 'almassa';
  const waPct = overview?.monthly_whatsapp_quota
    ? Math.min(100, Math.round((overview.whatsapp_used_this_month / overview.monthly_whatsapp_quota) * 100))
    : 0;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 text-start">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-500">
              <Sparkles className="h-3.5 w-3.5" />
              {tr('بوابة عملاء إيفنت ليدجر (لملاك القاعات)', 'EventLedger Client Portal — Venue Owners')}
            </span>
            <SpotlightHeading as="h1" className="mt-2 text-2xl sm:text-4xl">
              {overview ? overview.name : tr('إدارة المنشآت والباقات والتفعيل الفوري', 'SaaS Venue Control Plane & Self-Onboarding')}
            </SpotlightHeading>
          </div>

          {isAuthenticated && isOwnerOrStaff ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={tenantPath(locale, activeSlug, '/erp/dashboard')}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950"
              >
                <span>{tr('الدخول إلى نظام ERP', 'Open ERP Dashboard')}</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link
                href={tenantPath(locale, activeSlug, '/venue')}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <span>{tr('معاينة واجهة الحجز', 'Open Public Storefront')}</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  document.getElementById('onboarding')?.scrollIntoView({ behavior: 'smooth' });
                  setTimeout(() => venueNameRef.current?.focus(), 350);
                }}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-5 py-2 text-xs font-bold text-slate-950 shadow"
              >
                <Plus className="h-4 w-4" />
                <span>{tr('إنشاء حساب جديد لصالتك', 'Create Venue Account (Sign Up)')}</span>
              </button>
              <Link
                href={`/${locale}/staff-login`}
                className="inline-flex min-h-[42px] items-center rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {tr('تسجيل دخول ملاك القاعات', 'Venue Owner Sign In')}
              </Link>
            </div>
          )}
        </div>

        {statusMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500">{errorMsg}</div>
        )}

        {/* Section A: Authenticated Venue Owner Control Plane */}
        {isAuthenticated && isOwnerOrStaff ? (
          <section className="space-y-6">
            {overview && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SpotlightCard className="space-y-1 text-start">
                  <div className="text-xs text-slate-500">{tr('باقة الاشتراك', 'Subscription Tier')}</div>
                  <div className="font-mono text-xl font-extrabold text-[var(--brand-primary,#D4AF37)]">
                    {overview.subscription_tier} · {overview.subscription_status}
                  </div>
                  <div dir="ltr" className="font-mono text-xs text-slate-500">
                    /{overview.slug} ({overview.currency})
                  </div>
                </SpotlightCard>

                <SpotlightCard className="space-y-1 text-start">
                  <div className="text-xs text-slate-500">{tr('القاعات المستخدمة', 'Halls Provisioned')}</div>
                  <div className="font-mono text-xl font-extrabold">
                    {overview.halls_count} / {overview.max_halls}
                  </div>
                  <div className="text-xs text-slate-500">{tr('الحد الأقصى للباقة', 'Plan hall limit')}</div>
                </SpotlightCard>

                <SpotlightCard className="space-y-2 text-start">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {tr('استهلاك واتساب الشهري', 'Monthly WhatsApp Quota')}
                    </span>
                    <span dir="ltr" className="font-mono font-bold">
                      {overview.whatsapp_used_this_month} / {overview.monthly_whatsapp_quota}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className="h-full bg-[var(--brand-primary,#D4AF37)]" style={{ width: `${waPct}%` }} />
                  </div>
                </SpotlightCard>
              </div>
            )}

            <SpotlightCard className="space-y-5 text-start">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('إدارة القاعات والدمج (Partition Halls)', 'Halls & Partition-Merge Manager')}</span>
              </SpotlightHeading>

              {halls.length > 0 && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {halls.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800"
                    >
                      <div>
                        <div className="font-bold">
                          {h.name_ar} / {h.name}
                        </div>
                        <div className="text-slate-500">
                          {tr('مآدب', 'Banquet')}: {h.capacity_banquet} · {tr('مسرح', 'Theater')}: {h.capacity_theater} ·{' '}
                          {tr('تنظيف', 'Buffer')}: {h.cleaning_buffer_minutes}m
                        </div>
                        <div dir="ltr" className="font-mono font-semibold text-amber-500">
                          {Number(h.base_price).toLocaleString()} {overview?.currency || 'YER'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingHallId(h.id);
                          setHallForm({
                            name: h.name,
                            name_ar: h.name_ar,
                            capacity_banquet: h.capacity_banquet,
                            capacity_theater: h.capacity_theater,
                            base_price: h.base_price,
                            cleaning_buffer_minutes: h.cleaning_buffer_minutes,
                            combinable_with_hall_id: h.combinable_with_hall_id || '',
                          });
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                      >
                        {tr('تعديل', 'Edit')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleSaveHall} className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className={labelCls}>{tr('اسم القاعة (إنجليزي)', 'Hall Name (EN)')}</label>
                  <input required className={inputCls} value={hallForm.name} onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('اسم القاعة (عربي)', 'Hall Name (AR)')}</label>
                  <input required className={inputCls} value={hallForm.name_ar} onChange={(e) => setHallForm({ ...hallForm, name_ar: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('السعر الأساسي', 'Base Price')}</label>
                  <input type="number" min={0} required className={inputCls} value={hallForm.base_price} onChange={(e) => setHallForm({ ...hallForm, base_price: Number(e.target.value) })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('سعة المآدب', 'Banquet Capacity')}</label>
                  <input type="number" min={10} required className={inputCls} value={hallForm.capacity_banquet} onChange={(e) => setHallForm({ ...hallForm, capacity_banquet: Number(e.target.value) })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('سعة المسرح', 'Theater Capacity')}</label>
                  <input type="number" min={10} required className={inputCls} value={hallForm.capacity_theater} onChange={(e) => setHallForm({ ...hallForm, capacity_theater: Number(e.target.value) })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('هامش التنظيف (دقيقة)', 'Cleaning Buffer (min)')}</label>
                  <input type="number" min={0} required className={inputCls} value={hallForm.cleaning_buffer_minutes} onChange={(e) => setHallForm({ ...hallForm, cleaning_buffer_minutes: Number(e.target.value) })} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>{tr('قابلة للدمج مع القاعة', 'Combinable Partition Hall')}</label>
                  <select className={inputCls} value={hallForm.combinable_with_hall_id} onChange={(e) => setHallForm({ ...hallForm, combinable_with_hall_id: e.target.value })}>
                    <option value="">{tr('لا يوجد دمج', 'None')}</option>
                    {halls
                      .filter((h) => h.id !== editingHallId)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {isRtl ? h.name_ar : h.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{editingHallId ? tr('حفظ التعديل', 'Update Hall') : tr('إضافة قاعة', 'Add Hall')}</span>
                  </button>
                  {editingHallId && (
                    <button type="button" onClick={() => setEditingHallId(null)} className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-xs dark:border-slate-700">
                      {tr('إلغاء', 'Cancel')}
                    </button>
                  )}
                </div>
              </form>
            </SpotlightCard>

            <SpotlightCard className="space-y-4 text-start">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <Palette className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('الهوية البصرية البيضاء (Logos, Favicon & Colors)', 'White-Label Branding & Favicon Customizer')}</span>
              </SpotlightHeading>
              <form onSubmit={handleSaveBranding} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className={labelCls}>{tr('اللون الأساسي', 'Primary Color')}</label>
                  <input type="color" className="h-10 w-full cursor-pointer rounded border border-slate-300" value={branding.primary_color} onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('اللون الثانوي', 'Accent Color')}</label>
                  <input type="color" className="h-10 w-full cursor-pointer rounded border border-slate-300" value={branding.accent_color} onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('لون التوهج (Spotlight)', 'Spotlight Glow')}</label>
                  <input dir="ltr" className={inputCls} value={branding.spotlight_color} onChange={(e) => setBranding({ ...branding, spotlight_color: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('رابط الشعار (الوضع الفاتح)', 'Light Logo URL')}</label>
                  <input dir="ltr" className={inputCls} value={branding.logo_light_url || ''} onChange={(e) => setBranding({ ...branding, logo_light_url: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('رابط الشعار (الوضع الداكن)', 'Dark Logo URL')}</label>
                  <input dir="ltr" className={inputCls} value={branding.logo_dark_url || ''} onChange={(e) => setBranding({ ...branding, logo_dark_url: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('رابط الأيقونة (Favicon URL)', 'Favicon URL')}</label>
                  <input dir="ltr" className={inputCls} value={branding.favicon_url || ''} onChange={(e) => setBranding({ ...branding, favicon_url: e.target.value })} />
                </div>
                <div className="sm:col-span-3">
                  <button type="submit" disabled={busy} className="min-h-[42px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">
                    {tr('حفظ الهوية البصرية', 'Save White-Label Branding')}
                  </button>
                </div>
              </form>
            </SpotlightCard>
          </section>
        ) : (
          <SpotlightCard className="flex flex-wrap items-center justify-between gap-4 text-start">
            <div>
              <h2 className="text-base font-bold">
                {tr('هل لديك منشأة مسجلة بالفعل؟', 'Already have a registered venue workspace?')}
              </h2>
              <p className="text-xs text-slate-500">
                {tr(
                  'سجّل الدخول بحساب مالك القاعة لإدارة القاعات، الهوية البصرية، وحصص الواتساب.',
                  'Sign in with your venue owner account to manage halls, white-label branding, and quotas.'
                )}
              </p>
            </div>
            <Link
              href={`/${locale}/staff-login`}
              className="inline-flex min-h-[42px] items-center rounded-xl bg-[var(--brand-primary,#D4AF37)] px-5 py-2 text-xs font-bold text-slate-950"
            >
              {tr('تسجيل دخول المالك / الموظف', 'Venue Owner Sign In')}
            </Link>
          </SpotlightCard>
        )}

        {/* Section B: Multi-Currency SaaS Subscription Tiers */}
        <section id="pricing" className="scroll-mt-20 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SpotlightHeading as="h2" className="text-start text-2xl">
              {tr('باقات الاشتراك للمنشآت والقاعات', 'SaaS Subscription Tiers')}
            </SpotlightHeading>
            <div className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              {(['USD', 'SAR', 'YER'] as const).map((curr) => (
                <button
                  key={curr}
                  type="button"
                  onClick={() => setDisplayCurrency(curr)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    displayCurrency === curr ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {curr}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {TIERS.map((tier) => {
              const selected = regForm.subscription_tier === tier.code;
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
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-amber-500 dark:bg-slate-800">
                        {tier.code}
                      </span>
                    </div>
                    <div dir="ltr" className="mt-4 text-start font-mono text-3xl font-extrabold text-[var(--brand-primary,#D4AF37)]">
                      {rate.symbol}
                      {amount}
                      <span className="text-xs font-normal text-slate-500">{tr(' / شهرياً', ' / mo')}</span>
                    </div>
                    <ul className="mt-5 space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
                      {(isRtl ? tier.featuresAr : tier.featuresEn).map((feat) => (
                        <li key={feat} className="flex items-center gap-2">
                          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRegForm({ ...regForm, subscription_tier: tier.code });
                      document.getElementById('onboarding')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className={`mt-6 min-h-[44px] w-full rounded-xl py-2.5 text-xs font-bold transition ${
                      selected
                        ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                        : 'border border-slate-300 bg-slate-50 text-slate-800 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                    }`}
                  >
                    {selected ? tr('✔ الباقة المختارة', '✔ Selected Plan') : tr('اختيار الباقة', 'Select Plan')}
                  </button>
                </SpotlightCard>
              );
            })}
          </div>
        </section>

        {/* Section C: Instant Venue Self-Onboarding */}
        <section id="onboarding" className="scroll-mt-20 grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="space-y-4 text-start lg:col-span-2">
            <SpotlightHeading as="h2" className="text-start text-2xl">
              {tr('التفعيل الفوري لمنصة الصالة', 'Instant Venue Self-Onboarding')}
            </SpotlightHeading>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {tr(
                'يقوم النظام تلقائياً بتجهيز النطاق الفرعي، دليل الحسابات المزدوج، إعدادات المحاسبة، وحساب المالك.',
                'Automatically provisions your subdomain, default double-entry Chart of Accounts, AccountingConfig, and OWNER account.'
              )}
            </p>
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0 text-amber-500" />
                <span dir="ltr">{`https://${regForm.slug || 'your-venue'}.eventledger.cloud`}</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 shrink-0 text-emerald-500" />
                <span>{tr('عزل كامل لبيانات كل منشأة (Strict tenant_id)', 'Strict multi-tenant database isolation')}</span>
              </div>
            </div>
          </div>

          <SpotlightCard className="text-start lg:col-span-3">
            <form onSubmit={handleRegisterVenue} className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <span>{tr('الباقة المختارة:', 'Selected Subscription Tier:')}</span>
                <strong className="font-mono text-amber-500">{regForm.subscription_tier}</strong>
              </div>
              {regError && <p className="rounded-lg bg-rose-500/10 p-2.5 text-xs text-rose-500">{regError}</p>}
              <div>
                <label className={labelCls}>{tr('اسم المنشأة / القاعة', 'Venue Name')}</label>
                <input ref={venueNameRef} required className={inputCls} value={regForm.venue_name} onChange={(e) => setRegForm({ ...regForm, venue_name: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{tr('المعرف (Subdomain Slug)', 'Subdomain Slug')}</label>
                  <input
                    required
                    dir="ltr"
                    className={`${inputCls} font-mono`}
                    value={regForm.slug}
                    onChange={(e) => setRegForm({ ...regForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  />
                  {slugAvailable !== null && (
                    <p className={`mt-1 text-[11px] ${slugAvailable ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {slugAvailable ? tr('النطاق متاح', 'Slug available') : tr('النطاق محجوز أو غير صالح', 'Slug unavailable')}
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>{tr('العملة', 'Currency')}</label>
                  <select className={inputCls} value={regForm.currency} onChange={(e) => setRegForm({ ...regForm, currency: e.target.value })}>
                    <option value="YER">YER</option>
                    <option value="SAR">SAR</option>
                    <option value="USD">USD</option>
                    <option value="AED">AED</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{tr('اسم المالك', 'Owner Full Name')}</label>
                  <input required className={inputCls} value={regForm.owner_name} onChange={(e) => setRegForm({ ...regForm, owner_name: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('الجوال / واتساب', 'Owner Phone')}</label>
                  <input required dir="ltr" className={inputCls} value={regForm.owner_phone} onChange={(e) => setRegForm({ ...regForm, owner_phone: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{tr('البريد الإلكتروني', 'Owner Email')}</label>
                  <input type="email" dir="ltr" className={inputCls} value={regForm.owner_email} onChange={(e) => setRegForm({ ...regForm, owner_email: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{tr('كلمة المرور', 'Password')}</label>
                  <input type="password" required minLength={8} className={inputCls} value={regForm.owner_password} onChange={(e) => setRegForm({ ...regForm, owner_password: e.target.value })} />
                </div>
              </div>
              <button
                type="submit"
                disabled={regBusy}
                className="min-h-[44px] w-full rounded-xl bg-[var(--brand-primary,#D4AF37)] py-3 text-sm font-bold text-slate-950 shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {regBusy ? tr('جاري إنشاء المنشأة...', 'Provisioning Venue...') : tr('تفعيل المنصة والدخول إلى ERP', 'Provision Venue & Launch ERP')}
              </button>
            </form>
          </SpotlightCard>
        </section>

        {/* Section D: Native Windows .exe & Android .apk Download Cards */}
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <SpotlightCard id="download-windows" className="scroll-mt-20 flex flex-col justify-between gap-4 text-start">
            <div className="space-y-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary,#D4AF37)]/15 text-[var(--brand-primary,#D4AF37)]">
                <Laptop className="h-5 w-5" />
              </div>
              <SpotlightHeading as="h3" className="text-lg">
                {tr('تطبيق سطح المكتب لنظام ويندوز (Windows .exe)', 'EventLedger Desktop for Windows (.exe)')}
              </SpotlightHeading>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {tr(
                  'مبني بتقنية Tauri v2 مع طابور مزامنة أوفلاين، دعم طابعات الإيصالات، وربط مباشر بمساحة عمل منشأتك.',
                  'Built with Tauri v2 featuring offline-first sync queue, thermal printer support, and direct workspace binding.'
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="#onboarding" className="inline-flex min-h-[40px] items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950">
                {tr('تحميل حزمة Windows .exe', 'Download Windows .exe')}
              </a>
              <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                Tauri v2 · x64
              </span>
            </div>
          </SpotlightCard>

          <SpotlightCard id="download-android" className="scroll-mt-20 flex flex-col justify-between gap-4 text-start">
            <div className="space-y-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary,#D4AF37)]/15 text-[var(--brand-primary,#D4AF37)]">
                <Smartphone className="h-5 w-5" />
              </div>
              <SpotlightHeading as="h3" className="text-lg">
                {tr('تطبيق أندرويد الميداني (Android .apk)', 'EventLedger Mobile for Android (.apk)')}
              </SpotlightHeading>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {tr(
                  'مبني بتقنية Capacitor 6 لمسح تصاريح QR على البوابات، فحص الأضرار بالكاميرا، ومتابعة جدول التشغيل BEO.',
                  'Powered by Capacitor 6 for gate QR scanning, camera-backed damage inspections, and live BEO operational checklists.'
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="#onboarding" className="inline-flex min-h-[40px] items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950">
                {tr('تحميل حزمة Android .apk', 'Download Android .apk')}
              </a>
              <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                Capacitor 6 · Android 10+
              </span>
            </div>
          </SpotlightCard>
        </section>
      </main>
    </div>
  );
}
