'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  Download,
  FileText,
  LogIn,
  LogOut,
  Moon,
  Plus,
  QrCode,
  ShieldCheck,
  Sun,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import {
  downloadInvoiceHtml,
  printInvoicePdf,
  type InvoiceRecord,
  type PaymentMethodRecord,
} from '@/lib/invoice-pdf';
import type { ScheduledEvent } from '@/lib/bookings-store';

type PortalTab = 'events' | 'invoices' | 'profile' | 'delegates' | 'passes';

interface ClientProfileData {
  uid: string;
  fullName: string;
  phone: string;
  email: string;
  preferredLang: string;
  is2faEnabled: boolean;
  clientCategory: string;
  nationalIdOrCr: string;
  taxId: string;
  companyName: string;
  billingAddress: string;
  refundMethod: string;
  refundAccountNumber: string;
  refundAccountHolder: string;
}

interface DelegateRecord {
  id: string;
  eventId: string;
  eventCode: string;
  delegateName: string;
  delegatePhone: string;
  delegateEmail: string;
  delegateRole: string;
  canViewFinance: boolean;
  canEditFloorplan: boolean;
  canRequestAddons: boolean;
}

interface ApprovalDraftRecord {
  id: string;
  eventId: string;
  eventCode: string;
  draftType: string;
  requestedByName: string;
  titleEn: string;
  titleAr: string;
  notes: string;
  financialDelta: number;
  currency: string;
  status: string;
}

interface GatePassRecord {
  id: string;
  eventId: string;
  eventCode: string;
  passType: string;
  holderName: string;
  holderIdNumber: string;
  qrToken: string;
  isCheckedIn: boolean;
  checkedInAt: string | null;
}

interface AuditLogRecord {
  id: number;
  actorName: string;
  eventCode: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

function fmtMoney(amount: number, currency: string, locale: 'ar' | 'en'): string {
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-YE' : 'en-US').format(Math.round(amount))} ${currency}`;
}

function fmtDate(iso: string, locale: 'ar' | 'en'): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

/** Deterministic crisp SVG QR matrix for VIP / Vendor Gate Passes */
function DeterministicQrSvg({ token }: { token: string }) {
  const size = 9;
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isCorner =
        (x < 3 && y < 3) || (x >= size - 3 && y < 3) || (x < 3 && y >= size - 3);
      const bit = ((hash >>> ((x * 7 + y * 13) % 24)) & 1) === 1;
      if (isCorner || bit) {
        cells.push({ x, y });
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-16 w-16 shrink-0 rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700"
      aria-label={`QR ${token}`}
    >
      {cells.map((c, idx) => (
        <rect key={idx} x={c.x} y={c.y} width={0.92} height={0.92} fill="#0F172A" />
      ))}
    </svg>
  );
}

export default function ClientPortalDashboard() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const altLocale = isRtl ? 'en' : 'ar';

