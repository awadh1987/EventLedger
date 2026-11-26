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

export function ThemeBrandingProvider({ children, branding }: { children: React.ReactNode; branding?: Partial<TenantBrandingConfig> }) {
  const merged = useMemo(() => ({ ...DEFAULT_BRANDING, ...branding }), [branding]);

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

  return (
    <BrandingContext.Provider value={merged}>
      <NextThemesProvider attribute="class" defaultTheme={merged.defaultTheme.toLowerCase()} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
