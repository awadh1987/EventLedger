'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { apiFetch } from '@/lib/api';
import type { BrandingTokens, PublicTenant } from '@/lib/types';

export interface ThemeTokensState {
  surfaceLight: string;
  surfaceDark: string;
  cardLight: string;
  cardDark: string;
  borderLight: string;
  borderDark: string;
  buttonTextColor: string;
  cardRadius: string;
}

export interface BrandThemePreset {
  id: string;
  labelAr: string;
  labelEn: string;
  primaryColor: string;
  accentColor: string;
  spotlightColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  tokens: ThemeTokensState;
}

export const BRAND_THEME_PRESETS: BrandThemePreset[] = [
  {
    id: 'OBSIDIAN_GOLD',
    labelAr: 'السبج الذهبي الفاخر',
    labelEn: 'Obsidian Gold',
    primaryColor: '#D4AF37',
    accentColor: '#0F172A',
    spotlightColor: 'rgba(212, 175, 55, 0.18)',
    defaultTheme: 'DARK',
    tokens: {
      surfaceLight: '#F8FAFC',
      surfaceDark: '#020617',
      cardLight: '#FFFFFF',
      cardDark: '#0F172A',
      borderLight: '#E2E8F0',
      borderDark: '#1E293B',
      buttonTextColor: '#020617',
      cardRadius: '0.75rem',
    },
  },
  {
    id: 'ROYAL_IVORY',
    labelAr: 'العاج الملكي الفاتح',
    labelEn: 'Royal Ivory',
    primaryColor: '#B48327',
    accentColor: '#1E293B',
    spotlightColor: 'rgba(180, 131, 39, 0.14)',
    defaultTheme: 'LIGHT',
    tokens: {
      surfaceLight: '#FAF8F5',
      surfaceDark: '#0C0A09',
      cardLight: '#FFFFFF',
      cardDark: '#1C1917',
      borderLight: '#E7E5E4',
      borderDark: '#292524',
      buttonTextColor: '#FFFFFF',
      cardRadius: '0.875rem',
    },
  },
  {
    id: 'EMERALD_PALACE',
    labelAr: 'قصر الزمرد',
    labelEn: 'Emerald Palace',
    primaryColor: '#10B981',
    accentColor: '#064E3B',
    spotlightColor: 'rgba(16, 185, 129, 0.18)',
    defaultTheme: 'DARK',
    tokens: {
      surfaceLight: '#F0FDF4',
      surfaceDark: '#022C22',
      cardLight: '#FFFFFF',
      cardDark: '#064E3B',
      borderLight: '#D1FAE5',
      borderDark: '#065F46',
      buttonTextColor: '#022C22',
      cardRadius: '0.75rem',
    },
  },
  {
    id: 'SAPPHIRE_EXECUTIVE',
    labelAr: 'الياقوت التنفيذي',
    labelEn: 'Sapphire Executive',
    primaryColor: '#38BDF8',
    accentColor: '#0C4A6E',
    spotlightColor: 'rgba(56, 189, 248, 0.18)',
    defaultTheme: 'DARK',
    tokens: {
      surfaceLight: '#F0F9FF',
      surfaceDark: '#082F49',
      cardLight: '#FFFFFF',
      cardDark: '#0F172A',
      borderLight: '#BAE6FD',
      borderDark: '#1E3A5F',
      buttonTextColor: '#082F49',
      cardRadius: '0.625rem',
    },
  },
  {
    id: 'CRIMSON_VELVET',
    labelAr: 'المخمل القرمزي',
    labelEn: 'Crimson Velvet',
    primaryColor: '#F43F5E',
    accentColor: '#4C0519',
    spotlightColor: 'rgba(244, 63, 94, 0.18)',
    defaultTheme: 'DARK',
    tokens: {
      surfaceLight: '#FFF1F2',
      surfaceDark: '#19040B',
      cardLight: '#FFFFFF',
      cardDark: '#2A0813',
      borderLight: '#FFE4E6',
      borderDark: '#4C0519',
      buttonTextColor: '#FFFFFF',
      cardRadius: '0.875rem',
    },
  },
];

export interface TenantBrandingConfig {
  id: string;
  venueName: string;
  slug: string;
  currency: string;
  taxRate: number;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  ownerAvatarUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  defaultTheme: 'LIGHT' | 'DARK' | 'SYSTEM';
  enableSpotlight: boolean;
  spotlightColor: string;
  themePreset: string;
  tokens: ThemeTokensState;
}

export type BrandingScope = 'PLATFORM' | 'TENANT';

interface TenantBrandingContextValue extends TenantBrandingConfig {
  scope: BrandingScope;
  refreshBranding: () => Promise<void>;
  applyBranding: (next: Partial<TenantBrandingConfig>) => void;
}

export const PLATFORM_TITLE = 'EventLedger — Venue & Conference Enterprise ERP';
export const PLATFORM_FAVICON = '/favicon.svg';
export const PLATFORM_LOGO = '/brand/eventledger-logo.svg';

