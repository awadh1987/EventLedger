'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  GitCompare,
  Layers,
  Palette,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuthSession } from '@/components/providers/auth-provider';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, dynamicHref, tenantPath } from '@/lib/api';
import type { HallInfo } from '@/lib/types';

type ErpTab = 'SCHEDULE' | 'CATALOG' | 'INVOICING' | 'OPERATIONS' | 'CLIENTS' | 'BRANDING';
type CalView = 'MONTH' | 'WEEK' | 'AGENDA';

interface TenantClientRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  user_type: string;
  is_active: boolean;
  client_category: 'INDIVIDUAL_B2C' | 'CORPORATE_B2B';
  company_name: string | null;
  tax_id: string | null;
  national_id_or_cr: string | null;
  vip_tier: string;
  events_count: number;
  total_contracted: number;
  outstanding_balance: number;
}

interface StaffEventRow {
  id: string;
  event_code: string;
  event_type: string;
  hall_id: string;
  hall_name: string;
  hall_name_ar: string;
  client_name: string;
  start_time: string;
  end_time: string;
  status: string;
  guest_count: number;
  total_amount: number;
}

interface ApprovalRow {
  id: string;
  event_id: string;
  event_code: string;
  draft_id: string;
  draft_type: string;
  financial_delta: number;
  requested_by_name: string;
  required_approver_role: string;
  created_at: string;
  payload: Record<string, unknown>;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  event_id: string;
  event_code: string;
  client_name: string;
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
    status: string;
  }[];
}

interface InventoryRow {
  id: string;
  name: string;
  category: string;
  total_stock: number;
  unit_addon_price: number;
  lifecycle: string;
}

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  HOLD_48H: 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300',
  CONTRACT_PENDING: 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300',
  COMPLETED: 'border-slate-500/40 bg-slate-500/15 text-slate-600 dark:text-slate-300',
  CANCELLED: 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300',
};

