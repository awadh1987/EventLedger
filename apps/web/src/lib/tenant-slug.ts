const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'events-ye.services')
  .split(':')[0]
  .toLowerCase();

export function resolveTenantSlug(fallbackSlug = 'qasralomara'): string {
  if (typeof window === 'undefined') return fallbackSlug;

  const pathMatch = window.location.pathname.match(/^\/(?:(?:ar|en)\/)?t\/([a-z0-9-]+)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1].toLowerCase();
  }

  const host = window.location.hostname.split(':')[0].toLowerCase();
  if (
    host &&
    host !== ROOT_DOMAIN &&
    host !== `www.${ROOT_DOMAIN}` &&
    host !== `admin.${ROOT_DOMAIN}` &&
    host.endsWith(`.${ROOT_DOMAIN}`)
  ) {
    const subSlug = host.replace(`.${ROOT_DOMAIN}`, '');
    if (subSlug) return subSlug;
  }

  const saved = window.localStorage.getItem('el_tenant_slug') || window.localStorage.getItem('eventledger_tenant_slug');
  if (saved) return saved.toLowerCase();

  return fallbackSlug;
}
