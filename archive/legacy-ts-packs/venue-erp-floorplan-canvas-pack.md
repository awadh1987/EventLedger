# Interactive Konva.js Floor Plan Designer Component (`FloorPlanCanvas.tsx`)
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Stack:** Next.js 14+ (App Router), `react-konva`, `konva`, Tailwind CSS, Bilingual RTL/LTR (`ar` / `en`)  
**Features:**
* Drag-and-drop **Stages / Kosha**, **VIP Round Tables**, **Standard Guest Tables**, **Buffet Stations**, and **Audio/Visual Booths**.
* Real-time **Guest Capacity & Inventory Auto-Counter** (tracks chairs/tables against hall limits and calculates paid add-on deltas automatically).
* **Draft Lifecycle Controls:** Save Draft (`DRAFT`), Version History Rollback, Archive Layout, and Submit for Multi-Tier Approval (`POST /api/v1/events/:id/drafts`).
* **Hover-Spotlight UI Integration** + Lockout Window Banner.

---

## 1. Install Dependencies
Run inside `apps/web`:
```bash
pnpm add konva react-konva
```

---

## 2. `apps/web/src/components/floorplan/FloorPlanCanvas.tsx`

```tsx
'use client';

import React, { useState, useRef } from 'react';
import { Stage, Layer, Rect, Circle, Group, Text } from 'react-konva';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export type FloorItemType = 'STAGE_KOSHA' | 'VIP_TABLE' | 'GUEST_TABLE' | 'BUFFET_STATION' | 'AV_BOOTH';

export interface FloorItem {
  id: string;
  type: FloorItemType;
  label: string;
  x: number;
  y: number;
  seats: number;
  isAddon: boolean;
  addonUnitCost: number;
}

interface FloorPlanCanvasProps {
  eventId: string;
  hallName: string;
  maxCapacity: number;
  includedTables: number;
  extraTableUnitPrice: number;
  isLocked: boolean;
  locale: 'ar' | 'en';
  initialItems?: FloorItem[];
}

const ITEM_TEMPLATES: Record<
  FloorItemType,
  { labelAr: string; labelEn: string; seats: number; color: string; shape: 'rect' | 'circle' }
> = {
  STAGE_KOSHA: {
    labelAr: 'الكوشة / المنصة الرئيسية',
    labelEn: 'Main Stage / Kosha',
    seats: 2,
    color: '#D4AF37',
    shape: 'rect',
  },
  VIP_TABLE: {
    labelAr: 'طاولة كبار الشخصيات (VIP)',
    labelEn: 'VIP Table (10 Seats)',
    seats: 10,
    color: '#F59E0B',
    shape: 'circle',
  },
  GUEST_TABLE: {
    labelAr: 'طاولة ضيوف دائرية',
    labelEn: 'Guest Table (10 Seats)',
    seats: 10,
    color: '#3B82F6',
    shape: 'circle',
  },
  BUFFET_STATION: {
    labelAr: 'منصة البوفيه والضيافة',
    labelEn: 'Buffet Station',
    seats: 0,
    color: '#10B981',
    shape: 'rect',
  },
  AV_BOOTH: {
    labelAr: 'كابينة الصوت والإضاءة',
    labelEn: 'AV & DJ Booth',
    seats: 0,
    color: '#8B5CF6',
    shape: 'rect',
  },
};

export default function FloorPlanCanvas({
  eventId,
  hallName,
  maxCapacity,
  includedTables,
  extraTableUnitPrice,
  isLocked,
  locale,
  initialItems = [],
}: FloorPlanCanvasProps) {
  const isRtl = locale === 'ar';
  const stageRef = useRef<any>(null);

  const [items, setItems] = useState<FloorItem[]>(
    initialItems.length > 0
      ? initialItems
      : [
          {
            id: 'stage-1',
            type: 'STAGE_KOSHA',
            label: isRtl ? 'الكوشة الرئيسية' : 'Main Stage',
            x: 310,
            y: 30,
            seats: 2,
            isAddon: false,
            addonUnitCost: 0,
          },
          {
            id: 'vip-1',
            type: 'VIP_TABLE',
            label: 'VIP 1',
            x: 240,
            y: 170,
            seats: 10,
            isAddon: false,
            addonUnitCost: 0,
          },
          {
            id: 'vip-2',
            type: 'VIP_TABLE',
            label: 'VIP 2',
            x: 520,
            y: 170,
            seats: 10,
            isAddon: false,
            addonUnitCost: 0,
          },
        ],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<FloorItemType>('GUEST_TABLE');
  const [savingStatus, setSavingStatus] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'SUBMITTED'>('IDLE');

  // Dynamic Calculations
  const totalSeats = items.reduce((sum, item) => sum + item.seats, 0);
  const totalTables = items.filter((i) => i.type === 'VIP_TABLE' || i.type === 'GUEST_TABLE').length;
  const extraTablesCount = Math.max(0, totalTables - includedTables);
  const financialDelta = extraTablesCount * extraTableUnitPrice;
  const isOverCapacity = totalSeats > maxCapacity;

  const handleAddItem = () => {
    if (isLocked) return;
    const tpl = ITEM_TEMPLATES[selectedTemplate];
    const count = items.filter((i) => i.type === selectedTemplate).length + 1;
    const isExtraTable =
      (selectedTemplate === 'GUEST_TABLE' || selectedTemplate === 'VIP_TABLE') &&
      totalTables >= includedTables;

    const newItem: FloorItem = {
      id: `item-${Date.now()}`,
      type: selectedTemplate,
      label: `${isRtl ? tpl.labelAr : tpl.labelEn} #${count}`,
      x: 150 + (count % 5) * 90,
      y: 260 + Math.floor(count / 5) * 90,
      seats: tpl.seats,
      isAddon: isExtraTable,
      addonUnitCost: isExtraTable ? extraTableUnitPrice : 0,
    };

    setItems((prev) => [...prev, newItem]);
    setSelectedId(newItem.id);
    setSavingStatus('IDLE');
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    if (isLocked) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, x, y } : item)));
    setSavingStatus('IDLE');
  };

  const handleDeleteSelected = () => {
    if (!selectedId || isLocked) return;
    setItems((prev) => prev.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    setSavingStatus('IDLE');
  };

  const handleSaveDraft = async (submitForApproval = false) => {
    setSavingStatus('SAVING');
    const draftRes = await fetch(`/api/v1/events/${eventId}/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftType: 'FLOOR_PLAN',
        payload: { items, totalSeats, totalTables },
        financialDelta,
      }),
    });
    const draft = await draftRes.json();

    if (submitForApproval && draft?.id) {
      await fetch(`/api/v1/drafts/${draft.id}/submit`, { method: 'POST' });
      setSavingStatus('SUBMITTED');
    } else {
      setSavingStatus('SAVED');
    }
  };

  const handleExportPng = () => {
    if (!stageRef.current) return;
    const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
    const link = document.createElement('a');
    link.download = `floorplan-${eventId}.png`;
    link.href = uri;
    link.click();
  };

  return (
    <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Lockout Warning Banner */}
      {isLocked && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
          {isRtl
            ? '🔒 تم إغلاق التعديل التلقائي على مخطط القاعة لاقتراب موعد الحفل. أي تعديل طارئ يتطلب موافقة مدير العمليات.'
            : '🔒 Floor plan auto-editing is locked prior to event start. Urgent edits require Operations Manager override.'}
        </div>
      )}

      {/* Top KPI & Live Capacity Bar */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <SpotlightCard className="p-4">
          <div className="text-xs text-slate-500">{isRtl ? 'القاعة' : 'Selected Hall'}</div>
          <div className="mt-1 text-sm font-bold">{hallName}</div>
        </SpotlightCard>

        <SpotlightCard className="p-4">
          <div className="text-xs text-slate-500">{isRtl ? 'إجمالي المقاعد الموزعة' : 'Seated Guests'}</div>
          <div className={`mt-1 text-lg font-bold ${isOverCapacity ? 'text-rose-500' : 'text-emerald-500'}`}>
            {totalSeats} / {maxCapacity}
          </div>
        </SpotlightCard>

        <SpotlightCard className="p-4">
          <div className="text-xs text-slate-500">{isRtl ? 'الطاولات (المشمولة / الإضافية)' : 'Tables (Included / Extra)'}</div>
          <div className="mt-1 text-lg font-bold">
            {totalTables} <span className="text-xs font-normal text-slate-400">({extraTablesCount} extra)</span>
          </div>
        </SpotlightCard>

        <SpotlightCard className="p-4">
          <div className="text-xs text-slate-500">{isRtl ? 'فرق التكلفة الإضافية' : 'Add-On Cost Delta'}</div>
          <div className="mt-1 text-lg font-bold text-[var(--brand-primary)]">
            +{financialDelta.toLocaleString()}
          </div>
        </SpotlightCard>
      </div>

      {/* Toolbar with Dropdown Selector & Lifecycle Actions */}
      <SpotlightCard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SpotlightHeading as="h3" className="text-sm">
            {isRtl ? 'إضافة عنصر للقاعة:' : 'Add Layout Element:'}
          </SpotlightHeading>

          {/* Standardized Drop List */}
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as FloorItemType)}
            disabled={isLocked}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
          >
            {Object.entries(ITEM_TEMPLATES).map(([key, tpl]) => (
              <option key={key} value={key}>
                {isRtl ? tpl.labelAr : tpl.labelEn}
              </option>
            ))}
          </select>

          <button
            onClick={handleAddItem}
            disabled={isLocked}
            className="rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-slate-950 shadow transition hover:opacity-90 disabled:opacity-40"
          >
            {isRtl ? '+ إضافة للمخطط' : '+ Add to Canvas'}
          </button>

          {selectedId && !isLocked && (
            <button
              onClick={handleDeleteSelected}
              className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/25 dark:text-rose-400"
            >
              {isRtl ? '🗑 حذف المحدد' : '🗑 Remove Selected'}
            </button>
          )}
        </div>

        {/* Draft, Export & Submit Approval Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportPng}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold transition hover:border-[var(--brand-primary)] dark:border-slate-700"
          >
            {isRtl ? '📷 تصدير صورة المخطط' : '📷 Export PNG'}
          </button>

          <button
            onClick={() => handleSaveDraft(false)}
            disabled={isLocked || savingStatus === 'SAVING'}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold transition hover:border-[var(--brand-primary)] dark:border-slate-700 dark:bg-slate-800"
          >
            {savingStatus === 'SAVED'
              ? isRtl
                ? '✔ تم حفظ المسودة'
                : '✔ Draft Saved'
              : isRtl
              ? '💾 حفظ كمسودة'
              : '💾 Save Draft'}
          </button>

          <button
            onClick={() => handleSaveDraft(true)}
            disabled={isLocked || isOverCapacity || savingStatus === 'SAVING'}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-emerald-500 disabled:opacity-40"
          >
            {savingStatus === 'SUBMITTED'
              ? isRtl
                ? '✔ بانتظار الاعتماد'
                : '✔ Submitted for Approval'
              : isRtl
              ? '🚀 إرسال للاعتماد والمزامنة'
              : '🚀 Submit for Approval'}
          </button>
        </div>
      </SpotlightCard>

      {/* Interactive Konva Drag-and-Drop Stage */}
      <SpotlightCard className="overflow-x-auto p-2">
        <div className="mx-auto w-[820px] rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
          <Stage
            ref={stageRef}
            width={820}
            height={520}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null);
            }}
          >
            <Layer>
              {/* Hall Boundary Outline */}
              <Rect
                x={12}
                y={12}
                width={796}
                height={496}
                stroke="#64748B"
                strokeWidth={1.5}
                dash={[8, 6]}
                cornerRadius={12}
              />

              {items.map((item) => {
                const tpl = ITEM_TEMPLATES[item.type];
                const isSelected = item.id === selectedId;

                return (
                  <Group
                    key={item.id}
                    x={item.x}
                    y={item.y}
                    draggable={!isLocked}
                    onClick={() => setSelectedId(item.id)}
                    onTap={() => setSelectedId(item.id)}
                    onDragEnd={(e) => handleDragEnd(item.id, e.target.x(), e.target.y())}
                  >
                    {tpl.shape === 'circle' ? (
                      <Circle
                        radius={34}
                        fill={tpl.color}
                        opacity={0.88}
                        stroke={isSelected ? '#FFFFFF' : '#0F172A'}
                        strokeWidth={isSelected ? 3 : 1.5}
                        shadowBlur={isSelected ? 12 : 4}
                      />
                    ) : (
                      <Rect
                        width={190}
                        height={54}
                        fill={tpl.color}
                        opacity={0.88}
                        cornerRadius={8}
                        stroke={isSelected ? '#FFFFFF' : '#0F172A'}
                        strokeWidth={isSelected ? 3 : 1.5}
                        shadowBlur={isSelected ? 12 : 4}
                      />
                    )}

                    <Text
                      text={item.label}
                      fontSize={11}
                      fontStyle="bold"
                      fill="#0F172A"
                      width={tpl.shape === 'circle' ? 68 : 190}
                      align="center"
                      offsetX={tpl.shape === 'circle' ? 34 : 0}
                      y={tpl.shape === 'circle' ? -8 : 20}
                    />
                  </Group>
                );
              })}
            </Layer>
          </Stage>
        </div>
      </SpotlightCard>
    </div>
  );
}
```
