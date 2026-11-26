'use client';

import React, { useState } from 'react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export function WorkspaceConnectScreen({ locale = 'ar', onConnected }: { locale?: 'ar' | 'en'; onConnected?: (cfg: { slug: string; apiUrl: string }) => void }) {
  const isRtl = locale === 'ar';
  const [slug, setSlug] = useState('almassa');
  const [mode, setMode] = useState<'CLOUD' | 'LAN'>('CLOUD');
  const [lanIp, setLanIp] = useState('http://192.168.1.100:8000/api/v1');

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const apiUrl = mode === 'CLOUD' ? `https://${slug}.eventledger.cloud/api/v1` : lanIp;
    if (typeof window !== 'undefined') {
      localStorage.setItem('eventledger_native_tenant', JSON.stringify({ slug, apiUrl }));
    }
    onConnected?.({ slug, apiUrl });
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <SpotlightCard className="w-full max-w-md space-y-4">
        <SpotlightHeading as="h2" className="text-xl">
          {isRtl ? 'ربط تطبيق إيفنت ليدجر (EventLedger)' : 'Connect EventLedger Workspace'}
        </SpotlightHeading>
        <form onSubmit={handleConnect} className="space-y-3">
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="almassa" required className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('CLOUD')} className={`flex-1 rounded-lg border py-2 text-xs ${mode === 'CLOUD' ? 'border-[var(--brand-primary)]' : 'border-slate-700'}`}>Cloud</button>
            <button type="button" onClick={() => setMode('LAN')} className={`flex-1 rounded-lg border py-2 text-xs ${mode === 'LAN' ? 'border-[var(--brand-primary)]' : 'border-slate-700'}`}>LAN</button>
          </div>
          {mode === 'LAN' && <input value={lanIp} onChange={(e) => setLanIp(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs" />}
          <button type="submit" className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950">
            {isRtl ? 'دخول النظام' : 'Launch Workspace'}
          </button>
        </form>
      </SpotlightCard>
    </div>
  );
}
