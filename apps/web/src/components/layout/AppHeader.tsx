'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Globe, LogIn, LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';

export function AppHeader({ locale = 'ar', title }: { locale?: 'ar' | 'en'; title?: string }) {
  const isRtl = locale === 'ar';
  const pathname = usePathname() || `/${locale}`;
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const branding = useTenantBranding();

  const otherLocale = isRtl ? 'en' : 'ar';
  const switchedPath = pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${otherLocale}`);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/${locale}`} className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-extrabold text-slate-950"
              style={{ backgroundColor: branding.primaryColor || '#D4AF37' }}
            >
              EL
            </span>
            <span className="text-sm sm:text-base">{title || branding.venueName}</span>
          </Link>
          <nav className="hidden items-center gap-4 ps-4 text-xs font-medium text-slate-600 dark:text-slate-300 md:flex">
            <Link href={`/${locale}/portal/dashboard`} className="hover:text-[var(--brand-primary,#D4AF37)]">
              {isRtl ? 'بوابة العميل' : 'Portal'}
            </Link>
            <Link href={`/${locale}/erp/dashboard`} className="hover:text-[var(--brand-primary,#D4AF37)]">
              {isRtl ? 'لوحة الإدارة' : 'ERP'}
            </Link>
            <Link href={`/${locale}/erp/finance/ledger`} className="hover:text-[var(--brand-primary,#D4AF37)]">
              {isRtl ? 'دفتر الأستاذ' : 'Ledger'}
            </Link>
            <Link href={`/${locale}/erp/ops/beo`} className="hover:text-[var(--brand-primary,#D4AF37)]">
              {isRtl ? 'التشغيل BEO' : 'BEO'}
            </Link>
            <Link href={`/${locale}/erp/settings/branding`} className="hover:text-[var(--brand-primary,#D4AF37)]">
              {isRtl ? 'الهوية البصرية' : 'Branding'}
            </Link>
            <Link href={`/${locale}/gate`} className="hover:text-[var(--brand-primary,#D4AF37)]">
              {isRtl ? 'البوابة الأمنية' : 'Gate'}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-[var(--brand-primary)] dark:border-slate-800 dark:text-slate-300"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Link
            href={switchedPath}
            className="flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:border-[var(--brand-primary)] dark:border-slate-800 dark:text-slate-200"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{isRtl ? 'EN' : 'عربي'}</span>
          </Link>

          {user ? (
            <button
              type="button"
              onClick={logout}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-red-500/60 dark:border-slate-800 dark:text-slate-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{user.full_name}</span>
            </button>
          ) : (
            <Link
              href={`/${locale}/login`}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>{isRtl ? 'دخول' : 'Sign In'}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
