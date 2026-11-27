'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BookOpen,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Home,
  LayoutDashboard,
  Layers,
  ListChecks,
  Lock,
  Palette,
  QrCode,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { localizedVenueName, tenantPath } from '@/lib/api';

type SidebarSection = {
  id: string;
  labelAr: string;
  labelEn: string;
  items: {
    key: string;
    href: string;
    tabParam?: string;
    labelAr: string;
    labelEn: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
};

const WORKSPACE_ROUTE_RE = /^\/(?:(?:ar|en)(?:\/t\/[a-z0-9-]+)?)?\/(?:erp|portal\/dashboard|portal\/events|gate|admin)(?:\/|$)/i;

export function WorkspaceSidebar({
  locale,
  children,
}: {
  locale: 'ar' | 'en';
  children: React.ReactNode;
}) {
  const pathname = usePathname() || `/${locale}`;
  const router = useRouter();
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const { user, tenantSlug } = useAuthSession();
  const branding = useTenantBranding();
  const { currentSearch, sidebarCollapsed, toggleSidebarCollapsed, mobileDrawerOpen, setMobileDrawerOpen } =
    useNavigationHistory();

  const relPath = pathname.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';
  const isWorkspaceRoute = WORKSPACE_ROUTE_RE.test(pathname);
  const effectiveSlug = pathname.match(/^\/(?:ar|en)\/t\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || tenantSlug;
  const activeTabParam = useMemo(() => {
    if (!currentSearch) return '';
    return new URLSearchParams(currentSearch).get('tab') || '';
  }, [currentSearch]);

  const sections: SidebarSection[] = useMemo(() => {
    if (relPath.startsWith('/admin')) {
      return [
        {
          id: 'platform-core',
          labelAr: 'إدارة المنصة',
          labelEn: 'Platform Control',
          items: [
            { key: 'admin-tenants', href: `/${locale}/admin?tab=TENANTS`, tabParam: 'TENANTS', labelAr: 'دليل المنشآت', labelEn: 'Registered Venues', icon: Building2 },
            { key: 'admin-gov', href: `/${locale}/admin?tab=GOVERNANCE`, tabParam: 'GOVERNANCE', labelAr: 'اعتمادات الحوكمة', labelEn: 'Governance Queue', icon: ShieldCheck },
            { key: 'admin-users', href: `/${locale}/admin?tab=USERS`, tabParam: 'USERS', labelAr: 'مستخدمو المنصة', labelEn: 'Platform Users', icon: Users },
          ],
        },
        {
          id: 'platform-links',
          labelAr: 'روابط المنصة',
          labelEn: 'SaaS Portals',
          items: [
            { key: 'saas-onboard', href: `/${locale}/saas-portal`, labelAr: 'تسجيل منشأة جديدة', labelEn: 'Tenant Onboarding', icon: Sparkles },
            { key: 'saas-home', href: `/${locale}`, labelAr: 'الصفحة الرئيسية', labelEn: 'Platform Home', icon: Home },
          ],
        },
      ];
    }

    if (relPath.startsWith('/portal')) {
      return [
        {
          id: 'portal-main',
          labelAr: 'بوابة العميل',
          labelEn: 'Client Portal',
          items: [
            { key: 'p-events', href: tenantPath(locale, effectiveSlug, '/portal/dashboard?tab=EVENTS_APPROVALS'), tabParam: 'EVENTS_APPROVALS', labelAr: 'الفعاليات والاعتمادات', labelEn: 'Events & Approvals', icon: Calendar },
            { key: 'p-invoices', href: tenantPath(locale, effectiveSlug, '/portal/dashboard?tab=INVOICES_PAYMENTS'), tabParam: 'INVOICES_PAYMENTS', labelAr: 'الفواتير والدفعات', labelEn: 'Invoices & Payments', icon: Wallet },
            { key: 'p-profile', href: tenantPath(locale, effectiveSlug, '/portal/dashboard?tab=PROFILE_VAULT'), tabParam: 'PROFILE_VAULT', labelAr: 'الملف وحساب الاسترداد', labelEn: 'Profile & Vault', icon: UserCog },
            { key: 'p-delegation', href: tenantPath(locale, effectiveSlug, '/portal/dashboard?tab=DELEGATION'), tabParam: 'DELEGATION', labelAr: 'تفويض الفريق', labelEn: 'Delegation', icon: Users },
            { key: 'p-passes', href: tenantPath(locale, effectiveSlug, '/portal/dashboard?tab=PASSES_AUDIT'), tabParam: 'PASSES_AUDIT', labelAr: 'تصاريح VIP والتدقيق', labelEn: 'VIP Passes & Audit', icon: QrCode },
          ],
        },
        {
          id: 'portal-store',
          labelAr: 'الواجهة العامة',
          labelEn: 'Storefront',
          items: [
            { key: 'p-venue', href: tenantPath(locale, effectiveSlug, '/venue'), labelAr: 'حجز قاعة جديدة', labelEn: 'Reserve a Hall', icon: Building2 },
          ],
        },
      ];
    }

    // Default: ERP & Gate workspace
    return [
      {
        id: 'erp-core',
        labelAr: 'لوحة التحكم والحوكمة',
        labelEn: 'Command & Governance',
        items: [
          { key: 'e-schedule', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=SCHEDULE'), tabParam: 'SCHEDULE', labelAr: 'الجدول والتقويم', labelEn: 'Schedule & Calendar', icon: LayoutDashboard },
          { key: 'e-gov', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=GOVERNANCE'), tabParam: 'GOVERNANCE', labelAr: 'الحوكمة والاعتمادات', labelEn: 'Governance Queue', icon: ShieldCheck },
          { key: 'e-store', href: tenantPath(locale, effectiveSlug, '/venue'), labelAr: 'الواجهة العامة للقاعة', labelEn: 'Public Storefront', icon: Building2 },
        ],
      },
      {
        id: 'erp-venue',
        labelAr: 'الأصناف والعملاء والمالية',
        labelEn: 'Catalog, Clients & Finance',
        items: [
          { key: 'e-catalog', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=CATALOG'), tabParam: 'CATALOG', labelAr: 'الأصناف والقاعات', labelEn: 'Catalog & Halls', icon: Layers },
          { key: 'e-clients', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=CLIENTS'), tabParam: 'CLIENTS', labelAr: 'حسابات العملاء', labelEn: 'Client Accounts', icon: Users },
          { key: 'e-invoicing', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=INVOICING'), tabParam: 'INVOICING', labelAr: 'الفوترة والدفعات', labelEn: 'Invoicing & Payments', icon: FileText },
          { key: 'e-ledger', href: tenantPath(locale, effectiveSlug, '/erp/finance/ledger'), labelAr: 'دفتر الأستاذ العام', labelEn: 'General Ledger', icon: BookOpen },
        ],
      },
      {
        id: 'erp-ops',
        labelAr: 'التشغيل والبوابة الأمنية',
        labelEn: 'Operations & Gate',
        items: [
          { key: 'e-ops-tab', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=OPERATIONS'), tabParam: 'OPERATIONS', labelAr: 'مراقبة التشغيل والـ BEO', labelEn: 'Operations Control', icon: ClipboardCheck },
          { key: 'e-security', href: tenantPath(locale, effectiveSlug, '/erp/dashboard?tab=SECURITY'), tabParam: 'SECURITY', labelAr: 'الأمن وإغلاق التشغيل', labelEn: 'Events & Halls Security', icon: ShieldCheck },
          { key: 'e-beo', href: tenantPath(locale, effectiveSlug, '/erp/ops/beo'), labelAr: 'أمر التشغيل الحي BEO', labelEn: 'Live Kitchen/Ops BEO', icon: UtensilsCrossed },
          { key: 'e-gate', href: tenantPath(locale, effectiveSlug, '/gate'), labelAr: 'ماسح البوابة الأمنية', labelEn: 'Security Gate QR', icon: Lock },
        ],
      },
      {
        id: 'erp-settings',
        labelAr: 'الإعدادات والصلاحيات والهوية',
        labelEn: 'Settings, RBAC & Branding',
        items: [
          { key: 'e-users', href: tenantPath(locale, effectiveSlug, '/erp/settings/users'), labelAr: 'المستخدمون والصلاحيات', labelEn: 'Users & RBAC', icon: UserCog },
          { key: 'e-branding', href: tenantPath(locale, effectiveSlug, '/erp/settings/branding'), labelAr: 'استوديو الهوية والثيمات', labelEn: 'Multi-Theme Branding', icon: Palette },
          { key: 'e-media', href: tenantPath(locale, effectiveSlug, '/erp/settings/media'), labelAr: 'معرض الصور والفيديو', labelEn: 'Media & Gallery', icon: SlidersHorizontal },
          { key: 'e-lookups', href: tenantPath(locale, effectiveSlug, '/erp/settings/lookups'), labelAr: 'القوائم المرجعية', labelEn: 'System Lookups', icon: ListChecks },
        ],
      },
    ];
  }, [effectiveSlug, locale, relPath]);

  if (!isWorkspaceRoute) {
    return <>{children}</>;
  }

  const navigateItem = (href: string) => {
    setMobileDrawerOpen(false);
    router.push(href);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('el:navchange', { detail: { href } }));
    }
  };

  const isItemActive = (href: string, tabParam?: string) => {
    const bareHref = href.split('?')[0];
    const relTarget = bareHref.replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '') || '/';
    if (tabParam) {
      if (relPath !== relTarget) return false;
      if (activeTabParam) return activeTabParam === tabParam;
      return tabParam === 'SCHEDULE' || tabParam === 'TENANTS' || tabParam === 'EVENTS_APPROVALS';
    }
    return relPath === relTarget || relPath.startsWith(`${relTarget}/`);
  };

  const CollapseChevron = isRtl
    ? sidebarCollapsed
      ? ChevronLeft
      : ChevronRight
    : sidebarCollapsed
      ? ChevronRight
      : ChevronLeft;

  const renderNavBody = (collapsed: boolean) => (
    <div className="flex h-full flex-col justify-between gap-4 p-3">
      <div className="space-y-4">
        {/* Workspace card */}
        <div
          className={`flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/90 p-2.5 dark:border-slate-800 dark:bg-slate-900/90 ${collapsed ? 'justify-center' : ''
            }`}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold"
            style={{
              backgroundColor: 'var(--brand-primary, #D4AF37)',
              color: 'var(--brand-btn-text, #020617)',
            }}
          >
            {(localizedVenueName(branding.venueName, locale) || effectiveSlug || 'EL').trim().charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-start">
              <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                {relPath.startsWith('/admin')
                  ? tr('إدارة منصة EventLedger', 'EventLedger Platform')
                  : localizedVenueName(branding.venueName, locale) || branding.venueName}
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {user?.full_name || (effectiveSlug ? `/${effectiveSlug}` : tr('بوابة العمل', 'Workspace'))}
              </div>
            </div>
          )}
        </div>

        <nav className="space-y-4" aria-label={tr('قائمة لوحة التحكم', 'Workspace sidebar')}>
          {sections.map((sec) => (
            <div key={sec.id} className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {tr(sec.labelAr, sec.labelEn)}
                </div>
              )}
              <div className="space-y-0.5">
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(item.href, item.tabParam);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={(e) => {
                        if (item.tabParam && relPath === item.href.split('?')[0].replace(/^\/(?:ar|en)(?:\/t\/[a-z0-9-]+)?/i, '')) {
                          e.preventDefault();
                          navigateItem(item.href);
                        } else {
                          setMobileDrawerOpen(false);
                        }
                      }}
                      title={collapsed ? tr(item.labelAr, item.labelEn) : undefined}
                      className={`flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${collapsed ? 'justify-center' : ''
                        } ${active
                          ? 'bg-[var(--brand-primary,#D4AF37)] font-bold text-slate-950 shadow-sm'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white'
                        }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{tr(item.labelAr, item.labelEn)}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom collapse toggle (Desktop) */}
      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        className="hidden min-h-[36px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:text-slate-300 lg:flex"
      >
        <CollapseChevron className="h-4 w-4" />
        {!collapsed && <span>{tr('طي القائمة', 'Collapse Sidebar')}</span>}
      </button>
    </div>
  );

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex min-h-screen bg-[var(--surface-bg)]">
      {/* Desktop Sticky Collapsible Rail */}
      <aside
        className={`hidden shrink-0 border-e border-slate-200/80 bg-white/95 transition-all duration-200 dark:border-slate-800 dark:bg-slate-950/95 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'
          }`}
      >
        {renderNavBody(sidebarCollapsed)}
      </aside>

      {/* Mobile / Tablet Slide-Over Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label="Close drawer backdrop"
            onClick={() => setMobileDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-e border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <span className="text-xs font-bold text-[var(--brand-primary,#D4AF37)]">
                {tr('التنقل السريع', 'Workspace Navigation')}
              </span>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1">{renderNavBody(false)}</div>
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
