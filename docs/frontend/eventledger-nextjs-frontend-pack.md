# EventLedger (إيفنت ليدجر) — Next.js Frontend Source Pack
**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Shadcn/UI + `next-themes` + `react-konva` + Arabic RTL / English LTR

Drop these components directly into `apps/web/src/components/` and `apps/web/src/middleware.ts`.

---

## 1. Subdomain & Custom Domain Edge Middleware (`apps/web/src/middleware.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const intlMiddleware = createMiddleware({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
});

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000').split(':')[0].toLowerCase();

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const hostname = req.headers.get('host') || '';
  const cleanHost = hostname.split(':')[0].toLowerCase();

  if (
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 1. Apex Root Domain -> SaaS Marketing Landing Page & Self-Onboarding
  if (cleanHost === ROOT_DOMAIN || cleanHost === `www.${ROOT_DOMAIN}` || cleanHost === 'localhost') {
    const res = intlMiddleware(req);
    res.headers.set('x-tenant-mode', 'PLATFORM_ROOT');
    return res;
  }

  // 2. Super-Admin Subdomain -> admin.eventledger.cloud
  if (cleanHost === `admin.${ROOT_DOMAIN}`) {
    const res = intlMiddleware(req);
    res.headers.set('x-tenant-mode', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  // 3. Tenant Subdomain ({slug}.eventledger.cloud) OR Custom Domain
  let tenantIdentifier = cleanHost;
  let identifierType: 'SLUG' | 'CUSTOM_DOMAIN' = 'CUSTOM_DOMAIN';

  if (cleanHost.endsWith(`.${ROOT_DOMAIN}`)) {
    tenantIdentifier = cleanHost.replace(`.${ROOT_DOMAIN}`, '');
    identifierType = 'SLUG';
  }

  const res = intlMiddleware(req);
  res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
  res.headers.set('x-tenant-identifier', tenantIdentifier);
  res.headers.set('x-tenant-identifier-type', identifierType);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
```

---

## 2. White-Label Branding, Dynamic Favicon & Theme Provider (`apps/web/src/components/providers/theme-branding-provider.tsx`)

```tsx
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export interface TenantBrandingConfig {
  tenantName: string;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  enableSpotlight: boolean;
  spotlightColor: string;
}

const DEFAULT_BRANDING: TenantBrandingConfig = {
  tenantName: 'EventLedger | إيفنت ليدجر',
  primaryColor: '#D4AF37',
  accentColor: '#0F172A',
  defaultTheme: 'SYSTEM',
  enableSpotlight: true,
  spotlightColor: 'rgba(212, 175, 55, 0.22)',
};

const BrandingContext = createContext<TenantBrandingConfig>(DEFAULT_BRANDING);

export const useTenantBranding = () => useContext(BrandingContext);

export function ThemeBrandingProvider({
  branding = DEFAULT_BRANDING,
  children,
}: {
  branding?: TenantBrandingConfig;
  children: React.ReactNode;
}) {
  const [config] = useState<TenantBrandingConfig>({ ...DEFAULT_BRANDING, ...branding });

  // Inject CSS variables and dynamic Favicon
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', config.primaryColor);
    root.style.setProperty('--brand-accent', config.accentColor);
    root.style.setProperty('--brand-glow', config.spotlightColor);

    if (config.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = config.faviconUrl;
    }
  }, [config]);

  const initialTheme =
    config.defaultTheme === 'DARK'
      ? 'dark'
      : config.defaultTheme === 'LIGHT'
      ? 'light'
      : 'system';

  return (
    <BrandingContext.Provider value={config}>
      <NextThemesProvider attribute="class" defaultTheme={initialTheme} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
```

---

## 3. Mouse-Tracking Hover-Spotlight Cards & Headings (`apps/web/src/components/ui/spotlight-elements.tsx`)

Illuminates cards, titles, and dropdown containers in both Light and Dark themes as the cursor moves across them:

```tsx
'use client';

import React, { useRef, useState } from 'react';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { cn } from '@/lib/utils';

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function SpotlightCard({ children, className, ...props }: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const branding = useTenantBranding();
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || !branding.enableSpotlight) return;
    const rect = cardRef.current.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/90',
        isHovered && branding.enableSpotlight && 'border-[var(--brand-primary)] shadow-md',
        className
      )}
      {...props}
    >
      {branding.enableSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px rounded-xl transition-opacity duration-300"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(420px circle at ${coords.x}px ${coords.y}px, ${branding.spotlightColor}, transparent 75%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

interface SpotlightHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: 'h1' | 'h2' | 'h3' | 'h4';
  children: React.ReactNode;
}

export function SpotlightHeading({
  as: Tag = 'h2',
  children,
  className,
  ...props
}: SpotlightHeadingProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const branding = useTenantBranding();
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLHeadingElement>) => {
    if (!headingRef.current || !branding.enableSpotlight) return;
    const rect = headingRef.current.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <Tag
      ref={headingRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative inline-block rounded-lg px-2 py-1 font-bold tracking-tight transition-colors duration-200',
        hovered && branding.enableSpotlight && 'text-[var(--brand-primary)]',
        className
      )}
      style={
        hovered && branding.enableSpotlight
          ? {
              background: `radial-gradient(180px circle at ${coords.x}px ${coords.y}px, ${branding.spotlightColor}, transparent 80%)`,
            }
          : undefined
      }
      {...props}
    >
      {children}
    </Tag>
  );
}
```

---

## 4. Konva.js Interactive Floor Plan Designer (`apps/web/src/components/portal/FloorPlanCanvas.tsx`)

Drag-and-drop canvas for Stages/Kosha, VIP Tables, Guest Tables, Buffet Stations, and AV Booths with live guest capacity checks, automatic add-on cost delta calculation, and draft approval submission:

```tsx
'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Circle, Text, Group } from 'react-konva';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export type FloorItemType = 'STAGE_KOSHA' | 'VIP_TABLE' | 'GUEST_TABLE' | 'BUFFET_STATION' | 'AV_BOOTH';

