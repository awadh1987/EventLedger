'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Palette } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { TenantBrandingInfo } from '@/lib/types';

export default function TenantBrandingSettingsPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const { applyBranding, refreshBranding } = useTenantBranding();

  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [accentColor, setAccentColor] = useState('#0F172A');
  const [spotlightColor, setSpotlightColor] = useState('rgba(212, 175, 55, 0.18)');
  const [defaultTheme, setDefaultTheme] = useState<'LIGHT' | 'DARK' | 'SYSTEM'>('SYSTEM');
  const [enableSpotlight, setEnableSpotlight] = useState(true);
  const [faviconUrl, setFaviconUrl] = useState('');
  const [footerAr, setFooterAr] = useState('');
  const [footerEn, setFooterEn] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<TenantBrandingInfo>('/api/v1/tenant/branding')
      .then((b) => {
        setPrimaryColor(b.primary_color);
        setAccentColor(b.accent_color);
        setSpotlightColor(b.spotlight_color);
        setDefaultTheme((b.default_theme as 'LIGHT' | 'DARK' | 'SYSTEM') || 'SYSTEM');
        setEnableSpotlight(b.enable_spotlight);
        setFaviconUrl(b.favicon_url || '');
        setFooterAr(b.invoice_footer_ar || '');
        setFooterEn(b.invoice_footer_en || '');
      })
      .catch(() => undefined);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/v1/tenant/branding', {
      method: 'PUT',
      body: {
        primary_color: primaryColor,
        accent_color: accentColor,
        spotlight_color: spotlightColor,
        default_theme: defaultTheme,
        enable_spotlight: enableSpotlight,
        favicon_url: faviconUrl || null,
        invoice_footer_ar: footerAr,
        invoice_footer_en: footerEn,
      },
    });
    applyBranding({
      primaryColor,
      accentColor,
      spotlightColor,
      defaultTheme,
      enableSpotlight,
      faviconUrl: faviconUrl || null,
    });
    await refreshBranding();
    setSavedMsg(isRtl ? 'تم حفظ الهوية البصرية وتطبيقها فوراً' : 'Branding saved and applied');
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <SpotlightHeading as="h1" className="text-2xl">
          <Palette className="me-2 inline h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
          {isRtl ? 'تخصيص الهوية البصرية والعلامة التجارية' : 'White-Label Tenant Branding Customizer'}
        </SpotlightHeading>

        <SpotlightCard>
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'اللون الأساسي' : 'Primary Brand Color'}</label>
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-11 w-full rounded-lg border border-slate-700 bg-transparent p-1" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'اللون الثانوي' : 'Accent Color'}</label>
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-11 w-full rounded-lg border border-slate-700 bg-transparent p-1" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'لون التوهج (Spotlight)' : 'Spotlight Glow'}</label>
              <input value={spotlightColor} onChange={(e) => setSpotlightColor(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'المظهر الافتراضي' : 'Default Theme'}</label>
              <select
                value={defaultTheme}
                onChange={(e) => setDefaultTheme(e.target.value as 'LIGHT' | 'DARK' | 'SYSTEM')}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="SYSTEM">{isRtl ? 'تلقائي (النظام)' : 'System'}</option>
                <option value="DARK">{isRtl ? 'داكن' : 'Dark'}</option>
                <option value="LIGHT">{isRtl ? 'فاتح' : 'Light'}</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enableSpotlight} onChange={(e) => setEnableSpotlight(e.target.checked)} />
                <span>{isRtl ? 'تفعيل تأثير الإضاءة التفاعلي (Hover Spotlight)' : 'Enable Hover Spotlight Glow'}</span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'رابط الأيقونة (Favicon URL)' : 'Favicon URL'}</label>
              <input value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'تذييل الفاتورة (عربي)' : 'Invoice Footer (Arabic)'}</label>
              <textarea value={footerAr} onChange={(e) => setFooterAr(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{isRtl ? 'تذييل الفاتورة (إنجليزي)' : 'Invoice Footer (English)'}</label>
              <textarea value={footerEn} onChange={(e) => setFooterEn(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </div>
            {savedMsg && <p className="sm:col-span-2 text-xs text-emerald-500">{savedMsg}</p>}
            <button type="submit" className="min-h-[44px] sm:col-span-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
              {isRtl ? 'حفظ وتطبيق الهوية البصرية' : 'Save & Apply Branding'}
            </button>
          </form>
        </SpotlightCard>
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
