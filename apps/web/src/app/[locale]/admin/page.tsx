'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, CheckCircle2, Globe, KeyRound, Search, ShieldAlert, Sliders, TrendingUp, X } from 'lucide-react';
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
  whatsapp_monthly_quota?: number;
  whatsapp_used_this_month?: number;
  currency: string;
  is_active: boolean;
  halls_count?: number;
  users_count: number;
  events_count: number;
  total_gmv: number;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  created_at: string;
}

interface AdminKpis {
  total_tenants: number;
  active_tenants: number;
  total_events: number;
  total_gmv: number;
}

export default function SuperAdminConsolePage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [kpis, setKpis] = useState<AdminKpis | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<'ALL' | SubscriptionTier>('ALL');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plan/Quota/CNAME Editor Modal
  const [editTenant, setEditTenant] = useState<AdminTenantRow | null>(null);
  const [editForm, setEditForm] = useState({
    subscription_tier: 'PRO' as SubscriptionTier,
    max_halls: 5,
    whatsapp_monthly_quota: 2000,
    custom_domain: '',
    custom_domain_verified: false,
  });

  // Owner Password Reset Modal
  const [resetTenant, setResetTenant] = useState<AdminTenantRow | null>(null);
  const [ownerNewPassword, setOwnerNewPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ kpis?: AdminKpis; tenants: AdminTenantRow[] } | AdminTenantRow[]>(
        '/api/v1/admin/tenants'
      );
      if (Array.isArray(res)) {
        setTenants(res);
      } else {
        setTenants(res.tenants || []);
        if (res.kpis) setKpis(res.kpis);
      }
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

  const openEditor = (r: AdminTenantRow) => {
    setEditTenant(r);
    setEditForm({
      subscription_tier: r.subscription_tier,
      max_halls: r.max_halls ?? 5,
      whatsapp_monthly_quota: r.whatsapp_monthly_quota ?? r.monthly_whatsapp_quota ?? 2000,
      custom_domain: r.custom_domain || '',
      custom_domain_verified: r.custom_domain_verified,
    });
  };

  const saveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTenant) return;
    await patchTenant(
      editTenant.id,
      {
        subscription_tier: editForm.subscription_tier,
        max_halls: Number(editForm.max_halls),
        whatsapp_monthly_quota: Number(editForm.whatsapp_monthly_quota),
        custom_domain: editForm.custom_domain.trim(),
        custom_domain_verified: editForm.custom_domain_verified,
      },
      tr(`تم تحديث إعدادات ${editTenant.slug}`, `Updated settings for ${editTenant.slug}`)
    );
    setEditTenant(null);
  };

  const submitOwnerPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTenant || ownerNewPassword.length < 8) return;
    try {
      await apiFetch(`/api/v1/admin/tenants/${resetTenant.id}/reset-owner-password`, {
        method: 'POST',
        body: { new_password: ownerNewPassword },
      });
      setNotice(tr(`تم تعيين كلمة مرور جديدة لمالك ${resetTenant.slug}`, `Reset owner password for ${resetTenant.slug}`));
      setResetTenant(null);
      setOwnerNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    }
  };

  const filteredTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tenants.filter((t) => {
      if (planFilter !== 'ALL' && t.subscription_tier !== planFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.custom_domain || '').toLowerCase().includes(q) ||
        (t.owner_email || '').toLowerCase().includes(q) ||
        (t.owner_name || '').toLowerCase().includes(q)
      );
    });
  }, [planFilter, searchQuery, tenants]);

  const activeCount = kpis?.active_tenants ?? tenants.filter((t) => t.is_active).length;
  const totalGmv = kpis?.total_gmv ?? tenants.reduce((acc, t) => acc + (t.total_gmv || 0), 0);
  const totalEvents = kpis?.total_events ?? tenants.reduce((acc, t) => acc + (t.events_count || 0), 0);
  const verifiedDomains = tenants.filter((t) => Boolean(t.custom_domain && t.custom_domain_verified)).length;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-16 dark:bg-slate-950">
      <AppHeader locale={locale} title={tr('إدارة المنصة (Super Admin)', 'Platform Super Admin')} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-start">
            <SpotlightHeading as="h1" className="text-start text-2xl">
              {tr('لوحة تحكم مدير المنصة والمستأجرين', 'Platform Super-Admin Console')}
            </SpotlightHeading>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {tr(
                'إدارة المنشآت المشتركة، الباقات، الحصص، نطاقات CNAME، وحسابات الملاك.',
                'Manage tenant activation, subscription tiers, quotas, custom CNAME domains, and owner passwords.'
              )}
            </p>
          </div>
          <Link
            href={`/${locale}`}
            className="min-h-[40px] rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:text-slate-200"
          >
            {tr('صفحة المنصة الرئيسية', 'SaaS Home')}
          </Link>
        </div>

        {/* Platform 4-KPI Strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Building2 className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('المنشآت النشطة', 'Active Tenants')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">
              {activeCount} / {kpis?.total_tenants ?? tenants.length}
            </div>
          </SpotlightCard>

          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span>{tr('إجمالي GMV المنصة', 'Platform GMV')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{totalGmv.toLocaleString()}</div>
          </SpotlightCard>

          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-sky-500" />
              <span>{tr('إجمالي الفعاليات', 'Total Events')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{totalEvents}</div>
          </SpotlightCard>

          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Globe className="h-4 w-4 text-amber-500" />
              <span>{tr('نطاقات CNAME الموثقة', 'Verified CNAMEs')}</span>
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
            <Link href={`/${locale}/staff-login`} className="rounded-lg bg-rose-500 px-3 py-1.5 font-bold text-white">
              {tr('تسجيل دخول مدير المنصة', 'Sign in as Super Admin')}
            </Link>
          </SpotlightCard>
        )}

        <SpotlightCard className="space-y-4 text-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SpotlightHeading as="h2" className="text-start text-lg">
              {tr('دليل المنشآت والاشتراكات', 'Registered Venue Tenants')}
            </SpotlightHeading>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 start-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tr('بحث بالمنشأة، النطاق، المالك...', 'Search venue, slug, owner...')}
                  className="min-h-[36px] rounded-lg border border-slate-300 bg-white ps-8 pe-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value as 'ALL' | SubscriptionTier)}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="ALL">{tr('كل الباقات', 'All Plans')}</option>
                <option value="BASIC">BASIC</option>
                <option value="PRO">PRO</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </div>
          </div>

          <ResponsiveDataList
            data={filteredTenants}
            locale={locale}
            mobileCardHeader={(r) => `${r.name} (/${r.slug})`}
            columns={[
              {
                key: 'venue',
                headerAr: 'المنشأة والمالك',
                headerEn: 'Venue & Owner',
                render: (r) => (
                  <div className="space-y-1 text-start">
                    <div className="font-semibold">{r.name}</div>
                    {r.owner_name && (
                      <div className="text-[11px] text-slate-500">
                        {r.owner_name} · <span dir="ltr">{r.owner_email || r.owner_phone}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-amber-600 dark:bg-slate-800 dark:text-amber-400">
                        /{r.slug}
                      </span>
                      <Link href={tenantPath(locale, r.slug, '/venue')} className="text-[var(--brand-primary,#D4AF37)] underline">
                        {tr('الواجهة', 'Storefront')}
                      </Link>
                      <Link href={tenantPath(locale, r.slug, '/erp/dashboard')} className="text-sky-500 underline">
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
                  <div className="space-y-1 text-start text-xs">
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-500">
                      {r.subscription_tier}
                    </span>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('قاعات', 'Halls')}: {r.halls_count ?? 0}/{r.max_halls ?? 5} · WA: {r.whatsapp_used_this_month ?? 0}/
                      {r.whatsapp_monthly_quota ?? r.monthly_whatsapp_quota ?? 2000}
                    </div>
                  </div>
                ),
              },
              {
                key: 'cname',
                headerAr: 'نطاق CNAME',
                headerEn: 'Custom CNAME',
                render: (r) => (
                  <div className="space-y-1 text-start text-xs">
                    <div dir="ltr" className="font-mono text-[11px]">
                      {r.custom_domain || '-'}
                    </div>
                    {r.custom_domain && (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.custom_domain_verified ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-200 text-slate-600 dark:bg-slate-800'
                        }`}
                      >
                        {r.custom_domain_verified ? tr('موثق ✓', 'Verified ✓') : tr('غير موثق', 'Unverified')}
                      </span>
                    )}
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
                      {r.users_count} {tr('مستخدم', 'users')} · {r.events_count} {tr('فعالية', 'events')}
                    </div>
                  </div>
                ),
              },
              {
                key: 'actions',
                headerAr: 'التحكم',
                headerEn: 'Controls',
                render: (r) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditor(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold hover:border-[var(--brand-primary)] dark:border-slate-700"
                    >
                      <Sliders className="h-3 w-3" />
                      <span>{tr('تعديل', 'Edit')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetTenant(r);
                        setOwnerNewPassword('');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] font-semibold text-amber-500"
                    >
                      <KeyRound className="h-3 w-3" />
                      <span>{tr('كلمة المالك', 'Owner PW')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchTenant(
                          r.id,
                          { is_active: !r.is_active },
                          r.is_active ? tr(`تم إيقاف ${r.slug}`, `Suspended ${r.slug}`) : tr(`تم تفعيل ${r.slug}`, `Activated ${r.slug}`)
                        )
                      }
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        r.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'
                      }`}
                    >
                      {r.is_active ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </SpotlightCard>
      </main>

      {/* Edit Plan / Quotas / CNAME Modal */}
      {editTenant && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h3" className="text-base">
                {tr(`تعديل باقة وحصص (${editTenant.slug})`, `Edit Plan & Quotas (${editTenant.slug})`)}
              </SpotlightHeading>
              <button type="button" onClick={() => setEditTenant(null)} aria-label="Close" className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={saveEditor} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">{tr('الباقة', 'Subscription Tier')}</label>
                <select
                  value={editForm.subscription_tier}
                  onChange={(e) => setEditForm({ ...editForm, subscription_tier: e.target.value as SubscriptionTier })}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="BASIC">BASIC</option>
                  <option value="PRO">PRO</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">{tr('الحد الأقصى للقاعات', 'Max Halls')}</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.max_halls}
                    onChange={(e) => setEditForm({ ...editForm, max_halls: Number(e.target.value) })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('حصة واتساب الشهرية', 'Monthly WA Quota')}</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.whatsapp_monthly_quota}
                    onChange={(e) => setEditForm({ ...editForm, whatsapp_monthly_quota: Number(e.target.value) })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold">{tr('نطاق CNAME المخصص', 'Custom CNAME Domain')}</label>
                <input
                  dir="ltr"
                  value={editForm.custom_domain}
                  onChange={(e) => setEditForm({ ...editForm, custom_domain: e.target.value })}
                  placeholder="events.venue.ye"
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={editForm.custom_domain_verified}
                  onChange={(e) => setEditForm({ ...editForm, custom_domain_verified: e.target.checked })}
                />
                <span>{tr('توثيق نطاق CNAME', 'CNAME Domain Verified')}</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditTenant(null)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                  {tr('حفظ', 'Save')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}

      {/* Owner Password Reset Modal */}
      {resetTenant && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h3" className="text-base">
                {tr(`إعادة تعيين كلمة مرور المالك (${resetTenant.slug})`, `Reset Owner Password (${resetTenant.slug})`)}
              </SpotlightHeading>
              <button type="button" onClick={() => setResetTenant(null)} aria-label="Close" className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitOwnerPasswordReset} className="space-y-3 text-xs">
              <p className="text-slate-500">
                {resetTenant.owner_email || resetTenant.owner_phone || resetTenant.name}
              </p>
              <input
                type="password"
                required
                minLength={8}
                value={ownerNewPassword}
                onChange={(e) => setOwnerNewPassword(e.target.value)}
                placeholder={tr('كلمة المرور الجديدة (8+ أحرف)', 'New password (8+ chars)')}
                className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setResetTenant(null)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" disabled={ownerNewPassword.length < 8} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950 disabled:opacity-50">
                  {tr('تعيين كلمة المرور', 'Reset Owner Password')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}
    </div>
  );
}
