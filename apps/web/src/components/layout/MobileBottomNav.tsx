'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Building2, Calendar, ClipboardList, LayoutGrid, Menu, QrCode, UtensilsCrossed } from 'lucide-react';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';
import { useAuthSession } from '@/components/providers/auth-provider';
import { getActiveTenantSlug, tenantPath } from '@/lib/api';

export type MobileNavPersona = 'CLIENT' | 'ERP_STAFF' | 'SECURITY_GATE';

const TABS = {
  CLIENT: [
    { href: '/portal/dashboard', labelAr: 'بوابتي', labelEn: 'Portal', icon: LayoutGrid },
    { href: '/venue', labelAr: 'احجز قاعة', labelEn: 'Venues', icon: Building2 },
    { href: '/portal/dashboard?tab=PROFILE_VAULT', guestHref: '/portal/login', labelAr: 'الحساب', labelEn: 'Account', icon: ClipboardList },
  ],
  ERP_STAFF: [
    { href: '/erp/dashboard', labelAr: 'التحكم', labelEn: 'ERP', icon: Calendar },
    { href: '/erp/finance/ledger', labelAr: 'الأستاذ', labelEn: 'Ledger', icon: BookOpen },
    { href: '/erp/ops/beo', labelAr: 'التشغيل', labelEn: 'BEO', icon: UtensilsCrossed },
    { href: '/gate', labelAr: 'البوابة', labelEn: 'Gate', icon: QrCode },
  ],
  SECURITY_GATE: [
    { href: '/gate', labelAr: 'ماسح QR', labelEn: 'Scan QR', icon: QrCode },
    { href: '/erp/ops/beo', labelAr: 'الفعاليات', labelEn: 'BEO', icon: ClipboardList },
  ],
};

export function MobileBottomNav({ persona, locale = 'ar' }: { persona: MobileNavPersona; locale?: 'ar' | 'en' }) {
  const pathname = usePathname() || `/${locale}`;
  const isRtl = locale === 'ar';
  const { user, tenantSlug } = useAuthSession();
  const { setMobileDrawerOpen } = useNavigationHistory();

  const pathSlug = pathname.match(/^\/(?:ar|en)\/t\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || '';
  const activeSlug = pathSlug || tenantSlug || getActiveTenantSlug();
  const relPath = pathname.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';

  return (
    <nav
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
    >
      <div className="flex h-16 items-center justify-around px-2">
        {TABS[persona].map((tab) => {
          const targetRoute = 'guestHref' in tab && tab.guestHref && !user ? tab.guestHref : tab.href;
          const fullHref = tenantPath(locale, activeSlug, targetRoute);
          const Icon = tab.icon;
          const bareRoute = targetRoute.split('?')[0];
          const active = relPath === bareRoute || relPath.startsWith(`${bareRoute}/`);
          return (
            <Link
              key={tab.href}
              href={fullHref}
              className={`flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                active ? 'text-[var(--brand-primary,#D4AF37)]' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{isRtl ? tab.labelAr : tab.labelEn}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          className="flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400"
        >
          <Menu className="h-5 w-5" />
          <span>{isRtl ? 'المزيد' : 'More'}</span>
        </button>
      </div>
    </nav>
  );
}
