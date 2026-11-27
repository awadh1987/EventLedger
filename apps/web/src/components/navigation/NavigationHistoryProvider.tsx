'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { tenantPath } from '@/lib/api';
import { useAuthSession } from '@/components/providers/auth-provider';

const NAV_STACK_KEY = 'el_nav_stack';
const SIDEBAR_COLLAPSED_KEY = 'el_sidebar_collapsed';
const MAX_STACK_ENTRIES = 30;

interface NavigationHistoryContextValue {
  stack: string[];
  canGoBack: boolean;
  previousPath: string | null;
  currentSearch: string;
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  goBack: (fallbackHref?: string, skipDirtyCheck?: boolean) => void;
  computeParentFallback: (path?: string) => string;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (open: boolean) => void;
}

const NavigationHistoryContext = createContext<NavigationHistoryContextValue>({
  stack: [],
  canGoBack: false,
  previousPath: null,
  currentSearch: '',
  isDirty: false,
  setDirty: () => undefined,
  goBack: () => undefined,
  computeParentFallback: (p) => p || '/ar',
  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => undefined,
  mobileDrawerOpen: false,
  setMobileDrawerOpen: () => undefined,
});

export function useNavigationHistory() {
  return useContext(NavigationHistoryContext);
}

export function useDirtyFormGuard(dirty: boolean) {
  const { setDirty } = useNavigationHistory();

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

function readStack(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(NAV_STACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStack(next: string[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(next.slice(-MAX_STACK_ENTRIES)));
  } catch {
    // ignore storage quota errors
  }
}

export function NavigationHistoryProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/ar';
  const router = useRouter();
  const { tenantSlug } = useAuthSession();

  const [stack, setStack] = useState<string[]>([]);
  const [currentSearch, setCurrentSearch] = useState('');
  const [isDirty, setDirty] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch {
      // ignore
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  const syncRouteEntry = useCallback(() => {
    if (typeof window === 'undefined') return;
    const search = window.location.search || '';
    setCurrentSearch(search);
    const full = `${pathname}${search}`;
    const existing = readStack();
    if (existing[existing.length - 1] !== full) {
      const updated = [...existing, full].slice(-MAX_STACK_ENTRIES);
      writeStack(updated);
      setStack(updated);
    } else {
      setStack(existing);
    }
    setMobileDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    syncRouteEntry();
  }, [syncRouteEntry]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUrlChange = () => syncRouteEntry();
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('el:navchange', onUrlChange);
    return () => {
      window.removeEventListener('popstate', onUrlChange);
      window.removeEventListener('el:navchange', onUrlChange);
    };
  }, [syncRouteEntry]);

  const computeParentFallback = useCallback(
    (targetPath?: string): string => {
      const activePath = targetPath || pathname || '/ar';
      const locale = activePath.startsWith('/en') ? 'en' : 'ar';
      const pathSlug = activePath.match(/^\/(?:ar|en)\/t\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || tenantSlug;
      const rel = activePath.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';

      if (
        rel.startsWith('/erp/settings') ||
        rel.startsWith('/erp/finance') ||
        rel.startsWith('/erp/ops') ||
        rel.startsWith('/gate')
      ) {
        return tenantPath(locale, pathSlug, '/erp/dashboard');
      }
      if (rel.startsWith('/erp/dashboard')) {
        return pathSlug ? tenantPath(locale, pathSlug, '/venue') : `/${locale}`;
      }
      if (rel.startsWith('/portal/events')) {
        return tenantPath(locale, pathSlug, '/portal/dashboard');
      }
      if (rel.startsWith('/portal/dashboard') || rel.startsWith('/portal/login') || rel.startsWith('/staff-login')) {
        return pathSlug ? tenantPath(locale, pathSlug, '/venue') : `/${locale}`;
      }
      if (rel.startsWith('/venue') || rel.startsWith('/admin') || rel.startsWith('/saas-portal') || rel.startsWith('/login')) {
        return `/${locale}`;
      }
      return `/${locale}`;
    },
    [pathname, tenantSlug]
  );

  const goBack = useCallback(
    (fallbackHref?: string, skipDirtyCheck = false) => {
      const locale = pathname.startsWith('/en') ? 'en' : 'ar';
      if (!skipDirtyCheck && isDirty && typeof window !== 'undefined') {
        const msg =
          locale === 'ar'
            ? 'لديك تغييرات غير محفوظة. هل تريد المغادرة على أي حال؟'
            : 'You have unsaved changes. Leave this view anyway?';
        if (!window.confirm(msg)) return;
        setDirty(false);
      }

      const existing = readStack();
      const fullCurrent = `${pathname}${typeof window !== 'undefined' ? window.location.search : ''}`;
      if (existing.length > 1) {
        const trimmed = existing[existing.length - 1] === fullCurrent ? existing.slice(0, -1) : existing;
        const target = trimmed[trimmed.length - 1];
        writeStack(trimmed);
        setStack(trimmed);
        if (target && target !== fullCurrent) {
          router.push(target);
          return;
        }
      }

      const parent = fallbackHref || computeParentFallback(pathname);
      router.push(parent);
    },
    [computeParentFallback, isDirty, pathname, router]
  );

  const previousPath = stack.length > 1 ? stack[stack.length - 2] : null;
  const relCurrent = pathname.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';
  const canGoBack = Boolean(previousPath) || (relCurrent !== '/' && relCurrent !== '');

  const value = useMemo<NavigationHistoryContextValue>(
    () => ({
      stack,
      canGoBack,
      previousPath,
      currentSearch,
      isDirty,
      setDirty,
      goBack,
      computeParentFallback,
      sidebarCollapsed,
      toggleSidebarCollapsed,
      mobileDrawerOpen,
      setMobileDrawerOpen,
    }),
    [
      canGoBack,
      computeParentFallback,
      currentSearch,
      goBack,
      isDirty,
      mobileDrawerOpen,
      previousPath,
      sidebarCollapsed,
      stack,
      toggleSidebarCollapsed,
    ]
  );

  return <NavigationHistoryContext.Provider value={value}>{children}</NavigationHistoryContext.Provider>;
}
