'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Camera, Check, Copy, FileDown, LayoutTemplate, Send, Shield, UserPlus } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, dynamicHref } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { LookupSelect } from '@/components/ui/LookupSelect';
import type { PortalEvent } from '@/lib/types';

interface PaymentAccount {
  method: string;
  label_ar: string;
  label_en: string;
  account_name: string;
  account_number: string;
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
  created_at: string;
}

interface MessageRow {
  id: string;
  sender_name: string;
  channel: string;
  content: string;
  created_at: string;
}

export default function ClientPortalDashboard() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [delegates, setDelegates] = useState<DelegateRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [copiedAcc, setCopiedAcc] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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
  const [delRole, setDelRole] = useState('WEDDING_PLANNER');
  const [canViewFinance, setCanViewFinance] = useState(false);
  const [canEditFloorplan, setCanEditFloorplan] = useState(true);
  const [canRequestAddons, setCanRequestAddons] = useState(true);

  // Chat
  const [chatText, setChatText] = useState('');

  const activeEvent = events[0] || null;

  const loadAll = useCallback(async () => {
    try {
      const [evs, accs, apps, logs, me] = await Promise.all([
        apiFetch<PortalEvent[]>('/api/v1/portal/events'),
        apiFetch<PaymentAccount[]>('/api/v1/portal/payment-accounts'),
        apiFetch<ApprovalRow[]>('/api/v1/approvals?status=PENDING'),
        apiFetch<AuditRow[]>('/api/v1/portal/audit-logs'),
        apiFetch<{
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
      setAuditLogs(logs);
      if (me.profile) {
        setClientCategory(me.profile.client_category);
        setNationalId(me.profile.national_id_or_cr || '');
        setTaxId(me.profile.tax_id || '');
        setCompanyName(me.profile.company_name || '');
        setRefundMethod(me.profile.refund_bank_details?.method || 'KURAIMI');
        setRefundAccount(me.profile.refund_bank_details?.account_number || '');
      }
      if (evs[0]) {
        const [dels, msgs] = await Promise.all([
          apiFetch<DelegateRow[]>(`/api/v1/portal/events/${evs[0].id}/delegates`),
          apiFetch<MessageRow[]>(`/api/v1/events/${evs[0].id}/messages`),
        ]);
        setDelegates(dels);
        setMessages(msgs);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Sign in to view your portal');
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const copyAccount = async (num: string) => {
    await navigator.clipboard.writeText(num);
    setCopiedAcc(num);
    setTimeout(() => setCopiedAcc(null), 2000);
  };

  const uploadReceipt = async (milestoneId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiFetch(`/api/v1/portal/milestones/${milestoneId}/receipt`, { method: 'POST', formData: fd });
    setStatusMsg(isRtl ? 'تم رفع الإيصال بنجاح وهو قيد المراجعة' : 'Receipt uploaded for review');
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
    setStatusMsg(isRtl ? 'تم تحديث بيانات الملف الشخصي والاسترداد' : 'Profile & refund details saved');
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
        delegate_role: delRole,
        permissions: {
          canViewFinance,
          canEditFloorplan,
          canRequestAddons,
          canChat: true,
        },
      },
    });
    setDelName('');
    setDelPhone('');
    await loadAll();
  };

  const resolveApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    await apiFetch(`/api/v1/approvals/${id}/resolve`, {
      method: 'POST',
      body: { decision },
    });
    await loadAll();
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !chatText.trim()) return;
    await apiFetch(`/api/v1/events/${activeEvent.id}/messages`, {
      method: 'POST',
      body: { content: chatText },
    });
    setChatText('');
    await loadAll();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpotlightHeading as="h1" className="text-2xl">
            {isRtl ? 'لوحة تحكم العميل وبوابة الفعاليات' : 'Client Account Control Panel'}
          </SpotlightHeading>
          {activeEvent && (
            <Link
              href={dynamicHref(locale, '/portal/events', activeEvent.id).replace(/(\/_|\?id=)/, (m) =>
                m.startsWith('/_') ? '/_/floor-plan?id=' : `/${activeEvent.id}/floor-plan`
              )}
              onClick={(e) => {
                e.preventDefault();
                window.location.href =
                  process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE'
                    ? `/${locale}/portal/events/_/floor-plan/?id=${encodeURIComponent(activeEvent.id)}`
                    : `/${locale}/portal/events/${activeEvent.id}/floor-plan`;
              }}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950"
            >
              <LayoutTemplate className="h-4 w-4" />
              {isRtl ? 'مصمم مخطط القاعة التفاعلي' : 'Interactive Floor Plan Designer'}
            </Link>
          )}
        </div>

        {statusMsg && (
          <SpotlightCard className="border-amber-500/40 bg-amber-500/10 py-3 text-xs text-amber-300">
            {statusMsg}
          </SpotlightCard>
        )}

        {/* Payment Accounts (One-Tap Copy) & Milestones */}
        {activeEvent?.invoice && (
          <div className="grid gap-6 lg:grid-cols-2">
            <SpotlightCard className="space-y-4">
              <div className="flex items-center justify-between">
                <SpotlightHeading as="h2" className="text-lg">
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
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div>
                      <div className="text-sm font-bold">{m.title}</div>
                      <div className="font-mono text-xs text-slate-500">
                        {m.amount_due.toLocaleString()} — {m.status}
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

            <SpotlightCard className="space-y-4">
              <SpotlightHeading as="h2" className="text-lg">
                {isRtl ? 'حسابات القاعة للتحويل (نسخ بلمسة)' : 'Venue Payment Accounts (One-Tap Copy)'}
              </SpotlightHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                {accounts.map((a) => (
                  <div key={a.method} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div className="text-xs font-bold">{isRtl ? a.label_ar : a.label_en}</div>
                    <div className="text-[11px] text-slate-500">{a.account_name}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold">{a.account_number}</span>
                      <button
                        type="button"
                        onClick={() => copyAccount(a.account_number)}
                        className="flex min-h-[36px] items-center gap-1 rounded border border-slate-300 px-2 text-[11px] dark:border-slate-700"
                      >
                        {copiedAcc === a.account_number ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{copiedAcc === a.account_number ? (isRtl ? 'نُسخ' : 'Copied') : isRtl ? 'نسخ' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </SpotlightCard>
          </div>
        )}

        {/* Pending Client Approvals */}
        {approvals.length > 0 && (
          <SpotlightCard className="space-y-3">
            <SpotlightHeading as="h2" className="text-lg">
              {isRtl ? 'طلبات الاعتماد المعلقة' : 'Pending Client Approvals'}
            </SpotlightHeading>
            {approvals.map((ap) => (
              <div key={ap.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="text-sm">
                  <span className="font-bold">{ap.event_code}</span> — {ap.draft_type} ({ap.financial_delta.toLocaleString()})
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
                    className="min-h-[40px] rounded-lg bg-red-600 px-4 text-xs font-bold text-white"
                  >
                    {isRtl ? 'رفض' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </SpotlightCard>
        )}

        {/* B2C/B2B Profile & Refund Bank Details + Sub-User Delegation */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SpotlightCard>
            <form onSubmit={saveProfile} className="space-y-3">
              <SpotlightHeading as="h2" className="text-lg">
                {isRtl ? 'ملف الفوترة الضريبية وحساب استرداد التأمين' : 'B2C/B2B Profile & Refund Account'}
              </SpotlightHeading>
              <div className="grid gap-3 sm:grid-cols-2">
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
                {clientCategory === 'CORPORATE_B2B' && (
                  <>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder={isRtl ? 'اسم الشركة' : 'Company Name'}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <input
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      placeholder={isRtl ? 'الرقم الضريبي' : 'Tax ID'}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
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
                  value={refundAccount}
                  onChange={(e) => setRefundAccount(e.target.value)}
                  placeholder={isRtl ? 'رقم حساب الاسترداد / IBAN' : 'Refund Account / IBAN'}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 text-xs font-bold text-slate-950"
              >
                {isRtl ? 'حفظ بيانات الحساب' : 'Save Profile'}
              </button>
            </form>
          </SpotlightCard>

          <SpotlightCard className="space-y-4">
            <SpotlightHeading as="h2" className="text-lg">
              <UserPlus className="me-1.5 inline h-5 w-5" />
              {isRtl ? 'تفويض المنسقين والمشاركين' : 'Sub-User Delegation & Permissions'}
            </SpotlightHeading>
            <form onSubmit={addDelegate} className="grid gap-3 sm:grid-cols-3">
              <input
                value={delName}
                onChange={(e) => setDelName(e.target.value)}
                required
                placeholder={isRtl ? 'الاسم' : 'Full Name'}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                value={delPhone}
                onChange={(e) => setDelPhone(e.target.value)}
                required
                placeholder="+96777..."
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <select
                value={delRole}
                onChange={(e) => setDelRole(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="WEDDING_PLANNER">{isRtl ? 'منسق زفاف' : 'Wedding Planner'}</option>
                <option value="CO_HOST">{isRtl ? 'مضيف مشارك' : 'Co-Host'}</option>
                <option value="VENDOR">{isRtl ? 'مورد خارجي' : 'Vendor'}</option>
              </select>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={canViewFinance} onChange={(e) => setCanViewFinance(e.target.checked)} />
                <span>{isRtl ? 'عرض المالية' : 'View Finance'}</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={canEditFloorplan} onChange={(e) => setCanEditFloorplan(e.target.checked)} />
                <span>{isRtl ? 'تعديل المخطط' : 'Edit Floorplan'}</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={canRequestAddons} onChange={(e) => setCanRequestAddons(e.target.checked)} />
                <span>{isRtl ? 'طلب إضافات' : 'Request Add-ons'}</span>
              </label>
              <button
                type="submit"
                className="min-h-[44px] sm:col-span-3 rounded-lg border border-[var(--brand-primary,#D4AF37)] text-xs font-bold text-[var(--brand-primary,#D4AF37)]"
              >
                {isRtl ? 'إضافة مفوض' : 'Save Delegate'}
              </button>
            </form>
            <div className="space-y-2 text-xs">
              {delegates.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded border border-slate-200 p-2 dark:border-slate-800">
                  <span>
                    {d.full_name} ({d.delegate_role})
                  </span>
                  <span className="text-slate-500">{d.phone}</span>
                </div>
              ))}
            </div>
          </SpotlightCard>
        </div>

        {/* Event Chat & Immutable AuditLog */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SpotlightCard className="space-y-3">
            <SpotlightHeading as="h2" className="text-lg">
              {isRtl ? 'المحادثة الموحدة مع إدارة القاعة' : 'Unified Event Chat'}
            </SpotlightHeading>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {messages.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                  <div className="font-bold">
                    {m.sender_name} <span className="text-[10px] text-slate-400">({m.channel})</span>
                  </div>
                  <p className="mt-1">{m.content}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="flex gap-2">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder={isRtl ? 'اكتب رسالتك...' : 'Write a message...'}
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

          <SpotlightCard className="space-y-3">
            <SpotlightHeading as="h2" className="text-lg">
              <Shield className="me-1.5 inline h-5 w-5" />
              {isRtl ? 'سجل التدقيق غير القابل للتعديل' : 'Immutable Audit Log'}
            </SpotlightHeading>
            <ResponsiveDataList
              data={auditLogs}
              locale={locale}
              mobileCardHeader={(r) => r.action}
              columns={[
                { key: 'action', headerAr: 'الإجراء', headerEn: 'Action', render: (r) => <span className="font-mono text-xs">{r.action}</span> },
                { key: 'actor', headerAr: 'المنفذ', headerEn: 'Actor', render: (r) => r.actor_name },
                { key: 'time', headerAr: 'الوقت', headerEn: 'Time', render: (r) => r.created_at.slice(0, 16) },
              ]}
            />
          </SpotlightCard>
        </div>
      </main>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
