'use client';

import React, { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { FloorPlanElement } from '@/lib/types';

const FloorPlanCanvas = dynamic(
  () => import('@/components/portal/FloorPlanCanvas').then((m) => m.FloorPlanCanvas),
  { ssr: false }
);

function FloorPlanInner() {
  const params = useParams<{ locale: string; id: string }>();
  const searchParams = useSearchParams();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const eventId = params?.id === '_' ? searchParams?.get('id') || '' : params?.id || '';

  const [elements, setElements] = useState<FloorPlanElement[]>([]);
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    apiFetch<{ id: string; draft_type: string; payload: { elements?: FloorPlanElement[] } }[]>(
      `/api/v1/events/${eventId}/drafts`
    )
      .then((drafts) => {
        const fp = drafts.find((d) => d.draft_type === 'FLOOR_PLAN');
        if (fp) {
          setLastDraftId(fp.id);
          setElements(fp.payload?.elements || []);
        }
      })
      .catch(() => undefined);
  }, [eventId]);

  const saveDraft = async (): Promise<string | null> => {
    if (!eventId) return null;
    setSaving(true);
    setNotice(null);
    try {
      const totalSeatedGuests = elements.reduce((acc, el) => acc + (el.seats || 0), 0);
      const res = await apiFetch<{ draft_id: string; version_number: number }>(`/api/v1/events/${eventId}/drafts`, {
        method: 'POST',
        body: {
          draft_type: 'FLOOR_PLAN',
          payload: { elements, totalSeatedGuests },
          financial_delta: 0,
        },
      });
      setLastDraftId(res.draft_id);
      setNotice(isRtl ? `تم حفظ المسودة رقم ${res.version_number}` : `Saved draft v${res.version_number}`);
      return res.draft_id;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const submitApproval = async () => {
    const id = lastDraftId || (await saveDraft());
    if (!id) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ approval_id: string; required_approver_role: string }>(
        `/api/v1/drafts/${id}/submit`,
        { method: 'POST' }
      );
      setNotice(
        isRtl
          ? `تم إرسال المخطط للاعتماد (${res.required_approver_role})`
          : `Submitted for approval (${res.required_approver_role})`
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <SpotlightHeading as="h1" className="text-2xl">
          {isRtl ? 'مصمم مخطط القاعة التفاعلي (Konva)' : 'Interactive Floor Plan Designer'}
        </SpotlightHeading>

        {notice && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-xs text-emerald-400">
            {notice}
          </SpotlightCard>
        )}

        <FloorPlanCanvas
          locale={locale}
          elements={elements}
          onChange={setElements}
          onSaveDraft={saveDraft}
          onSubmitApproval={submitApproval}
          saving={saving}
        />
      </main>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}

export default function EventFloorPlanPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 p-6 text-sm text-slate-400">Loading...</div>}>
      <FloorPlanInner />
    </Suspense>
  );
}
