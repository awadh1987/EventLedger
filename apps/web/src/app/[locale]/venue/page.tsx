'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowUpRight, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import ThreeMonthBookingEngine from '@/components/booking/ThreeMonthBookingEngine';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, tenantPath } from '@/lib/api';

export default function TenantVenueStorefrontPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const { tenantSlug } = useAuthSession();
  const branding = useTenantBranding();

  const [tenantName, setTenantName] = useState(branding.venueName || 'Venue Storefront');
  const [heroTagline, setHeroTagline] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const heroLogo = mounted ? branding.logoDarkUrl || branding.logoLightUrl : null;

  useEffect(() => {
    let alive = true;
    apiFetch<{
      name: string;
      branding?: { heroTaglineAr?: string | null; heroTaglineEn?: string | null };
    }>(`/api/v1/public/tenants/${tenantSlug}`, { skipAuth: true }, tenantSlug)
      .then((data) => {
        if (!alive) return;
        setTenantName(data.name);
        setHeroTagline(isRtl ? data.branding?.heroTaglineAr || null : data.branding?.heroTaglineEn || null);
      })
      .catch(() => {
        if (alive && branding.venueName) setTenantName(branding.venueName);
      });
    return () => {
      alive = false;
    };
  }, [branding.venueName, isRtl, tenantSlug]);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} title={tenantName} />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6">
        {/* White-Label Tenant Hero */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-start">
          <div className="flex items-start gap-4">
            {heroLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroLogo}
                alt={tenantName}
                className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1 dark:border-slate-800 dark:bg-slate-900"
              />
            )}
            <div className="space-y-2">
              <span
                dir="ltr"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs font-bold text-amber-500 dark:text-amber-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                /{tenantSlug}
              </span>
              <SpotlightHeading as="h1" className="text-start text-2xl sm:text-4xl">
                {tenantName} — {isRtl ? 'واجهة الحجز والتقويم الفوري' : 'Public Booking & Client Storefront'}
              </SpotlightHeading>
              {heroTagline && <p className="text-sm text-slate-600 dark:text-slate-400">{heroTagline}</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={tenantPath(locale, tenantSlug, '/portal/login')}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-bold text-slate-950 shadow"
            >
              <UserRound className="h-4 w-4" />
              <span>{isRtl ? 'دخول / تسجيل العميل' : 'Client Portal Sign In / Register'}</span>
            </Link>
            <Link
              href={tenantPath(locale, tenantSlug, '/portal/dashboard')}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <span>{isRtl ? 'لوحة متابعة حجوزاتي' : 'My Bookings'}</span>
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Storefront Role Clarification Banner */}
        <SpotlightCard className="flex flex-wrap items-center justify-between gap-3 border-amber-500/30 bg-amber-500/5 text-start text-xs">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
            <span>
              {isRtl
                ? 'هذه هي واجهة الحجز العامة وبوابة العملاء الخاصة بالمنشأة. اختر التاريخ المناسب من التقويم لإتمام الحجز.'
                : 'This is the Public Booking & Client Storefront. Select an available date below to start a 48-hour hold or deposit.'}
            </span>
          </div>
          <Link
            href={tenantPath(locale, tenantSlug, '/portal/login')}
            className="font-bold text-[var(--brand-primary,#D4AF37)] hover:underline"
          >
            {isRtl ? 'تسجيل دخول العميل ›' : 'Client Portal Login ›'}
          </Link>
        </SpotlightCard>

        {/* Locked 3-Month Rolling Booking Engine */}
        <ThreeMonthBookingEngine mode="TENANT_STOREFRONT" tenantSlug={tenantSlug} locale={locale} />

        {/* Storefront Footer with Staff ERP Login Link */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>
            {tenantName} · {isRtl ? 'مدعوم بواسطة EventLedger' : 'Powered by EventLedger'}
          </span>
          <Link
            href={tenantPath(locale, tenantSlug, '/staff-login')}
            className="font-semibold text-[var(--brand-primary,#D4AF37)] hover:underline"
          >
            {isRtl ? 'دخول موظفي القاعة ونظام ERP ›' : 'Venue Staff ERP Login ›'}
          </Link>
        </footer>
      </main>

      <MobileBottomNav persona="CLIENT" locale={locale} />
    </div>
  );
}
