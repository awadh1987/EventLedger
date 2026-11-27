'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  Lock,
  Plus,
  QrCode,
  RotateCcw,
  Share2,
  Shield,
  ShieldCheck,
  Unlock,
  XCircle,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, tenantPath } from '@/lib/api';
import { LookupSelect } from '@/components/ui/LookupSelect';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { CalendarEventRow } from '@/components/erp/OutlookHallCalendar';

export type SecuritySubTab = 'READINESS' | 'PASSES' | 'DEPOSIT_CLOSE';

interface SecurityPassRow {
  id: string;
  pass_type: string;
  clearance_category: string;
  holder_name: string;
  holder_phone: string | null;
  holder_id_number: string | null;
  organization: string | null;
  vehicle_plate: string | null;
  clearance_status: 'APPROVED' | 'PENDING_APPROVAL' | 'RETURNED_FOR_AMENDMENT' | 'REVOKED' | string;
  remarks: string | null;
  qr_token: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
}

interface SecurityOverviewPayload {
  event: { id: string; event_code: string; title: string | null; status: string; is_locked: boolean };
  security_profile: {
    readiness_checklist_json: Record<string, boolean>;
    guard_headcount: number;
    security_lead_name: string | null;
    security_status: 'DRAFT' | 'PENDING_REVIEW' | 'CLEARED' | 'RETURNED_FOR_AMENDMENT' | 'INCIDENT_FLAGGED';
    tenant_remarks: string | null;
    client_remarks: string | null;
    amendment_reason: string | null;
  };
  passes: SecurityPassRow[];
  stats: { total: number; approved: number; pending: number; returned: number; revoked: number; checked_in: number };
}

interface DepositLifecyclePayload {
  event: {
    id: string;
    event_code: string;
    title: string | null;
    status: string;
    is_locked: boolean;
    closed_at: string | null;
    closing_remarks: string | null;
    reopened_reason: string | null;
  };
  invoice: {
    id: string;
    invoice_number: string;
    total_amount: number;
    paid_amount: number;
    security_deposit_amount: number;
    deposit_status: string;
    status: string;
  } | null;
  inspection: {
    id: string;
    status: 'PASSED' | 'DAMAGE_CLAIMED';
    approval_status: string;
    checklist_json: Record<string, boolean>;
    deduction_items: { category: string; description: string; amount: number; remarks?: string }[];
    deduction_amount: number;
    refundable_balance: number;
    notes: string | null;
    client_remarks: string | null;
    amendment_remarks: string | null;
  } | null;
  pre_close_checklist: {
    contract_signed: boolean;
    invoice_settled: boolean;
    security_cleared: boolean;
    inspection_completed: boolean;
    deposit_resolved: boolean;
  };
}

interface Props {
  locale: 'ar' | 'en';
  tenantSlug: string;
  events: CalendarEventRow[];
  selectedEventId: string;
  onSelectEvent: (id: string) => void;
  initialSubTab?: SecuritySubTab;
  onRefreshDashboard: () => Promise<void> | void;
}

const READINESS_LABELS: Record<string, { ar: string; en: string }> = {
  fire_and_exits: { ar: 'مخارج الطوارئ وأنظمة الإطفاء', en: 'Fire & Emergency Exits' },
  cctv_and_lighting: { ar: 'كاميرات المراقبة والإضاءة', en: 'CCTV & Perimeter Lighting' },
  guard_roster_assigned: { ar: 'توزيع ورديات الحراسة', en: 'Guard Roster Assigned' },
  vip_and_privacy_zone: { ar: 'تأمين جناح VIP والخصوصية', en: 'VIP & Privacy Zone' },
  vendor_loading_bay: { ar: 'تنظيم بوابة الموردين والتحميل', en: 'Vendor Loading Bay' },
  crowd_capacity_plan: { ar: 'خطة استيعاب الحشود', en: 'Crowd Capacity Plan' },
};

const CLEARANCE_STYLE: Record<string, string> = {
  APPROVED: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300',
  PENDING_APPROVAL: 'bg-amber-500/20 text-amber-600 dark:text-amber-300',
  RETURNED_FOR_AMENDMENT: 'bg-orange-500/20 text-orange-600 dark:text-orange-300',
  REVOKED: 'bg-rose-500/20 text-rose-600 dark:text-rose-300',
};