export interface FloorItem {
  id: string;
  type: FloorItemType;
  label: string;
  x: number;
  y: number;
  seats: number;
}

interface FloorPlanCanvasProps {
  eventId: string;
  hallCapacity: number;
  includedTablesQuota: number;
  extraTableUnitPrice: number;
  currency: string;
  locale: 'ar' | 'en';
  isLocked: boolean;
  initialItems?: FloorItem[];
  onSaveDraft: (payload: { items: FloorItem[]; totalSeatedGuests: number }, financialDelta: number) => Promise<void>;
  onSubmitApproval: () => Promise<void>;
}

const ITEM_STYLES: Record<FloorItemType, { color: string; seats: number; ar: string; en: string; isRound: boolean }> = {
  STAGE_KOSHA: { color: '#D4AF37', seats: 2, ar: 'الكوشة / المنصة', en: 'Stage / Kosha', isRound: false },
  VIP_TABLE: { color: '#9333EA', seats: 10, ar: 'طاولة VIP', en: 'VIP Table', isRound: true },
  GUEST_TABLE: { color: '#0284C7', seats: 10, ar: 'طاولة ضيوف', en: 'Guest Table', isRound: true },
  BUFFET_STATION: { color: '#16A34A', seats: 0, ar: 'منصة البوفيه', en: 'Buffet Station', isRound: false },
  AV_BOOTH: { color: '#475569', seats: 0, ar: 'الصوت والإضاءة', en: 'AV / DJ Booth', isRound: false },
};

