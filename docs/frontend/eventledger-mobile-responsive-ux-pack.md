# EventLedger (إيفنت ليدجر) — Mobile Responsive UI/UX & Touch Architecture
**Target Surfaces:** Mobile Browsers (iOS/Android), Capacitor Android `.apk` App, Field Tablets (Gate Guards, Floor Supervisors, Head Chefs, Clients & Planners)  
**Localization:** Native Bilingual RTL (`dir="rtl"` Arabic) & LTR (`dir="ltr"` English) with Logical CSS Properties

---

## 1. Core Mobile UX & Touch Design Rules (Enforce Across `apps/web`)

1. **Thumb-Zone Ergonomics & Safe-Area Insets:**
   * All primary mobile navigation lives in a fixed **Bottom Tab Bar** (`h-16 pb-[env(safe-area-inset-bottom)]`) on viewports `< 768px` (`md:hidden`), replacing wide desktop sidebars.
   * All interactive buttons, dropdown triggers, and approval switches MUST meet a minimum **`44px × 44px`** touch target (`min-h-[44px] min-w-[44px]`).
2. **Adaptive Data Presentation (Zero Horizontal Table Scroll):**
   * Desktop financial ledgers, event schedules, and approval queues render as `<table />` on `md:` and above (`hidden md:table`), and automatically transform into **stacked `SpotlightCard` mobile cards** (`block md:hidden`) with swipe-friendly action drawers on phones.
3. **Touch-Friendly Konva Floor Plan (`Pinch-to-Zoom` & `Pan`):**
   * On mobile/tablet viewports, `FloorPlanCanvas.tsx` MUST dynamically fit its stage width via `ResizeObserver` (`width: containerWidth`), enable two-finger pinch-zoom and single-finger stage panning when not dragging a table, and replace tiny hover tooltips with a **Bottom Action Sheet** when a table is tapped.
4. **Hover-Spotlight Adaptation for Touch Devices:**
   * Since phones do not have a continuous mouse cursor, `SpotlightCard` and `SpotlightHeading` trigger their radial brand glow on `onTouchStart` / `onPointerDown` as well as `onMouseMove` so mobile users experience the same illuminated luxury aesthetic.
5. **Local Payment & WhatsApp One-Tap Workflows:**
   * Mobile payment milestone cards include one-tap **Copy Account / IBAN** buttons (for Kuraimi, Jaib, Jawali, OneCash, or Bank Transfer) plus direct **Camera Receipt Capture** (`<input type="file" accept="image/*" capture="environment" />`).

---

## 2. Role-Adaptive Mobile Bottom Navigation (`apps/web/src/components/layout/MobileBottomNav.tsx`)

Automatically renders role-specific thumb-zone tabs for **Clients**, **Internal ERP Staff**, and **Security Gate Guards**:

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar,
  CheckCircle2,
  CreditCard,
  LayoutGrid,
  QrCode,
  Utensils,
  Wallet,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileNavPersona = 'CLIENT' | 'ERP_STAFF' | 'SECURITY_GATE';

