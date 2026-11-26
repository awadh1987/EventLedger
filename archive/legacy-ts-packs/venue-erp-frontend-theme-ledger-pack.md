# Next.js Frontend Pack: Theme & Branding Customizer + Double-Entry Ledger & Trial Balance UI
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Stack:** Next.js 14+ (App Router), Tailwind CSS, Shadcn/UI, `next-themes`, `next-intl` (Arabic RTL / English LTR)  
**Includes:** 
1. `ThemeBrandingProvider` (Dynamic Favicon, CSS Brand Variables, Dark/Light/System Mode, Global Mouse-Tracking Spotlight Illumination).
2. `SpotlightHeading` & `SpotlightCard` (Interactive mouse-hover light illumination on titles, cards, and dropdown controls).
3. `BrandingSettingsPage` (`/erp/settings/branding` — Logo Light/Dark & Favicon uploader, Color Picker, Hover Glow toggle, Live Preview).
4. `TrialBalanceLedgerPage` (`/erp/finance/ledger` — Double-Entry Trial Balance, Journal Entries viewer, CSV Import & Bilingual PDF Export).

---

## 1. Global Theme, Favicon & Mouse-Spotlight Provider (`apps/web/src/components/providers/theme-branding-provider.tsx`)

This provider injects the tenant's dynamic **Logo**, **Favicon**, **Primary/Accent Brand Colors**, **Light/Dark Mode**, and **Global Mouse-Tracking Light Illumination** across all titles, cards, and interactive elements.

```tsx
'use client';

import React, { createContext, useContext, useEffect } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export interface TenantBrandingConfig {
  tenantName: string;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  enableHoverGlow: boolean;
}

const BrandingContext = createContext<TenantBrandingConfig | null>(null);

export const useTenantBranding = () => useContext(BrandingContext);

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

export function ThemeBrandingProvider({
  branding,
  children,
}: {
  branding: TenantBrandingConfig;
  children: React.ReactNode;
}) {
  useEffect(() => {
    // 1. Inject Dynamic Brand CSS Variables
    const root = document.documentElement;
    const rgb = hexToRgb(branding.primaryColor || '#D4AF37');
    root.style.setProperty('--brand-primary', branding.primaryColor || '#D4AF37');
    root.style.setProperty('--brand-accent', branding.accentColor || '#0F172A');
    root.style.setProperty('--brand-glow', `rgba(${rgb}, 0.24)`);
    root.style.setProperty('--brand-border-glow', `rgba(${rgb}, 0.65)`);
    root.dataset.hoverGlow = branding.enableHoverGlow ? 'true' : 'false';

    // 2. Dynamically Update Browser Favicon
    if (branding.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = branding.faviconUrl;
    }
  }, [branding]);

  const mappedTheme =
    branding.defaultTheme === 'LIGHT'
      ? 'light'
      : branding.defaultTheme === 'DARK'
      ? 'dark'
      : 'system';

  return (
    <BrandingContext.Provider value={branding}>
      <NextThemesProvider attribute="class" defaultTheme={mappedTheme} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
```

---

## 2. Interactive Hover-Spotlight Titles, Cards & Dropdowns (`apps/web/src/components/ui/spotlight-elements.tsx`)

Provides interactive mouse-tracking light illumination when hovering over **Cards**, **Section Titles/Headings**, and **Dropdown Lists**.