export default function ErpDashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const { tenantSlug } = useAuthSession();

  const [activeTab, setActiveTab] = useState<ErpTab>('SCHEDULE');
  const [calView, setCalView] = useState<CalView>('AGENDA');
  const [hallFilter, setHallFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [events, setEvents] = useState<StaffEventRow[]>([]);
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [clients, setClients] = useState<TenantClientRow[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<'ALL' | 'INDIVIDUAL_B2C' | 'CORPORATE_B2B' | 'SUSPENDED'>('ALL');
  const [managedClient, setManagedClient] = useState<TenantClientRow | null>(null);
  const [clientForm, setClientForm] = useState({
    full_name: '',
    phone: '',
    is_active: true,
    vip_tier: 'STANDARD',
    client_category: 'INDIVIDUAL_B2C' as 'INDIVIDUAL_B2C' | 'CORPORATE_B2B',
    company_name: '',
    tax_id: '',
    national_id_or_cr: '',
  });
  const [clientNewPassword, setClientNewPassword] = useState('');
  const [branding, setBranding] = useState({
    primary_color: '#D4AF37',
    accent_color: '#0F172A',
    logo_light_url: '',
    logo_dark_url: '',
    favicon_url: '',
  });

  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [selectedApprovalId, setSelectedApprovalId] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Post-Event Damage Inspection modal state
  const [inspectEvent, setInspectEvent] = useState<StaffEventRow | null>(null);
  const [inspectStatus, setInspectStatus] = useState<'PASSED' | 'DAMAGE_CLAIMED'>('PASSED');
  const [deductionAmount, setDeductionAmount] = useState('0');
  const [inspectNotes, setInspectNotes] = useState('');
  const [checklist, setChecklist] = useState({
    stage_and_lighting: true,
    furniture_and_chairs: true,
    av_equipment: true,
    cleanliness_and_walls: true,
  });

  const load = useCallback(async () => {
    try {
      const [evs, apps, hallList, invs, items, clis, br] = await Promise.all([
        apiFetch<StaffEventRow[]>('/api/v1/bookings/events'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
        apiFetch<HallInfo[]>('/api/v1/venue/halls'),
        apiFetch<InvoiceRow[]>('/api/v1/finance/invoices').catch(() => [] as InvoiceRow[]),
        apiFetch<InventoryRow[]>('/api/v1/venue/inventory').catch(() => [] as InventoryRow[]),
        apiFetch<TenantClientRow[]>('/api/v1/tenant/clients').catch(() => [] as TenantClientRow[]),
        apiFetch<{
          primary_color?: string;
          accent_color?: string;
          logo_light_url?: string | null;
          logo_dark_url?: string | null;
          favicon_url?: string | null;
        }>('/api/v1/tenant/branding').catch(() => null),
      ]);
      setEvents(evs);
      setApprovals(apps);
      setHalls(hallList);
      setInvoices(invs);
      setInventory(items);
      setClients(clis);
      if (br) {
        setBranding({
          primary_color: br.primary_color || '#D4AF37',
          accent_color: br.accent_color || '#0F172A',
          logo_light_url: br.logo_light_url || '',
          logo_dark_url: br.logo_dark_url || '',
          favicon_url: br.favicon_url || '',
        });
      }
      setSelectedEventId((prev) => (evs.some((e) => e.id === prev) ? prev : evs[0]?.id || ''));
      setSelectedApprovalId((prev) => (apps.some((a) => a.id === prev) ? prev : apps[0]?.id || ''));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('يرجى تسجيل الدخول بحساب الموظف', 'Staff login required'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((ev) => {
      if (hallFilter !== 'ALL' && ev.hall_id !== hallFilter) return false;
      if (!q) return true;
      return (
        ev.event_code.toLowerCase().includes(q) ||
        ev.client_name.toLowerCase().includes(q) ||
        ev.hall_name.toLowerCase().includes(q) ||
        ev.hall_name_ar.toLowerCase().includes(q) ||
        ev.status.toLowerCase().includes(q)
      );
    });
  }, [events, hallFilter, searchQuery]);

  const selectedEvent =
    filteredEvents.find((e) => e.id === selectedEventId) ||
    events.find((e) => e.id === selectedEventId) ||
    filteredEvents[0] ||
    null;

  const selectedHall = selectedEvent ? halls.find((h) => h.id === selectedEvent.hall_id) : undefined;
  const selectedInvoice = selectedEvent ? invoices.find((i) => i.event_id === selectedEvent.id) : undefined;
  const eventApprovals = selectedEvent ? approvals.filter((a) => a.event_id === selectedEvent.id) : [];
  const selectedApproval = approvals.find((a) => a.id === selectedApprovalId) || approvals[0] || null;

  const resolveApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await apiFetch<{ status: string }>(`/api/v1/approvals/${id}/resolve`, {
        method: 'POST',
        body: {
          decision,
          rejection_reason: decision === 'REJECTED' ? rejectionReason || 'Rejected by ERP manager' : null,
        },
      });
      setRejectionReason('');
      setNotice(tr(`تم تنفيذ قرار الاعتماد والمزامنة (${res.status})`, `Approval resolved & synced (${res.status})`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve approval');
    }
  };

  const verifyMilestone = async (milestoneId: string, method: string) => {
    try {
      await apiFetch(`/api/v1/erp/finance/milestones/${milestoneId}/verify`, {
        method: 'PATCH',
        body: { payment_method: method || 'KURAIMI_BANK', is_security_deposit: false },
      });
      setNotice(tr('تم تأكيد الدفعة وترحيل القيد المزدوج', 'Milestone verified & journal posted'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const saveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/v1/tenant/branding', {
        method: 'PUT',
        body: {
          primary_color: branding.primary_color,
          accent_color: branding.accent_color,
          logo_light_url: branding.logo_light_url || null,
          logo_dark_url: branding.logo_dark_url || null,
          favicon_url: branding.favicon_url || null,
        },
      });
      setNotice(tr('تم حفظ الهوية البصرية للمنشأة', 'Tenant branding updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Branding update failed');
    }
  };

  const submitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectEvent) return;
    try {
      const res = await apiFetch<{ status: string; deposit_status: string | null }>(
        `/api/v1/erp/ops/events/${inspectEvent.id}/inspection`,
        {
          method: 'POST',
          body: {
            status: inspectStatus,
            deduction_amount: inspectStatus === 'DAMAGE_CLAIMED' ? Number(deductionAmount) || 0 : 0,
            notes: inspectNotes || null,
            checklist_json: checklist,
          },
        }
      );
      setNotice(
        tr(
          `تم تسجيل فحص القاعة (${res.status}) — حالة التأمين: ${res.deposit_status || '-'}`,
          `Damage inspection submitted (${res.status}) — Deposit status: ${res.deposit_status || '-'}`
        )
      );
      setInspectEvent(null);
      setInspectNotes('');
      setDeductionAmount('0');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit damage inspection');
    }
  };

  const openManageClient = (c: TenantClientRow) => {
    setManagedClient(c);
    setClientForm({
      full_name: c.full_name,
      phone: c.phone,
      is_active: c.is_active,
      vip_tier: c.vip_tier || 'STANDARD',
      client_category: c.client_category,
      company_name: c.company_name || '',
      tax_id: c.tax_id || '',
      national_id_or_cr: c.national_id_or_cr || '',
    });
    setClientNewPassword('');
  };

  const saveManagedClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managedClient) return;
    try {
      await apiFetch(`/api/v1/tenant/clients/${managedClient.id}`, {
        method: 'PATCH',
        body: {
          full_name: clientForm.full_name.trim(),
          phone: clientForm.phone.trim(),
          is_active: clientForm.is_active,
          vip_tier: clientForm.vip_tier,
          client_category: clientForm.client_category,
          company_name: clientForm.company_name.trim() || null,
          tax_id: clientForm.tax_id.trim() || null,
          national_id_or_cr: clientForm.national_id_or_cr.trim() || null,
        },
      });
      setNotice(tr('تم تحديث بيانات العميل بنجاح', 'Client account updated'));
      setManagedClient(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update client');
    }
  };

  const resetClientPassword = async () => {
    if (!managedClient || clientNewPassword.length < 8) return;
    try {
      await apiFetch(`/api/v1/tenant/clients/${managedClient.id}/reset-password`, {
        method: 'POST',
        body: { new_password: clientNewPassword },
      });
      setClientNewPassword('');
      setNotice(tr('تم تعيين كلمة المرور المؤقتة للعميل', 'Temporary client password set'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    }
  };

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return clients.filter((c) => {
      if (clientFilter === 'INDIVIDUAL_B2C' && c.client_category !== 'INDIVIDUAL_B2C') return false;
      if (clientFilter === 'CORPORATE_B2B' && c.client_category !== 'CORPORATE_B2B') return false;
      if (clientFilter === 'SUSPENDED' && c.is_active) return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.tax_id || '').toLowerCase().includes(q)
      );
    });
  }, [clientFilter, clientSearch, clients]);

  const totalRevenue = events.reduce((acc, e) => acc + (e.total_amount || 0), 0);
  const confirmedCount = events.filter((e) => e.status === 'CONFIRMED').length;

  const tabs: { id: ErpTab; labelAr: string; labelEn: string }[] = [
    { id: 'SCHEDULE', labelAr: 'الجدول والتقويم', labelEn: 'Schedule & Calendar' },
    { id: 'CATALOG', labelAr: 'الأصناف والقاعات', labelEn: 'Items & Catalog' },
    { id: 'INVOICING', labelAr: 'الفوترة والدفعات', labelEn: 'Invoicing & Payments' },
    { id: 'OPERATIONS', labelAr: 'التشغيل و BEO', labelEn: 'Operations & BEO' },
    { id: 'CLIENTS', labelAr: 'إدارة العملاء', labelEn: 'Clients' },
    { id: 'BRANDING', labelAr: 'الهوية البصرية', labelEn: 'Tenant Branding' },
  ];

  // Calendar buckets for Month / Week views
  const calendarDays = useMemo(() => {
    const now = new Date();
    const daysCount = calView === 'WEEK' ? 7 : 30;
    return Array.from({ length: daysCount }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return {
        iso,
        dayNum: d.getDate(),
        events: filteredEvents.filter((ev) => ev.start_time.slice(0, 10) === iso),
      };
    });
  }, [calView, filteredEvents]);

  const capacityPct =
    selectedEvent && selectedHall?.capacity_banquet
      ? Math.min(100, Math.round((selectedEvent.guest_count / selectedHall.capacity_banquet) * 100))
      : 0;
  const paidPct =
    selectedInvoice && selectedInvoice.total_amount > 0
      ? Math.min(100, Math.round((selectedInvoice.paid_amount / selectedInvoice.total_amount) * 100))
      : 0;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <SpotlightHeading as="h1" className="text-start text-2xl">
            {tr('لوحة تحكم إدارة القاعة (ERP)', 'Tenant Operations & Venue Control Panel')}
          </SpotlightHeading>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-3 start-3 h-4 w-4 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr('بحث برمز الفعالية أو العميل...', 'Search event code, client, hall...')}
              className="min-h-[40px] w-full rounded-xl border border-slate-300 bg-white ps-9 pe-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </div>

        {/* 4-Card KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Calendar className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('إجمالي الفعاليات', 'Total Events')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{events.length}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>{tr('الفعاليات المؤكدة', 'Confirmed Events')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{confirmedCount}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <TrendingUp className="h-4 w-4 text-sky-500" />
              <span>{tr('إجمالي قيمة العقود', 'Contracted Value')}</span>
            </div>
            <div dir="ltr" className="font-mono text-2xl font-extrabold">
              {totalRevenue.toLocaleString()}
            </div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ClipboardCheck className="h-4 w-4 text-amber-500" />
              <span>{tr('اعتمادات معلقة', 'Pending Approvals')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{approvals.length}</div>
          </SpotlightCard>
        </div>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {notice}
          </SpotlightCard>
        )}
        {error && (
          <SpotlightCard className="border-rose-500/40 bg-rose-500/10 py-3 text-start text-xs text-rose-500">{error}</SpotlightCard>
        )}

        {/* Horizontal Underlined Sub-Tabs */}
        <div className="flex gap-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
          {tabs.map((tab) => {
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
                    ? 'border-[var(--brand-primary)] font-semibold text-slate-900 dark:text-white'
                    : 'border-transparent font-medium text-slate-500 hover:text-[var(--brand-primary,#D4AF37)] dark:text-slate-400'
                }`}
              >
                {isRtl ? tab.labelAr : tab.labelEn}
              </button>
            );
          })}
        </div>

        {/* Main Content + Right-Side Event Inspector */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            {activeTab === 'SCHEDULE' && (
              <SpotlightCard className="space-y-4 text-start">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                    <Layers className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{tr('الجدول والتقويم التفاعلي', 'Interactive Hall Schedule & Calendar')}</span>
                  </SpotlightHeading>
                  <div className="flex gap-1 rounded-lg border border-slate-300 p-1 text-xs dark:border-slate-700">
                    {(['MONTH', 'WEEK', 'AGENDA'] as CalView[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCalView(v)}
                        className={`rounded px-2.5 py-1 font-semibold ${
                          calView === v ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : ''
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hall Filter Tabs */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setHallFilter('ALL')}
                    className={`rounded-full border px-3 py-1 font-semibold ${
                      hallFilter === 'ALL'
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-slate-950'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {tr('كل القاعات', 'All Halls')}
                  </button>
                  {halls.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setHallFilter(h.id)}
                      className={`rounded-full border px-3 py-1 font-semibold ${
                        hallFilter === h.id
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-slate-950'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {isRtl ? h.name_ar : h.name}
                    </button>
                  ))}
                </div>

                {calView === 'AGENDA' ? (
                  <div className="space-y-2">
                    {filteredEvents.length === 0 ? (
                      <p className="text-xs text-slate-500">{tr('لا توجد حجوزات مطابقة.', 'No matching events.')}</p>
                    ) : (
                      filteredEvents.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => setSelectedEventId(ev.id)}
                          className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-start text-xs transition ${
                            selectedEvent?.id === ev.id
                              ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]'
                              : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2 font-bold">
                              <span className="font-mono text-amber-500">{ev.event_code}</span>
                              <span>{ev.client_name}</span>
                            </div>
                            <div className="text-slate-500">
                              {isRtl ? ev.hall_name_ar : ev.hall_name} · {ev.guest_count} {tr('ضيف', 'guests')}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                              {ev.start_time.slice(0, 16).replace('T', ' ')}
                            </span>
                            <span className={`rounded border px-2 py-0.5 font-bold ${STATUS_STYLE[ev.status] || STATUS_STYLE.CONFIRMED}`}>
                              {ev.status}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-7">
                    {calendarDays.map((d) => (
                      <div key={d.iso} className="min-h-[84px] rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
                        <div className="font-mono text-[11px] font-bold text-slate-500">{d.iso.slice(5)}</div>
                        <div className="mt-1 space-y-1">
                          {d.events.map((ev) => (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => setSelectedEventId(ev.id)}
                              className={`block w-full truncate rounded border px-1.5 py-0.5 text-start text-[10px] font-bold ${
                                STATUS_STYLE[ev.status] || STATUS_STYLE.CONFIRMED
                              }`}
                            >
                              {ev.event_code}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SpotlightCard>
            )}

            {activeTab === 'CATALOG' && (
              <SpotlightCard className="space-y-4 text-start">
                <div className="flex items-center justify-between">
                  <SpotlightHeading as="h2" className="text-lg">
                    {tr('الأصناف والمخزون والقاعات', 'Halls & Equipment Add-On Catalog')}
                  </SpotlightHeading>
                  <Link href={tenantPath(locale, tenantSlug, '/erp/settings/lookups')} className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline">
                    {tr('إدارة القوائم', 'System Lookups')}
                  </Link>
                </div>
                <ResponsiveDataList
                  data={inventory}
                  locale={locale}
                  mobileCardHeader={(r) => r.name}
                  columns={[
                    { key: 'name', headerAr: 'الصنف', headerEn: 'Item', render: (r) => r.name },
                    { key: 'cat', headerAr: 'الفئة', headerEn: 'Category', render: (r) => r.category },
                    { key: 'stock', headerAr: 'المخزون', headerEn: 'Stock', render: (r) => r.total_stock },
                    { key: 'price', headerAr: 'سعر الإضافة', headerEn: 'Addon Price', render: (r) => Number(r.unit_addon_price).toLocaleString() },
                  ]}
                />
              </SpotlightCard>
            )}

            {activeTab === 'INVOICING' && (
              <SpotlightCard className="space-y-4 text-start">
                <div className="flex items-center justify-between">
                  <SpotlightHeading as="h2" className="text-lg">
                    {tr('الفوترة واعتماد الدفعات', 'Invoicing & Payment Verification')}
                  </SpotlightHeading>
                  <Link href={tenantPath(locale, tenantSlug, '/erp/finance/ledger')} className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline">
                    {tr('دفتر الأستاذ وميزان المراجعة', 'General Ledger')}
                  </Link>
                </div>
                <div className="space-y-3">
                  {invoices.map((inv) => (
                    <div key={inv.id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                        <span className="font-mono text-amber-500">
                          {inv.invoice_number} ({inv.event_code})
                        </span>
                        <span>
                          {inv.paid_amount.toLocaleString()} / {inv.total_amount.toLocaleString()} · {inv.status}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {inv.milestones.map((m) => (
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 p-2 dark:bg-slate-950">
                            <span>
                              {m.title} ({Number(m.amount_due).toLocaleString()} · {m.status})
                            </span>
                            {m.status !== 'PAID' && (
                              <button
                                type="button"
                                onClick={() => verifyMilestone(m.id, m.payment_method || 'KURAIMI_BANK')}
                                className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white"
                              >
                                {tr('اعتماد الدفعة', 'Verify')}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SpotlightCard>
            )}

            {activeTab === 'OPERATIONS' && (
              <SpotlightCard className="space-y-4 text-start">
                <div className="flex items-center justify-between">
                  <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                    <GitCompare className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{tr('طابور الاعتمادات وأمر التشغيل BEO', 'Split-Screen Approvals & Live BEO')}</span>
                  </SpotlightHeading>
                  <Link href={tenantPath(locale, tenantSlug, '/erp/ops/beo')} className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline">
                    {tr('فتح BEO الكامل', 'Full Live BEO')}
                  </Link>
                </div>

                {approvals.length === 0 ? (
                  <p className="text-xs text-slate-500">{tr('لا توجد مسودات بانتظار الاعتماد.', 'No pending draft approvals in queue.')}</p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-5">
                    <div className="space-y-2 lg:col-span-2">
                      {approvals.map((ap) => (
                        <button
                          key={ap.id}
                          type="button"
                          onClick={() => setSelectedApprovalId(ap.id)}
                          className={`w-full rounded-xl border p-3 text-start text-xs ${
                            selectedApproval?.id === ap.id
                              ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)]/10'
                              : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="flex justify-between font-bold">
                            <span className="font-mono text-amber-500">{ap.event_code}</span>
                            <span className="font-mono">+{Number(ap.financial_delta).toLocaleString()}</span>
                          </div>
                          <div>
                            {ap.draft_type} · {ap.requested_by_name}
                          </div>
                        </button>
                      ))}
                    </div>
                    {selectedApproval && (
                      <div className="space-y-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800 lg:col-span-3">
                        <pre dir="ltr" className="overflow-x-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-emerald-300">
                          {JSON.stringify(selectedApproval.payload, null, 2)}
                        </pre>
                        <div className="flex flex-wrap gap-2">
                          <input
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder={tr('سبب الرفض...', 'Rejection reason...')}
                            className="min-h-[38px] flex-1 rounded-lg border border-slate-300 px-3 dark:border-slate-700 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            onClick={() => resolveApproval(selectedApproval.id, 'APPROVED')}
                            className="min-h-[38px] rounded-lg bg-emerald-600 px-3 font-bold text-white"
                          >
                            {tr('اعتماد ومزامنة', 'Approve & Sync')}
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveApproval(selectedApproval.id, 'REJECTED')}
                            className="min-h-[38px] rounded-lg bg-rose-600 px-3 font-bold text-white"
                          >
                            {tr('رفض', 'Reject')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SpotlightCard>
            )}

            {activeTab === 'CLIENTS' && (
              <SpotlightCard className="space-y-4 text-start">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                    <Users className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{tr('لوحة إدارة حسابات العملاء', 'Tenant Client Accounts Control Panel')}</span>
                  </SpotlightHeading>
                  <input
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder={tr('بحث بالاسم، الجوال، الشركة...', 'Search name, phone, company, tax ID...')}
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950 sm:w-64"
                  />
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {(
                    [
                      { key: 'ALL', ar: 'الكل', en: 'All' },
                      { key: 'INDIVIDUAL_B2C', ar: 'أفراد B2C', en: 'B2C' },
                      { key: 'CORPORATE_B2B', ar: 'شركات B2B', en: 'B2B' },
                      { key: 'SUSPENDED', ar: 'موقوف', en: 'Suspended' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setClientFilter(f.key)}
                      className={`rounded-full border px-3 py-1 font-semibold ${
                        clientFilter === f.key
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-slate-950'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {isRtl ? f.ar : f.en}
                    </button>
                  ))}
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
                        </div>
                      ),
                    },
                    {
                      key: 'cat',
                      headerAr: 'الفئة والشركة',
                      headerEn: 'Category / Company',
                      render: (c) => (
                        <div className="text-xs">
                          <span className="font-mono font-semibold">{c.client_category}</span>
                          {c.company_name && <div className="text-[11px] text-slate-500">{c.company_name} ({c.tax_id || '-'})</div>}
                        </div>
                      ),
                    },
                    {
                      key: 'vip',
                      headerAr: 'VIP',
                      headerEn: 'VIP Tier',
                      render: (c) => (
                        <span className="rounded-full bg-[var(--brand-primary,#D4AF37)]/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-500">
                          {c.vip_tier}
                        </span>
                      ),
                    },
                    {
                      key: 'stats',
                      headerAr: 'الحجوزات والرصيد',
                      headerEn: 'Events & Balance',
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
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            c.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'
                          }`}
                        >
                          {c.is_active ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}
                        </span>
                      ),
                    },
                    {
                      key: 'manage',
                      headerAr: 'إدارة',
                      headerEn: 'Manage',
                      render: (c) => (
                        <button
                          type="button"
                          onClick={() => openManageClient(c)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                        >
                          {tr('إدارة', 'Manage')}
                        </button>
                      ),
                    },
                  ]}
                />
              </SpotlightCard>
            )}

            {activeTab === 'BRANDING' && (
              <SpotlightCard className="space-y-4 text-start">
                <div className="flex items-center justify-between">
                  <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                    <Palette className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{tr('الهوية البصرية للمنشأة', 'Tenant White-Label Branding')}</span>
                  </SpotlightHeading>
                  <Link href={tenantPath(locale, tenantSlug, '/erp/settings/branding')} className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline">
                    {tr('الإعدادات المتقدمة', 'Full Branding Studio')}
                  </Link>
                </div>
                <form onSubmit={saveBranding} className="grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold">{tr('اللون الأساسي', 'Primary Color')}</label>
                    <input
                      type="color"
                      value={branding.primary_color}
                      onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                      className="h-10 w-full rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">{tr('اللون الثانوي', 'Accent Color')}</label>
                    <input
                      type="color"
                      value={branding.accent_color}
                      onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                      className="h-10 w-full rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold">{tr('رابط الشعار', 'Light Logo URL')}</label>
                    <input
                      dir="ltr"
                      value={branding.logo_light_url}
                      onChange={(e) => setBranding({ ...branding, logo_light_url: e.target.value })}
                      className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button type="submit" className="min-h-[40px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 font-bold text-slate-950">
                      {tr('حفظ الهوية', 'Save Branding')}
                    </button>
                  </div>
                </form>
              </SpotlightCard>
            )}
          </div>

          {/* Live Right-Side Event Inspector Panel */}
          <aside className="lg:col-span-4">
            <SpotlightCard className="sticky top-20 space-y-4 text-start">
              <SpotlightHeading as="h2" className="text-base">
                {tr('مفتش الفعالية المباشر', 'Live Event Inspector')}
              </SpotlightHeading>

              {!selectedEvent ? (
                <p className="text-xs text-slate-500">{tr('اختر فعالية من الجدول للمعاينة.', 'Select an event to inspect.')}</p>
              ) : (
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-amber-500">{selectedEvent.event_code}</span>
                    <span className={`rounded border px-2 py-0.5 font-bold ${STATUS_STYLE[selectedEvent.status] || STATUS_STYLE.CONFIRMED}`}>
                      {selectedEvent.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="font-bold text-slate-900 dark:text-white">{selectedEvent.client_name}</div>
                    <div className="text-slate-500">{isRtl ? selectedEvent.hall_name_ar : selectedEvent.hall_name}</div>
                    <div dir="ltr" className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
                      <Clock className="h-3.5 w-3.5" />
                      <span>
                        {selectedEvent.start_time.slice(0, 16).replace('T', ' ')} → {selectedEvent.end_time.slice(11, 16)}
                      </span>
                    </div>
                    {selectedHall && (
                      <div className="text-[11px] text-amber-500">
                        {tr('هامش التنظيف:', 'Cleaning buffer:')} +{selectedHall.cleaning_buffer_minutes}m
                      </div>
                    )}
                  </div>

                  {/* Guest Capacity Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Users className="h-3.5 w-3.5" />
                        {tr('السعة والضيوف', 'Guest Capacity')}
                      </span>
                      <span className="font-mono font-bold">
                        {selectedEvent.guest_count} / {selectedHall?.capacity_banquet ?? '-'}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full bg-sky-500" style={{ width: `${capacityPct}%` }} />
                    </div>
                  </div>

                  {/* Payment Settlement Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">{tr('نسبة سداد الفاتورة', 'Payment Settlement')}</span>
                      <span dir="ltr" className="font-mono font-bold">
                        {selectedInvoice ? `${selectedInvoice.paid_amount.toLocaleString()} / ${selectedInvoice.total_amount.toLocaleString()}` : `${paidPct}%`}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
                    </div>
                  </div>

                  {/* Pending Approvals for this Event */}
                  {eventApprovals.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
                      <div className="font-bold text-amber-500">
                        {eventApprovals.length} {tr('طلبات اعتماد معلقة', 'pending approval(s)')}
                      </div>
                      {eventApprovals.map((ap) => (
                        <div key={ap.id} className="flex items-center justify-between gap-2">
                          <span>{ap.draft_type}</span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => resolveApproval(ap.id, 'APPROVED')}
                              className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"
                            >
                              {tr('اعتماد', 'Approve')}
                            </button>
                            <button
                              type="button"
                              onClick={() => resolveApproval(ap.id, 'REJECTED')}
                              className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"
                            >
                              {tr('رفض', 'Reject')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setInspectEvent(selectedEvent);
                        setInspectStatus('PASSED');
                        setDeductionAmount('0');
                      }}
                      className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 font-bold text-slate-950"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span>{tr('فحص ما بعد المناسبة', 'Damage Inspection')}</span>
                    </button>
                    <Link
                      href={
                        process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE'
                          ? `/${locale}/erp/finance/events/_/pnl/?id=${encodeURIComponent(selectedEvent.id)}`
                          : dynamicHref(locale, '/erp/finance/events', selectedEvent.id).replace(
                              selectedEvent.id,
                              `${selectedEvent.id}/pnl`
                            )
                      }
                      className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 px-3 font-bold dark:border-slate-700"
                    >
                      {tr('تقرير P&L', 'P&L')}
                    </Link>
                  </div>
                </div>
              )}
            </SpotlightCard>
          </aside>
        </div>
      </main>

      {/* Manage Client Modal */}
      {managedClient && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <SpotlightCard className="w-full max-w-lg space-y-4 text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-lg">
                {tr(`إدارة حساب العميل (${managedClient.full_name})`, `Manage Client (${managedClient.full_name})`)}
              </SpotlightHeading>
              <button type="button" onClick={() => setManagedClient(null)} aria-label="Close modal" className="rounded-lg p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveManagedClient} className="space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold">{tr('الاسم الكامل', 'Full Name')}</label>
                  <input required value={clientForm.full_name} onChange={(e) => setClientForm({ ...clientForm, full_name: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الجوال', 'Phone')}</label>
                  <input dir="ltr" required value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('مستوى VIP', 'VIP Tier')}</label>
                  <select value={clientForm.vip_tier} onChange={(e) => setClientForm({ ...clientForm, vip_tier: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
                    <option value="STANDARD">STANDARD</option>
                    <option value="GOLD">GOLD</option>
                    <option value="VIP">VIP</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('فئة العميل', 'Client Category')}</label>
                  <select
                    value={clientForm.client_category}
                    onChange={(e) => setClientForm({ ...clientForm, client_category: e.target.value as 'INDIVIDUAL_B2C' | 'CORPORATE_B2B' })}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="INDIVIDUAL_B2C">INDIVIDUAL_B2C</option>
                    <option value="CORPORATE_B2B">CORPORATE_B2B</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('اسم الشركة', 'Company Name')}</label>
                  <input value={clientForm.company_name} onChange={(e) => setClientForm({ ...clientForm, company_name: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{tr('الرقم الضريبي / الهوية', 'Tax ID / National ID')}</label>
                  <input dir="ltr" value={clientForm.tax_id} onChange={(e) => setClientForm({ ...clientForm, tax_id: e.target.value })} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 font-semibold dark:border-slate-800">
                <input type="checkbox" checked={clientForm.is_active} onChange={(e) => setClientForm({ ...clientForm, is_active: e.target.checked })} />
                <span>{tr('تفعيل دخول العميل (نشط)', 'Account Active (Allow Portal Login)')}</span>
              </label>

              <div className="flex justify-end gap-2">
                <button type="submit" className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                  {tr('حفظ التعديلات', 'Save Client')}
                </button>
              </div>
            </form>

            <div className="space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
              <div className="font-bold">{tr('تعيين كلمة مرور مؤقتة', 'Reset Client Password')}</div>
              <div className="flex gap-2">
                <input
                  type="password"
                  minLength={8}
                  value={clientNewPassword}
                  onChange={(e) => setClientNewPassword(e.target.value)}
                  placeholder={tr('كلمة مرور جديدة (8+ أحرف)', 'New temp password (8+ chars)')}
                  className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  disabled={clientNewPassword.length < 8}
                  onClick={resetClientPassword}
                  className="min-h-[38px] rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 font-bold text-amber-500 disabled:opacity-40"
                >
                  {tr('تعيين', 'Reset Password')}
                </button>
              </div>
            </div>
          </SpotlightCard>
        </div>
      )}

      {/* Post-Event Damage Inspection Modal */}
      {inspectEvent && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <SpotlightCard className="w-full max-w-lg space-y-4 text-start">
            <div className="flex items-center justify-between gap-2">
              <SpotlightHeading as="h3" className="text-start text-lg">
                {tr(`فحص القاعة وتسوية التأمين (${inspectEvent.event_code})`, `Post-Event Damage Inspection (${inspectEvent.event_code})`)}
              </SpotlightHeading>
              <button type="button" onClick={() => setInspectEvent(null)} aria-label="Close modal" className="rounded-lg p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submitInspection} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(checklist).map(([key, val]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={(e) => setChecklist((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold">{tr('نتيجة الفحص', 'Inspection Result')}</label>
                  <select
                    value={inspectStatus}
                    onChange={(e) => setInspectStatus(e.target.value as 'PASSED' | 'DAMAGE_CLAIMED')}
                    className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="PASSED">{tr('سليم — اعتماد استرداد التأمين', 'PASSED — Release Deposit')}</option>
                    <option value="DAMAGE_CLAIMED">{tr('أضرار — خصم من التأمين', 'DAMAGE_CLAIMED — Deduct')}</option>
                  </select>
                </div>
                {inspectStatus === 'DAMAGE_CLAIMED' && (
                  <div>
                    <label className="mb-1 block font-semibold">{tr('مبلغ الخصم', 'Deduction Amount')}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={deductionAmount}
                      onChange={(e) => setDeductionAmount(e.target.value)}
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block font-semibold">{tr('ملاحظات المشرف', 'Inspector Notes')}</label>
                <textarea
                  rows={2}
                  value={inspectNotes}
                  onChange={(e) => setInspectNotes(e.target.value)}
                  placeholder={tr('حالة القاعة والتجهيزات...', 'Hall and equipment condition...')}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setInspectEvent(null)} className="min-h-[40px] rounded-lg border border-slate-300 px-4 font-semibold dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
                <button type="submit" className="min-h-[40px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 font-bold text-slate-950">
                  {tr('حفظ الفحص وإتمام الفعالية', 'Submit Inspection & Complete')}
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
