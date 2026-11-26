'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Calendar, ClipboardList, Home, LayoutGrid, QrCode, UserCheck } from 'lucide-react';

export type MobileNavPersona = 'CLIENT' | 'ERP_STAFF' | 'SECURITY_GATE';

const TABS = {
  CLIENT: [
    { href: '/portal/dashboard', labelAr: 'بوابتي', labelEn: 'Portal', icon: LayoutGrid },
    { href: '/venue', labelAr: 'احجز قاعة', labelEn: 'Book Hall', icon: Building2 },
    { href: '/dashboard', labelAr: 'الإدارة', labelEn: 'ERP', icon: Calendar },
    { href: '', labelAr: 'الرئيسية', labelEn: 'Home', icon: Home },
  ],
  ERP_STAFF: [
    { href: '/dashboard', labelAr: 'التحكم', labelEn: 'Control', icon: Calendar },
    { href: '/venue', labelAr: 'الحجز', labelEn: 'Storefront', icon: Building2 },
    { href: '/portal/dashboard', labelAr: 'العميل', labelEn: 'Portal', icon: UserCheck },
    { href: '', labelAr: 'المنصة', labelEn: 'SaaS', icon: Home },
  ],
  SECURITY_GATE: [
    { href: '/dashboard', labelAr: 'ماسح QR', labelEn: 'Scan QR', icon: QrCode },
    { href: '/portal/dashboard', labelAr: 'التصاريح', labelEn: 'Passes', icon: ClipboardList },
  ],
};

export function MobileBottomNav({ persona, locale = 'ar' }: { persona: MobileNavPersona; locale?: 'ar' | 'en' }) {
  const pathname = usePathname();
  const isRtl = locale === 'ar';
  return (
    <nav dir={isRtl ? 'rtl' : 'ltr'} className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {TABS[persona].map((tab) => {
          const fullHref = `/${locale}${tab.href}`;
          const Icon = tab.icon;
          const active = tab.href === '' ? pathname === fullHref : pathname?.startsWith(fullHref);
          return (
            <Link key={tab.href} href={fullHref} className={`flex min-h-[44px] min-w-[60px] flex-col items-center justify-center gap-1 text-[11px] ${active ? 'text-[var(--brand-primary,#D4AF37)]' : 'text-slate-400'}`}>
              <Icon className="h-5 w-5" />
              <span>{isRtl ? tab.labelAr : tab.labelEn}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
