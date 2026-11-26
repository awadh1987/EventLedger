'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileDown,
  FileSignature,
  LayoutTemplate,
  Lock,
  MessageSquare,
  QrCode,
  Send,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { LookupSelect } from '@/components/ui/LookupSelect';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, downloadAuthorizedFile, isNativeBuild } from '@/lib/api';
import type { PortalEvent } from '@/lib/types';

type PortalTab = 'CONTRACT' | 'FINANCE' | 'GUESTS' | 'DELEGATES' | 'CHAT' | 'AUDIT';

interface PaymentAccount {
  method: string;
  label_ar: string;
  label_en: string;
  account_name: string;
  account_number: string;
}

interface ContractDto {
  id: string;
  event_id: string;
  contract_number: string;
  terms_ar: string;
  terms_en: string;
  client_signed_at: string | null;
  client_signature_name: string | null;
  staff_countersigned_at: string | null;
}

interface GuestDto {
  id: string;
  full_name: string;
  phone: string | null;
  vip_tier: string;
  dietary_notes: string | null;
  table_label: string | null;
  rsvp_status: string;
  qr_token: string | null;
  pass_type: string | null;
  is_checked_in: boolean;
}

interface DelegateRow {
  id: string;
  full_name: string;
  phone: string;
  delegate_role: string;
  permissions: Record<string, boolean>;
}

interface ApprovalRow {
  id: string;
  event_code: string;
  draft_type: string;
  financial_delta: number;
  requested_by_name: string;
  payload: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  action: string;
  actor_name: string;
  new_value?: Record<string, unknown> | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  sender_name: string;
  channel: string;
  department?: string | null;
  content: string;
  created_at: string;
}

