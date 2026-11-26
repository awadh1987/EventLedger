'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  apiFetch,
  clearAuthStorage,
  getAccessToken,
  getActiveTenantSlug,
  isNativeBuild,
  setAccessToken,
  setTenantSlug,
} from '@/lib/api';
import type { AuthUser } from '@/lib/types';

const KNOWN_SLUGS_KEY = 'el_known_slugs';
const USER_CACHE_KEY = 'el_auth_user';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  tenantSlug: string;
  knownSlugs: string[];
  switchWorkspace: (nextSlug: string, locale?: string) => void;
  refreshUser: () => Promise<void>;
  setSession: (token: string, user: AuthUser, slug?: string) => void;
  loginSession: (token: string, user: AuthUser, slug?: string) => void;
  logout: (redirectLocale?: string) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isAuthenticated: false,
  tenantSlug: 'almassa',
  knownSlugs: ['almassa'],
  switchWorkspace: () => undefined,
  refreshUser: async () => undefined,
  setSession: () => undefined,
  loginSession: () => undefined,
  logout: () => undefined,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthSession() {
  return useContext(AuthContext);
}

function loadKnownSlugs(currentSlug: string): string[] {
  const defaults = ['almassa'];
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(KNOWN_SLUGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    const merged = Array.from(new Set([...defaults, ...parsed, currentSlug].filter(Boolean)));
    localStorage.setItem(KNOWN_SLUGS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return Array.from(new Set([...defaults, currentSlug].filter(Boolean)));
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/ar';
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantSlug, setTenantSlugState] = useState('almassa');
  const [knownSlugs, setKnownSlugs] = useState<string[]>(['almassa']);

  useEffect(() => {
    const pathMatch = pathname.match(/^\/(?:(?:ar|en)\/)?t\/([a-z0-9-]+)/i);
    if (pathMatch?.[1]) {
      const pathSlug = pathMatch[1].toLowerCase();
      setTenantSlug(pathSlug);
      setTenantSlugState(pathSlug);
      setKnownSlugs(loadKnownSlugs(pathSlug));
    } else {
      const active = getActiveTenantSlug();
      setTenantSlugState(active);
      setKnownSlugs(loadKnownSlugs(active));
    }
  }, [pathname]);

  const refreshUser = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<AuthUser>('/api/v1/auth/me');
      setUser(me);
      if (typeof window !== 'undefined') {
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me));
      }
    } catch {
      setAccessToken(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(USER_CACHE_KEY);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const setSession = useCallback((token: string, nextUser: AuthUser, slug?: string) => {
    setAccessToken(token);
    if (slug) {
      const clean = slug.trim().toLowerCase();
      setTenantSlug(clean);
      setTenantSlugState(clean);
      setKnownSlugs(loadKnownSlugs(clean));
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    }
    setUser(nextUser);
  }, []);

  const switchWorkspace = useCallback(
    (nextSlug: string, locale?: string) => {
      const clean = nextSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!clean) return;
      setTenantSlug(clean);
      setTenantSlugState(clean);
      setKnownSlugs(loadKnownSlugs(clean));

      const detectedLocale = locale || pathname.match(/^\/(ar|en)(?=\/|$)/)?.[1] || 'ar';
      if (isNativeBuild()) {
        router.push(`/${detectedLocale}/venue`);
        return;
      }
      const hasTenantPrefix = /^\/(ar|en)\/t\/[a-z0-9-]+(\/.*)?$/i.test(pathname);
      if (hasTenantPrefix) {
        const nextPath = pathname.replace(/^\/(ar|en)\/t\/[a-z0-9-]+/i, `/${detectedLocale}/t/${clean}`);
        router.push(nextPath);
      } else {
        router.push(`/${detectedLocale}/t/${clean}/venue`);
      }
    },
    [pathname, router]
  );

  const logout = useCallback(
    (redirectLocale?: string) => {
      clearAuthStorage();
      setUser(null);
      setTenantSlugState('almassa');
      const detectedLocale =
        redirectLocale ||
        (typeof window !== 'undefined' ? window.location.pathname.match(/^\/(ar|en)(?=\/|$)/)?.[1] : undefined) ||
        'ar';
      router.push(`/${detectedLocale}/login`);
    },
    [router]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        tenantSlug,
        knownSlugs,
        switchWorkspace,
        refreshUser,
        setSession,
        loginSession: setSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
