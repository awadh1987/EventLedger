'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { SystemLookupItem } from '@/lib/types';

export function LookupSelect({
  category,
  locale = 'ar',
  value,
  onChange,
  className = '',
  fallbackOptions = [],
}: {
  category: string;
  locale?: 'ar' | 'en';
  value: string;
  onChange: (val: string) => void;
  className?: string;
  fallbackOptions?: { code: string; label_ar: string; label_en: string }[];
}) {
  const [items, setItems] = useState<SystemLookupItem[]>([]);
  const isRtl = locale === 'ar';

  useEffect(() => {
    let active = true;
    apiFetch<SystemLookupItem[]>(`/api/v1/lookups?category=${encodeURIComponent(category)}`)
      .then((data) => {
        if (active && Array.isArray(data) && data.length > 0) setItems(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [category]);

  const options = items.length > 0 ? items : fallbackOptions;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 ${className}`}
    >
      {options.map((opt) => (
        <option key={opt.code} value={opt.code}>
          {isRtl ? opt.label_ar : opt.label_en}
        </option>
      ))}
    </select>
  );
}
