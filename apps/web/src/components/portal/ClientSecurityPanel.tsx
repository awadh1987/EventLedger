'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { PortalEvent } from '@/lib/types';

interface ClientSecurityPass {
  id: string;
  clearance_category: string;
  holder_name: string;
  holder_phone: string | null;
  holder_id_number: string | null;
  organization: string | null;
  vehicle_plate: string | null;
  clearance_status: string;
  remarks: string | null;
  qr_token: string;
  is_checked_in: boolean;
}

interface SecurityOverviewClient {
  security_profile: {
    readiness_checklist_json: Record<string, boolean>;
    guard_headcount: number;
    security_lead_name: string | null;
    security_status: string;
    tenant_remarks: string | null;
    client_remarks: string | null;
    amendment_reason: string | null;
  };
  passes: ClientSecurityPass[];
}

interface Props {
  locale: 'ar' | 'en';
  event: PortalEvent;
  onChanged: () => Promise<void> | void;
}

export function ClientSecurityPanel({ locale, event, onChanged }: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [sec, setSec] = useState<SecurityOverviewClient | null>(null);
  const [clientSecRemarks, setClientSecRemarks] = useState('');
  const [reqCat, setReqCat] = useState('VENDOR');
  const [reqName, setReqName] = useState('');
  const [reqPhone, setReqPhone] = useState('');
  const [reqOrg, setReqOrg] = useState('');
  const [reqPlate, setReqPlate] = useState('');
  const [reqRemarks, setReqRemarks] = useState('');
  const [editPassId, setEditPassId] = useState<string | null>(null);

  const [inspClientRemarks, setInspClientRemarks] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSec = useCallback(async () => {
    try {
      const data = await apiFetch<SecurityOverviewClient>(`/api/v1/security/events/${event.id}/overview`);
      setSec(data);
      setClientSecRemarks(data.security_profile.client_remarks || '');
      setInspClientRemarks(event.inspection?.client_remarks || '');
    } catch {
      // ignore if permission restricted
    }
  }, [event.id, event.inspection?.client_remarks]);

  useEffect(() => {
    loadSec();
  }, [loadSec]);

  const saveSecurityRemarks = async (resubmit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/security/events/${event.id}/client-remarks`, {
        method: 'PATCH',
        body: { client_remarks: clientSecRemarks.trim() || null, resubmit },
      });
      setNotice(
        resubmit
          ? tr('تم حفظ ملاحظاتك وإعادة إرسال الملف الأمني للمراجعة.', 'Remarks saved & security profile resubmitted.')
          : tr('تم حفظ ملاحظاتك الأمنية.', 'Security remarks saved.')
      );
      await loadSec();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save remarks');
    } finally {
      setBusy(false);
    }
  };

  const submitPassRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editPassId) {
        await apiFetch(`/api/v1/security/passes/${editPassId}`, {
          method: 'PATCH',
          body: {
            clearance_category: reqCat.trim().toUpperCase(),
            holder_name: reqName.trim(),
            holder_phone: reqPhone.trim() || null,
            organization: reqOrg.trim() || null,
            vehicle_plate: reqPlate.trim() || null,
            remarks: reqRemarks.trim() || null,
            resubmit: true,
          },
        });
        setEditPassId(null);
        setNotice(tr('تم تعديل وإعادة إرسال طلب التصريح.', 'Clearance request amended & resubmitted.'));
      } else {
        await apiFetch(`/api/v1/security/events/${event.id}/passes`, {
          method: 'POST',
          body: {
            clearance_category: reqCat.trim().toUpperCase(),
            holder_name: reqName.trim(),
            holder_phone: reqPhone.trim() || null,
            organization: reqOrg.trim() || null,
            vehicle_plate: reqPlate.trim() || null,
            remarks: reqRemarks.trim() || null,
            require_approval: reqCat !== 'GUEST' && reqCat !== 'VIP',
          },
        });
        setNotice(tr('تم إرسال طلب التصريح الأمني.', 'Clearance pass submitted.'));
      }
      setReqName('');
      setReqPhone('');
      setReqOrg('');
      setReqPlate('');
      setReqRemarks('');
      await loadSec();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit clearance pass');
    } finally {
      setBusy(false);
    }
  };

  const respondInspection = async (decision: 'ACCEPT' | 'RETURN_FOR_AMENDMENT') => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/portal/events/${event.id}/inspection/respond`, {
        method: 'POST',
        body: {
          decision,
          client_remarks: inspClientRemarks.trim() || null,
          amendment_remarks: decision === 'RETURN_FOR_AMENDMENT' ? inspClientRemarks.trim() || null : null,
        },
      });
      setNotice(
        decision === 'ACCEPT'
          ? tr('تم قبول نتيجة فحص التأمين المسترد.', 'Deposit inspection settlement accepted.')
          : tr('تمت إعادة الفحص لإدارة القاعة للتعديل مع الملاحظات.', 'Deposit inspection returned for amendment.')
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to respond to inspection');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Closed Operation Banner */}
      {event.status === 'CLOSED' && (
        <SpotlightCard className="border-slate-500/40 bg-slate-900/90 text-xs text-slate-100">
          <div className="flex items-center gap-2 font-bold text-emerald-400">
            <Lock className="h-4 w-4" />
            <span>{tr('تم إغلاق تشغيل الفعالية رسمياً (CLOSED)', 'Event Operation Officially CLOSED')}</span>
          </div>
          {event.closing_remarks && (
            <p className="mt-1 text-slate-300">
              {tr('ملاحظات الإغلاق:', 'Closing Remarks:')} {event.closing_remarks}
            </p>
          )}
        </SpotlightCard>
      )}

      {/* Client Deposit Inspection Review & Return-for-Amendment */}
      {event.inspection && (
        <SpotlightCard className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SpotlightHeading as="h3" className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('فحص ما بعد المناسبة وتسوية التأمين المسترد', 'Post-Event Security Deposit Inspection')}</span>
            </SpotlightHeading>
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono font-bold text-amber-500">
              {event.inspection.status} · {event.inspection.approval_status}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
              <div>{tr('إجمالي الخصم المقترح:', 'Deduction Amount:')} <strong className="font-mono text-rose-500">{event.inspection.deduction_amount.toLocaleString()}</strong></div>
              {event.inspection.notes && <div className="mt-1 text-slate-500">{event.inspection.notes}</div>}
            </div>
            {event.inspection.deduction_items.length > 0 && (
              <div className="space-y-1 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                {event.inspection.deduction_items.map((it, idx) => (
                  <div key={`${it.category}-${idx}`} className="flex justify-between">
                    <span>{it.description}</span>
                    <span className="font-mono">{Number(it.amount).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={inspClientRemarks}
              onChange={(e) => setInspClientRemarks(e.target.value)}
              placeholder={tr('أدخل ملاحظاتك على الفحص أو سبب طلب التعديل...', 'Your remarks or amendment request...')}
              className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            />
            <button type="button" disabled={busy} onClick={() => respondInspection('ACCEPT')} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">
              {tr('موافقة على التسوية', 'Accept')}
            </button>
            <button type="button" disabled={busy} onClick={() => respondInspection('RETURN_FOR_AMENDMENT')} className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950">
              {tr('إرجاع للتعديل', 'Return for Amendment')}
            </button>
          </div>
        </SpotlightCard>
      )}

      {/* Events & Halls Security Clearance Card */}
      <SpotlightCard className="space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SpotlightHeading as="h3" className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
            <span>{tr('أمن الفعالية والقاعة وتصاريح الموردين ("أخرى")', 'Event & Hall Security Clearances & Remarks')}</span>
          </SpotlightHeading>
          {sec && (
            <span className="rounded-full bg-slate-900 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-400">
              {sec.security_profile.security_status} · {sec.security_profile.guard_headcount} {tr('حراس', 'guards')}
            </span>
          )}
        </div>

        {notice && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-semibold text-emerald-600 dark:text-emerald-300">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-semibold text-rose-500">
            {error}
          </div>
        )}

        {sec && (
          <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            {sec.security_profile.tenant_remarks && (
              <div><strong>{tr('ملاحظات إدارة الأمن:', 'Tenant Security Remarks:')}</strong> {sec.security_profile.tenant_remarks}</div>
            )}
            {sec.security_profile.amendment_reason && (
              <div className="rounded bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                <strong>{tr('مطلوب تعديله من أمن القاعة:', 'Amendment Requested:')}</strong> {sec.security_profile.amendment_reason}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                value={clientSecRemarks}
                onChange={(e) => setClientSecRemarks(e.target.value)}
                placeholder={tr('أضف ملاحظاتك الأمنية أو تفاصيل طاقم التصوير والموردين...', 'Add client security remarks...')}
                className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <button type="button" disabled={busy} onClick={() => saveSecurityRemarks(false)} className="rounded-lg border border-slate-300 px-3 font-bold dark:border-slate-700">
                {tr('حفظ الملاحظات', 'Save Remarks')}
              </button>
              <button type="button" disabled={busy} onClick={() => saveSecurityRemarks(true)} className="inline-flex items-center gap-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 font-bold text-slate-950">
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{tr('إرسال للمراجعة', 'Resubmit to Security')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Request / Amend Vendor or Custom Clearance Pass */}
        <form onSubmit={submitPassRequest} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectOrOther
            value={reqCat}
            onChange={(v) => setReqCat(v || 'VENDOR')}
            locale={locale}
            options={[
              { value: 'VENDOR', labelAr: 'مورد / ديكور (VENDOR)', labelEn: 'Vendor' },
              { value: 'STAFF', labelAr: 'طاقم خاص (STAFF)', labelEn: 'Crew / Staff' },
              { value: 'VIP', labelAr: 'كبار الشخصيات (VIP)', labelEn: 'VIP' },
            ]}
            className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          <input required value={reqName} onChange={(e) => setReqName(e.target.value)} placeholder={tr('الاسم الكامل', 'Full Name')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
          <input dir="ltr" value={reqPhone} onChange={(e) => setReqPhone(e.target.value)} placeholder={tr('الجوال', 'Phone')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
          <input value={reqOrg} onChange={(e) => setReqOrg(e.target.value)} placeholder={tr('الشركة / الجهة', 'Company / Org')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
          <input value={reqRemarks} onChange={(e) => setReqRemarks(e.target.value)} placeholder={tr('ملاحظات الدخول...', 'Entry remarks...')} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950" />
          <button type="submit" disabled={busy} className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 font-bold text-slate-950">
            <Plus className="h-3.5 w-3.5" />
            <span>{editPassId ? tr('إعادة الإرسال', 'Resubmit') : tr('طلب تصريح', 'Request Pass')}</span>
          </button>
        </form>

        {sec && sec.passes.length > 0 && (
          <div className="space-y-1.5">
            {sec.passes.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <div>
                  <span className="font-bold">{p.holder_name}</span>{' '}
                  <span className="font-mono text-[11px] text-amber-500">[{p.clearance_category}]</span>{' '}
                  {p.organization && <span className="text-slate-500">· {p.organization}</span>}
                  {p.remarks && <div className="text-[11px] text-slate-500">{p.remarks}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-white">{p.clearance_status}</span>
                  {p.clearance_status === 'RETURNED_FOR_AMENDMENT' && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditPassId(p.id);
                        setReqCat(p.clearance_category);
                        setReqName(p.holder_name);
                        setReqPhone(p.holder_phone || '');
                        setReqOrg(p.organization || '');
                        setReqPlate(p.vehicle_plate || '');
                        setReqRemarks(p.remarks || '');
                      }}
                      className="rounded border border-amber-500 px-2 py-0.5 text-[10px] font-bold text-amber-500"
                    >
                      {tr('تعديل وإعادة إرسال', 'Amend')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>
    </div>
  );
}
