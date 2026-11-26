import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const intlMiddleware = createMiddleware({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
});

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000').split(':')[0].toLowerCase();
const ROOT_DOMAINS = Array.from(new Set([ROOT_DOMAIN, 'eventledger.local', 'eventledger.cloud']));

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Handle /t/[slug]/... without locale prefix by redirecting to /ar/t/[slug]/...
  const bareTenantMatch = pathname.match(/^\/t\/([a-z0-9-]+)(\/.*)?$/i);
  if (bareTenantMatch) {
    const slug = bareTenantMatch[1].toLowerCase();
    const rest = bareTenantMatch[2] && bareTenantMatch[2] !== '/' ? bareTenantMatch[2] : '/venue';
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = `/ar/t/${slug}${rest}`;
    redirectUrl.search = search;
    return NextResponse.redirect(redirectUrl);
  }

  // Handle path-based tenant prefixes: /[locale]/t/[slug]/... -> rewrite to /[locale]/...
  const pathTenantMatch = pathname.match(/^\/(ar|en)\/t\/([a-z0-9-]+)(\/.*)?$/i);
  if (pathTenantMatch) {
    const locale = pathTenantMatch[1].toLowerCase();
    const slug = pathTenantMatch[2].toLowerCase();
    const subPath = pathTenantMatch[3] && pathTenantMatch[3] !== '/' ? pathTenantMatch[3] : '/venue';

    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/${locale}${subPath}`;

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-tenant-slug', slug);
    requestHeaders.set('x-tenant-mode', 'TENANT_WORKSPACE');
    requestHeaders.set('x-tenant-identifier', slug);
    requestHeaders.set('x-tenant-identifier-type', 'SLUG');
    requestHeaders.set('x-next-intl-locale', locale);

    const res = NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
    res.headers.set('x-tenant-slug', slug);
    res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
    res.headers.set('x-tenant-identifier', slug);
    res.headers.set('x-tenant-identifier-type', 'SLUG');
    return res;
  }

  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(':')[0].toLowerCase();
  const res = intlMiddleware(req);

  if (host === `admin.${ROOT_DOMAIN}` || host.startsWith('admin.') || /^\/(ar|en)\/admin(\/|$)/.test(pathname)) {
    res.headers.set('x-tenant-mode', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === 'localhost' || host === '127.0.0.1') {
    res.headers.set('x-tenant-mode', 'PLATFORM_ROOT');
    return res;
  }

  for (const domain of ROOT_DOMAINS) {
    if (host.endsWith(`.${domain}`)) {
      const slug = host.slice(0, -(domain.length + 1));
      if (slug && slug !== 'www' && slug !== 'admin' && slug !== 'api') {
        res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
        res.headers.set('x-tenant-slug', slug);
        res.headers.set('x-tenant-identifier', slug);
        res.headers.set('x-tenant-identifier-type', 'SLUG');
        return res;
      }
    }
  }

  res.headers.set('x-tenant-mode', 'TENANT_CUSTOM_DOMAIN');
  res.headers.set('x-tenant-slug', host);
  res.headers.set('x-tenant-custom-domain', host);
  res.headers.set('x-tenant-identifier', host);
  res.headers.set('x-tenant-identifier-type', 'CUSTOM_DOMAIN');
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
