import React from 'react';
import '../globals.css';
import { ThemeBrandingProvider } from '@/components/providers/theme-branding-provider';

export function generateStaticParams() {
  return [{ locale: 'ar' }, { locale: 'en' }];
}

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeBrandingProvider>{children}</ThemeBrandingProvider>
      </body>
    </html>
  );
}
