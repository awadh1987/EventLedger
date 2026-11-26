'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, CheckCircle2, ClipboardList, CreditCard, LayoutGrid, QrCode, Utensils, Wallet } from 'lucide-react';

export type MobileNavPersona = 'CLIENT' | 'ERP_STAFF' | 'SECURITY_GATE';

const TABS = {
  CLIENT: [
    { href: '/portal/dashboard', labelAr: 'الرئيسية', labelEn: 'Home', icon: LayoutGrid },
    { href: '/portal/floor-plan', labelAr: 'القاعة', labelEn: 'Floor Plan', icon: Calendar },
    { href: '/portal/approvals', labelAr: 'الاعتمادات', labelEn: 'Approvals', icon: CheckCircle2 },
    { href: '/portal/payments', labelAr: 'المدفوعات', labelEn: 'Payments', icon: CreditCard },
  ],
  ERP_STAFF: [
    { href: '/erp/dashboard', labelAr: 'الحجوزات', labelEn: 'Events', icon: Calendar },
    { href: '/erp/approvals', labelAr: 'الطلبات', labelEn: 'Queue', icon: CheckCircle2 },
    { href: '/erp/ops/beo', labelAr: 'التشغيل', labelEn: 'Live BEO', icon: Utensils },
    { href: '/erp/finance/ledger', labelAr: 'المالية', labelEn: 'Finance', icon: Wallet },
  ],
  SECURITY_GATE: [
    { href: '/gate/scanner', labelAr: 'ماسح QR', labelEn: 'Scan QR', icon: QrCode },
    { href: '/gate/guest-list', labelAr: 'المدعوين', labelEn: 'Guests', icon: ClipboardList },
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
          const active = pathname?.startsWith(fullHref);
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
