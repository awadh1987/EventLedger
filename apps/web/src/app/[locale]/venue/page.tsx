'use client';
import HallMediaShowcase from "@/components/venue/HallMediaShowcase";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  MessageCircle,
  Phone,
  Play,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import ThreeMonthBookingEngine, { type StorefrontOffer } from '@/components/booking/ThreeMonthBookingEngine';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, localizedVenueName, tenantPath } from '@/lib/api';
import { resolveTenantSlug } from '@/lib/tenant-slug';

interface StorefrontHall {
  id: string;
  name: string;
  name_ar: string;
  capacity_banquet: number;
  capacity_theater: number;
  base_price: number;
  cleaning_buffer_minutes: number;
  combinable_with_hall_id: string | null;
  gallery_urls?: string[];
  video_url?: string | null;
  amenities?: string[];
}

interface StorefrontOfferItem extends StorefrontOffer {
  description_ar?: string | null;
  description_en?: string | null;
  valid_until?: string | null;
  badge_text?: string | null;
  banner_image_url?: string | null;
}

interface StorefrontPayload {
  id: string;
  name: string;
  slug: string;
  currency: string;
  branding: {
    logoLightUrl?: string | null;
    logoDarkUrl?: string | null;
    heroTaglineAr?: string | null;
    heroTaglineEn?: string | null;
    heroTitleAr?: string | null;
    heroTitleEn?: string | null;
    heroSubtitleAr?: string | null;
    heroSubtitleEn?: string | null;
    heroVideoUrl?: string | null;
    heroBannerUrl?: string | null;
    contactPhone?: string | null;
    whatsappNumber?: string | null;
    addressAr?: string | null;
    addressEn?: string | null;
    socialLinks?: Record<string, string>;
  };
  halls: StorefrontHall[];
  offers: StorefrontOfferItem[];
}

