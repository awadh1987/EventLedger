'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Minus, Plus, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export type FloorItemType = 'STAGE_KOSHA' | 'VIP_TABLE' | 'GUEST_TABLE' | 'BUFFET_STATION' | 'AV_BOOTH';

export interface FloorItem {
  id: string;
  type: FloorItemType;
  label: string;
  x: number;
  y: number;
  seats: number;
}

interface FloorPlanCanvasProps {
  eventId: string;
  hallCapacity: number;
  includedTablesQuota: number;
  extraTableUnitPrice: number;
  currency: string;
  locale: 'ar' | 'en';
  isLocked: boolean;
  initialItems?: FloorItem[];
  onSaveDraft: (payload: { items: FloorItem[]; totalSeatedGuests: number }, financialDelta: number) => Promise<void>;
  onSubmitApproval: () => Promise<void>;
}

const ITEM_STYLES: Record<FloorItemType, { color: string; seats: number; ar: string; en: string; isRound: boolean }> = {
  STAGE_KOSHA: { color: '#D4AF37', seats: 2, ar: 'الكوشة / المنصة', en: 'Stage / Kosha', isRound: false },
  VIP_TABLE: { color: '#9333EA', seats: 10, ar: 'طاولة VIP', en: 'VIP Table', isRound: true },
  GUEST_TABLE: { color: '#0284C7', seats: 10, ar: 'طاولة ضيوف', en: 'Guest Table', isRound: true },
  BUFFET_STATION: { color: '#16A34A', seats: 0, ar: 'منصة البوفيه', en: 'Buffet Station', isRound: false },
  AV_BOOTH: { color: '#475569', seats: 0, ar: 'الصوت والإضاءة', en: 'AV / DJ Booth', isRound: false },
};

const DEFAULT_ITEMS: FloorItem[] = [
  { id: 'STAGE_KOSHA-1', type: 'STAGE_KOSHA', label: 'Stage / Kosha #1', x: 340, y: 40, seats: 2 },
  { id: 'VIP_TABLE-1', type: 'VIP_TABLE', label: 'VIP Table #1', x: 240, y: 170, seats: 10 },
  { id: 'VIP_TABLE-2', type: 'VIP_TABLE', label: 'VIP Table #2', x: 400, y: 170, seats: 10 },
  { id: 'VIP_TABLE-3', type: 'VIP_TABLE', label: 'VIP Table #3', x: 560, y: 170, seats: 10 },
  { id: 'GUEST_TABLE-1', type: 'GUEST_TABLE', label: 'Guest Table #1', x: 180, y: 290, seats: 10 },
  { id: 'GUEST_TABLE-2', type: 'GUEST_TABLE', label: 'Guest Table #2', x: 330, y: 290, seats: 10 },
  { id: 'GUEST_TABLE-3', type: 'GUEST_TABLE', label: 'Guest Table #3', x: 480, y: 290, seats: 10 },
  { id: 'GUEST_TABLE-4', type: 'GUEST_TABLE', label: 'Guest Table #4', x: 630, y: 290, seats: 10 },
  { id: 'BUFFET_STATION-1', type: 'BUFFET_STATION', label: 'Buffet Station #1', x: 80, y: 390, seats: 0 },
  { id: 'AV_BOOTH-1', type: 'AV_BOOTH', label: 'AV / DJ Booth #1', x: 640, y: 390, seats: 0 },
];

