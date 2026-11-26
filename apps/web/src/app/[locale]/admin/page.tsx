'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, CheckCircle2, Globe, ShieldAlert, TrendingUp } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, tenantPath } from '@/lib/api';
import type { SubscriptionTier } from '@/lib/types';

interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  subscription_tier: SubscriptionTier;
  subscription_status?: string;
  max_halls?: number;
  monthly_whatsapp_quota?: number;
  whatsapp_used_this_month?: number;
  currency: string;
  is_active: boolean;
  halls_count?: number;
  users_count: number;
  events_count: number;
  total_gmv: number;
  created_at: string;
}

export default function SuperAdminConsolePage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ tenants: AdminTenantRow[] } | AdminTenantRow[]>('/api/v1/admin/tenants');
      const rows = Array.isArray(res) ? res : res.tenants || [];
      setTenants(rows);
      setDomainDrafts((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const r of rows) {
          if (next[r.id] === undefined) next[r.id] = r.custom_domain || '';
        }
        return next;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Super-admin access required');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchTenant = async (tenantId: string, payload: Record<string, unknown>, successMsg: string) => {
    try {
      await apiFetch(`/api/v1/admin/tenants/${tenantId}`, {
        method: 'PATCH',
        body: payload,
      });
      setNotice(successMsg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const activeCount = tenants.filter((t) => t.is_active).length;
  const totalGmv = tenants.reduce((acc, t) => acc + (t.total_gmv || 0), 0);
  const totalEvents = tenants.reduce((acc, t) => acc + (t.events_count || 0), 0);
  const verifiedDomains = tenants.filter((t) => Boolean(t.custom_domain && t.custom_domain_verified)).length;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-16 dark:bg-slate-950">
      <AppHeader locale={locale} title={isRtl ? 'إدارة المنصة (Super Admin)' : 'Platform Super Admin'} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-start">
            <SpotlightHeading as="h1" className="text-start text-2xl">
              {isRtl ? 'لوحة تحكم مدير المنصة والمستأجرين' : 'Platform Super-Admin Console'}
            </SpotlightHeading>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {isRtl
                ? 'إدارة المنشآت المشتركة، الباقات، نطاقات CNAME المخصصة، ومؤشرات GMV.'
                : 'Manage tenant activation, subscription tiers, custom CNAME domains, and GMV metrics.'}
            </p>
          </div>
          <Link
            href={`/${locale}`}
            className="min-h-[40px] rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:text-slate-200"
          >
            {isRtl ? 'صفحة المنصة الرئيسية' : 'SaaS Home'}
          </Link>
        </div>

        {/* Platform KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Building2 className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'المنشآت النشطة' : 'Active Tenants'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">
              {activeCount} / {tenants.length}
            </div>
          </SpotlightCard>

          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span>{isRtl ? 'إجمالي GMV المنصة' : 'Platform GMV'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{totalGmv.toLocaleString()}</div>
          </SpotlightCard>

          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-sky-500" />
              <span>{isRtl ? 'إجمالي الفعاليات' : 'Total Events'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{totalEvents}</div>
          </SpotlightCard>

          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Globe className="h-4 w-4 text-amber-500" />
              <span>{isRtl ? 'نطاقات CNAME الموثقة' : 'Verified CNAMEs'}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{verifiedDomains}</div>
          </SpotlightCard>
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {notice}
          </SpotlightCard>
        )}

        {error && (
          <SpotlightCard className="flex flex-wrap items-center justify-between gap-3 border-rose-500/40 bg-rose-500/10 py-3 text-start text-xs text-rose-500 dark:text-rose-300">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Link
              href={`/${locale}/login`}
              className="rounded-lg bg-rose-500 px-3 py-1.5 font-bold text-white"
            >
              {isRtl ? 'تسجيل دخول مدير المنصة' : 'Sign in as Super Admin'}
            </Link>
          </SpotlightCard>
        )}

        <SpotlightCard className="space-y-4 text-start">
          <SpotlightHeading as="h2" className="text-start text-lg">
            {isRtl ? 'دليل المنشآت والاشتراكات' : 'Registered Venue Tenants'}
          </SpotlightHeading>

          <ResponsiveDataList
            data={tenants}
            locale={locale}
            mobileCardHeader={(r) => `${r.name} (/${r.slug})`}
            columns={[
              {
                key: 'venue',
                headerAr: 'المنشأة والنطاق',
                headerEn: 'Venue & Slug',
                render: (r) => (
                  <div className="space-y-1 text-start">
                    <div className="font-semibold">{r.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-amber-600 dark:bg-slate-800 dark:text-amber-400">
                        /{r.slug}
                      </span>
                      <Link
                        href={tenantPath(locale, r.slug, '/venue')}
                        className="text-[var(--brand-primary,#D4AF37)] underline"
                      >
                        {isRtl ? 'الواجهة' : 'Storefront'}
                      </Link>
                      <Link
                        href={tenantPath(locale, r.slug, '/erp/dashboard')}
                        className="text-sky-500 underline"
                      >
                        ERP
                      </Link>
                    </div>
                  </div>
                ),
              },
              {
                key: 'tier',
                headerAr: 'الباقة والحصص',
                headerEn: 'Plan & Quotas',
                render: (r) => (
                  <div className="space-y-1.5 text-start">
                    <select
                      aria-label={`Subscription tier for ${r.slug}`}
                      value={r.subscription_tier}
                      onChange={(e) =>
                        patchTenant(
                          r.id,
                          { subscription_tier: e.target.value as SubscriptionTier },
                          isRtl ? `تم تحديث باقة ${r.slug}` : `Updated plan for ${r.slug}`
                        )
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="BASIC">BASIC</option>
                      <option value="PRO">PRO</option>
                      <option value="ENTERPRISE">ENTERPRISE</option>
                    </select>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isRtl
                        ? `قاعات: ${r.halls_count ?? 0}/${r.max_halls ?? 5} | واتساب: ${r.whatsapp_used_this_month ?? 0}/${r.monthly_whatsapp_quota ?? 2000}`
                        : `Halls: ${r.halls_count ?? 0}/${r.max_halls ?? 5} | WA: ${r.whatsapp_used_this_month ?? 0}/${r.monthly_whatsapp_quota ?? 2000}`}
                    </div>
                  </div>
                ),
              },
              {
                key: 'cname',
                headerAr: 'نطاق CNAME المخصص',
                headerEn: 'Custom CNAME',
                render: (r) => (
                  <div className="space-y-1.5 text-start">
                    <div className="flex items-center gap-1.5">
                      <input
                        dir="ltr"
                        value={domainDrafts[r.id] ?? ''}
                        onChange={(e) => setDomainDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="events.venue.ye"
                        className="w-36 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          patchTenant(
                            r.id,
                            { custom_domain: (domainDrafts[r.id] || '').trim() },
                            isRtl ? `تم حفظ النطاق لـ ${r.slug}` : `Saved domain for ${r.slug}`
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                      >
                        {isRtl ? 'حفظ' : 'Save'}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        patchTenant(
                          r.id,
                          { custom_domain_verified: !r.custom_domain_verified },
                          isRtl ? `تم تحديث توثيق النطاق لـ ${r.slug}` : `Updated CNAME verification for ${r.slug}`
                        )
                      }
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        r.custom_domain_verified
                          ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {r.custom_domain_verified
                        ? isRtl
                          ? 'CNAME موثق ✓'
                          : 'CNAME Verified ✓'
                        : isRtl
                          ? 'غير موثق (تفعيل)'
                          : 'Unverified (Verify)'}
                    </button>
                  </div>
                ),
              },
              {
                key: 'gmv',
                headerAr: 'النشاط و GMV',
                headerEn: 'Activity & GMV',
                render: (r) => (
                  <div className="space-y-0.5 text-start">
                    <div dir="ltr" className="text-start font-mono text-xs font-bold text-[var(--brand-primary,#D4AF37)]">
                      {Number(r.total_gmv || 0).toLocaleString()} {r.currency}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {r.users_count} {isRtl ? 'مستخدم' : 'users'} · {r.events_count} {isRtl ? 'فعالية' : 'events'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'active',
                headerAr: 'الحالة',
                headerEn: 'Status',
                render: (r) => (
                  <button
                    type="button"
                    onClick={() =>
                      patchTenant(
                        r.id,
                        { is_active: !r.is_active },
                        isRtl
                          ? `تم ${r.is_active ? 'إيقاف' : 'تفعيل'} ${r.slug}`
                          : `${r.is_active ? 'Suspended' : 'Activated'} ${r.slug}`
                      )
                    }
                    className={`min-h-[36px] rounded-full px-3 py-1 text-xs font-semibold ${
                      r.is_active
                        ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400'
                        : 'bg-rose-500/20 text-rose-500 dark:text-rose-400'
                    }`}
                  >
                    {r.is_active ? (isRtl ? 'نشط' : 'Active') : isRtl ? 'موقوف' : 'Suspended'}
                  </button>
                ),
              },
            ]}
          />
        </SpotlightCard>
      </main>
    </div>
  );
}
