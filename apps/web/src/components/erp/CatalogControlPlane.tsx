'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CalendarClock,
  Copy,
  Edit3,
  Package,
  Plus,
  RefreshCw,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { apiFetch, tenantPath } from '@/lib/api';
import { LookupSelect } from '@/components/ui/LookupSelect';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { HallInfo, RecordLifecycle } from '@/lib/types';

type CatalogSection = 'HALLS' | 'CATERING' | 'INVENTORY' | 'PRICING_RULES';

export interface CatalogInventoryRow {
  id: string;
  name: string;
  category: string;
  total_stock: number;
  unit_addon_price: number;
  lifecycle: RecordLifecycle;
  allocated_count?: number;
}

export interface CatalogCateringRow {
  id: string;
  name_ar: string;
  name_en: string;
  price_per_guest: number;
  cost_per_guest: number;
  lifecycle: RecordLifecycle;
}

export interface CatalogPricingRuleRow {
  id: string;
  hall_id: string | null;
  name: string;
  days_of_week: number[] | null;
  start_date: string | null;
  end_date: string | null;
  multiplier: number;
  is_active: boolean;
}

interface Props {
  locale: 'ar' | 'en';
  tenantSlug: string;
  onCatalogChanged?: () => Promise<void> | void;
}

const DAY_LABELS = [
  { day: 0, ar: 'الأحد', en: 'Sun' },
  { day: 1, ar: 'الاثنين', en: 'Mon' },
  { day: 2, ar: 'الثلاثاء', en: 'Tue' },
  { day: 3, ar: 'الأربعاء', en: 'Wed' },
  { day: 4, ar: 'الخميس', en: 'Thu' },
  { day: 5, ar: 'الجمعة', en: 'Fri' },
  { day: 6, ar: 'السبت', en: 'Sat' },
];

