'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Palette, Save } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useTenantBranding,
  type TenantBrandingConfig,
} from '@/components/providers/theme-branding-provider';

const COLOR_PRESETS = [
  { nameEn: 'Royal Gold', nameAr: 'ذهبي ملكي', primary: '#D4AF37', accent: '#0F172A', glow: 'rgba(212, 175, 55, 0.18)' },
  { nameEn: 'Sovereign Emerald', nameAr: 'زمردي فاخر', primary: '#10B981', accent: '#064E3B', glow: 'rgba(16, 185, 129, 0.18)' },
  { nameEn: 'Imperial Sapphire', nameAr: 'أزرق ياقوتي', primary: '#2563EB', accent: '#0F172A', glow: 'rgba(37, 99, 235, 0.18)' },
  { nameEn: 'Rosewood Amber', nameAr: 'عنبر برونزي', primary: '#D97706', accent: '#1C1917', glow: 'rgba(217, 119, 6, 0.18)' },
  { nameEn: 'Crimson Velvet', nameAr: 'عنابي مخملي', primary: '#E11D48', accent: '#1F1016', glow: 'rgba(225, 29, 72, 0.18)' },
];

export function TenantBrandingStudio({ locale }: { locale: 'ar' | 'en' }) {
  const isRtl = locale === 'ar';
  const { authFetch } = useAuth();
  const branding = useTenantBranding();

  const [form, setForm] = useState<TenantBrandingConfig>(branding);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(branding);
  }, [branding]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to save branding');
      if (data?.branding) {
        branding.applyBranding(data.branding);
      }
      setSavedNotice(
        isRtl
          ? 'تم حفظ الهوية البصرية وتطبيقها فوراً على بوابة الحجز والفواتير ولوحة التحكم.'
          : 'Tenant branding saved and applied live across the booking storefront, invoices, and ERP.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save branding');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <form
        onSubmit={handleSave}
        className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {isRtl ? 'استوديو الهوية البصرية والعلامة التجارية للصالة' : 'Tenant Branding & White-Label Studio'}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isRtl
                ? 'تحكم بألوان المنصة، اسم الصالة، النطاق المخصص، وتذييل الفواتير الرسمية بصيغة PDF.'
                : 'Customize venue colors, bilingual identity, custom domain, tax rate, and official PDF invoice footers.'}
            </p>
          </div>
          <Link
            href={`/${locale}/venue`}
            className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span>{isRtl ? 'معاينة بوابة الحجز' : 'Open Storefront'}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}
        {savedNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
            {savedNotice}
          </div>
        )}

        {/* Palette Presets */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <Palette className="h-3.5 w-3.5" />
            <span>{isRtl ? 'لوحات ألوان فاخرة جاهزة' : 'Curated Venue Color Palettes'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {COLOR_PRESETS.map((preset) => {
              const selected = form.primaryColor.toLowerCase() === preset.primary.toLowerCase();
              return (
                <button
                  key={preset.primary}
                  type="button"
                  onClick={() => {
                    const next = {
                      ...form,
                      primaryColor: preset.primary,
                      accentColor: preset.accent,
                      spotlightColor: preset.glow,
                    };
                    setForm(next);
                    branding.applyBranding(next);
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-xs transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-50 font-semibold dark:border-slate-100 dark:bg-slate-800'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded"
                    style={{ backgroundColor: preset.primary }}
                  />
                  <span className="truncate">{isRtl ? preset.nameAr : preset.nameEn}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Identity Fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'اسم الصالة (عربي)' : 'Venue Name (Arabic)'}
            </label>
            <input
              required
              value={form.venueNameAr}
              onChange={(e) => setForm((f) => ({ ...f, venueNameAr: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'اسم الصالة (إنجليزي)' : 'Venue Name (English)'}
            </label>
            <input
              required
              value={form.venueNameEn}
              onChange={(e) => setForm((f) => ({ ...f, venueNameEn: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'الشعار اللفظي (عربي)' : 'Storefront Tagline (Arabic)'}
            </label>
            <input
              value={form.taglineAr}
              onChange={(e) => setForm((f) => ({ ...f, taglineAr: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'الشعار اللفظي (إنجليزي)' : 'Storefront Tagline (English)'}
            </label>
            <input
              value={form.taglineEn}
              onChange={(e) => setForm((f) => ({ ...f, taglineEn: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'اللون الرئيسي (Hex)' : 'Primary Brand Color'}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm((f) => ({ ...f, primaryColor: val }));
                  branding.applyBranding({ primaryColor: val });
                }}
                className="h-[38px] w-12 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
              />
              <input
                value={form.primaryColor}
                onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                className="min-h-[38px] flex-1 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'النطاق المخصص' : 'Custom Domain'}
            </label>
            <input
              value={form.customDomain}
              onChange={(e) => setForm((f) => ({ ...f, customDomain: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
        </div>

        {/* Financial & Contact Settings */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'العملة الافتراضية' : 'Default Currency'}
            </label>
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            >
              <option value="YER">YER — Yemeni Rial</option>
              <option value="SAR">SAR — Saudi Riyal</option>
              <option value="USD">USD — US Dollar</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'نسبة الضريبة (%)' : 'Tax Rate (%)'}
            </label>
            <input
              type="number"
              min={0}
              max={30}
              value={form.taxRate}
              onChange={(e) => setForm((f) => ({ ...f, taxRate: Number(e.target.value) }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'تأمين الأضرار الافتراضي' : 'Default Security Deposit'}
            </label>
            <input
              type="number"
              min={0}
              value={form.defaultSecurityDeposit}
              onChange={(e) =>
                setForm((f) => ({ ...f, defaultSecurityDeposit: Number(e.target.value) }))
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'هاتف التواصل' : 'Contact Phone'}
            </label>
            <input
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'البريد الإلكتروني الرسمي' : 'Official Email'}
            </label>
            <input
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
        </div>

        {/* Custom Invoice Footers */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'تذييل الفاتورة الرسمية PDF (عربي)' : 'PDF Invoice Footer (Arabic)'}
            </label>
            <textarea
              rows={3}
              value={form.invoiceFooterAr}
              onChange={(e) => setForm((f) => ({ ...f, invoiceFooterAr: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {isRtl ? 'تذييل الفاتورة الرسمية PDF (إنجليزي)' : 'PDF Invoice Footer (English)'}
            </label>
            <textarea
              rows={3}
              value={form.invoiceFooterEn}
              onChange={(e) => setForm((f) => ({ ...f, invoiceFooterEn: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-6 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : isRtl ? 'حفظ وتطبيق الهوية' : 'Save & Apply Branding'}</span>
        </button>
      </form>

      {/* Live Branded Preview Column */}
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="h-2 w-full" style={{ backgroundColor: form.primaryColor }} />
          <div className="p-5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {isRtl ? 'معاينة فورية لبوابة الحجز والفاتورة' : 'Live Storefront & Invoice Preview'}
            </div>
            <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100">
              {isRtl ? form.venueNameAr : form.venueNameEn}
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {isRtl ? form.taglineAr : form.taglineEn}
            </p>
            <div className="mt-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {form.customDomain} · {form.currency} · {form.taxRate}% VAT
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span
                className="inline-flex min-h-[34px] items-center rounded-lg px-4 text-xs font-semibold text-slate-950"
                style={{ backgroundColor: form.primaryColor }}
              >
                {isRtl ? 'احجز قاعتك الآن' : 'Book Your Hall'}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                <span>{isRtl ? 'متزامن لحظياً' : 'Live Synced'}</span>
              </span>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                {isRtl ? 'تذييل الفاتورة الرسمية (PDF)' : 'Official Invoice PDF Footer'}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {isRtl ? form.invoiceFooterAr : form.invoiceFooterEn}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
