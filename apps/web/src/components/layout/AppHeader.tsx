'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Building2, Globe, LogIn, LogOut, Moon, Sun, UserCheck } from 'lucide-react';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { tenantPath } from '@/lib/api';

interface NavLinkItem {
  href: string;
  labelAr: string;
  labelEn: string;
}

export function AppHeader({ locale: propLocale, title }: { locale?: 'ar' | 'en'; title?: string }) {
  const [mounted, setMounted] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customSlug, setCustomSlug] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = propLocale || (params?.locale === 'en' ? 'en' : 'ar');
  const isRtl = locale === 'ar';

  const pathname = usePathname() || `/${locale}`;
  const { resolvedTheme, setTheme } = useTheme();
  const branding = useTenantBranding();
  const { user, isAuthenticated, tenantSlug, knownSlugs, switchWorkspace, logout } = useAuthSession();

  const targetLocale = isRtl ? 'en' : 'ar';
  const switchedPath = pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${targetLocale}`);

  const activeSlug = mounted ? tenantSlug : 'almassa';
  const isMarketingRoot = /^\/(ar|en)\/?$/.test(pathname);

  const publicMarketingLinks: NavLinkItem[] = [
    { href: `/${locale}#capabilities`, labelAr: 'القدرات', labelEn: 'Capabilities' },
    { href: `/${locale}#pricing`, labelAr: 'الباقات والأسعار', labelEn: 'Pricing' },
    { href: tenantPath(locale, activeSlug, '/venue'), labelAr: 'حجز القاعات', labelEn: 'Venue Booking' },
    { href: tenantPath(locale, activeSlug, '/erp/dashboard'), labelAr: 'النظام التجريبي ERP', labelEn: 'Live ERP' },
  ];

  const getAuthenticatedLinks = (): NavLinkItem[] => {
    if (!user) return publicMarketingLinks;
    if (user.user_type === 'SUPER_ADMIN') {
      return [
        { href: `/${locale}/admin`, labelAr: 'إدارة المنصة', labelEn: 'Super Admin' },
        { href: tenantPath(locale, activeSlug, '/erp/dashboard'), labelAr: 'لوحة الإدارة', labelEn: 'ERP Hub' },
        { href: tenantPath(locale, activeSlug, '/erp/finance/ledger'), labelAr: 'دفتر الأستاذ', labelEn: 'Ledger' },
        { href: tenantPath(locale, activeSlug, '/venue'), labelAr: 'واجهة القاعة', labelEn: 'Storefront' },
      ];
    }
    if (user.user_type === 'INTERNAL_STAFF') {
      return [
        { href: tenantPath(locale, activeSlug, '/erp/dashboard'), labelAr: 'لوحة الإدارة', labelEn: 'ERP Hub' },
        { href: tenantPath(locale, activeSlug, '/erp/finance/ledger'), labelAr: 'دفتر الأستاذ', labelEn: 'Ledger' },
        { href: tenantPath(locale, activeSlug, '/erp/ops/beo'), labelAr: 'التشغيل BEO', labelEn: 'Live BEO' },
        { href: tenantPath(locale, activeSlug, '/erp/settings/branding'), labelAr: 'الهوية البصرية', labelEn: 'Branding' },
        { href: tenantPath(locale, activeSlug, '/gate'), labelAr: 'البوابة الأمنية', labelEn: 'Gate' },
      ];
    }
    return [
      { href: tenantPath(locale, activeSlug, '/portal/dashboard'), labelAr: 'بوابة العميل', labelEn: 'Client Portal' },
      { href: tenantPath(locale, activeSlug, '/venue'), labelAr: 'حجز القاعات', labelEn: 'Venue Booking' },
    ];
  };

  const navLinks = mounted && isAuthenticated && !isMarketingRoot ? getAuthenticatedLinks() : publicMarketingLinks;
  const roleLabel = user ? user.staff_role || user.user_type : null;

  const handleWorkspaceChange = (value: string) => {
    if (value === '__custom__') {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    switchWorkspace(value, locale);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean.length >= 2) {
      setCustomOpen(false);
      setCustomSlug('');
      switchWorkspace(clean, locale);
    }
  };

  return (
    <header
      dir={isRtl ? 'rtl' : 'ltr'}
      className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={`/${locale}`} className="flex shrink-0 items-center gap-2.5 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-extrabold text-slate-950">
            EL
          </span>
          <span className="text-start text-sm sm:text-base">
            {title || (isRtl ? 'إيفنت ليدجر' : branding.venueName || 'EventLedger')}
          </span>
        </Link>

        <nav className="hidden items-center gap-5 text-xs font-medium text-slate-600 dark:text-slate-300 lg:flex">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap transition hover:text-[var(--brand-primary,#D4AF37)]"
            >
              {isRtl ? item.labelAr : item.labelEn}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Active <slug> Workspace Switcher */}
          <div className="relative hidden items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900 sm:flex">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
            {mounted ? (
              customOpen ? (
                <form onSubmit={handleCustomSubmit} className="flex items-center gap-1">
                  <input
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    placeholder="slug"
                    dir="ltr"
                    className="w-24 rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="submit"
                    className="rounded bg-[var(--brand-primary,#D4AF37)] px-1.5 py-0.5 text-[10px] font-bold text-slate-950"
                  >
                    OK
                  </button>
                </form>
              ) : (
                <select
                  aria-label={isRtl ? 'تبديل مساحة العمل' : 'Switch Workspace'}
                  value={activeSlug}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  dir="ltr"
                  className="bg-transparent pe-1 font-mono text-xs font-semibold text-slate-800 focus:outline-none dark:text-slate-200"
                >
                  {Array.from(new Set([...knownSlugs, activeSlug])).map((s) => (
                    <option key={s} value={s} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                      /{s}
                    </option>
                  ))}
                  <option value="__custom__" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                    {isRtl ? '+ نطاق آخر...' : '+ Other slug...'}
                  </option>
                </select>
              )
            ) : (
              <span dir="ltr" className="pe-1 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                /almassa
              </span>
            )}
          </div>

          {/* Theme Toggle guarded by mounted */}
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {mounted ? (
              resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-slate-700" />
              )
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>

          {/* Locale Switcher */}
          <Link
            href={switchedPath}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{isRtl ? 'EN' : 'عربي'}</span>
          </Link>

          {/* Authenticated User Badge + Logout OR Login */}
          {mounted && user ? (
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 md:flex">
                <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span className="max-w-[120px] truncate font-semibold text-slate-800 dark:text-slate-200">
                  {user.full_name}
                </span>
                {roleLabel && (
                  <span className="rounded bg-[var(--brand-primary,#D4AF37)]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--brand-primary,#D4AF37)]">
                    {roleLabel}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => logout(locale)}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>{isRtl ? 'خروج' : 'Logout'}</span>
              </button>
            </div>
          ) : (
            <Link
              href={`/${locale}/login`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-bold text-slate-950 shadow transition hover:opacity-90"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>{isRtl ? 'دخول' : 'Login'}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
