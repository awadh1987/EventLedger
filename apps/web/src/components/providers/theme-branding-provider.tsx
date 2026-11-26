'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
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

export type BrandingScope = 'PLATFORM' | 'TENANT';

interface TenantBrandingContextValue extends TenantBrandingConfig {
  scope: BrandingScope;
  refreshBranding: () => Promise<void>;
  applyBranding: (next: Partial<TenantBrandingConfig>) => void;
}

export const PLATFORM_TITLE = 'EventLedger — Multi-Tenant Venue & Conference SaaS ERP';
export const PLATFORM_FAVICON = '/favicon.svg';
export const PLATFORM_LOGO = '/brand/eventledger-logo.svg';

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
  logoLightUrl: PLATFORM_LOGO,
  logoDarkUrl: PLATFORM_LOGO,
  faviconUrl: PLATFORM_FAVICON,
};

const BrandingContext = createContext<TenantBrandingContextValue>({
  ...DEFAULT_BRANDING,
  scope: 'PLATFORM',
  refreshBranding: async () => undefined,
  applyBranding: () => undefined,
});

export function useTenantBranding() {
  return useContext(BrandingContext);
}

/** Root platform routes: /ar, /en, /saas-portal, /admin, /login (with optional locale prefix). */
const PLATFORM_ROOT_RE = /^\/(?:(?:ar|en)\/?|(?:(?:ar|en)\/)?(?:saas-portal|admin|login)(?:\/.*)?)$/i;
const TENANT_PATH_RE = /^\/(?:ar|en)\/t\/([a-z0-9-]+)/i;

/** Shape returned by GET /api/v1/public/tenants/{slug}. */
interface PublicTenantBySlug {
  id: string;
  name: string;
  slug: string;
  currency: string;
  tax_rate: number;
  branding: {
    primaryColor?: string;
    accentColor?: string;
    defaultTheme?: string;
    enableSpotlight?: boolean;
    spotlightColor?: string;
    logoLightUrl?: string | null;
    logoDarkUrl?: string | null;
    faviconUrl?: string | null;
  };
}

function normalizeTheme(v: string | undefined): 'LIGHT' | 'DARK' | 'SYSTEM' {
  return v === 'LIGHT' || v === 'DARK' || v === 'SYSTEM' ? v : 'SYSTEM';
}

export function ThemeBrandingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const [config, setConfig] = useState<TenantBrandingConfig>(DEFAULT_BRANDING);

  const tenantSlug = pathname.match(TENANT_PATH_RE)?.[1]?.toLowerCase() ?? null;
  const isPlatformRoot = !tenantSlug && PLATFORM_ROOT_RE.test(pathname);
  const scope: BrandingScope = tenantSlug ? 'TENANT' : 'PLATFORM';

  const loadBranding = useCallback(
    async (signal?: AbortSignal) => {
      if (isPlatformRoot) {
        setConfig(DEFAULT_BRANDING);
        return;
      }
      try {
        if (tenantSlug) {
          const data = await apiFetch<PublicTenantBySlug>(
            `/api/v1/public/tenants/${tenantSlug}`,
            { skipAuth: true, signal },
            tenantSlug
          );
          if (signal?.aborted) return;
          const b = data.branding ?? {};
          setConfig({
            id: data.id,
            venueName: data.name,
            slug: data.slug,
            currency: data.currency,
            taxRate: data.tax_rate,
            primaryColor: b.primaryColor || DEFAULT_BRANDING.primaryColor,
            accentColor: b.accentColor || DEFAULT_BRANDING.accentColor,
            spotlightColor: b.spotlightColor || DEFAULT_BRANDING.spotlightColor,
            defaultTheme: normalizeTheme(b.defaultTheme),
            enableSpotlight: b.enableSpotlight ?? true,
            logoLightUrl: b.logoLightUrl ?? null,
            logoDarkUrl: b.logoDarkUrl ?? null,
            faviconUrl: b.faviconUrl || PLATFORM_FAVICON,
          });
          return;
        }
        // Workspace routes without /t/<slug> (sub-domain, custom domain, native shells).
        const data = await apiFetch<PublicTenant>('/api/v1/public/tenant', { skipAuth: true, signal });
        if (signal?.aborted) return;
        const b = data.branding;
        setConfig({
          id: data.id,
          venueName: data.name,
          slug: data.slug,
          currency: data.currency,
          taxRate: data.tax_rate,
          primaryColor: b.primary_color || DEFAULT_BRANDING.primaryColor,
          accentColor: b.accent_color || DEFAULT_BRANDING.accentColor,
          spotlightColor: b.spotlight_color || DEFAULT_BRANDING.spotlightColor,
          defaultTheme: normalizeTheme(b.default_theme),
          enableSpotlight: b.enable_spotlight,
          logoLightUrl: b.logo_light_url,
          logoDarkUrl: b.logo_dark_url,
          faviconUrl: b.favicon_url || PLATFORM_FAVICON,
        });
      } catch {
        if (signal?.aborted) return;
        // Offline / unknown workspace: fall back to platform branding, never to a stale tenant.
        setConfig(DEFAULT_BRANDING);
      }
    },
    [isPlatformRoot, tenantSlug]
  );

  const refreshBranding = useCallback(async () => {
    await loadBranding();
  }, [loadBranding]);

  const applyBranding = useCallback((next: Partial<TenantBrandingConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    if (isPlatformRoot) {
      // Reset synchronously so tenant colours never leak onto platform pages.
      setConfig(DEFAULT_BRANDING);
      return;
    }
    const ctrl = new AbortController();
    loadBranding(ctrl.signal);
    return () => ctrl.abort();
  }, [isPlatformRoot, loadBranding, pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', config.primaryColor);
    root.style.setProperty('--brand-accent', config.accentColor);
    root.style.setProperty('--brand-glow', config.spotlightColor);

    const isTenantBrand = scope === 'TENANT' && Boolean(config.id);
    document.title = isTenantBrand ? config.venueName : PLATFORM_TITLE;

    const href = isTenantBrand ? config.faviconUrl || PLATFORM_FAVICON : PLATFORM_FAVICON;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) link.href = href;
  }, [config, scope]);

  const value = useMemo<TenantBrandingContextValue>(
    () => ({ ...config, scope, refreshBranding, applyBranding }),
    [config, scope, refreshBranding, applyBranding]
  );

  return (
    <BrandingContext.Provider value={value}>
      <NextThemesProvider attribute="class" defaultTheme={config.defaultTheme.toLowerCase()} enableSystem>
        {children}
      </NextThemesProvider>
    </BrandingContext.Provider>
  );
}
