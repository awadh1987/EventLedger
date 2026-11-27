'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, getAccessToken } from '@/lib/api';
import { SelectOrOther } from '@/components/ui/SelectOrOther';
import type { SystemLookupItem } from '@/lib/types';

export type LookupFallbackOption =
  | { value: string; labelAr: string; labelEn: string }
  | { code: string; label_ar: string; label_en: string };

interface Props {
  category: string;
  value: string;
  onChange: (val: string) => void;
  locale: 'ar' | 'en';
  placeholderAr?: string;
  placeholderEn?: string;
  allowOther?: boolean;
  allowPromote?: boolean;
  fallbackOptions?: LookupFallbackOption[];
  className?: string;
  required?: boolean;
}

export function LookupSelect({
  category,
  value,
  onChange,
  locale,
  placeholderAr = 'اختر من القائمة...',
  placeholderEn = 'Select an option...',
  allowOther = true,
  allowPromote = false,
  fallbackOptions = [],
  className = '',
  required = false,
}: Props) {
  const [items, setItems] = useState<SystemLookupItem[]>([]);

  const loadLookups = useCallback(async () => {
    if (!getAccessToken()) {
      setItems([]);
      return;
    }
    try {
      const data = await apiFetch<SystemLookupItem[]>(`/api/v1/lookups?category=${category}`);
      setItems(data);
    } catch {
      setItems([]);
    }
  }, [category]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  const options =
    items.length > 0
      ? items.map((it) => ({
          value: it.code,
          labelAr: it.label_ar,
          labelEn: it.label_en,
        }))
      : fallbackOptions.map((fb) =>
          'value' in fb
            ? fb
            : {
                value: fb.code,
                labelAr: fb.label_ar,
                labelEn: fb.label_en,
              }
        );

  return (
    <SelectOrOther
      options={options}
      value={value}
      onChange={onChange}
      locale={locale}
      allowOther={allowOther}
      allowPromoteCategory={allowPromote ? category : undefined}
      onPromoted={() => {
        loadLookups();
      }}
      placeholderAr={placeholderAr}
      placeholderEn={placeholderEn}
      otherPlaceholderAr="أدخل قيمة مخصصة..."
      otherPlaceholderEn="Enter custom value..."
      className={className}
      required={required}
    />
  );
}
