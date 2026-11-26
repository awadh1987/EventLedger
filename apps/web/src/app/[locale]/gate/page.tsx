'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, CloudOff, QrCode, RefreshCw, ScanLine, Search, XCircle } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch } from '@/lib/api';

interface QueuedScan {
  mutation_id: string;
  action_type: 'GATE_QR_CHECKIN';
  payload: { qr_token: string };
  recorded_at: string;
}

interface ManifestPassRow {
  id: string;
  event_id?: string;
  event_code?: string;
  qr_token: string;
  holder_name: string;
  pass_type: string;
  is_checked_in: boolean;
  checked_in_at?: string | null;
}

const QUEUE_KEY = 'el_gate_offline_queue';
const MANIFEST_KEY = 'el_gate_offline_manifest';

const PASS_BADGE: Record<string, string> = {
  VIP_PASS: 'bg-amber-500/20 text-amber-500 border border-amber-500/40',
  VENDOR_PASS: 'bg-sky-500/20 text-sky-400 border border-sky-500/40',
  GUEST_PASS: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export default function SecurityGatePage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [qrToken, setQrToken] = useState('QR-EVT-2026-1001-VIP01');
  const [validationState, setValidationState] = useState<{
    tone: 'GREEN' | 'RED' | 'AMBER';
    title: string;
    detail: string;
  } | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [passes, setPasses] = useState<ManifestPassRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [passFilter, setPassFilter] = useState<'ALL' | 'VIP_PASS' | 'GUEST_PASS' | 'VENDOR_PASS'>('ALL');

  const syncManifest = useCallback(async (silent = false) => {
    try {
      const man = await apiFetch<{ gate_passes: ManifestPassRow[] }>('/api/v1/sync/manifest');
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(man));
      setPasses(man.gate_passes || []);
      if (!silent) {
        setValidationState({
          tone: 'GREEN',
          title: isRtl ? 'تم تحديث القائمة المحلية' : 'Manifest Synced',
          detail: isRtl
            ? `تم تحميل ${(man.gate_passes || []).length} تصريح للعمل دون إنترنت`
            : `Cached ${(man.gate_passes || []).length} gate passes for offline use`,
        });
      }
    } catch {
      // Offline: keep cached localStorage manifest
    }
  }, [isRtl]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) setQueue(JSON.parse(raw));
      const man = localStorage.getItem(MANIFEST_KEY);
      if (man) setPasses(JSON.parse(man).gate_passes || []);
    } catch {
      // ignore
    }
    syncManifest(true);
  }, [syncManifest]);

  const persistQueue = (next: QueuedScan[]) => {
    setQueue(next);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  };

  const flushOfflineQueue = async () => {
    if (queue.length === 0) return;
    const res = await apiFetch<{ processed_count: number }>('/api/v1/sync/batch', {
      method: 'POST',
      body: { device_id: 'web-gate-01', mutations: queue },
    });
    persistQueue([]);
    setValidationState({
      tone: 'GREEN',
      title: isRtl ? 'تمت المزامنة بنجاح' : 'Offline Queue Flushed',
      detail: isRtl ? `تمت مزامنة ${res.processed_count} عملية` : `Synced ${res.processed_count} offline scans`,
    });
    await syncManifest(true);
  };

  const verifyToken = async (tokenToScan: string) => {
    const clean = tokenToScan.trim();
    if (!clean) return;
    try {
      const res = await apiFetch<{
        result: string;
        holder_name: string;
        pass_type: string;
        event_code: string;
      }>('/api/v1/gate/check-in', { method: 'POST', body: { qr_token: clean } });

      if (res.result === 'ADMITTED') {
        setValidationState({
          tone: 'GREEN',
          title: isRtl ? 'تصريح صالح — تم السماح بالدخول' : 'VALID PASS — ADMITTED',
          detail: `${res.holder_name} · ${res.pass_type} (${res.event_code})`,
        });
        setPasses((prev) =>
          prev.map((p) => (p.qr_token === clean ? { ...p, is_checked_in: true } : p))
        );
      } else {
        setValidationState({
          tone: 'RED',
          title:
            res.result === 'ALREADY_CHECKED_IN'
              ? isRtl
                ? 'تم استخدام هذا التصريح مسبقاً'
                : 'ALREADY CHECKED IN'
              : res.result === 'OUTSIDE_WINDOW'
                ? isRtl
                  ? 'خارج نافذة وقت الفعالية'
                  : 'OUTSIDE VALID WINDOW'
                : isRtl
                  ? 'تصريح غير صالح'
                  : 'INVALID QR PASS',
          detail: res.holder_name ? `${res.holder_name} (${res.event_code})` : clean,
        });
      }
    } catch {
      const item: QueuedScan = {
        mutation_id: `scan_${Date.now()}`,
        action_type: 'GATE_QR_CHECKIN',
        payload: { qr_token: clean },
        recorded_at: new Date().toISOString(),
      };
      persistQueue([...queue, item]);
      setValidationState({
        tone: 'AMBER',
        title: isRtl ? 'وضع عدم الاتصال — محفوظ للمزامنة' : 'OFFLINE QUEUED',
        detail: clean,
      });
    }
  };

  const scanWithCapacitor = async () => {
    const w = window as unknown as { Capacitor?: unknown };
    if (!w.Capacitor) {
      setValidationState({
        tone: 'AMBER',
        title: isRtl ? 'الماسح بالكاميرا' : 'Camera Scanner',
        detail: isRtl ? 'الماسح بالكاميرا متاح في تطبيق الأندرويد (.apk)' : 'Camera scanner is active inside Android .apk',
      });
      return;
    }
    try {
      const modName = '@capacitor-mlkit/barcode-scanning';
      const scannerMod = (await import(/* webpackIgnore: true */ modName)) as {
        BarcodeScanner: { scan: () => Promise<{ barcodes: { rawValue?: string }[] }> };
      };
      const { barcodes } = await scannerMod.BarcodeScanner.scan();
      const raw = barcodes?.[0]?.rawValue;
      if (raw) {
        setQrToken(raw);
        await verifyToken(raw);
      }
    } catch (err) {
      setValidationState({
        tone: 'RED',
        title: 'Scanner Error',
        detail: err instanceof Error ? err.message : 'Scanner error',
      });
    }
  };

  const filteredPasses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return passes.filter((p) => {
      if (passFilter !== 'ALL' && p.pass_type !== passFilter) return false;
      if (!q) return true;
      return (
        p.holder_name.toLowerCase().includes(q) ||
        p.qr_token.toLowerCase().includes(q) ||
        (p.event_code || '').toLowerCase().includes(q)
      );
    });
  }, [passFilter, passes, searchQuery]);

  const badgeLabel = (passType: string) => {
    if (passType === 'VIP_PASS') return isRtl ? 'VIP' : 'VIP';
    if (passType === 'VENDOR_PASS') return isRtl ? 'مورد' : 'Vendor';
    return isRtl ? 'ضيف' : 'Guest';
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <SpotlightHeading as="h1" className="text-start text-2xl">
          <QrCode className="me-2 inline h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
          {isRtl ? 'بوابة الأمن وفحص تصاريح الدخول' : 'Security Gate QR Check-In & Manifest'}
        </SpotlightHeading>

        {/* QR Scanner + Instant Green/Red Feedback */}
        <SpotlightCard className="space-y-4 text-start">
          <div className="grid gap-3 sm:grid-cols-4">
            <input
              dir="ltr"
              value={qrToken}
              onChange={(e) => setQrToken(e.target.value)}
              placeholder="QR-EVT-..."
              className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 sm:col-span-2"
            />
            <button
              type="button"
              onClick={() => verifyToken(qrToken)}
              className="min-h-[48px] rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950"
            >
              {isRtl ? 'تحقق ودخول' : 'Check In'}
            </button>
            <button
              type="button"
              onClick={scanWithCapacitor}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold dark:border-slate-700"
            >
              <ScanLine className="h-4 w-4" />
              {isRtl ? 'مسح بالكاميرا' : 'Scan Camera'}
            </button>
          </div>

          {validationState && (
            <div
              className={`flex items-center gap-3 rounded-xl border p-4 ${
                validationState.tone === 'GREEN'
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                  : validationState.tone === 'RED'
                    ? 'border-rose-500/50 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                    : 'border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-300'
              }`}
            >
              {validationState.tone === 'RED' ? (
                <XCircle className="h-6 w-6 shrink-0" />
              ) : (
                <CheckCircle2 className="h-6 w-6 shrink-0" />
              )}
              <div>
                <div className="text-sm font-extrabold">{validationState.title}</div>
                <div className="font-mono text-xs">{validationState.detail}</div>
              </div>
            </div>
          )}
        </SpotlightCard>

        {/* Offline Sync Controls */}
        <SpotlightCard className="flex flex-wrap items-center justify-between gap-3 text-start text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <CloudOff className="h-4 w-4 text-amber-500" />
              <span>{isRtl ? `تصاريح مخزنة محلياً: ${passes.length}` : `Cached Passes: ${passes.length}`}</span>
            </div>
            <div className="text-slate-500">
              {isRtl ? `عمليات بانتظار المزامنة: ${queue.length}` : `Pending Offline Queue: ${queue.length}`}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => syncManifest(false)}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 font-semibold dark:border-slate-700"
            >
              {isRtl ? 'تحديث القائمة' : 'Refresh Manifest'}
            </button>
            <button
              type="button"
              onClick={flushOfflineQueue}
              className="flex min-h-[40px] items-center gap-1 rounded-lg bg-slate-800 px-3 font-semibold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isRtl ? 'مزامنة' : 'Flush'}
            </button>
          </div>
        </SpotlightCard>

        {/* Searchable Guest & Vendor Manifest */}
        <SpotlightCard className="space-y-4 text-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SpotlightHeading as="h2" className="text-start text-lg">
              {isRtl ? 'بيان الضيوف والموردين (Manifest)' : 'Searchable Guest & Vendor Manifest'}
            </SpotlightHeading>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(['ALL', 'VIP_PASS', 'GUEST_PASS', 'VENDOR_PASS'] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setPassFilter(tier)}
                  className={`rounded-lg px-3 py-1.5 font-bold ${
                    passFilter === tier
                      ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                      : 'border border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {tier === 'ALL' ? (isRtl ? 'الكل' : 'All') : badgeLabel(tier)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isRtl ? 'ابحث باسم الضيف أو رمز QR أو رقم الفعالية...' : 'Search by guest name, QR token, or event code...'}
              className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-white pe-3 ps-9 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <ResponsiveDataList
            data={filteredPasses}
            locale={locale}
            mobileCardHeader={(r) => `${r.holder_name} (${badgeLabel(r.pass_type)})`}
            columns={[
              {
                key: 'holder',
                headerAr: 'الاسم',
                headerEn: 'Holder',
                render: (r) => <span className="font-semibold">{r.holder_name}</span>,
              },
              {
                key: 'badge',
                headerAr: 'الفئة',
                headerEn: 'Type',
                render: (r) => (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${PASS_BADGE[r.pass_type] || PASS_BADGE.GUEST_PASS}`}>
                    {badgeLabel(r.pass_type)}
                  </span>
                ),
              },
              {
                key: 'qr',
                headerAr: 'رمز QR',
                headerEn: 'QR Token',
                render: (r) => <span dir="ltr" className="font-mono text-xs">{r.qr_token}</span>,
              },
              {
                key: 'status',
                headerAr: 'الحالة',
                headerEn: 'Status',
                render: (r) => (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      r.is_checked_in
                        ? 'bg-emerald-500/20 text-emerald-500'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {r.is_checked_in ? (isRtl ? 'تم الدخول ✓' : 'Checked In ✓') : isRtl ? 'بانتظار الوصول' : 'Pending'}
                  </span>
                ),
              },
              {
                key: 'action',
                headerAr: 'تحقق',
                headerEn: 'Action',
                render: (r) => (
                  <button
                    type="button"
                    onClick={() => {
                      setQrToken(r.qr_token);
                      verifyToken(r.qr_token);
                    }}
                    className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 py-1 text-xs font-bold text-slate-950"
                  >
                    {isRtl ? 'دخول' : 'Check In'}
                  </button>
                ),
              },
            ]}
          />
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="SECURITY_GATE" locale={locale} />
    </div>
  );
}
