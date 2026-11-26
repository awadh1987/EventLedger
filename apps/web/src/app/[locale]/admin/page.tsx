'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import type { SubscriptionTier } from '@/lib/types';

interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  subscription_tier: SubscriptionTier;
  is_active: boolean;
  users_count: number;
  events_count: number;
}

export default function SuperAdminConsolePage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await apiFetch<AdminTenantRow[]>('/api/v1/admin/tenants');
      setTenants(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Super-admin access required');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (row: AdminTenantRow) => {
    await apiFetch(`/api/v1/admin/tenants/${row.id}`, {
      method: 'PATCH',
      body: { is_active: !row.is_active },
    });
    await load();
  };

  const changeTier = async (row: AdminTenantRow, nextTier: SubscriptionTier) => {
    await apiFetch(`/api/v1/admin/tenants/${row.id}`, {
      method: 'PATCH',
      body: { subscription_tier: nextTier },
    });
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} title={isRtl ? 'إدارة المنصة (Super Admin)' : 'Platform Super Admin'} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <SpotlightHeading as="h1" className="text-2xl">
          {isRtl ? 'المستأجرون والقاعات المشتركة' : 'Registered Venue Tenants'}
        </SpotlightHeading>

        {error && (
          <SpotlightCard className="border-red-500/40 bg-red-500/10 text-xs text-red-500">{error}</SpotlightCard>
        )}

        <ResponsiveDataList
          data={tenants}
          locale={locale}
          mobileCardHeader={(r) => `${r.name} (${r.slug})`}
          columns={[
            { key: 'name', headerAr: 'القاعة', headerEn: 'Venue', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'slug', headerAr: 'النطاق', headerEn: 'Slug', render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
            {
              key: 'tier',
              headerAr: 'الباقة',
              headerEn: 'Tier',
              render: (r) => (
                <select
                  value={r.subscription_tier}
                  onChange={(e) => changeTier(r, e.target.value as SubscriptionTier)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                >
                  <option value="BASIC">BASIC</option>
                  <option value="PRO">PRO</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              ),
            },
            { key: 'stats', headerAr: 'المستخدمون / الفعاليات', headerEn: 'Users / Events', render: (r) => `${r.users_count} / ${r.events_count}` },
            {
              key: 'active',
              headerAr: 'الحالة',
              headerEn: 'Status',
              render: (r) => (
                <button
                  type="button"
                  onClick={() => toggleActive(r)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    r.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {r.is_active ? (isRtl ? 'نشط' : 'Active') : isRtl ? 'موقوف' : 'Suspended'}
                </button>
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}
