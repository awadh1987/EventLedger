'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuthSession } from '@/components/providers/auth-provider';
import { BackButton } from '@/components/ui/BackButton';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, getAccessToken, tenantPath } from '@/lib/api';
import type { StaffRole } from '@/lib/types';

interface StaffUserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  is_2fa_enabled: boolean;
  phone_verified: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  staff_role: StaffRole;
  custom_role_title: string | null;
  department: string;
  max_discount_percent: number;
  commission_rate: number;
  permissions: Record<string, string[]>;
}

interface RbacMeta {
  roles: StaffRole[];
  modules: string[];
  actions: string[];
  role_presets: Record<string, Record<string, string[]>>;
}

const DEPARTMENTS = ['MANAGEMENT', 'FINANCE', 'OPS', 'SALES', 'SECURITY', 'KITCHEN', 'OTHER'];

const MODULE_LABELS: Record<string, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة التحكم', en: 'Dashboard' },
  bookings: { ar: 'الحجوزات والقاعات', en: 'Bookings' },
  catalog: { ar: 'الأصناف والتسعير', en: 'Catalog & Pricing' },
  invoicing: { ar: 'الفوترة والدفعات', en: 'Invoicing' },
  finance: { ar: 'المحاسبة والأستاذ', en: 'Finance & GL' },
  operations: { ar: 'التشغيل و BEO', en: 'Operations & BEO' },
  security: { ar: 'البوابة والأمن', en: 'Security & Gate' },
  clients: { ar: 'العملاء', en: 'Clients' },
  users_rbac: { ar: 'المستخدمون والصلاحيات', en: 'Users & RBAC' },
  branding: { ar: 'الهوية البصرية', en: 'Branding' },
  governance: { ar: 'الحوكمة والاعتمادات', en: 'Governance' },
};

const inputCls =
  'min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950';
const labelCls = 'mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300';

