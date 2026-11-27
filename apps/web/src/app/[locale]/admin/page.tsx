'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Building2,
  CheckCircle2,
  Globe,
  KeyRound,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';
import { BackButton } from '@/components/ui/BackButton';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, getAccessToken, tenantPath } from '@/lib/api';
import type { StaffRole, SubscriptionTier } from '@/lib/types';

type AdminTab = 'TENANTS' | 'GOVERNANCE' | 'USERS';

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
  tax_rate?: number;
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

interface AdminGovRow {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
  scope: 'TENANT_ADMIN' | 'SUPER_ADMIN';
  target_entity_type: string;
  target_entity_id: string;
  request_title: string;
  current_values: Record<string, unknown>;
  proposed_values: Record<string, unknown>;
  status: string;
  requester_name: string;
  requester_remarks: string | null;
  reviewer_remarks: string | null;
  created_at: string;
}

interface AdminUserRow {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
  user_type: string;
  full_name: string;
  email: string | null;
  phone: string;
  is_active: boolean;
  phone_verified: boolean;
  last_login_at: string | null;
  staff_role: StaffRole | null;
  custom_role_title: string | null;
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

  const [activeTab, setActiveTab] = useState<AdminTab>('TENANTS');
  const { currentSearch } = useNavigationHistory();