export default function TenantVenueStorefrontPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const { tenantSlug } = useAuthSession();
  const effectiveSlug = tenantSlug || resolveTenantSlug();
  const branding = useTenantBranding();

  const [mounted, setMounted] = useState(false);
  const [storefront, setStorefront] = useState<StorefrontPayload | null>(null);
  const [selectedHallId, setSelectedHallId] = useState<string>('');
  const [appliedOffer, setAppliedOffer] = useState<StorefrontOfferItem | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!effectiveSlug) return;
    let alive = true;
    apiFetch<StorefrontPayload>(`/api/v1/public/tenants/${effectiveSlug}/storefront`, { skipAuth: true }, effectiveSlug)
      .then((data) => {
        if (!alive) return;
        setStorefront(data);
        if (data.halls?.length) {
          setSelectedHallId((prev) => prev || data.halls[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [effectiveSlug]);

  const rawTenantName = storefront?.name || branding.venueName || '';
  const tenantName = localizedVenueName(rawTenantName, locale) || tr('واجهة القاعة', 'Venue Storefront');
  const currency = storefront?.currency || branding.currency || 'YER';
  const sfBrand = storefront?.branding;
  const heroLogo = mounted ? sfBrand?.logoDarkUrl || sfBrand?.logoLightUrl || branding.logoDarkUrl || branding.logoLightUrl : null;
  const heroTitle = isRtl
    ? localizedVenueName(sfBrand?.heroTitleAr || '', 'ar') || sfBrand?.heroTitleAr || tenantName
    : localizedVenueName(sfBrand?.heroTitleEn || '', 'en') || sfBrand?.heroTitleEn || tenantName;
  const heroSubtitle = isRtl
    ? sfBrand?.heroSubtitleAr || sfBrand?.heroTaglineAr
    : sfBrand?.heroSubtitleEn || sfBrand?.heroTaglineEn;
  const heroBanner = sfBrand?.heroBannerUrl || '/images/hero_grand_ballroom.jpg';
  const halls = storefront?.halls || [];
  const offers = storefront?.offers || [];
  const address = isRtl ? sfBrand?.addressAr : sfBrand?.addressEn;
  const whatsappClean = (sfBrand?.whatsappNumber || '').replace(/[^0-9]/g, '');

  const selectHallAndScroll = (hallId: string) => {
    setSelectedHallId(hallId);
    document.getElementById('venue-calendar')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} title={tenantName} />

      <main className="mx-auto max-w-7xl space-y-14 px-4 py-8 sm:px-6">
        {/* Section 1: White-Label Hero Banner */}
        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-900 text-white shadow-xl dark:border-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroBanner} alt={tenantName} className="absolute inset-0 h-full w-full object-cover opacity-35" />
          <div className="relative z-10 grid gap-6 p-6 sm:p-10 lg:grid-cols-3 lg:items-center">
            <div className="space-y-4 text-start lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                {heroLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={heroLogo}
                    alt={tenantName}
                    className="h-14 w-14 rounded-xl border border-white/20 bg-white/90 object-contain p-1"
                  />
                )}
                {effectiveSlug && (
                  <span
                    dir="ltr"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-primary,#D4AF37)]/50 bg-slate-950/70 px-3 py-1 font-mono text-xs font-bold text-[var(--brand-primary,#D4AF37)]"
                  >
                    <Sparkles className="h-3.5 w-3.5" />/{effectiveSlug}
                  </span>
                )}
              </div>

              <SpotlightHeading as="h1" className="text-start text-2xl text-white sm:text-4xl">
                {heroTitle}
              </SpotlightHeading>

              {heroSubtitle && <p className="max-w-2xl text-sm text-slate-200 sm:text-base">{heroSubtitle}</p>}

              <div className="flex flex-wrap gap-3 pt-2">
                <a
                  href="#venue-calendar"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg"
                >
                  <CalendarCheck className="h-4 w-4" />
                  <span>{tr('فحص التوفر والحجز الفوري', 'Check Live Dates')}</span>
                </a>
                {sfBrand?.heroVideoUrl && (
                  <button
                    type="button"
                    onClick={() => setActiveVideoUrl(sfBrand.heroVideoUrl!)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/30 bg-slate-950/60 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur"
                  >
                    <Play className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                    <span>{tr('جولة فيديو في القاعة', 'Watch Venue Tour')}</span>
                  </button>
                )}
                <Link
                  href={tenantPath(locale, effectiveSlug, '/portal/login')}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur"
                >
                  <UserRound className="h-4 w-4" />
                  <span>{tr('دخول / تسجيل العميل', 'Client Portal Sign In / Register')}</span>
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-white/15 bg-slate-950/75 p-4 text-start text-xs backdrop-blur">
              <div className="mb-2 flex items-center gap-2 font-bold text-[var(--brand-primary,#D4AF37)]">
                <ShieldCheck className="h-4 w-4" />
                <span>{tr('واجهة الحجز الرسمية للمنشأة', 'Official Venue Booking Storefront')}</span>
              </div>
              <p className="leading-relaxed text-slate-300">
                {tr(
                  'استعرض القاعات، طبّق العروض الموسمية، واحصل على تسعيرة فورية أو حجز مبدئي لمدة 48 ساعة.',
                  'Explore halls, apply seasonal packages, and lock a 48-hour tentative hold or deposit immediately.'
                )}
              </p>
              <Link
                href={tenantPath(locale, effectiveSlug, '/portal/dashboard')}
                className="mt-3 inline-flex items-center gap-1 font-bold text-[var(--brand-primary,#D4AF37)] hover:underline"
              >
                <span>{tr('متابعة حجوزاتي في بوابة العميل', 'Open My Bookings')}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* Section 2: Halls Gallery & Virtual Walkthrough Showcase */}
        {halls.length > 0 && (
          <section className="space-y-5 text-start">
            <SpotlightHeading as="h2" className="text-2xl">
              {tr('معرض القاعات والجولات الافتراضية', 'Halls Gallery & Virtual Walkthroughs')}
            </SpotlightHeading>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {halls.map((hall) => {
                const isSelected = selectedHallId === hall.id;
                const partner = hall.combinable_with_hall_id
                  ? halls.find((h) => h.id === hall.combinable_with_hall_id)
                  : halls.find((h) => h.id !== hall.id && h.combinable_with_hall_id === hall.id);
                const photos = hall.gallery_urls && hall.gallery_urls.length > 0 ? hall.gallery_urls : ['/images/venue_banquet_table.jpg'];

                return (
                  <SpotlightCard
                    key={hall.id}
                    className={`flex flex-col justify-between gap-4 !p-0 overflow-hidden ${isSelected ? 'ring-2 ring-[var(--brand-primary,#D4AF37)]' : ''
                      }`}
                  >
                    <div>
                      {/* Photo Gallery Grid */}
                      <div className="grid grid-cols-3 gap-1 bg-slate-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photos[0]}
                          alt={isRtl ? hall.name_ar : hall.name}
                          className={`h-48 w-full object-cover ${photos.length > 1 ? 'col-span-2' : 'col-span-3'}`}
                        />
                        {photos.length > 1 && (
                          <div className="grid grid-rows-2 gap-1">
                            {photos.slice(1, 3).map((url, idx) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={idx} src={url} alt="" className="h-full w-full object-cover" />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                              {isRtl ? hall.name_ar : hall.name}
                            </h3>
                            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3.5 w-3.5" />
                                {tr(`مآدب: ${hall.capacity_banquet}`, `Banquet: ${hall.capacity_banquet}`)}
                              </span>
                              <span>{tr(`مسرح: ${hall.capacity_theater}`, `Theater: ${hall.capacity_theater}`)}</span>
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {tr(`تنظيف: ${hall.cleaning_buffer_minutes} د`, `Buffer: ${hall.cleaning_buffer_minutes}m`)}
                              </span>
                            </div>
                          </div>
                          <div dir="ltr" className="font-mono text-base font-extrabold text-[var(--brand-primary,#D4AF37)]">
                            {Number(hall.base_price).toLocaleString()} {currency}
                          </div>
                        </div>

                        {partner && (
                          <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                            <Layers className="h-3.5 w-3.5" />
                            <span>
                              {tr(
                                `قابلة للدمج مع ${partner.name_ar} (سعة ${hall.capacity_banquet + partner.capacity_banquet})`,
                                `Combinable with ${partner.name} (Combined ${hall.capacity_banquet + partner.capacity_banquet})`
                              )}
                            </span>
                          </div>
                        )}

                        {hall.amenities && hall.amenities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {hall.amenities.map((am) => (
                              <span
                                key={am}
                                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                {am}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => selectHallAndScroll(hall.id)}
                        className="min-h-[40px] flex-1 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950"
                      >
                        {isSelected ? tr('✔ القاعة المختارة — عرض التقويم', '✔ Selected — View Calendar') : tr('اختيار القاعة والحجز', 'Select Hall')}
                      </button>
                      {hall.video_url && (
                        <button
                          type="button"
                          onClick={() => setActiveVideoUrl(hall.video_url!)}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
                        >
                          <Play className="h-3.5 w-3.5 text-[var(--brand-primary,#D4AF37)]" />
                          <span>{tr('فيديو', 'Tour')}</span>
                        </button>
                      )}
                    </div>
                  </SpotlightCard>
                );
              })}
            </div>
          </section>
        )}

        {/* Section 3: Special Offers, Seasonal Discounts & Event Packages */}
        {offers.length > 0 && (
          <section className="space-y-5 text-start">
            <SpotlightHeading as="h2" className="flex items-center gap-2 text-2xl">
              <Tag className="h-5 w-5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('العروض الخاصة والباقات الموسمية', 'Special Offers & Event Packages')}</span>
            </SpotlightHeading>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {offers.map((offer) => {
                const isApplied = appliedOffer?.id === offer.id;
                return (
                  <SpotlightCard key={offer.id} className="flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      {offer.banner_image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={offer.banner_image_url} alt="" className="h-32 w-full rounded-lg object-cover" />
                      )}
                      <div className="flex items-center justify-between gap-2">
                        {offer.badge_text && (
                          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-500">
                            {offer.badge_text}
                          </span>
                        )}
                        {offer.valid_until && (
                          <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                            {tr('حتى', 'Until')} {offer.valid_until}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-bold">{isRtl ? offer.title_ar : offer.title_en}</h3>
                      {(isRtl ? offer.description_ar : offer.description_en) && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {isRtl ? offer.description_ar : offer.description_en}
                        </p>
                      )}
                      <div dir="ltr" className="font-mono text-sm font-extrabold text-emerald-500">
                        {offer.discount_percent ? `-${offer.discount_percent}%` : ''}
                        {offer.package_price ? ` ${Number(offer.package_price).toLocaleString()} ${currency}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedOffer(isApplied ? null : offer);
                        if (!isApplied) document.getElementById('venue-calendar')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl text-xs font-bold ${isApplied
                        ? 'bg-emerald-600 text-white'
                        : 'border border-[var(--brand-primary,#D4AF37)] text-[var(--brand-primary,#D4AF37)]'
                        }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{isApplied ? tr('تم تطبيق العرض ✓', 'Offer Applied ✓') : tr('تطبيق العرض على الحجز', 'Apply Offer')}</span>
                    </button>
                  </SpotlightCard>
                );
              })}
            </div>
          </section>
        )}

        {/* Section 4: 3-Month Interactive Availability & Instant Quote Engine */}
        <section id="venue-calendar" className="scroll-mt-20 space-y-4">
          <ThreeMonthBookingEngine
            mode="TENANT_STOREFRONT"
            tenantSlug={effectiveSlug}
            locale={locale}
            selectedHallId={selectedHallId}
            appliedOffer={appliedOffer}
          />
        </section>

        {/* Section 5: Venue Contact, Location & Trust Footer */}
        <footer className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 text-start dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <div className="font-bold text-slate-900 dark:text-white">{tenantName}</div>
              {address && (
                <p className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary,#D4AF37)]" />
                  <span>{address}</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {sfBrand?.contactPhone && (
                <a
                  href={`tel:${sfBrand.contactPhone}`}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-300 px-4 text-xs font-semibold dark:border-slate-700"
                >
                  <Phone className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                  <span dir="ltr">{sfBrand.contactPhone}</span>
                </a>
              )}
              {whatsappClean && (
                <a
                  href={`https://wa.me/${whatsappClean}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>{tr('تواصل عبر واتساب', 'Chat on WhatsApp')}</span>
                </a>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
              {Object.entries(sfBrand?.socialLinks || {}).map(([name, url]) =>
                url ? (
                  <a key={name} href={url} target="_blank" rel="noreferrer" className="capitalize text-slate-500 hover:underline">
                    {name}
                  </a>
                ) : null
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              {tenantName} · {tr('مدعوم بواسطة EventLedger', 'Powered by EventLedger')}
            </span>
            <Link href={tenantPath(locale, effectiveSlug, '/staff-login')} className="font-semibold text-[var(--brand-primary,#D4AF37)] hover:underline">
              {tr('دخول موظفي القاعة ونظام ERP ›', 'Venue Staff ERP Login ›')}
            </Link>
          </div>
        </footer>
      </main>

      {/* Video Tour Modal */}
      {activeVideoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between text-white">
              <span className="text-sm font-bold">{tr('جولة افتراضية في القاعة', 'Virtual Venue Tour')}</span>
              <button type="button" onClick={() => setActiveVideoUrl(null)} aria-label="Close video" className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              {activeVideoUrl.includes('youtube.com') || activeVideoUrl.includes('youtu.be') || activeVideoUrl.includes('vimeo.com') ? (
                <iframe src={activeVideoUrl} className="h-full w-full" allowFullScreen title="Venue Tour" />
              ) : (
                <video src={activeVideoUrl} controls className="h-full w-full" />
              )}
            </div>
          </div>
        </div>
      )}

      <MobileBottomNav persona="CLIENT" locale={locale} />

      <HallMediaShowcase locale={locale} tenantSlug={effectiveSlug} />
    </div>
  );
}
