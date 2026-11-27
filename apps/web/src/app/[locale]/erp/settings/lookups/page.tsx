'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Edit3,
  Info,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { apiFetch, getAccessToken, tenantPath } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { BackButton } from '@/components/ui/BackButton';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { ResponsiveDataList } from '@/components/ui/ResponsiveDataList';
import { useAuthSession } from '@/components/providers/auth-provider';
import type { RecordLifecycle, SystemLookupItem } from '@/lib/types';

const LOOKUP_CATEGORIES: { value: string; labelAr: string; labelEn: string; guideAr: string; guideEn: string }[] = [
  {
    value: 'EVENT_TYPE',
    labelAr: 'أنواع الفعاليات',
    labelEn: 'Event Types',
    guideAr: 'تظهر في محرك الحجز (الخطوة 1) وتقارير الإيرادات والتشغيل.',
    guideEn: 'Shown in Booking Engine Step 1, scheduling filters, and revenue analytics.',
  },
  {
    value: 'INVENTORY_CATEGORY',
    labelAr: 'فئات المخزون والإضافات',
    labelEn: 'Inventory Categories',
    guideAr: 'تصنف معدات الصوت والإضاءة والأثاث والديكور في كتالوج القاعات.',
    guideEn: 'Categorizes AV, furniture, lighting, and decor items inside the venue catalog.',
  },
  {
    value: 'EXPENSE_CATEGORY',
    labelAr: 'فئات المصروفات',
    labelEn: 'Expense Categories',
    guideAr: 'تستخدم في صفحة الأرباح والخسائر (P&L) وترحيل قيود الأستاذ العام.',
    guideEn: 'Used in Event P&L expense forms and General Ledger journal postings.',
  },
  {
    value: 'PAYMENT_METHOD',
    labelAr: 'طرق الدفع',
    labelEn: 'Payment Methods',
    guideAr: 'تستخدم في فواتير الدفعات ومراجعة إيصالات السداد المالية.',
    guideEn: 'Used across milestone payments, receipt uploads, and financial reconciliation.',
  },
  {
    value: 'REFUND_METHOD',
    labelAr: 'طرق الاسترداد',
    labelEn: 'Refund Methods',
    guideAr: 'تحدد قناة رد مبلغ التأمين المسترد للعميل بعد فحص القاعة.',
    guideEn: 'Defines payout channels when refunding client security deposits (Account 2100).',
  },
  {
    value: 'GATE_PASS_TYPE',
    labelAr: 'أنواع تصاريح البوابة',
    labelEn: 'Gate Pass Types',
    guideAr: 'تضبط تصنيفات تصاريح QR للضيوف وكبار الشخصيات والموردين.',
    guideEn: 'Controls QR gate pass classifications for VIPs, families, and external vendors.',
  },
  {
    value: 'DEPARTMENT',
    labelAr: 'الأقسام التشغيلية',
    labelEn: 'Departments',
    guideAr: 'تربط الموظفين والأدوار والتنبيهات التشغيلية داخل المنشأة.',
    guideEn: 'Organizes staff rosters, approval routing, and operational checklists.',
  },
];

const LIFECYCLE_BADGE: Record<RecordLifecycle, string> = {
  ACTIVE: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  DRAFT: 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300',
  ARCHIVED: 'border-slate-500/40 bg-slate-500/15 text-slate-600 dark:text-slate-300',
  DELETED: 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300',
};

