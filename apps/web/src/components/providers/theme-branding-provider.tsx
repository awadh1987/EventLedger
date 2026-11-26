'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { apiFetch } from '@/lib/api';
import type { PublicTenant } from '@/lib/types';

export interface TenantBrandingConfig {
  id: string;
  venueName: string;
  slug: string;
  currency: string;
  taxRate: number;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  enableSpotlight: boolean;
  spotlightColor: string;
}

interface TenantBrandingContextValue extends TenantBrandingConfig {
  refreshBranding: () => Promise<void>;
  applyBranding: (next: Partial<TenantBrandingConfig>) => void;
}

export const DEFAULT_BRANDING: TenantBrandingConfig = {
  id: '',
  venueName: 'EventLedger',
  slug: 'almassa',
  currency: 'YER',
  taxRate: 5,
  primaryColor: '#D4AF37',
  accentColor: '#0F172A',
  defaultTheme: 'DARK',
  enableSpotlight: true,
  spotlightColor: 'rgba(212, 175, 55, 0.18)',
};

const BrandingContext = createContext<TenantBrandingContextValue>({
  ...DEFAULT_BRANDING,
  refreshBranding: async () => undefined,
  applyBranding: () => undefined,
});

export function useTenantBranding() {
  return useContext(BrandingContext);
}

export function ThemeBrandingProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<TenantBrandingConfig>(DEFAULT_BRANDING);

  const refreshBranding = useCallback(async () => {
    try {
      const data = await apiFetch<PublicTenant>('/api/v1/public/tenant', { skipAuth: true });
      const b = data.branding;
      const theme =
        b.default_theme === 'LIGHT' || b.default_theme === 'DARK' || b.default_theme === 'SYSTEM'
          ? b.default_theme
          : 'SYSTEM';
      setConfig({
        id: data.id,
        venueName: data.name,
        slug: data.slug,
        currency: data.currency,
        taxRate: data.tax_rate,
        primaryColor: b.primary_color || '#D4AF37',
        accentColor: b.accent_color || '#0F172A',
        spotlightColor: b.spotlight_color || 'rgba(212, 175, 55, 0.18)',
        defaultTheme: theme,
        enableSpotlight: b.enable_spotlight,
        logoLightUrl: b.logo_light_url,
        logoDarkUrl: b.logo_dark_url,
        faviconUrl: b.favicon_url,
      });
    } catch {
      // Keep default branding if offline or on platform root
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
    () => ({ ...config, refreshBranding, applyBranding }),
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
