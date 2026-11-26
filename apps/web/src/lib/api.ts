const TOKEN_KEY = 'el_access_token';
const SLUG_KEY = 'el_tenant_slug';
const NATIVE_WS_KEY = 'el_native_workspace';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
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
  } else {
    localStorage.setItem(NATIVE_WS_KEY, JSON.stringify(cfg));
    localStorage.setItem(SLUG_KEY, cfg.slug);
  }
}

export function getApiOrigin(): string {
  const native = getNativeWorkspace();
  if (native?.apiOrigin) return native.apiOrigin.replace(/\/$/, '');
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
}

export function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || null;
  const native = getNativeWorkspace();
  if (native?.slug) return native.slug;

  const host = window.location.hostname.toLowerCase();
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000').split(':')[0].toLowerCase();

  if (host.endsWith(`.${rootDomain}`)) {
    const sub = host.replace(`.${rootDomain}`, '');
    if (sub && sub !== 'www' && sub !== 'admin') return sub;
  }
  const stored = localStorage.getItem(SLUG_KEY);
  if (stored) return stored;

  if (host === 'localhost' || host === '127.0.0.1') {
    return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || 'almassa';
  }
  return null;
}

export function setTenantSlug(slug: string | null): void {
  if (typeof window === 'undefined') return;
  if (slug) localStorage.setItem(SLUG_KEY, slug);
  else localStorage.removeItem(SLUG_KEY);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function isNativeBuild(): boolean {
  return process.env.NEXT_PUBLIC_BUILD_TARGET === 'NATIVE';
}

export function dynamicHref(locale: string, basePath: string, id: string): string {
  if (isNativeBuild()) {
    return `/${locale}${basePath}/_?id=${encodeURIComponent(id)}`;
  }
  return `/${locale}${basePath}/${encodeURIComponent(id)}`;
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  slugOverride?: string;
  originOverride?: string;
  skipAuth?: boolean;
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const origin = (opts.originOverride || getApiOrigin()).replace(/\/$/, '');
  const headers: Record<string, string> = {};

  const slug = opts.slugOverride ?? getTenantSlug();
  if (slug) headers['X-Tenant-Slug'] = slug;

  const token = opts.skipAuth ? null : getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${origin}${path}`, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
  });

  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const json = await res.json();
      detail = json?.detail ?? json;
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

  const res = await fetch(`${origin}${path}`, { headers });
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
