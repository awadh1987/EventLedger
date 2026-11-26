# Multi-Tenant Domain, Subdomain Routing & SaaS Landing Page Architecture
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Stack:** Next.js 14+ Middleware, NestJS Tenant Resolver Guard, Nginx / Cloudflare Wildcard DNS (`*.yourdomain.com`), Bilingual RTL/LTR (`ar` / `en`)

---

## 1. Domain & Subdomain Routing Topology

The platform operates across **three distinct routing surfaces** powered by a single Next.js + NestJS deployment:

| Host / URL Pattern | Resolved Context | Target Route Group | Purpose |
| :--- | :--- | :--- | :--- |
| `yourdomain.com` or `www.yourdomain.com` | `PLATFORM_ROOT` | `app/[locale]/(marketing)/` | **SaaS Marketing Landing Page**, pricing plans, demo booking, and Tenant Self-Signup (`Create Your Venue Portal`). |
| `admin.yourdomain.com` | `PLATFORM_SUPER_ADMIN` | `app/[locale]/(super-admin)/` | **SaaS Super-Admin Console** to approve new venues, manage subscriptions, and monitor WhatsApp/SMS quotas. |
| `{tenantSlug}.yourdomain.com` (e.g., `almassa.yourdomain.com`) | `TENANT_WORKSPACE` | `app/[locale]/(tenant)/` | **Tenant White-Label Hub**: Public hall showcase + instant quote calculator (`/book`), Client Control Panel (`/portal`), Internal ERP (`/erp`), and Offline Gate Scanner (`/gate`). |
| `events.almassa.ye` (Custom CNAME Domain) | `TENANT_CUSTOM_DOMAIN` | `app/[locale]/(tenant)/` | Maps enterprise tenant custom domains directly to their `tenantId` via `Tenant.customDomain`. |

---

## 2. DNS, SSL & Reverse Proxy Configuration (Cloudflare + Nginx)

### 2.1 DNS Records (Cloudflare / Domain Registrar)
1. **`A` Record:** `@` (`yourdomain.com`) → `YOUR_SERVER_IP` (Proxied / SSL Full Strict)
2. **`A` Record:** `*` (`*.yourdomain.com`) → `YOUR_SERVER_IP` (Wildcard subdomain routing for all tenants)
3. **Enterprise Custom Domains:** Tenants point their custom domain (`booking.almassa.ye`) via a `CNAME` record to `cname.yourdomain.com`, with automated SSL issued via Caddy or Cloudflare for SaaS.

### 2.2 Nginx Wildcard Reverse Proxy (`nginx/conf.d/venue-saas.conf`)
```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name yourdomain.com *.yourdomain.com;

    # Wildcard SSL Certificate (*.yourdomain.com)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    client_max_body_size 25M; # For logos, favicons, and payment transfer receipts

    # Backend NestJS API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Frontend Next.js App (Marketing + Tenant Portals + ERP)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 3. Next.js Edge Middleware for Subdomain & Custom Domain Resolution (`apps/web/src/middleware.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';

