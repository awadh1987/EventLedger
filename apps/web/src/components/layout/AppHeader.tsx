'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Globe, LogIn, Moon, Sun } from 'lucide-react';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { tenantPath } from '@/lib/api';

interface NavTab {
  key: string;
  href: string;
  labelAr: string;
  labelEn: string;
  /** Path (without locale / tenant prefix) that marks this tab active. */
  match?: RegExp;
  /** Hash that marks a landing-page section tab active. */
  hash?: string;
}

const TENANT_PATH_RE = /^\/(?:ar|en)\/t\/[a-z0-9-]+/i;
const WORKSPACE_PATH_RE = /^\/(?:ar|en)\/(?:venue|portal|erp|gate|staff-login)(?:\/|$)/i;

export function AppHeader({ locale: propLocale, title }: { locale?: 'ar' | 'en'; title?: string }) {
  const [mounted, setMounted] = useState(false);
  const [hash, setHash] = useState('');

  useEffect(() => {
    setMounted(true);
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = propLocale || (params?.locale === 'en' ? 'en' : 'ar');
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const pathname = usePathname() || `/${locale}`;
  const { resolvedTheme, setTheme } = useTheme();
  const branding = useTenantBranding();
  const { user, tenantSlug, logout } = useAuthSession();

  const targetLocale = isRtl ? 'en' : 'ar';
  const switchedPath = pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${targetLocale}`);

  // Context separation: EventLedger platform pages vs. a venue (<slug>) workspace.
  const isTenantCtx = TENANT_PATH_RE.test(pathname) || WORKSPACE_PATH_RE.test(pathname);
  const slug = isTenantCtx ? tenantSlug : null;
  const isStaff = user?.user_type === 'INTERNAL_STAFF' || user?.user_type === 'SUPER_ADMIN';

  // Path relative to the locale + tenant prefix, e.g. "/portal/dashboard".
  const relPath = pathname.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';
  const base = `/${locale}`;

  let tabs: NavTab[];
  if (!isTenantCtx) {
    tabs = [
      { key: 'calendar', href: `${base}#booking-calendar`, labelAr: 'تقويم الحجز لثلاثة أشهر', labelEn: '3-Month Booking Calendar', hash: '#booking-calendar' },
      { key: 'venues', href: `${base}#venues`, labelAr: 'القاعات النشطة', labelEn: 'Active Venues', hash: '#venues' },
      { key: 'experience', href: `${base}#experience`, labelAr: 'لماذا إيفنت ليدجر', labelEn: 'Why EventLedger', hash: '#experience' },
    ];
  } else {
    tabs = [
      { key: 'store', href: tenantPath(locale, slug, '/venue'), labelAr: 'واجهة الحجز', labelEn: 'Booking Storefront', match: /^\/venue(\/|$)/ },
      { key: 'portal', href: tenantPath(locale, slug, '/portal/dashboard'), labelAr: 'بوابة العميل', labelEn: 'Client Portal', match: /^\/portal(\/|$)/ },
      ...(isStaff
        ? [{ key: 'erp', href: tenantPath(locale, slug, '/erp/dashboard'), labelAr: 'لوحة التحكم ERP', labelEn: 'ERP Control Panel', match: /^\/(erp|gate)(\/|$)/ }]
        : []),
      { key: 'home', href: base, labelAr: 'الصفحة الرئيسية للمنصة', labelEn: 'SaaS Home' },
    ];
  }

  const isActive = (tab: NavTab): boolean => {
    if (tab.hash) return relPath === '/' && mounted && hash === tab.hash;
    if (tab.match) return tab.match.test(relPath);
    return false;
  };

  const tenantName = branding.venueName;
  const logoSrc = resolvedTheme === 'dark' ? branding.logoDarkUrl || branding.logoLightUrl : branding.logoLightUrl || branding.logoDarkUrl;

  const brandHref = isTenantCtx ? tenantPath(locale, slug, '/venue') : base;
  const brandLabel = title || (isTenantCtx ? tenantName : tr('إيفنت ليدجر', 'EventLedger'));

  const ctaHref = tenantPath(locale, slug, '/venue');
  const ctaLabel = isStaff ? tr('+ حجز جديد', '+ New Booking') : tr('احجز قاعة', 'Reserve a Hall');
  const signInHref = isTenantCtx ? tenantPath(locale, slug, '/portal/login') : `${base}/login`;
  const signUpHref = isTenantCtx ? `${tenantPath(locale, slug, '/portal/login')}?tab=register` : `${base}/login?tab=register`;

  const tabClass = (active: boolean) =>
    `whitespace-nowrap border-b-2 px-1 py-5 text-xs transition ${
      active
        ? 'border-[var(--brand-primary)] font-semibold text-slate-900 dark:text-white'
        : 'border-transparent font-medium text-slate-600 hover:text-[var(--brand-primary,#D4AF37)] dark:text-slate-300'
    }`;

  const renderTabs = (extra = '') =>
    tabs.map((tab) => {
      const active = isActive(tab);
      return (
        <Link key={tab.key} href={tab.href} aria-current={active ? 'page' : undefined} className={`${tabClass(active)} ${extra}`}>
          {isRtl ? tab.labelAr : tab.labelEn}
        </Link>
      );
    });

  return (
    <header
      dir={isRtl ? 'rtl' : 'ltr'}
      className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={brandHref} className="flex shrink-0 items-center gap-2.5 font-bold">
          {!isTenantCtx ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/brand/eventledger-logo.svg"
              alt="EventLedger"
              className="h-9 w-auto max-w-[170px] object-contain"
            />
          ) : mounted && logoSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt={tenantName} className="h-8 w-auto max-w-[120px] rounded-md object-contain" />
              <span className="max-w-[180px] truncate text-start text-sm sm:text-base">{brandLabel}</span>
            </>
          ) : (
            <>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-extrabold text-slate-950">
                {mounted ? tenantName.trim().charAt(0).toUpperCase() || 'V' : 'EL'}
              </span>
              <span className="max-w-[180px] truncate text-start text-sm sm:text-base">
                {mounted ? brandLabel : 'EventLedger'}
              </span>
            </>
          )}
        </Link>

        <nav className="hidden items-stretch gap-5 lg:flex" aria-label="Primary">
          {renderTabs()}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {mounted ? (
              resolvedTheme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>

          <Link
            href={switchedPath}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{isRtl ? 'EN' : 'عربي'}</span>
          </Link>

          {isTenantCtx && (
            <Link
              href={ctaHref}
              className="hidden h-9 shrink-0 items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-bold text-slate-950 shadow transition hover:opacity-90 sm:inline-flex"
            >
              {ctaLabel}
            </Link>
          )}

          {mounted && user ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 py-1 ps-2.5 pe-1 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="max-w-[140px] truncate font-semibold text-slate-800 dark:text-slate-200">{user.full_name}</span>
              <button
                type="button"
                onClick={() => logout(locale)}
                aria-label={tr('تسجيل الخروج', 'Log out')}
                title={tr('تسجيل الخروج', 'Log out')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-rose-600 transition hover:bg-rose-500/15 dark:text-rose-400"
              >
                ⇥
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href={signInHref}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-800 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:text-white"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>{tr('تسجيل الدخول', 'Sign In')}</span>
              </Link>
              <Link
                href={signUpHref}
                className="inline-flex h-9 shrink-0 items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-bold text-slate-950 shadow transition hover:opacity-90"
              >
                {tr('إنشاء حساب', 'Create Account')}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile / tablet tab strip */}
      <nav className="flex gap-5 overflow-x-auto border-t border-slate-200/60 px-4 dark:border-slate-800/60 lg:hidden" aria-label="Primary mobile">
        {renderTabs('!py-3')}
      </nav>
    </header>
  );
}
