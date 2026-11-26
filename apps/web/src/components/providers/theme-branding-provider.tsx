'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export interface TenantBrandingConfig {
  id: string;
  venueNameAr: string;
  venueNameEn: string;
  taglineAr: string;
  taglineEn: string;
  slug: string;
  customDomain: string;
  currency: string;
  taxRate: number;
  defaultSecurityDeposit: number;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  enableSpotlight: boolean;
  spotlightColor: string;
  contactPhone: string;
  contactEmail: string;
  addressAr: string;
  addressEn: string;
  invoiceFooterAr: string;
  invoiceFooterEn: string;
}

interface TenantBrandingContextValue extends TenantBrandingConfig {
  refreshBranding: () => Promise<void>;
  applyBranding: (next: Partial<TenantBrandingConfig>) => void;
}

export const DEFAULT_BRANDING: TenantBrandingConfig = {
  id: 'almassa',
  venueNameAr: 'قصر الماسة للمؤتمرات والأفراح',
  venueNameEn: 'Al-Massa Grand Palace',
  taglineAr: 'أرقى قاعات الأفراح والمؤتمرات والضيافة الملكية في قلب العاصمة',
  taglineEn: 'Premier Wedding Halls, Executive Conferences & Royal Banquet Hospitality',
  slug: 'almassa',
  customDomain: 'events.almassa.ye',
  currency: 'YER',
  taxRate: 5,
  defaultSecurityDeposit: 150000,
  primaryColor: '#D4AF37',
  accentColor: '#0F172A',
  defaultTheme: 'DARK',
  enableSpotlight: true,
  spotlightColor: 'rgba(212, 175, 55, 0.18)',
  contactPhone: '+967 770 000 001',
  contactEmail: 'concierge@almassa.ye',
  addressAr: 'شارع حدة الرئيسي — صنعاء، الجمهورية اليمنية',
  addressEn: 'Hadda Main Boulevard — Sanaa, Republic of Yemen',
  invoiceFooterAr:
    'تُعد هذه الفاتورة مستنداً مالياً معتمداً من قصر الماسة للمؤتمرات والأفراح. يُرد مبلغ التأمين خلال 48 ساعة بعد معاينة القاعة.',
  invoiceFooterEn:
    'Official financial invoice issued by Al-Massa Grand Palace. Security deposits are refunded within 48 hours after post-event inspection.',
};

const BrandingContext = createContext<TenantBrandingContextValue>({
  ...DEFAULT_BRANDING,
  refreshBranding: async () => undefined,
  applyBranding: () => undefined,
});

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
  const [config, setConfig] = useState<TenantBrandingConfig>(() => ({
    ...DEFAULT_BRANDING,
    ...branding,
  }));

  const refreshBranding = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/tenant/branding', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.branding) {
        setConfig((prev) => ({
          ...prev,
          ...data.branding,
          defaultTheme:
            data.branding.defaultTheme === 'LIGHT' ||
            data.branding.defaultTheme === 'DARK' ||
            data.branding.defaultTheme === 'SYSTEM'
              ? data.branding.defaultTheme
              : prev.defaultTheme,
        }));
      }
    } catch {
      // keep current branding gracefully
    }
  }, []);

  const applyBranding = useCallback((next: Partial<TenantBrandingConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', config.primaryColor);
    root.style.setProperty('--brand-accent', config.accentColor);
    root.style.setProperty('--brand-glow', config.spotlightColor);
    if (config.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = config.faviconUrl;
    }
  }, [config]);

  const value = useMemo<TenantBrandingContextValue>(
    () => ({
      ...config,
      refreshBranding,
      applyBranding,
    }),
    [config, refreshBranding, applyBranding]
  );

  return (
    <BrandingContext.Provider value={value}>
      <NextThemesProvider attribute="class" defaultTheme={config.defaultTheme.toLowerCase()} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
