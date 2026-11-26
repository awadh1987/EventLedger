'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { TenantBrandingStudio } from '@/components/erp/TenantBrandingStudio';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function ErpBrandingSettingsPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/${locale}/dashboard`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <BackIcon className="h-3.5 w-3.5" />
              <span>{isRtl ? 'لوحة العمليات' : 'ERP Console'}</span>
            </Link>
            <SpotlightHeading as="h1" className="text-lg">
              {isRtl ? 'تخصيص الهوية البصرية والعلامة التجارية' : 'White-Label Tenant Branding Customizer'}
            </SpotlightHeading>
          </div>
          <Link
            href={`/${locale === 'ar' ? 'en' : 'ar'}/erp/settings/branding`}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            {isRtl ? 'English' : 'العربية'}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        <TenantBrandingStudio locale={locale} />
      </main>

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
