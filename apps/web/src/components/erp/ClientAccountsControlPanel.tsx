'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  Eye,
  FileText,
  KeyRound,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuthSession } from '@/components/providers/auth-provider';
import { BackButton } from '@/components/ui/BackButton';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export interface RichClientRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  user_type: string;
  is_active: boolean;
  phone_verified?: boolean;
  last_login_at?: string | null;
  created_at: string;
  client_category: 'INDIVIDUAL_B2C' | 'CORPORATE_B2B';
  custom_category_label?: string | null;
  company_name: string | null;
  tax_id: string | null;
  national_id_or_cr: string | null;
  billing_address?: string | null;
  notes?: string | null;
  vip_tier: string;
  is_archived?: boolean;
  archived_at?: string | null;
  archive_reason?: string | null;
  events_count: number;
  total_contracted: number;
  outstanding_balance: number;
}

interface ClientOverviewPayload {
  client: RichClientRow;
  bookings: {
    id: string;
    event_code: string;
    title?: string | null;
    event_type: string;
    hall_name: string;
    hall_name_ar: string;
    start_time: string;
    end_time: string;
    status: string;
    guest_count: number;
  }[];
  invoices: {
    id: string;
    event_code: string;
    invoice_number: string;
    total_amount: number;
    paid_amount: number;
    security_deposit_amount: number;
    deposit_status: string;
    status: string;
    milestones: {
      id: string;
      title: string;
      amount_due: number;
      paid_amount: number;
      payment_method: string | null;
      receipt_url: string | null;
      is_security_deposit: boolean;
      status: string;
    }[];
  }[];
  contracts: {
    id: string;
    event_code: string;
    contract_number: string;
    client_signed_at: string | null;
    client_signature_name: string | null;
  }[];
  delegates: {
    id: string;
    full_name: string;
    phone: string;
    delegate_role: string;
  }[];
  audit_logs: {
    id: string;
    action: string;
    actor_name: string;
    created_at: string;
  }[];
}

interface Props {
  locale: 'ar' | 'en';
  clients: RichClientRow[];
  onRefresh: () => Promise<void> | void;
}

