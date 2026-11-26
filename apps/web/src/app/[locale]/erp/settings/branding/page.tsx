'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowUpRight, Image as ImageIcon, Palette, Plus, Sparkles, Tag, Trash2 } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuthSession } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, tenantPath } from '@/lib/api';
import type { HallInfo, TenantBrandingInfo } from '@/lib/types';

type BrandingTab = 'BRANDING' | 'HERO_CONTACT' | 'HALL_MEDIA' | 'OFFERS';

interface OfferDraft {
  id: string;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  discount_percent: string;
  package_price: string;
  valid_until: string;
  badge_text: string;
  banner_image_url: string;
}

interface HallMediaDraft {
  gallery_urls_text: string;
  video_url: string;
  amenities_text: string;
}

const inputCls =
  'min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950';
const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

export default function TenantBrandingSettingsPage() {
  const params = useParams<{ locale: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const { tenantSlug } = useAuthSession();
  const { applyBranding, refreshBranding } = useTenantBranding();

  const [activeTab, setActiveTab] = useState<BrandingTab>('BRANDING');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tab 1: Brand Colors & Logos
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [accentColor, setAccentColor] = useState('#0F172A');
  const [spotlightColor, setSpotlightColor] = useState('rgba(212, 175, 55, 0.18)');
  const [defaultTheme, setDefaultTheme] = useState<'LIGHT' | 'DARK' | 'SYSTEM'>('SYSTEM');
  const [enableSpotlight, setEnableSpotlight] = useState(true);
  const [logoLightUrl, setLogoLightUrl] = useState('');
  const [logoDarkUrl, setLogoDarkUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [footerAr, setFooterAr] = useState('');
  const [footerEn, setFooterEn] = useState('');

  // Tab 2: Hero Banner, Video & Contact
  const [heroTitleAr, setHeroTitleAr] = useState('');
  const [heroTitleEn, setHeroTitleEn] = useState('');
  const [heroSubtitleAr, setHeroSubtitleAr] = useState('');
  const [heroSubtitleEn, setHeroSubtitleEn] = useState('');
  const [heroBannerUrl, setHeroBannerUrl] = useState('');
  const [heroVideoUrl, setHeroVideoUrl] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [addressAr, setAddressAr] = useState('');
  const [addressEn, setAddressEn] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');

  // Tab 3: Hall Media
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [hallMedia, setHallMedia] = useState<Record<string, HallMediaDraft>>({});

  // Tab 4: Offers
  const [offers, setOffers] = useState<OfferDraft[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<TenantBrandingInfo>('/api/v1/tenant/branding'),
      apiFetch<{
        meta: Record<string, unknown>;
        hall_media: Record<string, { gallery_urls?: string[]; video_url?: string; amenities?: string[] }>;
        offers: Record<string, unknown>[];
      }>('/api/v1/erp/settings/storefront').catch(() => null),
      apiFetch<HallInfo[]>('/api/v1/venue/halls').catch(() => [] as HallInfo[]),
    ])
      .then(([b, sf, hallList]) => {
        setPrimaryColor(b.primary_color);
        setAccentColor(b.accent_color);
        setSpotlightColor(b.spotlight_color);
        setDefaultTheme((b.default_theme as 'LIGHT' | 'DARK' | 'SYSTEM') || 'SYSTEM');
        setEnableSpotlight(b.enable_spotlight);
        setLogoLightUrl(b.logo_light_url || '');
        setLogoDarkUrl(b.logo_dark_url || '');
        setFaviconUrl(b.favicon_url || '');
        setFooterAr(b.invoice_footer_ar || '');
        setFooterEn(b.invoice_footer_en || '');

        setHalls(hallList);
        if (sf) {
          const m = sf.meta || {};
          setHeroTitleAr(String(m.heroTitleAr || ''));
          setHeroTitleEn(String(m.heroTitleEn || ''));
          setHeroSubtitleAr(String(m.heroSubtitleAr || ''));
          setHeroSubtitleEn(String(m.heroSubtitleEn || ''));
          setHeroBannerUrl(String(m.heroBannerUrl || ''));
          setHeroVideoUrl(String(m.heroVideoUrl || ''));
          setContactPhone(String(m.contactPhone || ''));
          setWhatsappNumber(String(m.whatsappNumber || ''));
          setAddressAr(String(m.addressAr || ''));
          setAddressEn(String(m.addressEn || ''));
          const social = (m.socialLinks as Record<string, string>) || {};
          setInstagramUrl(social.instagram || '');
          setFacebookUrl(social.facebook || '');

          const hmDrafts: Record<string, HallMediaDraft> = {};
          for (const h of hallList) {
            const hm = sf.hall_media?.[h.id];
            hmDrafts[h.id] = {
              gallery_urls_text: (hm?.gallery_urls || []).join('\n'),
              video_url: hm?.video_url || '',
              amenities_text: (hm?.amenities || []).join(', '),
            };
          }
          setHallMedia(hmDrafts);

          setOffers(
            (sf.offers || []).map((o) => ({
              id: String(o.id || ''),
              title_ar: String(o.title_ar || ''),
              title_en: String(o.title_en || ''),
              description_ar: String(o.description_ar || ''),
              description_en: String(o.description_en || ''),
              discount_percent: o.discount_percent != null ? String(o.discount_percent) : '',
              package_price: o.package_price != null ? String(o.package_price) : '',
              valid_until: String(o.valid_until || ''),
              badge_text: String(o.badge_text || ''),
              banner_image_url: String(o.banner_image_url || ''),
            }))
          );
        }
      })
      .catch(() => undefined);
  }, []);

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      await apiFetch('/api/v1/tenant/branding', {
        method: 'PUT',
        body: {
          primary_color: primaryColor,
          accent_color: accentColor,
          spotlight_color: spotlightColor,
          default_theme: defaultTheme,
          enable_spotlight: enableSpotlight,
          logo_light_url: logoLightUrl.trim() || null,
          logo_dark_url: logoDarkUrl.trim() || null,
          favicon_url: faviconUrl.trim() || null,
          invoice_footer_ar: footerAr,
          invoice_footer_en: footerEn,
        },
      });
      applyBranding({
        primaryColor,
        accentColor,
        spotlightColor,
        defaultTheme,
        enableSpotlight,
        logoLightUrl: logoLightUrl.trim() || null,
        logoDarkUrl: logoDarkUrl.trim() || null,
        faviconUrl: faviconUrl.trim() || null,
      });
      await refreshBranding();
      setSavedMsg(tr('تم حفظ الهوية البصرية وتطبيقها فوراً', 'Branding saved and applied'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleSaveStorefront = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const hmPayload: Record<string, { gallery_urls: string[]; video_url: string | null; amenities: string[] }> = {};
      for (const [hid, d] of Object.entries(hallMedia)) {
        hmPayload[hid] = {
          gallery_urls: d.gallery_urls_text
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          video_url: d.video_url.trim() || null,
          amenities: d.amenities_text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        };
      }
      await apiFetch('/api/v1/erp/settings/storefront', {
        method: 'PUT',
        body: {
          heroTitleAr: heroTitleAr.trim() || null,
          heroTitleEn: heroTitleEn.trim() || null,
          heroSubtitleAr: heroSubtitleAr.trim() || null,
          heroSubtitleEn: heroSubtitleEn.trim() || null,
          heroBannerUrl: heroBannerUrl.trim() || null,
          heroVideoUrl: heroVideoUrl.trim() || null,
          contactPhone: contactPhone.trim() || null,
          whatsappNumber: whatsappNumber.trim() || null,
          addressAr: addressAr.trim() || null,
          addressEn: addressEn.trim() || null,
          socialLinks: {
            ...(instagramUrl.trim() ? { instagram: instagramUrl.trim() } : {}),
            ...(facebookUrl.trim() ? { facebook: facebookUrl.trim() } : {}),
          },
          hall_media: hmPayload,
          offers: offers.map((o) => ({
            id: o.id || undefined,
            title_ar: o.title_ar.trim(),
            title_en: o.title_en.trim(),
            description_ar: o.description_ar.trim() || null,
            description_en: o.description_en.trim() || null,
            discount_percent: o.discount_percent ? Number(o.discount_percent) : null,
            package_price: o.package_price ? Number(o.package_price) : null,
            valid_until: o.valid_until.trim() || null,
            badge_text: o.badge_text.trim() || null,
            banner_image_url: o.banner_image_url.trim() || null,
          })),
        },
      });
      setSavedMsg(tr('تم حفظ إعدادات واجهة القاعة والعروض بنجاح', 'Storefront media & offers saved'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Storefront update failed');
    }
  };

  const addOffer = () => {
    setOffers((prev) => [
      ...prev,
      {
        id: '',
        title_ar: '',
        title_en: '',
        description_ar: '',
        description_en: '',
        discount_percent: '15',
        package_price: '',
        valid_until: '',
        badge_text: 'SEASONAL',
        banner_image_url: '',
      },
    ]);
  };

  const tabs: { id: BrandingTab; ar: string; en: string }[] = [
    { id: 'BRANDING', ar: 'الشعارات والألوان', en: 'Logos, Favicon & Colors' },
    { id: 'HERO_CONTACT', ar: 'واجهة البطل والتواصل', en: 'Hero Banner, Video & Contact' },
    { id: 'HALL_MEDIA', ar: 'صور وفيديوهات القاعات', en: 'Hall Galleries & Videos' },
    { id: 'OFFERS', ar: 'العروض والباقات', en: 'Offers & Packages' },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpotlightHeading as="h1" className="text-2xl">
            <Palette className="me-2 inline h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
            {tr('تخصيص الهوية البصرية وواجهة القاعة', 'White-Label Branding & Storefront Customizer')}
          </SpotlightHeading>
          {tenantSlug && (
            <Link
              href={tenantPath(locale, tenantSlug, '/venue')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950"
            >
              <span>{tr('معاينة واجهة القاعة', 'Preview Storefront')}</span>
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="flex gap-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
          {tabs.map((tb) => {
            const active = activeTab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tb.id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-1 py-3 text-xs transition ${
                  active
                    ? 'border-[var(--brand-primary)] font-semibold text-slate-900 dark:text-white'
                    : 'border-transparent font-medium text-slate-500 hover:text-[var(--brand-primary,#D4AF37)]'
                }`}
              >
                {isRtl ? tb.ar : tb.en}
              </button>
            );
          })}
        </div>

        {savedMsg && (
          <SpotlightCard className="border-emerald-500/40 bg-emerald-500/10 py-3 text-xs text-emerald-600 dark:text-emerald-300">
            {savedMsg}
          </SpotlightCard>
        )}
        {errorMsg && (
          <SpotlightCard className="border-rose-500/40 bg-rose-500/10 py-3 text-xs text-rose-500">{errorMsg}</SpotlightCard>
        )}

        {activeTab === 'BRANDING' && (
          <SpotlightCard>
            <form onSubmit={handleSaveBranding} className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>{tr('اللون الأساسي', 'Primary Brand Color')}</label>
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-11 w-full rounded-lg border border-slate-700 bg-transparent p-1" />
              </div>
              <div>
                <label className={labelCls}>{tr('اللون الثانوي', 'Accent Color')}</label>
                <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-11 w-full rounded-lg border border-slate-700 bg-transparent p-1" />
              </div>
              <div>
                <label className={labelCls}>{tr('لون التوهج (Spotlight)', 'Spotlight Glow')}</label>
                <input dir="ltr" value={spotlightColor} onChange={(e) => setSpotlightColor(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('المظهر الافتراضي', 'Default Theme')}</label>
                <select value={defaultTheme} onChange={(e) => setDefaultTheme(e.target.value as 'LIGHT' | 'DARK' | 'SYSTEM')} className={inputCls}>
                  <option value="SYSTEM">{tr('تلقائي (النظام)', 'System')}</option>
                  <option value="DARK">{tr('داكن', 'Dark')}</option>
                  <option value="LIGHT">{tr('فاتح', 'Light')}</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{tr('رابط الشعار (فاتح)', 'Light Logo URL')}</label>
                <input dir="ltr" value={logoLightUrl} onChange={(e) => setLogoLightUrl(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('رابط الشعار (داكن)', 'Dark Logo URL')}</label>
                <input dir="ltr" value={logoDarkUrl} onChange={(e) => setLogoDarkUrl(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>{tr('رابط الأيقونة (Favicon URL)', 'Favicon URL')}</label>
                <input dir="ltr" value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={enableSpotlight} onChange={(e) => setEnableSpotlight(e.target.checked)} />
                  <span>{tr('تفعيل تأثير الإضاءة التفاعلي (Hover Spotlight)', 'Enable Hover Spotlight Glow')}</span>
                </label>
              </div>
              <div>
                <label className={labelCls}>{tr('تذييل الفاتورة (عربي)', 'Invoice Footer (Arabic)')}</label>
                <textarea value={footerAr} onChange={(e) => setFooterAr(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <div>
                <label className={labelCls}>{tr('تذييل الفاتورة (إنجليزي)', 'Invoice Footer (English)')}</label>
                <textarea value={footerEn} onChange={(e) => setFooterEn(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <button type="submit" className="min-h-[44px] sm:col-span-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
                {tr('حفظ وتطبيق الهوية البصرية', 'Save & Apply Branding')}
              </button>
            </form>
          </SpotlightCard>
        )}

        {activeTab === 'HERO_CONTACT' && (
          <SpotlightCard>
            <form onSubmit={handleSaveStorefront} className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-2 font-bold sm:col-span-2">
                <Sparkles className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('محتوى البطل وبيانات التواصل', 'Hero Copy, Media & Venue Contact')}</span>
              </div>
              <div>
                <label className={labelCls}>{tr('عنوان الواجهة (عربي)', 'Hero Title (AR)')}</label>
                <input value={heroTitleAr} onChange={(e) => setHeroTitleAr(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('عنوان الواجهة (إنجليزي)', 'Hero Title (EN)')}</label>
                <input value={heroTitleEn} onChange={(e) => setHeroTitleEn(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('الوصف الفرعي (عربي)', 'Hero Subtitle (AR)')}</label>
                <input value={heroSubtitleAr} onChange={(e) => setHeroSubtitleAr(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('الوصف الفرعي (إنجليزي)', 'Hero Subtitle (EN)')}</label>
                <input value={heroSubtitleEn} onChange={(e) => setHeroSubtitleEn(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('رابط صورة الخلفية', 'Hero Banner Image URL')}</label>
                <input dir="ltr" value={heroBannerUrl} onChange={(e) => setHeroBannerUrl(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('رابط فيديو الجولة (MP4 / Embed)', 'Hero Tour Video URL')}</label>
                <input dir="ltr" value={heroVideoUrl} onChange={(e) => setHeroVideoUrl(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('هاتف القاعة', 'Contact Phone')}</label>
                <input dir="ltr" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('رقم واتساب', 'WhatsApp Number')}</label>
                <input dir="ltr" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('العنوان (عربي)', 'Address (AR)')}</label>
                <input value={addressAr} onChange={(e) => setAddressAr(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('العنوان (إنجليزي)', 'Address (EN)')}</label>
                <input value={addressEn} onChange={(e) => setAddressEn(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Instagram URL</label>
                <input dir="ltr" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Facebook URL</label>
                <input dir="ltr" value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} className={inputCls} />
              </div>
              <button type="submit" className="min-h-[44px] sm:col-span-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
                {tr('حفظ إعدادات الواجهة', 'Save Hero & Contact')}
              </button>
            </form>
          </SpotlightCard>
        )}

        {activeTab === 'HALL_MEDIA' && (
          <SpotlightCard className="space-y-5">
            <div className="flex items-center gap-2 font-bold">
              <ImageIcon className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('معارض صور وفيديوهات القاعات', 'Per-Hall Photo Galleries & Video Tours')}</span>
            </div>
            {halls.map((h) => {
              const draft = hallMedia[h.id] || { gallery_urls_text: '', video_url: '', amenities_text: '' };
              const updateDraft = (patch: Partial<HallMediaDraft>) =>
                setHallMedia((prev) => ({ ...prev, [h.id]: { ...draft, ...patch } }));
              return (
                <div key={h.id} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="font-bold">{isRtl ? h.name_ar : h.name}</div>
                  <div>
                    <label className={labelCls}>{tr('روابط الصور (سطر لكل رابط)', 'Gallery Image URLs (one per line)')}</label>
                    <textarea
                      dir="ltr"
                      rows={3}
                      value={draft.gallery_urls_text}
                      onChange={(e) => updateDraft({ gallery_urls_text: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>{tr('رابط فيديو القاعة', 'Walkthrough Video URL')}</label>
                      <input dir="ltr" value={draft.video_url} onChange={(e) => updateDraft({ video_url: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{tr('المزايا (مفصولة بفاصلة)', 'Amenities (comma-separated)')}</label>
                      <input value={draft.amenities_text} onChange={(e) => updateDraft({ amenities_text: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={() => handleSaveStorefront()} className="min-h-[44px] w-full rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
              {tr('حفظ معارض القاعات', 'Save Hall Media')}
            </button>
          </SpotlightCard>
        )}

        {activeTab === 'OFFERS' && (
          <SpotlightCard className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold">
                <Tag className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('العروض الترويجية والباقات', 'Promotional Offers & Packages')}</span>
              </div>
              <button
                type="button"
                onClick={addOffer}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-[var(--brand-primary,#D4AF37)]"
              >
                <Plus className="h-4 w-4" />
                <span>{tr('إضافة عرض', 'Add Offer')}</span>
              </button>
            </div>

            {offers.map((offer, idx) => {
              const patchOffer = (patch: Partial<OfferDraft>) =>
                setOffers((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
              return (
                <div key={idx} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-amber-500">#{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => setOffers((prev) => prev.filter((_, i) => i !== idx))}
                      className="inline-flex items-center gap-1 text-xs text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{tr('حذف', 'Delete')}</span>
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input placeholder={tr('عنوان العرض (عربي)', 'Title (AR)')} value={offer.title_ar} onChange={(e) => patchOffer({ title_ar: e.target.value })} className={inputCls} />
                    <input placeholder={tr('عنوان العرض (إنجليزي)', 'Title (EN)')} value={offer.title_en} onChange={(e) => patchOffer({ title_en: e.target.value })} className={inputCls} />
                    <input placeholder={tr('وصف (عربي)', 'Description (AR)')} value={offer.description_ar} onChange={(e) => patchOffer({ description_ar: e.target.value })} className={inputCls} />
                    <input placeholder={tr('وصف (إنجليزي)', 'Description (EN)')} value={offer.description_en} onChange={(e) => patchOffer({ description_en: e.target.value })} className={inputCls} />
                    <input type="number" min={0} max={90} placeholder={tr('نسبة الخصم %', 'Discount %')} value={offer.discount_percent} onChange={(e) => patchOffer({ discount_percent: e.target.value })} className={inputCls} />
                    <input type="number" min={0} placeholder={tr('سعر الباقة', 'Package Price')} value={offer.package_price} onChange={(e) => patchOffer({ package_price: e.target.value })} className={inputCls} />
                    <input type="date" value={offer.valid_until} onChange={(e) => patchOffer({ valid_until: e.target.value })} className={inputCls} />
                    <input placeholder={tr('شارة العرض', 'Badge Text (e.g. WINTER)')} value={offer.badge_text} onChange={(e) => patchOffer({ badge_text: e.target.value })} className={inputCls} />
                  </div>
                </div>
              );
            })}

            <button type="button" onClick={() => handleSaveStorefront()} className="min-h-[44px] w-full rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
              {tr('حفظ العروض والباقات', 'Save Offers & Packages')}
            </button>
          </SpotlightCard>
        )}
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
