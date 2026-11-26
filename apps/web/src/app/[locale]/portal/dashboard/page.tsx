'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

export default function ClientPortalDashboard() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-5xl space-y-6 p-6 pb-24">
      <SpotlightHeading as="h1" className="text-2xl">
        {isRtl ? 'لوحة تحكم العميل (Client Control Panel)' : 'Client Account Control Panel'}
      </SpotlightHeading>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'ملف العميل والاسترداد' : 'B2C/B2B & Refund Vault'}</div>
          <div className="mt-2 text-sm font-semibold">Kuraimi / Jaib / Jawali / OneCash / IBAN</div>
        </SpotlightCard>
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'تفويض المنظمين وسجل التدقيق' : 'Delegation & Immutable Audit Log'}</div>
          <div className="mt-2 text-sm font-semibold">EVT-2026-1001 — CONFIRMED</div>
        </SpotlightCard>
      </div>
      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
