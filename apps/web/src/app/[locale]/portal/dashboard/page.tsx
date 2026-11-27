'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarCheck,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  FileDown,
  FileSignature,
  KeyRound,
  LayoutTemplate,
  Lock,
  MessageSquare,
  QrCode,
  Send,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';
import { ClientSecurityPanel } from '@/components/portal/ClientSecurityPanel';
import { LookupSelect } from '@/components/ui/LookupSelect';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, downloadAuthorizedFile, getAccessToken, isNativeBuild, tenantPath } from '@/lib/api';
import { useAuthSession } from '@/components/providers/auth-provider';
import type { PortalEvent } from '@/lib/types';

type PortalTab =
  | 'EVENTS_APPROVALS'
  | 'INVOICES_PAYMENTS'
  | 'PROFILE_VAULT'
  | 'DELEGATION'
  | 'PASSES_AUDIT';

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
  status?: string;
  terms_ar: string;
  terms_en: string;
  remarks?: string | null;
  amendment_remarks?: string | null;
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
  event_id: string;
  event_code: string;
  draft_type: string;
  financial_delta: number;
  requested_by_name: string;
  required_approver_role: string;
  created_at: string;
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

interface GovernanceRequestRow {
  id: string;
  scope: string;
  target_entity_type: string;
  target_entity_id: string;
  request_title: string;
  current_values: Record<string, unknown>;
  proposed_values: Record<string, unknown>;
  status: string;
  requester_remarks: string | null;
  reviewer_remarks: string | null;
  created_at: string;
}

function describeApprovalPayload(ap: ApprovalRow): string {
  const p = ap.payload || {};
  if (typeof p.summary === 'string' && p.summary.trim()) return p.summary;
  if (typeof p.description === 'string' && p.description.trim()) return p.description;
  if (typeof p.item_name === 'string') {
    const q = p.quantity ? `+${p.quantity} ` : '';
    return `${q}${p.item_name}`;
  }
  const keys = Object.keys(p);
  if (keys.length === 0) return ap.draft_type;
  return keys
    .slice(0, 3)
    .map((k) => `${k}: ${String(p[k])}`)
    .join(' · ');
}