function cleanTenantTabTitle(venueName: string, slug: string): string {
  const parts = (venueName || '')
    .split(/[|—–\-]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const latinPart = parts.find((p) => /[A-Za-z]/.test(p) && !/[\u0600-\u06FF]/.test(p));
  if (latinPart) return latinPart;

  const stripped = (venueName || '')
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, ' ')
    .replace(/[|—–\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && /[A-Za-z0-9]/.test(stripped)) return stripped;

  const cleanSlug = (slug || '').trim();
  if (cleanSlug) {
    return cleanSlug
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  }
  return 'EventLedger';
}

function applyBrowserTitleAndFavicon(title: string, iconHref: string) {
  if (typeof document === 'undefined') return;
  if (document.title !== title) {
    document.title = title;
  }
  const cleanHref = (iconHref || PLATFORM_FAVICON).trim() || PLATFORM_FAVICON;
  const iconType = cleanHref.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  const existing = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>("link[rel*='icon'], link[rel='apple-touch-icon']")
  );
  if (existing.length > 0) {
    for (const el of existing) {
      if (el.getAttribute('href') !== cleanHref) el.setAttribute('href', cleanHref);
      el.setAttribute('type', iconType);
    }
  }
  const hasPrimary = existing.some((el) => el.rel.toLowerCase() === 'icon');
  if (!hasPrimary) {
    const iconLink = document.createElement('link');
    iconLink.rel = 'icon';
    iconLink.type = iconType;
    iconLink.href = cleanHref;
    document.head.appendChild(iconLink);
  }
  const hasShortcut = existing.some((el) => el.rel.toLowerCase() === 'shortcut icon');
  if (!hasShortcut) {
    const scLink = document.createElement('link');
    scLink.rel = 'shortcut icon';
    scLink.type = iconType;
    scLink.href = cleanHref;
    document.head.appendChild(scLink);
  }
}

const DEFAULT_TOKENS: ThemeTokensState = { ...BRAND_THEME_PRESETS[0].tokens };

export const DEFAULT_BRANDING: TenantBrandingConfig = {
  id: '',
  venueName: 'EventLedger',
  slug: '',
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
  ownerAvatarUrl: null,
  themePreset: 'OBSIDIAN_GOLD',
  tokens: DEFAULT_TOKENS,
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
    themePreset?: string;
    tokens?: Partial<BrandingTokens>;
    ownerAvatarUrl?: string | null;
    logoLightUrl?: string | null;
    logoDarkUrl?: string | null;
    faviconUrl?: string | null;
  };
}

function normalizeTheme(v: string | undefined): 'LIGHT' | 'DARK' | 'SYSTEM' {
  return v === 'LIGHT' || v === 'DARK' || v === 'SYSTEM' ? v : 'SYSTEM';
}

function toTokensState(raw?: Partial<BrandingTokens> | null): ThemeTokensState {
  return {
    surfaceLight: raw?.surface_light || DEFAULT_TOKENS.surfaceLight,
    surfaceDark: raw?.surface_dark || DEFAULT_TOKENS.surfaceDark,
    cardLight: raw?.card_light || DEFAULT_TOKENS.cardLight,
    cardDark: raw?.card_dark || DEFAULT_TOKENS.cardDark,
    borderLight: raw?.border_light || DEFAULT_TOKENS.borderLight,
    borderDark: raw?.border_dark || DEFAULT_TOKENS.borderDark,
    buttonTextColor: raw?.button_text_color || DEFAULT_TOKENS.buttonTextColor,
    cardRadius: raw?.card_radius || DEFAULT_TOKENS.cardRadius,
  };
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
            ownerAvatarUrl: b.ownerAvatarUrl ?? null,
            themePreset: b.themePreset || b.tokens?.theme_preset || 'OBSIDIAN_GOLD',
            tokens: toTokensState(b.tokens),
          });
          return;
        }
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
          ownerAvatarUrl: b.owner_avatar_url ?? null,
          themePreset: b.theme_preset || b.tokens?.theme_preset || 'OBSIDIAN_GOLD',
          tokens: toTokensState(b.tokens),
        });
      } catch {
        if (signal?.aborted) return;
        setConfig(DEFAULT_BRANDING);
      }
    },
    [isPlatformRoot, tenantSlug]
  );

  const refreshBranding = useCallback(async () => {
    await loadBranding();
  }, [loadBranding]);

  const applyBranding = useCallback((next: Partial<TenantBrandingConfig>) => {
    setConfig((prev) => ({
      ...prev,
      ...next,
      tokens: next.tokens ? { ...prev.tokens, ...next.tokens } : prev.tokens,
    }));
  }, []);

  useEffect(() => {
    if (isPlatformRoot) {
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
    root.style.setProperty('--brand-btn-text', config.tokens.buttonTextColor);
    root.style.setProperty('--brand-radius', config.tokens.cardRadius);
    root.style.setProperty('--brand-surface-light', config.tokens.surfaceLight);
    root.style.setProperty('--brand-surface-dark', config.tokens.surfaceDark);
    root.style.setProperty('--brand-card-light', config.tokens.cardLight);
    root.style.setProperty('--brand-card-dark', config.tokens.cardDark);
    root.style.setProperty('--brand-border-light', config.tokens.borderLight);
    root.style.setProperty('--brand-border-dark', config.tokens.borderDark);

    const isTenantBrand = scope === 'TENANT' && Boolean(config.id);
    const targetTitle = isTenantBrand ? cleanTenantTabTitle(config.venueName, config.slug) : PLATFORM_TITLE;
    const targetFavicon = isTenantBrand ? config.faviconUrl || PLATFORM_FAVICON : PLATFORM_FAVICON;

    applyBrowserTitleAndFavicon(targetTitle, targetFavicon);
    const tId = window.setTimeout(() => applyBrowserTitleAndFavicon(targetTitle, targetFavicon), 60);
    return () => window.clearTimeout(tId);
  }, [config, pathname, scope]);

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