const intlMiddleware = createIntlMiddleware({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
});

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'yourdomain.com';

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const hostname = req.headers.get('host') || '';
  const cleanHost = hostname.replace(/:\d+$/, '').toLowerCase();

  // 1. Root SaaS Marketing Landing Page (yourdomain.com or www.yourdomain.com)
  if (cleanHost === ROOT_DOMAIN || cleanHost === `www.${ROOT_DOMAIN}`) {
    const res = intlMiddleware(req);
    res.headers.set('x-domain-context', 'PLATFORM_ROOT');
    return res;
  }

  // 2. SaaS Platform Super-Admin (admin.yourdomain.com)
  if (cleanHost === `admin.${ROOT_DOMAIN}`) {
    const res = intlMiddleware(req);
    res.headers.set('x-domain-context', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  // 3. Tenant Subdomain ({slug}.yourdomain.com) or Enterprise Custom Domain
  let tenantSlug = '';
  let customDomain = '';

  if (cleanHost.endsWith(`.${ROOT_DOMAIN}`)) {
    tenantSlug = cleanHost.replace(`.${ROOT_DOMAIN}`, '');
  } else {
    customDomain = cleanHost;
  }

  const res = intlMiddleware(req);
  res.headers.set('x-domain-context', 'TENANT_WORKSPACE');
  if (tenantSlug) res.headers.set('x-tenant-slug', tenantSlug);
  if (customDomain) res.headers.set('x-tenant-custom-domain', customDomain);

  return res;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

---

## 4. NestJS Tenant Resolver Middleware (`apps/api/src/common/middleware/tenant-resolver.middleware.ts`)

Automatically resolves `req.tenant` on every incoming API call from `x-tenant-slug`, `x-tenant-custom-domain`, or the `Host` header:

```typescript
import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const rootDomain = process.env.ROOT_DOMAIN || 'yourdomain.com';
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    const cleanHost = hostHeader.replace(/:\d+$/, '').toLowerCase();

    // Skip resolution for root platform or super-admin endpoints
    if (
      cleanHost === rootDomain ||
      cleanHost === `www.${rootDomain}` ||
      cleanHost === `admin.${rootDomain}`
    ) {
      return next();
    }

    const slugHeader = req.headers['x-tenant-slug'] as string | undefined;
    const customDomainHeader = req.headers['x-tenant-custom-domain'] as string | undefined;

    let tenant = null;

    if (slugHeader) {
      tenant = await this.prisma.tenant.findUnique({
        where: { slug: slugHeader },
        include: { branding: true },
      });
    } else if (customDomainHeader || cleanHost) {
      const domainToLookup = customDomainHeader || cleanHost;
      if (domainToLookup.endsWith(`.${rootDomain}`)) {
        const derivedSlug = domainToLookup.replace(`.${rootDomain}`, '');
        tenant = await this.prisma.tenant.findUnique({
          where: { slug: derivedSlug },
          include: { branding: true },
        });
      } else {
        tenant = await this.prisma.tenant.findUnique({
          where: { customDomain: domainToLookup },
          include: { branding: true },
        });
      }
    }

    if (!tenant || !tenant.isActive) {
      throw new NotFoundException('Venue workspace not found or inactive');
    }

    (req as any).tenant = tenant;
    (req as any).tenantId = tenant.id;
    next();
  }
}
```

---

## 5. SaaS Landing Page & Tenant Self-Onboarding (`apps/web/src/app/[locale]/(marketing)/page.tsx`)

Includes a bilingual RTL/LTR **SaaS Landing Page** on `yourdomain.com` with **Hover-Spotlight Cards**, **Subscription Tier Comparison (`BASIC`, `PRO`, `ENTERPRISE`)**, and an **Instant Subdomain Provisioning Form** that creates a new venue tenant, seeds its Chart of Accounts, and redirects immediately to `{slug}.yourdomain.com/erp`:

```tsx
'use client';

import React, { useState } from 'react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export default function SaasLandingPage({ locale }: { locale: 'ar' | 'en' }) {
  const isRtl = locale === 'ar';
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'yourdomain.com';

  const [form, setForm] = useState({
    venueName: '',
    slug: '',
    ownerName: '',
    phone: '',
    email: '',
    plan: 'PRO',
  });
  const [creating, setCreating] = useState(false);

  const handleSlugChange = (val: string) => {
    const sanitized = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setForm((prev) => ({ ...prev, slug: sanitized }));
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/v1/public/tenants/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setCreating(false);

    if (data?.slug) {
      window.location.href = `https://${data.slug}.${rootDomain}/${locale}/erp/dashboard`;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Hero Section */}
      <header className="mx-auto max-w-6xl px-6 py-16 text-center">
        <span className="inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
          {isRtl ? 'النظام السحابي المتكامل لإدارة القاعات والمؤتمرات' : 'All-in-One Venue, Wedding Hall & Conference Cloud ERP'}
        </span>

        <div className="mt-4">
          <SpotlightHeading as="h1" className="text-3xl sm:text-5xl">
            {isRtl
              ? 'أدِر حجوزات صالتك، ماليتك، وعملاءك من منصة واحدة ذكية'
              : 'Run Your Venue Bookings, Double-Entry Finance & Client Portal in One Place'}
          </SpotlightHeading>
        </div>

        <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-600 dark:text-slate-400 sm:text-base">
          {isRtl
            ? 'منع تضارب المواعيد، بوابة عملاء تفاعلية لتوزيع الطاولات، نظام مسودات واعتمادات متعدد المستويات، ربط واتساب، ومحاسبة قيد مزدوج متكاملة.'
            : 'Zero double-bookings, interactive drag-and-drop floor plan client portal, multi-tier approval workflows, WhatsApp sync, and double-entry accounting.'}
        </p>
      </header>

      {/* Instant Subdomain Onboarding Card */}
      <section className="mx-auto max-w-2xl px-6 pb-20">
        <SpotlightCard className="p-6 sm:p-8">
          <SpotlightHeading as="h2" className="mb-2 text-xl">
            {isRtl ? 'أنشئ منصة صالتك الخاصة خلال ثوانٍ' : 'Launch Your Branded Venue Portal in Seconds'}
          </SpotlightHeading>
          <p className="mb-6 text-xs text-slate-500">
            {isRtl
              ? 'سيتم تجهيز نطاقك الفرعي، دليل الحسابات، وبوابة العملاء تلقائياً'
              : 'Your custom subdomain, chart of accounts, and client portal will be provisioned automatically.'}
          </p>

          <form onSubmit={handleCreateTenant} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold">
                {isRtl ? 'اسم الصالة / المؤسسة' : 'Venue / Organization Name'}
              </label>
              <input
                required
                value={form.venueName}
                onChange={(e) => setForm({ ...form, venueName: e.target.value })}
                placeholder={isRtl ? 'مثال: قصر الماسة للمؤتمرات والأفراح' : 'e.g., Al-Massa Grand Palace'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold">
                {isRtl ? 'رابط النطاق الفرعي الخاص بصالتك (Subdomain)' : 'Your Venue Subdomain'}
              </label>
              <div className="flex items-center overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700" dir="ltr">
                <input
                  required
                  value={form.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="almassa"
                  className="w-full bg-white px-3 py-2 text-sm outline-none dark:bg-slate-900"
                />
                <span className="bg-slate-100 px-3 py-2 text-xs font-mono text-slate-500 dark:bg-slate-800">
                  .{rootDomain}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'اسم المدير / المالك' : 'Owner Full Name'}
                </label>
                <input
                  required
                  value={form.ownerName}
                  onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'رقم الجوال (واتساب)' : 'Mobile Number (WhatsApp)'}
                </label>
                <input
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+967770000000"
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold">
                {isRtl ? 'الباقة المطلوبة (Subscription Plan)' : 'Select SaaS Plan'}
              </label>
              <select
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="BASIC">{isRtl ? 'الباقة الأساسية (قاعة واحدة)' : 'Basic Plan (1 Hall)'}</option>
                <option value="PRO">{isRtl ? 'الباقة الاحترافية (حتى 5 قاعات + واتساب)' : 'Pro Plan (Up to 5 Halls + WhatsApp)'}</option>
                <option value="ENTERPRISE">{isRtl ? 'باقة المؤسسات (قاعات غير محدودة + نطاق خاص)' : 'Enterprise (Unlimited + Custom Domain)'}</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-3 text-sm font-bold text-slate-950 shadow-md transition hover:opacity-90"
            >
              {creating
                ? isRtl
                  ? 'جاري تجهيز المنصة والنطاق الفرعي...'
                  : 'Provisioning Workspace & Subdomain...'
                : isRtl
                ? 'إطلاق منصة صالتي الآن 🚀'
                : 'Launch My Venue Workspace 🚀'}
            </button>
          </form>
        </SpotlightCard>
      </section>
    </div>
  );
}
```