export default function TenantUsersRbacPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const { tenantSlug } = useAuthSession();

  const [users, setUsers] = useState<StaffUserRow[]>([]);
  const [meta, setMeta] = useState<RbacMeta | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUserRow | null>(null);
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    password: '',
    staff_role: 'STAFF' as StaffRole,
    custom_role_title: '',
    department: 'OPERATIONS',
    custom_department: '',
    max_discount_percent: '0',
    commission_rate: '0',
    is_2fa_enabled: false,
    is_active: true,
  });
  const [permMatrix, setPermMatrix] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  // Password Reset modal
  const [pwUser, setPwUser] = useState<StaffUserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setError(tr('يرجى تسجيل الدخول بحساب مالك أو مدير القاعة.', 'Owner or Admin login required.'));
      return;
    }
    try {
      const [m, list] = await Promise.all([
        apiFetch<RbacMeta>('/api/v1/tenant/users/meta'),
        apiFetch<StaffUserRow[]>('/api/v1/tenant/users'),
      ]);
      setMeta(m);
      setUsers(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر تحميل قائمة المستخدمين', 'Failed to load staff users'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (role: StaffRole) => {
    const preset = meta?.role_presets?.[role] || {};
    const cloned: Record<string, string[]> = {};
    for (const mod of meta?.modules || Object.keys(MODULE_LABELS)) {
      cloned[mod] = [...(preset[mod] || [])];
    }
    setPermMatrix(cloned);
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      full_name: '',
      phone: '',
      email: '',
      password: '',
      staff_role: 'STAFF',
      custom_role_title: '',
      department: 'OPS',
      custom_department: '',
      max_discount_percent: '0',
      commission_rate: '0',
      is_2fa_enabled: false,
      is_active: true,
    });
    applyPreset('STAFF');
    setShowModal(true);
  };

  const openEdit = (u: StaffUserRow) => {
    setEditingUser(u);
    const knownDept = DEPARTMENTS.includes(u.department) ? u.department : 'OTHER';
    setForm({
      full_name: u.full_name,
      phone: u.phone,
      email: u.email || '',
      password: '',
      staff_role: u.staff_role,
      custom_role_title: u.custom_role_title || '',
      department: knownDept,
      custom_department: knownDept === 'OTHER' ? u.department : '',
      max_discount_percent: String(u.max_discount_percent ?? 0),
      commission_rate: String(u.commission_rate ?? 0),
      is_2fa_enabled: u.is_2fa_enabled,
      is_active: u.is_active,
    });
    const cloned: Record<string, string[]> = {};
    for (const mod of meta?.modules || Object.keys(MODULE_LABELS)) {
      cloned[mod] = [...(u.permissions?.[mod] || [])];
    }
    setPermMatrix(cloned);
    setShowModal(true);
  };

  const togglePerm = (mod: string, action: string) => {
    setPermMatrix((prev) => {
      const cur = prev[mod] || [];
      const next = cur.includes(action) ? cur.filter((a) => a !== action) : [...cur, action];
      return { ...prev, [mod]: next };
    });
  };

  const submitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const resolvedDept =
        form.department === 'OTHER' ? form.custom_department.trim() || 'OTHER' : form.department;
      if (editingUser) {
        await apiFetch(`/api/v1/tenant/users/${editingUser.id}`, {
          method: 'PATCH',
          body: {
            full_name: form.full_name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim() || null,
            staff_role: form.staff_role,
            custom_role_title: form.custom_role_title.trim() || null,
            department: resolvedDept,
            max_discount_percent: Number(form.max_discount_percent) || 0,
            commission_rate: Number(form.commission_rate) || 0,
            is_2fa_enabled: form.is_2fa_enabled,
            is_active: form.is_active,
            permissions: permMatrix,
          },
        });
        setNotice(tr('تم تحديث بيانات المستخدم والصلاحيات بنجاح.', 'Staff user & RBAC permissions updated.'));
      } else {
        await apiFetch('/api/v1/tenant/users', {
          method: 'POST',
          body: {
            full_name: form.full_name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim() || null,
            password: form.password,
            staff_role: form.staff_role,
            custom_role_title: form.custom_role_title.trim() || null,
            department: resolvedDept,
            max_discount_percent: Number(form.max_discount_percent) || 0,
            commission_rate: Number(form.commission_rate) || 0,
            is_2fa_enabled: form.is_2fa_enabled,
            is_active: form.is_active,
            permissions: permMatrix,
          },
        });
        setNotice(tr('تم إنشاء حساب الموظف وتعيين صلاحياته بنجاح.', 'Staff member created with RBAC matrix.'));
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حفظ المستخدم', 'Failed to save user'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: StaffUserRow) => {
    try {
      await apiFetch(`/api/v1/tenant/users/${u.id}`, {
        method: 'PATCH',
        body: { is_active: !u.is_active },
      });
      setNotice(
        u.is_active
          ? tr(`تم إيقاف ${u.full_name}`, `Suspended ${u.full_name}`)
          : tr(`تم تفعيل ${u.full_name}`, `Activated ${u.full_name}`)
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const removeOrDeactivate = async (u: StaffUserRow) => {
    try {
      const res = await apiFetch<{ status: string }>(`/api/v1/tenant/users/${u.id}`, { method: 'DELETE' });
      setNotice(
        res.status === 'DEACTIVATED_WITH_HISTORY'
          ? tr('تم تعطيل المستخدم مع الحفاظ على سجلاته المالية', 'User deactivated (history preserved)')
          : tr('تم حذف المستخدم', 'User deleted')
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const submitResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwUser || newPassword.length < 8) return;
    try {
      await apiFetch(`/api/v1/tenant/users/${pwUser.id}/reset-password`, {
        method: 'POST',
        body: { new_password: newPassword },
      });
      setNotice(tr(`تم تغيير كلمة مرور ${pwUser.full_name}`, `Password reset for ${pwUser.full_name}`));
      setPwUser(null);
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.staff_role !== roleFilter) return false;
      if (statusFilter === 'ACTIVE' && !u.is_active) return false;
      if (statusFilter === 'SUSPENDED' && u.is_active) return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.custom_role_title || '').toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
      );
    });
  }, [roleFilter, search, statusFilter, users]);

  const activeCount = users.filter((u) => u.is_active).length;
  const adminCount = users.filter((u) => u.staff_role === 'OWNER' || u.staff_role === 'ADMIN').length;
  const verifiedCount = users.filter((u) => u.phone_verified || u.is_2fa_enabled).length;
  const modules = meta?.modules || Object.keys(MODULE_LABELS);
  const actions = meta?.actions || ['view', 'create', 'edit', 'delete', 'approve', 'export'];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <div>
            <SpotlightHeading as="h1" className="flex items-center gap-2 text-2xl">
              <UserCog className="h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('لوحة إدارة المستخدمين والصلاحيات (RBAC)', 'Tenant Users & RBAC Control Panel')}</span>
            </SpotlightHeading>
            <p className="mt-1 text-xs text-slate-500">
              {tr(
                'إدارة موظفي المنشأة، الأدوار القياسية والمخصصة، ومصفوفة الصلاحيات التفصيلية.',
                'Manage staff accounts, preset & custom roles, discount limits, and module-level RBAC permissions.'
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={tenantPath(locale, tenantSlug, '/erp/dashboard')}
              className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3.5 text-xs font-semibold dark:border-slate-700"
            >
              {tr('العودة للوحة ERP', 'Back to ERP')}
            </Link>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950"
            >
              <Plus className="h-4 w-4" />
              <span>{tr('إضافة مستخدم وصلاحيات', 'Add Staff Member')}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Users className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('إجمالي الموظفين', 'Total Staff')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{users.length}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <UserCheck className="h-4 w-4 text-emerald-500" />
              <span>{tr('الحسابات النشطة', 'Active Accounts')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{activeCount}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <span>{tr('الملاك والمدراء', 'Owners & Admins')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{adminCount}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-sky-500" />
              <span>{tr('موثق / 2FA', 'Verified / 2FA')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{verifiedCount}</div>
          </SpotlightCard>
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {notice}
          </SpotlightCard>
        )}
        {error && (
          <SpotlightCard className="border-rose-500/40 bg-rose-500/10 py-3 text-start text-xs text-rose-500">
            {error}
          </SpotlightCard>
        )}

        <SpotlightCard className="space-y-4 text-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('بحث بالاسم، الجوال، الدور، القسم...', 'Search name, phone, role, department...')}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pe-3 ps-9 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="ALL">{tr('كل الأدوار', 'All Roles')}</option>
                {(meta?.roles || ['OWNER', 'ADMIN', 'FINANCE', 'OPS_MANAGER', 'SALES', 'SECURITY', 'STAFF', 'OTHER']).map(
                  (r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  )
                )}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'SUSPENDED')}
                className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="ALL">{tr('كل الحالات', 'All Statuses')}</option>
                <option value="ACTIVE">{tr('نشط', 'Active')}</option>
                <option value="SUSPENDED">{tr('موقوف', 'Suspended')}</option>
              </select>
            </div>
          </div>

          <ResponsiveDataList
            data={filtered}
            locale={locale}
            mobileCardHeader={(u) => `${u.full_name} (${u.custom_role_title || u.staff_role})`}
            columns={[
              {
                key: 'user',
                headerAr: 'الموظف',
                headerEn: 'Staff Member',
                render: (u) => (
                  <div className="space-y-0.5 text-xs">
                    <div className="font-bold">{u.full_name}</div>
                    <div dir="ltr" className="text-[11px] text-slate-500">
                      {u.phone} {u.email ? `· ${u.email}` : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'role',
                headerAr: 'الدور والقسم',
                headerEn: 'Role & Dept',
                render: (u) => (
                  <div className="space-y-1 text-xs">
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-500">
                      {u.staff_role}
                    </span>
                    {u.custom_role_title && <div className="text-[11px] font-semibold">{u.custom_role_title}</div>}
                    <div className="text-[11px] text-slate-500">
                      {u.department} · {tr('خصم', 'Disc')}: {u.max_discount_percent}%
                    </div>
                  </div>
                ),
              },
              {
                key: 'security',
                headerAr: 'التحقق وآخر دخول',
                headerEn: 'Security & Login',
                render: (u) => (
                  <div className="space-y-1 text-[11px]">
                    <div className="flex flex-wrap gap-1">
                      {u.is_2fa_enabled && (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-bold text-sky-500">2FA</span>
                      )}
                      {u.phone_verified && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-bold text-emerald-500">
                          {tr('جوال موثق', 'Phone ✓')}
                        </span>
                      )}
                    </div>
                    <div dir="ltr" className="font-mono text-slate-500">
                      {u.last_login_at ? u.last_login_at.slice(0, 16).replace('T', ' ') : '-'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                headerAr: 'الحالة',
                headerEn: 'Status',
                render: (u) => (
                  <button
                    type="button"
                    onClick={() => toggleActive(u)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      u.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'
                    }`}
                  >
                    {u.is_active ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}
                  </button>
                ),
              },
              {
                key: 'actions',
                headerAr: 'الإجراءات',
                headerEn: 'Actions',
                render: (u) => (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                    >
                      {tr('تعديل والصلاحيات', 'Edit & RBAC')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPwUser(u);
                        setNewPassword('');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-500"
                    >
                      <KeyRound className="h-3 w-3" />
                      <span>{tr('كلمة المرور', 'PW')}</span>
                    </button>
                    {u.staff_role !== 'OWNER' && (
                      <button
                        type="button"
                        onClick={() => removeOrDeactivate(u)}
                        aria-label="Delete user"
                        className="rounded-lg border border-rose-500/40 p-1 text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </SpotlightCard>
      </main>

      {/* Create / Edit Staff + RBAC Matrix Modal */}
      {showModal && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <SpotlightCard className="my-8 max-h-[90vh] w-full max-w-4xl space-y-4 overflow-y-auto text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h2" className="text-lg">
                {editingUser
                  ? tr(`تعديل المستخدم والصلاحيات (${editingUser.full_name})`, `Edit Staff & RBAC (${editingUser.full_name})`)
                  : tr('إضافة مستخدم جديد وتعيين الصلاحيات', 'Add Staff Member & RBAC Matrix')}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setShowModal(false)} />
                <button type="button" onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={submitUser} className="space-y-4 text-xs">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className={labelCls}>{tr('الاسم الكامل', 'Full Name')}</label>
                  <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{tr('رقم الجوال', 'Phone')}</label>
                  <input dir="ltr" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{tr('البريد الإلكتروني', 'Email')}</label>
                  <input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
                </div>
                {!editingUser && (
                  <div>
                    <label className={labelCls}>{tr('كلمة المرور (8+ أحرف)', 'Password (8+ chars)')}</label>
                    <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} />
                  </div>
                )}
                <div>
                  <label className={labelCls}>{tr('الدور (RBAC Role)', 'Role Preset')}</label>
                  <select
                    value={form.staff_role}
                    onChange={(e) => {
                      const nextRole = e.target.value as StaffRole;
                      setForm({ ...form, staff_role: nextRole });
                      applyPreset(nextRole);
                    }}
                    className={inputCls}
                  >
                    {(meta?.roles || ['OWNER', 'ADMIN', 'FINANCE', 'OPS_MANAGER', 'SALES', 'SECURITY', 'STAFF', 'OTHER']).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{tr('المسمى الوظيفي المخصص', 'Custom Role Title')}</label>
                  <input
                    value={form.custom_role_title}
                    onChange={(e) => setForm({ ...form, custom_role_title: e.target.value })}
                    placeholder={form.staff_role === 'OTHER' ? tr('أدخل المسمى المخصص...', 'Enter custom role title...') : tr('اختياري', 'Optional')}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr('القسم', 'Department')}</label>
                  <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls}>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                {form.department === 'OTHER' && (
                  <div>
                    <label className={labelCls}>{tr('اسم القسم المخصص', 'Custom Department')}</label>
                    <input value={form.custom_department} onChange={(e) => setForm({ ...form, custom_department: e.target.value })} className={inputCls} />
                  </div>
                )}
                <div>
                  <label className={labelCls}>{tr('أقصى نسبة خصم %', 'Max Discount %')}</label>
                  <input type="number" min={0} max={100} step="0.5" value={form.max_discount_percent} onChange={(e) => setForm({ ...form, max_discount_percent: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{tr('نسبة العمولة %', 'Commission %')}</label>
                  <input type="number" min={0} max={100} step="0.5" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} className={inputCls} />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  <span>{tr('الحساب نشط', 'Account Active')}</span>
                </label>
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={form.is_2fa_enabled} onChange={(e) => setForm({ ...form, is_2fa_enabled: e.target.checked })} />
                  <span>{tr('تفعيل التحقق الثنائي (2FA)', 'Require 2FA OTP')}</span>
                </label>
              </div>

              {/* Module x Action RBAC Matrix */}
              <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[var(--brand-primary,#D4AF37)]">
                    {tr('مصفوفة الصلاحيات (الوحدات × الإجراءات)', 'Module × Action Permissions Matrix')}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPreset(form.staff_role)}
                    className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-semibold dark:border-slate-700"
                  >
                    {tr('استعادة صلاحيات الدور الافتراضية', 'Reset to Role Preset')}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="py-2 pe-3">{tr('الوحدة', 'Module')}</th>
                        {actions.map((act) => (
                          <th key={act} className="px-2 py-2 text-center uppercase">
                            {act}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map((mod) => {
                        const lbl = MODULE_LABELS[mod];
                        return (
                          <tr key={mod} className="border-b border-slate-100 dark:border-slate-900">
                            <td className="py-2 pe-3 font-semibold">{lbl ? (isRtl ? lbl.ar : lbl.en) : mod}</td>
                            {actions.map((act) => {
                              const checked = (permMatrix[mod] || []).includes(act);
                              return (
                                <td key={act} className="px-2 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={form.staff_role === 'OWNER'}
                                    onChange={() => togglePerm(mod, act)}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" disabled={saving} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 font-bold text-slate-950 disabled:opacity-50">
                  {saving ? tr('جارٍ الحفظ...', 'Saving...') : tr('حفظ المستخدم والصلاحيات', 'Save User & RBAC')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}

      {/* Password Reset Modal */}
      {pwUser && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <SpotlightCard className="w-full max-w-md space-y-4 text-start">
            <div className="flex items-center justify-between">
              <SpotlightHeading as="h3" className="text-base">
                {tr(`تعيين كلمة مرور (${pwUser.full_name})`, `Reset Password (${pwUser.full_name})`)}
              </SpotlightHeading>
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setPwUser(null)} />
                <button type="button" onClick={() => setPwUser(null)} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form onSubmit={submitResetPassword} className="space-y-3 text-xs">
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={tr('كلمة المرور الجديدة (8+ أحرف)', 'New password (8+ chars)')}
                className={inputCls}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPwUser(null)} className="min-h-[38px] rounded-lg border border-slate-300 px-4 dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" disabled={newPassword.length < 8} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950 disabled:opacity-50">
                  {tr('حفظ كلمة المرور', 'Reset Password')}
                </button>
              </div>
            </form>
          </SpotlightCard>
        </div>
      )}

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
