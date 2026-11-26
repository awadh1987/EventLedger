'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CloudOff, QrCode, RefreshCw, ScanLine } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface QueuedScan {
  mutation_id: string;
  action_type: 'GATE_QR_CHECKIN';
  payload: { qr_token: string };
  recorded_at: string;
}

const QUEUE_KEY = 'el_gate_offline_queue';
const MANIFEST_KEY = 'el_gate_offline_manifest';

export default function SecurityGatePage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [qrToken, setQrToken] = useState('QR-EVT-2026-1001-VIP01');
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [manifestCount, setManifestCount] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) setQueue(JSON.parse(raw));
      const man = localStorage.getItem(MANIFEST_KEY);
      if (man) setManifestCount((JSON.parse(man).gate_passes || []).length);
    } catch {
      // ignore
    }
  }, []);

  const persistQueue = (next: QueuedScan[]) => {
    setQueue(next);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  };

  const syncManifest = async () => {
    const man = await apiFetch<{ gate_passes: unknown[] }>('/api/v1/sync/manifest');
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(man));
    setManifestCount((man.gate_passes || []).length);
    setResultMsg(isRtl ? `تم تحميل ${man.gate_passes.length} تصريح للعمل دون إنترنت` : `Cached ${man.gate_passes.length} gate passes`);
  };

  const flushOfflineQueue = async () => {
    if (queue.length === 0) return;
    const res = await apiFetch<{ processed_count: number }>('/api/v1/sync/batch', {
      method: 'POST',
      body: { device_id: 'web-gate-01', mutations: queue },
    });
    persistQueue([]);
    setResultMsg(isRtl ? `تمت مزامنة ${res.processed_count} عملية` : `Synced ${res.processed_count} offline scans`);
  };

  const verifyToken = async (tokenToScan: string) => {
    const clean = tokenToScan.trim();
    if (!clean) return;
    try {
      const res = await apiFetch<{ result: string; holder_name: string; event_code: string }>(
        '/api/v1/gate/check-in',
        { method: 'POST', body: { qr_token: clean } }
      );
      setResultMsg(`${res.result}: ${res.holder_name} (${res.event_code})`);
    } catch {
      const item: QueuedScan = {
        mutation_id: `scan_${Date.now()}`,
        action_type: 'GATE_QR_CHECKIN',
        payload: { qr_token: clean },
        recorded_at: new Date().toISOString(),
      };
      persistQueue([...queue, item]);
      setResultMsg(isRtl ? `وضع عدم الاتصال: تم حفظ المسح (${clean}) للمزامنة` : `Offline queued: ${clean}`);
    }
  };

  const scanWithCapacitor = async () => {
    const w = window as unknown as { Capacitor?: unknown };
    if (!w.Capacitor) {
      setResultMsg(isRtl ? 'الماسح بالكاميرا متاح في تطبيق الأندرويد (.apk)' : 'Camera scanner is active inside Android .apk');
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
      setResultMsg(err instanceof Error ? err.message : 'Scanner error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <SpotlightHeading as="h1" className="text-2xl">
          <QrCode className="me-2 inline h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
          {isRtl ? 'بوابة الأمن وفحص تصاريح الدخول' : 'Security Gate QR Check-In'}
        </SpotlightHeading>

        <SpotlightCard className="space-y-4">
          <input
            value={qrToken}
            onChange={(e) => setQrToken(e.target.value)}
            placeholder="QR-EVT-..."
            className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="grid grid-cols-2 gap-3">
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
          {resultMsg && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-400">
              {resultMsg}
            </div>
          )}
        </SpotlightCard>

        <SpotlightCard className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <CloudOff className="h-4 w-4 text-amber-500" />
              <span>{isRtl ? `تصاريح مخزنة محلياً: ${manifestCount}` : `Cached Passes: ${manifestCount}`}</span>
            </div>
            <div className="text-slate-500">
              {isRtl ? `عمليات بانتظار المزامنة: ${queue.length}` : `Pending Offline Queue: ${queue.length}`}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={syncManifest} className="min-h-[40px] rounded-lg border border-slate-300 px-3 font-semibold dark:border-slate-700">
              {isRtl ? 'تحديث القائمة' : 'Cache Passes'}
            </button>
            <button type="button" onClick={flushOfflineQueue} className="flex min-h-[40px] items-center gap-1 rounded-lg bg-slate-800 px-3 font-semibold text-white">
              <RefreshCw className="h-3.5 w-3.5" />
              {isRtl ? 'مزامنة' : 'Flush'}
            </button>
          </div>
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="SECURITY_GATE" locale={locale} />
    </div>
  );
}
