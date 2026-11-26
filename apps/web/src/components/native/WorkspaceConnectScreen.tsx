'use client';

import React, { useState } from 'react';
import { apiFetch, setNativeWorkspace } from '@/lib/api';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { PublicTenant } from '@/lib/types';

export function WorkspaceConnectScreen({
  locale = 'ar',
  onConnected,
}: {
  locale?: 'ar' | 'en';
  onConnected?: (cfg: { slug: string; apiOrigin: string }) => void;
}) {
  const isRtl = locale === 'ar';
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'events-ye.services').split(':')[0];
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState<'CLOUD' | 'LAN'>('CLOUD');
  const [lanIp, setLanIp] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTesting(true);
    const cleanSlug = slug.toLowerCase().trim();
    const apiOrigin =
      mode === 'CLOUD'
        ? `https://${cleanSlug}.${rootDomain}`
        : lanIp.trim().replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');

    try {
      await apiFetch<{ status: string }>('/health', { originOverride: apiOrigin, skipAuth: true });
      await apiFetch<PublicTenant>('/api/v1/public/tenant', {
        originOverride: apiOrigin,
        slugOverride: cleanSlug,
        skipAuth: true,
      });
      setNativeWorkspace({ slug: cleanSlug, apiOrigin });
      onConnected?.({ slug: cleanSlug, apiOrigin });
    } catch (err) {
      setError(
        isRtl
          ? `تعذر الاتصال بالخادم (${err instanceof Error ? err.message : 'خطأ شبكة'}).`
          : `Failed to connect (${err instanceof Error ? err.message : 'network error'}).`
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <SpotlightCard className="w-full max-w-md space-y-4">
        <SpotlightHeading as="h2" className="text-xl">
          {isRtl ? 'ربط تطبيق إيفنت ليدجر (EventLedger)' : 'Connect EventLedger Workspace'}
        </SpotlightHeading>
        <p className="text-xs text-slate-400">
          {isRtl
            ? 'اختر السحابة أو خادم الشبكة المحلية للقاعة ثم أدخل معرف القاعة.'
            : 'Choose Cloud or Local Venue LAN server and enter your venue slug.'}
        </p>
        <form onSubmit={handleConnect} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">{isRtl ? 'معرف القاعة (Slug)' : 'Venue Slug'}</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="your-venue-slug"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('CLOUD')}
              className={`min-h-[44px] flex-1 rounded-lg border py-2 text-xs font-semibold ${
                mode === 'CLOUD' ? 'border-[var(--brand-primary,#D4AF37)] text-[var(--brand-primary,#D4AF37)]' : 'border-slate-700'
              }`}
            >
              {isRtl ? 'السحابة (Cloud)' : 'Cloud'}
            </button>
            <button
              type="button"
              onClick={() => setMode('LAN')}
              className={`min-h-[44px] flex-1 rounded-lg border py-2 text-xs font-semibold ${
                mode === 'LAN' ? 'border-[var(--brand-primary,#D4AF37)] text-[var(--brand-primary,#D4AF37)]' : 'border-slate-700'
              }`}
            >
              {isRtl ? 'شبكة محلية (LAN)' : 'Local LAN'}
            </button>
          </div>
          {mode === 'LAN' && (
            <input
              value={lanIp}
              onChange={(e) => setLanIp(e.target.value)}
              placeholder="http://192.168.x.x:8000/api/v1"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
            />
          )}
          {error && <p className="rounded-lg bg-red-950/60 p-2 text-xs text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={testing}
            className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60"
          >
            {testing ? (isRtl ? 'جارٍ الفحص...' : 'Testing connection...') : isRtl ? 'اتصال ودخول' : 'Connect & Launch'}
          </button>
        </form>
      </SpotlightCard>
    </div>
  );
}
