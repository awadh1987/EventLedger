"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthSession } from "@/components/providers/auth-provider";
import { useTenantBranding } from "@/components/providers/theme-branding-provider";
import { BackButton } from "@/components/ui/BackButton";
import { resolveTenantSlug } from "@/lib/tenant-slug";

type NavChild = {
  href: string;
  labelAr: string;
  labelEn: string;
};

type NavSector = {
  id: string;
  labelAr: string;
  labelEn: string;
  href: string;
  children: NavChild[];
};

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export default function ErpWorkspaceShell({ title, subtitle, children }: Props) {
  const pathname = usePathname() || "";
  const { user, tenantSlug } = useAuthSession();
  const branding = useTenantBranding();
  const [openSectors, setOpenSectors] = useState<Record<string, boolean>>({
    overview: true,
    bookings: true,
    operations: true,
    finance: true,
    media: true,
    portal: true,
  });

  const locale: "ar" | "en" = pathname.startsWith("/en") ? "en" : "ar";
  const isRtl = locale === "ar";
  const slugMatch = pathname.match(/\/t\/([^/]+)/);
  const slug = slugMatch?.[1]?.toLowerCase() || tenantSlug || resolveTenantSlug();

  const erpBase = `/${locale}/t/${slug}/erp`;
  const portalBase = `/${locale}/t/${slug}/portal`;
  const venueBase = `/${locale}/t/${slug}/venue`;
  const venueName = branding.venueName || slug;
  const avatarOrLogo = branding.ownerAvatarUrl || branding.logoDarkUrl || branding.logoLightUrl || null;

  const hierarchy: NavSector[] = [
    {
      id: "overview",
      labelAr: "1. النظرة العامة واللوحة",
      labelEn: "1. Overview & KPIs",
      href: `${erpBase}/dashboard`,
      children: [{ href: `${erpBase}/dashboard`, labelAr: "لوحة التحكم الرئيسية", labelEn: "ERP Dashboard" }],
    },
    {
      id: "bookings",
      labelAr: "2. الحجوزات والقاعات",
      labelEn: "2. Bookings & Halls",
      href: `${erpBase}/dashboard?tab=SCHEDULE`,
      children: [
        { href: `${erpBase}/dashboard?tab=SCHEDULE`, labelAr: "سجل الحجوزات والـ 48 ساعة", labelEn: "Bookings & 48h Holds" },
        { href: venueBase, labelAr: "واجهة حجز القاعة العامة", labelEn: "Public Venue Storefront" },
      ],
    },
    {
      id: "operations",
      labelAr: "3. التشغيل والمطبخ والبوابة",
      labelEn: "3. Ops, Kitchen & Gate",
      href: `${erpBase}/ops/beo`,
      children: [
        { href: `${erpBase}/ops/beo`, labelAr: "أمر التشغيل الحي (Live BEO)", labelEn: "Live Kitchen/Ops BEO" },
        { href: `/${locale}/t/${slug}/gate`, labelAr: "ماسح البوابة الأمنية (QR)", labelEn: "Security Gate Scanner" },
      ],
    },
    {
      id: "finance",
      labelAr: "4. المالية والمحاسبة",
      labelEn: "4. Finance & Ledger",
      href: `${erpBase}/finance/ledger`,
      children: [
        { href: `${erpBase}/finance/ledger`, labelAr: "دفتر الأستاذ وميزان المراجعة", labelEn: "General Ledger & Trial Balance" },
        { href: `${erpBase}/settings/lookups`, labelAr: "المحافظ البنكية والتصنيفات", labelEn: "Wallets & System Lookups" },
      ],
    },
    {
      id: "media",
      labelAr: "5. الهوية والمستخدمين والصلاحيات",
      labelEn: "5. Branding, Users & RBAC",
      href: `${erpBase}/settings/media`,
      children: [
        { href: `${erpBase}/settings/users`, labelAr: "إدارة المستخدمين والصلاحيات (RBAC)", labelEn: "Users & RBAC Control Panel" },
        { href: `${erpBase}/settings/media`, labelAr: "صورة الملف والشعار وصور القاعات", labelEn: "Avatar, Logo & Hall Media" },
        { href: `${erpBase}/settings/branding`, labelAr: "استوديو الألوان والثيمات", labelEn: "Multi-Theme Branding Studio" },
      ],
    },
    {
      id: "portal",
      labelAr: "6. بوابة العميل والمخطط",
      labelEn: "6. Client Portal & Floor Plan",
      href: `${portalBase}/dashboard`,
      children: [
        { href: `${portalBase}/dashboard`, labelAr: "لوحة تحكم العميل", labelEn: "Client Control Panel" },
      ],
    },
  ];

  const toggleSector = (id: string) => {
    setOpenSectors((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-[var(--surface-bg)] text-slate-900 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <aside className="w-full lg:w-72 shrink-0 rounded-2xl border border-slate-200 bg-white/95 p-4 space-y-4 shadow-sm dark:border-amber-500/25 dark:bg-slate-900/95">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
              {avatarOrLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarOrLogo}
                  alt={venueName}
                  className="w-12 h-12 rounded-xl object-cover border border-[var(--brand-primary,#D4AF37)]"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-500 font-bold text-base">
                  {venueName.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-[var(--brand-primary,#D4AF37)] truncate">{venueName}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {user ? `${user.full_name} · ${user.staff_role || user.user_type}` : isRtl ? "لوحة المنشأة" : "Tenant Workspace"}
                </div>
                <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30">
                  {slug}.events-ye.services · {branding.currency}
                </span>
              </div>
            </div>

            <nav aria-label={isRtl ? "القائمة الرئيسية الهرمية" : "Hierarchical Main Menu"} className="space-y-2">
              {hierarchy.map((sector) => {
                const isSectorOpen = openSectors[sector.id] ?? true;
                const hasActiveChild = sector.children.some((c) => pathname.startsWith(c.href.split("?")[0]));

                return (
                  <div
                    key={sector.id}
                    className={`rounded-xl border transition ${hasActiveChild
                      ? "border-[var(--brand-primary,#D4AF37)]/50 bg-slate-50 dark:bg-slate-950/80"
                      : "border-slate-200 bg-slate-50/50 dark:border-slate-800/80 dark:bg-slate-950/40"
                      }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSector(sector.id)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-slate-800 hover:text-[var(--brand-primary,#D4AF37)] dark:text-amber-300 text-start"
                    >
                      <span>{isRtl ? sector.labelAr : sector.labelEn}</span>
                      <span className="text-slate-400 text-[11px]">{isSectorOpen ? "▾" : "▸"}</span>
                    </button>

                    {isSectorOpen && (
                      <ul className="px-2 pb-2 space-y-1 border-t border-slate-200 pt-1.5 dark:border-slate-800/60">
                        {sector.children.map((child) => {
                          const bare = child.href.split("?")[0];
                          const active = pathname === bare || pathname.startsWith(bare + "/");
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                className={`block rounded-lg px-3 py-2 text-xs transition ${active
                                  ? "bg-[var(--brand-primary,#D4AF37)] text-slate-950 font-bold"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800/90 dark:hover:text-amber-200"
                                  }`}
                              >
                                {isRtl ? child.labelAr : child.labelEn}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>

          <main className="flex-1 min-w-0 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div className="space-y-1">
                <h1 className="text-xl sm:text-2xl font-bold text-[var(--brand-primary,#D4AF37)]">{title}</h1>
                {subtitle && <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
              </div>
              <BackButton locale={locale} />
            </div>

            <div className="space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
