'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function SaasLandingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const [venueName, setVenueName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/v1/public/tenants/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_name: venueName, slug, owner_name: ownerName, owner_phone: phone }),
    });
    const data = await res.json();
    if (data?.slug) {
      const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local').split(':')[0];
      window.location.href = `${window.location.protocol}//${data.slug}.${root}/${locale}/erp/dashboard`;
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-4xl space-y-8 px-6 py-16">
      <div className="text-center">
        <SpotlightHeading as="h1" className="text-3xl sm:text-5xl">
          {isRtl ? 'إيفنت ليدجر — نظام إدارة القاعات والمؤتمرات' : 'EventLedger — Venue & Conference SaaS ERP'}
        </SpotlightHeading>
      </div>
      <SpotlightCard className="mx-auto max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder={isRtl ? 'اسم الصالة' : 'Venue Name'} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="almassa" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder={isRtl ? 'اسم المالك' : 'Owner Name'} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+967770000001" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <button type="submit" className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950">
            {isRtl ? 'تفعيل المنصة الآن' : 'Launch Workspace'}
          </button>
        </form>
      </SpotlightCard>
    </div>
  );
}