  const { resolvedTheme, setTheme } = useTheme();
  const { user, loading: authLoading, authError, signInWithGoogle, signOutUser, authFetch } = useAuth();
  const branding = useTenantBranding();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalTab>('events');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [profile, setProfile] = useState<ClientProfileData | null>(null);
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);
  const [delegates, setDelegates] = useState<DelegateRecord[]>([]);
  const [drafts, setDrafts] = useState<ApprovalDraftRecord[]>([]);
  const [passes, setPasses] = useState<GatePassRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  // Payment submission state
  const [payingTarget, setPayingTarget] = useState<{ invoiceId: string; milestoneId: string; amount: number; currency: string } | null>(null);
  const [payMethodCode, setPayMethodCode] = useState('KURAIMI_BANK');
  const [payRef, setPayRef] = useState('');
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Delegate form state
  const [delEventId, setDelEventId] = useState('');
  const [delName, setDelName] = useState('');
  const [delPhone, setDelPhone] = useState('');
  const [delEmail, setDelEmail] = useState('');
  const [delRole, setDelRole] = useState('WEDDING_PLANNER');
  const [delFinance, setDelFinance] = useState(false);
  const [delFloorplan, setDelFloorplan] = useState(true);
  const [delAddons, setDelAddons] = useState(true);

  // Gate pass form state
  const [passEventId, setPassEventId] = useState('');
  const [passType, setPassType] = useState('VIP_PASS');
  const [passHolder, setPassHolder] = useState('');
  const [passIdNum, setPassIdNum] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadPortal = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await authFetch('/api/v1/portal', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Failed to load client portal');
      setProfile(data.profile || null);
      const evs: ScheduledEvent[] = Array.isArray(data.events) ? data.events : [];
      setEvents(evs);
      setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      const pms: PaymentMethodRecord[] = Array.isArray(data.paymentMethods) ? data.paymentMethods : [];
      setPaymentMethods(pms);
      setDelegates(Array.isArray(data.delegates) ? data.delegates : []);
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setPasses(Array.isArray(data.passes) ? data.passes : []);
      setAuditLogs(Array.isArray(data.auditLogs) ? data.auditLogs : []);
      if (evs.length > 0) {
        setDelEventId((prev) => prev || evs[0].id);
        setPassEventId((prev) => prev || evs[0].id);
      }
      if (pms.length > 0) {
        setPayMethodCode((prev) => prev || pms[0].code);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load portal data');
    } finally {
      setLoading(false);
    }
  }, [authFetch, user]);

  useEffect(() => {
    if (!authLoading) {
      loadPortal();
    }
  }, [authLoading, loadPortal]);

  const showNotice = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleResolveDraft = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_approval', id, decision }),
      });
      if (res.ok) {
        await loadPortal();
        showNotice(
          decision === 'APPROVED'
            ? isRtl
              ? 'تم اعتماد التعديل وتحديث إجمالي الفاتورة تلقائياً.'
              : 'Change request approved and invoice total updated.'
            : isRtl
            ? 'تم رفض مسودة التعديل وتوثيقها في السجل.'
            : 'Change request rejected and recorded in audit trail.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingTarget) return;
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/tenant/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          invoiceId: payingTarget.invoiceId,
          milestoneId: payingTarget.milestoneId,
          paymentMethod: payMethodCode,
          referenceNumber: payRef.trim() || `CLIENT-${String(Date.now()).slice(-6)}`,
        }),
      });
      if (res.ok) {
        setPayingTarget(null);
        setPayRef('');
        await loadPortal();
        showNotice(
          isRtl
            ? 'تم تسجيل الدفعة وتحديث حالة الفعالية والفاتورة بنجاح.'
            : 'Payment settlement recorded and invoice updated.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_profile', ...profile }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) setProfile(data.profile);
        showNotice(
          isRtl
            ? 'تم حفظ ملف العميل وبيانات محفظة الاسترداد بنجاح.'
            : 'Client profile and refund vault saved.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddDelegate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delName.trim() || !delPhone.trim() || !delEventId) return;
    const targetEv = events.find((ev) => ev.id === delEventId);
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_delegate',
          eventId: delEventId,
          eventCode: targetEv?.eventCode || delEventId,
          delegateName: delName.trim(),
          delegatePhone: delPhone.trim(),
          delegateEmail: delEmail.trim(),
          delegateRole: delRole,
          canViewFinance: delFinance,
          canEditFloorplan: delFloorplan,
          canRequestAddons: delAddons,
        }),
      });
      if (res.ok) {
        setDelName('');
        setDelPhone('');
        setDelEmail('');
        await loadPortal();
        showNotice(isRtl ? 'تمت إضافة المفوّض بنجاح.' : 'Event delegate added.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDelegate = async (id: string) => {
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_delegate', id }),
      });
      if (res.ok) {
        setDelegates((prev) => prev.filter((d) => d.id !== id));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssuePass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passHolder.trim() || !passEventId) return;
    const targetEv = events.find((ev) => ev.id === passEventId);
    setSubmitting(true);
    try {
      const res = await authFetch('/api/v1/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'issue_gate_pass',
          eventId: passEventId,
          eventCode: targetEv?.eventCode || passEventId,
          passType,
          holderName: passHolder.trim(),
          holderIdNumber: passIdNum.trim(),
        }),
      });
      if (res.ok) {
        setPassHolder('');
        setPassIdNum('');
        await loadPortal();
        showNotice(isRtl ? 'تم إصدار تصريح QR الجديد بنجاح.' : 'New QR gate pass issued.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pendingDraftsCount = useMemo(
    () => drafts.filter((d) => d.status === 'PENDING').length,
    [drafts]
  );

  const financialTotals = useMemo(() => {
    const total = invoices.reduce((s, inv) => s + inv.totalAmount, 0);
    const paid = invoices.reduce((s, inv) => s + inv.paidAmount, 0);
    const deposit = invoices.reduce((s, inv) => s + inv.securityDepositAmount, 0);
    return { total, paid, balance: Math.max(0, total - paid), deposit };
  }, [invoices]);

  const venueName = isRtl ? branding.venueNameAr : branding.venueNameEn;
  const currency = branding.currency || 'YER';

  const tabs: Array<{ id: PortalTab; labelEn: string; labelAr: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'events', labelEn: `Events & Approvals (${pendingDraftsCount})`, labelAr: `فعالياتي والاعتمادات (${pendingDraftsCount})`, icon: Calendar },
    { id: 'invoices', labelEn: 'Invoices & Payments', labelAr: 'الفواتير والمدفوعات', icon: CreditCard },
    { id: 'profile', labelEn: 'Profile & Refund Vault', labelAr: 'الملف ومحفظة الاسترداد', icon: ShieldCheck },
    { id: 'delegates', labelEn: 'Event Delegation', labelAr: 'تفويض المنسقين', icon: Users },
    { id: 'passes', labelEn: 'VIP QR Passes & Audit', labelAr: 'تصاريح QR وسجل التدقيق', icon: QrCode },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:pb-12">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-8 px-6 py-4">
          <Link
            href={`/${locale}/portal/dashboard`}
            className="shrink-0 whitespace-nowrap text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {venueName}
          </Link>

          <nav
            aria-label={isRtl ? 'التنقل في بوابة العميل' : 'Client portal navigation'}
            className="hidden items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400 md:flex"
          >
            <Link
              href={`/${locale}/venue`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'صفحة الحجز' : 'Booking Storefront'}
            </Link>
            <Link
              href={`/${locale}/portal/dashboard`}
              className="shrink-0 whitespace-nowrap text-slate-900 underline decoration-[var(--brand-primary,#D4AF37)] decoration-2 underline-offset-8 dark:text-slate-100"
            >
              {isRtl ? 'بوابة العميل' : 'Client Portal'}
            </Link>
            <Link
              href={`/${locale}/dashboard`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'لوحة الإدارة ERP' : 'ERP Console'}
            </Link>
            <Link
              href={`/${altLocale}/portal/dashboard`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'English' : 'العربية'}
            </Link>
          </nav>

          <div className="shrink-0">
            <Link
              href={`/${locale}/venue#book-and-register`}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              <span>{isRtl ? 'حجز فعالية جديدة' : 'Book New Event'}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {isRtl ? 'لوحة تحكم العميل والفواتير والاعتمادات' : 'Client Account Control Panel'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {isRtl
                ? 'تابع حجوزاتك، اعتمد إضافات المنسقين، سدد الدفعات وصدّر فواتيرك الرسمية بـ PDF، وأدِر تصاريح QR.'
                : 'Manage reservations, sign off on planner add-ons, settle invoices with branded PDF exports, and issue VIP QR passes.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {user && (
              <button
                type="button"
                onClick={signOutUser}
                className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                <span className="max-w-[140px] truncate">{user.displayName || user.email}</span>
                <LogOut className="h-3.5 w-3.5 text-slate-400" />
              </button>
            )}
            {mounted && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                {resolvedTheme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                <span>{resolvedTheme === 'dark' ? (isRtl ? 'نهاري' : 'Light') : isRtl ? 'ليلي' : 'Dark'}</span>
              </button>
            )}
          </div>
        </div>

        {feedback && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
            {feedback}
          </div>
        )}
        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
            {errorMsg}
          </div>
        )}

        {!authLoading && !user ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-[#D4AF37]/30 dark:bg-[#D4AF37]/10 dark:text-[#D4AF37]">
              <UserCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'تسجيل الدخول إلى بوابة العميل' : 'Sign in to Your Client Portal'}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {isRtl
                ? 'سجّل الدخول بحساب Google لعرض فواتيرك، اعتماد التعديلات، إدارة محفظة الاسترداد، وإصدار بطاقات QR.'
                : 'Sign in with Google to view your booked events, download branded PDF invoices, manage planner delegation, and issue VIP passes.'}
            </p>
            {authError && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                {authError}
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={signInWithGoogle}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-2.5 text-sm font-semibold text-slate-950 hover:opacity-90"
              >
                <LogIn className="h-4 w-4" />
                <span>{isRtl ? 'المتابعة بحساب Google' : 'Continue with Google'}</span>
              </button>
              <Link
                href={`/${locale}/venue`}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {isRtl ? 'استعراض القاعات أولاً' : 'Browse Venue First'}
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 4-Column Client Account Summary Strip */}
            <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              <div className="px-5 py-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'الفعاليات المسجلة' : 'Active Reservations'}
                </div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {loading ? '—' : events.length}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'اعتمادات بانتظار قرارك' : 'Pending Approvals'}
                </div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {loading ? '—' : pendingDraftsCount}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'الرصيد المتبقي للسداد' : 'Remaining Balance'}
                </div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {loading ? '—' : fmtMoney(financialTotals.balance, currency, locale)}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'تأمين الأضرار المسترد' : 'Escrow Security Deposit'}
                </div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {loading ? '—' : fmtMoney(financialTotals.deposit, currency, locale)}
                </div>
              </div>
            </div>

            {/* Clean Underline Workspace Tabs */}
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex min-h-[42px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[var(--brand-primary,#D4AF37)] text-slate-900 dark:text-slate-100'
                        : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{isRtl ? tab.labelAr : tab.labelEn}</span>
                  </button>
                );
              })}
            </div>

            {/* TAB 1: EVENTS & DUAL-APPROVAL REQUESTS */}
            {activeTab === 'events' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-7">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'فعالياتي وحجوزات القاعات' : 'My Booked Events'}
                  </h2>
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {isRtl ? ev.titleAr : ev.titleEn}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono">{ev.eventCode}</span>
                            <span aria-hidden="true" className="mx-1.5">·</span>
                            <span>{isRtl ? ev.hallNameAr : ev.hallNameEn}</span>
                            <span aria-hidden="true" className="mx-1.5">·</span>
                            <span className="font-mono tabular-nums">{fmtDate(ev.startTime, locale)}</span>
                            <span aria-hidden="true" className="mx-1.5">·</span>
                            <span className="font-mono tabular-nums">
                              {ev.guestCount} {isRtl ? 'ضيف' : 'guests'}
                            </span>
                          </div>
                        </div>
                        <div className="text-end">
                          <div className="font-mono text-sm font-semibold tabular-nums">
                            {fmtMoney(ev.totalAmount, ev.currency, locale)}
                          </div>
                          <div className="text-xs font-medium text-amber-700 dark:text-[#D4AF37]">
                            {ev.status}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dual-Approval Change Queue */}
                <div className="space-y-4 lg:col-span-5">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'طلبات تعديل المنسقين (الموافقة المزدوجة)' : 'Dual-Approval Change Requests'}
                  </h2>
                  <div className="space-y-3">
                    {drafts.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                        {isRtl ? 'لا توجد مسودات تعديل حالياً.' : 'No pending planner change requests.'}
                      </div>
                    ) : (
                      drafts.map((draft) => (
                        <div
                          key={draft.id}
                          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {isRtl ? draft.titleAr : draft.titleEn}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {draft.eventCode} · {draft.requestedByName}
                              </div>
                            </div>
                            <span className="font-mono text-sm font-bold tabular-nums text-amber-700 dark:text-[#D4AF37]">
                              +{fmtMoney(draft.financialDelta, draft.currency, locale)}
                            </span>
                          </div>

                          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            {draft.notes || draft.draftType}
                          </p>

                          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                              {draft.status}
                            </span>
                            {draft.status === 'PENDING' && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => handleResolveDraft(draft.id, 'REJECTED')}
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  <span>{isRtl ? 'رفض' : 'Reject'}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => handleResolveDraft(draft.id, 'APPROVED')}
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  <span>{isRtl ? 'اعتماد وتحديث الفاتورة' : 'Approve & Sync Invoice'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: INVOICES, PAYMENT MILESTONES & BRANDED PDF EXPORT */}
            {activeTab === 'invoices' && (
              <div className="space-y-5">
                {invoices.map((inv) => {
                  const balance = Math.max(0, inv.totalAmount - inv.paidAmount);
                  return (
                    <div
                      key={inv.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                              {inv.invoiceNumber}
                            </span>
                            <span className="text-xs font-semibold text-amber-700 dark:text-[#D4AF37]">
                              · {inv.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {inv.eventCode} · {isRtl ? inv.clientNameAr : inv.clientNameEn} ·{' '}
                            {isRtl ? 'تاريخ الإصدار:' : 'Issued:'} {fmtDate(inv.issuedAt, locale)}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => printInvoicePdf(inv, branding, locale, paymentMethods)}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-semibold text-slate-950 hover:opacity-90"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>{isRtl ? 'تصدير PDF' : 'Export PDF'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadInvoiceHtml(inv, branding, locale, paymentMethods)}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>HTML</span>
                          </button>
                        </div>
                      </div>

                      {/* Line Items */}
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              <th className="py-2 text-start font-medium">{isRtl ? 'البند' : 'Description'}</th>
                              <th className="py-2 text-center font-medium">{isRtl ? 'الكمية' : 'Qty'}</th>
                              <th className="py-2 text-end font-medium">{isRtl ? 'سعر الوحدة' : 'Unit'}</th>
                              <th className="py-2 text-end font-medium">{isRtl ? 'الإجمالي' : 'Total'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {inv.lineItems.map((li) => (
                              <tr key={li.id}>
                                <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200">
                                  {isRtl ? li.descriptionAr : li.descriptionEn}
                                </td>
                                <td className="py-2.5 text-center font-mono tabular-nums">{li.quantity}</td>
                                <td className="py-2.5 text-end font-mono tabular-nums">
                                  {fmtMoney(li.unitPrice, inv.currency, locale)}
                                </td>
                                <td className="py-2.5 text-end font-mono font-semibold tabular-nums">
                                  {fmtMoney(li.total, inv.currency, locale)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Totals + Escrow Bar */}
                      <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-950">
                        <div>
                          <div className="text-slate-500">{isRtl ? 'الإجمالي (شامل الضريبة)' : 'Total incl. Tax'}</div>
                          <div className="mt-0.5 font-mono text-sm font-bold tabular-nums">
                            {fmtMoney(inv.totalAmount, inv.currency, locale)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">{isRtl ? 'المدفوع' : 'Paid'}</div>
                          <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {fmtMoney(inv.paidAmount, inv.currency, locale)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">{isRtl ? 'المتبقي' : 'Balance Due'}</div>
                          <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">
                            {fmtMoney(balance, inv.currency, locale)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">{isRtl ? 'تأمين الأضرار' : 'Security Deposit'}</div>
                          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                            {fmtMoney(inv.securityDepositAmount, inv.currency, locale)} · {inv.depositStatus}
                          </div>
                        </div>
                      </div>

                      {/* Payment Milestones */}
                      <div className="mt-4 space-y-2">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {isRtl ? 'مراحل السداد' : 'Payment Milestones'}
                        </div>
                        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                          {inv.milestones.map((ms) => (
                            <div key={ms.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                              <div>
                                <div className="font-medium text-slate-900 dark:text-slate-100">
                                  {isRtl ? ms.titleAr : ms.titleEn}
                                </div>
                                <div className="text-slate-500 dark:text-slate-400">
                                  {isRtl ? 'الاستحقاق:' : 'Due:'} {fmtDate(ms.dueDate, locale)}
                                  {ms.paymentMethod && ` · ${ms.paymentMethod}`}
                                  {ms.referenceNumber && ` · ${ms.referenceNumber}`}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-mono font-semibold tabular-nums">
                                  {fmtMoney(ms.amountDue, inv.currency, locale)}
                                </span>
                                {ms.status === 'PAID' ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {isRtl ? 'مدفوعة' : 'Paid'}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPayingTarget({
                                        invoiceId: inv.id,
                                        milestoneId: ms.id,
                                        amount: ms.amountDue,
                                        currency: inv.currency,
                                      })
                                    }
                                    className="min-h-[32px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-semibold text-slate-950 hover:opacity-90"
                                  >
                                    {isRtl ? 'سداد الآن' : 'Pay Milestone'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB 3: B2C / B2B PROFILE & REFUND VAULT */}
            {activeTab === 'profile' && profile && (
              <form
                onSubmit={handleSaveProfile}
                className="grid grid-cols-1 gap-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-2"
              >
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'بيانات الحساب والفوترة (B2C / B2B)' : 'Identity & Billing Profile (B2C / B2B)'}
                  </h2>

                  <div className="flex gap-2">
                    {(['INDIVIDUAL_B2C', 'CORPORATE_B2B'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setProfile({ ...profile, clientCategory: cat })}
                        className={`min-h-[38px] flex-1 rounded-lg border text-xs font-semibold ${
                          profile.clientCategory === cat
                            ? 'border-[var(--brand-primary,#D4AF37)] bg-amber-50/50 text-slate-900 dark:bg-[#D4AF37]/15 dark:text-slate-100'
                            : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
                        }`}
                      >
                        {cat === 'INDIVIDUAL_B2C'
                          ? isRtl
                            ? 'حساب فردي B2C'
                            : 'Individual B2C'
                          : isRtl
                          ? 'حساب شركات B2B'
                          : 'Corporate B2B'}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'الاسم الكامل' : 'Full Name'}</label>
                      <input
                        value={profile.fullName}
                        onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'رقم الجوال' : 'Phone'}</label>
                      <input
                        dir="ltr"
                        value={profile.phone}
                        onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'الهوية / السجل التجاري' : 'National ID / CR'}</label>
                      <input
                        dir="ltr"
                        value={profile.nationalIdOrCr}
                        onChange={(e) => setProfile({ ...profile, nationalIdOrCr: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'الرقم الضريبي' : 'VAT / Tax ID'}</label>
                      <input
                        dir="ltr"
                        value={profile.taxId}
                        onChange={(e) => setProfile({ ...profile, taxId: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'اسم الشركة (للشركات)' : 'Company Name'}</label>
                      <input
                        value={profile.companyName}
                        onChange={(e) => setProfile({ ...profile, companyName: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'عنوان الفوترة' : 'Billing Address'}</label>
                      <input
                        value={profile.billingAddress}
                        onChange={(e) => setProfile({ ...profile, billingAddress: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between space-y-4">
                  <div className="space-y-4">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? 'محفظة استرداد التأمين والأمان' : 'Refund Vault & Account Security'}
                    </h2>

                    <div>
                      <label className="mb-1 block text-xs text-slate-500">
                        {isRtl ? 'قناة استرداد تأمين الأضرار' : 'Preferred Refund Method'}
                      </label>
                      <select
                        value={profile.refundMethod}
                        onChange={(e) => setProfile({ ...profile, refundMethod: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="KURAIMI_BANK">{isRtl ? 'بنك الكريمي الإسلامي' : 'Al-Kuraimi Islamic Bank'}</option>
                        <option value="JAIB">{isRtl ? 'محفظة جيب (Jaib)' : 'Jaib E-Wallet'}</option>
                        <option value="JAWALI">{isRtl ? 'محفظة جوالي (Jawali)' : 'Jawali E-Wallet'}</option>
                        <option value="ONECASH">{isRtl ? 'ون كاش (OneCash)' : 'OneCash Wallet'}</option>
                        <option value="BANK_IBAN">{isRtl ? 'حوالة بنكية (IBAN)' : 'Bank IBAN Transfer'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-500">
                        {isRtl ? 'رقم الحساب / المحفظة' : 'Account / Wallet Number'}
                      </label>
                      <input
                        dir="ltr"
                        value={profile.refundAccountNumber}
                        onChange={(e) => setProfile({ ...profile, refundAccountNumber: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-500">
                        {isRtl ? 'اسم صاحب الحساب' : 'Account Holder Name'}
                      </label>
                      <input
                        value={profile.refundAccountHolder}
                        onChange={(e) => setProfile({ ...profile, refundAccountHolder: e.target.value })}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>

                    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 p-3.5 text-xs dark:border-slate-800">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {isRtl ? 'المصادقة الثنائية (2FA OTP)' : 'Two-Factor OTP Security'}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {isRtl ? 'تأكيد اعتماد الإضافات المالية وتعديلات الحساب' : 'Verify financial approvals and account changes'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={profile.is2faEnabled}
                        onChange={(e) => setProfile({ ...profile, is2faEnabled: e.target.checked })}
                        className="h-4 w-4 accent-[var(--brand-primary,#D4AF37)]"
                      />
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[42px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 py-2.5 text-xs font-semibold text-slate-950 hover:opacity-90 disabled:opacity-60"
                  >
                    {isRtl ? 'حفظ بيانات الملف ومحفظة الاسترداد' : 'Save Profile & Refund Vault'}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 4: EVENT DELEGATION */}
            {activeTab === 'delegates' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="space-y-3 lg:col-span-7">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'المنسقون والمفوّضون النشطون' : 'Authorized Planners & Co-Hosts'}
                  </h2>
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {delegates.map((del) => (
                      <div key={del.id} className="flex items-start justify-between gap-4 p-4">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {del.delegateName}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {del.delegateRole} · {del.eventCode} · <span className="font-mono" dir="ltr">{del.delegatePhone}</span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">
                            {del.canEditFloorplan ? (isRtl ? 'تعديل المخطط' : 'Floorplan') : ''}
                            {del.canRequestAddons ? ` · ${isRtl ? 'طلب إضافات' : 'Request Add-Ons'}` : ''}
                            {` · ${del.canViewFinance ? (isRtl ? 'يرى الفواتير' : 'Sees Billing') : isRtl ? 'الفواتير مخفية' : 'Billing Hidden'}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteDelegate(del.id)}
                          aria-label={isRtl ? 'إلغاء التفويض' : 'Revoke delegate'}
                          className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <form
                  onSubmit={handleAddDelegate}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5"
                >
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'تفويض منسق أو مضيف مشارك' : 'Add Event Delegate'}
                  </h2>

                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'الفعالية' : 'Event'}</label>
                    <select
                      value={delEventId}
                      onChange={(e) => setDelEventId(e.target.value)}
                      className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    >
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.eventCode} — {isRtl ? ev.titleAr : ev.titleEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'اسم المفوّض' : 'Delegate Name'}</label>
                    <input
                      required
                      value={delName}
                      onChange={(e) => setDelName(e.target.value)}
                      placeholder={isRtl ? 'سارة منسقة الحفلات' : 'Sarah Wedding Planner'}
                      className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'رقم الجوال' : 'Phone'}</label>
                      <input
                        required
                        dir="ltr"
                        value={delPhone}
                        onChange={(e) => setDelPhone(e.target.value)}
                        placeholder="+967770123456"
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{isRtl ? 'الصفة' : 'Role'}</label>
                      <select
                        value={delRole}
                        onChange={(e) => setDelRole(e.target.value)}
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="WEDDING_PLANNER">{isRtl ? 'منسق حفلات' : 'Wedding Planner'}</option>
                        <option value="CO_HOST">{isRtl ? 'مضيف مشارك' : 'Co-Host'}</option>
                        <option value="VENDOR">{isRtl ? 'مورد / ديكور' : 'Vendor'}</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
                    <label className="flex items-center justify-between">
                      <span>{isRtl ? 'تعديل مخطط الطاولات' : 'Can edit floorplan'}</span>
                      <input type="checkbox" checked={delFloorplan} onChange={(e) => setDelFloorplan(e.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between">
                      <span>{isRtl ? 'رفع طلبات إضافات للموافقة' : 'Can request add-ons'}</span>
                      <input type="checkbox" checked={delAddons} onChange={(e) => setDelAddons(e.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between">
                      <span>{isRtl ? 'السماح بعرض الفواتير والأسعار' : 'Can view invoices & prices'}</span>
                      <input type="checkbox" checked={delFinance} onChange={(e) => setDelFinance(e.target.checked)} />
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[40px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 hover:opacity-90"
                  >
                    {isRtl ? 'منح صلاحية التفويض' : 'Grant Scoped Access'}
                  </button>
                </form>
              </div>
            )}

            {/* TAB 5: VIP QR PASSES & IMMUTABLE AUDIT TRAIL */}
            {activeTab === 'passes' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-7">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? 'بطاقات دخول QR لكبار الشخصيات والموردين' : 'VIP & Vendor QR Gate Passes'}
                    </h2>
                  </div>

                  <form
                    onSubmit={handleIssuePass}
                    className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <select
                      value={passEventId}
                      onChange={(e) => setPassEventId(e.target.value)}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>{ev.eventCode}</option>
                      ))}
                    </select>
                    <input
                      required
                      value={passHolder}
                      onChange={(e) => setPassHolder(e.target.value)}
                      placeholder={isRtl ? 'اسم حامل التصريح' : 'Pass holder name'}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                    <select
                      value={passType}
                      onChange={(e) => setPassType(e.target.value)}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="VIP_PASS">{isRtl ? 'كبار الشخصيات VIP' : 'VIP Guest'}</option>
                      <option value="FAMILY_PASS">{isRtl ? 'العائلة' : 'Family'}</option>
                      <option value="VENDOR_PASS">{isRtl ? 'مورد / تجهيز' : 'Vendor Access'}</option>
                    </select>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-semibold text-slate-950 hover:opacity-90"
                    >
                      {isRtl ? 'إصدار QR' : 'Issue Pass'}
                    </button>
                  </form>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {passes.map((pass) => (
                      <div
                        key={pass.id}
                        className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <DeterministicQrSvg token={pass.qrToken} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {pass.holderName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {pass.qrToken}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            {pass.passType} · {pass.eventCode}
                          </div>
                          <div
                            className={`text-[11px] font-semibold ${
                              pass.isCheckedIn ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-[#D4AF37]'
                            }`}
                          >
                            {pass.isCheckedIn
                              ? isRtl
                                ? 'تم تسجيل الدخول عبر البوابة'
                                : 'Checked In at Gate'
                              : isRtl
                              ? 'جاهز للمسح عند البوابة'
                              : 'Ready for Gate Scan'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Immutable Audit Log */}
                <div className="space-y-3 lg:col-span-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <ClipboardList className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{isRtl ? 'سجل التدقيق غير القابل للتعديل' : 'Immutable Activity Audit Log'}</span>
                  </h2>
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {auditLogs.slice(0, 12).map((log) => (
                      <div key={log.id} className="px-4 py-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {log.action}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {fmtDate(log.createdAt, locale)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                          {log.actorName} {log.eventCode ? `· ${log.eventCode}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Payment Settlement Modal */}
      {payingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="text-base font-semibold">
                {isRtl ? 'تأكيد سداد الدفعة' : 'Submit Milestone Payment'}
              </h3>
              <button type="button" onClick={() => setPayingTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">{isRtl ? 'المبلغ المستحق' : 'Amount Due'}</div>
                <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-amber-700 dark:text-[#D4AF37]">
                  {fmtMoney(payingTarget.amount, payingTarget.currency, locale)}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'اختر قناة السداد' : 'Select Payment Method'}
                </label>
                <select
                  value={payMethodCode}
                  onChange={(e) => {
                    setPayMethodCode(e.target.value);
                    setCopiedAccount(false);
                  }}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.code}>
                      {isRtl ? `${pm.nameAr} (${pm.accountNumber})` : `${pm.nameEn} (${pm.accountNumber})`}
                    </option>
                  ))}
                </select>
                {(() => {
                  const chosen = paymentMethods.find((m) => m.code === payMethodCode);
                  if (!chosen) return null;
                  return (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                      <span className="font-mono font-semibold" dir="ltr">{chosen.accountNumber}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(chosen.accountNumber).catch(() => undefined);
                          }
                          setCopiedAccount(true);
                          setTimeout(() => setCopiedAccount(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium dark:border-slate-700"
                      >
                        {copiedAccount ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedAccount ? (isRtl ? 'تم النسخ' : 'Copied') : isRtl ? 'نسخ الرقم' : 'Copy #'}</span>
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'رقم الحوالة / المرجع' : 'Transfer / Transaction Reference #'}
                </label>
                <input
                  required
                  dir="ltr"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="KRM-889921"
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayingTarget(null)}
                  className="min-h-[38px] rounded-lg border border-slate-300 px-4 text-xs font-medium dark:border-slate-700"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 text-xs font-semibold text-slate-950 hover:opacity-90"
                >
                  {isRtl ? 'تأكيد السداد' : 'Confirm Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
