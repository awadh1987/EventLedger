'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  GitCompare,
  Layers,
  Palette,
  Search,
  Send,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';
import { useAuthSession } from '@/components/providers/auth-provider';
import { CatalogControlPlane } from '@/components/erp/CatalogControlPlane';
import { ClientAccountsControlPanel, type RichClientRow } from '@/components/erp/ClientAccountsControlPanel';
import { InvoicingAndContractsPanel, type ErpInvoiceDetail } from '@/components/erp/InvoicingAndContractsPanel';
import { OutlookHallCalendar, type CalendarEventRow } from '@/components/erp/OutlookHallCalendar';
import { SecurityAndCloseControlPlane, type SecuritySubTab } from '@/components/erp/SecurityAndCloseControlPlane';
import { BackButton } from '@/components/ui/BackButton';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, getAccessToken, tenantPath } from '@/lib/api';
import type { HallInfo } from '@/lib/types';

type ErpTab = 'SCHEDULE' | 'CATALOG' | 'INVOICING' | 'OPERATIONS' | 'SECURITY' | 'CLIENTS' | 'BRANDING' | 'GOVERNANCE';

interface GovernanceRequestRow {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
  scope: 'TENANT_ADMIN' | 'SUPER_ADMIN';
  target_entity_type: 'EVENT' | 'CLIENT' | 'TENANT';
  target_entity_id: string;
  request_title: string;
  current_values: Record<string, unknown>;
  proposed_values: Record<string, unknown>;
  status: string;
  requester_name: string;
  requester_remarks: string | null;
  reviewer_name: string | null;
  reviewer_remarks: string | null;
  created_at: string;
}

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
  title?: string | null;
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
  COMPLETED: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
  CLOSED: 'border-slate-500/50 bg-slate-500/20 text-slate-700 dark:text-slate-200',
  CANCELLED: 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300',
};