export default function ClientPortalDashboard() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const { tenantSlug } = useAuthSession();
  const [mounted, setMounted] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [pendingBooking, setPendingBooking] = useState<{
    booking_code?: string;
    client_phone?: string;
    client_name?: string;
    tenant_slug?: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<PortalTab>('EVENTS_APPROVALS');
  const { currentSearch } = useNavigationHistory();

  useEffect(() => {
    if (!currentSearch) return;
    const t = new URLSearchParams(currentSearch).get('tab');
    if (
      t === 'EVENTS_APPROVALS' ||
      t === 'INVOICES_PAYMENTS' ||
      t === 'PROFILE_VAULT' ||
      t === 'DELEGATION' ||
      t === 'PASSES_AUDIT'
    ) {
      setActiveTab(t);
    }
  }, [currentSearch]);
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Contract E-Sign & Return for Amendment
  const [signatureName, setSignatureName] = useState('');
  const [contractAmendNote, setContractAmendNote] = useState('');

  // Guest form
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestTier, setGuestTier] = useState('STANDARD');
  const [guestTable, setGuestTable] = useState('');
  const [guestDietary, setGuestDietary] = useState('');

  // Profile & Refund Vault
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const [clientCategory, setClientCategory] = useState('INDIVIDUAL_B2C');
  const [nationalId, setNationalId] = useState('');
  const [taxId, setTaxId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [refundMethod, setRefundMethod] = useState('KURAIMI');
  const [refundAccount, setRefundAccount] = useState('');

  // Change Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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

  // Tiered Governance Requests (Event Title & Client Identity)
  const [govRequests, setGovRequests] = useState<GovernanceRequestRow[]>([]);
  const [eventTitleReq, setEventTitleReq] = useState('');
  const [eventTitleRemarks, setEventTitleRemarks] = useState('');
  const [idChangeForm, setIdChangeForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    company_name: '',
    tax_id: '',
    national_id_or_cr: '',
    remarks: '',
  });
  const [resubmitGovId, setResubmitGovId] = useState<string | null>(null);

  const activeEvent = events.find((e) => e.id === selectedEventId) || events[0] || null;

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setHasToken(Boolean(getAccessToken()));
      const savedAvatar = localStorage.getItem('el_client_avatar');
      if (savedAvatar) setAvatarPreview(savedAvatar);
      try {
        const raw = localStorage.getItem('el_pending_booking');
        if (raw) setPendingBooking(JSON.parse(raw));
      } catch {
        // ignore invalid json
      }
    }
  }, []);

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
    if (!getAccessToken()) {
      setErrorMsg(null);
      return;
    }
    try {
      const [evs, accs, apps, me, govs] = await Promise.all([
        apiFetch<PortalEvent[]>('/api/v1/portal/events'),
        apiFetch<PaymentAccount[]>('/api/v1/portal/payment-accounts'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
        apiFetch<{
          user?: {
            full_name?: string;
            email?: string | null;
            phone?: string;
            is_2fa_enabled?: boolean;
          };
          profile: {
            client_category: string;
            national_id_or_cr?: string;
            tax_id?: string;
            company_name?: string;
            refund_bank_details?: { method?: string; account_number?: string };
          } | null;
        }>('/api/v1/portal/me'),
        apiFetch<GovernanceRequestRow[]>('/api/v1/governance/change-requests').catch(() => [] as GovernanceRequestRow[]),
      ]);
      setEvents(evs);
      setAccounts(accs);
      setApprovals(apps);
      setGovRequests(govs);
      if (me.user) {
        setFullName(me.user.full_name || '');
        setEmail(me.user.email || '');
        setPhone(me.user.phone || '');
        setIs2faEnabled(Boolean(me.user.is_2fa_enabled));
        setSignatureName((prev) => prev || me.user?.full_name || '');
      }
      if (me.profile) {
        setClientCategory(me.profile.client_category);
        setNationalId(me.profile.national_id_or_cr || '');
        setTaxId(me.profile.tax_id || '');
        setCompanyName(me.profile.company_name || '');
        setRefundMethod(me.profile.refund_bank_details?.method || 'KURAIMI');
        setRefundAccount(me.profile.refund_bank_details?.account_number || '');
      }
      const nextEventId = evs.find((e) => e.id === selectedEventId)?.id || evs[0]?.id || '';
      if (nextEventId) {
        setSelectedEventId(nextEventId);
        await loadEventScopedData(nextEventId);
      }
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : tr('يرجى تسجيل الدخول لعرض البوابة', 'Sign in to view your portal'));
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

  const submitEventTitleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !eventTitleReq.trim()) return;
    try {
      await apiFetch('/api/v1/governance/change-requests', {
        method: 'POST',
        body: {
          target_entity_type: 'EVENT',
          target_entity_id: activeEvent.id,
          proposed_values: { title: eventTitleReq.trim() },
          remarks: eventTitleRemarks.trim() || null,
        },
      });
      setStatusMsg(tr('تم إرسال طلب تعديل عنوان الفعالية لاعتماد الإدارة', 'Event title change submitted for Tenant Admin approval'));
      setEventTitleReq('');
      setEventTitleRemarks('');
      await loadAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit event title change');
    }
  };

  const submitClientIdentityChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const proposed: Record<string, unknown> = {};
    if (idChangeForm.full_name.trim()) proposed.full_name = idChangeForm.full_name.trim();
    if (idChangeForm.phone.trim()) proposed.phone = idChangeForm.phone.trim();
    if (idChangeForm.email.trim()) proposed.email = idChangeForm.email.trim();
    if (idChangeForm.company_name.trim()) proposed.company_name = idChangeForm.company_name.trim();
    if (idChangeForm.tax_id.trim()) proposed.tax_id = idChangeForm.tax_id.trim();
    if (idChangeForm.national_id_or_cr.trim()) proposed.national_id_or_cr = idChangeForm.national_id_or_cr.trim();
    if (Object.keys(proposed).length === 0) {
      setErrorMsg(tr('أدخل حقلاً واحداً على الأقل للتعديل', 'Provide at least one field to change'));
      return;
    }
    try {
      if (resubmitGovId) {
        await apiFetch(`/api/v1/governance/change-requests/${resubmitGovId}/resubmit`, {
          method: 'PATCH',
          body: { proposed_values: proposed, remarks: idChangeForm.remarks.trim() || null },
        });
        setStatusMsg(tr('تم تعديل وإعادة إرسال طلب تحديث الهوية', 'Amended identity request resubmitted'));
        setResubmitGovId(null);
      } else {
        await apiFetch('/api/v1/governance/change-requests', {
          method: 'POST',
          body: {
            target_entity_type: 'CLIENT',
            proposed_values: proposed,
            remarks: idChangeForm.remarks.trim() || null,
          },
        });
        setStatusMsg(tr('تم رفع طلب تحديث بيانات الهوية لاعتماد إدارة المنشأة', 'Identity change request submitted for Tenant Admin approval'));
      }
      setIdChangeForm({ full_name: '', phone: '', email: '', company_name: '', tax_id: '', national_id_or_cr: '', remarks: '' });
      await loadAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit client identity change');
    }
  };

  const kpis = useMemo(() => {
    const activeReservations = events.filter((e) => !['CANCELLED', 'COMPLETED'].includes(e.status)).length;
    let remainingBalance = 0;
    let escrowDeposit = 0;
    for (const ev of events) {
      if (!ev.invoice) continue;
      const paid = ev.invoice.milestones
        .filter((m) => !m.is_security_deposit)
        .reduce((s, m) => s + Number(m.paid_amount || 0), 0);
      remainingBalance += Math.max(0, Number(ev.invoice.total_amount || 0) - paid);
      escrowDeposit += Number(ev.invoice.security_deposit_amount || 0);
    }
    return {
      activeReservations,
      pendingApprovals: approvals.length,
      remainingBalance,
      escrowDeposit,
    };
  }, [approvals.length, events]);

  const copyValue = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleAvatarChange = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarPreview(reader.result);
        localStorage.setItem('el_client_avatar', reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const signContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !signatureName.trim()) return;
    await apiFetch(`/api/v1/portal/events/${activeEvent.id}/contract/sign`, {
      method: 'POST',
      body: { signature_name: signatureName.trim() },
    });
    setStatusMsg(tr('تم توقيع العقد إلكترونياً بنجاح', 'Contract signed electronically'));
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
    setStatusMsg(tr(`تم إصدار بطاقة QR للضيف (${created.qr_token})`, `Guest QR pass generated (${created.qr_token})`));
    await loadEventScopedData(activeEvent.id);
  };

  const uploadReceipt = async (milestoneId: string, file: File) => {
    const fd = new FormData();
    fd.append('receipt', file);
    await apiFetch(`/api/v1/portal/milestones/${milestoneId}/receipt`, { method: 'POST', formData: fd });
    setStatusMsg(tr('تم رفع الإيصال بنجاح وهو قيد مراجعة المالية', 'Receipt uploaded for finance review'));
    await loadAll();
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    await apiFetch('/api/v1/portal/profile', {
      method: 'PATCH',
      body: {
        full_name: fullName.trim() || null,
        is_2fa_enabled: is2faEnabled,
        client_category: clientCategory,
        national_id_or_cr: nationalId,
        tax_id: taxId || null,
        company_name: companyName || null,
        refund_bank_details: { method: refundMethod, account_number: refundAccount },
      },
    });
    setStatusMsg(tr('تم حفظ بيانات الحساب وحساب الاسترداد', 'Profile & refund vault saved'));
    await loadAll();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword !== confirmPassword) {
      setErrorMsg(tr('كلمتا المرور غير متطابقتين', 'New passwords do not match'));
      return;
    }
    try {
      await apiFetch('/api/v1/auth/change-password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatusMsg(tr('تم تغيير كلمة المرور بنجاح', 'Password updated successfully'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : tr('فشل تغيير كلمة المرور', 'Password update failed'));
    }
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
    setStatusMsg(tr('تم حفظ صلاحيات المفوض بنجاح', 'Delegate permissions saved'));
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
    setStatusMsg(tr('تم تحديث قرار الاعتماد ومزامنة الفاتورة', `Approval ${decision.toLowerCase()} & synced`));
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
      ? tenantPath(locale, tenantSlug, `/portal/events/_/floor-plan/?id=${encodeURIComponent(activeEvent.id)}`)
      : tenantPath(locale, tenantSlug, `/portal/events/${activeEvent.id}/floor-plan`)
    : '#';

  const tabs: { id: PortalTab; labelAr: string; labelEn: string }[] = [
    { id: 'EVENTS_APPROVALS', labelAr: 'الفعاليات والاعتمادات', labelEn: 'Events & Approvals' },
    { id: 'INVOICES_PAYMENTS', labelAr: 'الفواتير والدفعات', labelEn: 'Invoices & Payments' },
    { id: 'PROFILE_VAULT', labelAr: 'الملف وحساب الاسترداد', labelEn: 'Profile & Refund Vault' },
    { id: 'DELEGATION', labelAr: 'تفويض الفريق', labelEn: 'Event Delegation' },
    { id: 'PASSES_AUDIT', labelAr: 'تصاريح QR وسجل التدقيق', labelEn: 'VIP QR Passes & Audit' },
  ];

  const inputCls =
    'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Header + Event Switcher + Floor Plan Shortcut */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-start">
          <div>
            <SpotlightHeading as="h1" className="text-start text-2xl">
              {tr('لوحة تحكم العميل وبوابة الفعاليات', 'Client Account Control Panel')}
            </SpotlightHeading>
            {activeEvent && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {activeEvent.title ? `${activeEvent.title} · ` : ''}
                {activeEvent.event_code} — {isRtl ? activeEvent.hall_name_ar : activeEvent.hall_name} ({activeEvent.status})
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {events.length > 0 && (
              <select
                aria-label={tr('اختيار الفعالية', 'Select Event')}
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
                <span>{tr('مصمم مخطط القاعة التفاعلي', 'Interactive Floor Plan Designer')}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Top 4-KPI Strip */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarCheck className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('الحجوزات النشطة', 'Active Reservations')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{kpis.activeReservations}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>{tr('طلبات اعتماد معلقة', 'Pending Approvals')}</span>
            </div>
            <div className="font-mono text-2xl font-extrabold">{kpis.pendingApprovals}</div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Wallet className="h-4 w-4 text-sky-500" />
              <span>{tr('الرصيد المتبقي', 'Remaining Balance')}</span>
            </div>
            <div dir="ltr" className="font-mono text-2xl font-extrabold">
              {kpis.remainingBalance.toLocaleString()}
            </div>
          </SpotlightCard>
          <SpotlightCard className="space-y-1 text-start">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>{tr('تأمين الأضرار المحتجز', 'Escrow Security Deposit')}</span>
            </div>
            <div dir="ltr" className="font-mono text-2xl font-extrabold">
              {kpis.escrowDeposit.toLocaleString()}
            </div>
          </SpotlightCard>
        </div>

        {mounted && !hasToken && (
          <SpotlightCard className="flex flex-wrap items-center justify-between gap-4 border-amber-500/40 bg-amber-500/10 text-start">
            <div className="space-y-1 text-xs">
              <div className="font-bold text-amber-600 dark:text-amber-300">
                {pendingBooking?.booking_code
                  ? tr(`حجزك المبدئي (${pendingBooking.booking_code}) جاهز للمتابعة`, `Your booking (${pendingBooking.booking_code}) is ready`)
                  : tr('يرجى تسجيل الدخول لعرض بيانات حجوزاتك', 'Sign in to access your reservations & contracts')}
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                {pendingBooking?.client_phone
                  ? tr(
                    `استخدم رقم جوالك (${pendingBooking.client_phone}) للدخول إلى بوابة العميل.`,
                    `Use your phone (${pendingBooking.client_phone}) to sign in to the Client Portal.`
                  )
                  : tr('سجّل الدخول بحساب العميل أو برقم الجوال المسجل في الحجز.', 'Sign in with your client email or phone.')}
              </div>
            </div>
            <Link
              href={`${tenantPath(locale, pendingBooking?.tenant_slug || tenantSlug, '/portal/login')}${pendingBooking?.booking_code ? `?booking=${encodeURIComponent(pendingBooking.booking_code)}` : ''
                }`}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950"
            >
              {tr('تسجيل دخول العميل', 'Client Portal Sign In')}
            </Link>
          </SpotlightCard>
        )}

        {statusMsg && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-start text-xs text-emerald-600 dark:text-emerald-300">
            {statusMsg}
          </SpotlightCard>
        )}
        {errorMsg && (
          <SpotlightCard className="border-rose-500/40 bg-rose-500/10 py-3 text-start text-xs text-rose-500">
            {errorMsg}
          </SpotlightCard>
        )}

        {/* 5 Underlined Sub-Tabs */}
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

        {/* TAB 1: Events & Approvals */}
        {activeTab === 'EVENTS_APPROVALS' && (
          <div className="space-y-6 text-start">
            {activeEvent && activeEvent.status === 'HOLD_48H' && (() => {
              const firstMs = activeEvent.invoice?.milestones?.[0];
              const isUnderReview = firstMs?.status === 'UNDER_REVIEW';
              const isReturned = firstMs?.status === 'RETURNED_FOR_AMENDMENT';
              return (
                <SpotlightCard
                  className={`flex flex-wrap items-center justify-between gap-3 ${
                    isUnderReview
                      ? 'border-sky-500/40 bg-sky-500/10'
                      : 'border-amber-500/40 bg-amber-500/10'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="text-xs font-bold">
                      {isUnderReview
                        ? tr('إثبات الدفع قيد المراجعة المالية (UNDER_REVIEW)', 'Deposit Proof Submitted — Under Finance Review')
                        : isReturned
                          ? tr('إيصال الدفعة مرتجع للتعديل — يرجى إعادة الرفع قبل انتهاء المهلة', 'Deposit Receipt Returned for Amendment — Re-upload Required')
                          : tr('حجز مؤقت لمدة 48 ساعة (بانتظار إثبات دفع العربون)', '48-Hour Provisional Hold (Awaiting Deposit Proof)')}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {activeEvent.hold_expires_at
                        ? tr(
                            `ينتهي الحجز المؤقت في: ${new Date(activeEvent.hold_expires_at + 'Z').toLocaleString('ar-YE-u-nu-latn')}`,
                            `Provisional hold expires: ${new Date(activeEvent.hold_expires_at + 'Z').toLocaleString('en-US')}`
                          )
                        : tr('يرجى سداد الدفعة الأولى لتثبيت الفعالية نهائياً.', 'Upload confirmation deposit proof to confirm your booking.')}
                      {isReturned && firstMs?.reviewer_remarks ? ` — ${firstMs.reviewer_remarks}` : ''}
                    </div>
                  </div>
                  {!isUnderReview && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('INVOICES_PAYMENTS')}
                      className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-bold text-slate-950"
                    >
                      {tr('رفع إيصال العربون الآن', 'Upload Deposit Proof')}
                    </button>
                  )}
                </SpotlightCard>
              );
            })()}

            {activeEvent && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SpotlightCard className="flex items-center gap-3">
                  <Clock className="h-6 w-6 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
                  <div>
                    <div className="text-xs text-slate-500">{tr('العد التنازلي للمناسبة', 'Event Countdown')}</div>
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
                  className={`flex items-center gap-3 ${cateringLocked ? 'border-rose-500/40 bg-rose-500/10' : 'border-emerald-500/30 bg-emerald-500/5'
                    }`}
                >
                  <Lock className={`h-5 w-5 shrink-0 ${cateringLocked ? 'text-rose-500' : 'text-emerald-500'}`} />
                  <div>
                    <div className="text-xs font-bold">{tr('نافذة قفل قائمة الضيافة (72 ساعة)', '72h Catering Lockout')}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {cateringLocked ? tr('مقفل (< 72 ساعة)', 'Frozen (< 72h to event)') : tr('متاح للتعديل', 'Editable until 72h prior')}
                    </div>
                  </div>
                </SpotlightCard>

                <SpotlightCard
                  className={`flex items-center gap-3 ${floorPlanLocked ? 'border-rose-500/40 bg-rose-500/10' : 'border-emerald-500/30 bg-emerald-500/5'
                    }`}
                >
                  <Lock className={`h-5 w-5 shrink-0 ${floorPlanLocked ? 'text-rose-500' : 'text-emerald-500'}`} />
                  <div>
                    <div className="text-xs font-bold">{tr('نافذة قفل مخطط القاعة (24 ساعة)', '24h Floor Plan Lockout')}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {floorPlanLocked ? tr('المخطط مقفل للتنفيذ', 'Locked for setup') : tr('متاح لتعديل الطاولات', 'Editable until 24h prior')}
                    </div>
                  </div>
                </SpotlightCard>
              </div>
            )}

            {/* Dual-Approval Change Request Cards */}
            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <span>{tr('طلبات الاعتماد المزدوج من المنسقين والمفوضين', 'Dual-Approval Change Requests')}</span>
              </SpotlightHeading>

              {approvals.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {tr('لا توجد طلبات تعديل معلقة حالياً.', 'No pending change requests requiring your approval.')}
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {approvals.map((ap) => (
                    <div
                      key={ap.id}
                      className="flex flex-col justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-bold text-amber-500">{ap.event_code}</span>
                          <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-300">
                            {ap.draft_type}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-300">
                          {tr('مقدم الطلب:', 'Requested by')}{' '}
                          <strong className="text-slate-900 dark:text-white">{ap.requested_by_name}</strong> —{' '}
                          <span className="text-slate-500">{tr('منسق / مفوض', 'Delegate / Planner')}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {describeApprovalPayload(ap)}
                        </p>
                        <div dir="ltr" className="font-mono text-sm font-extrabold text-amber-500">
                          {Number(ap.financial_delta) >= 0 ? '+' : ''}
                          {Number(ap.financial_delta).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => resolveApproval(ap.id, 'APPROVED')}
                          className="min-h-[40px] flex-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"
                        >
                          {tr('اعتماد ومزامنة', 'Approve & Sync')}
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveApproval(ap.id, 'REJECTED')}
                          className="min-h-[40px] rounded-lg bg-rose-600 px-4 text-xs font-bold text-white"
                        >
                          {tr('رفض', 'Reject')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SpotlightCard>

            {/* Booked Events List */}
            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="text-base">
                {tr('حجوزاتي ومناسباتي', 'Booked Events')}
              </SpotlightHeading>
              {activeEvent && (
                <form onSubmit={submitEventTitleChange} className="grid gap-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800 sm:grid-cols-3">
                  <input
                    value={eventTitleReq}
                    onChange={(e) => setEventTitleReq(e.target.value)}
                    placeholder={tr(`طلب تعديل عنوان (${activeEvent.event_code})...`, `Propose new event title for ${activeEvent.event_code}...`)}
                    className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    value={eventTitleRemarks}
                    onChange={(e) => setEventTitleRemarks(e.target.value)}
                    placeholder={tr('ملاحظة للإدارة (اختياري)', 'Remarks for admin (optional)')}
                    className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button type="submit" className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 font-bold text-slate-950">
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>{tr('طلب تعديل العنوان', 'Request Title Edit')}</span>
                  </button>
                </form>
              )}
              <ResponsiveDataList
                data={events}
                locale={locale}
                mobileCardHeader={(r) => `${r.event_code} — ${isRtl ? r.hall_name_ar : r.hall_name}`}
                columns={[
                  {
                    key: 'code',
                    headerAr: 'الرمز والعنوان',
                    headerEn: 'Code & Title',
                    render: (r) => (
                      <div>
                        <div className="font-mono text-xs font-bold">{r.event_code}</div>
                        {r.title && <div className="text-[11px] font-semibold text-amber-500">{r.title}</div>}
                      </div>
                    ),
                  },
                  { key: 'hall', headerAr: 'القاعة', headerEn: 'Hall', render: (r) => (isRtl ? r.hall_name_ar : r.hall_name) },
                  {
                    key: 'date',
                    headerAr: 'التاريخ',
                    headerEn: 'Date',
                    render: (r) => <span dir="ltr" className="font-mono text-xs">{r.start_time.slice(0, 16).replace('T', ' ')}</span>,
                  },
                  { key: 'guests', headerAr: 'الضيوف', headerEn: 'Guests', render: (r) => r.guest_count },
                  {
                    key: 'status',
                    headerAr: 'الحالة',
                    headerEn: 'Status',
                    render: (r) => <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white">{r.status}</span>,
                  },
                  {
                    key: 'pick',
                    headerAr: 'تحديد',
                    headerEn: 'Select',
                    render: (r) => (
                      <button
                        type="button"
                        onClick={() => setSelectedEventId(r.id)}
                        className={`rounded-lg px-3 py-1 text-xs font-bold ${r.id === activeEvent?.id
                          ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                          : 'border border-slate-300 dark:border-slate-700'
                          }`}
                      >
                        {r.id === activeEvent?.id ? tr('محدد ✓', 'Active ✓') : tr('عرض', 'Inspect')}
                      </button>
                    ),
                  },
                ]}
              />
            </SpotlightCard>
          </div>
        )}

        {/* TAB 2: Invoices & Payments */}
        {activeTab === 'INVOICES_PAYMENTS' && (
          <div className="space-y-6 text-start">
            {activeEvent?.invoice ? (
              <>
                <SpotlightCard className="flex flex-wrap items-center justify-between gap-4 border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
                    <div>
                      <div className="text-xs font-bold text-amber-500">
                        {tr('خزينة تأمين الأضرار المسترد (التزامات 2100)', 'Security Deposit Vault (Liability 2100)')}
                      </div>
                      <div className="text-sm font-bold">
                        {Number(activeEvent.invoice.security_deposit_amount).toLocaleString()} —{' '}
                        <span className="font-mono">{activeEvent.invoice.deposit_status}</span>
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-slate-800">
                    {activeEvent.invoice.invoice_number} · {activeEvent.invoice.status}
                  </span>
                </SpotlightCard>

                <div className="grid gap-6 lg:grid-cols-2">
                  <SpotlightCard className="space-y-4">
                    <div className="flex items-center justify-between">
                      <SpotlightHeading as="h2" className="text-lg">
                        {tr('الدفعات المالية ورفع الإيصالات', 'Split Milestones & Receipt Upload')}
                      </SpotlightHeading>
                      <div className="flex flex-wrap gap-2">
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
                          {tr('PDF الفاتورة', 'Invoice PDF')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            downloadAuthorizedFile(
                              `/api/v1/exports/events/${activeEvent.id}/deposit-settlement.pdf?locale=${locale}`,
                              `deposit-settlement-${activeEvent.event_code}-${locale}.pdf`
                            )
                          }
                          className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-700 dark:text-amber-300"
                        >
                          <FileDown className="h-4 w-4" />
                          {tr('سند تسوية التأمين', 'Deposit Receipt PDF')}
                        </button>
                      </div>
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
                            {m.reviewer_remarks && (
                              <div className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                                {tr('ملاحظات الإدارة (مطلوب التعديل وإعادة الرفع):', 'Reviewer Amendment Remarks:')} {m.reviewer_remarks}
                              </div>
                            )}
                          </div>
                          {m.status !== 'PAID' && (
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white dark:bg-slate-800">
                              <Camera className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                              <span>{tr('تصوير / رفع الإيصال', 'Capture Receipt')}</span>
                              <input
                                type="file"
                                accept="image/*,application/pdf"
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

                  <SpotlightCard className="space-y-4">
                    <SpotlightHeading as="h2" className="text-lg">
                      {tr('حسابات القاعة للتحويل (نسخ بلمسة)', 'Venue Payment Accounts (One-Tap Copy)')}
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
                              {copiedKey === a.method ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                              <span>{copiedKey === a.method ? tr('نُسخ', 'Copied') : tr('نسخ', 'Copy')}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SpotlightCard>
                </div>
              </>
            ) : (
              <SpotlightCard>
                <p className="text-xs text-slate-500">{tr('لا توجد فاتورة للفعالية المحددة.', 'No invoice for the selected event.')}</p>
              </SpotlightCard>
            )}
          </div>
        )}

        {/* TAB 3: Profile & Refund Vault */}
        {activeTab === 'PROFILE_VAULT' && (
          <div className="grid gap-6 text-start lg:grid-cols-3">
            <SpotlightCard className="space-y-4 lg:col-span-2">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <UserCheck className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('الملف الشخصي وحساب استرداد التأمين', 'Client Profile & Refund Vault')}</span>
              </SpotlightHeading>

              <form onSubmit={saveProfile} className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                    {avatarPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-lg font-bold">{fullName.charAt(0).toUpperCase() || 'C'}</span>
                    )}
                  </div>
                  <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700">
                    {tr('تغيير الصورة الشخصية', 'Upload Profile Picture')}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAvatarChange(f);
                      }}
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{tr('الاسم الكامل', 'Full Name')}</label>
                    <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{tr('البريد الإلكتروني', 'Email')}</label>
                    <input dir="ltr" disabled className={`${inputCls} opacity-70`} value={email} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{tr('الجوال / واتساب', 'Phone / WhatsApp')}</label>
                    <input dir="ltr" disabled className={`${inputCls} opacity-70`} value={phone} />
                  </div>
                  <div className="flex items-end">
                    <label className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700">
                      <input type="checkbox" checked={is2faEnabled} onChange={(e) => setIs2faEnabled(e.target.checked)} />
                      <span>{tr('تفعيل التحقق الثنائي (2FA OTP)', 'Enable 2FA OTP Login')}</span>
                    </label>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={clientCategory} onChange={(e) => setClientCategory(e.target.value)} className={inputCls}>
                    <option value="INDIVIDUAL_B2C">{tr('فرد (B2C)', 'Individual (B2C)')}</option>
                    <option value="CORPORATE_B2B">{tr('شركة / مؤسسة (B2B)', 'Corporate (B2B)')}</option>
                  </select>
                  <input
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder={tr('الهوية الوطنية / السجل التجاري', 'National ID / CR')}
                    className={inputCls}
                  />
                  {clientCategory === 'CORPORATE_B2B' && (
                    <>
                      <input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder={tr('اسم الشركة', 'Company Name')}
                        className={inputCls}
                      />
                      <input
                        dir="ltr"
                        value={taxId}
                        onChange={(e) => setTaxId(e.target.value)}
                        placeholder={tr('الرقم الضريبي', 'Tax ID')}
                        className={inputCls}
                      />
                    </>
                  )}
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
                    placeholder={tr('رقم حساب الاسترداد / IBAN', 'Refund Account / IBAN')}
                    className={inputCls}
                  />
                </div>

                <button type="submit" className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 text-xs font-bold text-slate-950">
                  {tr('حفظ الملف وحساب الاسترداد', 'Save Profile & Refund Vault')}
                </button>
              </form>
            </SpotlightCard>

            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <KeyRound className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('تغيير كلمة المرور', 'Change Password')}</span>
              </SpotlightHeading>
              <form onSubmit={handleChangePassword} className="space-y-3">
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={tr('كلمة المرور الحالية', 'Current Password')}
                  className={inputCls}
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={tr('كلمة المرور الجديدة (8+ أحرف)', 'New Password (8+ chars)')}
                  className={inputCls}
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={tr('تأكيد كلمة المرور الجديدة', 'Confirm New Password')}
                  className={inputCls}
                />
                <button
                  type="submit"
                  className="min-h-[44px] w-full rounded-lg border border-[var(--brand-primary,#D4AF37)] text-xs font-bold text-[var(--brand-primary,#D4AF37)]"
                >
                  {tr('تحديث كلمة المرور', 'Update Password')}
                </button>
              </form>
            </SpotlightCard>

            <SpotlightCard className="space-y-4 lg:col-span-3">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>
                  {resubmitGovId
                    ? tr('تعديل وإعادة إرسال طلب تحديث الهوية', 'Amend & Resubmit Identity Change Request')
                    : tr('طلب تعديل بيانات الهوية والاتصال (يتطلب اعتماد الإدارة)', 'Governed Identity Change Request (Tenant Admin Approval)')}
                </span>
              </SpotlightHeading>
              <form onSubmit={submitClientIdentityChange} className="grid gap-3 text-xs sm:grid-cols-3">
                <input
                  value={idChangeForm.full_name}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, full_name: e.target.value })}
                  placeholder={tr('الاسم الكامل الجديد (اختياري)', 'New Full Name (optional)')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  dir="ltr"
                  value={idChangeForm.phone}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, phone: e.target.value })}
                  placeholder={tr('رقم الجوال الجديد', 'New Phone / WhatsApp')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  dir="ltr"
                  type="email"
                  value={idChangeForm.email}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, email: e.target.value })}
                  placeholder={tr('البريد الإلكتروني الجديد', 'New Email')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  value={idChangeForm.company_name}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, company_name: e.target.value })}
                  placeholder={tr('اسم الشركة', 'Company Name')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  dir="ltr"
                  value={idChangeForm.tax_id}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, tax_id: e.target.value })}
                  placeholder={tr('الرقم الضريبي', 'Tax ID')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  value={idChangeForm.national_id_or_cr}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, national_id_or_cr: e.target.value })}
                  placeholder={tr('رقم الهوية / السجل التجاري', 'National ID / CR')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  value={idChangeForm.remarks}
                  onChange={(e) => setIdChangeForm({ ...idChangeForm, remarks: e.target.value })}
                  placeholder={tr('سبب التعديل / ملاحظات للمراجع', 'Reason / remarks for reviewer')}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 sm:col-span-2 dark:border-slate-700 dark:bg-slate-950"
                />
                <div className="flex gap-2">
                  <button type="submit" className="min-h-[40px] flex-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950">
                    {resubmitGovId ? tr('إعادة إرسال', 'Resubmit') : tr('رفع الطلب', 'Submit Request')}
                  </button>
                  {resubmitGovId && (
                    <button
                      type="button"
                      onClick={() => setResubmitGovId(null)}
                      className="min-h-[40px] rounded-lg border border-slate-300 px-3 dark:border-slate-700"
                    >
                      {tr('إلغاء', 'Cancel')}
                    </button>
                  )}
                </div>
              </form>

              {govRequests.length > 0 && (
                <div className="space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
                  {govRequests.map((gr) => (
                    <div key={gr.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                      <div>
                        <div className="font-bold">{gr.request_title}</div>
                        <div className="font-mono text-[11px] text-slate-500">{JSON.stringify(gr.proposed_values)}</div>
                        {gr.reviewer_remarks && (
                          <div className="text-[11px] text-amber-500">
                            {tr('ملاحظات الإدارة:', 'Reviewer Remarks:')} {gr.reviewer_remarks}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-white">{gr.status}</span>
                        {gr.status === 'RETURNED_FOR_AMENDMENT' && gr.target_entity_type === 'CLIENT' && (
                          <button
                            type="button"
                            onClick={() => {
                              setResubmitGovId(gr.id);
                              const pv = gr.proposed_values || {};
                              setIdChangeForm({
                                full_name: String(pv.full_name || ''),
                                phone: String(pv.phone || ''),
                                email: String(pv.email || ''),
                                company_name: String(pv.company_name || ''),
                                tax_id: String(pv.tax_id || ''),
                                national_id_or_cr: String(pv.national_id_or_cr || ''),
                                remarks: gr.requester_remarks || '',
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

        {/* TAB 4: Event Delegation */}
        {activeTab === 'DELEGATION' && (
          <SpotlightCard className="space-y-4 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
              <UserPlus className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('تفويض المنسقين والمشاركين والموردين', 'Event Delegation & Granular Permissions')}</span>
            </SpotlightHeading>

            <form onSubmit={addDelegate} className="grid gap-3 sm:grid-cols-4">
              <input required value={delName} onChange={(e) => setDelName(e.target.value)} placeholder={tr('الاسم الكامل', 'Full Name')} className={inputCls} />
              <input required dir="ltr" value={delPhone} onChange={(e) => setDelPhone(e.target.value)} placeholder="+96777..." className={inputCls} />
              <input type="email" dir="ltr" value={delEmail} onChange={(e) => setDelEmail(e.target.value)} placeholder="email@studio.local" className={inputCls} />
              <select value={delRole} onChange={(e) => setDelRole(e.target.value)} className={inputCls}>
                <option value="WEDDING_PLANNER">{tr('منسق زفاف', 'Wedding Planner')}</option>
                <option value="CO_HOST">{tr('مضيف مشارك', 'Co-Host')}</option>
                <option value="VENDOR">{tr('مورد خارجي', 'External Vendor')}</option>
              </select>

              <div className="flex flex-wrap gap-4 text-xs sm:col-span-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canViewFinance} onChange={(e) => setCanViewFinance(e.target.checked)} />
                  <span>{tr('عرض المالية', 'canViewFinance')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canEditFloorplan} onChange={(e) => setCanEditFloorplan(e.target.checked)} />
                  <span>{tr('تعديل المخطط', 'canEditFloorplan')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canEditCatering} onChange={(e) => setCanEditCatering(e.target.checked)} />
                  <span>{tr('تعديل الضيافة', 'canEditCatering')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canRequestAddons} onChange={(e) => setCanRequestAddons(e.target.checked)} />
                  <span>{tr('طلب إضافات', 'canRequestAddons')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={canManageGuests} onChange={(e) => setCanManageGuests(e.target.checked)} />
                  <span>{tr('إدارة الضيوف', 'canManageGuests')}</span>
                </label>
              </div>

              <button
                type="submit"
                className="min-h-[44px] rounded-lg border border-[var(--brand-primary,#D4AF37)] text-xs font-bold text-[var(--brand-primary,#D4AF37)] sm:col-span-4"
              >
                {tr('حفظ صلاحيات المفوض', 'Save Delegate Permissions')}
              </button>
            </form>

            <div className="space-y-2 text-xs">
              {delegates.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div>
                    <span className="font-bold">{d.full_name}</span>{' '}
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] dark:bg-slate-800">{d.delegate_role}</span>{' '}
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
                    <span>{tr('إزالة', 'Revoke')}</span>
                  </button>
                </div>
              ))}
            </div>
          </SpotlightCard>
        )}

        {/* TAB 5: VIP QR Passes, Contract, Chat & Audit */}
        {activeTab === 'PASSES_AUDIT' && (
          <div className="space-y-6 text-start">
            {/* Digital Contract E-Signature */}
            <SpotlightCard className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                  <FileSignature className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{tr('العقد الإلكتروني والتوقيع الرقمي', 'Digital Contract & E-Signature')}</span>
                </SpotlightHeading>
                {contract && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold dark:bg-slate-800">
                      {contract.contract_number} · {contract.status || 'DRAFT'}
                    </span>
                    {activeEvent && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadAuthorizedFile(
                            `/api/v1/exports/contracts/${activeEvent.id}/pdf?locale=${locale}`,
                            `${contract.contract_number}-${locale}.pdf`
                          )
                        }
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        <span>{tr('تحميل العقد PDF', 'Contract PDF')}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {contract ? (
                <div className="space-y-3">
                  {contract.amendment_remarks && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                      <strong>{tr('ملاحظات التعديل:', 'Amendment Remarks:')}</strong> {contract.amendment_remarks}
                    </div>
                  )}
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed dark:border-slate-800 dark:bg-slate-950">
                    {isRtl ? contract.terms_ar : contract.terms_en}
                  </pre>
                  {contract.client_signed_at ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-600 dark:text-emerald-300">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5" />
                        <span>
                          {tr('تم توقيع العقد إلكترونياً', 'Digitally Signed')}: {contract.client_signature_name}
                        </span>
                      </div>
                      <span dir="ltr" className="font-mono text-[11px]">
                        {contract.client_signed_at.slice(0, 19).replace('T', ' ')}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <form onSubmit={signContract} className="grid gap-3 sm:grid-cols-3">
                        <input
                          required
                          value={signatureName}
                          onChange={(e) => setSignatureName(e.target.value)}
                          placeholder={tr('الاسم الكامل للتوقيع', 'Full Legal Name')}
                          className={inputCls}
                        />
                        <div className="flex min-h-[44px] items-center rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-4 font-serif italic text-amber-500">
                          {signatureName || tr('معاينة التوقيع...', 'Signature preview...')}
                        </div>
                        <button type="submit" className="min-h-[44px] rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950">
                          {tr('توقيع العقد إلكترونياً', 'Sign Contract')}
                        </button>
                      </form>
                      {activeEvent && (
                        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
                          <input
                            value={contractAmendNote}
                            onChange={(e) => setContractAmendNote(e.target.value)}
                            placeholder={tr('طلب تعديل على بند في العقد قبل التوقيع...', 'Request amendment on contract clauses before signing...')}
                            className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            disabled={contractAmendNote.trim().length < 2}
                            onClick={async () => {
                              try {
                                await apiFetch(`/api/v1/events/${activeEvent.id}/contract`, {
                                  method: 'PATCH',
                                  body: { status: 'RETURNED_FOR_AMENDMENT', amendment_remarks: contractAmendNote.trim() },
                                });
                                setContractAmendNote('');
                                setStatusMsg(tr('تم إرسال طلب تعديل العقد لإدارة المنشأة.', 'Contract amendment request sent to venue.'));
                                await loadEventScopedData(activeEvent.id);
                              } catch (err) {
                                setErrorMsg(err instanceof Error ? err.message : 'Failed to request contract amendment');
                              }
                            }}
                            className="min-h-[38px] rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 font-bold text-amber-600 disabled:opacity-40 dark:text-amber-300"
                          >
                            {tr('إعادة العقد للتعديل', 'Return Contract for Amendment')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">{tr('لا يوجد عقد لهذه الفعالية.', 'No contract found.')}</p>
              )}
            </SpotlightCard>

            {/* Guest List + Instant QR Gate Pass */}
            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('قائمة الضيوف وتوليد تصاريح QR', 'Guest List & Instant QR Gate Passes')}</span>
              </SpotlightHeading>

              <form onSubmit={addGuest} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <input required value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder={tr('اسم الضيف', 'Guest Name')} className={inputCls} />
                <input dir="ltr" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+96777..." className={inputCls} />
                <SelectOrOther
                  value={guestTier}
                  onChange={setGuestTier}
                  locale={locale}
                  allowPromoteCategory="GATE_PASS_TYPE"
                  options={[
                    { value: 'STANDARD', labelAr: 'عادي (STANDARD)', labelEn: 'Standard (STANDARD)' },
                    { value: 'VIP', labelAr: 'كبار الشخصيات (VIP)', labelEn: 'VIP' },
                    { value: 'FAMILY', labelAr: 'العائلة (FAMILY)', labelEn: 'Family (FAMILY)' },
                    { value: 'SPEAKER', labelAr: 'متحدث (SPEAKER)', labelEn: 'Speaker (SPEAKER)' },
                  ]}
                  placeholderAr="فئة الضيف..."
                  placeholderEn="Guest tier..."
                  otherPlaceholderAr="أدخل فئة ضيف مخصصة..."
                  otherPlaceholderEn="Enter custom guest tier..."
                  className={inputCls}
                />
                <input value={guestTable} onChange={(e) => setGuestTable(e.target.value)} placeholder={tr('الطاولة', 'Table')} className={inputCls} />
                <button type="submit" className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950">
                  <QrCode className="me-1 inline h-4 w-4" />
                  {tr('إصدار QR', 'Generate QR')}
                </button>
              </form>

              <ResponsiveDataList
                data={guests}
                locale={locale}
                mobileCardHeader={(r) => `${r.full_name} (${r.vip_tier})`}
                columns={[
                  { key: 'name', headerAr: 'الضيف', headerEn: 'Guest', render: (r) => r.full_name },
                  { key: 'tier', headerAr: 'الفئة', headerEn: 'Tier', render: (r) => r.vip_tier },
                  { key: 'table', headerAr: 'الطاولة', headerEn: 'Table', render: (r) => r.table_label || '-' },
                  {
                    key: 'qr',
                    headerAr: 'تصريح QR',
                    headerEn: 'QR Pass',
                    render: (r) =>
                      r.qr_token ? (
                        <button
                          type="button"
                          onClick={() => copyValue(`qr-${r.id}`, r.qr_token!)}
                          className="font-mono text-xs text-amber-500 underline"
                        >
                          {copiedKey === `qr-${r.id}` ? '✓' : r.qr_token}
                        </button>
                      ) : (
                        '-'
                      ),
                  },
                ]}
              />
            </SpotlightCard>

            {activeEvent && (
              <ClientSecurityPanel locale={locale} event={activeEvent} onChanged={loadAll} />
            )}

            {/* Event Chat + Immutable AuditLog */}
            <div className="grid gap-6 lg:grid-cols-2">
              <SpotlightCard className="space-y-3">
                <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                  <MessageSquare className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{tr('المحادثة الموحدة', 'Event Chat Thread')}</span>
                </SpotlightHeading>
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                      <div className="flex justify-between font-bold">
                        <span>{m.sender_name}</span>
                        <span dir="ltr" className="font-mono text-[10px] text-slate-400">
                          {m.created_at.slice(0, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <p className="mt-1">{m.content}</p>
                    </div>
                  ))}
                </div>
                <form onSubmit={sendMessage} className="flex gap-2">
                  <select value={chatDept} onChange={(e) => setChatDept(e.target.value)} className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                    <option value="ALL">@ALL</option>
                    <option value="KITCHEN">@Kitchen</option>
                    <option value="OPS">@Ops</option>
                    <option value="FINANCE">@Finance</option>
                  </select>
                  <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder={tr('رسالة...', 'Message...')} className={inputCls} />
                  <button type="submit" className="min-h-[42px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-slate-950">
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </SpotlightCard>

              <SpotlightCard className="space-y-3">
                <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
                  <Shield className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{tr('سجل التدقيق غير القابل للتعديل', 'Immutable Audit Log')}</span>
                </SpotlightHeading>
                <div className="max-h-72 space-y-2 overflow-y-auto text-xs">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                      <div className="flex justify-between font-mono font-bold">
                        <span>{log.action}</span>
                        <span dir="ltr" className="text-[10px] text-slate-400">
                          {log.created_at.slice(0, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <div className="text-slate-500">{log.actor_name}</div>
                    </div>
                  ))}
                </div>
              </SpotlightCard>
            </div>
          </div>
        )}
      </main>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
