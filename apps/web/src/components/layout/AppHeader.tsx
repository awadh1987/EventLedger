'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Bell, Globe, LogIn, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, X } from 'lucide-react';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { BackButton } from '@/components/ui/BackButton';
import { apiFetch, getAccessToken, localizedVenueName, tenantPath } from '@/lib/api';

interface NavTab {
  key: string;
  href: string;
  labelAr: string;
  labelEn: string;
  match?: RegExp;
  hash?: string;
}

const TENANT_PATH_RE = /^\/(?:ar|en)\/t\/[a-z0-9-]+/i;
const WORKSPACE_PATH_RE = /^\/(?:ar|en)\/(?:venue|portal|erp|gate|staff-login)(?:\/|$)/i;
const SIDEBAR_ROUTE_RE = /^\/(?:(?:ar|en)(?:\/t\/[a-z0-9-]+)?)?\/(?:erp|portal\/dashboard|portal\/events|gate|admin)(?:\/|$)/i;

export function AppHeader({ locale: propLocale, title }: { locale?: 'ar' | 'en'; title?: string }) {
  const [mounted, setMounted] = useState(false);
  const [hash, setHash] = useState('');
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState<
    { id: string; title: string; subtitle?: string; badge?: string; href: string; isRead?: boolean }[]
  >([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = propLocale || (params?.locale === 'en' ? 'en' : 'ar');
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const router = useRouter();
  const pathname = usePathname() || `/${locale}`;
  const { resolvedTheme, setTheme } = useTheme();
  const branding = useTenantBranding();
  const { user, tenantSlug, logout } = useAuthSession();
  const { currentSearch, sidebarCollapsed, toggleSidebarCollapsed, setMobileDrawerOpen } = useNavigationHistory();

  useEffect(() => {
    setMounted(true);
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener('hashchange', sync);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickJumpOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!mounted || !user || !getAccessToken()) {
      setPendingAlerts([]);
      setUnreadCount(0);
      return;
    }
    let alive = true;
    const baseHref =
      user.user_type === 'SUPER_ADMIN'
        ? `/${locale}/admin?tab=GOVERNANCE`
        : user.user_type === 'INTERNAL_STAFF'
          ? tenantPath(locale, tenantSlug, '/erp/dashboard?tab=GOVERNANCE')
          : tenantPath(locale, tenantSlug, '/portal/dashboard');
    Promise.allSettled([
      apiFetch<{ unread_count: number; items: { id: string; title: string; content: string; channel: string; delivery_status: string; is_read: boolean }[] }>(
        '/api/v1/notifications?limit=8'
      ),
      apiFetch<{ id: string; draft_type?: string; event_code?: string }[]>('/api/v1/approvals?status=PENDING'),
      apiFetch<{ id: string; request_title?: string; status?: string }[]>('/api/v1/governance/change-requests?status=PENDING'),
    ]).then(([notifRes, appsRes, govRes]) => {
      if (!alive) return;
      const items: { id: string; title: string; subtitle?: string; badge?: string; href: string; isRead?: boolean }[] = [];
      let unread = 0;
      if (notifRes.status === 'fulfilled' && notifRes.value && Array.isArray(notifRes.value.items)) {
        unread += notifRes.value.unread_count || 0;
        for (const n of notifRes.value.items.slice(0, 5)) {
          items.push({
            id: `nt-${n.id}`,
            title: n.title,
            subtitle: n.content,
            badge: `${n.channel} · ${n.delivery_status}`,
            href: user.user_type === 'INTERNAL_STAFF' ? tenantPath(locale, tenantSlug, '/erp/dashboard?tab=INVOICING') : baseHref,
            isRead: n.is_read,
          });
        }
      }
      if (appsRes.status === 'fulfilled' && Array.isArray(appsRes.value)) {
        unread += appsRes.value.length;
        for (const a of appsRes.value.slice(0, 3)) {
          items.push({ id: `ap-${a.id}`, title: `${a.event_code || ''} ${a.draft_type || 'Approval'}`.trim(), href: baseHref });
        }
      }
      if (govRes.status === 'fulfilled' && Array.isArray(govRes.value)) {
        unread += govRes.value.length;
        for (const g of govRes.value.slice(0, 3)) {
          items.push({ id: `gv-${g.id}`, title: g.request_title || 'Governance Request', href: baseHref });
        }
      }
      setPendingAlerts(items);
      setUnreadCount(unread);
    });
    return () => {
      alive = false;
    };
  }, [locale, mounted, tenantSlug, user]);

  const targetLocale = isRtl ? 'en' : 'ar';
  const switchedPath = `${pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${targetLocale}`)}${currentSearch || ''}`;

  const isTenantCtx = TENANT_PATH_RE.test(pathname) || WORKSPACE_PATH_RE.test(pathname);
  const slug = isTenantCtx ? tenantSlug : null;
  const isStaff = user?.user_type === 'INTERNAL_STAFF' || user?.user_type === 'SUPER_ADMIN';
  const hasSidebar = SIDEBAR_ROUTE_RE.test(pathname);

  const relPath = pathname.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';
  const isVenueHome = /^\/venue\/?$/i.test(relPath);
  const showBackButton = relPath !== '/' && relPath !== '' && !isVenueHome;
  const base = `/${locale}`;

  let tabs: NavTab[];
  if (!isTenantCtx) {
    tabs = [
      { key: 'calendar', href: `${base}#booking-calendar`, labelAr: 'تقويم الحجز لثلاثة أشهر', labelEn: '3-Month Booking Calendar', hash: '#booking-calendar' },
      { key: 'venues', href: `${base}#venues`, labelAr: 'القاعات النشطة', labelEn: 'Active Venues', hash: '#venues' },
      { key: 'experience', href: `${base}#experience`, labelAr: 'لماذا إيفنت ليدجر', labelEn: 'Why EventLedger', hash: '#experience' },
    ];
  } else {
    tabs = [
      { key: 'store', href: tenantPath(locale, slug, '/venue'), labelAr: 'واجهة الحجز', labelEn: 'Booking Storefront', match: /^\/venue(\/|$)/ },
      { key: 'portal', href: tenantPath(locale, slug, '/portal/dashboard'), labelAr: 'بوابة العميل', labelEn: 'Client Portal', match: /^\/portal(\/|$)/ },
      ...(isStaff
        ? [{ key: 'erp', href: tenantPath(locale, slug, '/erp/dashboard'), labelAr: 'لوحة التحكم ERP', labelEn: 'ERP Control Panel', match: /^\/(erp|gate)(\/|$)/ }]
        : []),
    ];
  }

  const quickDestinations = useMemo(() => {
    const list: { labelAr: string; labelEn: string; href: string }[] = [];
    if (!isTenantCtx) {
      list.push(
        { labelAr: 'الصفحة الرئيسية للمنصة', labelEn: 'Platform Home', href: `/${locale}` },
        { labelAr: 'تسجيل منشأة جديدة', labelEn: 'SaaS Venue Onboarding', href: `/${locale}/saas-portal` },
      );
    }
    if (slug || user?.tenant_slug) {
      const s = slug || user?.tenant_slug;
      list.push(
        { labelAr: 'واجهة الحجز العامة', labelEn: 'Venue Booking Storefront', href: tenantPath(locale, s, '/venue') },
        { labelAr: 'لوحة العميل وبوابة الفعاليات', labelEn: 'Client Portal Dashboard', href: tenantPath(locale, s, '/portal/dashboard') },
      );
      if (isStaff) {
        list.push(
          { labelAr: 'لوحة التحكم ERP', labelEn: 'ERP Control Panel', href: tenantPath(locale, s, '/erp/dashboard') },
          { labelAr: 'دفتر الأستاذ والمحاسبة', labelEn: 'General Ledger & Trial Balance', href: tenantPath(locale, s, '/erp/finance/ledger') },
          { labelAr: 'أمر التشغيل الحي BEO', labelEn: 'Live Kitchen & Ops BEO', href: tenantPath(locale, s, '/erp/ops/beo') },
          { labelAr: 'المستخدمون والصلاحيات RBAC', labelEn: 'Users & RBAC', href: tenantPath(locale, s, '/erp/settings/users') },
          { labelAr: 'استوديو الهوية البصرية والثيمات', labelEn: 'Multi-Theme Branding Studio', href: tenantPath(locale, s, '/erp/settings/branding') },
          { labelAr: 'إدارة صور وفيديوهات القاعات', labelEn: 'Media & Gallery Manager', href: tenantPath(locale, s, '/erp/settings/media') },
          { labelAr: 'القوائم المرجعية SystemLookups', labelEn: 'System Lookups', href: tenantPath(locale, s, '/erp/settings/lookups') },
          { labelAr: 'البوابة الأمنية QR', labelEn: 'Security Gate QR', href: tenantPath(locale, s, '/gate') },
        );
      }
    }
    if (!isTenantCtx && user?.user_type === 'SUPER_ADMIN') {
      list.push({ labelAr: 'إدارة المنصة Super Admin', labelEn: 'Platform Super Admin Console', href: `/${locale}/admin` });
    }
    const q = quickQuery.trim().toLowerCase();
    return q
      ? list.filter((it) => it.labelAr.toLowerCase().includes(q) || it.labelEn.toLowerCase().includes(q) || it.href.toLowerCase().includes(q))
      : list;
  }, [isStaff, isTenantCtx, locale, quickQuery, slug, user?.tenant_slug, user?.user_type]);

  const isActive = (tab: NavTab): boolean => {
    if (tab.hash) return relPath === '/' && mounted && hash === tab.hash;
    if (tab.match) return tab.match.test(relPath);
    return false;
  };

  const tenantName = localizedVenueName(branding.venueName, locale) || branding.venueName;
  const logoSrc = resolvedTheme === 'dark' ? branding.logoDarkUrl || branding.logoLightUrl : branding.logoLightUrl || branding.logoDarkUrl;

  const brandHref = isTenantCtx ? tenantPath(locale, slug, '/venue') : base;
  const brandLabel = title
    ? localizedVenueName(title, locale) || title
    : isTenantCtx
      ? tenantName
      : tr('إيفنت ليدجر', 'EventLedger');

  const ctaHref = tenantPath(locale, slug, '/venue');
  const ctaLabel = isStaff ? tr('+ حجز جديد', '+ New Booking') : tr('احجز قاعة', 'Reserve a Hall');
  const signInHref = isTenantCtx ? tenantPath(locale, slug, '/portal/login') : `${base}/login`;
  const signUpHref = isTenantCtx ? `${tenantPath(locale, slug, '/portal/login')}?tab=register` : `${base}/login?tab=register`;

  const tabClass = (active: boolean) =>
    `whitespace-nowrap border-b-2 px-1 py-5 text-xs transition ${active
      ? 'border-[var(--brand-primary)] font-semibold text-slate-900 dark:text-white'
      : 'border-transparent font-medium text-slate-600 hover:text-[var(--brand-primary,#D4AF37)] dark:text-slate-300'
    }`;

  const renderTabs = (extra = '') =>
    tabs.map((tab) => {
      const active = isActive(tab);
      return (
        <Link key={tab.key} href={tab.href} aria-current={active ? 'page' : undefined} className={`${tabClass(active)} ${extra}`}>
          {isRtl ? tab.labelAr : tab.labelEn}
        </Link>
      );
    });

  return (
    <header
      dir={isRtl ? 'rtl' : 'ltr'}
      className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {hasSidebar && (
            <>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                aria-label={tr('فتح القائمة', 'Open navigation drawer')}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                aria-label={tr('تبديل القائمة الجانبية', 'Toggle sidebar')}
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 lg:inline-flex"
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </>
          )}

          {showBackButton && <BackButton locale={locale} compact />}

          <Link href={brandHref} className="flex min-w-0 shrink items-center gap-2 font-bold">
            {!isTenantCtx ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/brand/eventledger-logo.svg"
                alt="EventLedger"
                className="h-8 w-auto max-w-[150px] object-contain"
              />
            ) : mounted && logoSrc ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoSrc} alt={tenantName} className="h-8 w-auto max-w-[100px] rounded-md object-contain" />
                <span className="max-w-[140px] truncate text-start text-sm sm:text-base">{brandLabel}</span>
              </>
            ) : (
              <>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-extrabold text-slate-950">
                  {mounted ? tenantName.trim().charAt(0).toUpperCase() || 'V' : 'EL'}
                </span>
                <span className="max-w-[140px] truncate text-start text-sm sm:text-base">
                  {mounted ? brandLabel : 'EventLedger'}
                </span>
              </>
            )}
          </Link>
        </div>

        <nav className="hidden items-stretch gap-5 lg:flex" aria-label="Primary">
          {renderTabs()}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setQuickJumpOpen(true)}
            aria-label={tr('انتقال سريع', 'Quick jump navigation')}
            title={tr('انتقال سريع (Ctrl+K)', 'Quick jump (Ctrl+K)')}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 text-xs font-medium text-slate-600 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{tr('انتقال سريع', 'Quick Jump')}</span>
          </button>

          {mounted && user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                aria-label={tr('الإشعارات والاعتمادات', 'Notifications & Approvals')}
                className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -end-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute end-0 top-11 z-50 max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-start text-xs shadow-xl dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-2 flex items-center justify-between gap-2 font-bold">
                    <span>{tr('الإشعارات والتنبيهات', 'Notifications & Alerts')}</span>
                    <div className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch('/api/v1/notifications/read-all', { method: 'POST' }).catch(() => null);
                            setUnreadCount(0);
                            setPendingAlerts((prev) => prev.map((it) => ({ ...it, isRead: true })));
                          }}
                          className="text-[10px] font-semibold text-[var(--brand-primary,#D4AF37)] underline"
                        >
                          {tr('تحديد الكل كمقروء', 'Mark read')}
                        </button>
                      )}
                      <button type="button" onClick={() => setNotifOpen(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {pendingAlerts.length === 0 ? (
                    <p className="text-slate-500">{tr('لا توجد إشعارات معلقة حالياً.', 'No pending notifications.')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {pendingAlerts.map((item) => (
                        <Link
                          key={item.id}
                          href={item.href}
                          onClick={() => setNotifOpen(false)}
                          className={`block rounded-lg border px-2.5 py-2 hover:border-[var(--brand-primary,#D4AF37)] ${
                            item.isRead === false
                              ? 'border-amber-500/40 bg-amber-500/5'
                              : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="font-bold">{item.title}</div>
                          {item.subtitle && <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{item.subtitle}</div>}
                          {item.badge && <div className="mt-0.5 font-mono text-[10px] text-emerald-500">{item.badge}</div>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {mounted ? (
              resolvedTheme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>

          <Link
            href={switchedPath}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{isRtl ? 'EN' : 'عربي'}</span>
          </Link>

          {isTenantCtx && (
            <Link
              href={ctaHref}
              className="hidden h-9 shrink-0 items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950 shadow transition hover:opacity-90 xl:inline-flex"
            >
              {ctaLabel}
            </Link>
          )}

          {mounted && user ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 py-1 ps-2.5 pe-1 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="max-w-[110px] truncate font-semibold text-slate-800 dark:text-slate-200">{user.full_name}</span>
              <button
                type="button"
                onClick={() => logout(locale)}
                aria-label={tr('تسجيل الخروج', 'Log out')}
                title={tr('تسجيل الخروج', 'Log out')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-rose-600 transition hover:bg-rose-500/15 dark:text-rose-400"
              >
                ⇥
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Link
                href={signInHref}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-800 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:text-white"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tr('تسجيل الدخول', 'Sign In')}</span>
              </Link>
              <Link
                href={signUpHref}
                className="hidden h-9 shrink-0 items-center rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950 shadow transition hover:opacity-90 sm:inline-flex"
              >
                {tr('إنشاء حساب', 'Create Account')}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile / tablet tab strip */}
      <nav className="flex gap-5 overflow-x-auto border-t border-slate-200/60 px-4 dark:border-slate-800/60 lg:hidden" aria-label="Primary mobile">
        {renderTabs('!py-3')}
      </nav>

      {/* Quick Jump Palette Modal */}
      {quickJumpOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 p-4 pt-20 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 text-start shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                autoFocus
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder={tr('ابحث للانتقال إلى أي صفحة أو لوحة...', 'Jump to any workspace route or tool...')}
                className="w-full bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setQuickJumpOpen(false);
                  setQuickQuery('');
                }}
                aria-label="Close"
                className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {quickDestinations.map((dest) => (
                <button
                  key={dest.href}
                  type="button"
                  onClick={() => {
                    setQuickJumpOpen(false);
                    setQuickQuery('');
                    router.push(dest.href);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span>{tr(dest.labelAr, dest.labelEn)}</span>
                  <span dir="ltr" className="font-mono text-[10px] text-slate-400">
                    {dest.href}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