export default function ClientPortalDashboard() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [activeTab, setActiveTab] = useState<PortalTab>('CONTRACT');
  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [contract, setContract] = useState<ContractDto | null>(null);
  const [guests, setGuests] = useState<GuestDto[]>([]);
  const [delegates, setDelegates] = useState<DelegateRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Contract E-Sign
  const [signatureName, setSignatureName] = useState('');

  // Guest form
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestTier, setGuestTier] = useState('STANDARD');
  const [guestTable, setGuestTable] = useState('');
  const [guestDietary, setGuestDietary] = useState('');

  // Profile form
  const [clientCategory, setClientCategory] = useState('INDIVIDUAL_B2C');
  const [nationalId, setNationalId] = useState('');
  const [taxId, setTaxId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [refundMethod, setRefundMethod] = useState('KURAIMI');
  const [refundAccount, setRefundAccount] = useState('');

  // Delegate form
  const [delName, setDelName] = useState('');
  const [delPhone, setDelPhone] = useState('');
  const [delEmail, setDelEmail] = useState('');
  const [delRole, setDelRole] = useState('WEDDING_PLANNER');
  const [canViewFinance, setCanViewFinance] = useState(false);
  const [canEditFloorplan, setCanEditFloorplan] = useState(true);
  const [canEditCatering, setCanEditCatering] = useState(true);
  const [canRequestAddons, setCanRequestAddons] = useState(true);
  const [canManageGuests, setCanManageGuests] = useState(true);

  // Chat
  const [chatDept, setChatDept] = useState('ALL');
  const [chatText, setChatText] = useState('');

  const activeEvent = events.find((e) => e.id === selectedEventId) || events[0] || null;

  const loadEventScopedData = useCallback(async (eventId: string) => {
    const [ctrRes, gstRes, delRes, msgRes, logRes] = await Promise.allSettled([
      apiFetch<ContractDto>(`/api/v1/portal/events/${eventId}/contract`),
      apiFetch<GuestDto[]>(`/api/v1/portal/events/${eventId}/guests`),
      apiFetch<DelegateRow[]>(`/api/v1/portal/events/${eventId}/delegates`),
      apiFetch<MessageRow[]>(`/api/v1/events/${eventId}/messages`),
      apiFetch<AuditRow[]>(`/api/v1/portal/audit-logs?event_id=${encodeURIComponent(eventId)}`),
    ]);
    setContract(ctrRes.status === 'fulfilled' ? ctrRes.value : null);
    setGuests(gstRes.status === 'fulfilled' ? gstRes.value : []);
    setDelegates(delRes.status === 'fulfilled' ? delRes.value : []);
    setMessages(msgRes.status === 'fulfilled' ? msgRes.value : []);
    setAuditLogs(logRes.status === 'fulfilled' ? logRes.value : []);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [evs, accs, apps, me] = await Promise.all([
        apiFetch<PortalEvent[]>('/api/v1/portal/events'),
        apiFetch<PaymentAccount[]>('/api/v1/portal/payment-accounts'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
        apiFetch<{
          user?: { full_name?: string };
          profile: {
            client_category: string;
            national_id_or_cr?: string;
            tax_id?: string;
            company_name?: string;
            refund_bank_details?: { method?: string; account_number?: string };
          } | null;
        }>('/api/v1/portal/me'),
      ]);
      setEvents(evs);
      setAccounts(accs);
      setApprovals(apps);
      if (me.user?.full_name) {
        setSignatureName((prev) => prev || me.user!.full_name || '');
      }
      if (me.profile) {
        setClientCategory(me.profile.client_category);
        setNationalId(me.profile.national_id_or_cr || '');
        setTaxId(me.profile.tax_id || '');
        setCompanyName(me.profile.company_name || '');
        setRefundMethod(me.profile.refund_bank_details?.method || 'KURAIMI');
        setRefundAccount(me.profile.refund_bank_details?.account_number || '');
      }
      const nextEventId =
        evs.find((e) => e.id === selectedEventId)?.id || evs[0]?.id || '';
      if (nextEventId) {
        setSelectedEventId(nextEventId);
        await loadEventScopedData(nextEventId);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Sign in to view your portal');
    }
  }, [loadEventScopedData, selectedEventId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (selectedEventId) {
      loadEventScopedData(selectedEventId);
    }
  }, [loadEventScopedData, selectedEventId]);

  const copyValue = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const signContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !signatureName.trim()) return;
    await apiFetch(`/api/v1/portal/events/${activeEvent.id}/contract/sign`, {
      method: 'POST',
      body: { signature_name: signatureName.trim() },
    });
    setStatusMsg(isRtl ? 'تم توقيع العقد إلكترونياً بنجاح' : 'Contract signed electronically');
    await loadEventScopedData(activeEvent.id);
  };

  const addGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !guestName.trim()) return;
    const created = await apiFetch<{ qr_token: string }>(`/api/v1/portal/events/${activeEvent.id}/guests`, {
      method: 'POST',
      body: {
        full_name: guestName.trim(),
        phone: guestPhone.trim() || null,
        vip_tier: guestTier,
        table_label: guestTable.trim() || null,
        dietary_notes: guestDietary.trim() || null,
      },
    });
    setGuestName('');
    setGuestPhone('');
    setGuestTable('');
    setGuestDietary('');
    setStatusMsg(isRtl ? `تم إصدار بطاقة QR للضيف (${created.qr_token})` : `Guest QR pass generated (${created.qr_token})`);
    await loadEventScopedData(activeEvent.id);
  };

  const uploadReceipt = async (milestoneId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiFetch(`/api/v1/portal/milestones/${milestoneId}/receipt`, { method: 'POST', formData: fd });
    setStatusMsg(isRtl ? 'تم رفع الإيصال بنجاح وهو قيد مراجعة المالية' : 'Receipt uploaded for finance review');
    await loadAll();
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/v1/portal/profile', {
      method: 'PATCH',
      body: {
        client_category: clientCategory,
        national_id_or_cr: nationalId,
        tax_id: taxId || null,
        company_name: companyName || null,
        refund_bank_details: { method: refundMethod, account_number: refundAccount },
      },
    });
    setStatusMsg(isRtl ? 'تم حفظ بيانات الفوترة وحساب الاسترداد' : 'Billing & refund account saved');
    await loadAll();
  };

  const addDelegate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent) return;
    await apiFetch(`/api/v1/portal/events/${activeEvent.id}/delegates`, {
      method: 'POST',
      body: {
        full_name: delName,
        phone: delPhone,
        email: delEmail || null,
        delegate_role: delRole,
        permissions: {
          canViewFinance,
          canEditFloorplan,
          canEditCatering,
          canRequestAddons,
          canManageGuests,
          canChat: true,
        },
      },
    });
    setDelName('');
    setDelPhone('');
    setDelEmail('');
    setStatusMsg(isRtl ? 'تم حفظ صلاحيات المفوض بنجاح' : 'Delegate permissions saved');
    await loadEventScopedData(activeEvent.id);
  };

  const removeDelegate = async (delegateId: string) => {
    if (!activeEvent) return;
    await apiFetch(`/api/v1/portal/events/${activeEvent.id}/delegates/${delegateId}`, {
      method: 'DELETE',
    });
    await loadEventScopedData(activeEvent.id);
  };

  const resolveApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    await apiFetch(`/api/v1/approvals/${id}/resolve`, {
      method: 'POST',
      body: { decision },
    });
    setStatusMsg(isRtl ? 'تم تحديث قرار الاعتماد' : `Approval ${decision.toLowerCase()}`);
    await loadAll();
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !chatText.trim()) return;
    await apiFetch(`/api/v1/events/${activeEvent.id}/messages`, {
      method: 'POST',
      body: { content: chatText, department: chatDept },
    });
    setChatText('');
    await loadEventScopedData(activeEvent.id);
  };

  const hoursUntilEvent = activeEvent
    ? Math.max(0, Math.round((new Date(activeEvent.start_time).getTime() - Date.now()) / 3600000))
    : null;
  const cateringLocked = hoursUntilEvent !== null && hoursUntilEvent <= 72;
  const floorPlanLocked = (hoursUntilEvent !== null && hoursUntilEvent <= 24) || Boolean(activeEvent?.is_locked);

  const floorPlanHref = activeEvent
    ? isNativeBuild()
      ? `/${locale}/portal/events/_/floor-plan/?id=${encodeURIComponent(activeEvent.id)}`
      : `/${locale}/portal/events/${activeEvent.id}/floor-plan`
    : '#';

  const tabs: { id: PortalTab; labelAr: string; labelEn: string }[] = [
    { id: 'CONTRACT', labelAr: 'العقد والتوقيع', labelEn: 'Digital Contract' },
    { id: 'FINANCE', labelAr: 'الدفعات والتأمين', labelEn: 'Milestones & Vault' },
    { id: 'GUESTS', labelAr: 'الضيوف و QR', labelEn: 'Guests & QR Passes' },
    { id: 'DELEGATES', labelAr: 'تفويض الفريق', labelEn: 'Delegation' },
    { id: 'CHAT', labelAr: 'المحادثة', labelEn: 'Event Chat' },
    { id: 'AUDIT', labelAr: 'سجل التدقيق', labelEn: 'Audit Log' },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Module 1: Active Event Switcher + Floor Plan Shortcut */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <div>
            <SpotlightHeading as="h1" className="text-start text-2xl">
              {isRtl ? 'لوحة تحكم العميل وبوابة الفعاليات' : 'Client Account Control Panel'}
            </SpotlightHeading>
            {activeEvent && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {activeEvent.event_code} — {isRtl ? activeEvent.hall_name_ar : activeEvent.hall_name} ({activeEvent.status})
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {events.length > 0 && (
              <select
                aria-label={isRtl ? 'اختيار الفعالية' : 'Select Event'}
                value={activeEvent?.id || ''}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.event_code} — {isRtl ? ev.hall_name_ar : ev.hall_name}
                  </option>
                ))}
              </select>
            )}

            {activeEvent && (
              <Link
                href={floorPlanHref}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950"
              >
                <LayoutTemplate className="h-4 w-4" />
                <span>{isRtl ? 'مصمم مخطط القاعة التفاعلي' : 'Interactive Floor Plan Designer'}</span>
              </Link>
            )}
          </div>
        </div>

        {statusMsg && (
          <SpotlightCard className="border-amber-500/40 bg-amber-500/10 py-3 text-start text-xs text-amber-600 dark:text-amber-300">
            {statusMsg}
          </SpotlightCard>
        )}

        {/* Event Countdown & Pre-Event Lockout Banners (72h Catering / 24h Floor Plan) */}
        {activeEvent && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SpotlightCard className="flex items-center gap-3 text-start">
              <Clock className="h-6 w-6 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'العد التنازلي للمناسبة' : 'Event Countdown'}
                </div>
                <div className="font-mono text-lg font-extrabold">
                  {hoursUntilEvent !== null
                    ? isRtl
                      ? `${Math.floor(hoursUntilEvent / 24)} يوم و ${hoursUntilEvent % 24} ساعة`
                      : `${Math.floor(hoursUntilEvent / 24)}d ${hoursUntilEvent % 24}h remaining`
                    : '-'}
                </div>
              </div>
            </SpotlightCard>

            <SpotlightCard
              className={`flex items-center gap-3 text-start ${
                cateringLocked ? 'border-rose-500/40 bg-rose-500/10' : 'border-emerald-500/30 bg-emerald-500/5'
              }`}
            >
              <Lock className={`h-5 w-5 shrink-0 ${cateringLocked ? 'text-rose-500' : 'text-emerald-500'}`} />
              <div>
                <div className="text-xs font-bold">
                  {isRtl ? 'نافذة قفل قائمة الضيافة (72 ساعة)' : '72h Catering Lockout Window'}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  {cateringLocked
                    ? isRtl
                      ? 'تم تجميد تعديل البوفيه قبل المناسبة بأقل من 72 ساعة'
                      : 'Catering edits frozen (< 72h to event)'
                    : isRtl
                      ? 'متاح للتعديل قبل 72 ساعة من الموعد'
                      : 'Editable until 72h prior to start'}
                </div>
              </div>
            </SpotlightCard>

            <SpotlightCard
              className={`flex items-center gap-3 text-start ${
                floorPlanLocked ? 'border-rose-500/40 bg-rose-500/10' : 'border-emerald-500/30 bg-emerald-500/5'
              }`}
            >
              <Lock className={`h-5 w-5 shrink-0 ${floorPlanLocked ? 'text-rose-500' : 'text-emerald-500'}`} />
              <div>
                <div className="text-xs font-bold">
                  {isRtl ? 'نافذة قفل مخطط القاعة (24 ساعة)' : '24h Floor Plan Lockout Window'}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  {floorPlanLocked
                    ? isRtl
                      ? 'المخطط مقفل حالياً للتنفيذ النهائي'
                      : 'Floor plan locked for final setup'
                    : isRtl
                      ? 'متاح لتعديل الطاولات والكوشة'
                      : 'Editable until 24h prior to start'}
                </div>
              </div>
            </SpotlightCard>
          </div>
        )}

        {/* Pending Delegate Approval Banner */}
        {approvals.length > 0 && (
          <SpotlightCard className="space-y-3 border-amber-500/40 bg-amber-500/10 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>{isRtl ? 'طلبات اعتماد معلقة من المنسق/المفوض' : 'Pending Delegate Approval Requests'}</span>
            </SpotlightHeading>
            {approvals.map((ap) => (
              <div
                key={ap.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-950/70"
              >
                <div className="text-xs sm:text-sm">
                  <span className="font-bold">{ap.event_code}</span> — {ap.draft_type} ({ap.requested_by_name}) ·{' '}
                  <span className="font-mono font-bold text-amber-500">
                    +{Number(ap.financial_delta).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolveApproval(ap.id, 'APPROVED')}
                    className="min-h-[40px] rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white"
                  >
                    {isRtl ? 'موافقة' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveApproval(ap.id, 'REJECTED')}
                    className="min-h-[40px] rounded-lg bg-rose-600 px-4 text-xs font-bold text-white"
                  >
                    {isRtl ? 'رفض' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </SpotlightCard>
        )}

        {/* 6-Tab Navigation */}
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[42px] rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === tab.id
                  ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                  : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {isRtl ? tab.labelAr : tab.labelEn}
            </button>
          ))}
        </div>

        {/* Module 2: Digital Contract Viewer & E-Signature Pad */}
        {activeTab === 'CONTRACT' && (
          <SpotlightCard className="space-y-5 text-start">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
                <FileSignature className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{isRtl ? 'العقد الإلكتروني والتوقيع الرقمي' : 'Digital Contract & E-Signature'}</span>
              </SpotlightHeading>
              {contract && (
                <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold dark:bg-slate-800">
                  {contract.contract_number}
                </span>
              )}
            </div>

            {contract ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed dark:border-slate-800 dark:bg-slate-950">
                    <div className="mb-1 font-bold text-amber-500">الشروط والأحكام (عربي)</div>
                    <p>{contract.terms_ar}</p>
                  </div>
                  <div dir="ltr" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-start text-xs leading-relaxed dark:border-slate-800 dark:bg-slate-950">
                    <div className="mb-1 font-bold text-amber-500">Terms & Conditions (English)</div>
                    <p>{contract.terms_en}</p>
                  </div>
                </div>

                {contract.client_signed_at ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-600 dark:text-emerald-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      <div>
                        <div className="font-bold">
                          {isRtl ? 'تم توقيع العقد إلكترونياً' : 'Digitally Signed by Client'}:{' '}
                          {contract.client_signature_name}
                        </div>
                        <div dir="ltr" className="font-mono text-[11px]">
                          {contract.client_signed_at.slice(0, 19).replace('T', ' ')}
                        </div>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-500/20 px-3 py-1 font-bold">
                      {contract.staff_countersigned_at
                        ? isRtl
                          ? 'معتمد من الإدارة ✓'
                          : 'Countersigned ✓'
                        : isRtl
                          ? 'موقع من العميل ✓'
                          : 'Client Signed ✓'}
                    </span>
                  </div>
                ) : (
                  <form onSubmit={signContract} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <label className="block text-xs font-bold">
                      {isRtl ? 'الاسم الكامل للتوقيع الإلكتروني' : 'Full Legal Name for E-Signature'}
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        required
                        value={signatureName}
                        onChange={(e) => setSignatureName(e.target.value)}
                        placeholder={isRtl ? 'اكتب اسمك الكامل للتوقيع' : 'Type full name to sign'}
                        className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <div className="flex min-h-[44px] items-center rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-4 font-serif text-base italic text-amber-500">
                        {signatureName || (isRtl ? 'معاينة التوقيع...' : 'Signature preview...')}
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="min-h-[44px] rounded-xl bg-[var(--brand-primary,#D4AF37)] px-6 text-xs font-bold text-slate-950"
                    >
                      {isRtl ? 'اعتماد وتوقيع العقد إلكترونياً' : 'Sign Contract Electronically'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">
                {isRtl ? 'لا يوجد عقد مرتبط بهذه الفعالية بعد.' : 'No contract found for this event.'}
              </p>
            )}
          </SpotlightCard>
        )}

        {/* Module 3: Payment Milestones, Camera Receipt Upload, One-Tap Bank Copy & Security Deposit Vault */}
        {activeTab === 'FINANCE' && (
          <div className="space-y-6 text-start">
            {activeEvent?.invoice && (
              <>
                {/* Security Deposit Vault Tracker */}
                <SpotlightCard className="flex flex-wrap items-center justify-between gap-4 border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
                    <div>
                      <div className="text-xs font-bold text-amber-500">
                        {isRtl ? 'خزينة تأمين الأضرار المسترد (التزامات 2100)' : 'Security Deposit Vault (Liability 2100)'}
                      </div>
                      <div className="text-sm font-bold">
                        {Number(activeEvent.invoice.security_deposit_amount).toLocaleString()} —{' '}
                        <span className="font-mono">{activeEvent.invoice.deposit_status}</span>
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-slate-800">
                    {activeEvent.invoice.status}
                  </span>
                </SpotlightCard>

                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Milestones & Camera Receipt Capture */}
                  <SpotlightCard className="space-y-4">
                    <div className="flex items-center justify-between">
                      <SpotlightHeading as="h2" className="text-start text-lg">
                        {isRtl ? 'الدفعات المالية ورفع الإيصالات' : 'Payment Milestones & Receipt Capture'}
                      </SpotlightHeading>
                      <button
                        type="button"
                        onClick={() =>
                          downloadAuthorizedFile(
                            `/api/v1/exports/invoices/${activeEvent.invoice!.id}/pdf?locale=${locale}`,
                            `${activeEvent.invoice!.invoice_number}-${locale}.pdf`
                          )
                        }
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
                      >
                        <FileDown className="h-4 w-4" />
                        PDF
                      </button>
                    </div>

                    <div className="space-y-3">
                      {activeEvent.invoice.milestones.map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                        >
                          <div>
                            <div className="text-sm font-bold">{m.title}</div>
                            <div className="font-mono text-xs text-slate-500">
                              {Number(m.amount_due).toLocaleString()} — {m.status}
                            </div>
                          </div>
                          {m.status !== 'PAID' && (
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white dark:bg-slate-800">
                              <Camera className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                              <span>{isRtl ? 'تصوير الإيصال' : 'Capture Receipt'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadReceipt(m.id, f);
                                }}
                              />
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </SpotlightCard>

                  {/* One-Tap Bank & E-Wallet Copy */}
                  <SpotlightCard className="space-y-4">
                    <SpotlightHeading as="h2" className="text-start text-lg">
                      {isRtl ? 'حسابات القاعة للتحويل (نسخ بلمسة)' : 'Venue Payment Accounts (One-Tap Copy)'}
                    </SpotlightHeading>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {accounts.map((a) => (
                        <div key={a.method} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                          <div className="text-xs font-bold">{isRtl ? a.label_ar : a.label_en}</div>
                          <div className="text-[11px] text-slate-500">{a.account_name}</div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span dir="ltr" className="font-mono text-xs font-bold">
                              {a.account_number}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyValue(a.method, a.account_number)}
                              className="flex min-h-[36px] items-center gap-1 rounded border border-slate-300 px-2 text-[11px] dark:border-slate-700"
                            >
                              {copiedKey === a.method ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              <span>{copiedKey === a.method ? (isRtl ? 'نُسخ' : 'Copied') : isRtl ? 'نسخ' : 'Copy'}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SpotlightCard>
                </div>
              </>
            )}

            {/* B2C/B2B Billing & Security Deposit Refund Account */}
            <SpotlightCard>
              <form onSubmit={saveProfile} className="space-y-3">
                <SpotlightHeading as="h2" className="text-start text-lg">
                  {isRtl ? 'ملف الفوترة وحساب استرداد التأمين' : 'B2C/B2B Profile & Security Deposit Refund Account'}
                </SpotlightHeading>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <select
                    value={clientCategory}
                    onChange={(e) => setClientCategory(e.target.value)}
                    className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="INDIVIDUAL_B2C">{isRtl ? 'فرد (B2C)' : 'Individual (B2C)'}</option>
                    <option value="CORPORATE_B2B">{isRtl ? 'شركة / مؤسسة (B2B)' : 'Corporate (B2B)'}</option>
                  </select>
                  <input
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder={isRtl ? 'الهوية الوطنية / السجل التجاري' : 'National ID / CR'}
                    className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                  <LookupSelect
                    category="REFUND_METHOD"
                    locale={locale}
                    value={refundMethod}
                    onChange={setRefundMethod}
                    fallbackOptions={[
                      { code: 'KURAIMI', label_ar: 'بنك الكريمي', label_en: 'Kuraimi' },
                      { code: 'JAIB', label_ar: 'جيب', label_en: 'Jaib' },
                      { code: 'JAWALI', label_ar: 'جوالي', label_en: 'Jawali' },
                      { code: 'ONECASH', label_ar: 'ون كاش', label_en: 'OneCash' },
                      { code: 'IBAN', label_ar: 'حوالة IBAN', label_en: 'IBAN' },
                    ]}
                  />
                  <input
                    dir="ltr"
                    value={refundAccount}
                    onChange={(e) => setRefundAccount(e.target.value)}
                    placeholder={isRtl ? 'رقم حساب الاسترداد / IBAN' : 'Refund Account / IBAN'}
                    className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                  {clientCategory === 'CORPORATE_B2B' && (
                    <>
                      <input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder={isRtl ? 'اسم الشركة' : 'Company Name'}
                        className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        dir="ltr"
                        value={taxId}
                        onChange={(e) => setTaxId(e.target.value)}
                        placeholder={isRtl ? 'الرقم الضريبي' : 'Tax ID'}
                        className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </>
                  )}
                </div>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 text-xs font-bold text-slate-950"
                >
                  {isRtl ? 'حفظ بيانات الحساب' : 'Save Profile'}
                </button>
              </form>
            </SpotlightCard>
          </div>
        )}

        {/* Module 4: Guest List & Auto QR Pass Generator */}
        {activeTab === 'GUESTS' && (
          <SpotlightCard className="space-y-5 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
              <Users className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'قائمة الضيوف وإصدار تصاريح QR الفورية' : 'Guest List & Auto QR Gate Passes'}</span>
            </SpotlightHeading>

            <form onSubmit={addGuest} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input
                required
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder={isRtl ? 'اسم الضيف' : 'Guest Full Name'}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                dir="ltr"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+96777..."
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <select
                value={guestTier}
                onChange={(e) => setGuestTier(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="STANDARD">STANDARD</option>
                <option value="VIP">VIP</option>
                <option value="FAMILY">FAMILY</option>
                <option value="SPEAKER">SPEAKER</option>
              </select>
              <input
                value={guestTable}
                onChange={(e) => setGuestTable(e.target.value)}
                placeholder={isRtl ? 'رقم الطاولة (مثال VIP-T1)' : 'Table Label'}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                value={guestDietary}
                onChange={(e) => setGuestDietary(e.target.value)}
                placeholder={isRtl ? 'ملاحظات غذائية' : 'Dietary Notes'}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="submit"
                className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 text-xs font-bold text-slate-950 sm:col-span-2 lg:col-span-5"
              >
                <QrCode className="me-1.5 inline h-4 w-4" />
                {isRtl ? 'إضافة الضيف وتوليد بطاقة QR' : 'Add Guest & Generate QR Pass'}
              </button>
            </form>

            <ResponsiveDataList
              data={guests}
              locale={locale}
              mobileCardHeader={(r) => `${r.full_name} (${r.vip_tier})`}
              columns={[
                { key: 'name', headerAr: 'الضيف', headerEn: 'Guest', render: (r) => <span className="font-semibold">{r.full_name}</span> },
                { key: 'tier', headerAr: 'الفئة', headerEn: 'Tier', render: (r) => <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800">{r.vip_tier}</span> },
                { key: 'table', headerAr: 'الطاولة', headerEn: 'Table', render: (r) => r.table_label || '-' },
                { key: 'diet', headerAr: 'ملاحظات', headerEn: 'Dietary', render: (r) => r.dietary_notes || '-' },
                {
                  key: 'qr',
                  headerAr: 'تصريح QR',
                  headerEn: 'QR Pass',
                  render: (r) =>
                    r.qr_token ? (
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-mono text-xs text-amber-500">
                          {r.qr_token}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyValue(`qr-${r.id}`, r.qr_token!)}
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] dark:border-slate-700"
                        >
                          {copiedKey === `qr-${r.id}` ? '✓' : isRtl ? 'نسخ' : 'Copy'}
                        </button>
                      </div>
                    ) : (
                      '-'
                    ),
                },
              ]}
            />
          </SpotlightCard>
        )}

        {/* Module 5: Sub-User Delegation */}
        {activeTab === 'DELEGATES' && (
          <SpotlightCard className="space-y-4 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
              <UserPlus className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'تفويض المنسقين والمشاركين والموردين' : 'Sub-User Delegation & Granular Permissions'}</span>
            </SpotlightHeading>

            <form onSubmit={addDelegate} className="grid gap-3 sm:grid-cols-4">
              <input
                required
                value={delName}
                onChange={(e) => setDelName(e.target.value)}
                placeholder={isRtl ? 'الاسم الكامل' : 'Full Name'}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                required
                dir="ltr"
                value={delPhone}
                onChange={(e) => setDelPhone(e.target.value)}
                placeholder="+96777..."
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="email"
                dir="ltr"
                value={delEmail}
                onChange={(e) => setDelEmail(e.target.value)}
                placeholder="email@studio.local"
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <select
                value={delRole}
                onChange={(e) => setDelRole(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="WEDDING_PLANNER">{isRtl ? 'منسق زفاف (Wedding Planner)' : 'Wedding Planner'}</option>
                <option value="CO_HOST">{isRtl ? 'مضيف مشارك (Co-Host)' : 'Co-Host'}</option>
                <option value="VENDOR">{isRtl ? 'مورد خارجي (External Vendor)' : 'External Vendor'}</option>
              </select>

              <div className="flex flex-wrap gap-4 text-xs sm:col-span-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canViewFinance} onChange={(e) => setCanViewFinance(e.target.checked)} />
                  <span>{isRtl ? 'عرض المالية' : 'canViewFinance'}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canEditFloorplan} onChange={(e) => setCanEditFloorplan(e.target.checked)} />
                  <span>{isRtl ? 'تعديل المخطط' : 'canEditFloorplan'}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canEditCatering} onChange={(e) => setCanEditCatering(e.target.checked)} />
                  <span>{isRtl ? 'تعديل الضيافة' : 'canEditCatering'}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canRequestAddons} onChange={(e) => setCanRequestAddons(e.target.checked)} />
                  <span>{isRtl ? 'طلب إضافات' : 'canRequestAddons'}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canManageGuests} onChange={(e) => setCanManageGuests(e.target.checked)} />
                  <span>{isRtl ? 'إدارة الضيوف' : 'canManageGuests'}</span>
                </label>
              </div>

              <button
                type="submit"
                className="min-h-[44px] rounded-lg border border-[var(--brand-primary,#D4AF37)] text-xs font-bold text-[var(--brand-primary,#D4AF37)] sm:col-span-4"
              >
                {isRtl ? 'حفظ صلاحيات المفوض' : 'Save Delegate Permissions'}
              </button>
            </form>

            <div className="space-y-2 text-xs">
              {delegates.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div>
                    <span className="font-bold">{d.full_name}</span>{' '}
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] dark:bg-slate-800">
                      {d.delegate_role}
                    </span>{' '}
                    <span dir="ltr" className="text-slate-500">
                      {d.phone}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDelegate(d.id)}
                    className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-2.5 py-1 text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{isRtl ? 'إزالة' : 'Remove'}</span>
                  </button>
                </div>
              ))}
            </div>
          </SpotlightCard>
        )}

        {/* Module 6a: Unified Event Chat Thread */}
        {activeTab === 'CHAT' && (
          <SpotlightCard className="space-y-3 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
              <MessageSquare className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'المحادثة الموحدة مع إدارة القاعة' : 'Unified Event Chat Thread'}</span>
            </SpotlightHeading>

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {messages.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2 font-bold">
                    <span>
                      {m.sender_name}{' '}
                      <span className="text-[10px] text-slate-400">
                        ({m.channel}
                        {m.department ? ` · @${m.department}` : ''})
                      </span>
                    </span>
                    <span dir="ltr" className="font-mono text-[10px] text-slate-400">
                      {m.created_at.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <p className="mt-1">{m.content}</p>
                </div>
              ))}
            </div>

            <form onSubmit={sendMessage} className="flex flex-wrap gap-2">
              <select
                value={chatDept}
                onChange={(e) => setChatDept(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="ALL">@ALL</option>
                <option value="KITCHEN">@Kitchen</option>
                <option value="OPS">@Ops</option>
                <option value="FINANCE">@Finance</option>
                <option value="SALES">@Sales</option>
              </select>
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder={isRtl ? 'اكتب رسالتك أو @Kitchen...' : 'Write a message or @Kitchen...'}
                className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="submit"
                className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-slate-950"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </SpotlightCard>
        )}

        {/* Module 6b: Immutable AuditLog Viewer */}
        {activeTab === 'AUDIT' && (
          <SpotlightCard className="space-y-3 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-start text-lg">
              <Shield className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? 'سجل التدقيق غير القابل للتعديل' : 'Immutable Audit Log'}</span>
            </SpotlightHeading>
            <ResponsiveDataList
              data={auditLogs}
              locale={locale}
              mobileCardHeader={(r) => r.action}
              columns={[
                {
                  key: 'action',
                  headerAr: 'الإجراء',
                  headerEn: 'Action',
                  render: (r) => <span className="font-mono text-xs">{r.action}</span>,
                },
                { key: 'actor', headerAr: 'المنفذ', headerEn: 'Actor', render: (r) => r.actor_name },
                {
                  key: 'details',
                  headerAr: 'التفاصيل',
                  headerEn: 'Details',
                  render: (r) => (
                    <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                      {r.new_value ? JSON.stringify(r.new_value) : '-'}
                    </span>
                  ),
                },
                {
                  key: 'time',
                  headerAr: 'الوقت',
                  headerEn: 'Time',
                  render: (r) => (
                    <span dir="ltr" className="font-mono text-xs">
                      {r.created_at.slice(0, 16).replace('T', ' ')}
                    </span>
                  ),
                },
              ]}
            />
          </SpotlightCard>
        )}
      </main>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
