'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileDown, RefreshCw, Send, UtensilsCrossed } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, getAccessToken } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface BeoOrder {
  event_id: string;
  event_code: string;
  event_type: string;
  hall_name: string;
  hall_name_ar: string;
  start_time: string;
  guest_count: number;
  status: string;
  inventory: { item_name: string; quantity: number }[];
  internal_notes: { id: string; department: string | null; content: string }[];
}

export default function LiveBeoPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [orders, setOrders] = useState<BeoOrder[]>([]);
  const [noteByEvent, setNoteByEvent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!getAccessToken()) return;
    try {
      const res = await apiFetch<{ orders: BeoOrder[] }>('/api/v1/ops/beo');
      setOrders(res.orders || []);
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendInternalNote = async (eventId: string) => {
    const content = (noteByEvent[eventId] || '').trim();
    if (!content) return;
    await apiFetch(`/api/v1/events/${eventId}/messages`, {
      method: 'POST',
      body: { content, is_internal: true },
    });
    setNoteByEvent((prev) => ({ ...prev, [eventId]: '' }));
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <SpotlightHeading as="h1" className="text-2xl">
            <UtensilsCrossed className="me-2 inline h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
            {isRtl ? 'أمر تشغيل الفعاليات الحي (Kitchen & Ops BEO)' : 'Live Kitchen & Ops BEO'}
          </SpotlightHeading>
          <button
            type="button"
            onClick={load}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
          >
            <RefreshCw className="h-4 w-4" />
            <span>{isRtl ? 'تحديث' : 'Refresh'}</span>
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {orders.map((ord) => (
            <SpotlightCard key={ord.event_id} className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs text-[var(--brand-primary,#D4AF37)]">{ord.event_code}</div>
                  <h3 className="text-lg font-bold">{isRtl ? ord.hall_name_ar : ord.hall_name}</h3>
                  <p className="text-xs text-slate-500">
                    {ord.start_time.slice(0, 16)} — {ord.guest_count} {isRtl ? 'ضيف' : 'guests'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadAuthorizedFile(
                      `/api/v1/exports/events/${ord.event_id}/beo.pdf?locale=${locale}`,
                      `beo-${ord.event_code}-${locale}.pdf`
                    )
                  }
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950"
                >
                  <FileDown className="h-4 w-4" />
                  BEO PDF
                </button>
              </div>

              {ord.inventory.length > 0 && (
                <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                  <div className="mb-1 font-bold">{isRtl ? 'التجهيزات المعتمدة:' : 'Allocated Equipment:'}</div>
                  {ord.inventory.map((i) => (
                    <div key={i.item_name} className="flex justify-between">
                      <span>{i.item_name}</span>
                      <span className="font-mono font-bold">×{i.quantity}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 text-xs">
                {ord.internal_notes.map((n) => (
                  <div key={n.id} className="rounded bg-amber-500/10 px-2.5 py-1.5 text-amber-300">
                    <span className="font-bold">[{n.department || 'OPS'}]</span> {n.content}
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    value={noteByEvent[ord.event_id] || ''}
                    onChange={(e) => setNoteByEvent((p) => ({ ...p, [ord.event_id]: e.target.value }))}
                    placeholder={isRtl ? 'ملاحظة داخلية (@Kitchen @Ops)...' : 'Internal note (@Kitchen @Ops)...'}
                    className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={() => sendInternalNote(ord.event_id)}
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 dark:border-slate-700"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
