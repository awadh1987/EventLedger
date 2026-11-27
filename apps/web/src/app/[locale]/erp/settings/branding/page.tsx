'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useDirtyFormGuard } from '@/components/navigation/NavigationHistoryProvider';
import { useAuthSession } from '@/components/providers/auth-provider';
import { BRAND_THEME_PRESETS, useTenantBranding } from '@/components/providers/theme-branding-provider';
import { BackButton } from '@/components/ui/BackButton';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { apiFetch, getAccessToken, tenantPath } from '@/lib/api';
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
  const { setTheme } = useTheme();
  const importInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<BrandingTab>('BRANDING');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  useDirtyFormGuard(isDirty);

  // Tab 1: Multi-Theme Presets, Surface Tokens & Logos
  const [themePreset, setThemePreset] = useState('OBSIDIAN_GOLD');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [accentColor, setAccentColor] = useState('#0F172A');
  const [spotlightColor, setSpotlightColor] = useState('rgba(212, 175, 55, 0.18)');
  const [defaultTheme, setDefaultTheme] = useState<'LIGHT' | 'DARK' | 'SYSTEM'>('DARK');
  const [enableSpotlight, setEnableSpotlight] = useState(true);
  const [surfaceLight, setSurfaceLight] = useState('#F8FAFC');
  const [surfaceDark, setSurfaceDark] = useState('#020617');
  const [cardLight, setCardLight] = useState('#FFFFFF');
  const [cardDark, setCardDark] = useState('#0F172A');
  const [borderLight, setBorderLight] = useState('#E2E8F0');
  const [borderDark, setBorderDark] = useState('#1E293B');
  const [buttonTextColor, setButtonTextColor] = useState('#020617');
  const [cardRadius, setCardRadius] = useState('0.75rem');
  const [logoLightUrl, setLogoLightUrl] = useState('');
  const [logoDarkUrl, setLogoDarkUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState('');
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

  const hydrateFromBranding = (b: TenantBrandingInfo) => {
    setPrimaryColor(b.primary_color || '#D4AF37');
    setAccentColor(b.accent_color || '#0F172A');
    setSpotlightColor(b.spotlight_color || 'rgba(212, 175, 55, 0.18)');
    setDefaultTheme((b.default_theme as 'LIGHT' | 'DARK' | 'SYSTEM') || 'SYSTEM');
    setEnableSpotlight(Boolean(b.enable_spotlight));
    setLogoLightUrl(b.logo_light_url || '');
    setLogoDarkUrl(b.logo_dark_url || '');
    setFaviconUrl(b.favicon_url || '');
    setOwnerAvatarUrl(b.owner_avatar_url || '');
    setFooterAr(b.invoice_footer_ar || '');
    setFooterEn(b.invoice_footer_en || '');
    const t = b.tokens || {};
    setThemePreset(b.theme_preset || t.theme_preset || 'OBSIDIAN_GOLD');
    setSurfaceLight(t.surface_light || '#F8FAFC');
    setSurfaceDark(t.surface_dark || '#020617');
    setCardLight(t.card_light || '#FFFFFF');
    setCardDark(t.card_dark || '#0F172A');
    setBorderLight(t.border_light || '#E2E8F0');
    setBorderDark(t.border_dark || '#1E293B');
    setButtonTextColor(t.button_text_color || '#020617');
    setCardRadius(t.card_radius || '0.75rem');
  };

  useEffect(() => {
    if (!getAccessToken()) return;
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
        hydrateFromBranding(b);
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
        setIsDirty(false);
      })
      .catch(() => undefined);
  }, []);

  const selectPreset = (presetId: string) => {
    const found = BRAND_THEME_PRESETS.find((p) => p.id === presetId);
    setThemePreset(presetId);
    setIsDirty(true);
    if (!found) return;
    setPrimaryColor(found.primaryColor);
    setAccentColor(found.accentColor);
    setSpotlightColor(found.spotlightColor);
    setDefaultTheme(found.defaultTheme);
    setSurfaceLight(found.tokens.surfaceLight);
    setSurfaceDark(found.tokens.surfaceDark);
    setCardLight(found.tokens.cardLight);
    setCardDark(found.tokens.cardDark);
    setBorderLight(found.tokens.borderLight);
    setBorderDark(found.tokens.borderDark);
    setButtonTextColor(found.tokens.buttonTextColor);
    setCardRadius(found.tokens.cardRadius);
  };

  const applyLiveContext = () => {
    applyBranding({
      primaryColor,
      accentColor,
      spotlightColor,
      defaultTheme,
      enableSpotlight,
      themePreset,
      logoLightUrl: logoLightUrl.trim() || null,
      logoDarkUrl: logoDarkUrl.trim() || null,
      faviconUrl: faviconUrl.trim() || null,
      ownerAvatarUrl: ownerAvatarUrl.trim() || null,
      tokens: {
        surfaceLight,
        surfaceDark,
        cardLight,
        cardDark,
        borderLight,
        borderDark,
        buttonTextColor,
        cardRadius,
      },
    });
  };

  const saveBrandingPayload = async (andApplyTheme = false) => {
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const updated = await apiFetch<TenantBrandingInfo>('/api/v1/tenant/branding', {
        method: 'PUT',
        body: {
          primary_color: primaryColor,
          accent_color: accentColor,
          spotlight_color: spotlightColor,
          default_theme: defaultTheme,
          enable_spotlight: enableSpotlight,
          theme_preset: themePreset,
          surface_light: surfaceLight,
          surface_dark: surfaceDark,
          card_light: cardLight,
          card_dark: cardDark,
          border_light: borderLight,
          border_dark: borderDark,
          button_text_color: buttonTextColor,
          card_radius: cardRadius,
          logo_light_url: logoLightUrl.trim() || null,
          logo_dark_url: logoDarkUrl.trim() || null,
          favicon_url: faviconUrl.trim() || null,
          owner_avatar_url: ownerAvatarUrl.trim() || null,
          invoice_footer_ar: footerAr,
          invoice_footer_en: footerEn,
        },
      });
      hydrateFromBranding(updated);
      applyLiveContext();
      if (andApplyTheme && defaultTheme !== 'SYSTEM') {
        setTheme(defaultTheme.toLowerCase());
      }
      await refreshBranding();
      setIsDirty(false);
      setSavedMsg(
        andApplyTheme
          ? tr('تم نشر وتطبيق الثيم بنجاح عبر كل الواجهات', 'Theme published and applied live')
          : tr('تم حفظ إعدادات الهوية البصرية بنجاح', 'Branding settings saved')
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveBrandingPayload(true);
  };

  const handleResetDefaults = async () => {
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const resetRes = await apiFetch<TenantBrandingInfo>('/api/v1/tenant/branding/reset', { method: 'POST' });
      hydrateFromBranding(resetRes);
      applyLiveContext();
      await refreshBranding();
      setIsDirty(false);
      setSavedMsg(tr('تمت استعادة الإعدادات الافتراضية للهوية البصرية', 'Reset to default Obsidian Gold preset'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  const handleExportJson = () => {
    const payload = {
      theme_preset: themePreset,
      primary_color: primaryColor,
      accent_color: accentColor,
      spotlight_color: spotlightColor,
      default_theme: defaultTheme,
      enable_spotlight: enableSpotlight,
      surface_light: surfaceLight,
      surface_dark: surfaceDark,
      card_light: cardLight,
      card_dark: cardDark,
      border_light: borderLight,
      border_dark: borderDark,
      button_text_color: buttonTextColor,
      card_radius: cardRadius,
      logo_light_url: logoLightUrl || null,
      logo_dark_url: logoDarkUrl || null,
      favicon_url: faviconUrl || null,
      owner_avatar_url: ownerAvatarUrl || null,
      invoice_footer_ar: footerAr,
      invoice_footer_en: footerEn,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `branding-${tenantSlug || 'tenant'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (typeof parsed.theme_preset === 'string') setThemePreset(parsed.theme_preset);
      if (typeof parsed.primary_color === 'string') setPrimaryColor(parsed.primary_color);
      if (typeof parsed.accent_color === 'string') setAccentColor(parsed.accent_color);
      if (typeof parsed.spotlight_color === 'string') setSpotlightColor(parsed.spotlight_color);
      if (parsed.default_theme === 'LIGHT' || parsed.default_theme === 'DARK' || parsed.default_theme === 'SYSTEM') {
        setDefaultTheme(parsed.default_theme);
      }
      if (typeof parsed.enable_spotlight === 'boolean') setEnableSpotlight(parsed.enable_spotlight);
      if (typeof parsed.surface_light === 'string') setSurfaceLight(parsed.surface_light);
      if (typeof parsed.surface_dark === 'string') setSurfaceDark(parsed.surface_dark);
      if (typeof parsed.card_light === 'string') setCardLight(parsed.card_light);
      if (typeof parsed.card_dark === 'string') setCardDark(parsed.card_dark);
      if (typeof parsed.border_light === 'string') setBorderLight(parsed.border_light);
      if (typeof parsed.border_dark === 'string') setBorderDark(parsed.border_dark);
      if (typeof parsed.button_text_color === 'string') setButtonTextColor(parsed.button_text_color);
      if (typeof parsed.card_radius === 'string') setCardRadius(parsed.card_radius);
      if (typeof parsed.logo_light_url === 'string') setLogoLightUrl(parsed.logo_light_url);
      if (typeof parsed.logo_dark_url === 'string') setLogoDarkUrl(parsed.logo_dark_url);
      if (typeof parsed.favicon_url === 'string') setFaviconUrl(parsed.favicon_url);
      if (typeof parsed.owner_avatar_url === 'string') setOwnerAvatarUrl(parsed.owner_avatar_url);
      if (typeof parsed.invoice_footer_ar === 'string') setFooterAr(parsed.invoice_footer_ar);
      if (typeof parsed.invoice_footer_en === 'string') setFooterEn(parsed.invoice_footer_en);
      setIsDirty(true);
      setSavedMsg(tr('تم استيراد ملف الهوية البصرية — اضغط حفظ للنشر', 'Imported theme JSON — save or publish to persist'));
    } catch {
      setErrorMsg(tr('ملف JSON غير صالح', 'Invalid branding JSON file'));
    } finally {
      e.target.value = '';
    }
  };

  const uploadAsset = async (file: File, folder: string, onDone: (url: string) => void, fieldKey: string) => {
    setUploadingField(fieldKey);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);
      const res = await apiFetch<{ url: string }>('/api/v1/erp/uploads/media', { method: 'POST', formData });
      onDone(res.url);
      setIsDirty(true);
      setSavedMsg(tr(`تم رفع ${file.name} — اضغط حفظ لتثبيت الرابط`, `Uploaded ${file.name} — save to persist`));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingField(null);
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
      setIsDirty(false);
      setSavedMsg(tr('تم حفظ إعدادات واجهة القاعة والعروض بنجاح', 'Storefront media & offers saved'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Storefront update failed');
    }
  };

  const addOffer = () => {
    setIsDirty(true);
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
    { id: 'BRANDING', ar: 'الثيمات والألوان والشعارات', en: 'Themes, Tokens & Logos' },
    { id: 'HERO_CONTACT', ar: 'واجهة البطل والتواصل', en: 'Hero Banner, Video & Contact' },
    { id: 'HALL_MEDIA', ar: 'صور وفيديوهات القاعات', en: 'Hall Galleries & Videos' },
    { id: 'OFFERS', ar: 'العروض والباقات', en: 'Offers & Packages' },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-[var(--surface-bg)] pb-24 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton locale={locale} dirty={isDirty} />
            <SpotlightHeading as="h1" className="text-xl sm:text-2xl">
              <Palette className="me-2 inline h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
              {tr('استوديو الهوية البصرية متعدد الثيمات', 'Multi-Theme White-Label Branding Studio')}
            </SpotlightHeading>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDirty && (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-300">
                {tr('تغييرات غير محفوظة', 'Unsaved changes')}
              </span>
            )}
            {tenantSlug && (
              <Link
                href={tenantPath(locale, tenantSlug, '/venue')}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-slate-950"
              >
                <span>{tr('معاينة واجهة القاعة', 'Preview Storefront')}</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Sticky Quick Action Panel */}
        <SpotlightCard className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => saveBrandingPayload(false)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{tr('حفظ المسودة', 'Save Branding')}</span>
            </button>
            <button
              type="button"
              onClick={() => saveBrandingPayload(true)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-bold text-slate-950"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{tr('نشر وتطبيق الثيم', 'Publish & Apply Theme')}</span>
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 text-xs font-semibold text-rose-500"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{tr('استعادة الافتراضي', 'Reset Defaults')}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{tr('تصدير JSON', 'Export JSON')}</span>
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{tr('استيراد JSON', 'Import JSON')}</span>
            </button>
            <input ref={importInputRef} type="file" accept="application/json" onChange={handleImportJson} className="hidden" />
          </div>
        </SpotlightCard>

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
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-8">
              {/* Multi-Theme Presets Selector */}
              <SpotlightCard className="space-y-4 text-start">
                <SpotlightHeading as="h2" className="text-base">
                  {tr('قوالب الثيمات الجاهزة للمنشآت', 'Curated Multi-Theme Presets')}
                </SpotlightHeading>
                <div className="grid gap-3 sm:grid-cols-3">
                  {BRAND_THEME_PRESETS.map((preset) => {
                    const selected = themePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => selectPreset(preset.id)}
                        className={`flex flex-col gap-2 rounded-xl border p-3 text-start transition ${
                          selected
                            ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{tr(preset.labelAr, preset.labelEn)}</span>
                          <span className="font-mono text-[10px] text-slate-400">{preset.defaultTheme}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-4 w-4 rounded-full border border-slate-400/40" style={{ backgroundColor: preset.primaryColor }} />
                          <span className="h-4 w-4 rounded-full border border-slate-400/40" style={{ backgroundColor: preset.accentColor }} />
                          <span className="h-4 w-4 rounded-full border border-slate-400/40" style={{ backgroundColor: preset.tokens.surfaceDark }} />
                          <span className="h-4 w-4 rounded-full border border-slate-400/40" style={{ backgroundColor: preset.tokens.surfaceLight }} />
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setThemePreset('CUSTOM');
                      setIsDirty(true);
                    }}
                    className={`flex flex-col justify-center gap-1 rounded-xl border p-3 text-start transition ${
                      themePreset === 'CUSTOM'
                        ? 'border-[var(--brand-primary,#D4AF37)] ring-1 ring-[var(--brand-primary,#D4AF37)]'
                        : 'border-dashed border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-bold">{tr('مخصص للمنشأة', 'Custom Enterprise')}</span>
                    <span className="text-[11px] text-slate-500">{tr('تعديل كل الرموز يدوياً', 'Customize all design tokens')}</span>
                  </button>
                </div>
              </SpotlightCard>

              <SpotlightCard>
                <form onSubmit={handleSaveBranding} className="grid gap-4 text-start sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>{tr('اللون الأساسي', 'Primary Brand Color')}</label>
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => {
                        setPrimaryColor(e.target.value);
                        setThemePreset('CUSTOM');
                        setIsDirty(true);
                      }}
                      className="h-11 w-full rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{tr('اللون الثانوي', 'Accent Color')}</label>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => {
                        setAccentColor(e.target.value);
                        setThemePreset('CUSTOM');
                        setIsDirty(true);
                      }}
                      className="h-11 w-full rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{tr('لون التوهج (Spotlight)', 'Spotlight Glow')}</label>
                    <input
                      dir="ltr"
                      value={spotlightColor}
                      onChange={(e) => {
                        setSpotlightColor(e.target.value);
                        setIsDirty(true);
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{tr('المظهر الافتراضي', 'Default Theme')}</label>
                    <select
                      value={defaultTheme}
                      onChange={(e) => {
                        setDefaultTheme(e.target.value as 'LIGHT' | 'DARK' | 'SYSTEM');
                        setIsDirty(true);
                      }}
                      className={inputCls}
                    >
                      <option value="SYSTEM">{tr('تلقائي (النظام)', 'System')}</option>
                      <option value="DARK">{tr('داكن', 'Dark')}</option>
                      <option value="LIGHT">{tr('فاتح', 'Light')}</option>
                    </select>
                  </div>

                  {/* Surface, Card & Radius Tokens */}
                  <div>
                    <label className={labelCls}>{tr('خلفية الوضع الفاتح', 'Light Surface Background')}</label>
                    <input dir="ltr" value={surfaceLight} onChange={(e) => { setSurfaceLight(e.target.value); setThemePreset('CUSTOM'); setIsDirty(true); }} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{tr('خلفية الوضع الداكن', 'Dark Surface Background')}</label>
                    <input dir="ltr" value={surfaceDark} onChange={(e) => { setSurfaceDark(e.target.value); setThemePreset('CUSTOM'); setIsDirty(true); }} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{tr('خلفية البطاقات (فاتح / داكن)', 'Card Surface (Light)')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input dir="ltr" value={cardLight} onChange={(e) => { setCardLight(e.target.value); setIsDirty(true); }} className={inputCls} title="Light Card" />
                      <input dir="ltr" value={cardDark} onChange={(e) => { setCardDark(e.target.value); setIsDirty(true); }} className={inputCls} title="Dark Card" />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{tr('حدود البطاقات وتدوير الزوايا', 'Border & Card Radius')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input dir="ltr" value={borderDark} onChange={(e) => { setBorderDark(e.target.value); setIsDirty(true); }} className={inputCls} title="Dark Border" />
                      <select value={cardRadius} onChange={(e) => { setCardRadius(e.target.value); setIsDirty(true); }} className={inputCls}>
                        <option value="0.5rem">Sharp (0.5rem)</option>
                        <option value="0.75rem">Balanced (0.75rem)</option>
                        <option value="1rem">Rounded (1rem)</option>
                      </select>
                    </div>
                  </div>

                  {/* Logos & Integrated Uploaders */}
                  <div className="space-y-1.5">
                    <label className={labelCls}>{tr('شعار الوضع الفاتح', 'Light Logo URL / Upload')}</label>
                    <input dir="ltr" value={logoLightUrl} onChange={(e) => { setLogoLightUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingField === 'logo_light'}
                      onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], 'branding', setLogoLightUrl, 'logo_light')}
                      className="block w-full text-[11px] text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{tr('شعار الوضع الداكن', 'Dark Logo URL / Upload')}</label>
                    <input dir="ltr" value={logoDarkUrl} onChange={(e) => { setLogoDarkUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingField === 'logo_dark'}
                      onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], 'branding', setLogoDarkUrl, 'logo_dark')}
                      className="block w-full text-[11px] text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{tr('أيقونة التبويب (Favicon)', 'Favicon URL / Upload')}</label>
                    <input dir="ltr" value={faviconUrl} onChange={(e) => { setFaviconUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingField === 'favicon'}
                      onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], 'branding', setFaviconUrl, 'favicon')}
                      className="block w-full text-[11px] text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{tr('صورة مدير المنشأة', 'Owner Avatar URL / Upload')}</label>
                    <input dir="ltr" value={ownerAvatarUrl} onChange={(e) => { setOwnerAvatarUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingField === 'avatar'}
                      onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], 'profile', setOwnerAvatarUrl, 'avatar')}
                      className="block w-full text-[11px] text-slate-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={enableSpotlight}
                        onChange={(e) => {
                          setEnableSpotlight(e.target.checked);
                          setIsDirty(true);
                        }}
                      />
                      <span>{tr('تفعيل تأثير الإضاءة التفاعلي (Hover Spotlight)', 'Enable Hover Spotlight Glow')}</span>
                    </label>
                  </div>
                  <div>
                    <label className={labelCls}>{tr('تذييل الفاتورة (عربي)', 'Invoice Footer (Arabic)')}</label>
                    <textarea
                      value={footerAr}
                      onChange={(e) => {
                        setFooterAr(e.target.value);
                        setIsDirty(true);
                      }}
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{tr('تذييل الفاتورة (إنجليزي)', 'Invoice Footer (English)')}</label>
                    <textarea
                      value={footerEn}
                      onChange={(e) => {
                        setFooterEn(e.target.value);
                        setIsDirty(true);
                      }}
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <button type="submit" className="min-h-[44px] sm:col-span-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
                    {tr('حفظ وتطبيق الهوية البصرية', 'Save & Apply Branding')}
                  </button>
                </form>
              </SpotlightCard>
            </div>

            {/* Live Theme Preview Panel */}
            <aside className="space-y-4 lg:col-span-4">
              <SpotlightCard className="sticky top-20 space-y-4 text-start">
                <SpotlightHeading as="h3" className="text-base">
                  {tr('معاينة حية للثيم والبطاقات', 'Live White-Label Theme Preview')}
                </SpotlightHeading>
                <div
                  className="space-y-3 border p-4 transition-all"
                  style={{
                    backgroundColor: defaultTheme === 'LIGHT' ? surfaceLight : surfaceDark,
                    borderColor: defaultTheme === 'LIGHT' ? borderLight : borderDark,
                    borderRadius: cardRadius,
                    color: defaultTheme === 'LIGHT' ? '#0F172A' : '#F8FAFC',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {(logoDarkUrl || logoLightUrl) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={defaultTheme === 'LIGHT' ? logoLightUrl || logoDarkUrl : logoDarkUrl || logoLightUrl}
                          alt="Brand Logo Preview"
                          className="h-8 w-auto max-w-[100px] rounded object-contain"
                        />
                      ) : (
                        <span
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold"
                          style={{ backgroundColor: primaryColor, color: buttonTextColor }}
                        >
                          V
                        </span>
                      )}
                      <span className="text-xs font-bold">{heroTitleEn || tenantSlug || 'Venue Brand'}</span>
                    </div>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: accentColor, color: '#FFFFFF' }}
                    >
                      {themePreset}
                    </span>
                  </div>

                  <div
                    className="space-y-2 border p-3"
                    style={{
                      backgroundColor: defaultTheme === 'LIGHT' ? cardLight : cardDark,
                      borderColor: defaultTheme === 'LIGHT' ? borderLight : borderDark,
                      borderRadius: cardRadius,
                      boxShadow: enableSpotlight ? `0 0 24px ${spotlightColor}` : undefined,
                    }}
                  >
                    <div className="text-xs font-bold">{tr('نموذج بطاقة حجز القاعة', 'Sample Venue Booking Card')}</div>
                    <p className="text-[11px] opacity-75">
                      {tr('يعكس هذا النموذج الألوان والخلفيات وتدوير البطاقات فور النشر.', 'Reflects live tokens across Storefront, Portal, and ERP.')}
                    </p>
                    <button
                      type="button"
                      className="w-full rounded-lg py-2 text-xs font-bold"
                      style={{ backgroundColor: primaryColor, color: buttonTextColor }}
                    >
                      {tr('احجز القاعة الآن', 'Reserve Hall')}
                    </button>
                  </div>
                </div>
              </SpotlightCard>
            </aside>
          </div>
        )}

        {activeTab === 'HERO_CONTACT' && (
          <SpotlightCard>
            <form onSubmit={handleSaveStorefront} className="grid gap-4 text-start sm:grid-cols-2">
              <div className="flex items-center gap-2 font-bold sm:col-span-2">
                <Sparkles className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('محتوى البطل وبيانات التواصل', 'Hero Copy, Media & Venue Contact')}</span>
              </div>
              <div>
                <label className={labelCls}>{tr('عنوان الواجهة (عربي)', 'Hero Title (AR)')}</label>
                <input value={heroTitleAr} onChange={(e) => { setHeroTitleAr(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('عنوان الواجهة (إنجليزي)', 'Hero Title (EN)')}</label>
                <input value={heroTitleEn} onChange={(e) => { setHeroTitleEn(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('الوصف الفرعي (عربي)', 'Hero Subtitle (AR)')}</label>
                <input value={heroSubtitleAr} onChange={(e) => { setHeroSubtitleAr(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('الوصف الفرعي (إنجليزي)', 'Hero Subtitle (EN)')}</label>
                <input value={heroSubtitleEn} onChange={(e) => { setHeroSubtitleEn(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{tr('صورة الخلفية (Banner)', 'Hero Banner Image URL / Upload')}</label>
                <input dir="ltr" value={heroBannerUrl} onChange={(e) => { setHeroBannerUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingField === 'hero_banner'}
                  onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], 'hero', setHeroBannerUrl, 'hero_banner')}
                  className="block w-full text-[11px] text-slate-500"
                />
              </div>
              <div>
                <label className={labelCls}>{tr('رابط فيديو الجولة (MP4 / Embed)', 'Hero Tour Video URL')}</label>
                <input dir="ltr" value={heroVideoUrl} onChange={(e) => { setHeroVideoUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('هاتف القاعة', 'Contact Phone')}</label>
                <input dir="ltr" value={contactPhone} onChange={(e) => { setContactPhone(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('رقم واتساب', 'WhatsApp Number')}</label>
                <input dir="ltr" value={whatsappNumber} onChange={(e) => { setWhatsappNumber(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('العنوان (عربي)', 'Address (AR)')}</label>
                <input value={addressAr} onChange={(e) => { setAddressAr(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tr('العنوان (إنجليزي)', 'Address (EN)')}</label>
                <input value={addressEn} onChange={(e) => { setAddressEn(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Instagram URL</label>
                <input dir="ltr" value={instagramUrl} onChange={(e) => { setInstagramUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Facebook URL</label>
                <input dir="ltr" value={facebookUrl} onChange={(e) => { setFacebookUrl(e.target.value); setIsDirty(true); }} className={inputCls} />
              </div>
              <button type="submit" className="min-h-[44px] sm:col-span-2 rounded-xl bg-[var(--brand-primary,#D4AF37)] text-sm font-bold text-slate-950">
                {tr('حفظ إعدادات الواجهة', 'Save Hero & Contact')}
              </button>
            </form>
          </SpotlightCard>
        )}

        {activeTab === 'HALL_MEDIA' && (
          <SpotlightCard className="space-y-5 text-start">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold">
                <ImageIcon className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
                <span>{tr('معارض صور وفيديوهات القاعات', 'Per-Hall Photo Galleries & Video Tours')}</span>
              </div>
              <Link
                href={tenantPath(locale, tenantSlug, '/erp/settings/media')}
                className="text-xs font-bold text-[var(--brand-primary,#D4AF37)] underline"
              >
                {tr('مدير الوسائط والملفات المباشر', 'Open Media Uploader')}
              </Link>
            </div>
            {halls.map((h) => {
              const draft = hallMedia[h.id] || { gallery_urls_text: '', video_url: '', amenities_text: '' };
              const updateDraft = (patch: Partial<HallMediaDraft>) => {
                setIsDirty(true);
                setHallMedia((prev) => ({ ...prev, [h.id]: { ...draft, ...patch } }));
              };
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
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingField === `hall_${h.id}`}
                      onChange={(e) =>
                        e.target.files?.[0] &&
                        uploadAsset(
                          e.target.files[0],
                          'halls',
                          (url) => updateDraft({ gallery_urls_text: [draft.gallery_urls_text, url].filter(Boolean).join('\n') }),
                          `hall_${h.id}`
                        )
                      }
                      className="mt-1.5 block w-full text-[11px] text-slate-500"
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
          <SpotlightCard className="space-y-4 text-start">
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
              const patchOffer = (patch: Partial<OfferDraft>) => {
                setIsDirty(true);
                setOffers((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
              };
              return (
                <div key={idx} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-amber-500">#{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDirty(true);
                        setOffers((prev) => prev.filter((_, i) => i !== idx));
                      }}
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