export default function ErpDashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const { tenantSlug } = useAuthSession();
  const { currentSearch } = useNavigationHistory();

  const [activeTab, setActiveTab] = useState<ErpTab>('SCHEDULE');
  const [securityInitialSubTab, setSecurityInitialSubTab] = useState<SecuritySubTab>('READINESS');

  useEffect(() => {
    if (!currentSearch) return;
    const t = new URLSearchParams(currentSearch).get('tab');
    if (
      t === 'SCHEDULE' ||
      t === 'CATALOG' ||
      t === 'INVOICING' ||
      t === 'OPERATIONS' ||
      t === 'SECURITY' ||
      t === 'CLIENTS' ||
      t === 'BRANDING' ||
      t === 'GOVERNANCE'
    ) {
      setActiveTab(t);
    }
  }, [currentSearch]);

  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [invoices, setInvoices] = useState<ErpInvoiceDetail[]>([]);
  const [clients, setClients] = useState<RichClientRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
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
  const [governanceReqs, setGovernanceReqs] = useState<GovernanceRequestRow[]>([]);
  const [govRemarksMap, setGovRemarksMap] = useState<Record<string, string>>({});
  const [editingTitleEventId, setEditingTitleEventId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleRemarks, setTitleRemarks] = useState('');
  const [tenantGovForm, setTenantGovForm] = useState({
    name: '',
    slug: '',
    custom_domain: '',
    currency: '',
    tax_rate: '',
    remarks: '',
  });
  const [resubmitTenantId, setResubmitTenantId] = useState<string | null>(null);
  const [resubmitRemarks, setResubmitRemarks] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Post-Event Damage Inspection modal state
  const [inspectEvent, setInspectEvent] = useState<CalendarEventRow | null>(null);
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
    if (!getAccessToken()) {
      setError(tr('يرجى تسجيل الدخول بحساب الموظف', 'Staff login required'));
      return;
    }
    try {
      const [evs, apps, hallList, invs, , clis, br, govs] = await Promise.all([
        apiFetch<CalendarEventRow[]>('/api/v1/bookings/events'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
        apiFetch<HallInfo[]>('/api/v1/venue/halls'),
        apiFetch<ErpInvoiceDetail[]>('/api/v1/finance/invoices').catch(() => [] as ErpInvoiceDetail[]),
        apiFetch<InventoryRow[]>('/api/v1/venue/inventory').catch(() => [] as InventoryRow[]),
        apiFetch<RichClientRow[]>('/api/v1/tenant/clients').catch(() => [] as RichClientRow[]),
        apiFetch<{
          primary_color?: string;
          accent_color?: string;
          logo_light_url?: string | null;
          logo_dark_url?: string | null;
          favicon_url?: string | null;
        }>('/api/v1/tenant/branding').catch(() => null),
        apiFetch<GovernanceRequestRow[]>('/api/v1/governance/change-requests').catch(() => [] as GovernanceRequestRow[]),
      ]);
      setEvents(evs);
      setApprovals(apps);
      setHalls(hallList);
      setInvoices(invs);
      setClients(clis);
      setGovernanceReqs(govs);
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
      if (!q) return true;
      return (
        ev.event_code.toLowerCase().includes(q) ||
        (ev.title || '').toLowerCase().includes(q) ||
        ev.client_name.toLowerCase().includes(q) ||
        ev.hall_name.toLowerCase().includes(q) ||
        ev.hall_name_ar.toLowerCase().includes(q) ||
        ev.status.toLowerCase().includes(q)
      );
    });
  }, [events, searchQuery]);

  const selectedEvent =
    filteredEvents.find((e) => e.id === selectedEventId) ||
    events.find((e) => e.id === selectedEventId) ||
    filteredEvents[0] ||
    null;

  const selectedHall = selectedEvent ? halls.find((h) => h.id === selectedEvent.hall_id) : undefined;
  const selectedInvoice = selectedEvent ? invoices.find((i) => i.event_id === selectedEvent.id) : undefined;
  const eventApprovals = selectedEvent ? approvals.filter((a) => a.event_id === selectedEvent.id) : [];
  const selectedApproval = approvals.find((a) => a.id === selectedApprovalId) || approvals[0] || null;

  const resolveApproval = async (id: string, decision: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_AMENDMENT') => {
    try {
      const res = await apiFetch<{ status: string }>(`/api/v1/approvals/${id}/resolve`, {
        method: 'POST',
        body: {
          decision,
          rejection_reason:
            decision !== 'APPROVED' ? rejectionReason || `${decision} by ERP manager` : null,
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

  const saveInlineEventTitle = async (eventId: string) => {
    try {
      await apiFetch(`/api/v1/bookings/events/${eventId}`, {
        method: 'PATCH',
        body: { title: titleDraft.trim() || null, remarks: titleRemarks.trim() || null },
      });
      setEditingTitleEventId(null);
      setTitleRemarks('');
      setNotice(tr('تم تحديث عنوان الفعالية بنجاح', 'Event title updated'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event title');
    }
  };

  const resolveGovRequest = async (id: string, decision: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_AMENDMENT') => {
    try {
      await apiFetch(`/api/v1/governance/change-requests/${id}/resolve`, {
        method: 'POST',
        body: { decision, remarks: govRemarksMap[id]?.trim() || null },
      });
      setGovRemarksMap((prev) => ({ ...prev, [id]: '' }));
      setNotice(tr(`تم تنفيذ قرار الحوكمة (${decision})`, `Governance request ${decision}`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve governance request');
    }
  };

  const submitTenantGovRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const proposed: Record<string, unknown> = {};
    if (tenantGovForm.name.trim()) proposed.name = tenantGovForm.name.trim();
    if (tenantGovForm.slug.trim()) proposed.slug = tenantGovForm.slug.trim();
    if (tenantGovForm.custom_domain.trim()) proposed.custom_domain = tenantGovForm.custom_domain.trim();
    if (tenantGovForm.currency.trim()) proposed.currency = tenantGovForm.currency.trim().toUpperCase();
    if (tenantGovForm.tax_rate.trim()) proposed.tax_rate = Number(tenantGovForm.tax_rate);
    if (Object.keys(proposed).length === 0) {
      setError(tr('أدخل حقلاً واحداً على الأقل للتعديل', 'Provide at least one field to update'));
      return;
    }
    try {
      if (resubmitTenantId) {
        await apiFetch(`/api/v1/governance/change-requests/${resubmitTenantId}/resubmit`, {
          method: 'PATCH',
          body: { proposed_values: proposed, remarks: resubmitRemarks.trim() || tenantGovForm.remarks.trim() || null },
        });
        setNotice(tr('تم تعديل وإعادة إرسال الطلب لمدير المنصة', 'Amended request resubmitted to Super Admin'));
        setResubmitTenantId(null);
        setResubmitRemarks('');
      } else {
        await apiFetch('/api/v1/governance/change-requests', {
          method: 'POST',
          body: {
            target_entity_type: 'TENANT',
            proposed_values: proposed,
            remarks: tenantGovForm.remarks.trim() || null,
          },
        });
        setNotice(tr('تم رفع طلب تعديل بيانات المنشأة لمدير المنصة', 'Tenant change request submitted for Super Admin approval'));
      }
      setTenantGovForm({ name: '', slug: '', custom_domain: '', currency: '', tax_rate: '', remarks: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit governance request');
    }
  };

  const totalRevenue = events.reduce((acc, e) => acc + (e.total_amount || 0), 0);
  const confirmedCount = events.filter((e) => e.status === 'CONFIRMED').length;

  const tabs: { id: ErpTab; labelAr: string; labelEn: string }[] = [
    { id: 'SCHEDULE', labelAr: 'الجدول والتقويم', labelEn: 'Schedule & Calendar' },
    { id: 'CATALOG', labelAr: 'الأصناف والقاعات', labelEn: 'Items & Catalog' },
    { id: 'INVOICING', labelAr: 'الفوترة والدفعات', labelEn: 'Invoicing & Payments' },
    { id: 'OPERATIONS', labelAr: 'التشغيل و BEO', labelEn: 'Operations & BEO' },
    { id: 'SECURITY', labelAr: 'الأمن والتأمين والإغلاق', labelEn: 'Security & Close' },
    { id: 'CLIENTS', labelAr: 'إدارة العملاء', labelEn: 'Clients' },
    { id: 'GOVERNANCE', labelAr: 'الحوكمة والاعتمادات', labelEn: 'Governance' },
    { id: 'BRANDING', labelAr: 'الهوية البصرية', labelEn: 'Tenant Branding' },
  ];

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
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={tenantPath(locale, tenantSlug, '/erp/settings/users')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--brand-primary,#D4AF37)]/60 bg-[var(--brand-primary,#D4AF37)]/10 px-3.5 text-xs font-bold text-[var(--brand-primary,#D4AF37)] hover:bg-[var(--brand-primary,#D4AF37)] hover:text-slate-950"
            >
              <Users className="h-4 w-4" />
              <span>{tr('المستخدمون والصلاحيات', 'Users & RBAC')}</span>
            </Link>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-3 start-3 h-4 w-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr('بحث برمز الفعالية أو العميل...', 'Search event code, client, hall...')}
                className="min-h-[40px] w-full rounded-xl border border-slate-300 bg-white ps-9 pe-3 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
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
                className={`-mb-px whitespace-nowrap border-b-2 px-1 py-3 text-xs transition ${active
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
              <OutlookHallCalendar
                locale={locale}
                tenantSlug={tenantSlug}
                halls={halls}
                events={filteredEvents}
                selectedEventId={selectedEvent?.id || ''}
                onSelectEvent={(id) => setSelectedEventId(id)}
                onJumpToSecurity={(id, subtab) => {
                  setSelectedEventId(id);
                  setSecurityInitialSubTab(subtab || 'READINESS');
                  setActiveTab('SECURITY');
                }}
                onOpenInspection={(ev) => {
                  setSelectedEventId(ev.id);
                  setInspectEvent(ev);
                  setInspectStatus('PASSED');
                  setDeductionAmount('0');
                }}
              />
            )}

            {activeTab === 'CATALOG' && (
              <CatalogControlPlane locale={locale} tenantSlug={tenantSlug} onCatalogChanged={load} />
            )}

            {activeTab === 'INVOICING' && (
              <InvoicingAndContractsPanel
                locale={locale}
                tenantSlug={tenantSlug}
                invoices={invoices}
                onRefresh={load}
              />
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
                          className={`w-full rounded-xl border p-3 text-start text-xs ${selectedApproval?.id === ap.id
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
                            onClick={() => resolveApproval(selectedApproval.id, 'RETURNED_FOR_AMENDMENT')}
                            className="min-h-[38px] rounded-lg bg-amber-500 px-3 font-bold text-slate-950"
                          >
                            {tr('إعادة للتعديل', 'Return')}
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

            {activeTab === 'SECURITY' && (
              <SecurityAndCloseControlPlane
                locale={locale}
                tenantSlug={tenantSlug}
                events={events}
                selectedEventId={selectedEvent?.id || ''}
                onSelectEvent={(id) => setSelectedEventId(id)}
                initialSubTab={securityInitialSubTab}
                onRefreshDashboard={load}
              />
            )}

            {activeTab === 'CLIENTS' && (
              <ClientAccountsControlPanel locale={locale} clients={clients} onRefresh={load} />
            )}

            {activeTab === 'GOVERNANCE' && (
              <div className="space-y-4">
                <SpotlightCard className="space-y-4 text-start">
                  <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                    <ShieldCheck className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{tr('اعتمادات تعديل بيانات العملاء والفعاليات', 'Tenant-Admin Approval Queue')}</span>
                  </SpotlightHeading>
                  {governanceReqs.filter((g) => g.scope === 'TENANT_ADMIN').length === 0 ? (
                    <p className="text-xs text-slate-500">
                      {tr('لا توجد طلبات حوكمة على مستوى المنشأة حالياً.', 'No tenant-level governance change requests yet.')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {governanceReqs
                        .filter((g) => g.scope === 'TENANT_ADMIN')
                        .map((g) => (
                          <div key={g.id} className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-bold">{g.request_title}</div>
                              <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-500">
                                {g.status}
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
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <input
                                  value={govRemarksMap[g.id] || ''}
                                  onChange={(e) => setGovRemarksMap((prev) => ({ ...prev, [g.id]: e.target.value }))}
                                  placeholder={tr('ملاحظات الاعتماد أو التعديل...', 'Approval / amendment remarks...')}
                                  className="min-h-[34px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                                />
                                <button
                                  type="button"
                                  onClick={() => resolveGovRequest(g.id, 'APPROVED')}
                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white"
                                >
                                  {tr('اعتماد', 'Approve')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => resolveGovRequest(g.id, 'RETURNED_FOR_AMENDMENT')}
                                  className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950"
                                >
                                  {tr('إعادة للتعديل', 'Return')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => resolveGovRequest(g.id, 'REJECTED')}
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

                <SpotlightCard className="space-y-4 text-start">
                  <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                    <Send className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                    <span>
                      {resubmitTenantId
                        ? tr('تعديل وإعادة إرسال طلب هوية المنشأة', 'Amend & Resubmit Tenant Change Request')
                        : tr('طلب تعديل بيانات المنشأة (يتطلب اعتماد مدير المنصة)', 'Request Tenant Identity Change (Super-Admin Approval)')}
                    </span>
                  </SpotlightHeading>
                  <form onSubmit={submitTenantGovRequest} className="grid gap-3 text-xs sm:grid-cols-2">
                    <input
                      value={tenantGovForm.name}
                      onChange={(e) => setTenantGovForm({ ...tenantGovForm, name: e.target.value })}
                      placeholder={tr('اسم المنشأة الجديد (اختياري)', 'New Venue Name (optional)')}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <input
                      dir="ltr"
                      value={tenantGovForm.slug}
                      onChange={(e) => setTenantGovForm({ ...tenantGovForm, slug: e.target.value })}
                      placeholder={tr('المعرف الجديد (slug)', 'New Slug (e.g. qasralomara)')}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <input
                      dir="ltr"
                      value={tenantGovForm.custom_domain}
                      onChange={(e) => setTenantGovForm({ ...tenantGovForm, custom_domain: e.target.value })}
                      placeholder={tr('النطاق المخصص (CNAME)', 'Custom Domain (optional)')}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        dir="ltr"
                        value={tenantGovForm.currency}
                        onChange={(e) => setTenantGovForm({ ...tenantGovForm, currency: e.target.value })}
                        placeholder={tr('العملة (USD)', 'Currency')}
                        className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        dir="ltr"
                        type="number"
                        step="0.01"
                        value={tenantGovForm.tax_rate}
                        onChange={(e) => setTenantGovForm({ ...tenantGovForm, tax_rate: e.target.value })}
                        placeholder={tr('نسبة الضريبة %', 'Tax Rate %')}
                        className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <input
                      value={resubmitTenantId ? resubmitRemarks : tenantGovForm.remarks}
                      onChange={(e) =>
                        resubmitTenantId
                          ? setResubmitRemarks(e.target.value)
                          : setTenantGovForm({ ...tenantGovForm, remarks: e.target.value })
                      }
                      placeholder={tr('سبب التعديل / ملاحظات لمدير المنصة', 'Reason / remarks for Super Admin')}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 sm:col-span-2 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <div className="flex gap-2 sm:col-span-2">
                      <button type="submit" className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                        {resubmitTenantId ? tr('إعادة إرسال للمنصة', 'Resubmit Request') : tr('رفع الطلب لمدير المنصة', 'Submit to Super Admin')}
                      </button>
                      {resubmitTenantId && (
                        <button
                          type="button"
                          onClick={() => {
                            setResubmitTenantId(null);
                            setTenantGovForm({ name: '', slug: '', custom_domain: '', currency: '', tax_rate: '', remarks: '' });
                          }}
                          className="min-h-[38px] rounded-lg border border-slate-300 px-3 dark:border-slate-700"
                        >
                          {tr('إلغاء', 'Cancel')}
                        </button>
                      )}
                    </div>
                  </form>

                  {governanceReqs.filter((g) => g.scope === 'SUPER_ADMIN').length > 0 && (
                    <div className="space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
                      {governanceReqs
                        .filter((g) => g.scope === 'SUPER_ADMIN')
                        .map((g) => (
                          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                            <div>
                              <div className="font-bold">{g.request_title}</div>
                              <div className="font-mono text-[11px] text-slate-500">{JSON.stringify(g.proposed_values)}</div>
                              {g.reviewer_remarks && (
                                <div className="text-[11px] text-amber-500">
                                  {tr('ملاحظات المنصة:', 'Platform Remarks:')} {g.reviewer_remarks}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-white">{g.status}</span>
                              {g.status === 'RETURNED_FOR_AMENDMENT' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResubmitTenantId(g.id);
                                    const pv = g.proposed_values || {};
                                    setTenantGovForm({
                                      name: String(pv.name || ''),
                                      slug: String(pv.slug || ''),
                                      custom_domain: String(pv.custom_domain || ''),
                                      currency: String(pv.currency || ''),
                                      tax_rate: pv.tax_rate !== undefined ? String(pv.tax_rate) : '',
                                      remarks: g.requester_remarks || '',
                                    });
                                  }}
                                  className="rounded border border-amber-500 px-2.5 py-1 text-[11px] font-bold text-amber-500"
                                >
                                  {tr('تعديل وإعادة إرسال', 'Amend & Resubmit')}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </SpotlightCard>
              </div>
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {selectedEvent.title || selectedEvent.client_name}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTitleEventId(selectedEvent.id);
                          setTitleDraft(selectedEvent.title || '');
                          setTitleRemarks('');
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[10px] font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>{tr('تعديل العنوان', 'Edit Title')}</span>
                      </button>
                    </div>
                    {editingTitleEventId === selectedEvent.id && (
                      <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2">
                        <input
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          placeholder={tr('عنوان الفعالية المخصص...', 'Custom event title...')}
                          className="min-h-[34px] w-full rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                        />
                        <input
                          value={titleRemarks}
                          onChange={(e) => setTitleRemarks(e.target.value)}
                          placeholder={tr('ملاحظة سجل التدقيق (اختياري)', 'Audit remarks (optional)')}
                          className="min-h-[34px] w-full rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => saveInlineEventTitle(selectedEvent.id)}
                            className="rounded bg-[var(--brand-primary,#D4AF37)] px-2.5 py-1 text-[11px] font-bold text-slate-950"
                          >
                            {tr('حفظ', 'Save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTitleEventId(null)}
                            className="rounded border border-slate-300 px-2.5 py-1 text-[11px] dark:border-slate-700"
                          >
                            {tr('إلغاء', 'Cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedEvent.title && (
                      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        {selectedEvent.client_name}
                      </div>
                    )}
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
                        setSecurityInitialSubTab('DEPOSIT_CLOSE');
                        setActiveTab('SECURITY');
                      }}
                      className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 font-bold text-slate-950"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span>{tr('الأمن والتأمين والإغلاق', 'Security & Close Op')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectEvent(selectedEvent);
                        setInspectStatus('PASSED');
                        setDeductionAmount('0');
                      }}
                      className="inline-flex min-h-[38px] items-center rounded-lg border border-amber-500/40 px-3 font-bold text-amber-600 dark:text-amber-300"
                    >
                      {tr('فحص سريع', 'Quick Inspect')}
                    </button>
                    <Link
                      href={
                        process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE'
                          ? tenantPath(locale, tenantSlug, `/erp/finance/events/_/pnl/?id=${encodeURIComponent(selectedEvent.id)}`)
                          : tenantPath(locale, tenantSlug, `/erp/finance/events/${selectedEvent.id}/pnl`)
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
              <div className="flex items-center gap-2">
                <BackButton locale={locale} compact onClick={() => setInspectEvent(null)} />
                <button type="button" onClick={() => setInspectEvent(null)} aria-label="Close modal" className="rounded-lg p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
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
