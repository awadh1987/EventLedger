'use client';

import { useEffect } from 'react';

export function LocaleDirSync({ locale }: { locale: 'ar' | 'en' }) {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  return null;
}