export function ClientAccountsControlPanel({ locale, clients, onRefresh }: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const { user } = useAuthSession();
  const canArchiveOneTimeClient =
    user?.user_type === 'SUPER_ADMIN' ||
    (user?.user_type === 'INTERNAL_STAFF' &&
      (user.staff_role === 'OWNER' || user.staff_role === 'ADMIN' || user.staff_role === 'FINANCE'));

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'INDIVIDUAL_B2C' | 'CORPORATE_B2B' | 'VIP' | 'SUSPENDED' | 'OTHER' | 'ARCHIVED'>('ALL');
  const [archivedClients, setArchivedClients] = useState<RichClientRow[]>([]);
  const [archiveReason, setArchiveReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    password: '',
    user_type: 'CLIENT_PRIMARY',
    client_category: 'INDIVIDUAL_B2C' as 'INDIVIDUAL_B2C' | 'CORPORATE_B2B',
    custom_category_label: '',
    vip_tier: 'STANDARD',
    company_name: '',
    tax_id: '',
    national_id_or_cr: '',
    billing_address: '',
    notes: '',
  });

  // Manage / Edit modal
  const [managedClient, setManagedClient] = useState<RichClientRow | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    is_active: true,
    vip_tier: 'STANDARD',
    client_category: 'INDIVIDUAL_B2C' as 'INDIVIDUAL_B2C' | 'CORPORATE_B2B',
    custom_category_label: '',
    company_name: '',
    tax_id: '',
    national_id_or_cr: '',
    billing_address: '',
    notes: '',
  });
  const [newPassword, setNewPassword] = useState('');

  // 360-degree overview drawer
  const [overview, setOverview] = useState<ClientOverviewPayload | null>(null);
  const [overviewTab, setOverviewTab] = useState<'BOOKINGS' | 'FINANCE' | 'CONTRACTS_DELEGATES' | 'AUDIT'>('BOOKINGS');

  const kpis = useMemo(() => {
    const active = clients.filter((c) => c.is_active).length;
    const corporate = clients.filter((c) => c.client_category === 'CORPORATE_B2B').length;
    const vip = clients.filter((c) => c.vip_tier && c.vip_tier !== 'STANDARD').length;
    const outstanding = clients.reduce((s, c) => s + (c.outstanding_balance || 0), 0);
    return { total: clients.length, active, corporate, vip, outstanding };
  }, [clients]);

  const loadArchivedClients = useCallback(async () => {
    try {
      const allRows = await apiFetch<RichClientRow[]>('/api/v1/tenant/clients?include_archived=true');
      setArchivedClients(allRows.filter((r) => Boolean(r.is_archived)));
    } catch {
      // ignore if user lacks permission
    }
  }, []);

  useEffect(() => {
    if (filter === 'ARCHIVED') {
      loadArchivedClients();
    }
  }, [filter, loadArchivedClients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = filter === 'ARCHIVED' ? archivedClients : clients.filter((c) => !c.is_archived);
    return source.filter((c) => {
      if (filter === 'INDIVIDUAL_B2C' && c.client_category !== 'INDIVIDUAL_B2C') return false;
      if (filter === 'CORPORATE_B2B' && c.client_category !== 'CORPORATE_B2B') return false;
      if (filter === 'VIP' && (!c.vip_tier || c.vip_tier === 'STANDARD')) return false;
      if (filter === 'SUSPENDED' && c.is_active) return false;
      if (filter === 'OTHER' && !c.custom_category_label && c.user_type === 'CLIENT_PRIMARY') return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.tax_id || '').toLowerCase().includes(q) ||
        (c.custom_category_label || '').toLowerCase().includes(q)
      );
    });
  }, [archivedClients, clients, filter, search]);

  const createClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/tenant/clients', {
        method: 'POST',
        body: {
          full_name: createForm.full_name.trim(),
          phone: createForm.phone.trim(),
          email: createForm.email.trim() || null,
          password: createForm.password.trim() || null,
          user_type: createForm.user_type,
          client_category: createForm.client_category,
          custom_category_label: createForm.custom_category_label.trim() || null,
          vip_tier: createForm.vip_tier.trim() || 'STANDARD',
          company_name: createForm.company_name.trim() || null,
          tax_id: createForm.tax_id.trim() || null,
          national_id_or_cr: createForm.national_id_or_cr.trim() || null,
          billing_address: createForm.billing_address.trim() || null,
          notes: createForm.notes.trim() || null,
        },
      });
      setShowCreate(false);
      setCreateForm({
        full_name: '',
        phone: '',
        email: '',
        password: '',
        user_type: 'CLIENT_PRIMARY',
        client_category: 'INDIVIDUAL_B2C',
        custom_category_label: '',
        vip_tier: 'STANDARD',
        company_name: '',
        tax_id: '',
        national_id_or_cr: '',
        billing_address: '',
        notes: '',
      });
      setNotice(tr('تم إنشاء حساب العميل بنجاح.', 'Client account created.'));
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل إنشاء حساب العميل', 'Failed to create client'));
    } finally {
      setBusy(false);
    }
  };

  const openManage = (c: RichClientRow) => {
    setManagedClient(c);
    setEditForm({
      full_name: c.full_name,
      phone: c.phone,
      email: c.email || '',
      is_active: c.is_active,
      vip_tier: c.vip_tier || 'STANDARD',
      client_category: c.client_category,
      custom_category_label: c.custom_category_label || '',
      company_name: c.company_name || '',
      tax_id: c.tax_id || '',
      national_id_or_cr: c.national_id_or_cr || '',
      billing_address: c.billing_address || '',
      notes: c.notes || '',
    });
    setNewPassword('');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managedClient) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/tenant/clients/${managedClient.id}`, {
        method: 'PATCH',
        body: {
          full_name: editForm.full_name.trim(),
          phone: editForm.phone.trim(),
          email: editForm.email.trim() || null,
          is_active: editForm.is_active,
          vip_tier: editForm.vip_tier,
          client_category: editForm.client_category,
          custom_category_label: editForm.custom_category_label.trim() || null,
          company_name: editForm.company_name.trim() || null,
          tax_id: editForm.tax_id.trim() || null,
          national_id_or_cr: editForm.national_id_or_cr.trim() || null,
          billing_address: editForm.billing_address.trim() || null,
          notes: editForm.notes.trim() || null,
        },
      });
      setManagedClient(null);
      setNotice(tr('تم تحديث ملف العميل وملاحظاته.', 'Client account updated.'));
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل تحديث بيانات العميل', 'Failed to update client'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: RichClientRow) => {
    try {
      await apiFetch(`/api/v1/tenant/clients/${c.id}`, {
        method: 'PATCH',
        body: { is_active: !c.is_active },
      });
      setNotice(c.is_active ? tr('تم إيقاف حساب العميل.', 'Client suspended.') : tr('تم إعادة تفعيل حساب العميل.', 'Client reactivated.'));
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const resetPw = async () => {
    if (!managedClient || newPassword.length < 8) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tenant/clients/${managedClient.id}/reset-password`, {
        method: 'POST',
        body: { new_password: newPassword },
      });
      setNewPassword('');
      setNotice(tr('تم تعيين كلمة المرور المؤقتة.', 'Temporary password reset.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setBusy(false);
    }
  };

  const openOverview = async (clientId: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<ClientOverviewPayload>(`/api/v1/tenant/clients/${clientId}/overview`);
      setOverview(data);
      setOverviewTab('BOOKINGS');
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر تحميل ملف العميل 360', 'Failed to load client 360 view'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SpotlightCard className="space-y-4 text-start">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
            <span>{tr('لوحة إدارة حسابات العملاء (عرض 360°)', 'Rich Tenant Client Accounts Control Panel (360°)')}</span>
          </SpotlightHeading>
          <p className="text-xs text-slate-500">
            {tr(
              'إدارة شاملة لحسابات العملاء، الفئات المخصصة، الحجوزات، الفواتير وإيصالات السداد، العقود والمفوضين.',
              'Create/edit client accounts, manage VIP & custom classifications, and inspect 360° bookings, payment proofs, contracts & audit trails.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-bold text-slate-950"
        >
          <Plus className="h-4 w-4" />
          <span>{tr('إضافة عميل جديد', 'Create Client')}</span>
        </button>
      </div>

      {/* Mini KPI Strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-800">
          <div className="text-slate-500">{tr('إجمالي العملاء', 'Total Clients')}</div>
          <div className="font-mono text-lg font-extrabold">{kpis.total}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-800">
          <div className="text-slate-500">{tr('النشطون / الشركات', 'Active / B2B')}</div>
          <div className="font-mono text-lg font-extrabold">{kpis.active} / {kpis.corporate}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-800">
          <div className="text-slate-500">{tr('فئات مميزة / VIP', 'VIP / Custom Tiers')}</div>
          <div className="font-mono text-lg font-extrabold text-amber-500">{kpis.vip}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-800">
          <div className="text-slate-500">{tr('الأرصدة المستحقة', 'Outstanding Balance')}</div>
          <div dir="ltr" className="font-mono text-lg font-extrabold text-emerald-500">{kpis.outstanding.toLocaleString()}</div>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Search + Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(
            [
              { key: 'ALL', ar: 'الكل', en: 'All' },
              { key: 'INDIVIDUAL_B2C', ar: 'أفراد B2C', en: 'B2C' },
              { key: 'CORPORATE_B2B', ar: 'شركات B2B', en: 'B2B' },
              { key: 'VIP', ar: 'VIP / مميز', en: 'VIP' },
              { key: 'SUSPENDED', ar: 'موقوف', en: 'Suspended' },
              { key: 'OTHER', ar: 'أخرى / مفوضين', en: 'Other / Delegates' },
              { key: 'ARCHIVED', ar: 'المؤرشفة', en: 'Archived' },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 font-semibold ${
                filter === f.key
                  ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              {tr(f.ar, f.en)}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('بحث بالاسم، الجوال، الشركة، الضريبة...', 'Search name, phone, company, tax...')}
            className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white ps-9 pe-3 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      </div>

      <ResponsiveDataList
        data={filteredClients}
        locale={locale}
        mobileCardHeader={(c) => `${c.full_name} (${c.vip_tier})`}
        columns={[
          {
            key: 'name',
            headerAr: 'العميل',
            headerEn: 'Client',
            render: (c) => (
              <div className="text-xs">
                <div className="font-bold">{c.full_name}</div>
                <div dir="ltr" className="text-[11px] text-slate-500">
                  {c.phone} {c.email ? `· ${c.email}` : ''}
                </div>
                {c.notes && <div className="mt-0.5 truncate text-[10px] text-amber-600 dark:text-amber-300">{c.notes}</div>}
              </div>
            ),
          },
          {
            key: 'cat',
            headerAr: 'الفئة والشركة',
            headerEn: 'Category / Company',
            render: (c) => (
              <div className="text-xs">
                <span className="font-mono font-semibold">{c.custom_category_label || c.client_category}</span>
                {c.company_name && (
                  <div className="text-[11px] text-slate-500">
                    {c.company_name} ({c.tax_id || '-'})
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'vip',
            headerAr: 'الفئة VIP',
            headerEn: 'Tier',
            render: (c) => (
              <span className="rounded-full bg-[var(--brand-primary,#D4AF37)]/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-500">
                {c.vip_tier}
              </span>
            ),
          },
          {
            key: 'stats',
            headerAr: 'الفعاليات والرصيد',
            headerEn: 'Bookings & Balance',
            render: (c) => (
              <div className="text-xs">
                <div>{c.events_count} {tr('فعالية', 'events')}</div>
                <div dir="ltr" className="font-mono text-[11px] text-amber-500">
                  {c.outstanding_balance.toLocaleString()}
                </div>
              </div>
            ),
          },
          {
            key: 'status',
            headerAr: 'الحالة',
            headerEn: 'Status',
            render: (c) => (
              <button
                type="button"
                onClick={() => toggleActive(c)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  c.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'
                }`}
              >
                {c.is_active ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}
              </button>
            ),
          },
          {
            key: 'actions',
            headerAr: 'الإجراءات',
            headerEn: 'Actions',
            render: (c) => (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openOverview(c.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{tr('360°', '360°')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => openManage(c)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                >
                  {tr('إدارة', 'Manage')}
                </button>
              </div>
            ),
          },
        ]}
      />

      {/* Create Client Modal */}
      {showCreate && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-lg">
                {tr('إنشاء حساب عميل جديد', 'Create Tenant Client Account')}
              </SpotlightHeading>
              <BackButton locale={locale} compact onClick={() => setShowCreate(false)} />
            </div>
            <form onSubmit={createClient} className="space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold">{tr('الاسم الكامل', 'Full Name')}</label>
                  <input required value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الجوال', 'Phone')}</label>
                  <input dir="ltr" required value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('البريد الإلكتروني', 'Email')}</label>
                  <input dir="ltr" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('كلمة المرور المبدئية (اختياري)', 'Initial Password (optional)')}</label>
                  <input type="password" minLength={8} value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('نوع الحساب', 'Account Type')}</label>
                  <select value={createForm.user_type} onChange={(e) => setCreateForm({ ...createForm, user_type: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950">
                    <option value="CLIENT_PRIMARY">{tr('عميل رئيسي', 'Primary Client')}</option>
                    <option value="CLIENT_DELEGATE">{tr('مفوض / منسق', 'Delegate')}</option>
                    <option value="EXTERNAL_VENDOR">{tr('مورد خارجي', 'External Vendor')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('مستوى VIP', 'VIP Tier')}</label>
                  <SelectOrOther
                    value={createForm.vip_tier}
                    onChange={(v) => setCreateForm({ ...createForm, vip_tier: v })}
                    locale={locale}
                    options={[
                      { value: 'STANDARD', labelAr: 'عادي (STANDARD)', labelEn: 'Standard' },
                      { value: 'GOLD', labelAr: 'ذهبي (GOLD)', labelEn: 'Gold' },
                      { value: 'VIP', labelAr: 'كبار الشخصيات (VIP)', labelEn: 'VIP' },
                    ]}
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('فئة العميل', 'Category')}</label>
                  <select value={createForm.client_category} onChange={(e) => setCreateForm({ ...createForm, client_category: e.target.value as 'INDIVIDUAL_B2C' | 'CORPORATE_B2B' })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950">
                    <option value="INDIVIDUAL_B2C">INDIVIDUAL_B2C</option>
                    <option value="CORPORATE_B2B">CORPORATE_B2B</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('تصنيف مخصص (أخرى)', 'Custom Classification (Other)')}</label>
                  <input value={createForm.custom_category_label} onChange={(e) => setCreateForm({ ...createForm, custom_category_label: e.target.value })} placeholder={tr('مثال: هيئة دبلوماسية / منظمة', 'e.g. Diplomatic Mission / NGO')} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الشركة', 'Company')}</label>
                  <input value={createForm.company_name} onChange={(e) => setCreateForm({ ...createForm, company_name: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الرقم الضريبي / السجل', 'Tax ID / CR')}</label>
                  <input dir="ltr" value={createForm.tax_id} onChange={(e) => setCreateForm({ ...createForm, tax_id: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold">{tr('ملاحظات الحساب', 'Account Notes / Remarks')}</label>
                <textarea rows={2} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" disabled={busy} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                  {tr('حفظ العميل', 'Create Client')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}

      {/* Edit & Password Reset Modal */}
      {managedClient && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-lg">
                {tr(`إدارة حساب العميل (${managedClient.full_name})`, `Manage Client (${managedClient.full_name})`)}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setManagedClient(null)} />
                <button type="button" onClick={() => setManagedClient(null)} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={saveEdit} className="space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold">{tr('الاسم الكامل', 'Full Name')}</label>
                  <input required value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الجوال', 'Phone')}</label>
                  <input dir="ltr" required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('البريد الإلكتروني', 'Email')}</label>
                  <input dir="ltr" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('مستوى VIP', 'VIP Tier')}</label>
                  <SelectOrOther
                    value={editForm.vip_tier}
                    onChange={(v) => setEditForm({ ...editForm, vip_tier: v })}
                    locale={locale}
                    options={[
                      { value: 'STANDARD', labelAr: 'عادي (STANDARD)', labelEn: 'Standard' },
                      { value: 'GOLD', labelAr: 'ذهبي (GOLD)', labelEn: 'Gold' },
                      { value: 'VIP', labelAr: 'كبار الشخصيات (VIP)', labelEn: 'VIP' },
                    ]}
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('فئة العميل', 'Client Category')}</label>
                  <select value={editForm.client_category} onChange={(e) => setEditForm({ ...editForm, client_category: e.target.value as 'INDIVIDUAL_B2C' | 'CORPORATE_B2B' })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
                    <option value="INDIVIDUAL_B2C">INDIVIDUAL_B2C</option>
                    <option value="CORPORATE_B2B">CORPORATE_B2B</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('تصنيف مخصص', 'Custom Label')}</label>
                  <input value={editForm.custom_category_label} onChange={(e) => setEditForm({ ...editForm, custom_category_label: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('اسم الشركة', 'Company')}</label>
                  <input value={editForm.company_name} onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الرقم الضريبي / الهوية', 'Tax ID / CR')}</label>
                  <input dir="ltr" value={editForm.tax_id} onChange={(e) => setEditForm({ ...editForm, tax_id: e.target.value })} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold">{tr('ملاحظات الفريق الداخلي', 'Internal Remarks & Notes')}</label>
                <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 font-semibold dark:border-slate-800">
                <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
                <span>{tr('تفعيل دخول العميل (نشط)', 'Account Active')}</span>
              </label>
              <div className="flex justify-end gap-2">
                <button type="submit" disabled={busy} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                  {tr('حفظ التعديلات', 'Save Changes')}
                </button>
              </div>
            </form>

            <div className="space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
              <div className="flex items-center gap-1.5 font-bold">
                <KeyRound className="h-4 w-4 text-amber-500" />
                <span>{tr('تعيين كلمة مرور مؤقتة', 'Reset Password')}</span>
              </div>
              <div className="flex gap-2">
                <input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={tr('8+ أحرف', 'New password (8+ chars)')} className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                <button type="button" disabled={newPassword.length < 8 || busy} onClick={resetPw} className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 font-bold text-amber-500 disabled:opacity-40">
                  {tr('تعيين', 'Reset')}
                </button>
              </div>
            </div>

            {canArchiveOneTimeClient && (
              <div className="space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-bold">
                  <Archive className="h-4 w-4 text-amber-500" />
                  <span>{tr('أرشفة عميل الفعالية الواحدة (بعد انتهاء الفعالية ورد التأمين)', 'Archive One-Time Client (After Event End & Deposit Settlement)')}</span>
                </div>
                {managedClient.is_archived ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-slate-200">
                    <div>
                      <div className="font-bold text-amber-400">{tr('الحساب مؤرشف', 'Account Archived')}</div>
                      <div className="text-[11px]">{managedClient.archive_reason || '-'}</div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await apiFetch(`/api/v1/tenant/clients/${managedClient.id}/unarchive`, { method: 'POST' });
                          setNotice(tr('تم استعادة العميل إلى القائمة النشطة.', 'Client restored to active list.'));
                          setManagedClient(null);
                          await Promise.all([onRefresh(), loadArchivedClients()]);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Unarchive failed');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{tr('استعادة للتنشيط', 'Unarchive')}</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={archiveReason}
                      onChange={(e) => setArchiveReason(e.target.value)}
                      placeholder={tr('سبب الأرشفة (اختياري)...', 'Archive reason (optional)...')}
                      className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await apiFetch(`/api/v1/tenant/clients/${managedClient.id}/archive`, {
                            method: 'POST',
                            body: { reason: archiveReason.trim() || null },
                          });
                          setArchiveReason('');
                          setNotice(tr('تمت أرشفة عميل الفعالية الواحدة مع حفظ السجل التاريخي.', 'One-time client archived; historical records preserved.'));
                          setManagedClient(null);
                          await Promise.all([onRefresh(), loadArchivedClients()]);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Archive failed');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 font-bold text-rose-500"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      <span>{tr('أرشفة العميل', 'Archive Client')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </SpotlightCard>
        </div>
      )}

      {/* 360-Degree Client Overview Modal */}
      {overview && (
        <div dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <SpotlightCard className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto text-start">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <SpotlightHeading as="h3" className="text-lg">
                  {overview.client.full_name} — {tr('ملف العميل الشامل 360°', '360° Client Dossier')}
                </SpotlightHeading>
                <div dir="ltr" className="text-xs text-slate-500">
                  {overview.client.phone} · {overview.client.email || '-'} · {overview.client.vip_tier}
                </div>
              </div>
              <BackButton locale={locale} compact onClick={() => setOverview(null)} />
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <div className="text-slate-500">{tr('الحجوزات', 'Bookings')}</div>
                <div className="font-mono font-bold">{overview.bookings.length}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <div className="text-slate-500">{tr('إجمالي العقود', 'Contracted')}</div>
                <div dir="ltr" className="font-mono font-bold">{overview.client.total_contracted.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <div className="text-slate-500">{tr('المتبقي', 'Outstanding')}</div>
                <div dir="ltr" className="font-mono font-bold text-amber-500">{overview.client.outstanding_balance.toLocaleString()}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-xs dark:border-slate-800">
              {(
                [
                  { id: 'BOOKINGS', icon: Building2, ar: `الحجوزات (${overview.bookings.length})`, en: `Bookings (${overview.bookings.length})` },
                  { id: 'FINANCE', icon: FileText, ar: `الفواتير والإيصالات (${overview.invoices.length})`, en: `Invoices & Proofs (${overview.invoices.length})` },
                  { id: 'CONTRACTS_DELEGATES', icon: UserCheck, ar: `العقود والمفوضون (${overview.contracts.length + overview.delegates.length})`, en: `Contracts & Delegates` },
                  { id: 'AUDIT', icon: ShieldCheck, ar: `السجل والملاحظات (${overview.audit_logs.length})`, en: `Audit & Remarks (${overview.audit_logs.length})` },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOverviewTab(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold ${
                      overviewTab === t.id ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : 'border border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tr(t.ar, t.en)}</span>
                  </button>
                );
              })}
            </div>

            {overviewTab === 'BOOKINGS' && (
              <div className="space-y-2 text-xs">
                {overview.bookings.length === 0 ? (
                  <p className="text-slate-500">{tr('لا توجد حجوزات.', 'No bookings recorded.')}</p>
                ) : (
                  overview.bookings.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                      <div>
                        <div className="font-bold">
                          <span className="font-mono text-amber-500">{b.event_code}</span> · {b.title || b.event_type}
                        </div>
                        <div className="text-slate-500">
                          {isRtl ? b.hall_name_ar : b.hall_name} · {b.start_time.slice(0, 16).replace('T', ' ')} · {b.guest_count} {tr('ضيف', 'guests')}
                        </div>
                      </div>
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-white">{b.status}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {overviewTab === 'FINANCE' && (
              <div className="space-y-3 text-xs">
                {overview.invoices.length === 0 ? (
                  <p className="text-slate-500">{tr('لا توجد فواتير.', 'No invoices found.')}</p>
                ) : (
                  overview.invoices.map((inv) => (
                    <div key={inv.id} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex justify-between font-bold">
                        <span className="font-mono">{inv.invoice_number} ({inv.event_code})</span>
                        <span>{inv.paid_amount.toLocaleString()} / {inv.total_amount.toLocaleString()} · {inv.status}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {tr('التأمين:', 'Deposit:')} {inv.security_deposit_amount.toLocaleString()} ({inv.deposit_status})
                      </div>
                      <div className="space-y-1">
                        {inv.milestones.map((m) => (
                          <div key={m.id} className="flex items-center justify-between rounded bg-slate-100 px-2.5 py-1.5 dark:bg-slate-900">
                            <span>{m.title} ({m.amount_due.toLocaleString()})</span>
                            <span className="font-mono">{m.status}{m.receipt_url ? ' · Proof' : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {overviewTab === 'CONTRACTS_DELEGATES' && (
              <div className="space-y-3 text-xs">
                <div className="space-y-1.5">
                  <div className="font-bold">{tr('العقود', 'Contracts')}</div>
                  {overview.contracts.map((c) => (
                    <div key={c.id} className="flex justify-between rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <span className="font-mono font-bold">{c.contract_number} ({c.event_code})</span>
                      <span>{c.client_signed_at ? `${tr('موقع:', 'Signed:')} ${c.client_signature_name}` : tr('بانتظار التوقيع', 'Pending signature')}</span>
                    </div>
                  ))}
                  {overview.contracts.length === 0 && <p className="text-slate-500">{tr('لا توجد عقود.', 'No contracts.')}</p>}
                </div>
                <div className="space-y-1.5">
                  <div className="font-bold">{tr('المفوضون', 'Authorized Delegates')}</div>
                  {overview.delegates.map((d) => (
                    <div key={d.id} className="flex justify-between rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <span>{d.full_name} ({d.delegate_role})</span>
                      <span dir="ltr" className="font-mono text-slate-500">{d.phone}</span>
                    </div>
                  ))}
                  {overview.delegates.length === 0 && <p className="text-slate-500">{tr('لا يوجد مفوضون.', 'No delegates assigned.')}</p>}
                </div>
              </div>
            )}

            {overviewTab === 'AUDIT' && (
              <div className="space-y-2 text-xs">
                {overview.client.notes && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
                    <strong>{tr('ملاحظات الحساب:', 'Account Remarks:')}</strong> {overview.client.notes}
                  </div>
                )}
                {overview.audit_logs.map((lg) => (
                  <div key={lg.id} className="flex justify-between rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <span><strong className="font-mono">{lg.action}</strong> — {lg.actor_name}</span>
                    <span dir="ltr" className="font-mono text-[10px] text-slate-400">{lg.created_at.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </SpotlightCard>
        </div>
      )}
    </SpotlightCard>
  );
}
