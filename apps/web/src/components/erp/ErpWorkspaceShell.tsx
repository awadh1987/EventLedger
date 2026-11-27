"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [venueName, setVenueName] = useState<string>("قصر الأمراء للمؤتمرات والأفراح");
  const [openSectors, setOpenSectors] = useState<Record<string, boolean>>({
    overview: true,
    bookings: true,
    operations: true,
    finance: true,
    media: true,
    portal: true,
  });

  const locale = pathname.startsWith("/en") ? "en" : "ar";
  const isRtl = locale === "ar";
  const slugMatch = pathname.match(/\/t\/([^/]+)/);
  const slug =
    slugMatch?.[1] ||
    (typeof window !== "undefined" ? window.location.hostname.split(".")[0] : "qasralomara") ||
    "qasralomara";

  const erpBase = `/${locale}/t/${slug}/erp`;
  const portalBase = `/${locale}/t/${slug}/portal`;
  const venueBase = `/${locale}/t/${slug}/venue`;

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
    fetch(`${apiBase}/public/venue/media`, {
      headers: { "X-Tenant-Slug": slug },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.venue_name) setVenueName(data.venue_name);
        setAvatarUrl(data.profile_media?.owner_avatar_url || null);
        setLogoUrl(data.profile_media?.logo_dark_url || data.profile_media?.logo_light_url || null);
      })
      .catch(() => {});
  }, [slug]);

  const hierarchy: NavSector[] = [
    {
      id: "overview",
      labelAr: "1. النظرة العامة واللوحة",
      labelEn: "1. Overview & KPIs",
      href: `${erpBase}/dashboard`,
      children: [
        { href: `${erpBase}/dashboard`, labelAr: "لوحة التحكم الرئيسية", labelEn: "ERP Dashboard" },
      ],
    },
    {
      id: "bookings",
      labelAr: "2. الحجوزات والقاعات",
      labelEn: "2. Bookings & Halls",
      href: `${erpBase}/bookings`,
      children: [
        { href: `${erpBase}/bookings`, labelAr: "سجل الحجوزات والـ 48 ساعة", labelEn: "Bookings & 48h Holds" },
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
      labelAr: "5. الهوية والصور والفيديو",
      labelEn: "5. Branding, Media & Profile",
      href: `${erpBase}/settings/media`,
      children: [
        { href: `${erpBase}/settings/media`, labelAr: "صورة الملف والشعار وصور/فيديو القاعات", labelEn: "Avatar, Logo & Hall Media" },
        { href: `${erpBase}/settings/branding`, labelAr: "تخصيص الألوان والهوية", labelEn: "Theme & Branding" },
      ],
    },
    {
      id: "portal",
      labelAr: "6. بوابة العميل والمخطط",
      labelEn: "6. Client Portal & Floor Plan",
      href: `${portalBase}/dashboard`,
      children: [
        { href: `${portalBase}/dashboard`, labelAr: "لوحة تحكم العميل", labelEn: "Client Control Panel" },
        { href: `${portalBase}/events/EVT-2026-1001/floor-plan`, labelAr: "مصمم مخطط القاعة (Konva)", labelEn: "Interactive Floor Plan" },
      ],
    },
  ];

  const toggleSector = (id: string) => {
    setOpenSectors((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {/* In Arabic RTL, flex-row places the first child on the RIGHT side; in English LTR, on the LEFT side */}
        <div className="flex flex-col lg:flex-row items-start gap-6">
          {/* Hierarchical Main Menu (Right Side in RTL) */}
          <aside className="w-full lg:w-72 shrink-0 rounded-2xl bg-slate-900/95 border border-amber-500/25 p-4 space-y-4">
            {/* Venue & Owner Profile Card */}
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              {avatarUrl || logoUrl ? (
                <img
                  src={avatarUrl || logoUrl || ""}
                  alt={venueName}
                  className="w-12 h-12 rounded-xl object-cover border border-amber-400/60"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 font-bold text-base">
                  {venueName.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-amber-300 truncate">{venueName}</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {isRtl ? "مدير عام · +967777311012" : "Owner · +967777311012"}
                </div>
                <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {slug}.events-ye.services · YER
                </span>
              </div>
            </div>

            {/* Hierarchical Main Menu Tree */}
            <nav aria-label={isRtl ? "القائمة الرئيسية الهرمية" : "Hierarchical Main Menu"} className="space-y-2">
              {hierarchy.map((sector) => {
                const isSectorOpen = openSectors[sector.id] ?? true;
                const hasActiveChild = sector.children.some((c) => pathname.startsWith(c.href));

                return (
                  <div
                    key={sector.id}
                    className={`rounded-xl border transition ${
                      hasActiveChild
                        ? "border-amber-500/40 bg-slate-950/80"
                        : "border-slate-800/80 bg-slate-950/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSector(sector.id)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-amber-300 hover:text-amber-200 text-start"
                    >
                      <span>{isRtl ? sector.labelAr : sector.labelEn}</span>
                      <span className="text-slate-400 text-[11px]">{isSectorOpen ? "▾" : "▸"}</span>
                    </button>

                    {isSectorOpen && (
                      <ul className="px-2 pb-2 space-y-1 border-t border-slate-800/60 pt-1.5">
                        {sector.children.map((child) => {
                          const active = pathname === child.href || pathname.startsWith(child.href + "/");
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                className={`block rounded-lg px-3 py-2 text-xs transition ${
                                  active
                                    ? "bg-amber-500 text-slate-950 font-bold"
                                    : "text-slate-300 hover:bg-slate-800/90 hover:text-amber-200"
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

          {/* Main Content Area */}
          <main className="flex-1 min-w-0 space-y-6">
            <div className="border-b border-slate-800 pb-4 space-y-1">
              <h1 className="text-xl sm:text-2xl font-bold text-amber-400">{title}</h1>
              {subtitle && <p className="text-xs sm:text-sm text-slate-400">{subtitle}</p>}
            </div>

            <div className="space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