```tsx
'use client';

import React, { useRef, useState } from 'react';
import { useTenantBranding } from '../providers/theme-branding-provider';

/**
 * 1. SpotlightCard: Illuminates background & border as mouse moves across the card
 */
export function SpotlightCard({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const branding = useTenantBranding();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);

  const glowEnabled = branding?.enableHoverGlow !== false;

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current || !glowEnabled) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-5 shadow-sm transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/95 ${
        glowEnabled ? 'hover:border-[var(--brand-border-glow)] hover:shadow-lg' : ''
      } ${className}`}
      {...props}
    >
      {glowEnabled && (
        <div
          className="pointer-events-none absolute -inset-px transition-opacity duration-300"
          style={{
            opacity: hovered ? 1 : 0,
            background: `radial-gradient(380px circle at ${pos.x}px ${pos.y}px, var(--brand-glow), transparent 75%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/**
 * 2. SpotlightHeading: Illuminates section titles & headers on mouse hover
 */
export function SpotlightHeading({
  children,
  as: Tag = 'h2',
  className = '',
}: {
  children: React.ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const branding = useTenantBranding();
  const ref = useRef<HTMLHeadingElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);

  const glowEnabled = branding?.enableHoverGlow !== false;

  const onMouseMove = (e: React.MouseEvent<HTMLHeadingElement>) => {
    if (!ref.current || !glowEnabled) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <Tag
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative inline-block rounded-lg px-2 py-1 font-bold tracking-tight text-slate-900 transition-colors dark:text-slate-100 ${className}`}
    >
      {glowEnabled && (
        <span
          className="pointer-events-none absolute inset-0 rounded-lg transition-opacity duration-200"
          style={{
            opacity: hovered ? 1 : 0,
            background: `radial-gradient(160px circle at ${pos.x}px ${pos.y}px, var(--brand-glow), transparent 80%)`,
          }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </Tag>
  );
}
```

---

## 3. Tenant White-Label Branding & Theme Customizer (`apps/web/src/app/[locale]/(erp)/settings/branding/page.tsx`)

Allows Venue Owners (`OWNER`) to upload **Light Logo**, **Dark Logo**, **Browser Favicon**, pick **Brand Colors**, toggle **Light / Dark / System Mode**, and toggle **Hover-Spotlight Illumination** with a live preview.

```tsx
'use client';

import React, { useState } from 'react';
import { useTheme } from 'next-themes';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function BrandingSettingsPage({ locale }: { locale: 'ar' | 'en' }) {
  const isRtl = locale === 'ar';
  const { theme, setTheme } = useTheme();

  const [form, setForm] = useState({
    logoLightUrl: '',
    logoDarkUrl: '',
    faviconUrl: '',
    primaryColor: '#D4AF37',
    accentColor: '#0F172A',
    defaultTheme: 'DARK',
    enableHoverGlow: true,
    footerTextAr: 'شكراً لاختياركم قاعاتنا لإحياء مناسباتكم السعيدة',
    footerTextEn: 'Thank you for choosing our venues for your memorable events',
  });

  const [saving, setSaving] = useState(false);

  const handleFileUpload = async (field: 'logoLightUrl' | 'logoDarkUrl' | 'faviconUrl', file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/v1/erp/uploads/branding', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url) {
      setForm((prev) => ({ ...prev, [field]: data.url }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch('/api/v1/erp/settings/branding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
  };

  return (
    <div className="space-y-6 p-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <SpotlightHeading as="h1" className="text-2xl">
            {isRtl ? 'الهوية البصرية والمظهر (Branding & Themes)' : 'White-Label Branding & Theme Settings'}
          </SpotlightHeading>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isRtl
              ? 'تخصيص الشعار، أيقونة المتصفح (Favicon)، الألوان، والوضع الليلي/النهاري مع إضاءة التمرير التفاعلية'
              : 'Customize logos, browser favicon, brand palette, dark/light themes, and interactive hover illumination'}
          </p>
        </div>

        {/* Instant Theme Mode Switcher */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setTheme(mode);
                setForm((prev) => ({ ...prev, defaultTheme: mode.toUpperCase() }));
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                theme === mode
                  ? 'bg-[var(--brand-primary)] text-slate-950 shadow'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Card 1: Logos & Favicon Upload */}
        <SpotlightCard>
          <SpotlightHeading as="h3" className="mb-4 text-lg">
            {isRtl ? 'الشعارات وأيقونة المتصفح (Logos & Favicon)' : 'Logos & Browser Favicon'}
          </SpotlightHeading>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                {isRtl ? 'الشعار للوضع النهاري (Light Mode Logo)' : 'Light Mode Logo (PNG/SVG)'}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleFileUpload('logoLightUrl', e.target.files[0])}
                className="block w-full rounded-lg border border-slate-300 p-2 text-xs dark:border-slate-700"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                {isRtl ? 'الشعار للوضع الليلي (Dark Mode Logo)' : 'Dark Mode Logo (PNG/SVG)'}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleFileUpload('logoDarkUrl', e.target.files[0])}
                className="block w-full rounded-lg border border-slate-300 p-2 text-xs dark:border-slate-700"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                {isRtl ? 'أيقونة المتصفح (Favicon 32x32 / 64x64)' : 'Browser Tab Favicon (.ico / .png)'}
              </label>
              <input
                type="file"
                accept="image/png,image/x-icon,image/svg+xml"
                onChange={(e) => e.target.files?.[0] && handleFileUpload('faviconUrl', e.target.files[0])}
                className="block w-full rounded-lg border border-slate-300 p-2 text-xs dark:border-slate-700"
              />
            </div>
          </div>
        </SpotlightCard>

        {/* Card 2: Brand Colors & Interactive Hover Glow */}
        <SpotlightCard>
          <SpotlightHeading as="h3" className="mb-4 text-lg">
            {isRtl ? 'الألوان وإضاءة التمرير التفاعلية' : 'Brand Palette & Hover Illumination'}
          </SpotlightHeading>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  {isRtl ? 'اللون الأساسي (Primary)' : 'Primary Brand Color'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="h-10 w-14 cursor-pointer rounded border-0"
                  />
                  <span className="text-xs font-mono">{form.primaryColor}</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">
                  {isRtl ? 'اللون الثانوي (Accent)' : 'Secondary Accent Color'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.accentColor}
                    onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                    className="h-10 w-14 cursor-pointer rounded border-0"
                  />
                  <span className="text-xs font-mono">{form.accentColor}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div>
                <div className="text-sm font-semibold">
                  {isRtl ? 'تفعيل إضاءة المؤشر التفاعلية (Mouse Hover Glow)' : 'Enable Interactive Hover Spotlight'}
                </div>
                <div className="text-xs text-slate-500">
                  {isRtl
                    ? 'إضاءة البطاقات والعناوين تلقائياً عند تحريك الماوس عليها'
                    : 'Illuminates cards, titles, and dropdown borders as the cursor moves'}
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.enableHoverGlow}
                onChange={(e) => setForm({ ...form, enableHoverGlow: e.target.checked })}
                className="h-5 w-5 accent-amber-500"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-slate-950 shadow transition hover:opacity-90"
            >
              {saving
                ? isRtl
                  ? 'جاري الحفظ...'
                  : 'Saving...'
                : isRtl
                ? 'حفظ وتطبيق الهوية البصرية'
                : 'Save & Apply Branding'}
            </button>
          </div>
        </SpotlightCard>
      </div>
    </div>
  );
}
```

---

## 4. Double-Entry Ledger, Trial Balance & CSV/PDF Toolbar (`apps/web/src/app/[locale]/(erp)/finance/ledger/page.tsx`)

Provides a complete **Double-Entry Financial Ledger & Trial Balance Viewer** with **Dropdown Filters (`SystemLookup` & `RecordLifecycle`)**, **CSV Bulk Import**, and **Bilingual PDF Export**.

```tsx
'use client';

import React, { useState } from 'react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

interface TrialBalanceRow {
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  lifecycle: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  totalDebit: number;
  totalCredit: number;
}

export default function TrialBalanceLedgerPage({
  locale,
  rows = [],
}: {
  locale: 'ar' | 'en';
  rows: TrialBalanceRow[];
}) {
  const isRtl = locale === 'ar';
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('ALL');
  const [lifecycleFilter, setLifecycleFilter] = useState<string>('ACTIVE');

  const filteredRows = rows.filter((r) => {
    const matchesType = accountTypeFilter === 'ALL' || r.accountType === accountTypeFilter;
    const matchesLifecycle = lifecycleFilter === 'ALL' || r.lifecycle === lifecycleFilter;
    return matchesType && matchesLifecycle;
  });

  const sumDebit = filteredRows.reduce((acc, r) => acc + r.totalDebit, 0);
  const sumCredit = filteredRows.reduce((acc, r) => acc + r.totalCredit, 0);
  const isBalanced = Math.abs(sumDebit - sumCredit) < 0.01;

  const handleCsvImport = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    await fetch('/api/v1/erp/import/accounts', { method: 'POST', body: formData });
    window.location.reload();
  };

  return (
    <div className="space-y-6 p-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header & Import/Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <SpotlightHeading as="h1" className="text-2xl">
            {isRtl ? 'ميزان المراجعة والقيود المزدوجة (Double-Entry Ledger)' : 'Double-Entry Trial Balance & Ledger'}
          </SpotlightHeading>
          <p className="text-sm text-slate-500">
            {isRtl
              ? 'مراقبة الأرصدة المدينة والدائنة، تأمينات العملاء المحتجزة، وصافي الإيرادات'
              : 'Monitor debit/credit balances, held security deposit liabilities, and net venue revenue'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* CSV Import Button */}
          <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold shadow-sm transition hover:border-[var(--brand-primary)] dark:border-slate-700 dark:bg-slate-900">
            {isRtl ? '📥 استيراد دليل الحسابات (CSV)' : '📥 Import Accounts (CSV)'}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleCsvImport(e.target.files[0])}
            />
          </label>

          {/* Bilingual PDF Export Button */}
          <a
            href={`/api/v1/erp/finance/trial-balance/pdf?lang=${locale}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:opacity-90"
          >
            {isRtl ? '📄 تصدير ميزان المراجعة (PDF)' : '📄 Export Trial Balance (PDF)'}
          </a>
        </div>
      </div>

      {/* Standardized Dropdown Filters (Drop Lists) */}
      <SpotlightCard className="flex flex-wrap items-center gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {isRtl ? 'تصنيف الحساب (Account Type)' : 'Account Category'}
          </label>
          <select
            value={accountTypeFilter}
            onChange={(e) => setAccountTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="ALL">{isRtl ? 'جميع الحسابات' : 'All Account Types'}</option>
            <option value="ASSET">{isRtl ? 'الأصول (Assets)' : 'Assets'}</option>
            <option value="LIABILITY">{isRtl ? 'الالتزامات والتأمينات (Liabilities)' : 'Liabilities & Deposits'}</option>
            <option value="EQUITY">{isRtl ? 'حقوق الملكية (Equity)' : 'Equity'}</option>
            <option value="REVENUE">{isRtl ? 'الإيرادات (Revenue)' : 'Revenue'}</option>
            <option value="EXPENSE">{isRtl ? 'المصروفات والتكاليف (Expenses)' : 'Expenses & COGS'}</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {isRtl ? 'حالة السجل (Lifecycle)' : 'Record Lifecycle'}
          </label>
          <select
            value={lifecycleFilter}
            onChange={(e) => setLifecycleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="ACTIVE">{isRtl ? 'نشط (Active)' : 'Active'}</option>
            <option value="DRAFT">{isRtl ? 'مسودة (Draft)' : 'Draft'}</option>
            <option value="ARCHIVED">{isRtl ? 'مؤرشف (Archived)' : 'Archived'}</option>
            <option value="ALL">{isRtl ? 'الكل (All)' : 'All States'}</option>
          </select>
        </div>

        {/* Balance Verification Badge */}
        <div className="ms-auto">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
              isBalanced
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
            }`}
          >
            {isBalanced
              ? isRtl
                ? '✔ القيد المزدوج متوازن (Balanced)'
                : '✔ Double-Entry Balanced'
              : isRtl
              ? '⚠ يوجد فرق في الميزان'
              : '⚠ Out of Balance'}
          </span>
        </div>
      </SpotlightCard>

      {/* Trial Balance Table */}
      <SpotlightCard className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 text-start">{isRtl ? 'رقم الحساب' : 'Code'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'اسم الحساب' : 'Account Name'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'النوع' : 'Type'}</th>
              <th className="px-4 py-3 text-end">{isRtl ? 'مدين (Debit)' : 'Debit'}</th>
              <th className="px-4 py-3 text-end">{isRtl ? 'دائن (Credit)' : 'Credit'}</th>
              <th className="px-4 py-3 text-center">{isRtl ? 'الإجراءات' : 'Lifecycle Actions'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredRows.map((row) => (
              <tr key={row.code} className="transition hover:bg-amber-500/5">
                <td className="px-4 py-3 font-mono font-semibold">{row.code}</td>
                <td className="px-4 py-3 font-medium">{isRtl ? row.nameAr : row.nameEn}</td>
                <td className="px-4 py-3 text-xs">{row.accountType}</td>
                <td className="px-4 py-3 text-end font-mono">{row.totalDebit.toLocaleString()}</td>
                <td className="px-4 py-3 text-end font-mono">{row.totalCredit.toLocaleString()}</td>
                <td className="px-4 py-3 text-center">
                  <select
                    defaultValue={row.lifecycle}
                    className="rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
                  >
                    <option value="ACTIVE">{isRtl ? 'نشط' : 'Active'}</option>
                    <option value="DRAFT">{isRtl ? 'مسودة' : 'Draft'}</option>
                    <option value="ARCHIVED">{isRtl ? 'أرشفة' : 'Archive'}</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-100 font-bold dark:border-slate-700 dark:bg-slate-950">
            <tr>
              <td colSpan={3} className="px-4 py-3 text-start">
                {isRtl ? 'الإجمالي الكلي (Total)' : 'Grand Total'}
              </td>
              <td className="px-4 py-3 text-end font-mono">{sumDebit.toLocaleString()}</td>
              <td className="px-4 py-3 text-end font-mono">{sumCredit.toLocaleString()}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </SpotlightCard>
    </div>
  );
}
```
