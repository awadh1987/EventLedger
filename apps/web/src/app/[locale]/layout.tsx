import React from 'react';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { IntlProvider } from '@/components/providers/intl-provider';
import { ThemeBrandingProvider } from '@/components/providers/theme-branding-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { LocaleDirSync } from '@/components/providers/locale-dir-sync';
import { NavigationHistoryProvider } from '@/components/navigation/NavigationHistoryProvider';
import { WorkspaceSidebar } from '@/components/layout/WorkspaceSidebar';

export function generateStaticParams() {
  return [{ locale: 'ar' }, { locale: 'en' }];
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const locale = params.locale === 'en' ? 'en' : 'ar';
  const messages = locale === 'ar' ? arMessages : enMessages;

  return (
    <div lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleDirSync locale={locale} />
      <IntlProvider locale={locale} messages={messages}>
        <ThemeBrandingProvider>
          <AuthProvider>
            <NavigationHistoryProvider>
              <WorkspaceSidebar locale={locale}>{children}</WorkspaceSidebar>
            </NavigationHistoryProvider>
          </AuthProvider>
        </ThemeBrandingProvider>
      </IntlProvider>
    </div>
  );
}
