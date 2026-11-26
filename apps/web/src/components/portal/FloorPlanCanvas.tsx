'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Layer, Rect, Circle, Group, Text as KonvaText, Stage } from 'react-konva';
import { Plus, RotateCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { FloorPlanElement } from '@/lib/types';

const PALETTE: {
  type: FloorPlanElement['type'];
  labelAr: string;
  labelEn: string;
  seats: number;
  w: number;
  h: number;
}[] = [
  { type: 'ROUND_TABLE', labelAr: 'طاولة دائرية (10)', labelEn: 'Round Table (10)', seats: 10, w: 68, h: 68 },
  { type: 'RECT_TABLE', labelAr: 'طاولة مستطيلة (8)', labelEn: 'Rect Table (8)', seats: 8, w: 96, h: 48 },
  { type: 'STAGE', labelAr: 'منصة / كوشة', labelEn: 'Stage', seats: 0, w: 180, h: 70 },
  { type: 'DANCE_FLOOR', labelAr: 'ساحة رقص', labelEn: 'Dance Floor', seats: 0, w: 140, h: 140 },
  { type: 'BUFFET', labelAr: 'بوفيه الضيافة', labelEn: 'Buffet', seats: 0, w: 150, h: 44 },
  { type: 'DJ', labelAr: 'منصة DJ', labelEn: 'DJ Booth', seats: 0, w: 80, h: 48 },
];

export function FloorPlanCanvas({
  locale = 'ar',
  elements,
  onChange,
  onSaveDraft,
  onSubmitApproval,
  saving,
}: {
  locale?: 'ar' | 'en';
  elements: FloorPlanElement[];
  onChange: (next: FloorPlanElement[]) => void;
  onSaveDraft: () => void;
  onSubmitApproval: () => void;
  saving?: boolean;
}) {
  const isRtl = locale === 'ar';
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 720, height: 460 });
  const [scale, setScale] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pinchDistRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(300, Math.floor(entry.contentRect.width));
        const h = Math.max(340, Math.min(540, Math.floor(w * 0.62)));
        setStageSize({ width: w, height: h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalSeats = elements.reduce((acc, item) => acc + (item.seats || 0), 0);

  const addElement = (tpl: (typeof PALETTE)[number]) => {
    const next: FloorPlanElement = {
      id: `el_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: tpl.type,
      x: 100 + (elements.length % 5) * 35,
      y: 100 + (elements.length % 4) * 35,
      width: tpl.w,
      height: tpl.h,
      rotation: 0,
      seats: tpl.seats,
      label: isRtl ? tpl.labelAr : tpl.labelEn,
    };
    onChange([...elements, next]);
    setSelectedId(next.id);
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    onChange(elements.map((el) => (el.id === selectedId ? { ...el, rotation: (el.rotation + 15) % 360 } : el)));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    onChange(elements.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchDistRef.current !== null) {
        const delta = dist / pinchDistRef.current;
        setScale((s) => Math.max(0.5, Math.min(2.2, Number((s * delta).toFixed(2)))));
      }
      pinchDistRef.current = dist;
    }
  };

  const handleTouchEnd = () => {
    pinchDistRef.current = null;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((tpl) => (
            <button
              key={tpl.type}
              type="button"
              onClick={() => addElement(tpl)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold hover:border-[var(--brand-primary,#D4AF37)] dark:border-slate-700"
            >
              <Plus className="h-3.5 w-3.5 text-[var(--brand-primary,#D4AF37)]" />
              <span>{isRtl ? tpl.labelAr : tpl.labelEn}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-[var(--brand-primary,#D4AF37)]/15 px-3 py-1.5 font-mono text-xs font-bold text-[var(--brand-primary,#D4AF37)]">
            {isRtl ? `المقاعد: ${totalSeats}` : `Seats: ${totalSeats}`}
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2, Number((s + 0.15).toFixed(2))))}
            className="min-h-[40px] rounded-lg border border-slate-300 p-2 dark:border-slate-700"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
            className="min-h-[40px] rounded-lg border border-slate-300 p-2 dark:border-slate-700"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="w-full overflow-hidden rounded-xl border border-slate-300 bg-slate-900/95 dark:border-slate-800"
      >
        <Stage width={stageSize.width} height={stageSize.height} scaleX={scale} scaleY={scale}>
          <Layer>
            {elements.map((el) => {
              const isSelected = el.id === selectedId;
              return (
                <Group
                  key={el.id}
                  x={el.x}
                  y={el.y}
                  rotation={el.rotation}
                  draggable
                  onClick={() => setSelectedId(el.id)}
                  onTap={() => setSelectedId(el.id)}
                  onDragEnd={(e) => {
                    const nx = Math.round(e.target.x());
                    const ny = Math.round(e.target.y());
                    onChange(elements.map((item) => (item.id === el.id ? { ...item, x: nx, y: ny } : item)));
                  }}
                >
                  {el.type === 'ROUND_TABLE' ? (
                    <Circle
                      radius={el.width / 2}
                      fill={isSelected ? '#D4AF37' : '#1e293b'}
                      stroke="#D4AF37"
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                  ) : (
                    <Rect
                      width={el.width}
                      height={el.height}
                      cornerRadius={8}
                      fill={isSelected ? '#D4AF37' : '#1e293b'}
                      stroke="#D4AF37"
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                  )}
                  <KonvaText
                    text={el.label}
                    fontSize={11}
                    fill={isSelected ? '#0f172a' : '#f8fafc'}
                    x={el.type === 'ROUND_TABLE' ? -28 : 6}
                    y={el.type === 'ROUND_TABLE' ? -6 : 8}
                    width={el.type === 'ROUND_TABLE' ? 56 : el.width - 12}
                    align="center"
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {/* Bottom Action Bar (Desktop + Mobile Sheet) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={rotateSelected}
            disabled={!selectedId}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold disabled:opacity-40 dark:border-slate-700"
          >
            <RotateCw className="h-4 w-4" />
            <span>{isRtl ? 'تدوير' : 'Rotate'}</span>
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedId}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-500/40 px-3 text-xs font-semibold text-red-500 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            <span>{isRtl ? 'حذف' : 'Delete'}</span>
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onSaveDraft}
            className="min-h-[44px] rounded-lg border border-[var(--brand-primary,#D4AF37)] px-4 text-xs font-bold text-[var(--brand-primary,#D4AF37)]"
          >
            {isRtl ? 'حفظ كمسودة' : 'Save Draft'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSubmitApproval}
            className="min-h-[44px] rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 text-xs font-bold text-slate-950"
          >
            {isRtl ? 'إرسال للاعتماد' : 'Submit for Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
