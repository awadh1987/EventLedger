'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Package, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import type { HallInfo } from '@/lib/bookings-store';

export interface InventoryItemRecord {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  totalStock: number;
  unitAddonPrice: number;
  isActive: boolean;
}

export interface CateringMenuRecord {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  pricePerGuest: number;
  costPerGuest: number;
  isActive: boolean;
}

interface CatalogControlPanelProps {
  locale: 'ar' | 'en';
  onCatalogChanged?: () => void;
}

export function CatalogControlPanel({ locale, onCatalogChanged }: CatalogControlPanelProps) {
  const isRtl = locale === 'ar';
  const { authFetch } = useAuth();
  const branding = useTenantBranding();

  const [section, setSection] = useState<'halls' | 'inventory' | 'catering'>('halls');
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [items, setItems] = useState<InventoryItemRecord[]>([]);
  const [menus, setMenus] = useState<CateringMenuRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Hall form
  const [hallForm, setHallForm] = useState({
    id: '',
    nameEn: '',
    nameAr: '',
    capacityBanquet: 300,
    capacityTheater: 450,
    basePrice: 1200000,
    cleaningBufferMinutes: 120,
  });

  // Inventory item form
  const [itemForm, setItemForm] = useState({
    id: '',
    nameEn: '',
    nameAr: '',
    category: 'FURNITURE',
    totalStock: 100,
    unitAddonPrice: 2500,
    isActive: true,
  });

  // Catering form
  const [menuForm, setMenuForm] = useState({
    id: '',
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    pricePerGuest: 6500,
    costPerGuest: 3800,
    isActive: true,
  });

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/v1/tenant/catalog', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Failed to load catalog');
      setHalls(Array.isArray(data?.halls) ? data.halls : []);
      setItems(Array.isArray(data?.inventoryItems) ? data.inventoryItems : []);
      setMenus(Array.isArray(data?.cateringMenus) ? data.cateringMenus : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load catalog');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const fmtMoney = (n: number) =>
    `${new Intl.NumberFormat(isRtl ? 'ar-YE' : 'en-US').format(n)} ${branding.currency}`;

  const saveHall = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'hall', ...hallForm, id: hallForm.id || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to save hall');
      setHallForm({
        id: '',
        nameEn: '',
        nameAr: '',
        capacityBanquet: 300,
        capacityTheater: 450,
        basePrice: 1200000,
        cleaningBufferMinutes: 120,
      });
      setNotice(isRtl ? 'تم حفظ بيانات القاعة بنجاح.' : 'Hall configuration saved.');
      await loadCatalog();
      onCatalogChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save hall');
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'inventory', ...itemForm, id: itemForm.id || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to save item');
      setItemForm({
        id: '',
        nameEn: '',
        nameAr: '',
        category: 'FURNITURE',
        totalStock: 100,
        unitAddonPrice: 2500,
        isActive: true,
      });
      setNotice(isRtl ? 'تم حفظ الصنف الإضافي بنجاح.' : 'Inventory add-on saved.');
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save item');
    } finally {
      setSaving(false);
    }
  };

  const toggleItemActive = async (item: InventoryItemRecord) => {
    try {
      const res = await authFetch('/api/v1/tenant/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'inventory', ...item, isActive: !item.isActive }),
      });
      if (res.ok) {
        await loadCatalog();
      }
    } catch {
      // ignore
    }
  };

  const deleteCatalogRow = async (kind: 'inventory' | 'catering', id: string) => {
    try {
      const res = await authFetch(
        `/api/v1/tenant/catalog?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        await loadCatalog();
      }
    } catch {
      // ignore
    }
  };

  const saveMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/v1/tenant/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'catering', ...menuForm, id: menuForm.id || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Unable to save catering menu');
      setMenuForm({
        id: '',
        nameEn: '',
        nameAr: '',
        descriptionEn: '',
        descriptionAr: '',
        pricePerGuest: 6500,
        costPerGuest: 3800,
        isActive: true,
      });
      setNotice(isRtl ? 'تم حفظ باقة الضيافة بنجاح.' : 'Catering package saved.');
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save catering menu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSection('halls')}
            className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-xs font-medium transition-colors ${
              section === 'halls'
                ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>{isRtl ? `القاعات (${halls.length})` : `Venue Halls (${halls.length})`}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('inventory')}
            className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-xs font-medium transition-colors ${
              section === 'inventory'
                ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            <span>{isRtl ? `الأصناف والإضافات (${items.length})` : `Inventory & Add-ons (${items.length})`}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('catering')}
            className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-xs font-medium transition-colors ${
              section === 'catering'
                ? 'bg-slate-900 text-white dark:bg-[var(--brand-primary,#D4AF37)] dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <UtensilsCrossed className="h-3.5 w-3.5" />
            <span>{isRtl ? `باقات البوفيه (${menus.length})` : `Catering Menus (${menus.length})`}</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">
          {isRtl
            ? 'أي تعديل هنا ينعكس فوراً في صفحة حجز الصالة العامة وحاسبة التسعير.'
            : 'Changes sync immediately to your public venue booking page and invoice calculator.'}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="me-2 h-4 w-4 animate-spin" />
          <span>{isRtl ? 'جاري تحميل عناصر الصالة...' : 'Loading venue catalog...'}</span>
        </div>
      ) : section === 'halls' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-3 text-start font-medium">{isRtl ? 'القاعة' : 'Hall'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'سعة الولائم' : 'Banquet'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'سعة المسرح' : 'Theater'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'فترة التجهيز' : 'Buffer'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'السعر الأساسي' : 'Base Rate'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'إجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {halls.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {isRtl ? h.nameAr : h.nameEn}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? h.nameEn : h.nameAr}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-end font-mono tabular-nums">{h.capacityBanquet}</td>
                    <td className="px-4 py-3.5 text-end font-mono tabular-nums">{h.capacityTheater}</td>
                    <td className="px-4 py-3.5 text-end font-mono tabular-nums">{h.cleaningBufferMinutes}m</td>
                    <td className="px-4 py-3.5 text-end font-mono font-semibold tabular-nums">
                      {fmtMoney(h.basePrice)}
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <button
                        type="button"
                        onClick={() => setHallForm({ ...h })}
                        className="font-medium text-amber-700 hover:underline dark:text-[var(--brand-primary,#D4AF37)]"
                      >
                        {isRtl ? 'تعديل' : 'Edit'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={saveHall}
            className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {hallForm.id
                  ? isRtl
                    ? 'تعديل بيانات القاعة'
                    : 'Edit Venue Hall'
                  : isRtl
                  ? 'إضافة قاعة جديدة'
                  : 'Add Venue Hall'}
              </h3>
              {hallForm.id && (
                <button
                  type="button"
                  onClick={() =>
                    setHallForm({
                      id: '',
                      nameEn: '',
                      nameAr: '',
                      capacityBanquet: 300,
                      capacityTheater: 450,
                      basePrice: 1200000,
                      cleaningBufferMinutes: 120,
                    })
                  }
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {isRtl ? 'جديد' : 'New'}
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'الاسم بالعربية' : 'Hall Name (Arabic)'}
              </label>
              <input
                required
                value={hallForm.nameAr}
                onChange={(e) => setHallForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="قاعة اللؤلؤة الملكية"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'الاسم بالإنجليزية' : 'Hall Name (English)'}
              </label>
              <input
                required
                value={hallForm.nameEn}
                onChange={(e) => setHallForm((f) => ({ ...f, nameEn: e.target.value }))}
                placeholder="Royal Pearl Ballroom"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'سعة الولائم' : 'Banquet Cap.'}
                </label>
                <input
                  type="number"
                  min={10}
                  value={hallForm.capacityBanquet}
                  onChange={(e) => setHallForm((f) => ({ ...f, capacityBanquet: Number(e.target.value) }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'سعة المسرح' : 'Theater Cap.'}
                </label>
                <input
                  type="number"
                  min={10}
                  value={hallForm.capacityTheater}
                  onChange={(e) => setHallForm((f) => ({ ...f, capacityTheater: Number(e.target.value) }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? `السعر (${branding.currency})` : `Base Price (${branding.currency})`}
                </label>
                <input
                  type="number"
                  min={0}
                  value={hallForm.basePrice}
                  onChange={(e) => setHallForm((f) => ({ ...f, basePrice: Number(e.target.value) }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'التجهيز (دقيقة)' : 'Buffer (mins)'}
                </label>
                <input
                  type="number"
                  min={30}
                  value={hallForm.cleaningBufferMinutes}
                  onChange={(e) =>
                    setHallForm((f) => ({ ...f, cleaningBufferMinutes: Number(e.target.value) }))
                  }
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>{hallForm.id ? (isRtl ? 'تحديث القاعة' : 'Update Hall') : isRtl ? 'حفظ القاعة' : 'Save Hall'}</span>
            </button>
          </form>
        </div>
      ) : section === 'inventory' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-3 text-start font-medium">{isRtl ? 'الصنف / التجهيز' : 'Item / Equipment'}</th>
                  <th className="px-4 py-3 text-start font-medium">{isRtl ? 'التصنيف' : 'Category'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'المخزون' : 'Stock'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'سعر الإضافة' : 'Unit Add-on'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {isRtl ? item.nameAr : item.nameEn}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? item.nameEn : item.nameAr}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {item.category}
                    </td>
                    <td className="px-4 py-3.5 text-end font-mono tabular-nums">{item.totalStock}</td>
                    <td className="px-4 py-3.5 text-end font-mono font-semibold tabular-nums">
                      {fmtMoney(item.unitAddonPrice)}
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <button
                        type="button"
                        onClick={() => toggleItemActive(item)}
                        className={`text-xs font-medium ${
                          item.isActive
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400 line-through'
                        }`}
                      >
                        {item.isActive ? (isRtl ? 'مفعّل' : 'Active') : isRtl ? 'مخفي' : 'Hidden'}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setItemForm({ ...item })}
                          className="font-medium text-amber-700 hover:underline dark:text-[var(--brand-primary,#D4AF37)]"
                        >
                          {isRtl ? 'تعديل' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCatalogRow('inventory', item.id)}
                          aria-label="Delete item"
                          className="text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={saveItem}
            className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {itemForm.id
                  ? isRtl
                    ? 'تعديل صنف مخزون'
                    : 'Edit Add-on Item'
                  : isRtl
                  ? 'إضافة صنف وتجهيز جديد'
                  : 'Add Inventory Item'}
              </h3>
              {itemForm.id && (
                <button
                  type="button"
                  onClick={() =>
                    setItemForm({
                      id: '',
                      nameEn: '',
                      nameAr: '',
                      category: 'FURNITURE',
                      totalStock: 100,
                      unitAddonPrice: 2500,
                      isActive: true,
                    })
                  }
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {isRtl ? 'جديد' : 'New'}
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'اسم الصنف (عربي)' : 'Item Name (Arabic)'}
              </label>
              <input
                required
                value={itemForm.nameAr}
                onChange={(e) => setItemForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="طقم إضاءة مسرح ليزر ملكي"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'اسم الصنف (إنجليزي)' : 'Item Name (English)'}
              </label>
              <input
                required
                value={itemForm.nameEn}
                onChange={(e) => setItemForm((f) => ({ ...f, nameEn: e.target.value }))}
                placeholder="Royal Stage Lighting Rig"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'التصنيف' : 'Category'}
              </label>
              <select
                value={itemForm.category}
                onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                <option value="FURNITURE">FURNITURE</option>
                <option value="AV_LIGHTING">AV_LIGHTING</option>
                <option value="DECOR">DECOR</option>
                <option value="CONFERENCE">CONFERENCE</option>
                <option value="HOSPITALITY">HOSPITALITY</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'الكمية المتاحة' : 'Total Stock'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={itemForm.totalStock}
                  onChange={(e) => setItemForm((f) => ({ ...f, totalStock: Number(e.target.value) }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? `سعر الوحدة (${branding.currency})` : `Unit Price (${branding.currency})`}
                </label>
                <input
                  type="number"
                  min={0}
                  value={itemForm.unitAddonPrice}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, unitAddonPrice: Number(e.target.value) }))
                  }
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>{itemForm.id ? (isRtl ? 'تحديث الصنف' : 'Update Item') : isRtl ? 'إضافة الصنف' : 'Add Item'}</span>
            </button>
          </form>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-3 text-start font-medium">{isRtl ? 'باقة البوفيه والضيافة' : 'Catering Package'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'السعر / ضيف' : 'Price / Guest'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'التكلفة / ضيف' : 'COGS / Guest'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'هامش الربح' : 'Margin'}</th>
                  <th className="px-4 py-3 text-end font-medium">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {menus.map((m) => {
                  const margin =
                    m.pricePerGuest > 0
                      ? Math.round(((m.pricePerGuest - m.costPerGuest) / m.pricePerGuest) * 100)
                      : 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {isRtl ? m.nameAr : m.nameEn}
                        </div>
                        <div className="mt-0.5 max-w-md text-[11px] text-slate-500 dark:text-slate-400">
                          {isRtl ? m.descriptionAr : m.descriptionEn}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-end font-mono font-semibold tabular-nums">
                        {fmtMoney(m.pricePerGuest)}
                      </td>
                      <td className="px-4 py-3.5 text-end font-mono tabular-nums text-slate-500">
                        {fmtMoney(m.costPerGuest)}
                      </td>
                      <td className="px-4 py-3.5 text-end font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {margin}%
                      </td>
                      <td className="px-4 py-3.5 text-end">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setMenuForm({ ...m })}
                            className="font-medium text-amber-700 hover:underline dark:text-[var(--brand-primary,#D4AF37)]"
                          >
                            {isRtl ? 'تعديل' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCatalogRow('catering', m.id)}
                            aria-label="Delete menu"
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={saveMenu}
            className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {menuForm.id
                  ? isRtl
                    ? 'تعديل باقة ضيافة'
                    : 'Edit Catering Package'
                  : isRtl
                  ? 'إضافة باقة ضيافة جديدة'
                  : 'Add Catering Package'}
              </h3>
              {menuForm.id && (
                <button
                  type="button"
                  onClick={() =>
                    setMenuForm({
                      id: '',
                      nameEn: '',
                      nameAr: '',
                      descriptionEn: '',
                      descriptionAr: '',
                      pricePerGuest: 6500,
                      costPerGuest: 3800,
                      isActive: true,
                    })
                  }
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {isRtl ? 'جديد' : 'New'}
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'اسم الباقة (عربي)' : 'Package Name (Arabic)'}
              </label>
              <input
                required
                value={menuForm.nameAr}
                onChange={(e) => setMenuForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="بوفيه الوليمة الشرقية"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'اسم الباقة (إنجليزي)' : 'Package Name (English)'}
              </label>
              <input
                required
                value={menuForm.nameEn}
                onChange={(e) => setMenuForm((f) => ({ ...f, nameEn: e.target.value }))}
                placeholder="Oriental Royal Buffet"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'السعر / ضيف' : 'Price / Guest'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={menuForm.pricePerGuest}
                  onChange={(e) => setMenuForm((f) => ({ ...f, pricePerGuest: Number(e.target.value) }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'التكلفة / ضيف' : 'Cost / Guest'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={menuForm.costPerGuest}
                  onChange={(e) => setMenuForm((f) => ({ ...f, costPerGuest: Number(e.target.value) }))}
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'وصف الباقة (عربي)' : 'Description (Arabic)'}
              </label>
              <textarea
                rows={2}
                value={menuForm.descriptionAr}
                onChange={(e) => setMenuForm((f) => ({ ...f, descriptionAr: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                {isRtl ? 'وصف الباقة (إنجليزي)' : 'Description (English)'}
              </label>
              <textarea
                rows={2}
                value={menuForm.descriptionEn}
                onChange={(e) => setMenuForm((f) => ({ ...f, descriptionEn: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>{menuForm.id ? (isRtl ? 'تحديث الباقة' : 'Update Package') : isRtl ? 'حفظ الباقة' : 'Save Package'}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