export function FloorPlanCanvas({
  hallCapacity,
  includedTablesQuota,
  extraTableUnitPrice,
  currency,
  locale,
  isLocked,
  initialItems = [],
  onSaveDraft,
  onSubmitApproval,
}: FloorPlanCanvasProps) {
  const isRtl = locale === 'ar';
  const stageRef = useRef<any>(null);
  const [items, setItems] = useState<FloorItem[]>(initialItems);
  const [saving, setSaving] = useState(false);

  const metrics = useMemo(() => {
    const totalSeatedGuests = items.reduce((acc, item) => acc + item.seats, 0);
    const tableCount = items.filter((i) => i.type === 'VIP_TABLE' || i.type === 'GUEST_TABLE').length;
    const extraTables = Math.max(0, tableCount - includedTablesQuota);
    const financialDelta = extraTables * extraTableUnitPrice;
    const overCapacity = totalSeatedGuests > hallCapacity;
    return { totalSeatedGuests, tableCount, extraTables, financialDelta, overCapacity };
  }, [items, hallCapacity, includedTablesQuota, extraTableUnitPrice]);

  const addItem = (type: FloorItemType) => {
    if (isLocked) return;
    const meta = ITEM_STYLES[type];
    const count = items.filter((i) => i.type === type).length + 1;
    setItems((prev) => [
      ...prev,
      {
        id: `${type}-${Date.now()}`,
        type,
        label: `${isRtl ? meta.ar : meta.en} #${count}`,
        x: 120 + (prev.length % 5) * 95,
        y: 120 + Math.floor(prev.length / 5) * 95,
        seats: meta.seats,
      },
    ]);
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    if (isLocked) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, x, y } : item)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveDraft({ items, totalSeatedGuests: metrics.totalSeatedGuests }, metrics.financialDelta);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SpotlightCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SpotlightHeading as="h3" className="text-lg">
          {isRtl ? 'مخطط توزيع القاعة التفاعلي' : 'Interactive Hall Floor Plan Designer'}
        </SpotlightHeading>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={metrics.overCapacity ? 'font-bold text-red-500' : 'text-slate-600 dark:text-slate-300'}>
            {isRtl
              ? `الضيوف: ${metrics.totalSeatedGuests} / ${hallCapacity}`
              : `Guests: ${metrics.totalSeatedGuests} / ${hallCapacity}`}
          </span>
          <span className="rounded-md bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-600 dark:text-amber-400">
            {isRtl
              ? `تكلفة الطاولات الإضافية: +${metrics.financialDelta.toLocaleString()} ${currency}`
              : `Extra Tables Delta: +${metrics.financialDelta.toLocaleString()} ${currency}`}
          </span>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {isRtl
            ? 'تم إغلاق التعديل المباشر على المخطط لاقتراب موعد المناسبة. لطلب تعديل عاجل يرجى التواصل مع منسق الصالة.'
            : 'Direct floor plan editing is locked due to the pre-event freeze window. Contact your coordinator for urgent changes.'}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ITEM_STYLES) as FloorItemType[]).map((type) => {
          const meta = ITEM_STYLES[type];
          return (
            <button
              key={type}
              type="button"
              disabled={isLocked}
              onClick={() => addItem(type)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:border-[var(--brand-primary)] disabled:opacity-50 dark:border-slate-700"
            >
              + {isRtl ? meta.ar : meta.en}
            </button>
          );
        })}
      </div>

      {/* Konva Canvas */}
      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <Stage ref={stageRef} width={860} height={500}>
          <Layer>
            {items.map((item) => {
              const style = ITEM_STYLES[item.type];
              return (
                <Group
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  draggable={!isLocked}
                  onDragEnd={(e) => handleDragEnd(item.id, e.target.x(), e.target.y())}
                >
                  {style.isRound ? (
                    <Circle radius={34} fill={style.color} opacity={0.88} shadowBlur={6} />
                  ) : (
                    <Rect width={130} height={46} cornerRadius={8} fill={style.color} opacity={0.88} shadowBlur={6} />
                  )}
                  <Text
                    text={item.label}
                    fontSize={11}
                    fill="#FFFFFF"
                    align="center"
                    width={style.isRound ? 68 : 130}
                    offsetX={style.isRound ? 34 : 0}
                    offsetY={style.isRound ? 6 : -16}
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {/* Draft & Approval Actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          disabled={isLocked || saving}
          onClick={handleSave}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {saving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : isRtl ? 'حفظ كمسودة' : 'Save Draft'}
        </button>
        <button
          type="button"
          disabled={isLocked || metrics.overCapacity}
          onClick={onSubmitApproval}
          className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:opacity-50"
        >
          {isRtl ? 'إرسال للاعتماد والمزامنة' : 'Submit for Approval & Sync'}
        </button>
      </div>
    </SpotlightCard>
  );
}
```
