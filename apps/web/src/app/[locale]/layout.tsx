import React from 'react';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Plus_Jakarta_Sans } from 'next/font/google';
import '../globals.css';
import { ThemeBrandingProvider } from '@/components/providers/theme-branding-provider';
import { AuthProvider } from '@/components/providers/auth-provider';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-en',
  display: 'swap',
});

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-ar',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EventLedger — Venue & Conference Operations ERP',
  description:
    'Bilingual multi-tenant Venue, Wedding Hall & Conference Operations Cloud ERP with Cloud SQL persistence, real-time voice concierge, Maps vendor discovery, and multi-turn AI operations assistant.',
  openGraph: {
    title: 'EventLedger — Venue & Conference Operations ERP',
    description:
      'Bilingual multi-tenant Venue, Wedding Hall & Conference Operations Cloud ERP with Cloud SQL persistence, real-time voice concierge, Maps vendor discovery, and multi-turn AI operations assistant.',
  },
};

export function generateStaticParams() {
  return [{ locale: 'ar' }, { locale: 'en' }];
}

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${ibmPlexArabic.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeBrandingProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeBrandingProvider>
      </body>
    </html>
  );
}
