'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useNavigationHistory } from '@/components/navigation/NavigationHistoryProvider';

export interface BackButtonProps {
  fallbackHref?: string;
  onClick?: () => void;
  labelAr?: string;
  labelEn?: string;
  locale?: 'ar' | 'en';
  compact?: boolean;
  showLabel?: boolean;
  dirty?: boolean;
  className?: string;
}

export function BackButton({
  fallbackHref,
  onClick,
  labelAr = 'العودة',
  labelEn = 'Back',
  locale: propLocale,
  compact = false,
  showLabel = false,
  dirty,
  className = '',
}: BackButtonProps) {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = propLocale || (params?.locale === 'en' ? 'en' : 'ar');
  const isRtl = locale === 'ar';
  const { goBack, isDirty } = useNavigationHistory();
  const ArrowIcon = isRtl ? ArrowRight : ArrowLeft;
  const accessibleLabel = isRtl ? labelAr : labelEn;

  const handleClick = () => {
    if (dirty !== undefined && dirty) {
      const msg = isRtl
        ? 'لديك تغييرات غير محفوظة. هل تريد المغادرة على أي حال؟'
        : 'You have unsaved changes. Discard and go back?';
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
    }
    if (onClick) {
      onClick();
      return;
    }
    goBack(fallbackHref, dirty === false || (!dirty && !isDirty));
  };

  if (!showLabel) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200/90 bg-white/90 text-slate-700 shadow-sm transition hover:border-[var(--brand-primary,#D4AF37)] hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:text-white ${
          compact ? 'h-8 w-8' : 'h-8 w-8'
        } ${className}`}
      >
        <ArrowIcon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100/80 font-semibold text-slate-700 transition hover:border-[var(--brand-primary,#D4AF37)] hover:text-[var(--brand-primary,#D4AF37)] dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 ${
        compact ? 'h-8 px-2.5 text-xs' : 'h-8 px-2.5 text-xs'
      } ${className}`}
    >
      <ArrowIcon className="h-3.5 w-3.5" />
      <span>{accessibleLabel}</span>
    </button>
  );
}
