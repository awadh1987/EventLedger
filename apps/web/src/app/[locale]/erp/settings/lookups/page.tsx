'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import type { RecordLifecycle, SystemLookupItem } from '@/lib/types';

export default function SystemLookupsPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [items, setItems] = useState<SystemLookupItem[]>([]);
  const [category, setCategory] = useState('EVENT_TYPE');
  const [code, setCode] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [labelEn, setLabelEn] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<SystemLookupItem[]>('/api/v1/lookups?include_inactive=true');
      setItems(data);
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createItem = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/v1/lookups', {
      method: 'POST',
      body: { category, code, label_ar: labelAr, label_en: labelEn, sort_order: items.length + 1 },
    });
    setCode('');
    setLabelAr('');
    setLabelEn('');
    await load();
  };

  const updateLifecycle = async (id: string, lifecycle: RecordLifecycle) => {
    await apiFetch(`/api/v1/lookups/${id}`, { method: 'PATCH', body: { lifecycle } });
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <SpotlightHeading as="h1" className="text-2xl">
          {isRtl ? 'إدارة القوائم المرجعية (SystemLookups)' : 'Standardized SystemLookups & Lifecycles'}
        </SpotlightHeading>

        <SpotlightCard>
          <form onSubmit={createItem} className="grid gap-3 sm:grid-cols-5">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {['EVENT_TYPE', 'INVENTORY_CATEGORY', 'EXPENSE_CATEGORY', 'PAYMENT_METHOD', 'REFUND_METHOD', 'GATE_PASS_TYPE', 'DEPARTMENT'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="CODE" className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-950" />
            <input value={labelAr} onChange={(e) => setLabelAr(e.target.value)} required placeholder="الاسم بالعربية" className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} required placeholder="English Label" className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <button type="submit" className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] text-xs font-bold text-slate-950">
              {isRtl ? 'إضافة عنصر' : 'Add Lookup'}
            </button>
          </form>
        </SpotlightCard>

        <ResponsiveDataList
          data={items}
          locale={locale}
          mobileCardHeader={(r) => `${r.category}: ${isRtl ? r.label_ar : r.label_en}`}
          columns={[
            { key: 'cat', headerAr: 'الفئة', headerEn: 'Category', render: (r) => <span className="font-mono text-xs">{r.category}</span> },
            { key: 'code', headerAr: 'الرمز', headerEn: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: 'label', headerAr: 'التسمية', headerEn: 'Label', render: (r) => (isRtl ? r.label_ar : r.label_en) },
            {
              key: 'life',
              headerAr: 'الحالة',
              headerEn: 'Lifecycle',
              render: (r) => (
                <select
                  value={r.lifecycle}
                  onChange={(e) => updateLifecycle(r.id, e.target.value as RecordLifecycle)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                >
                  {['DRAFT', 'ACTIVE', 'ARCHIVED', 'DELETED'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              ),
            },
          ]}
        />
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
