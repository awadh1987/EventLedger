import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const intlMiddleware = createMiddleware({ locales: ['ar', 'en'], defaultLocale: 'ar' });
const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000').split(':')[0].toLowerCase();

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const hostname = req.headers.get('host') || '';
  const cleanHost = hostname.split(':')[0].toLowerCase();

  if (url.pathname.startsWith('/_next') || url.pathname.startsWith('/api') || url.pathname.includes('.')) {
    return NextResponse.next();
  }

  const res = intlMiddleware(req);
  if (cleanHost === ROOT_DOMAIN || cleanHost === `www.${ROOT_DOMAIN}` || cleanHost === 'localhost') {
    res.headers.set('x-tenant-mode', 'PLATFORM_ROOT');
    return res;
  }
  if (cleanHost === `admin.${ROOT_DOMAIN}`) {
    res.headers.set('x-tenant-mode', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  let tenantIdentifier = cleanHost;
  let identifierType: 'SLUG' | 'CUSTOM_DOMAIN' = 'CUSTOM_DOMAIN';
  if (cleanHost.endsWith(`.${ROOT_DOMAIN}`)) {
    tenantIdentifier = cleanHost.replace(`.${ROOT_DOMAIN}`, '');
    identifierType = 'SLUG';
  }
  res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
  res.headers.set('x-tenant-identifier', tenantIdentifier);
  res.headers.set('x-tenant-identifier-type', identifierType);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
