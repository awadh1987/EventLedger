"use client";

import React, { useEffect, useState } from "react";

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

export default function HallMediaShowcase() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [halls, setHalls] = useState<HallMediaEntry[]>([]);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

  useEffect(() => {
    const slug = window.location.hostname.split(".")[0] || "qasralomara";
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
  }, [apiBase]);

  const hasAnyMedia =
    Boolean(logoUrl) ||
    halls.some((h) => h.media?.cover_image_url || (h.media?.items && h.media.items.length > 0));

  if (!hasAnyMedia) return null;

  return (
    <section className="max-w-6xl mx-auto px-4 py-12 space-y-8" dir="rtl">
      <div className="flex items-center gap-4 border-b border-amber-500/30 pb-4">
        {logoUrl && (
          <img
            src={logoUrl}
            alt="Venue Logo"
            className="w-16 h-16 rounded-full object-cover border-2 border-amber-400"
          />
        )}
        <div>
          <h2 className="text-2xl font-bold text-amber-400">
            معرض الصور والفيديوهات | Hall Gallery & Virtual Tour
          </h2>
          <p className="text-sm text-slate-400">
            استعرض قاعاتنا وتجهيزاتها بالصور والفيديو قبل حجز موعد مناسبتك
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {halls.map((hall) => {
          const items = hall.media?.items || [];
          if (!hall.media?.cover_image_url && items.length === 0) return null;
          return (
            <div key={hall.id} className="rounded-2xl bg-slate-900/90 border border-amber-500/25 overflow-hidden">
              {hall.media?.cover_image_url && (
                <img
                  src={hall.media.cover_image_url}
                  alt={hall.name_ar || hall.name}
                  className="w-full h-60 object-cover"
                />
              )}
              <div className="p-5 space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-amber-300">{hall.name_ar || hall.name}</h3>
                  <p className="text-xs text-slate-400">{hall.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {items.map((item, idx) => (
                    <div key={idx} className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                      {item.media_type === "video" ? (
                        <video src={item.url} controls className="w-full h-40 object-cover" />
                      ) : item.media_type === "youtube" ? (
                        <iframe
                          src={toYoutubeEmbed(item.url)}
                          title={item.caption_ar || "Hall Video"}
                          className="w-full h-40"
                          allowFullScreen
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt={item.caption_ar || ""}
                          className="w-full h-40 object-cover"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
