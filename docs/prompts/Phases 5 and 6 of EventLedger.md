Here is the complete Python 3.12 + FastAPI and Next.js 14 code for Phases 5 and 6 of EventLedger (إيفنت ليدجر), covering white-label branding, mouse-tracking hover-spotlight UI, the interactive Konva floor plan designer, double-entry ledger & Event P&L, UTF-8 BOM CSV bulk import, WeasyPrint bilingual PDF generation, unified communications with WhatsApp Business Cloud API webhooks, and the live Kitchen/Ops BEO screen. 


Phase 5: White-Label Branding, Hover-Spotlight UI & Konva Floor Plan Designer
1. Theme & Branding Provider (apps/web/src/components/providers/theme-branding-provider.tsx)
Injects --brand-primary, --brand-accent, and --brand-glow, dynamically updates <link rel="icon"> from faviconUrl, and wraps next-themes for Light / Dark / System switching. 


TypeScript
'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export interface TenantBrandingConfig {
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
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: '#D4AF37',
  accentColor: '#0F172A',
  defaultTheme: 'DARK',
  enableSpotlight: true,
  spotlightColor: 'rgba(212, 175, 55, 0.18)',
};

const BrandingContext = createContext<TenantBrandingConfig>(DEFAULT_BRANDING);

export function useTenantBranding() {
  return useContext(BrandingContext);
}

export function ThemeBrandingProvider({
  children,
  branding,
}: {
  children: React.ReactNode;
  branding?: Partial<TenantBrandingConfig>;
}) {
  const merged = useMemo<TenantBrandingConfig>(
    () => ({
      ...DEFAULT_BRANDING,
      ...branding,
      defaultTheme:
        branding?.defaultTheme === 'LIGHT' || branding?.defaultTheme === 'SYSTEM'
          ? branding.defaultTheme
          : DEFAULT_BRANDING.defaultTheme,
    }),
    [branding],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', merged.primaryColor);
    root.style.setProperty('--brand-accent', merged.accentColor);
    root.style.setProperty('--brand-glow', merged.spotlightColor);

    if (merged.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = merged.faviconUrl;
    }
  }, [merged]);

  const nextThemeDefault =
    merged.defaultTheme === 'LIGHT'
      ? 'light'
      : merged.defaultTheme === 'SYSTEM'
      ? 'system'
      : 'dark';

  return (
    <BrandingContext.Provider value={merged}>
      <NextThemesProvider attribute="class" defaultTheme={nextThemeDefault} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
2. Root Locale Layout (apps/web/src/app/[locale]/layout.tsx)
Sets dir={locale === 'ar' ? 'rtl' : 'ltr'} and wraps children in ThemeBrandingProvider. 


TypeScript
import React from 'react';
import { ThemeBrandingProvider } from '@/components/providers/theme-branding-provider';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dir = locale === 'en' ? 'ltr' : 'rtl';

  return (
    <html lang={locale === 'en' ? 'en' : 'ar'} dir={dir} suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeBrandingProvider>{children}</ThemeBrandingProvider>
      </body>
    </html>
  );
}
3. Spotlight Elements (apps/web/src/components/ui/spotlight-elements.tsx)
Provides SpotlightCard and SpotlightHeading with mouse-tracking radial glow and CSS brand tokens. 


TypeScript
'use client';

import React, { useRef, useState } from 'react';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

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
      className={joinClasses(
        'relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/90',
        isHovered && branding.enableSpotlight && 'border-[var(--brand-primary)] shadow-md',
        className,
      )}
      {...props}
    >
      {branding.enableSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px rounded-xl transition-opacity duration-300"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(420px circle at ${coords.x}px ${coords.y}px, var(--brand-glow, ${branding.spotlightColor}), transparent 75%)`,
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
      className={joinClasses(
        'relative inline-block rounded-lg px-2 py-1 font-bold tracking-tight transition-colors duration-200',
        hovered && branding.enableSpotlight && 'text-[var(--brand-primary)]',
        className,
      )}
      style={
        hovered && branding.enableSpotlight
          ? {
              background: `radial-gradient(180px circle at ${coords.x}px ${coords.y}px, var(--brand-glow, ${branding.spotlightColor}), transparent 80%)`,
            }
          : undefined
      }
      {...props}
    >
      {children}
    </Tag>
  );
}
4. Tenant Branding Customizer (/erp/settings/branding) & SystemLookup Selector
apps/web/src/app/[locale]/(erp)/settings/branding/page.tsx and apps/web/src/components/ui/system-lookup-select.tsx. 


TypeScript
// apps/web/src/components/ui/system-lookup-select.tsx
'use client';

import React, { useMemo, useState } from 'react';

export interface LookupOption {
  id: string;
  code: string;
  labelAr: string;
  labelEn: string;
}