export function SecurityAndCloseControlPlane({
  locale,
  tenantSlug,
  events,
  selectedEventId,
  onSelectEvent,
  initialSubTab = 'READINESS',
  onRefreshDashboard,
}: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [subTab, setSubTab] = useState<SecuritySubTab>(initialSubTab);
  const [secData, setSecData] = useState<SecurityOverviewPayload | null>(null);
  const [depData, setDepData] = useState<DepositLifecyclePayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Readiness state
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [customCheckName, setCustomCheckName] = useState('');
  const [guardCount, setGuardCount] = useState('4');
  const [leadName, setLeadName] = useState('');
  const [secStatus, setSecStatus] = useState<'DRAFT' | 'PENDING_REVIEW' | 'CLEARED' | 'RETURNED_FOR_AMENDMENT' | 'INCIDENT_FLAGGED'>('DRAFT');
  const [tenantRemarks, setTenantRemarks] = useState('');
  const [amendReason, setAmendReason] = useState('');

  // Pass creation state
  const [passFilter, setPassFilter] = useState('ALL');
  const [newPass, setNewPass] = useState({
    clearance_category: 'VENDOR',
    holder_name: '',
    holder_phone: '',
    holder_id_number: '',
    organization: '',
    vehicle_plate: '',
    remarks: '',
  });
  const [passRemarksMap, setPassRemarksMap] = useState<Record<string, string>>({});

  // Deposit inspection & itemized deductions + close state
  const [inspChecklist, setInspChecklist] = useState<Record<string, boolean>>({
    stage_and_lighting: true,
    furniture_and_chairs: true,
    av_equipment: true,
    cleanliness_and_walls: true,
  });
  const [inspStatus, setInspStatus] = useState<'PASSED' | 'DAMAGE_CLAIMED'>('PASSED');
  const [deductionItems, setDeductionItems] = useState<
    { category: string; description: string; amount: number; remarks?: string }[]
  >([]);
  const [draftDedCat, setDraftDedCat] = useState('EQUIPMENT_DAMAGE');
  const [draftDedDesc, setDraftDedDesc] = useState('');
  const [draftDedAmt, setDraftDedAmt] = useState('');
  const [draftDedRem, setDraftDedRem] = useState('');
  const [inspNotes, setInspNotes] = useState('');
  const [inspAmendRemarks, setInspAmendRemarks] = useState('');
  const [refundMethod, setRefundMethod] = useState('KURAIMI_BANK');
  const [refundRemarks, setRefundRemarks] = useState('');
  const [closingRemarks, setClosingRemarks] = useState('');
  const [forceClose, setForceClose] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const activeId = selectedEventId || events[0]?.id || '';

  const loadEventControlData = useCallback(async () => {
    if (!activeId) return;
    try {
      const [sec, dep] = await Promise.all([
        apiFetch<SecurityOverviewPayload>(`/api/v1/security/events/${activeId}/overview`),
        apiFetch<DepositLifecyclePayload>(`/api/v1/events/${activeId}/deposit-lifecycle`),
      ]);
      setSecData(sec);
      setDepData(dep);

      setChecklist(sec.security_profile.readiness_checklist_json || {});
      setGuardCount(String(sec.security_profile.guard_headcount ?? 4));
      setLeadName(sec.security_profile.security_lead_name || '');
      setSecStatus(sec.security_profile.security_status || 'DRAFT');
      setTenantRemarks(sec.security_profile.tenant_remarks || '');
      setAmendReason(sec.security_profile.amendment_reason || '');

      if (dep.inspection) {
        setInspStatus(dep.inspection.status);
        setInspChecklist(
          Object.keys(dep.inspection.checklist_json || {}).length > 0
            ? dep.inspection.checklist_json
            : { stage_and_lighting: true, furniture_and_chairs: true, av_equipment: true, cleanliness_and_walls: true }
        );
        setDeductionItems(dep.inspection.deduction_items || []);
        setInspNotes(dep.inspection.notes || '');
        setInspAmendRemarks(dep.inspection.amendment_remarks || '');
      } else {
        setInspStatus('PASSED');
        setDeductionItems([]);
        setInspNotes('');
        setInspAmendRemarks('');
      }
      setClosingRemarks(dep.event.closing_remarks || '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر تحميل بيانات الأمن والتأمين', 'Failed to load security data'));
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadEventControlData();
  }, [loadEventControlData]);

  const saveReadiness = async (overrideStatus?: typeof secStatus) => {
    if (!activeId) return;
    const nextStatus = overrideStatus || secStatus;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/security/events/${activeId}/readiness`, {
        method: 'PUT',
        body: {
          readiness_checklist_json: checklist,
          guard_headcount: Number(guardCount) || 0,
          security_lead_name: leadName.trim() || null,
          security_status: nextStatus,
          tenant_remarks: tenantRemarks.trim() || null,
          amendment_reason: amendReason.trim() || null,
        },
      });
      setNotice(tr(`تم حفظ جاهزية الأمن (${nextStatus}).`, `Security readiness saved (${nextStatus}).`));
      await loadEventControlData();
      await onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save security readiness');
    } finally {
      setBusy(false);
    }
  };

  const issuePass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !newPass.holder_name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/security/events/${activeId}/passes`, {
        method: 'POST',
        body: {
          clearance_category: newPass.clearance_category.trim().toUpperCase(),
          holder_name: newPass.holder_name.trim(),
          holder_phone: newPass.holder_phone.trim() || null,
          holder_id_number: newPass.holder_id_number.trim() || null,
          organization: newPass.organization.trim() || null,
          vehicle_plate: newPass.vehicle_plate.trim() || null,
          remarks: newPass.remarks.trim() || null,
          clearance_status: 'APPROVED',
        },
      });
      setNewPass({
        clearance_category: 'VENDOR',
        holder_name: '',
        holder_phone: '',
        holder_id_number: '',
        organization: '',
        vehicle_plate: '',
        remarks: '',
      });
      setNotice(tr('تم إصدار تصريح الدخول بنجاح.', 'Security clearance pass issued.'));
      await loadEventControlData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue clearance pass');
    } finally {
      setBusy(false);
    }
  };

  const actOnPass = async (
    passId: string,
    clearanceStatus?: 'APPROVED' | 'RETURNED_FOR_AMENDMENT' | 'REVOKED' | 'PENDING_APPROVAL',
    checkIn?: boolean
  ) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/security/passes/${passId}`, {
        method: 'PATCH',
        body: {
          ...(clearanceStatus ? { clearance_status: clearanceStatus } : {}),
          ...(passRemarksMap[passId] !== undefined ? { remarks: passRemarksMap[passId] } : {}),
          ...(checkIn !== undefined ? { is_checked_in: checkIn } : {}),
        },
      });
      setNotice(tr('تم تحديث حالة التصريح.', 'Clearance pass updated.'));
      await loadEventControlData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update clearance pass');
    } finally {
      setBusy(false);
    }
  };

  const totalDeduction = deductionItems.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const submitInspectionWorkflow = async (
    workflowAction: 'DRAFT' | 'SUBMIT_FOR_CLIENT_REVIEW' | 'RETURN_FOR_AMENDMENT' | 'FINALIZE'
  ) => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      const effectiveStatus = totalDeduction > 0 ? 'DAMAGE_CLAIMED' : inspStatus;
      const res = await apiFetch<{ status: string; approval_status: string; deposit_status: string | null }>(
        `/api/v1/erp/ops/events/${activeId}/inspection`,
        {
          method: 'POST',
          body: {
            status: effectiveStatus,
            deduction_amount: effectiveStatus === 'DAMAGE_CLAIMED' ? totalDeduction : 0,
            deduction_items: deductionItems,
            notes: inspNotes.trim() || null,
            amendment_remarks: inspAmendRemarks.trim() || null,
            checklist_json: inspChecklist,
            workflow_action: workflowAction,
          },
        }
      );
      setNotice(
        tr(
          `تم تحديث الفحص (${res.approval_status}) — التأمين: ${res.deposit_status || '-'}`,
          `Inspection saved (${res.approval_status}) — Deposit: ${res.deposit_status || '-'}`
        )
      );
      await loadEventControlData();
      await onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save inspection workflow');
    } finally {
      setBusy(false);
    }
  };

  const refundDeposit = async () => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ refund_amount: number; journal_entry_number: string | null }>(
        `/api/v1/erp/finance/events/${activeId}/refund-deposit`,
        {
          method: 'POST',
          body: {
            payment_method: refundMethod,
            reference: refundRemarks.trim() || 'Post-event deposit settlement',
            remarks: refundRemarks.trim() || null,
          },
        }
      );
      setNotice(
        tr(
          `تم رد مبلغ التأمين (${res.refund_amount.toLocaleString()}) وترحيل القيد ${res.journal_entry_number || ''}`,
          `Deposit refunded (${res.refund_amount.toLocaleString()}) · GL ${res.journal_entry_number || ''}`
        )
      );
      await loadEventControlData();
      await onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  };

  const closeOperation = async () => {
    if (!activeId || !closingRemarks.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/erp/ops/events/${activeId}/close-operation`, {
        method: 'POST',
        body: { closing_remarks: closingRemarks.trim(), force_close: forceClose },
      });
      setNotice(tr('تم إغلاق الفعالية وإقفال التشغيل بنجاح (CLOSED).', 'Operation closed and locked (CLOSED).'));
      await loadEventControlData();
      await onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close operation');
    } finally {
      setBusy(false);
    }
  };

  const reopenOperation = async () => {
    if (!activeId || !reopenReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/erp/ops/events/${activeId}/reopen-operation`, {
        method: 'POST',
        body: { reason: reopenReason.trim() },
      });
      setReopenReason('');
      setNotice(tr('تمت إعادة فتح الفعالية بنجاح.', 'Operation reopened cleanly.'));
      await loadEventControlData();
      await onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen operation');
    } finally {
      setBusy(false);
    }
  };

  const filteredPasses = (secData?.passes || []).filter(
    (p) => passFilter === 'ALL' || p.clearance_status === passFilter || p.clearance_category === passFilter
  );

  return (
    <SpotlightCard className="space-y-5 text-start">
      {/* Header + Event Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SpotlightHeading as="h2" className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
            <span>
              {tr(
                'لوحة تحكم أمن الفعاليات والقاعات وتسوية التأمين وإغلاق التشغيل',
                'Events & Halls Security, Deposit Settlement & Close Operation'
              )}
            </span>
          </SpotlightHeading>
          <p className="text-xs text-slate-500">
            {tr(
              'التحقق الأمني، تصاريح الضيوف والموردين، الفحص التفصيلي للتأمين المسترد، وإقفال الفعالية.',
              'Hall readiness checklists, gate clearances, itemized security deposit refunds/deductions, and controlled operation closing.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeId}
            onChange={(e) => onSelectEvent(e.target.value)}
            className="min-h-[38px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.event_code} — {ev.title || ev.client_name} ({ev.status})
              </option>
            ))}
          </select>
          <Link
            href={tenantPath(locale, tenantSlug, '/gate')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-bold hover:border-amber-500 dark:border-slate-700"
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>{tr('ماسح البوابة', 'Gate Scanner')}</span>
          </Link>
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

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 text-xs dark:border-slate-800">
        {(
          [
            { id: 'READINESS', icon: ClipboardCheck, ar: 'جاهزية الأمن والقاعة', en: 'Hall Readiness & Remarks' },
            {
              id: 'PASSES',
              icon: Shield,
              ar: `التصاريح والزوار (${secData?.stats.total ?? 0})`,
              en: `Clearances & Passes (${secData?.stats.total ?? 0})`,
            },
            {
              id: 'DEPOSIT_CLOSE',
              icon: Lock,
              ar: 'التأمين المسترد وإغلاق التشغيل',
              en: 'Security Deposit & Close Operation',
            },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-bold ${
                active
                  ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                  : 'border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tr(t.ar, t.en)}</span>
            </button>
          );
        })}
      </div>

      {/* SUBTAB 1: HALL SECURITY READINESS */}
      {subTab === 'READINESS' && secData && (
        <div className="space-y-4 text-xs">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-semibold">{tr('حالة الجاهزية الأمنية', 'Security Status')}</label>
              <select
                value={secStatus}
                onChange={(e) => setSecStatus(e.target.value as typeof secStatus)}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-bold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="DRAFT">DRAFT</option>
                <option value="PENDING_REVIEW">PENDING_REVIEW</option>
                <option value="CLEARED">CLEARED</option>
                <option value="RETURNED_FOR_AMENDMENT">RETURNED_FOR_AMENDMENT</option>
                <option value="INCIDENT_FLAGGED">INCIDENT_FLAGGED</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold">{tr('عدد الحراس المخصصين', 'Guard Headcount')}</label>
              <input
                type="number"
                min={0}
                value={guardCount}
                onChange={(e) => setGuardCount(e.target.value)}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold">{tr('مسؤول الأمن المناوب', 'Security Lead Name')}</label>
              <input
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                placeholder={tr('اسم المشرف الأمني...', 'Security supervisor...')}
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(checklist).map(([k, val]) => {
              const lbl = READINESS_LABELS[k];
              return (
                <label key={k} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 font-semibold dark:border-slate-800">
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => setChecklist((prev) => ({ ...prev, [k]: e.target.checked }))}
                  />
                  <span>{lbl ? tr(lbl.ar, lbl.en) : k.replace(/_/g, ' ')}</span>
                </label>
              );
            })}
          </div>

          {/* Add Custom "Other" Security Check Item */}
          <div className="flex gap-2">
            <input
              value={customCheckName}
              onChange={(e) => setCustomCheckName(e.target.value)}
              placeholder={tr('إضافة بند فحص أمني مخصص ("أخرى")...', 'Add custom ("Other") security checklist item...')}
              className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={() => {
                const key = customCheckName.trim();
                if (!key) return;
                setChecklist((prev) => ({ ...prev, [key]: true }));
                setCustomCheckName('');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 font-bold text-amber-700 dark:text-amber-300"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{tr('إضافة بند', 'Add Item')}</span>
            </button>
          </div>

          {secData.security_profile.client_remarks && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5">
              <strong>{tr('ملاحظات العميل:', 'Client Security Remarks:')}</strong> {secData.security_profile.client_remarks}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold">{tr('ملاحظات الأمن للقاعة والمنشأة', 'Tenant Security Remarks')}</label>
              <textarea
                rows={2}
                value={tenantRemarks}
                onChange={(e) => setTenantRemarks(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold">{tr('ملاحظات / سبب الإعادة للتعديل', 'Amendment Reason (if returning)')}</label>
              <textarea
                rows={2}
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                placeholder={tr('مطلوب عند إرجاع الملف للعميل للتعديل...', 'Specify required amendments for client...')}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => saveReadiness()}
              className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 font-bold text-slate-950"
            >
              {tr('حفظ الجاهزية والملاحظات', 'Save Readiness & Remarks')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => saveReadiness('CLEARED')}
              className="min-h-[38px] rounded-lg bg-emerald-600 px-4 font-bold text-white"
            >
              {tr('اعتماد الجاهزية الأمنية', 'Mark CLEARED')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => saveReadiness('RETURNED_FOR_AMENDMENT')}
              className="min-h-[38px] rounded-lg bg-amber-500 px-4 font-bold text-slate-950"
            >
              {tr('إرجاع للعميل للتعديل', 'Return for Amendment')}
            </button>
          </div>
        </div>
      )}

      {/* SUBTAB 2: GATE PASSES & CLEARANCES */}
      {subTab === 'PASSES' && secData && (
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'ALL', label: tr(`الكل (${secData.stats.total})`, `All (${secData.stats.total})`) },
              { id: 'APPROVED', label: tr(`معتمد (${secData.stats.approved})`, `Approved (${secData.stats.approved})`) },
              { id: 'PENDING_APPROVAL', label: tr(`بانتظار الاعتماد (${secData.stats.pending})`, `Pending (${secData.stats.pending})`) },
              { id: 'RETURNED_FOR_AMENDMENT', label: tr(`مرتجع للتعديل (${secData.stats.returned})`, `Returned (${secData.stats.returned})`) },
              { id: 'REVOKED', label: tr(`ملغى (${secData.stats.revoked})`, `Revoked (${secData.stats.revoked})`) },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setPassFilter(pill.id)}
                className={`rounded-full border px-3 py-1 font-bold ${
                  passFilter === pill.id
                    ? 'border-[var(--brand-primary,#D4AF37)] bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Issue Clearance Form */}
          <form onSubmit={issuePass} className="grid gap-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-4">
            <SelectOrOther
              value={newPass.clearance_category}
              onChange={(v) => setNewPass({ ...newPass, clearance_category: v || 'GUEST' })}
              locale={locale}
              allowPromoteCategory="GATE_PASS_TYPE"
              options={[
                { value: 'GUEST', labelAr: 'ضيف (GUEST)', labelEn: 'Guest' },
                { value: 'VIP', labelAr: 'كبار الشخصيات (VIP)', labelEn: 'VIP' },
                { value: 'VENDOR', labelAr: 'مورد / تجهيز (VENDOR)', labelEn: 'Vendor / Crew' },
                { value: 'STAFF', labelAr: 'طاقم عمل (STAFF)', labelEn: 'Staff / Security' },
              ]}
              placeholderAr="نوع التصريح..."
              placeholderEn="Clearance Type..."
              otherPlaceholderAr="تصريح مخصص (مثال: إعلام)..."
              otherPlaceholderEn="Custom type (e.g. Media)..."
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input required value={newPass.holder_name} onChange={(e) => setNewPass({ ...newPass, holder_name: e.target.value })} placeholder={tr('الاسم الكامل لحامل التصريح', 'Holder Full Name')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
            <input dir="ltr" value={newPass.holder_phone} onChange={(e) => setNewPass({ ...newPass, holder_phone: e.target.value })} placeholder={tr('الجوال', 'Phone')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
            <input dir="ltr" value={newPass.holder_id_number} onChange={(e) => setNewPass({ ...newPass, holder_id_number: e.target.value })} placeholder={tr('رقم الهوية / البادج', 'ID / Badge Number')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
            <input value={newPass.organization} onChange={(e) => setNewPass({ ...newPass, organization: e.target.value })} placeholder={tr('الجهة / الشركة الموردة', 'Organization / Vendor')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
            <input dir="ltr" value={newPass.vehicle_plate} onChange={(e) => setNewPass({ ...newPass, vehicle_plate: e.target.value })} placeholder={tr('لوحة المركبة', 'Vehicle Plate')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
            <input value={newPass.remarks} onChange={(e) => setNewPass({ ...newPass, remarks: e.target.value })} placeholder={tr('ملاحظات أمنية...', 'Security remarks...')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
            <button type="submit" disabled={busy} className="min-h-[38px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 font-bold text-slate-950">
              {tr('+ إصدار تصريح معتمد', '+ Issue Approved Pass')}
            </button>
          </form>

          <ResponsiveDataList
            data={filteredPasses}
            locale={locale}
            mobileCardHeader={(p) => `${p.holder_name} (${p.clearance_category})`}
            columns={[
              {
                key: 'holder',
                headerAr: 'حامل التصريح',
                headerEn: 'Holder',
                render: (p) => (
                  <div>
                    <div className="font-bold">{p.holder_name}</div>
                    <div className="text-[11px] text-slate-500">
                      {p.clearance_category} {p.organization ? `· ${p.organization}` : ''} {p.vehicle_plate ? `· [${p.vehicle_plate}]` : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'qr',
                headerAr: 'QR والوضع',
                headerEn: 'QR / Clearance',
                render: (p) => (
                  <div className="space-y-1">
                    <div dir="ltr" className="font-mono text-[11px]">{p.qr_token}</div>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${CLEARANCE_STYLE[p.clearance_status] || ''}`}>
                      {p.clearance_status}{p.is_checked_in ? ' · ✓' : ''}
                    </span>
                  </div>
                ),
              },
              {
                key: 'remarks',
                headerAr: 'ملاحظات قابلة للتعديل',
                headerEn: 'Editable Remarks',
                render: (p) => (
                  <input
                    value={passRemarksMap[p.id] ?? (p.remarks || '')}
                    onChange={(e) => setPassRemarksMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder={tr('أضف ملاحظة...', 'Add remarks...')}
                    className="min-h-[32px] w-full min-w-[140px] rounded border border-slate-300 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-950"
                  />
                ),
              },
              {
                key: 'act',
                headerAr: 'إجراءات التحكم',
                headerEn: 'Actions',
                render: (p) => (
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => actOnPass(p.id, 'APPROVED')} className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">
                      {tr('اعتماد', 'Approve')}
                    </button>
                    <button type="button" onClick={() => actOnPass(p.id, 'RETURNED_FOR_AMENDMENT')} className="rounded bg-amber-500 px-2 py-1 text-[10px] font-bold text-slate-950">
                      {tr('إرجاع للتعديل', 'Return')}
                    </button>
                    <button type="button" onClick={() => actOnPass(p.id, 'REVOKED')} className="rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white">
                      {tr('إلغاء', 'Revoke')}
                    </button>
                    {!p.is_checked_in && p.clearance_status === 'APPROVED' && (
                      <button type="button" onClick={() => actOnPass(p.id, undefined, true)} className="rounded border border-slate-300 px-2 py-1 text-[10px] font-bold dark:border-slate-700">
                        {tr('تسجيل دخول', 'Check In')}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* SUBTAB 3: SECURITY DEPOSIT & CLOSE OPERATION */}
      {subTab === 'DEPOSIT_CLOSE' && depData && (
        <div className="space-y-5 text-xs">
          {/* Operation State & Pre-Close Checklist */}
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold">
                {tr('حالة التشغيل:', 'Operation Status:')}{' '}
                <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-white dark:bg-slate-800">
                  {depData.event.status}
                </span>
                {depData.invoice && (
                  <span className="ms-2 font-mono text-amber-500">
                    {tr('التأمين المحتجز:', 'Deposit:')} {depData.invoice.security_deposit_amount.toLocaleString()} ({depData.invoice.deposit_status})
                  </span>
                )}
              </div>
              {depData.inspection && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono font-bold text-amber-600 dark:text-amber-300">
                  {tr('حالة الفحص:', 'Inspection:')} {depData.inspection.approval_status}
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-5">
              {(
                [
                  { ok: depData.pre_close_checklist.contract_signed, ar: 'العقد موقع', en: 'Contract Signed' },
                  { ok: depData.pre_close_checklist.invoice_settled, ar: 'الفاتورة مسددة', en: 'Invoice Settled' },
                  { ok: depData.pre_close_checklist.security_cleared, ar: 'الجاهزية الأمنية', en: 'Security Cleared' },
                  { ok: depData.pre_close_checklist.inspection_completed, ar: 'الفحص مكتمل', en: 'Inspection Finalized' },
                  { ok: depData.pre_close_checklist.deposit_resolved, ar: 'التأمين مسوى', en: 'Deposit Resolved' },
                ] as const
              ).map((chk) => (
                <div
                  key={chk.en}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-semibold ${
                    chk.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-300 text-slate-500 dark:border-slate-700'
                  }`}
                >
                  {chk.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                  <span>{tr(chk.ar, chk.en)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Checklist + Itemized Security Deposit Deductions */}
          <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="font-bold">{tr('1. فحص ما بعد المناسبة وبنود الخصم التفصيلية', '1. Post-Event Inspection & Itemized Deposit Deductions')}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(inspChecklist).map(([k, val]) => (
                <label key={k} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => setInspChecklist((prev) => ({ ...prev, [k]: e.target.checked }))}
                  />
                  <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-5">
              <SelectOrOther
                value={draftDedCat}
                onChange={setDraftDedCat}
                locale={locale}
                options={[
                  { value: 'EQUIPMENT_DAMAGE', labelAr: 'تلف معدات', labelEn: 'Equipment Damage' },
                  { value: 'DECOR_STAIN', labelAr: 'أضرار ديكور/مفروشات', labelEn: 'Decor / Linen Damage' },
                  { value: 'OVERTIME_FEE', labelAr: 'ساعات إضافية', labelEn: 'Overtime Fee' },
                  { value: 'DEEP_CLEANING', labelAr: 'تنظيف استثنائي', labelEn: 'Extra Cleaning' },
                ]}
                className="min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <input value={draftDedDesc} onChange={(e) => setDraftDedDesc(e.target.value)} placeholder={tr('وصف الضرر أو الخصم...', 'Deduction description...')} className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
              <input type="number" min={0} step="0.01" value={draftDedAmt} onChange={(e) => setDraftDedAmt(e.target.value)} placeholder={tr('المبلغ', 'Amount')} className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono dark:border-slate-700 dark:bg-slate-950" />
              <input value={draftDedRem} onChange={(e) => setDraftDedRem(e.target.value)} placeholder={tr('ملاحظات...', 'Remarks...')} className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
              <button
                type="button"
                onClick={() => {
                  if (!draftDedDesc.trim() || Number(draftDedAmt) <= 0) return;
                  setDeductionItems((prev) => [
                    ...prev,
                    { category: draftDedCat || 'OTHER', description: draftDedDesc.trim(), amount: Number(draftDedAmt), remarks: draftDedRem.trim() },
                  ]);
                  setInspStatus('DAMAGE_CLAIMED');
                  setDraftDedDesc('');
                  setDraftDedAmt('');
                  setDraftDedRem('');
                }}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 font-bold text-amber-700 dark:text-amber-300"
              >
                {tr('+ إضافة خصم', '+ Add Deduction')}
              </button>
            </div>

            {deductionItems.length > 0 && (
              <div className="space-y-1">
                {deductionItems.map((it, idx) => (
                  <div key={`${it.category}-${idx}`} className="flex items-center justify-between rounded bg-slate-100 px-3 py-1.5 dark:bg-slate-900">
                    <span>
                      <strong>[{it.category}]</strong> {it.description} — <span className="font-mono font-bold text-rose-500">{it.amount.toLocaleString()}</span>
                      {it.remarks ? ` (${it.remarks})` : ''}
                    </span>
                    <button type="button" onClick={() => setDeductionItems((prev) => prev.filter((_, i) => i !== idx))} className="text-rose-500 underline">
                      {tr('إزالة', 'Remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold">{tr('نتيجة الفحص', 'Inspection Result')}</label>
                <select value={inspStatus} onChange={(e) => setInspStatus(e.target.value as 'PASSED' | 'DAMAGE_CLAIMED')} className="min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950">
                  <option value="PASSED">{tr('سليم — استرداد كامل التأمين', 'PASSED — Full Refund')}</option>
                  <option value="DAMAGE_CLAIMED">{tr('خصم أضرار من التأمين', 'DAMAGE_CLAIMED — Deduct')}</option>
                </select>
              </div>
              <input value={inspNotes} onChange={(e) => setInspNotes(e.target.value)} placeholder={tr('ملاحظات المشرف القابلة للتعديل...', 'Editable inspector notes...')} className="min-h-[36px] self-end rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
              <input value={inspAmendRemarks} onChange={(e) => setInspAmendRemarks(e.target.value)} placeholder={tr('ملاحظات إرجاع للتعديل...', 'Amendment remarks...')} className="min-h-[36px] self-end rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
            </div>

            {depData.inspection?.client_remarks && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5">
                <strong>{tr('ملاحظات العميل على الفحص:', 'Client Deposit Remarks:')}</strong> {depData.inspection.client_remarks}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="font-mono font-bold">
                {tr('إجمالي الخصم:', 'Total Deduction:')} {totalDeduction.toLocaleString()} ·{' '}
                {tr('صافي المسترد:', 'Refundable:')}{' '}
                {Math.max(0, (depData.invoice?.security_deposit_amount || 0) - totalDeduction).toLocaleString()}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => submitInspectionWorkflow('SUBMIT_FOR_CLIENT_REVIEW')} className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-bold text-sky-600 dark:text-sky-300">
                  {tr('إرسال لمراجعة العميل', 'Send for Client Review')}
                </button>
                <button type="button" disabled={busy} onClick={() => submitInspectionWorkflow('RETURN_FOR_AMENDMENT')} className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950">
                  {tr('إرجاع للتعديل', 'Return for Amendment')}
                </button>
                <button type="button" disabled={busy} onClick={() => submitInspectionWorkflow('FINALIZE')} className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-1.5 font-bold text-slate-950">
                  {tr('اعتماد نهائي وترحيل', 'Finalize Inspection & Post GL')}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2: Refund Remaining Security Deposit */}
          {depData.invoice && depData.invoice.deposit_status !== 'REFUNDED' && depData.invoice.deposit_status !== 'UNPAID' && (
            <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="font-bold">{tr('2. رد المتبقي من التأمين المسترد (2100)', '2. Refund Remaining Security Deposit (Liability 2100)')}</div>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-[180px]">
                  <LookupSelect
                    category="REFUND_METHOD"
                    value={refundMethod}
                    onChange={setRefundMethod}
                    locale={locale}
                    allowOther
                    allowPromote
                    fallbackOptions={[
                      { value: 'KURAIMI_BANK', labelAr: 'بنك الكريمي', labelEn: 'Kuraimi Bank' },
                      { value: 'CASH', labelAr: 'نقدي (CASH)', labelEn: 'Cash' },
                    ]}
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <input value={refundRemarks} onChange={(e) => setRefundRemarks(e.target.value)} placeholder={tr('مرجع وملاحظات الاسترداد...', 'Transfer ref / refund remarks...')} className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
                <button type="button" disabled={busy} onClick={refundDeposit} className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-4 font-bold text-white">
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{tr('تنفيذ رد التأمين', 'Execute Deposit Refund')}</span>
                </button>
              </div>
            </div>
          )}

          {depData.invoice && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-800">
              <button
                type="button"
                onClick={() =>
                  downloadAuthorizedFile(
                    `/api/v1/exports/events/${activeId}/deposit-settlement.pdf?locale=${locale}`,
                    `deposit-settlement-${depData.event.event_code}-${locale}.pdf`
                  )
                }
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 font-semibold dark:border-slate-700 dark:bg-slate-900"
              >
                <FileDown className="h-3.5 w-3.5" />
                <span>{tr('تحميل سند تسوية التأمين PDF', 'Download Deposit Settlement PDF')}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  try {
                    const res = await apiFetch<{ delivery_status: string; whatsapp_url?: string | null }>(
                      `/api/v1/events/${activeId}/share-document`,
                      {
                        method: 'POST',
                        body: { document_type: 'DEPOSIT_SETTLEMENT', channel: 'WHATSAPP', locale },
                      }
                    );
                    setNotice(tr(`تمت مشاركة سند التسوية (${res.delivery_status})`, `Settlement receipt shared (${res.delivery_status})`));
                    if (res.whatsapp_url && typeof window !== 'undefined') {
                      window.open(res.whatsapp_url, '_blank', 'noopener,noreferrer');
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Share failed');
                  }
                }}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 font-bold text-emerald-700 dark:text-emerald-300"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>{tr('مشاركة السند عبر واتساب', 'Share Receipt on WhatsApp')}</span>
              </button>
            </div>
          )}

          {/* Step 3: Close Operation / Reopen Operation */}
          <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center gap-2 font-bold">
              {depData.event.status === 'CLOSED' ? <Lock className="h-4 w-4 text-rose-500" /> : <Unlock className="h-4 w-4 text-amber-500" />}
              <span>{tr('3. إغلاق التشغيل النهائي للفعالية (Close Operation)', '3. Final Close Operation & Audit Lock')}</span>
            </div>

            {depData.event.status === 'CLOSED' ? (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100">
                <div className="flex items-center gap-2 font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{tr('الفعالية مغلقة ومقفلة محاسبياً وأمنياً', 'Operation CLOSED & Locked')}</span>
                </div>
                <div className="text-[11px] text-slate-300">
                  {tr('ملاحظات الإغلاق:', 'Closing Remarks:')} {depData.event.closing_remarks}
                </div>
                <div className="flex gap-2 pt-2">
                  <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder={tr('سبب إعادة الفتح (للمدير/المالك فقط)...', 'Controlled reopen reason (Admin/Owner)...')} className="min-h-[36px] flex-1 rounded border border-slate-700 bg-slate-950 px-3 text-xs text-white" />
                  <button type="button" disabled={busy || reopenReason.trim().length < 2} onClick={reopenOperation} className="rounded bg-amber-500 px-3 font-bold text-slate-950 disabled:opacity-40">
                    {tr('إعادة فتح التشغيل', 'Reopen Operation')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {depData.invoice?.deposit_status === 'HELD' && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{tr('التأمين المسترد ما زال محتجزاً — أتمم تسوية التأمين أو فعّل الإغلاق الاستثنائي للإدارة.', 'Security deposit is still HELD — settle deposit first or use Admin force close.')}</span>
                  </div>
                )}
                <textarea rows={2} value={closingRemarks} onChange={(e) => setClosingRemarks(e.target.value)} placeholder={tr('ملاحظات الإغلاق النهائي وتسليم القاعة...', 'Final closing remarks & handover summary...')} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[11px]">
                    <input type="checkbox" checked={forceClose} onChange={(e) => setForceClose(e.target.checked)} />
                    <span>{tr('إغلاق استثنائي (Admin/Owner فقط حتى مع وجود تأمين HELD)', 'Force close (Admin/Owner override if deposit HELD)')}</span>
                  </label>
                  <button type="button" disabled={busy || closingRemarks.trim().length < 2} onClick={closeOperation} className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-5 font-bold text-white disabled:opacity-40 dark:bg-emerald-600">
                    <Lock className="h-3.5 w-3.5" />
                    <span>{tr('إغلاق التشغيل نهائياً (CLOSED)', 'Close Operation')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </SpotlightCard>
  );
}
