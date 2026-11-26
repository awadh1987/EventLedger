'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

export default function ErpDashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-6 p-6 pb-24">
      <SpotlightHeading as="h1" className="text-2xl">
        {isRtl ? 'لوحة عمليات الصالة (Internal Venue ERP)' : 'Internal Venue Operations Hub'}
      </SpotlightHeading>
      <SpotlightCard>
        <div className="text-sm">{isRtl ? 'قصر الماسة للمؤتمرات والأفراح — نظام جاهز للتشغيل' : 'Al-Massa Grand Palace — Active ERP Workspace'}</div>
      </SpotlightCard>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