  useEffect(() => {
    if (!currentSearch) return;
    const t = new URLSearchParams(currentSearch).get('tab');
    if (t === 'TENANTS' || t === 'GOVERNANCE' || t === 'USERS') {
      setActiveTab(t);
    }
  }, [currentSearch]);
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [kpis, setKpis] = useState<AdminKpis | null>(null);
  const [govRequests, setGovRequests] = useState<AdminGovRow[]>([]);
  const [govRemarksMap, setGovRemarksMap] = useState<Record<string, string>>({});
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userTenantFilter, setUserTenantFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<'ALL' | SubscriptionTier>('ALL');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plan/Quota/CNAME/Identity Editor Modal
  const [editTenant, setEditTenant] = useState<AdminTenantRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    slug: '',
    currency: 'USD',
    tax_rate: 5,
    subscription_tier: 'PRO' as SubscriptionTier,
    max_halls: 5,
    whatsapp_monthly_quota: 2000,
    custom_domain: '',
    custom_domain_verified: false,
  });

  // Admin Create/Reset User Modal
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    tenant_id: '',
    user_type: 'INTERNAL_STAFF',
    full_name: '',
    phone: '',
    email: '',
    password: '',
    staff_role: 'ADMIN' as StaffRole,
    custom_role_title: '',
  });
  const [resetUserTarget, setResetUserTarget] = useState<AdminUserRow | null>(null);
  const [userNewPassword, setUserNewPassword] = useState('');

  // Owner Password Reset Modal
  const [resetTenant, setResetTenant] = useState<AdminTenantRow | null>(null);
  const [ownerNewPassword, setOwnerNewPassword] = useState('');

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setError('Super-admin access required');
      return;
    }
    try {
      const [res, govs, usrs] = await Promise.all([
        apiFetch<{ kpis?: AdminKpis; tenants: AdminTenantRow[] } | AdminTenantRow[]>('/api/v1/admin/tenants'),
        apiFetch<AdminGovRow[]>('/api/v1/governance/change-requests').catch(() => [] as AdminGovRow[]),
        apiFetch<AdminUserRow[]>('/api/v1/admin/users').catch(() => [] as AdminUserRow[]),
      ]);
      if (Array.isArray(res)) {
        setTenants(res);
      } else {
        setTenants(res.tenants || []);
        if (res.kpis) setKpis(res.kpis);
      }
      setGovRequests(govs);
      setAdminUsers(usrs);
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
      name: r.name,
      slug: r.slug,
      currency: r.currency || 'USD',
      tax_rate: r.tax_rate ?? 5,
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
        name: editForm.name.trim(),
        slug: editForm.slug.trim(),
        currency: editForm.currency.trim().toUpperCase(),
        tax_rate: Number(editForm.tax_rate),
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

  const resolveGov = async (id: string, decision: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_AMENDMENT') => {
    try {
      await apiFetch(`/api/v1/governance/change-requests/${id}/resolve`, {
        method: 'POST',
        body: { decision, remarks: govRemarksMap[id]?.trim() || null },
      });
      setNotice(tr(`تم تنفيذ قرار المنصة (${decision})`, `Platform governance decision: ${decision}`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Governance resolution failed');
    }
  };

  const toggleAdminUserActive = async (u: AdminUserRow) => {
    try {
      await apiFetch(`/api/v1/admin/users/${u.id}`, {
        method: 'PATCH',
        body: { is_active: !u.is_active },
      });
      setNotice(u.is_active ? tr(`تم تعليق ${u.full_name}`, `Suspended ${u.full_name}`) : tr(`تم تفعيل ${u.full_name}`, `Activated ${u.full_name}`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user status');
    }
  };

  const submitCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/v1/admin/users', {
        method: 'POST',
        body: {
          tenant_id: newUserForm.user_type === 'SUPER_ADMIN' ? null : newUserForm.tenant_id || null,
          user_type: newUserForm.user_type,
          full_name: newUserForm.full_name.trim(),
          phone: newUserForm.phone.trim(),
          email: newUserForm.email.trim() || null,
          password: newUserForm.password,
          staff_role: newUserForm.user_type === 'INTERNAL_STAFF' ? newUserForm.staff_role : null,
          custom_role_title: newUserForm.staff_role === 'OTHER' ? newUserForm.custom_role_title.trim() || null : null,
        },
      });
      setNotice(tr('تم إنشاء حساب المستخدم بنجاح', 'Platform/Tenant user created'));
      setCreateUserOpen(false);
      setNewUserForm({
        tenant_id: '',
        user_type: 'INTERNAL_STAFF',
        full_name: '',
        phone: '',
        email: '',
        password: '',
        staff_role: 'ADMIN',
        custom_role_title: '',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const submitResetAdminUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserTarget || userNewPassword.length < 8) return;
    try {
      await apiFetch(`/api/v1/admin/users/${resetUserTarget.id}/reset-password`, {
        method: 'POST',
        body: { new_password: userNewPassword },
      });
      setNotice(tr(`تم تعيين كلمة مرور جديدة للمستخدم ${resetUserTarget.full_name}`, `Reset password for ${resetUserTarget.full_name}`));
      setResetUserTarget(null);
      setUserNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset user password');
    }
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

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return adminUsers.filter((u) => {
      if (userTenantFilter === 'PLATFORM' && u.tenant_id !== null) return false;
      if (userTenantFilter !== 'ALL' && userTenantFilter !== 'PLATFORM' && u.tenant_id !== userTenantFilter) return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.tenant_slug || '').toLowerCase().includes(q)
      );
    });
  }, [adminUsers, userSearch, userTenantFilter]);

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

        <div className="flex gap-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
          {([
            { id: 'TENANTS', labelAr: 'دليل المنشآت', labelEn: 'Registered Venues' },
            { id: 'GOVERNANCE', labelAr: 'اعتمادات المنصة', labelEn: 'Platform Governance' },
            { id: 'USERS', labelAr: 'مستخدمو المنصة والمستأجرون', labelEn: 'Cross-Tenant Users' },
          ] as { id: AdminTab; labelAr: string; labelEn: string }[]).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-1 py-3 text-xs transition ${
                  active
                    ? 'border-[var(--brand-primary,#D4AF37)] font-bold text-slate-900 dark:text-white'
                    : 'border-transparent font-medium text-slate-500 hover:text-[var(--brand-primary,#D4AF37)]'
                }`}
              >
                {isRtl ? tab.labelAr : tab.labelEn}
              </button>
            );
          })}
        </div>

        {activeTab === 'TENANTS' && (
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
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${r.custom_domain_verified ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-200 text-slate-600 dark:bg-slate-800'
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
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${r.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'
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
        )}

        {activeTab === 'GOVERNANCE' && (
          <SpotlightCard className="space-y-4 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('طابور اعتماد تعديلات المنشآت والحوكمة', 'Super-Admin Governance Queue')}</span>
            </SpotlightHeading>
            {govRequests.length === 0 ? (
              <p className="text-xs text-slate-500">{tr('لا توجد طلبات حوكمة مسجلة.', 'No governance change requests found.')}</p>
            ) : (
              <div className="space-y-3">
                {govRequests.map((g) => (
                  <div key={g.id} className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold">
                        {g.request_title}{' '}
                        {g.tenant_slug && <span className="font-mono text-amber-500">(/{g.tenant_slug})</span>}
                      </div>
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                        {g.scope} · {g.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {tr('مقدم الطلب:', 'Requester:')} {g.requester_name} · {g.target_entity_type}
                      {g.requester_remarks ? ` — "${g.requester_remarks}"` : ''}
                    </div>
                    <div className="grid gap-2 rounded-lg bg-slate-100 p-2 font-mono text-[11px] dark:bg-slate-900 sm:grid-cols-2">
                      <div>
                        <div className="text-[10px] font-bold text-slate-500">{tr('الحالي', 'Current')}</div>
                        <pre className="whitespace-pre-wrap">{JSON.stringify(g.current_values, null, 1)}</pre>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-emerald-500">{tr('المقترح', 'Proposed')}</div>
                        <pre className="whitespace-pre-wrap">{JSON.stringify(g.proposed_values, null, 1)}</pre>
                      </div>
                    </div>
                    {(g.status === 'PENDING' || g.status === 'RETURNED_FOR_AMENDMENT') && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={govRemarksMap[g.id] || ''}
                          onChange={(e) => setGovRemarksMap((prev) => ({ ...prev, [g.id]: e.target.value }))}
                          placeholder={tr('ملاحظات مدير المنصة...', 'Super-Admin remarks...')}
                          className="min-h-[34px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                        />
                        <button
                          type="button"
                          onClick={() => resolveGov(g.id, 'APPROVED')}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white"
                        >
                          {tr('اعتماد', 'Approve')}
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveGov(g.id, 'RETURNED_FOR_AMENDMENT')}
                          className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950"
                        >
                          {tr('إعادة للتعديل', 'Return')}
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveGov(g.id, 'REJECTED')}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 font-bold text-white"
                        >
                          {tr('رفض', 'Reject')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SpotlightCard>
        )}

        {activeTab === 'USERS' && (
          <SpotlightCard className="space-y-4 text-start">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('دليل المستخدمين عبر المنشآت والمنصة', 'Platform & Cross-Tenant Users Directory')}</span>
              </SpotlightHeading>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder={tr('بحث بالاسم، الجوال، البريد...', 'Search name, phone, email...')}
                  className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                <select
                  value={userTenantFilter}
                  onChange={(e) => setUserTenantFilter(e.target.value)}
                  className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="ALL">{tr('كل المنشآت', 'All Workspaces')}</option>
                  <option value="PLATFORM">{tr('إدارة المنصة', 'Platform Root')}</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (/{t.slug})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setCreateUserOpen(true)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{tr('إضافة مستخدم', 'Create User')}</span>
                </button>
              </div>
            </div>

            <ResponsiveDataList
              data={filteredUsers}
              locale={locale}
              mobileCardHeader={(u) => u.full_name}
              columns={[
                {
                  key: 'user',
                  headerAr: 'المستخدم',
                  headerEn: 'User',
                  render: (u) => (
                    <div>
                      <div className="font-bold">{u.full_name}</div>
                      <div dir="ltr" className="font-mono text-[11px] text-slate-500">
                        {u.phone} {u.email ? `· ${u.email}` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'tenant',
                  headerAr: 'المنشأة والدور',
                  headerEn: 'Workspace & Role',
                  render: (u) => (
                    <div className="text-xs">
                      <div className="font-semibold">{u.tenant_slug ? `/${u.tenant_slug}` : 'PLATFORM_ROOT'}</div>
                      <div className="text-[11px] text-amber-500">
                        {u.user_type} {u.staff_role ? `· ${u.custom_role_title || u.staff_role}` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'controls',
                  headerAr: 'التحكم',
                  headerEn: 'Controls',
                  render: (u) => (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserTarget(u);
                          setUserNewPassword('');
                        }}
                        className="rounded border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-500"
                      >
                        {tr('كلمة المرور', 'Reset PW')}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAdminUserActive(u)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          u.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'
                        }`}
                      >
                        {u.is_active ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          </SpotlightCard>
        )}
      </main>

      {/* Edit Plan / Quotas / CNAME Modal */}
      {editTenant && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-base">
                {tr(`تعديل باقة وحصص (${editTenant.slug})`, `Edit Plan & Quotas (${editTenant.slug})`)}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setEditTenant(null)} />
                <button type="button" onClick={() => setEditTenant(null)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form onSubmit={saveEditor} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">{tr('اسم المنشأة', 'Venue Name')}</label>
                  <input
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('المعرف (Slug)', 'Slug')}</label>
                  <input
                    dir="ltr"
                    required
                    value={editForm.slug}
                    onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('العملة', 'Currency')}</label>
                  <input
                    dir="ltr"
                    value={editForm.currency}
                    onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('نسبة الضريبة %', 'Tax Rate %')}</label>
                  <input
                    dir="ltr"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={editForm.tax_rate}
                    onChange={(e) => setEditForm({ ...editForm, tax_rate: Number(e.target.value) })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
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
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-base">
                {tr(`إعادة تعيين كلمة مرور المالك (${resetTenant.slug})`, `Reset Owner Password (${resetTenant.slug})`)}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setResetTenant(null)} />
                <button type="button" onClick={() => setResetTenant(null)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
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

      {/* Admin Create User Modal */}
      {createUserOpen && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-base">
                {tr('إنشاء حساب مستخدم عبر المنصة', 'Create Platform / Tenant User')}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setCreateUserOpen(false)} />
                <button type="button" onClick={() => setCreateUserOpen(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form onSubmit={submitCreateAdminUser} className="space-y-3 text-xs">
              <select
                value={newUserForm.user_type}
                onChange={(e) => setNewUserForm({ ...newUserForm, user_type: e.target.value })}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="INTERNAL_STAFF">INTERNAL_STAFF</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              </select>
              {newUserForm.user_type !== 'SUPER_ADMIN' && (
                <select
                  required
                  value={newUserForm.tenant_id}
                  onChange={(e) => setNewUserForm({ ...newUserForm, tenant_id: e.target.value })}
                  className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">{tr('اختر المنشأة...', 'Select Tenant...')}</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (/{t.slug})
                    </option>
                  ))}
                </select>
              )}
              <input
                required
                value={newUserForm.full_name}
                onChange={(e) => setNewUserForm({ ...newUserForm, full_name: e.target.value })}
                placeholder={tr('الاسم الكامل', 'Full Name')}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                dir="ltr"
                required
                value={newUserForm.phone}
                onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                placeholder="+96777..."
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                dir="ltr"
                type="email"
                value={newUserForm.email}
                onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                placeholder="email@domain.com"
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              {newUserForm.user_type === 'INTERNAL_STAFF' && (
                <select
                  value={newUserForm.staff_role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, staff_role: e.target.value as StaffRole })}
                  className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="OWNER">OWNER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="FINANCE">FINANCE</option>
                  <option value="OPS_MANAGER">OPS_MANAGER</option>
                  <option value="SALES">SALES</option>
                  <option value="SECURITY">SECURITY</option>
                  <option value="STAFF">STAFF</option>
                  <option value="OTHER">OTHER</option>
                </select>
              )}
              {newUserForm.staff_role === 'OTHER' && newUserForm.user_type === 'INTERNAL_STAFF' && (
                <input
                  value={newUserForm.custom_role_title}
                  onChange={(e) => setNewUserForm({ ...newUserForm, custom_role_title: e.target.value })}
                  placeholder={tr('المسمى المخصص للدور', 'Custom Role Title')}
                  className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
              )}
              <input
                type="password"
                required
                minLength={8}
                value={newUserForm.password}
                onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                placeholder={tr('كلمة المرور (8+ أحرف)', 'Password (8+ chars)')}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreateUserOpen(false)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                  {tr('إنشاء', 'Create')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}

      {/* Admin User Password Reset Modal */}
      {resetUserTarget && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-base">
                {tr(`تعيين كلمة مرور (${resetUserTarget.full_name})`, `Reset User Password (${resetUserTarget.full_name})`)}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setResetUserTarget(null)} />
                <button type="button" onClick={() => setResetUserTarget(null)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form onSubmit={submitResetAdminUserPassword} className="space-y-3 text-xs">
              <input
                type="password"
                required
                minLength={8}
                value={userNewPassword}
                onChange={(e) => setUserNewPassword(e.target.value)}
                placeholder={tr('كلمة المرور الجديدة (8+ أحرف)', 'New password (8+ chars)')}
                className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setResetUserTarget(null)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" disabled={userNewPassword.length < 8} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950 disabled:opacity-50">
                  {tr('تعيين', 'Reset')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}
    </div>
  );
}
