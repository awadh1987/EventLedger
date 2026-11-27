"use client";

import React, { useEffect, useState } from "react";
import { resolveTenantSlug } from "@/lib/tenant-slug";

type MediaItem = {
  url: string;
  media_type: "image" | "video" | "youtube";
  caption_ar?: string;
  caption_en?: string;
};

type HallMediaEntry = {
  id: string;
  name: string;
  name_ar?: string;
  capacity_banquet?: number;
  capacity_theater?: number;
  base_price?: number;
  media?: {
    cover_image_url?: string | null;
    items?: MediaItem[];
  };
};

function toYoutubeEmbed(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : url;
}

export default function HallMediaShowcase({
  locale = "ar",
  tenantSlug,
}: {
  locale?: "ar" | "en";
  tenantSlug?: string | null;
}) {
  const isRtl = locale === "ar";
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [halls, setHalls] = useState<HallMediaEntry[]>([]);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

  useEffect(() => {
    const slug = (tenantSlug || resolveTenantSlug() || "").trim();
    if (!slug) return;
    fetch(`${apiBase}/public/venue/media`, {
      headers: { "X-Tenant-Slug": slug },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setLogoUrl(data.profile_media?.logo_dark_url || data.profile_media?.logo_light_url || null);
        setHalls(data.halls || []);
      })
      .catch(() => {});
  }, [apiBase, tenantSlug]);

  const hasAnyMedia =
    Boolean(logoUrl) ||
    halls.some((h) => h.media?.cover_image_url || (h.media?.items && h.media.items.length > 0));

  if (!hasAnyMedia) return null;

  return (
    <section className="mx-auto max-w-6xl space-y-8 px-4 py-12" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center gap-4 border-b border-slate-200 pb-4 dark:border-amber-500/30">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Venue Logo"
            className="h-16 w-16 rounded-full border-2 border-[var(--brand-primary,#D4AF37)] object-cover"
          />
        )}
        <div className="text-start">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-[var(--brand-primary,#D4AF37)]">
            {tr("معرض الصور والفيديوهات", "Hall Gallery & Virtual Tour")}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {tr(
              "استعرض قاعاتنا وتجهيزاتها بالصور والفيديو قبل حجز موعد مناسبتك",
              "Explore our halls, setups, and virtual tours before locking your event date"
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {halls.map((hall) => {
          const items = hall.media?.items || [];
          if (!hall.media?.cover_image_url && items.length === 0) return null;
          const hallTitle = isRtl ? hall.name_ar || hall.name : hall.name || hall.name_ar;
          const hallAlt = isRtl ? hall.name : hall.name_ar;
          return (
            <div
              key={hall.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-start shadow-sm dark:border-amber-500/25 dark:bg-slate-900/90"
            >
              {hall.media?.cover_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hall.media.cover_image_url}
                  alt={hallTitle}
                  className="h-60 w-full object-cover"
                />
              )}
              <div className="space-y-4 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-[var(--brand-primary,#D4AF37)]">
                    {hallTitle}
                  </h3>
                  {hallAlt && hallAlt !== hallTitle && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{hallAlt}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {items.map((item, idx) => {
                    const caption = isRtl ? item.caption_ar || item.caption_en : item.caption_en || item.caption_ar;
                    return (
                      <div
                        key={idx}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950"
                      >
                        {item.media_type === "video" ? (
                          <video src={item.url} controls className="h-40 w-full object-cover" />
                        ) : item.media_type === "youtube" ? (
                          <iframe
                            src={toYoutubeEmbed(item.url)}
                            title={caption || "Hall Video"}
                            className="h-40 w-full"
                            allowFullScreen
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.url}
                            alt={caption || hallTitle}
                            className="h-40 w-full object-cover"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