export default function SystemLookupsPage() {
  const params = useParams<{ locale: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);
  const { tenantSlug } = useAuthSession();

  const [items, setItems] = useState<SystemLookupItem[]>([]);
  const [filterCat, setFilterCat] = useState<string>('ALL');
  const [filterLife, setFilterLife] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  // Create / edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState('EVENT_TYPE');
  const [code, setCode] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [sortOrder, setSortOrder] = useState(1);
  const [lifecycle, setLifecycle] = useState<RecordLifecycle>('ACTIVE');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!getAccessToken()) return;
    try {
      const data = await apiFetch<SystemLookupItem[]>('/api/v1/lookups?include_inactive=true');
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر تحميل القوائم المرجعية', 'Failed to load lookups'));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setCode('');
    setLabelAr('');
    setLabelEn('');
    setSortOrder(items.length + 1);
    setLifecycle('ACTIVE');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category.trim() || !code.trim() || !labelAr.trim() || !labelEn.trim()) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      if (editingId) {
        await apiFetch(`/api/v1/lookups/${editingId}`, {
          method: 'PATCH',
          body: {
            category: category.trim().toUpperCase(),
            code: code.trim().toUpperCase(),
            label_ar: labelAr.trim(),
            label_en: labelEn.trim(),
            sort_order: Number(sortOrder) || 0,
            lifecycle,
          },
        });
        setNotice(tr('تم تحديث العنصر المرجعي بنجاح.', 'Lookup entry updated.'));
      } else {
        await apiFetch('/api/v1/lookups', {
          method: 'POST',
          body: {
            category: category.trim().toUpperCase(),
            code: code.trim().toUpperCase(),
            label_ar: labelAr.trim(),
            label_en: labelEn.trim(),
            sort_order: Number(sortOrder) || items.length + 1,
            lifecycle,
          },
        });
        setNotice(tr('تمت إضافة العنصر إلى القائمة المرجعية.', 'Lookup entry created.'));
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل حفظ العنصر', 'Failed to save lookup'));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (row: SystemLookupItem) => {
    setEditingId(row.id);
    setCategory(row.category);
    setCode(row.code);
    setLabelAr(row.label_ar);
    setLabelEn(row.label_en);
    setSortOrder(row.sort_order);
    setLifecycle(row.lifecycle);
    setNotice(null);
  };

  const duplicateItem = (row: SystemLookupItem) => {
    setEditingId(null);
    setCategory(row.category);
    setCode(`${row.code}_COPY`);
    setLabelAr(`${row.label_ar} (نسخة)`);
    setLabelEn(`${row.label_en} (Copy)`);
    setSortOrder((row.sort_order || 0) + 1);
    setLifecycle('DRAFT');
    setNotice(tr('تم تجهيز نسخة للتعديل والحفظ كعنصر جديد.', 'Prepared a duplicate draft—adjust code & save.'));
  };

  const updateLifecycle = async (id: string, nextLifecycle: RecordLifecycle) => {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/lookups/${id}`, { method: 'PATCH', body: { lifecycle: nextLifecycle } });
      setNotice(tr('تم تحديث حالة السجل.', 'Lifecycle updated.'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر تحديث الحالة', 'Lifecycle update failed'));
    } finally {
      setBusy(false);
    }
  };

  const moveOrder = async (row: SystemLookupItem, delta: number) => {
    try {
      await apiFetch(`/api/v1/lookups/${row.id}`, {
        method: 'PATCH',
        body: { sort_order: Math.max(0, (row.sort_order || 0) + delta) },
      });
      await load();
    } catch {
      // ignore
    }
  };

  const safeDelete = async (row: SystemLookupItem) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await apiFetch<{ status: string; usage_count: number }>(`/api/v1/lookups/${row.id}`, {
        method: 'DELETE',
      });
      if (res.status === 'ARCHIVED_IN_USE') {
        setNotice(
          tr(
            `العنصر مستخدم في (${res.usage_count}) سجل — تم تحويله إلى مؤرشف للحفاظ على سلامة البيانات.`,
            `In use by ${res.usage_count} record(s) — archived safely instead of hard deletion.`
          )
        );
      } else {
        setNotice(tr('تم حذف العنصر غير المستخدم نهائياً.', 'Unused lookup entry permanently deleted.'));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذر حذف العنصر', 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  const seedDefaults = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await apiFetch<{ added?: { lookups?: number; catering?: number; inventory?: number } }>(
        '/api/v1/venue/catalog/seed-defaults',
        { method: 'POST' }
      );
      setNotice(
        tr(
          `تم استكمال القوائم الافتراضية (${res.added?.lookups ?? 0} عنصر مضاف).`,
          `Starter defaults applied (+${res.added?.lookups ?? 0} lookups).`
        )
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('فشل تهيئة القوائم الافتراضية', 'Failed to seed defaults'));
    } finally {
      setBusy(false);
    }
  };

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, { active: number; total: number }>();
    for (const item of items) {
      const cur = counts.get(item.category) || { active: 0, total: 0 };
      cur.total += 1;
      if (item.lifecycle === 'ACTIVE') cur.active += 1;
      counts.set(item.category, cur);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [items]);

  const maxCatTotal = useMemo(
    () => Math.max(1, ...categoryCounts.map(([, v]) => v.total)),
    [categoryCounts]
  );

  const extraCategories = useMemo(() => {
    const known = new Set(LOOKUP_CATEGORIES.map((c) => c.value));
    return Array.from(new Set(items.map((i) => i.category)))
      .filter((c) => !known.has(c))
      .map((c) => ({ value: c, labelAr: c, labelEn: c }));
  }, [items]);

  const categoryOptions = useMemo(
    () => [
      ...LOOKUP_CATEGORIES.map((c) => ({ value: c.value, labelAr: `${c.labelAr} (${c.value})`, labelEn: `${c.labelEn} (${c.value})` })),
      ...extraCategories,
    ],
    [extraCategories]
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filterCat !== 'ALL' && item.category !== filterCat) return false;
      if (filterLife !== 'ALL' && item.lifecycle !== filterLife) return false;
      if (!q) return true;
      return (
        item.category.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.label_ar.toLowerCase().includes(q) ||
        item.label_en.toLowerCase().includes(q)
      );
    });
  }, [items, filterCat, filterLife, search]);

  const selectedGuide = LOOKUP_CATEGORIES.find((c) => c.value === (filterCat !== 'ALL' ? filterCat : category));

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950 md:pb-12">
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 text-start">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton locale={locale} fallbackHref={tenantPath(locale, tenantSlug, '/erp/dashboard')} />
            <div>
              <SpotlightHeading as="h1" className="text-2xl">
                {tr('لوحة التحكم بالقوائم المرجعية (SystemLookups)', 'Actionable SystemLookups Control Plane')}
              </SpotlightHeading>
              <p className="text-xs text-slate-500">
                {tr(
                  'إدارة القيم المرجعية ودورة الحياة (مسودة / نشط / مؤرشف / حذف آمن مع التحقق من التبعيات) أو إضافة فئات مخصصة ("أخرى").',
                  'Manage standardized dropdown options, lifecycles (DRAFT / ACTIVE / ARCHIVED), dependency-safe deletion, and custom categories.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={seedDefaults}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{tr('استكمال القيم الافتراضية', 'Seed Default Lookups')}</span>
          </button>
        </div>

        {notice && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Process Explanation & Category Distribution Bar Chart */}
        <div className="grid gap-4 lg:grid-cols-2">
          <SpotlightCard className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Info className="h-4 w-4 text-[var(--brand-primary,#D4AF37)]" />
              <span>{tr('دليل تدفق القوائم ودورة الحياة', 'Lookup Lifecycle & Process Guide')}</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {selectedGuide
                ? `${tr(selectedGuide.labelAr, selectedGuide.labelEn)}: ${tr(selectedGuide.guideAr, selectedGuide.guideEn)}`
                : tr(
                  'القيم النشطة (ACTIVE) تظهر في جميع نماذج الحجز والفواتير والضيوف، بينما تحفظ القيم المؤرشفة (ARCHIVED) السجلات التاريخية دون السماح باختيارها في فعاليات جديدة.',
                  'ACTIVE items appear across Booking, P&L, and Portal forms. ARCHIVED preserves historical references while hiding options from new bookings.'
                )}
            </p>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                ACTIVE = {tr('متاح للاختيار', 'Live in forms')}
              </span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                DRAFT = {tr('قيد المراجعة الداخلية', 'Internal draft')}
              </span>
              <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2.5 py-0.5 font-semibold text-slate-600 dark:text-slate-300">
                ARCHIVED = {tr('محفوظ للبيانات السابقة', 'Preserved / hidden')}
              </span>
            </div>
          </SpotlightCard>

          <SpotlightCard className="space-y-3">
            <div className="text-sm font-bold">
              {tr('توزيع العناصر حسب الفئة (اضغط للتصفية)', 'Category Distribution (Click to Filter)')}
            </div>
            <div className="space-y-2">
              {categoryCounts.slice(0, 6).map(([cat, stats]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilterCat((prev) => (prev === cat ? 'ALL' : cat))}
                  className="block w-full text-start"
                >
                  <div className="mb-0.5 flex items-center justify-between text-[11px]">
                    <span className="font-mono font-semibold">{cat}</span>
                    <span className="text-slate-500">
                      {stats.active}/{stats.total} {tr('نشط', 'active')}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-[var(--brand-primary,#D4AF37)] transition-all"
                      style={{ width: `${Math.max(8, Math.round((stats.total / maxCatTotal) * 100))}%` }}
                    />
                  </div>
                </button>
              ))}
              {categoryCounts.length === 0 && (
                <p className="text-xs text-slate-500">{tr('لا توجد عناصر بعد.', 'No lookups yet.')}</p>
              )}
            </div>
          </SpotlightCard>
        </div>

        {/* Create / Edit Form */}
        <SpotlightCard className="space-y-3">
          <div className="flex items-center justify-between">
            <SpotlightHeading as="h2" className="text-base">
              {editingId
                ? tr('تعديل عنصر مرجعي', 'Edit Lookup Entry')
                : tr('إضافة عنصر جديد (يدعم فئة "أخرى" المخصصة)', 'Create Lookup Entry (Supports Custom "Other" Category)')}
            </SpotlightHeading>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-slate-500 underline"
              >
                {tr('إلغاء التعديل', 'Cancel Edit')}
              </button>
            )}
          </div>
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <SelectOrOther
                options={categoryOptions}
                value={category}
                onChange={(val) => setCategory(val.toUpperCase())}
                locale={locale}
                placeholderAr="اختر الفئة..."
                placeholderEn="Select category..."
                otherPlaceholderAr="أدخل اسم فئة جديدة بالإنجليزية..."
                otherPlaceholderEn="Enter custom category code..."
                required
              />
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              placeholder="CODE (e.g. GALA)"
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              value={labelAr}
              onChange={(e) => setLabelAr(e.target.value)}
              required
              placeholder={tr('التسمية بالعربية', 'Arabic Label')}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              value={labelEn}
              onChange={(e) => setLabelEn(e.target.value)}
              required
              placeholder="English Label"
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <div className="flex gap-2">
              <select
                value={lifecycle}
                onChange={(e) => setLifecycle(e.target.value as RecordLifecycle)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DRAFT">DRAFT</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3 text-xs font-bold text-slate-950"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{editingId ? tr('حفظ', 'Save') : tr('إضافة', 'Add')}</span>
              </button>
            </div>
          </form>
        </SpotlightCard>

        {/* Filter Bar */}
        <SpotlightCard className="grid gap-3 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('بحث بالرمز أو التسمية...', 'Search code or label...')}
              className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white ps-9 pe-3 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="ALL">{tr('كل الفئات', 'All Categories')}</option>
            {categoryOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value}
              </option>
            ))}
          </select>
          <select
            value={filterLife}
            onChange={(e) => setFilterLife(e.target.value)}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="ALL">{tr('كل الحالات', 'All Lifecycles')}</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </SpotlightCard>

        <ResponsiveDataList
          data={filteredItems}
          locale={locale}
          mobileCardHeader={(r) => `${r.category}: ${isRtl ? r.label_ar : r.label_en}`}
          columns={[
            {
              key: 'cat',
              headerAr: 'الفئة',
              headerEn: 'Category',
              render: (r) => <span className="font-mono text-xs font-semibold">{r.category}</span>,
            },
            {
              key: 'code',
              headerAr: 'الرمز',
              headerEn: 'Code',
              render: (r) => <span className="font-mono text-xs">{r.code}</span>,
            },
            {
              key: 'label',
              headerAr: 'التسمية (عربي / إنجليزي)',
              headerEn: 'Labels (AR / EN)',
              render: (r) => (
                <div className="text-xs">
                  <div className="font-semibold">{r.label_ar}</div>
                  <div className="text-slate-500">{r.label_en}</div>
                </div>
              ),
            },
            {
              key: 'usage',
              headerAr: 'الارتباطات',
              headerEn: 'Usage',
              render: (r) => (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-mono text-[11px] dark:bg-slate-800">
                  {r.usage_count ?? 0} {tr('سجل', 'refs')}
                </span>
              ),
            },
            {
              key: 'life',
              headerAr: 'دورة الحياة',
              headerEn: 'Lifecycle',
              render: (r) => (
                <select
                  value={r.lifecycle}
                  onChange={(e) => updateLifecycle(r.id, e.target.value as RecordLifecycle)}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${LIFECYCLE_BADGE[r.lifecycle] || ''}`}
                >
                  {['DRAFT', 'ACTIVE', 'ARCHIVED'].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              ),
            },
            {
              key: 'actions',
              headerAr: 'إجراءات',
              headerEn: 'Actions',
              render: (r) => (
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveOrder(r, -1)}
                    title={tr('تحريك لأعلى', 'Move up')}
                    className="rounded border border-slate-300 p-1 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:hover:text-white"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveOrder(r, 1)}
                    title={tr('تحريك لأسفل', 'Move down')}
                    className="rounded border border-slate-300 p-1 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:hover:text-white"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    title={tr('تعديل', 'Edit')}
                    className="rounded border border-slate-300 p-1 text-sky-600 hover:bg-sky-500/10 dark:border-slate-700 dark:text-sky-400"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateItem(r)}
                    title={tr('نسخ', 'Duplicate')}
                    className="rounded border border-slate-300 p-1 text-amber-600 hover:bg-amber-500/10 dark:border-slate-700 dark:text-amber-400"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => safeDelete(r)}
                    title={tr('حذف آمن / أرشفة', 'Safe Delete / Archive')}
                    className="rounded border border-rose-500/30 p-1 text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </main>
      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