interface NavItem {
  href: string;
  labelAr: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

const PERSONA_TABS: Record<MobileNavPersona, NavItem[]> = {
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

export function MobileBottomNav({
  persona,
  locale = 'ar',
  pendingApprovalsCount = 0,
}: {
  persona: MobileNavPersona;
  locale?: 'ar' | 'en';
  pendingApprovalsCount?: number;
}) {
  const pathname = usePathname();
  const isRtl = locale === 'ar';
  const tabs = PERSONA_TABS[persona];

  return (
    <nav
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label={isRtl ? 'التنقل السفلي' : 'Mobile Navigation'}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
    >
      <div className="flex h-16 items-center justify-around px-2">
        {tabs.map((tab) => {
          const fullHref = `/${locale}${tab.href}`;
          const isActive = pathname?.startsWith(fullHref);
          const Icon = tab.icon;
          const showBadge = tab.href.includes('approvals') && pendingApprovalsCount > 0;

          return (
            <Link
              key={tab.href}
              href={fullHref}
              className={cn(
                'relative flex min-h-[44px] min-w-[60px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-[var(--brand-primary)]'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {showBadge && (
                  <span className="absolute -end-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {pendingApprovalsCount}
                  </span>
                )}
              </div>
              <span>{isRtl ? tab.labelAr : tab.labelEn}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

---

## 3. Responsive Data Table / Mobile Card Switcher (`apps/web/src/components/ui/ResponsiveDataList.tsx`)

Ensures financial ledgers, milestone schedules, and approval queues never overflow horizontally on small screens:

```tsx
'use client';

import React from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-elements';

export interface ColumnDef<T> {
  key: string;
  headerAr: string;
  headerEn: string;
  render: (row: T) => React.ReactNode;
  hideOnMobileCard?: boolean;
}

export function ResponsiveDataList<T extends { id: string }>({
  data,
  columns,
  locale = 'ar',
  emptyTextAr = 'لا توجد بيانات لعرضها',
  emptyTextEn = 'No records found',
  mobileCardHeader,
  mobileCardActions,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  locale?: 'ar' | 'en';
  emptyTextAr?: string;
  emptyTextEn?: string;
  mobileCardHeader: (row: T) => React.ReactNode;
  mobileCardActions?: (row: T) => React.ReactNode;
}) {
  const isRtl = locale === 'ar';

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
        {isRtl ? emptyTextAr : emptyTextEn}
      </div>
    );
  }

  return (
    <>
      {/* Desktop & Landscape Tablet Table View */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 md:block">
        <table className="w-full border-collapse text-start text-sm">
          <thead className="bg-slate-100/80 text-xs uppercase text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 font-semibold text-start">
                  {isRtl ? col.headerAr : col.headerEn}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-start">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards View (< 768px) */}
      <div className="space-y-3 md:hidden">
        {data.map((row) => (
          <SpotlightCard key={row.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-200/70 pb-2 dark:border-slate-800">
              <div className="font-semibold">{mobileCardHeader(row)}</div>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              {columns
                .filter((c) => !c.hideOnMobileCard)
                .map((col) => (
                  <div key={col.key} className="space-y-0.5">
                    <dt className="text-slate-500 dark:text-slate-400">
                      {isRtl ? col.headerAr : col.headerEn}
                    </dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {col.render(row)}
                    </dd>
                  </div>
                ))}
            </dl>

            {mobileCardActions && (
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                {mobileCardActions(row)}
              </div>
            )}
          </SpotlightCard>
        ))}
      </div>
    </>
  );
}
```

---

## 4. Mobile Touch Enhancements for Existing Components

Tell your coding agent to apply these exact responsive upgrades to the components in `docs/eventledger-nextjs-frontend-pack.md`:
1. **`SpotlightCard` & `SpotlightHeading`:** Add `onTouchStart` and `onPointerDown` handlers alongside `onMouseMove` so tapping a card or heading on mobile illuminates the brand glow (`--brand-glow`).
2. **`FloorPlanCanvas.tsx`:** Wrap `<Stage>` in a `ResizeObserver` container (`width = containerWidth`, `height = Math.min(460, window.innerHeight * 0.55)`) and add pinch-to-zoom (`onTouchMove` distance delta) + selected-item bottom drawer (`Delete Table`, `Edit Seats`, `Duplicate`) so wedding planners can design layouts comfortably on a phone screen.
3. **Mobile Payment Receipt Upload (`ReceiptCameraUploader`):** Add direct mobile camera capture (`capture="environment"`) and one-tap e-wallet account number copy (`navigator.clipboard.writeText`) on payment milestone cards.

---

## 5. Agent Prompt Extension (Append to Phase 5 / Phase 7)

> *"Read `docs/eventledger-mobile-responsive-ux-pack.md`. Implement `MobileBottomNav.tsx` (with safe-area insets and role-adaptive tabs for `CLIENT`, `ERP_STAFF`, and `SECURITY_GATE`) and `ResponsiveDataList.tsx` across all financial ledgers, event schedules, and approval queues so zero tables overflow horizontally on mobile viewports (`< 768px`). Update `SpotlightCard` to trigger illumination on `onPointerDown`/`onTouchStart`, make `FloorPlanCanvas.tsx` responsive via `ResizeObserver` with pinch-zoom and a mobile bottom action sheet, and enable direct camera capture (`capture="environment"`) for payment receipt uploads."*
