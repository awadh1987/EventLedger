'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Calendar,
  ClipboardCheck,
  CreditCard,
  LogIn,
  LogOut,
  MapPin,
  MessageSquare,
  Mic,
  Moon,
  Package,
  Palette,
  Plus,
  Search,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { BookingsCalendar } from '@/components/erp/BookingsCalendar';
import { EventLedgerAssistant, type AssistantTab } from '@/components/erp/EventLedgerAssistant';
import { CatalogControlPanel } from '@/components/erp/CatalogControlPanel';
import { FinanceInvoicingPanel } from '@/components/erp/FinanceInvoicingPanel';
import { OperationsBeoPanel } from '@/components/erp/OperationsBeoPanel';
import { TenantBrandingStudio } from '@/components/erp/TenantBrandingStudio';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import type { HallInfo, ScheduledEvent } from '@/lib/bookings-store';

type ErpTab = 'schedule' | 'catalog' | 'finance' | 'operations' | 'branding';

export default function ErpDashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const altLocale = isRtl ? 'en' : 'ar';
  const { resolvedTheme, setTheme } = useTheme();
  const { user, loading: authLoading, authError, signInWithGoogle, signOutUser, authFetch } = useAuth();
  const branding = useTenantBranding();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ErpTab>('schedule');
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>('chat');

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchBookings = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/v1/bookings/events', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || 'Failed to load scheduled events');
      }
      setHalls(Array.isArray(data?.halls) ? data.halls : []);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isRtl
          ? 'تعذر تحميل جدول الحجوزات. يرجى المحاولة مرة أخرى.'
          : 'Unable to load scheduled events. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [authFetch, isRtl, user]);

  useEffect(() => {
    if (!authLoading) {
      fetchBookings();
    }
  }, [authLoading, fetchBookings]);

  const handleEventCreated = useCallback((created: ScheduledEvent) => {
    setEvents((prev) =>
      [...prev, created].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    );
  }, []);

  const handleEventUpdated = useCallback((updated: ScheduledEvent) => {
    setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)));
  }, []);

  const openAssistantOn = (tab: AssistantTab) => {
    setAssistantTab(tab);
    setAssistantOpen(true);
  };

  const summary = useMemo(() => {
    const now = Date.now();
    const in30Days = now + 30 * 24 * 60 * 60 * 1000;
    const activeUpcoming = events.filter((ev) => {
      const startMs = new Date(ev.startTime).getTime();
      return startMs >= now - 24 * 60 * 60 * 1000 && startMs <= in30Days && ev.status !== 'CANCELLED';
    });

    const confirmedCount = activeUpcoming.filter((ev) => ev.status === 'CONFIRMED').length;
    const pendingCount = activeUpcoming.filter(
      (ev) => ev.status === 'HOLD_48H' || ev.status === 'CONTRACT_PENDING' || ev.status === 'INQUIRY'
    ).length;
    const expectedGuests = activeUpcoming.reduce((sum, ev) => sum + ev.guestCount, 0);

    return {
      upcomingCount: activeUpcoming.length,
      confirmedCount,
      pendingCount,
      expectedGuests,
    };
  }, [events]);

  const searchMatchCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return events.length;
    return events.filter((ev) =>
      [ev.eventCode, ev.titleEn, ev.titleAr, ev.clientNameEn, ev.clientNameAr, ev.hallNameEn, ev.hallNameAr]
        .join(' ')
        .toLowerCase()
        .includes(q)
    ).length;
  }, [events, searchQuery]);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:pb-12">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-8 px-6 py-4">
          <Link
            href={`/${locale}/dashboard`}
            className="shrink-0 whitespace-nowrap text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {isRtl ? branding.venueNameAr : branding.venueNameEn}
          </Link>

          <nav
            aria-label={isRtl ? 'التنقل الرئيسي' : 'Primary navigation'}
            className="hidden items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400 md:flex"
          >
            <Link
              href={`/${locale}/dashboard`}
              className="shrink-0 whitespace-nowrap text-slate-900 underline decoration-[var(--brand-primary,#D4AF37)] decoration-2 underline-offset-8 dark:text-slate-100"
            >
              {isRtl ? 'لوحة التحكم ERP' : 'ERP Control Panel'}
            </Link>
            <Link
              href={`/${locale}/venue`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'صفحة الحجز للعملاء' : 'Venue Storefront'}
            </Link>
            <Link
              href={`/${locale}/portal/dashboard`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'بوابة العميل' : 'Client Portal'}
            </Link>
            <Link
              href={`/${locale}`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'المنصة السحابية' : 'SaaS Home'}
            </Link>
            <Link
              href={`/${altLocale}/dashboard`}
              className="shrink-0 whitespace-nowrap transition-colors hover:text-slate-900 dark:hover:text-slate-100"
            >
              {isRtl ? 'English' : 'العربية'}
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2.5">
            {user ? (
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
              >
                <Plus className="h-4 w-4" />
                <span>{isRtl ? 'حجز جديد' : 'New Booking'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90"
              >
                <LogIn className="h-4 w-4" />
                <span>{isRtl ? 'دخول بحساب Google' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main ERP Workspace */}
      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        {/* Page Heading + Workspace Utilities */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {isRtl ? 'لوحة تحكم الصالة والعمليات الشاملة' : 'Tenant Operations & Venue Control Panel'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {isRtl
                ? 'إدارة جدول الحجوزات، القاعات والأصناف والضيافة، الفواتير ووسائل الدفع وPDF، أوامر التشغيل BEO، وهوية الصالة التجارية.'
                : 'Manage reservations, halls & add-on catalog, invoicing & payment channels with PDF export, live BEO ops, and white-label tenant branding.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {user && (
              <>
                <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => openAssistantOn('chat')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-amber-600 dark:text-[#D4AF37]" />
                    <span>{isRtl ? 'مساعد العمليات' : 'AI Chat'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openAssistantOn('voice')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap border-s border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Mic className="h-3.5 w-3.5 text-amber-600 dark:text-[#D4AF37]" />
                    <span>{isRtl ? 'صوت مباشر' : 'Live Voice'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openAssistantOn('maps')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap border-s border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <MapPin className="h-3.5 w-3.5 text-amber-600 dark:text-[#D4AF37]" />
                    <span>{isRtl ? 'الخرائط' : 'Maps'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={signOutUser}
                  title={user.email || ''}
                  className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="max-w-[140px] truncate">{user.displayName || user.email}</span>
                  <LogOut className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </>
            )}

            <Link
              href={`/${altLocale}/dashboard`}
              className="inline-flex min-h-[38px] items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
            >
              {isRtl ? 'English' : 'العربية'}
            </Link>

            {mounted && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                aria-label={isRtl ? 'تبديل المظهر' : 'Toggle theme'}
                className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {resolvedTheme === 'dark' ? (
                  <>
                    <Sun className="h-3.5 w-3.5" />
                    <span>{isRtl ? 'نهاري' : 'Light'}</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-3.5 w-3.5" />
                    <span>{isRtl ? 'ليلي' : 'Dark'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Authentication Gate for Protected ERP Workspace */}
        {!authLoading && !user ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-[#D4AF37]/30 dark:bg-[#D4AF37]/10 dark:text-[#D4AF37]">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'تسجيل الدخول إلى مساحة عمليات قصر الماسة' : 'Sign in to Al-Massa Operations Workspace'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {isRtl
                ? 'قم بتسجيل الدخول بحساب Google للوصول إلى جدول الحجوزات الموحد، المحادثة الذكية، المساعد الصوتي المباشر، وبحث المواقع والموردين.'
                : 'Sign in with your Google account to manage hall bookings, access the AI operations concierge, live voice assistant, and Google Maps vendor discovery.'}
            </p>
            {authError && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                {authError}
              </div>
            )}
            <div className="mt-6">
              <button
                type="button"
                onClick={signInWithGoogle}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 py-2.5 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90"
              >
                <LogIn className="h-4 w-4" />
                <span>{isRtl ? 'المتابعة باستخدام Google' : 'Continue with Google'}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 5-Module Tenant ERP Control Panel Navigation */}
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
              {(
                [
                  { id: 'schedule', ar: 'جدول الحجوزات', en: 'Schedule & Calendar', icon: Calendar },
                  { id: 'catalog', ar: 'الأصناف والقاعات والضيافة', en: 'Items & Catalog', icon: Package },
                  { id: 'finance', ar: 'الفواتير والمدفوعات وPDF', en: 'Invoicing & Payments', icon: CreditCard },
                  { id: 'operations', ar: 'التشغيل BEO والاعتمادات وQR', en: 'Operations & BEO', icon: ClipboardCheck },
                  { id: 'branding', ar: 'هوية الصالة والتصميم', en: 'Tenant Branding', icon: Palette },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex min-h-[42px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[var(--brand-primary,#D4AF37)] text-slate-900 dark:text-slate-100'
                        : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{isRtl ? tab.ar : tab.en}</span>
                  </button>
                );
              })}
            </div>

            {activeTab === 'schedule' && (
              <>
                {/* 4-Column Operational Summary Strip (Single Elevation, Hairline Dividers, Zero Pills) */}
                <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  <div className="px-5 py-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isRtl ? 'الحجوزات القادمة (30 يوماً)' : 'Upcoming (30 Days)'}
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {loading || authLoading ? '—' : summary.upcomingCount}
                    </div>
                  </div>

                  <div className="px-5 py-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isRtl ? 'فعاليات مؤكدة' : 'Confirmed Events'}
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {loading || authLoading ? '—' : summary.confirmedCount}
                    </div>
                  </div>

                  <div className="px-5 py-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isRtl ? 'حجوزات مؤقتة وبانتظار العقد' : 'Holds & Pending'}
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {loading || authLoading ? '—' : summary.pendingCount}
                    </div>
                  </div>

                  <div className="px-5 py-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isRtl ? 'إجمالي الضيوف المتوقع' : 'Expected Guests (30d)'}
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {loading || authLoading
                        ? '—'
                        : new Intl.NumberFormat(isRtl ? 'ar-YE' : 'en-US').format(summary.expectedGuests)}
                    </div>
                  </div>
                </div>

                {/* Real-Time Search Bar Above Calendar */}
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                  <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                  <label htmlFor="erp-calendar-search" className="sr-only">
                    {isRtl ? 'بحث في الفعاليات بالعنوان أو العميل أو القاعة' : 'Search events by title, client name, or hall name'}
                  </label>
                  <input
                    id="erp-calendar-search"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && searchQuery) {
                        setSearchQuery('');
                      }
                    }}
                    placeholder={
                      isRtl
                        ? 'ابحث في الفعاليات بعنوان الحفل، اسم العميل، أو اسم القاعة...'
                        : 'Search scheduled events by title, client name, or hall name...'
                    }
                    className="min-h-[36px] min-w-[200px] flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                  />
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums">
                      {loading || authLoading
                        ? '—'
                        : searchQuery.trim()
                        ? isRtl
                          ? `${searchMatchCount} من ${events.length} فعالية`
                          : `${searchMatchCount} of ${events.length} matching`
                        : isRtl
                        ? `${events.length} فعالية`
                        : `${events.length} events`}
                    </span>
                    {searchQuery.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label={isRtl ? 'مسح البحث' : 'Clear search'}
                        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary,#D4AF37)] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>{isRtl ? 'مسح' : 'Clear'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Focal Anchor: Interactive Venue Bookings Calendar */}
                <BookingsCalendar
                  locale={locale}
                  events={events}
                  halls={halls}
                  loading={loading || authLoading}
                  error={error}
                  onRetry={fetchBookings}
                  onEventCreated={handleEventCreated}
                  onEventUpdated={handleEventUpdated}
                  createModalOpen={createModalOpen}
                  onCreateModalChange={setCreateModalOpen}
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                />
              </>
            )}

            {activeTab === 'catalog' && (
              <CatalogControlPanel locale={locale} onCatalogChanged={fetchBookings} />
            )}

            {activeTab === 'finance' && (
              <FinanceInvoicingPanel locale={locale} events={events} onDataChanged={fetchBookings} />
            )}

            {activeTab === 'operations' && (
              <OperationsBeoPanel locale={locale} events={events} onDataChanged={fetchBookings} />
            )}

            {activeTab === 'branding' && <TenantBrandingStudio locale={locale} />}
          </>
        )}
      </main>

      <EventLedgerAssistant
        locale={locale}
        open={assistantOpen}
        activeTab={assistantTab}
        onTabChange={setAssistantTab}
        onClose={() => setAssistantOpen(false)}
      />

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
