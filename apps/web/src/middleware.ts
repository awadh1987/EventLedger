import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const intlMiddleware = createMiddleware({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
});

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000').split(':')[0].toLowerCase();

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  const res = intlMiddleware(req);

  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === 'localhost' || host === '127.0.0.1') {
    res.headers.set('x-tenant-mode', 'PLATFORM_ROOT');
    return res;
  }

  if (host === `admin.${ROOT_DOMAIN}` || host.startsWith('admin.')) {
    res.headers.set('x-tenant-mode', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  let slug = host;
  let identifierType: 'SLUG' | 'CUSTOM_DOMAIN' = 'CUSTOM_DOMAIN';
  if (host.endsWith(`.${ROOT_DOMAIN}`)) {
    slug = host.replace(`.${ROOT_DOMAIN}`, '');
    identifierType = 'SLUG';
  }
  res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
  res.headers.set('x-tenant-identifier', slug);
  res.headers.set('x-tenant-identifier-type', identifierType);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
