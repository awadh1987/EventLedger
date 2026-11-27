'use client';

import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export interface SelectOrOtherOption {
  value: string;
  labelAr: string;
  labelEn: string;
}

interface Props {
  options: SelectOrOtherOption[];
  value: string;
  onChange: (val: string) => void;
  locale: 'ar' | 'en';
  allowOther?: boolean;
  allowPromoteCategory?: string;
  onPromoted?: (created: { code: string; label_ar: string; label_en: string }) => void;
  placeholderAr?: string;
  placeholderEn?: string;
  otherPlaceholderAr?: string;
  otherPlaceholderEn?: string;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

export const OTHER_SENTINEL = '__OTHER__';

export function SelectOrOther({
  options,
  value,
  onChange,
  locale,
  allowOther = true,
  allowPromoteCategory,
  onPromoted,
  placeholderAr = 'اختر من القائمة...',
  placeholderEn = 'Select an option...',
  otherPlaceholderAr = 'أدخل قيمة مخصصة...',
  otherPlaceholderEn = 'Enter custom value...',
  className = '',
  inputClassName = '',
  required = false,
  disabled = false,
  'aria-label': ariaLabel,
}: Props) {
  const isRtl = locale === 'ar';
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const [explicitOther, setExplicitOther] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);
  const [promotedFlag, setPromotedFlag] = useState(false);

  const matchesKnownOption = options.some((o) => o.value === value);
  const isCustomActive = allowOther && (explicitOther || (Boolean(value) && !matchesKnownOption));

  const selectValue = isCustomActive ? OTHER_SENTINEL : value;

  const baseSelectCls =
    className ||
    'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950';
  const baseInputCls =
    inputClassName ||
    'min-h-[40px] w-full rounded-lg border border-amber-500/50 bg-white px-3 text-sm dark:border-amber-500/40 dark:bg-slate-950';

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setPromotedFlag(false);
    if (v === OTHER_SENTINEL) {
      setExplicitOther(true);
      if (matchesKnownOption) {
        onChange('');
      }
    } else {
      setExplicitOther(false);
      onChange(v);
    }
  };

  const promoteCustomToLookup = async () => {
    const trimmed = value.trim();
    if (!trimmed || !allowPromoteCategory) return;
    setSavingCustom(true);
    try {
      const created = await apiFetch<{
        code: string;
        label_ar: string;
        label_en: string;
      }>('/api/v1/lookups/custom', {
        method: 'POST',
        body: {
          category: allowPromoteCategory,
          label_ar: trimmed,
          label_en: trimmed,
        },
      });
      setPromotedFlag(true);
      setExplicitOther(false);
      onChange(created.code);
      if (onPromoted) onPromoted(created);
    } catch {
      // keep custom text intact even if promotion requires staff role
    } finally {
      setSavingCustom(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <select
        value={selectValue}
        onChange={handleSelectChange}
        required={required && !isCustomActive}
        disabled={disabled}
        aria-label={ariaLabel}
        className={baseSelectCls}
      >
        <option value="">{tr(placeholderAr, placeholderEn)}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {isRtl ? opt.labelAr : opt.labelEn}
          </option>
        ))}
        {allowOther && (
          <option value={OTHER_SENTINEL}>{tr('أخرى (إدخال مخصص)', 'Other (Custom entry)')}</option>
        )}
      </select>

      {isCustomActive && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={value === OTHER_SENTINEL ? '' : value}
            onChange={(e) => {
              setPromotedFlag(false);
              onChange(e.target.value);
            }}
            required={required}
            disabled={disabled}
            placeholder={tr(otherPlaceholderAr, otherPlaceholderEn)}
            className={baseInputCls}
          />
          {allowPromoteCategory && value.trim().length > 1 && (
            <button
              type="button"
              disabled={savingCustom}
              onClick={promoteCustomToLookup}
              title={tr('حفظ في القائمة المرجعية للمستأجر', 'Save to Tenant Lookups')}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-bold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
            >
              {promotedFlag ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              <span>{tr('حفظ للقائمة', 'Save option')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