export function FloorPlanCanvas({
  hallCapacity,
  includedTablesQuota,
  extraTableUnitPrice,
  currency,
  locale,
  isLocked,
  initialItems,
  onSaveDraft,
  onSubmitApproval,
}: FloorPlanCanvasProps) {
  const isRtl = locale === 'ar';
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(860);
  const [stageHeight, setStageHeight] = useState(460);
  const [zoom, setZoom] = useState(1);
  const [items, setItems] = useState<FloorItem[]>(() =>
    initialItems && initialItems.length > 0 ? initialItems : DEFAULT_ITEMS
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [pinchStartDist, setPinchStartDist] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateDims = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth || 860;
      setStageWidth(Math.max(320, w));
      setStageHeight(Math.min(480, Math.max(360, Math.round(window.innerHeight * 0.55))));
    };
    updateDims();
    const ro = new ResizeObserver(updateDims);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId]
  );

  const metrics = useMemo(() => {
    const totalSeatedGuests = items.reduce((acc, item) => acc + item.seats, 0);
    const tableCount = items.filter((i) => i.type === 'VIP_TABLE' || i.type === 'GUEST_TABLE').length;
    const extraTables = Math.max(0, tableCount - includedTablesQuota);
    const financialDelta = extraTables * extraTableUnitPrice;
    const overCapacity = totalSeatedGuests > hallCapacity;
    return { totalSeatedGuests, tableCount, extraTables, financialDelta, overCapacity };
  }, [items, hallCapacity, includedTablesQuota, extraTableUnitPrice]);

  const addItem = (type: FloorItemType) => {
    if (isLocked) return;
    const meta = ITEM_STYLES[type];
    const count = items.filter((i) => i.type === type).length + 1;
    const newId = `${type}-${Date.now()}`;
    setItems((prev) => [
      ...prev,
      {
        id: newId,
        type,
        label: `${isRtl ? meta.ar : meta.en} #${count}`,
        x: Math.min(stageWidth - 130, 80 + (prev.length % 5) * 115),
        y: Math.min(stageHeight - 80, 90 + Math.floor(prev.length / 5) * 95),
        seats: meta.seats,
      },
    ]);
    setSelectedId(newId);
  };

  const handlePointerDownItem = (e: React.PointerEvent, item: FloorItem) => {
    e.stopPropagation();
    setSelectedId(item.id);
    if (isLocked || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / zoom;
    const localY = (e.clientY - rect.top) / zoom;
    setDraggingId(item.id);
    setDragOffset({ dx: localX - item.x, dy: localY - item.y });
  };

  const handlePointerMoveCanvas = (e: React.PointerEvent) => {
    if (!draggingId || isLocked || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const localX = Math.max(24, Math.min(stageWidth / zoom - 60, (e.clientX - rect.left) / zoom - dragOffset.dx));
    const localY = Math.max(24, Math.min(stageHeight / zoom - 40, (e.clientY - rect.top) / zoom - dragOffset.dy));
    setItems((prev) =>
      prev.map((item) => (item.id === draggingId ? { ...item, x: Math.round(localX), y: Math.round(localY) } : item))
    );
  };

  const handleTouchMoveCanvas = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchStartDist !== null && pinchStartDist > 10) {
        const ratio = d / pinchStartDist;
        setZoom((z) => Math.max(0.65, Math.min(1.6, Number((z * ratio).toFixed(2)))));
      }
      setPinchStartDist(d);
    }
  };

  const updateSelectedSeats = (delta: number) => {
    if (!selectedItem || isLocked) return;
    setItems((prev) =>
      prev.map((i) => (i.id === selectedItem.id ? { ...i, seats: Math.max(0, i.seats + delta) } : i))
    );
  };

  const duplicateSelected = () => {
    if (!selectedItem || isLocked) return;
    const copyId = `${selectedItem.type}-${Date.now()}`;
    setItems((prev) => [
      ...prev,
      {
        ...selectedItem,
        id: copyId,
        label: `${selectedItem.label} (Copy)`,
        x: Math.min(stageWidth - 100, selectedItem.x + 40),
        y: Math.min(stageHeight - 60, selectedItem.y + 40),
      },
    ]);
    setSelectedId(copyId);
  };

  const deleteSelected = () => {
    if (!selectedItem || isLocked) return;
    setItems((prev) => prev.filter((i) => i.id !== selectedItem.id));
    setSelectedId(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveDraft({ items, totalSeatedGuests: metrics.totalSeatedGuests }, metrics.financialDelta);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SpotlightCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SpotlightHeading as="h3" className="text-lg">
          {isRtl ? 'مخطط توزيع القاعة التفاعلي' : 'Interactive Hall Floor Plan Designer'}
        </SpotlightHeading>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={`font-mono tabular-nums ${metrics.overCapacity ? 'font-bold text-red-500' : 'text-slate-600 dark:text-slate-300'}`}>
            {isRtl
              ? `الضيوف: ${metrics.totalSeatedGuests} / ${hallCapacity}`
              : `Guests: ${metrics.totalSeatedGuests} / ${hallCapacity}`}
          </span>
          <span className="rounded-md bg-amber-500/15 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {isRtl
              ? `تكلفة الطاولات الإضافية: +${metrics.financialDelta.toLocaleString()} ${currency}`
              : `Extra Tables Delta: +${metrics.financialDelta.toLocaleString()} ${currency}`}
          </span>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {isRtl
            ? 'تم إغلاق التعديل المباشر على المخطط لاقتراب موعد المناسبة. لطلب تعديل عاجل يرجى التواصل مع منسق الصالة.'
            : 'Direct floor plan editing is locked due to the pre-event freeze window. Contact your coordinator for urgent changes.'}
        </div>
      )}

      {/* Toolbar & Zoom Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ITEM_STYLES) as FloorItemType[]).map((type) => {
            const meta = ITEM_STYLES[type];
            return (
              <button
                key={type}
                type="button"
                disabled={isLocked}
                onClick={() => addItem(type)}
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:border-[var(--brand-primary,#D4AF37)] disabled:opacity-50 dark:border-slate-700"
              >
                + {isRtl ? meta.ar : meta.en}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.15).toFixed(2))))}
            aria-label="Zoom out"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 text-xs dark:border-slate-700"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
            aria-label="Zoom in"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 text-xs dark:border-slate-700"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Responsive Interactive Stage Container */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMoveCanvas}
        onPointerUp={() => setDraggingId(null)}
        onPointerLeave={() => setDraggingId(null)}
        onTouchMove={handleTouchMoveCanvas}
        onTouchEnd={() => setPinchStartDist(null)}
        onClick={() => setSelectedId(null)}
        className="relative touch-none select-none overflow-hidden rounded-xl border border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
        style={{ height: `${stageHeight}px` }}
      >
        <svg
          width={stageWidth}
          height={stageHeight}
          viewBox={`0 0 ${Math.round(stageWidth / zoom)} ${Math.round(stageHeight / zoom)}`}
          className="h-full w-full"
        >
          <defs>
            <pattern id="floor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-slate-200 dark:text-slate-800/80"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#floor-grid)" />

          {items.map((item) => {
            const style = ITEM_STYLES[item.type];
            const isSel = selectedId === item.id;
            return (
              <g
                key={item.id}
                transform={`translate(${item.x}, ${item.y})`}
                onPointerDown={(e) => handlePointerDownItem(e, item)}
                onClick={(e) => e.stopPropagation()}
                className="cursor-grab active:cursor-grabbing"
              >
                {style.isRound ? (
                  <circle
                    cx={0}
                    cy={0}
                    r={36}
                    fill={style.color}
                    fillOpacity={0.9}
                    stroke={isSel ? '#FACC15' : '#FFFFFF'}
                    strokeWidth={isSel ? 3 : 1}
                  />
                ) : (
                  <rect
                    x={0}
                    y={0}
                    width={136}
                    height={48}
                    rx={8}
                    fill={style.color}
                    fillOpacity={0.9}
                    stroke={isSel ? '#FACC15' : '#FFFFFF'}
                    strokeWidth={isSel ? 3 : 1}
                  />
                )}
                <text
                  x={style.isRound ? 0 : 68}
                  y={style.isRound ? -2 : 22}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="11"
                  fontWeight="600"
                >
                  {item.label}
                </text>
                {item.seats > 0 && (
                  <text
                    x={style.isRound ? 0 : 68}
                    y={style.isRound ? 14 : 38}
                    textAnchor="middle"
                    fill="#E2E8F0"
                    fontSize="10"
                  >
                    {item.seats} {isRtl ? 'مقعد' : 'seats'}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Table / Item Bottom Action Sheet */}
      {selectedItem && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs">
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{selectedItem.label}</div>
            <div className="text-slate-600 dark:text-slate-300">
              {isRtl ? `المقاعد: ${selectedItem.seats}` : `Seats: ${selectedItem.seats}`} · X:{selectedItem.x} Y:{selectedItem.y}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isLocked}
              onClick={() => updateSelectedSeats(-1)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => updateSelectedSeats(1)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={duplicateSelected}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 font-medium dark:border-slate-700 dark:bg-slate-900"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{isRtl ? 'تكرار' : 'Duplicate'}</span>
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={deleteSelected}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-rose-600 px-3 font-medium text-white hover:bg-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{isRtl ? 'حذف' : 'Delete'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Draft & Approval Actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          disabled={isLocked || saving}
          onClick={handleSave}
          className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {saving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : isRtl ? 'حفظ كمسودة' : 'Save Draft'}
        </button>
        <button
          type="button"
          disabled={isLocked || metrics.overCapacity}
          onClick={onSubmitApproval}
          className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 py-2 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:opacity-50"
        >
          {isRtl ? 'إرسال للاعتماد والمزامنة' : 'Submit for Approval & Sync'}
        </button>
      </div>
    </SpotlightCard>
  );
}