export function CatalogControlPlane({ locale, tenantSlug, onCatalogChanged }: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [section, setSection] = useState<CatalogSection>('HALLS');
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [catering, setCatering] = useState<CatalogCateringRow[]>([]);
  const [inventory, setInventory] = useState<CatalogInventoryRow[]>([]);
  const [rules, setRules] = useState<CatalogPricingRuleRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hall form
  const [editingHallId, setEditingHallId] = useState<string | null>(null);
  const [hallForm, setHallForm] = useState({
    name: '',
    name_ar: '',
    capacity_banquet: '300',
    capacity_theater: '500',
    base_price: '250000',
    cleaning_buffer_minutes: '120',
    combinable_with_hall_id: '',
    lifecycle: 'ACTIVE' as RecordLifecycle,
  });

  // Catering form
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({
    name_ar: '',
    name_en: '',
    price_per_guest: '5000',
    cost_per_guest: '2500',
    lifecycle: 'ACTIVE' as RecordLifecycle,
  });

  // Inventory form
  const [editingInvId, setEditingInvId] = useState<string | null>(null);
  const [invForm, setInvForm] = useState({
    name: '',
    category: 'AUDIO_VISUAL',
    total_stock: '10',
    unit_addon_price: '25000',
    lifecycle: 'ACTIVE' as RecordLifecycle,
  });

  // Pricing rule form
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({
    name: '',
    hall_id: '',
    days_of_week: [4, 5] as number[],
    start_date: '',
    end_date: '',
    multiplier: '1.25',
    is_active: true,
  });

  const loadAll = useCallback(async () => {
    try {
      const [h, c, i, r] = await Promise.all([
        apiFetch<HallInfo[]>('/api/v1/venue/halls?include_inactive=true'),
        apiFetch<CatalogCateringRow[]>('/api/v1/venue/catering?include_inactive=true'),
        apiFetch<CatalogInventoryRow[]>('/api/v1/venue/inventory?include_inactive=true'),
        apiFetch<CatalogPricingRuleRow[]>('/api/v1/venue/pricing-rules'),
      ]);
      setHalls(h);
      setCatering(c);
      setInventory(i);
      setRules(r);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر تحميل الكتالوج', 'Failed to load catalog'));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const notifySync = async (msg: string) => {
    setNotice(msg);
    await loadAll();
    if (onCatalogChanged) await onCatalogChanged();
  };

  const seedStarterCatalog = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ added?: Record<string, number> }>('/api/v1/venue/catalog/seed-defaults', {
        method: 'POST',
      });
      await notifySync(
        tr(
          `تم تهيئة الكتالوج الافتراضي (+${res.added?.catering ?? 0} ضيافة، +${res.added?.inventory ?? 0} إضافات).`,
          `Starter catalog ensured (+${res.added?.catering ?? 0} catering, +${res.added?.inventory ?? 0} inventory).`
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل تهيئة الكتالوج', 'Seed failed'));
    } finally {
      setBusy(false);
    }
  };

  // Hall handlers
  const saveHall = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: hallForm.name.trim(),
        name_ar: hallForm.name_ar.trim(),
        capacity_banquet: Number(hallForm.capacity_banquet) || 100,
        capacity_theater: Number(hallForm.capacity_theater) || 150,
        base_price: Number(hallForm.base_price) || 0,
        cleaning_buffer_minutes: Number(hallForm.cleaning_buffer_minutes) || 120,
        combinable_with_hall_id: hallForm.combinable_with_hall_id || null,
        lifecycle: hallForm.lifecycle,
      };
      if (editingHallId) {
        await apiFetch(`/api/v1/venue/halls/${editingHallId}`, { method: 'PATCH', body });
        setEditingHallId(null);
        await notifySync(tr('تم تحديث القاعة بنجاح.', 'Hall updated.'));
      } else {
        await apiFetch('/api/v1/venue/halls', { method: 'POST', body });
        await notifySync(tr('تمت إضافة القاعة بنجاح.', 'Hall created.'));
      }
      setHallForm({
        name: '',
        name_ar: '',
        capacity_banquet: '300',
        capacity_theater: '500',
        base_price: '250000',
        cleaning_buffer_minutes: '120',
        combinable_with_hall_id: '',
        lifecycle: 'ACTIVE',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حفظ القاعة', 'Failed to save hall'));
    } finally {
      setBusy(false);
    }
  };

  const deleteHall = async (h: HallInfo) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ status: string; events_count: number }>(`/api/v1/venue/halls/${h.id}`, {
        method: 'DELETE',
      });
      await notifySync(
        res.status === 'ARCHIVED_IN_USE'
          ? tr(`القاعة مرتبطة بـ ${res.events_count} فعالية — تم أرشفتها بأمان.`, `Linked to ${res.events_count} event(s) — archived safely.`)
          : tr('تم حذف القاعة غير المستخدمة.', 'Unused hall deleted.')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر حذف القاعة', 'Hall delete failed'));
    } finally {
      setBusy(false);
    }
  };

  // Catering handlers
  const saveCatering = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name_ar: catForm.name_ar.trim(),
        name_en: catForm.name_en.trim(),
        price_per_guest: Number(catForm.price_per_guest) || 0,
        cost_per_guest: Number(catForm.cost_per_guest) || 0,
        lifecycle: catForm.lifecycle,
      };
      if (editingCatId) {
        await apiFetch(`/api/v1/venue/catering/${editingCatId}`, { method: 'PATCH', body });
        setEditingCatId(null);
        await notifySync(tr('تم تحديث باقة الضيافة.', 'Catering package updated.'));
      } else {
        await apiFetch('/api/v1/venue/catering', { method: 'POST', body });
        await notifySync(tr('تمت إضافة باقة الضيافة.', 'Catering package created.'));
      }
      setCatForm({ name_ar: '', name_en: '', price_per_guest: '5000', cost_per_guest: '2500', lifecycle: 'ACTIVE' });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حفظ الضيافة', 'Failed to save catering'));
    } finally {
      setBusy(false);
    }
  };

  const deleteCatering = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/venue/catering/${id}`, { method: 'DELETE' });
      await notifySync(tr('تمت إزالة/أرشفة باقة الضيافة.', 'Catering item removed/archived.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل الحذف', 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  // Inventory handlers
  const saveInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: invForm.name.trim(),
        category: invForm.category.trim().toUpperCase(),
        total_stock: Number(invForm.total_stock) || 1,
        unit_addon_price: Number(invForm.unit_addon_price) || 0,
        lifecycle: invForm.lifecycle,
      };
      if (editingInvId) {
        await apiFetch(`/api/v1/venue/inventory/${editingInvId}`, { method: 'PATCH', body });
        setEditingInvId(null);
        await notifySync(tr('تم تحديث صنف الإضافة.', 'Add-on item updated.'));
      } else {
        await apiFetch('/api/v1/venue/inventory', { method: 'POST', body });
        await notifySync(tr('تمت إضافة صنف جديد للمخزون.', 'Add-on item created.'));
      }
      setInvForm({ name: '', category: 'AUDIO_VISUAL', total_stock: '10', unit_addon_price: '25000', lifecycle: 'ACTIVE' });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حفظ الصنف', 'Failed to save item'));
    } finally {
      setBusy(false);
    }
  };

  const deleteInventory = async (row: CatalogInventoryRow) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ status: string; allocated_count: number }>(`/api/v1/venue/inventory/${row.id}`, {
        method: 'DELETE',
      });
      await notifySync(
        res.status === 'ARCHIVED_IN_USE'
          ? tr(`الصنف مخصص في ${res.allocated_count} فعالية — تم أرشفته بأمان.`, `Allocated to ${res.allocated_count} event(s) — archived safely.`)
          : tr('تم حذف الصنف غير المستخدم.', 'Unused item deleted.')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حذف الصنف', 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  // Pricing rule handlers
  const saveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: ruleForm.name.trim(),
        hall_id: ruleForm.hall_id || null,
        days_of_week: ruleForm.days_of_week.length > 0 ? ruleForm.days_of_week : null,
        start_date: ruleForm.start_date || null,
        end_date: ruleForm.end_date || null,
        multiplier: Number(ruleForm.multiplier) || 1.0,
        is_active: ruleForm.is_active,
      };
      if (editingRuleId) {
        await apiFetch(`/api/v1/venue/pricing-rules/${editingRuleId}`, { method: 'PATCH', body });
        setEditingRuleId(null);
        await notifySync(tr('تم تحديث قاعدة التسعير.', 'Pricing rule updated.'));
      } else {
        await apiFetch('/api/v1/venue/pricing-rules', { method: 'POST', body });
        await notifySync(tr('تمت إضافة قاعدة التسعير.', 'Pricing rule created.'));
      }
      setRuleForm({ name: '', hall_id: '', days_of_week: [4, 5], start_date: '', end_date: '', multiplier: '1.25', is_active: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حفظ قاعدة التسعير', 'Failed to save rule'));
    } finally {
      setBusy(false);
    }
  };

  const toggleRuleActive = async (r: CatalogPricingRuleRow) => {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/venue/pricing-rules/${r.id}`, {
        method: 'PATCH',
        body: { is_active: !r.is_active },
      });
      await notifySync(tr('تم تحديث تفعيل قاعدة التسعير.', 'Rule activation updated.'));
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/venue/pricing-rules/${id}`, { method: 'DELETE' });
      await notifySync(tr('تم حذف قاعدة التسعير.', 'Pricing rule deleted.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل الحذف', 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  const invCategoryBars = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory) {
      map.set(item.category, (map.get(item.category) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [inventory]);

  const maxBar = Math.max(1, ...invCategoryBars.map(([, c]) => c));

  return (
    <SpotlightCard className="space-y-5 text-start">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SpotlightHeading as="h2" className="text-lg">
            {tr('لوحة تحكم القاعات والضيافة والإضافات والتسعير', 'Halls, Catering, Add-Ons & Dynamic Pricing Control Plane')}
          </SpotlightHeading>
          <p className="text-xs text-slate-500">
            {tr(
              'القاعات والباقات ذات الحالة ACTIVE تظهر فوراً للعملاء في صفحة الحجز. الأرشفة تحمي الحجوزات المرتبطة.',
              'ACTIVE items appear immediately in the public booking storefront. Archiving protects linked events.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={seedStarterCatalog}
            disabled={busy}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{tr('تهيئة الباقات الافتراضية', 'Seed Starter Catalog')}</span>
          </button>
          <Link
            href={tenantPath(locale, tenantSlug, '/erp/settings/lookups')}
            className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 px-3 text-xs font-bold hover:border-amber-500 dark:border-slate-700"
          >
            {tr('إدارة القوائم المرجعية', 'System Lookups')}
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        {[
          { id: 'HALLS' as CatalogSection, icon: Building2, ar: `القاعات (${halls.length})`, en: `Halls (${halls.length})` },
          { id: 'CATERING' as CatalogSection, icon: UtensilsCrossed, ar: `الضيافة (${catering.length})`, en: `Catering (${catering.length})` },
          { id: 'INVENTORY' as CatalogSection, icon: Package, ar: `المعدات والإضافات (${inventory.length})`, en: `Add-Ons (${inventory.length})` },
          { id: 'PRICING_RULES' as CatalogSection, icon: CalendarClock, ar: `قواعد التسعير (${rules.length})`, en: `Pricing Rules (${rules.length})` },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = section === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                active
                  ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                  : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tr(tab.ar, tab.en)}</span>
            </button>
          );
        })}
      </div>

      {/* HALLS */}
      {section === 'HALLS' && (
        <div className="space-y-4">
          <form onSubmit={saveHall} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-4">
            <input required value={hallForm.name_ar} onChange={(e) => setHallForm({ ...hallForm, name_ar: e.target.value })} placeholder={tr('اسم القاعة بالعربية', 'Arabic Hall Name')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input required value={hallForm.name} onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })} placeholder="English Hall Name" className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="1" required value={hallForm.capacity_banquet} onChange={(e) => setHallForm({ ...hallForm, capacity_banquet: e.target.value })} placeholder={tr('سعة الضيافة', 'Banquet Cap')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="1" required value={hallForm.capacity_theater} onChange={(e) => setHallForm({ ...hallForm, capacity_theater: e.target.value })} placeholder={tr('سعة المسرح', 'Theater Cap')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="0" step="0.01" required value={hallForm.base_price} onChange={(e) => setHallForm({ ...hallForm, base_price: e.target.value })} placeholder={tr('السعر الأساسي', 'Base Price')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="0" value={hallForm.cleaning_buffer_minutes} onChange={(e) => setHallForm({ ...hallForm, cleaning_buffer_minutes: e.target.value })} placeholder={tr('دقائق التنظيف', 'Cleaning mins')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <select value={hallForm.lifecycle} onChange={(e) => setHallForm({ ...hallForm, lifecycle: e.target.value as RecordLifecycle })} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950">
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950">
                <Plus className="h-3.5 w-3.5" />
                <span>{editingHallId ? tr('تحديث', 'Update') : tr('إضافة قاعة', 'Add Hall')}</span>
              </button>
              {editingHallId && (
                <button type="button" onClick={() => setEditingHallId(null)} className="rounded-lg border border-slate-300 px-2.5 text-xs dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
              )}
            </div>
          </form>

          <ResponsiveDataList
            data={halls}
            locale={locale}
            mobileCardHeader={(r) => (isRtl ? r.name_ar : r.name)}
            columns={[
              { key: 'name', headerAr: 'القاعة', headerEn: 'Hall', render: (r) => <div className="text-xs"><div className="font-bold">{r.name_ar}</div><div className="text-slate-500">{r.name}</div></div> },
              { key: 'cap', headerAr: 'السعة', headerEn: 'Capacity', render: (r) => <span className="font-mono text-xs">{r.capacity_banquet} / {r.capacity_theater}</span> },
              { key: 'price', headerAr: 'السعر الأساسي', headerEn: 'Base Price', render: (r) => <span className="font-mono text-xs">{Number(r.base_price).toLocaleString()}</span> },
              { key: 'events', headerAr: 'الفعاليات', headerEn: 'Events', render: (r) => <span className="font-mono text-xs">{r.events_count ?? 0}</span> },
              {
                key: 'life',
                headerAr: 'الحالة',
                headerEn: 'Lifecycle',
                render: (r) => (
                  <select
                    value={r.lifecycle || 'ACTIVE'}
                    onChange={async (e) => {
                      await apiFetch(`/api/v1/venue/halls/${r.id}`, { method: 'PATCH', body: { lifecycle: e.target.value } });
                      await notifySync(tr('تم تحديث حالة القاعة.', 'Hall lifecycle updated.'));
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                ),
              },
              {
                key: 'act',
                headerAr: 'إجراءات',
                headerEn: 'Actions',
                render: (r) => (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingHallId(r.id);
                        setHallForm({
                          name: r.name,
                          name_ar: r.name_ar,
                          capacity_banquet: String(r.capacity_banquet),
                          capacity_theater: String(r.capacity_theater),
                          base_price: String(r.base_price),
                          cleaning_buffer_minutes: String(r.cleaning_buffer_minutes),
                          combinable_with_hall_id: r.combinable_with_hall_id || '',
                          lifecycle: r.lifecycle || 'ACTIVE',
                        });
                      }}
                      className="rounded border border-slate-300 p-1 text-sky-600 dark:border-slate-700"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteHall(r)} className="rounded border border-rose-500/30 p-1 text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* CATERING */}
      {section === 'CATERING' && (
        <div className="space-y-4">
          <form onSubmit={saveCatering} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-5">
            <input required value={catForm.name_ar} onChange={(e) => setCatForm({ ...catForm, name_ar: e.target.value })} placeholder={tr('اسم الباقة بالعربية', 'Arabic Package Name')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input required value={catForm.name_en} onChange={(e) => setCatForm({ ...catForm, name_en: e.target.value })} placeholder="English Package Name" className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="0" step="0.01" required value={catForm.price_per_guest} onChange={(e) => setCatForm({ ...catForm, price_per_guest: e.target.value })} placeholder={tr('سعر الفرد', 'Price/Guest')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="0" step="0.01" value={catForm.cost_per_guest} onChange={(e) => setCatForm({ ...catForm, cost_per_guest: e.target.value })} placeholder={tr('التكلفة/الفرد', 'Cost/Guest')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950">
                <Plus className="h-3.5 w-3.5" />
                <span>{editingCatId ? tr('حفظ', 'Save') : tr('إضافة', 'Add')}</span>
              </button>
              {editingCatId && (
                <button type="button" onClick={() => setEditingCatId(null)} className="rounded-lg border border-slate-300 px-2.5 text-xs dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
              )}
            </div>
          </form>

          <ResponsiveDataList
            data={catering}
            locale={locale}
            mobileCardHeader={(r) => (isRtl ? r.name_ar : r.name_en)}
            columns={[
              { key: 'name', headerAr: 'الباقة', headerEn: 'Package', render: (r) => <div className="text-xs"><div className="font-bold">{r.name_ar}</div><div className="text-slate-500">{r.name_en}</div></div> },
              { key: 'price', headerAr: 'سعر الضيف', headerEn: 'Price / Guest', render: (r) => <span className="font-mono text-xs">{Number(r.price_per_guest).toLocaleString()}</span> },
              { key: 'cost', headerAr: 'التكلفة', headerEn: 'Cost / Guest', render: (r) => <span className="font-mono text-xs">{Number(r.cost_per_guest).toLocaleString()}</span> },
              {
                key: 'life',
                headerAr: 'الحالة',
                headerEn: 'Lifecycle',
                render: (r) => (
                  <select
                    value={r.lifecycle}
                    onChange={async (e) => {
                      await apiFetch(`/api/v1/venue/catering/${r.id}`, { method: 'PATCH', body: { lifecycle: e.target.value } });
                      await notifySync(tr('تم تحديث حالة الضيافة.', 'Catering lifecycle updated.'));
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                ),
              },
              {
                key: 'act',
                headerAr: 'إجراءات',
                headerEn: 'Actions',
                render: (r) => (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(r.id);
                        setCatForm({
                          name_ar: r.name_ar,
                          name_en: r.name_en,
                          price_per_guest: String(r.price_per_guest),
                          cost_per_guest: String(r.cost_per_guest),
                          lifecycle: r.lifecycle,
                        });
                      }}
                      className="rounded border border-slate-300 p-1 text-sky-600 dark:border-slate-700"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(null);
                        setCatForm({
                          name_ar: `${r.name_ar} (نسخة)`,
                          name_en: `${r.name_en} (Copy)`,
                          price_per_guest: String(r.price_per_guest),
                          cost_per_guest: String(r.cost_per_guest),
                          lifecycle: 'DRAFT',
                        });
                      }}
                      className="rounded border border-slate-300 p-1 text-amber-600 dark:border-slate-700"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteCatering(r.id)} className="rounded border border-rose-500/30 p-1 text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* INVENTORY */}
      {section === 'INVENTORY' && (
        <div className="space-y-4">
          {invCategoryBars.length > 0 && (
            <div className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-2">
              {invCategoryBars.map(([cat, count]) => (
                <div key={cat}>
                  <div className="mb-0.5 flex justify-between text-[11px]">
                    <span className="font-mono font-semibold">{cat}</span>
                    <span>{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-[var(--brand-primary,#D4AF37)]" style={{ width: `${Math.round((count / maxBar) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={saveInventory} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-5">
            <input required value={invForm.name} onChange={(e) => setInvForm({ ...invForm, name: e.target.value })} placeholder={tr('اسم الصنف / الإضافة', 'Add-on / Equipment Name')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
            <LookupSelect
              category="INVENTORY_CATEGORY"
              value={invForm.category}
              onChange={(v) => setInvForm({ ...invForm, category: v })}
              locale={locale}
              allowOther
              allowPromote
              required
              fallbackOptions={[
                { value: 'AUDIO_VISUAL', labelAr: 'صوتيات ومرئيات', labelEn: 'Audio / Visual' },
                { value: 'DECOR', labelAr: 'ديكور وكوشة', labelEn: 'Decor & Stage' },
                { value: 'FURNITURE', labelAr: 'أثاث وطاولات', labelEn: 'Furniture' },
              ]}
              className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input type="number" min="0" required value={invForm.total_stock} onChange={(e) => setInvForm({ ...invForm, total_stock: e.target.value })} placeholder={tr('الكمية المتاحة', 'Stock')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <input type="number" min="0" step="0.01" required value={invForm.unit_addon_price} onChange={(e) => setInvForm({ ...invForm, unit_addon_price: e.target.value })} placeholder={tr('سعر الإضافة', 'Unit Price')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950">
                <Plus className="h-3.5 w-3.5" />
                <span>{editingInvId ? tr('حفظ', 'Save') : tr('إضافة', 'Add')}</span>
              </button>
              {editingInvId && (
                <button type="button" onClick={() => setEditingInvId(null)} className="rounded-lg border border-slate-300 px-2.5 text-xs dark:border-slate-700">
                  {tr('إلغاء', 'Cancel')}
                </button>
              )}
            </div>
          </form>

          <ResponsiveDataList
            data={inventory}
            locale={locale}
            mobileCardHeader={(r) => r.name}
            columns={[
              { key: 'name', headerAr: 'الصنف', headerEn: 'Item', render: (r) => <span className="font-semibold text-xs">{r.name}</span> },
              { key: 'cat', headerAr: 'الفئة', headerEn: 'Category', render: (r) => <span className="font-mono text-xs">{r.category}</span> },
              { key: 'stock', headerAr: 'المخزون', headerEn: 'Stock', render: (r) => <span className="font-mono text-xs">{r.total_stock}</span> },
              { key: 'alloc', headerAr: 'مخصص', headerEn: 'Allocated', render: (r) => <span className="font-mono text-xs">{r.allocated_count ?? 0}</span> },
              { key: 'price', headerAr: 'سعر الإضافة', headerEn: 'Addon Price', render: (r) => <span className="font-mono text-xs">{Number(r.unit_addon_price).toLocaleString()}</span> },
              {
                key: 'life',
                headerAr: 'الحالة',
                headerEn: 'Lifecycle',
                render: (r) => (
                  <select
                    value={r.lifecycle}
                    onChange={async (e) => {
                      await apiFetch(`/api/v1/venue/inventory/${r.id}`, { method: 'PATCH', body: { lifecycle: e.target.value } });
                      await notifySync(tr('تم تحديث حالة الصنف.', 'Inventory lifecycle updated.'));
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                ),
              },
              {
                key: 'act',
                headerAr: 'إجراءات',
                headerEn: 'Actions',
                render: (r) => (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingInvId(r.id);
                        setInvForm({
                          name: r.name,
                          category: r.category,
                          total_stock: String(r.total_stock),
                          unit_addon_price: String(r.unit_addon_price),
                          lifecycle: r.lifecycle,
                        });
                      }}
                      className="rounded border border-slate-300 p-1 text-sky-600 dark:border-slate-700"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteInventory(r)} className="rounded border border-rose-500/30 p-1 text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* PRICING RULES */}
      {section === 'PRICING_RULES' && (
        <div className="space-y-4">
          <form onSubmit={saveRule} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="grid gap-3 md:grid-cols-5">
              <input required value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder={tr('اسم القاعدة (مثلاً ذروة الخميس)', 'Rule name (e.g. Weekend Peak)')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
              <select value={ruleForm.hall_id} onChange={(e) => setRuleForm({ ...ruleForm, hall_id: e.target.value })} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                <option value="">{tr('جميع القاعات', 'All Halls')}</option>
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {isRtl ? h.name_ar : h.name}
                  </option>
                ))}
              </select>
              <input type="number" step="0.01" min="0.1" max="5" required value={ruleForm.multiplier} onChange={(e) => setRuleForm({ ...ruleForm, multiplier: e.target.value })} placeholder={tr('المعامل (1.25)', 'Multiplier (1.25)')} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
              <input type="date" value={ruleForm.start_date} onChange={(e) => setRuleForm({ ...ruleForm, start_date: e.target.value })} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950" />
              <div className="flex gap-2">
                <input type="date" value={ruleForm.end_date} onChange={(e) => setRuleForm({ ...ruleForm, end_date: e.target.value })} className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950" />
                <button type="submit" disabled={busy} className="min-h-[40px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950">
                  {editingRuleId ? tr('حفظ', 'Save') : tr('إضافة', 'Add')}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">{tr('أيام الأسبوع:', 'Days:')}</span>
              {DAY_LABELS.map((d) => {
                const selected = ruleForm.days_of_week.includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    onClick={() =>
                      setRuleForm((prev) => ({
                        ...prev,
                        days_of_week: selected
                          ? prev.days_of_week.filter((x) => x !== d.day)
                          : [...prev.days_of_week, d.day].sort(),
                      }))
                    }
                    className={`rounded-lg px-2 py-1 font-semibold ${
                      selected
                        ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950'
                        : 'border border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {tr(d.ar, d.en)}
                  </button>
                );
              })}
            </div>
          </form>

          <ResponsiveDataList
            data={rules}
            locale={locale}
            mobileCardHeader={(r) => `${r.name} (×${r.multiplier})`}
            columns={[
              { key: 'name', headerAr: 'القاعدة', headerEn: 'Rule', render: (r) => <span className="font-semibold text-xs">{r.name}</span> },
              { key: 'mult', headerAr: 'المعامل', headerEn: 'Multiplier', render: (r) => <span className="font-mono text-xs">×{Number(r.multiplier).toFixed(2)}</span> },
              { key: 'days', headerAr: 'الأيام', headerEn: 'Days', render: (r) => <span className="text-xs">{(r.days_of_week || []).map((d) => DAY_LABELS.find((x) => x.day === d)?.[isRtl ? 'ar' : 'en'] || d).join(', ') || tr('كل الأيام', 'All')}</span> },
              {
                key: 'active',
                headerAr: 'مفعلة',
                headerEn: 'Active',
                render: (r) => (
                  <button
                    type="button"
                    onClick={() => toggleRuleActive(r)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      r.is_active ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'
                    }`}
                  >
                    {r.is_active ? tr('مفعلة', 'Active') : tr('معطلة', 'Paused')}
                  </button>
                ),
              },
              {
                key: 'act',
                headerAr: 'إجراءات',
                headerEn: 'Actions',
                render: (r) => (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRuleId(r.id);
                        setRuleForm({
                          name: r.name,
                          hall_id: r.hall_id || '',
                          days_of_week: r.days_of_week || [],
                          start_date: r.start_date || '',
                          end_date: r.end_date || '',
                          multiplier: String(r.multiplier),
                          is_active: r.is_active,
                        });
                      }}
                      className="rounded border border-slate-300 p-1 text-sky-600 dark:border-slate-700"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteRule(r.id)} className="rounded border border-rose-500/30 p-1 text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
    </SpotlightCard>
  );
}
