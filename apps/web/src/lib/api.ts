const TOKEN_KEY = 'el_access_token';
const ALT_TOKEN_KEY = 'eventledger_token';
const SLUG_KEY = 'el_tenant_slug';
const ALT_SLUG_KEY = 'eventledger_tenant_slug';
const USER_KEY = 'el_auth_user';
const ALT_USER_KEY = 'eventledger_user';
const NATIVE_WS_KEY = 'el_native_workspace';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail
          ? String((detail as { message: unknown }).message)
          : JSON.stringify(detail);
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export interface NativeWorkspaceConfig {
  apiOrigin: string;
  slug: string;
}

export function isNativeRuntime(): boolean {
  if (process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE') return true;
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ || w.Capacitor);
}

export function getNativeWorkspace(): NativeWorkspaceConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(NATIVE_WS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NativeWorkspaceConfig;
    if (parsed?.apiOrigin && parsed?.slug) return parsed;
  } catch {
    return null;
  }
  return null;
}

export function setNativeWorkspace(cfg: NativeWorkspaceConfig | null): void {
  if (typeof window === 'undefined') return;
  if (!cfg) {
    localStorage.removeItem(NATIVE_WS_KEY);
    localStorage.removeItem(SLUG_KEY);
    localStorage.removeItem(ALT_SLUG_KEY);
  } else {
    localStorage.setItem(NATIVE_WS_KEY, JSON.stringify(cfg));
    localStorage.setItem(SLUG_KEY, cfg.slug);
    localStorage.setItem(ALT_SLUG_KEY, cfg.slug);
  }
}

export function getApiOrigin(): string {
  const native = getNativeWorkspace();
  if (native?.apiOrigin) return native.apiOrigin.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('eventledger_api_base_url');
    if (custom) return custom.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
    .replace(/\/api\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return `${getApiOrigin()}/api/v1`;
}

export function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || null;

  const pathMatch = window.location.pathname.match(/^\/(?:(?:ar|en)\/)?t\/([a-z0-9-]+)/i);
  if (pathMatch?.[1]) return pathMatch[1].toLowerCase();

  const native = getNativeWorkspace();
  if (native?.slug) return native.slug.toLowerCase();

  const host = window.location.hostname.toLowerCase();
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'events-ye.services').split(':')[0].toLowerCase();
  const rootDomains = Array.from(new Set([rootDomain]));

  for (const domain of rootDomains) {
    if (host.endsWith(`.${domain}`)) {
      const sub = host.slice(0, -(domain.length + 1));
      if (sub && sub !== 'www' && sub !== 'admin' && sub !== 'api') return sub;
    }
  }

  const stored = localStorage.getItem(SLUG_KEY) || localStorage.getItem(ALT_SLUG_KEY);
  if (stored) return stored.toLowerCase();

  return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || null;
}

export function getActiveTenantSlug(): string {
  return getTenantSlug() || '';
}

export function setTenantSlug(slug: string | null): void {
  if (typeof window === 'undefined') return;
  if (slug) {
    const clean = slug.trim().toLowerCase();
    localStorage.setItem(SLUG_KEY, clean);
    localStorage.setItem(ALT_SLUG_KEY, clean);
  } else {
    localStorage.removeItem(SLUG_KEY);
    localStorage.removeItem(ALT_SLUG_KEY);
  }
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(ALT_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ALT_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ALT_TOKEN_KEY);
  }
}

export function clearAuthStorage(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ALT_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ALT_USER_KEY);
  localStorage.removeItem(SLUG_KEY);
  localStorage.removeItem(ALT_SLUG_KEY);
}

export function isNativeBuild(): boolean {
  return process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE';
}

export function tenantPath(locale: string, slug: string | null | undefined, routePath: string): string {
  const cleanRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (isNativeBuild() || !slug) {
    return `/${locale}${cleanRoute}`;
  }
  return `/${locale}/t/${slug.toLowerCase()}${cleanRoute}`;
}

export function dynamicHref(locale: string, basePath: string, id: string): string {
  if (isNativeBuild()) {
    return `/${locale}${basePath}/_?id=${encodeURIComponent(id)}`;
  }
  return `/${locale}${basePath}/${encodeURIComponent(id)}`;
}

export interface FetchOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: HeadersInit;
  slugOverride?: string;
  originOverride?: string;
  skipAuth?: boolean;
  cache?: RequestCache;
  signal?: AbortSignal;
}

export async function apiFetch<T = any>(
  path: string,
  opts: FetchOptions = {},
  explicitSlug?: string
): Promise<T> {
  const origin = (opts.originOverride || getApiOrigin()).replace(/\/+$/, '');

  let url: string;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    url = path;
  } else {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (
      cleanPath.startsWith('/api/') ||
      cleanPath === '/health' ||
      cleanPath.startsWith('/health?') ||
      cleanPath.startsWith('/uploads/')
    ) {
      url = `${origin}${cleanPath}`;
    } else {
      url = `${origin}/api/v1${cleanPath}`;
    }
  }

  const headers = new Headers(opts.headers || {});

  const slug = explicitSlug ?? opts.slugOverride ?? getTenantSlug();
  if (slug && !headers.has('X-Tenant-Slug')) {
    headers.set('X-Tenant-Slug', slug);
  }

  const token = opts.skipAuth ? null : getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (typeof opts.body === 'string') {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    body = opts.body;
  } else if (opts.body !== undefined) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
    cache: opts.cache,
    signal: opts.signal,
  });

  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const json = await res.json();
      detail = json?.detail?.message || json?.detail || json;
    } catch {
      // ignore json parse failure
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export async function downloadAuthorizedFile(path: string, filename: string): Promise<void> {
  const origin = getApiOrigin();
  const headers: Record<string, string> = {};
  const slug = getTenantSlug();
  if (slug) headers['X-Tenant-Slug'] = slug;
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${origin}${cleanPath}`, { headers });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