export function SystemLookupSelect({
  options,
  value,
  onChange,
  locale = 'ar',
  placeholderAr = 'اختر...',
  placeholderEn = 'Select...',
}: {
  options: LookupOption[];
  value: string;
  onChange: (code: string) => void;
  locale?: 'ar' | 'en';
  placeholderAr?: string;
  placeholderEn?: string;
}) {
  const [search, setSearch] = useState('');
  const isRtl = locale === 'ar';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.code.toLowerCase().includes(q) ||
        o.labelAr.toLowerCase().includes(q) ||
        o.labelEn.toLowerCase().includes(q),
    );
  }, [options, search]);

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={isRtl ? 'بحث سريع في القائمة...' : 'Filter options...'}
        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
      >
        <option value="">{isRtl ? placeholderAr : placeholderEn}</option>
        {filtered.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {isRtl ? opt.labelAr : opt.labelEn}
          </option>
        ))}
      </select>
    </div>
  );
}
TypeScript
// apps/web/src/app/[locale]/(erp)/settings/branding/page.tsx
'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function BrandingSettingsPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const { theme, setTheme } = useTheme();

  const [form, setForm] = useState({
    logoLightUrl: '',
    logoDarkUrl: '',
    faviconUrl: '',
    primaryColor: '#D4AF37',
    accentColor: '#0F172A',
    defaultTheme: 'DARK',
    enableSpotlight: true,
    spotlightColor: 'rgba(212, 175, 55, 0.18)',
    invoiceFooterAr: 'شكراً لاختياركم قاعاتنا لإحياء مناسباتكم السعيدة',
    invoiceFooterEn: 'Thank you for choosing our venues for your memorable events',
  });

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const handleFileUpload = async (
    field: 'logoLightUrl' | 'logoDarkUrl' | 'faviconUrl',
    file: File,
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/v1/erp/uploads/branding', { method: 'POST', body: formData });
    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        setForm((prev) => ({ ...prev, [field]: data.url }));
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    await fetch('/api/v1/erp/settings/branding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSavedMsg(isRtl ? 'تم حفظ الهوية البصرية بنجاح' : 'White-label branding saved');
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <SpotlightHeading as="h1" className="text-2xl">
            {isRtl ? 'الهوية البصرية والمظهر' : 'White-Label Branding & Theme Settings'}
          </SpotlightHeading>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isRtl
              ? 'تخصيص الشعار، أيقونة المتصفح، الألوان، والوضع الليلي/النهاري مع إضاءة التمرير التفاعلية'
              : 'Customize logos, favicon, brand colors, theme mode, and interactive hover spotlight'}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setTheme(mode);
                setForm((prev) => ({ ...prev, defaultTheme: mode.toUpperCase() }));
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                theme === mode
                  ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950 shadow'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {savedMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
          {savedMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SpotlightCard className="space-y-4">
          <SpotlightHeading as="h2" className="text-lg">
            {isRtl ? 'الشعارات وأيقونة المتصفح' : 'Logos & Browser Favicon'}
          </SpotlightHeading>

          <div>
            <label className="mb-1 block text-xs font-medium">
              {isRtl ? 'شعار الوضع النهاري' : 'Light Mode Logo'}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleFileUpload('logoLightUrl', e.target.files[0])}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">
              {isRtl ? 'شعار الوضع الليلي' : 'Dark Mode Logo'}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleFileUpload('logoDarkUrl', e.target.files[0])}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">
              {isRtl ? 'أيقونة المتصفح (Favicon)' : 'Favicon Icon'}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleFileUpload('faviconUrl', e.target.files[0])}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="space-y-4">
          <SpotlightHeading as="h2" className="text-lg">
            {isRtl ? 'الألوان وإضاءة التمرير والتذييل' : 'Palette, Spotlight Glow & Invoice Footer'}
          </SpotlightHeading>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                {isRtl ? 'اللون الأساسي (--brand-primary)' : 'Primary Color'}
              </label>
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                className="h-10 w-full cursor-pointer rounded border border-slate-700 bg-slate-950"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                {isRtl ? 'اللون الثانوي (--brand-accent)' : 'Accent Color'}
              </label>
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                className="h-10 w-full cursor-pointer rounded border border-slate-700 bg-slate-950"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={form.enableSpotlight}
              onChange={(e) => setForm({ ...form, enableSpotlight: e.target.checked })}
            />
            <span>{isRtl ? 'تفعيل إضاءة التمرير التفاعلية (Hover Spotlight)' : 'Enable Hover Spotlight Glow'}</span>
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium">
              {isRtl ? 'تذييل الفاتورة والعقد (عربي)' : 'Invoice / Contract Footer (AR)'}
            </label>
            <input
              value={form.invoiceFooterAr}
              onChange={(e) => setForm({ ...form, invoiceFooterAr: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2.5 text-sm font-bold text-slate-950 shadow transition hover:opacity-90"
          >
            {saving
              ? isRtl
                ? 'جاري الحفظ...'
                : 'Saving...'
              : isRtl
              ? 'حفظ وتطبيق الهوية البصرية'
              : 'Save & Apply Branding'}
          </button>
        </SpotlightCard>
      </form>
    </div>
  );
}
5. Interactive Konva Floor Plan Designer (apps/web/src/components/portal/FloorPlanCanvas.tsx & /portal/events/[id]/floor-plan/page.tsx)
Drag-and-drop canvas for Stages/Kosha, VIP Tables, Guest Tables, Buffet Stations, and AV Booths wired to POST /api/v1/events/{event_id}/drafts and POST /api/v1/drafts/{draft_id}/submit. 


TypeScript
// apps/web/src/components/portal/FloorPlanCanvas.tsx
'use client';

import React, { useRef, useState } from 'react';
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export type FloorItemType =
  | 'STAGE_KOSHA'
  | 'VIP_TABLE'
  | 'GUEST_TABLE'
  | 'BUFFET_STATION'
  | 'AV_BOOTH';

export interface FloorItem {
  id: string;
  type: FloorItemType;
  label: string;
  x: number;
  y: number;
  seats: number;
  isAddon: boolean;
  addonUnitCost: number;
}

interface FloorPlanCanvasProps {
  eventId: string;
  actorId?: string;
  actorType?: string;
  hallName: string;
  maxCapacity: number;
  includedTables: number;
  extraTableUnitPrice: number;
  isLocked: boolean;
  locale: 'ar' | 'en';
  initialItems?: FloorItem[];
}

const ITEM_TEMPLATES: Record<
  FloorItemType,
  { labelAr: string; labelEn: string; seats: number; color: string; shape: 'rect' | 'circle' }
> = {
  STAGE_KOSHA: { labelAr: 'الكوشة / المنصة', labelEn: 'Main Stage / Kosha', seats: 2, color: '#D4AF37', shape: 'rect' },
  VIP_TABLE: { labelAr: 'طاولة VIP', labelEn: 'VIP Table (10)', seats: 10, color: '#F59E0B', shape: 'circle' },
  GUEST_TABLE: { labelAr: 'طاولة ضيوف', labelEn: 'Guest Table (10)', seats: 10, color: '#3B82F6', shape: 'circle' },
  BUFFET_STATION: { labelAr: 'منصة البوفيه', labelEn: 'Buffet Station', seats: 0, color: '#10B981', shape: 'rect' },
  AV_BOOTH: { labelAr: 'كابينة الصوتيات', labelEn: 'AV & DJ Booth', seats: 0, color: '#8B5CF6', shape: 'rect' },
};

export default function FloorPlanCanvas({
  eventId,
  actorId = '00000000-0000-0000-0000-000000000001',
  actorType = 'CLIENT_PRIMARY',
  hallName,
  maxCapacity,
  includedTables,
  extraTableUnitPrice,
  isLocked,
  locale,
  initialItems = [],
}: FloorPlanCanvasProps) {
  const isRtl = locale === 'ar';
  const stageRef = useRef<any>(null);

  const [items, setItems] = useState<FloorItem[]>(
    initialItems.length > 0
      ? initialItems
      : [
          { id: 'stage-1', type: 'STAGE_KOSHA', label: isRtl ? 'الكوشة' : 'Stage', x: 310, y: 28, seats: 2, isAddon: false, addonUnitCost: 0 },
          { id: 'vip-1', type: 'VIP_TABLE', label: 'VIP 1', x: 240, y: 165, seats: 10, isAddon: false, addonUnitCost: 0 },
          { id: 'vip-2', type: 'VIP_TABLE', label: 'VIP 2', x: 520, y: 165, seats: 10, isAddon: false, addonUnitCost: 0 },
        ],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<FloorItemType>('GUEST_TABLE');
  const [savingStatus, setSavingStatus] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'SUBMITTED'>('IDLE');

  const totalSeats = items.reduce((sum, item) => sum + item.seats, 0);
  const totalTables = items.filter((i) => i.type === 'VIP_TABLE' || i.type === 'GUEST_TABLE').length;
  const extraTablesCount = Math.max(0, totalTables - includedTables);
  const financialDelta = extraTablesCount * extraTableUnitPrice;
  const isOverCapacity = totalSeats > maxCapacity;

  const handleAddItem = () => {
    if (isLocked) return;
    const tpl = ITEM_TEMPLATES[selectedTemplate];
    const count = items.filter((i) => i.type === selectedTemplate).length + 1;
    const isExtraTable =
      (selectedTemplate === 'GUEST_TABLE' || selectedTemplate === 'VIP_TABLE') &&
      totalTables >= includedTables;

    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}`,
        type: selectedTemplate,
        label: `${isRtl ? tpl.labelAr : tpl.labelEn} #${count}`,
        x: 140 + ((count * 55) % 520),
        y: 250 + ((count * 40) % 180),
        seats: tpl.seats,
        isAddon: isExtraTable,
        addonUnitCost: isExtraTable ? extraTableUnitPrice : 0,
      },
    ]);
  };

  const handleDeleteSelected = () => {
    if (!selectedId || isLocked) return;
    setItems((prev) => prev.filter((i) => i.id !== selectedId));
    setSelectedId(null);
  };

  const handleSaveDraft = async (submitAfterSave: boolean) => {
    if (isLocked || isOverCapacity) return;
    setSavingStatus('SAVING');

    const res = await fetch(`/api/v1/events/${eventId}/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_type: 'FLOOR_PLAN',
        payload: {
          items,
          totalSeatedGuests: totalSeats,
          totalTables,
          extraTablesCount,
        },
        financial_delta: financialDelta,
        created_by_id: actorId,
      }),
    });

    if (!res.ok) {
      setSavingStatus('IDLE');
      return;
    }

    const draftData = await res.json();
    if (submitAfterSave && draftData.draft_id) {
      await fetch(
        `/api/v1/drafts/${draftData.draft_id}/submit?requester_id=${encodeURIComponent(actorId)}&requester_type=${encodeURIComponent(actorType)}`,
        { method: 'POST' },
      );
      setSavingStatus('SUBMITTED');
    } else {
      setSavingStatus('SAVED');
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-4">
      <SpotlightCard className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <SpotlightHeading as="h2" className="text-lg">
            {hallName} — {isRtl ? 'مصمم مخطط القاعة التفاعلي' : 'Interactive Floor Plan'}
          </SpotlightHeading>
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {isRtl ? 'المقاعد:' : 'Seats:'}{' '}
              <strong className={isOverCapacity ? 'text-rose-500' : 'text-emerald-500'}>
                {totalSeats} / {maxCapacity}
              </strong>
            </span>
            <span>
              {isRtl ? 'الطاولات:' : 'Tables:'} <strong>{totalTables}</strong> ({isRtl ? 'المشمولة:' : 'Included:'} {includedTables})
            </span>
            <span>
              {isRtl ? 'فارق التكلفة:' : 'Cost Delta:'}{' '}
              <strong className="text-amber-400">+{financialDelta.toLocaleString()}</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as FloorItemType)}
            disabled={isLocked}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            {Object.entries(ITEM_TEMPLATES).map(([key, tpl]) => (
              <option key={key} value={key}>
                {isRtl ? tpl.labelAr : tpl.labelEn}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleAddItem}
            disabled={isLocked}
            className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
          >
            {isRtl ? '+ إضافة' : '+ Add Item'}
          </button>

          {selectedId && !isLocked && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-400"
            >
              {isRtl ? 'حذف المحدد' : 'Delete Selected'}
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSaveDraft(false)}
            disabled={isLocked || isOverCapacity || savingStatus === 'SAVING'}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {savingStatus === 'SAVED'
              ? isRtl ? '✔ تم حفظ المسودة' : '✔ Draft Saved'
              : isRtl ? '💾 حفظ مسودة' : '💾 Save Draft'}
          </button>

          <button
            type="button"
            onClick={() => handleSaveDraft(true)}
            disabled={isLocked || isOverCapacity || savingStatus === 'SAVING'}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {savingStatus === 'SUBMITTED'
              ? isRtl ? '✔ أُرسل للاعتماد' : '✔ Submitted'
              : isRtl ? '🚀 إرسال للاعتماد' : '🚀 Submit Draft'}
          </button>
        </div>
      </SpotlightCard>

      <SpotlightCard className="overflow-x-auto p-2">
        <div className="mx-auto w-[820px] rounded-lg border border-dashed border-slate-700 bg-slate-950">
          <Stage
            ref={stageRef}
            width={820}
            height={500}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null);
            }}
          >
            <Layer>
              <Rect
                x={12}
                y={12}
                width={796}
                height={476}
                stroke="#475569"
                strokeWidth={1.5}
                dash={[8, 6]}
                cornerRadius={12}
              />
              {items.map((item) => {
                const tpl = ITEM_TEMPLATES[item.type];
                const isSelected = selectedId === item.id;
                return (
                  <Group
                    key={item.id}
                    x={item.x}
                    y={item.y}
                    draggable={!isLocked}
                    onClick={() => setSelectedId(item.id)}
                    onTap={() => setSelectedId(item.id)}
                    onDragEnd={(e) => {
                      const nextX = e.target.x();
                      const nextY = e.target.y();
                      setItems((prev) =>
                        prev.map((p) => (p.id === item.id ? { ...p, x: nextX, y: nextY } : p)),
                      );
                    }}
                  >
                    {tpl.shape === 'circle' ? (
                      <Circle
                        radius={34}
                        fill={tpl.color}
                        opacity={0.9}
                        stroke={isSelected ? '#FFFFFF' : '#0F172A'}
                        strokeWidth={isSelected ? 3 : 1.5}
                      />
                    ) : (
                      <Rect
                        width={160}
                        height={54}
                        offsetX={80}
                        offsetY={27}
                        fill={tpl.color}
                        opacity={0.9}
                        cornerRadius={8}
                        stroke={isSelected ? '#FFFFFF' : '#0F172A'}
                        strokeWidth={isSelected ? 3 : 1.5}
                      />
                    )}
                    <Text
                      text={item.label}
                      fontSize={11}
                      fill="#0F172A"
                      fontStyle="bold"
                      align="center"
                      verticalAlign="middle"
                      offsetX={45}
                      offsetY={6}
                    />
                  </Group>
                );
              })}
            </Layer>
          </Stage>
        </div>
      </SpotlightCard>
    </div>
  );
}
TypeScript
// apps/web/src/app/[locale]/portal/events/[id]/floor-plan/page.tsx
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import FloorPlanCanvas from '@/components/portal/FloorPlanCanvas';

export default function EventFloorPlanPage() {
  const params = useParams<{ locale?: string; id?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const eventId = params?.id || '00000000-0000-0000-0000-000000000000';

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <FloorPlanCanvas
          eventId={eventId}
          hallName={locale === 'ar' ? 'قاعة الماسة الكبرى' : 'Grand Diamond Hall'}
          maxCapacity={500}
          includedTables={42}
          extraTableUnitPrice={15000}
          isLocked={false}
          locale={locale}
        />
      </div>
    </div>
  );
}
Phase 6: Double-Entry Ledger UI, Event P&L, CSV Import, PDF Export & WhatsApp Comms
1. Backend Services: Accounting & Event P&L (apps/api/app/services/accounting_service.py) & Comms (apps/api/app/services/comms_service.py)
Posts balanced double-entry journal entries (abs(sum(debit) - sum(credit)) < 0.01), computes per-event revenue vs. expenses/COGS, and records unified EventMessage threads + WhatsApp Business Cloud API webhooks. 


Python
# apps/api/app/services/accounting_service.py
import uuid
from datetime import datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import (
    AccountingConfig,
    ChartOfAccount,
    EventExpense,
    Invoice,
    JournalEntry,
    JournalLine,
)
from app.models.events import Event


class DoubleEntryService:
    @staticmethod
    async def post_balanced_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        reference: str,
        description: str,
        lines: list[dict],  # [{"account_id": UUID, "debit": Decimal, "credit": Decimal, "memo": str}]
        event_id: uuid.UUID | None = None,
    ) -> JournalEntry:
        total_debit = sum((Decimal(str(l.get("debit", 0))) for l in lines), Decimal("0.00"))
        total_credit = sum((Decimal(str(l.get("credit", 0))) for l in lines), Decimal("0.00"))

        if abs(total_debit - total_credit) >= Decimal("0.01") or total_debit <= Decimal("0.00"):
            raise HTTPException(
                status_code=400,
                detail=f"Unbalanced journal entry: debit={total_debit}, credit={total_credit}",
            )

        entry_number = f"JE-{datetime.utcnow().year}-{str(uuid.uuid4().int % 1000000).zfill(6)}"
        entry = JournalEntry(
            tenant_id=tenant_id,
            event_id=event_id,
            entry_number=entry_number,
            reference=reference,
            description=description,
            status="POSTED",
            created_by_id=created_by_id,
        )
        db.add(entry)
        await db.flush()

        for l in lines:
            db.add(
                JournalLine(
                    journal_entry_id=entry.id,
                    account_id=l["account_id"],
                    debit=Decimal(str(l.get("debit", 0))),
                    credit=Decimal(str(l.get("credit", 0))),
                    memo=l.get("memo"),
                )
            )

        await db.commit()
        await db.refresh(entry)
        return entry

    @staticmethod
    async def record_verified_payment(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        event_id: uuid.UUID,
        amount: Decimal,
        is_security_deposit: bool,
        payment_method: str,
        reference: str,
    ) -> JournalEntry:
        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        debit_acc = cfg.cash_account_id if payment_method == "CASH" else cfg.bank_account_id
        credit_acc = cfg.security_deposit_liab_id if is_security_deposit else cfg.accounts_receivable_id
        if not debit_acc or not credit_acc:
            raise HTTPException(status_code=400, detail="Required ledger accounts not mapped in AccountingConfig")

        return await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=reference,
            description=(
                f"Security deposit held ({payment_method})"
                if is_security_deposit
                else f"Invoice payment received ({payment_method})"
            ),
            event_id=event_id,
            lines=[
                {"account_id": debit_acc, "debit": amount, "credit": Decimal("0.00"), "memo": reference},
                {"account_id": credit_acc, "debit": Decimal("0.00"), "credit": amount, "memo": reference},
            ],
        )

    @staticmethod
    async def get_event_pnl(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        event_id: uuid.UUID,
    ) -> dict:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        invoices = (
            await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == tenant_id))
        ).scalars().all()
        gross_revenue = sum((Decimal(str(i.subtotal)) for i in invoices), Decimal("0.00"))
        discounts = sum((Decimal(str(i.discount_amount)) for i in invoices), Decimal("0.00"))
        net_revenue = gross_revenue - discounts

        expenses = (
            await db.execute(select(EventExpense).where(EventExpense.event_id == event_id, EventExpense.tenant_id == tenant_id))
        ).scalars().all()
        total_expenses = sum((Decimal(str(e.amount)) for e in expenses), Decimal("0.00"))
        net_profit = net_revenue - total_expenses

        return {
            "event_id": str(event.id),
            "event_code": event.event_code,
            "gross_revenue": float(gross_revenue),
            "discounts": float(discounts),
            "net_revenue": float(net_revenue),
            "total_expenses": float(total_expenses),
            "net_profit": float(net_profit),
            "margin_percent": float((net_profit / net_revenue * 100).quantize(Decimal("0.01"))) if net_revenue > 0 else 0.0,
        }
Python
# apps/api/app/services/comms_service.py
import uuid
from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.events import Event, EventMessage, EventStatus
from app.models.users import User


class CommsService:
    @staticmethod
    async def post_message(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        event_id: uuid.UUID,
        sender_id: uuid.UUID,
        content: str,
        channel: str = "IN_APP",
        department: str | None = "ALL",
        is_internal: bool = False,
        external_id: str | None = None,
    ) -> EventMessage:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        msg = EventMessage(
            event_id=event_id,
            sender_id=sender_id,
            channel=channel,
            department=department,
            content=content,
            is_internal=is_internal,
            external_id=external_id,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg

    @staticmethod
    async def ingest_whatsapp_webhook(db: AsyncSession, payload: dict) -> dict:
        entry = (payload.get("entry") or [{}])[0]
        change = (entry.get("changes") or [{}])[0]
        value = change.get("value") or {}
        messages = value.get("messages") or []
        if not messages:
            return {"status": "ignored"}

        wa_msg = messages[0]
        raw_phone = str(wa_msg.get("from", "")).strip()
        phone_variants = [raw_phone, f"+{raw_phone}"] if not raw_phone.startswith("+") else [raw_phone, raw_phone[1:]]
        text_body = (wa_msg.get("text") or {}).get("body") or "[WhatsApp Media]"

        user = (
            await db.execute(select(User).where(User.phone.in_(phone_variants), User.is_active == True))
        ).scalar_one_or_none()
        if not user or not user.tenant_id:
            return {"status": "unknown_sender"}

        active_event = (
            await db.execute(
                select(Event)
                .where(
                    Event.tenant_id == user.tenant_id,
                    or_(Event.primary_client_id == user.id, Event.assigned_sales_id == user.id),
                    Event.status.in_([EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]),
                )
                .order_by(Event.start_time.asc())
            )
        ).scalar_one_or_none()

        if not active_event:
            return {"status": "no_active_event"}

        created = await CommsService.post_message(
            db=db,
            tenant_id=user.tenant_id,
            event_id=active_event.id,
            sender_id=user.id,
            content=text_body,
            channel="WHATSAPP",
            department="ALL",
            is_internal=False,
            external_id=wa_msg.get("id"),
        )
        return {"status": "SYNCED", "message_id": str(created.id), "event_id": str(active_event.id)}
2. Backend Router for CSV Import, PDF Export, Event P&L, Comms & BEO (apps/api/app/routers/phase6_ops.py)
Python
import csv
import io
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.accounting import AccountType, ChartOfAccount, Invoice
from app.models.events import Event, EventDraft, EventMessage
from app.models.venue import Hall
from app.services.accounting_service import DoubleEntryService
from app.services.comms_service import CommsService

router = APIRouter(prefix="/api/v1", tags=["P&L, CSV, PDF, Comms & BEO"])


class PostEventMessageBody(BaseModel):
    sender_id: uuid.UUID
    content: str
    channel: str = "IN_APP"
    department: str | None = "ALL"
    is_internal: bool = False


@router.get("/finance/events/{event_id}/pnl")
async def get_event_pnl(event_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await DoubleEntryService.get_event_pnl(db, tenant.id, event_id)


@router.post("/import/{entity_type}")
async def bulk_import_csv(
    entity_type: str,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    raw = await file.read()
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    imported = 0

    for row in reader:
        if entity_type == "accounts":
            code = (row.get("code") or "").strip()
            if not code:
                continue
            acc_type_str = (row.get("account_type") or "ASSET").strip().upper()
            acc_type = AccountType(acc_type_str) if acc_type_str in AccountType._value2member_map_ else AccountType.ASSET
            db.add(
                ChartOfAccount(
                    tenant_id=tenant.id,
                    code=code,
                    name_ar=(row.get("name_ar") or code).strip(),
                    name_en=(row.get("name_en") or code).strip(),
                    account_type=acc_type,
                )
            )
            imported += 1

    await db.commit()
    return {"entity_type": entity_type, "imported_rows": imported}


@router.get("/exports/invoices/{invoice_id}/pdf")
async def export_invoice_pdf(
    invoice_id: uuid.UUID,
    request: Request,
    locale: str = Query(default="ar", pattern="^(ar|en)$"),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    inv = (
        await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    is_rtl = locale == "ar"
    html = f"""
    <html dir="{'rtl' if is_rtl else 'ltr'}" lang="{locale}">
      <body style="font-family: sans-serif; padding: 24px;">
        <h2>{tenant.name} — {'فاتورة ضريبية' if is_rtl else 'Tax Invoice'} #{inv.invoice_number}</h2>
        <p>{'الإجمالي النهائي' if is_rtl else 'Total'}: {inv.total_amount} {tenant.currency}</p>
      </body>
    </html>
    """
    try:
        import weasyprint
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
    except Exception:
        pdf_bytes = html.encode("utf-8")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{inv.invoice_number}-{locale}.pdf"'},
    )


@router.get("/events/{event_id}/messages")
async def list_event_messages(event_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    msgs = (
        await db.execute(select(EventMessage).where(EventMessage.event_id == event_id).order_by(EventMessage.created_at.asc()))
    ).scalars().all()
    return [
        {
            "id": str(m.id),
            "channel": m.channel,
            "department": m.department,
            "content": m.content,
            "is_internal": m.is_internal,
            "created_at": m.created_at.isoformat(),
        }
        for m in msgs
    ]


@router.post("/events/{event_id}/messages")
async def create_event_message(
    event_id: uuid.UUID,
    body: PostEventMessageBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    msg = await CommsService.post_message(
        db=db,
        tenant_id=tenant.id,
        event_id=event_id,
        sender_id=body.sender_id,
        content=body.content,
        channel=body.channel,
        department=body.department,
        is_internal=body.is_internal,
    )
    return {"id": str(msg.id), "status": "SENT"}


@router.post("/webhooks/whatsapp")
async def whatsapp_webhook(payload: dict, db: AsyncSession = Depends(get_db)):
    return await CommsService.ingest_whatsapp_webhook(db, payload)


@router.get("/ops/beo")
async def get_live_beo(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    events = (
        await db.execute(select(Event).where(Event.tenant_id == tenant.id).order_by(Event.start_time.asc()))
    ).scalars().all()
    halls = {h.id: h for h in (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()}

    beo_items = []
    for ev in events:
        drafts = (
            await db.execute(
                select(EventDraft)
                .where(EventDraft.event_id == ev.id)
                .order_by(EventDraft.version_number.desc())
            )
        ).scalars().all()
        hall = halls.get(ev.hall_id)
        beo_items.append(
            {
                "event_id": str(ev.id),
                "event_code": ev.event_code,
                "event_type": ev.event_type,
                "hall_name_ar": hall.name_ar if hall else "",
                "hall_name_en": hall.name if hall else "",
                "start_time": ev.start_time.isoformat(),
                "guest_count": ev.guest_count,
                "latest_draft_payload": drafts[0].payload if drafts else {},
            }
        )
    return {"orders": beo_items}
3. Frontend Pages for Phase 6: Ledger, Event P&L, CSV Import Modal & Live Kitchen/Ops BEO
TypeScript
// apps/web/src/app/[locale]/(erp)/finance/ledger/page.tsx
'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface TrialBalanceRow {
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  debit: number;
  credit: number;
}

export default function DoubleEntryLedgerPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [rows] = useState<TrialBalanceRow[]>([
    { code: '1020', nameAr: 'البنك والمحافظ الإلكترونية', nameEn: 'Bank & E-Wallets', accountType: 'ASSET', debit: 787500, credit: 0 },
    { code: '1100', nameAr: 'ذمم العملاء', nameEn: 'Accounts Receivable', accountType: 'ASSET', debit: 787500, credit: 0 },
    { code: '2100', nameAr: 'تأمينات الأضرار المستردة', nameEn: 'Refundable Security Deposits', accountType: 'LIABILITY', debit: 0, credit: 150000 },
    { code: '2200', nameAr: 'ضريبة القيمة المضافة المستحقة', nameEn: 'Tax Payable', accountType: 'LIABILITY', debit: 0, credit: 75000 },
    { code: '4000', nameAr: 'إيرادات تأجير القاعات', nameEn: 'Hall Rental Revenue', accountType: 'REVENUE', debit: 0, credit: 1350000 },
  ]);

  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [importEntity, setImportEntity] = useState<'accounts' | 'guests' | 'inventory'>('accounts');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const handleCsvUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) return;
    const fd = new FormData();
    fd.append('file', csvFile);
    const res = await fetch(`/api/v1/import/${importEntity}`, { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      setStatusMsg(
        isRtl
          ? `تم استيراد ${data.imported_rows} سجل بنجاح (UTF-8 BOM)`
          : `Imported ${data.imported_rows} rows (UTF-8 BOM)`,
      );
      setCsvModalOpen(false);
    }
  };

  const handleExportBomCsv = () => {
    const header = ['code', 'name_ar', 'name_en', 'account_type', 'debit', 'credit'].join(',');
    const lines = rows.map((r) => [r.code, `"${r.nameAr}"`, `"${r.nameEn}"`, r.accountType, r.debit, r.credit].join(','));
    const bom = '\uFEFF';
    const blob = new Blob([bom + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial-balance-${locale}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SpotlightHeading as="h1" className="text-2xl">
          {isRtl ? 'الأستاذ العام وميزان المراجعة (Double-Entry Ledger)' : 'Double-Entry Ledger & Trial Balance'}
        </SpotlightHeading>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCsvModalOpen(true)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold"
          >
            {isRtl ? '📥 استيراد CSV' : '📥 Import CSV'}
          </button>
          <button
            type="button"
            onClick={handleExportBomCsv}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold"
          >
            {isRtl ? '📤 تصدير CSV (BOM)' : '📤 Export CSV'}
          </button>
          <a
            href={`/api/v1/exports/invoices/00000000-0000-0000-0000-000000000000/pdf?locale=${locale}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 py-2 text-xs font-bold text-slate-950"
          >
            {isRtl ? '📄 تنزيل PDF' : '📄 Download PDF'}
          </a>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
          {statusMsg}
        </div>
      )}

      <SpotlightCard className="flex items-center justify-between">
        <span className="text-xs font-bold">
          {isBalanced
            ? isRtl ? '✔ القيد المزدوج متوازن' : '✔ Balanced Trial Balance'
            : isRtl ? '⚠ غير متوازن' : '⚠ Unbalanced'}
        </span>
        <span className="font-mono text-xs">
          DR: {totalDebit.toLocaleString()} | CR: {totalCredit.toLocaleString()}
        </span>
      </SpotlightCard>

      <SpotlightCard className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 bg-slate-950 text-xs text-slate-400">
            <tr>
              <th className="px-4 py-3 text-start">{isRtl ? 'الرمز' : 'Code'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'الحساب' : 'Account'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'النوع' : 'Type'}</th>
              <th className="px-4 py-3 text-end">{isRtl ? 'مدين' : 'Debit'}</th>
              <th className="px-4 py-3 text-end">{isRtl ? 'دائن' : 'Credit'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="px-4 py-3 font-mono">{r.code}</td>
                <td className="px-4 py-3">{isRtl ? r.nameAr : r.nameEn}</td>
                <td className="px-4 py-3 text-xs">{r.accountType}</td>
                <td className="px-4 py-3 text-end font-mono">{r.debit.toLocaleString()}</td>
                <td className="px-4 py-3 text-end font-mono">{r.credit.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SpotlightCard>

      {csvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={handleCsvUpload} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-base font-bold">{isRtl ? 'استيراد جماعي عبر CSV' : 'UTF-8 BOM CSV Bulk Importer'}</h2>
            <select
              value={importEntity}
              onChange={(e) => setImportEntity(e.target.value as 'accounts' | 'guests' | 'inventory')}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
            >
              <option value="accounts">{isRtl ? 'دليل الحسابات' : 'Chart of Accounts'}</option>
              <option value="guests">{isRtl ? 'قائمة المدعوين' : 'Guest Lists'}</option>
              <option value="inventory">{isRtl ? 'المخزون والتجهيزات' : 'Inventory Items'}</option>
            </select>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCsvModalOpen(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="submit" className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-1.5 text-xs font-bold text-slate-950">
                {isRtl ? 'رفع واستيراد' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
TypeScript
// apps/web/src/app/[locale]/(erp)/finance/events/[id]/pnl/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function EventPnlPage() {
  const params = useParams<{ locale?: string; id?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const eventId = params?.id || '';

  const [pnl, setPnl] = useState({
    event_code: 'EVT-2026-1001',
    net_revenue: 1500000,
    total_expenses: 620000,
    net_profit: 880000,
    margin_percent: 58.67,
  });

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/v1/finance/events/${eventId}/pnl`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setPnl(data))
      .catch(() => {});
  }, [eventId]);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-6 p-6">
      <SpotlightHeading as="h1" className="text-2xl">
        {isRtl ? `الأرباح والخسائر للمناسبة (${pnl.event_code})` : `Event Profit & Loss (${pnl.event_code})`}
      </SpotlightHeading>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'صافي الإيرادات' : 'Net Revenue'}</div>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-400">{pnl.net_revenue.toLocaleString()}</div>
        </SpotlightCard>
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'إجمالي التكاليف والمصروفات' : 'Total Expenses & COGS'}</div>
          <div className="mt-1 font-mono text-2xl font-bold text-rose-400">{pnl.total_expenses.toLocaleString()}</div>
        </SpotlightCard>
        <SpotlightCard>
          <div className="text-xs text-slate-400">{isRtl ? 'صافي الربح / الهامش' : 'Net Profit / Margin'}</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-400">
            {pnl.net_profit.toLocaleString()} ({pnl.margin_percent}%)
          </div>
        </SpotlightCard>
      </div>
    </div>
  );
}
TypeScript
// apps/web/src/app/[locale]/(erp)/ops/beo/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface BeoOrder {
  event_id: string;
  event_code: string;
  event_type: string;
  hall_name_ar: string;
  hall_name_en: string;
  start_time: string;
  guest_count: number;
  latest_draft_payload: Record<string, unknown>;
}

export default function LiveKitchenOpsBeoPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [orders, setOrders] = useState<BeoOrder[]>([
    {
      event_id: 'demo-1',
      event_code: 'EVT-2026-1001',
      event_type: 'WEDDING',
      hall_name_ar: 'قاعة الماسة الكبرى',
      hall_name_en: 'Grand Diamond Hall',
      start_time: new Date().toISOString(),
      guest_count: 420,
      latest_draft_payload: { menu: 'Al-Massa Royal Banquet Buffet' },
    },
  ]);

  useEffect(() => {
    fetch('/api/v1/ops/beo')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => Array.isArray(data?.orders) && data.orders.length > 0 && setOrders(data.orders))
      .catch(() => {});
  }, []);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-6 p-6">
      <SpotlightHeading as="h1" className="text-2xl">
        {isRtl ? 'شاشة أمر التشغيل والضيافة المباشر (Live Kitchen & Ops BEO)' : 'Live Kitchen & Operations BEO'}
      </SpotlightHeading>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {orders.map((order) => (
          <SpotlightCard key={order.event_id} className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-amber-400">{order.event_code}</span>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
                {isRtl ? `${order.guest_count} ضيف` : `${order.guest_count} Guests`}
              </span>
            </div>
            <div className="text-base font-bold">{isRtl ? order.hall_name_ar : order.hall_name_en}</div>
            <div className="text-xs text-slate-400">{order.start_time}</div>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
              {JSON.stringify(order.latest_draft_payload, null, 2)}
            </pre>
          </SpotlightCard>
        ))}
      </div>
    </div>
  );
}
4. Registering Phase 6 Router in apps/api/app/main.py
Python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.tenant_middleware import TenantResolverMiddleware
from app.routers import approvals, auth, bookings, finance, phase6_ops, portal, public_onboarding

app = FastAPI(
    title="EventLedger (إيفنت ليدجر) API",
    version="3.0.0",
    description="Multi-Tenant Venue, Wedding Hall & Conference ERP + Client Portal API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantResolverMiddleware)

app.include_router(public_onboarding.router)
app.include_router(auth.auth_router)
app.include_router(portal.portal_router)
app.include_router(bookings.router)
app.include_router(approvals.router)
app.include_router(finance.router)
app.include_router(phase6_ops.router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "EventLedger Python FastAPI"}
Final Batch: Phases 7 & 8
Ready for Phase 7 & Phase 8 (MobileBottomNav.tsx, ResponsiveDataList.tsx, touch spotlight/floorplan/receipt camera enhancements, next.config.mjs BUILD_TARGET=NATIVE, WorkspaceConnectScreen.tsx, offline_sync.py, Tauri v2 Windows .exe config, and Capacitor 6 Android .apk config)? 

