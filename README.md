# Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal
**Production Execution Index for AI Coding Agents**

This repository contains the complete architectural blueprints, database schemas, infrastructure configuration, backend services, and frontend UI modules required to build and launch the **Multi-Tenant Venue & Conference SaaS ERP + Client Portal**.

---

## 1. Repository & Blueprint File Map

Feed these specification files into your AI coding agent (`Cursor`, `Windsurf`, `Claude Code`, or `Devin`) in the following order:

| Order | File Name | Description & Target Directory |
| :--- | :--- | :--- |
| **1** | `docker-compose.yml` | Local PostgreSQL 16, Redis 7, and MinIO (S3) infrastructure. |
| **2** | `venue-erp-saas-blueprint-v2.md` | Master architecture, core `schema.prisma`, REST APIs, Omnichannel WhatsApp/In-App Comms, Event P&L, and Offline QR Gate Scanner specs. |
| **3** | `venue-erp-production-pack-v3.md` | Schema v3 extensions (`TenantBranding`, `SystemLookup`, Double-Entry `ChartOfAccount` / `JournalEntry`), NestJS `ApprovalsService`, `DoubleEntryService`, `CommsService`, and Item Lifecycle (`DRAFT`, `ACTIVE`, `ARCHIVED`, `DELETED`). |
| **4** | `venue-erp-domain-subdomain-landing-pack.md` | Root SaaS Marketing Landing Page (`yourdomain.com`), Wildcard Subdomain routing (`*.yourdomain.com`), Custom CNAME Domain support, Nginx reverse proxy, and Next.js/NestJS tenant resolvers. |
| **5** | `seed-v2.ts` & `venue-erp-import-export-accounting-pack.md` | Database seed scripts (`seed-v2.ts` + `seed-accounting.ts`), UTF-8 BOM CSV Bulk Importer (`import.service.ts`), and Bilingual Branded PDF Exporter (`pdf-export.service.ts`). |
| **6** | `venue-erp-frontend-theme-ledger-pack.md` | Global `ThemeBrandingProvider` (Dynamic Favicon, Light/Dark Mode, Mouse-Tracking Hover Spotlight), White-Label Branding Customizer, and Double-Entry Trial Balance UI. |
| **7** | `venue-erp-floorplan-canvas-pack.md` | Interactive `react-konva` Drag-and-Drop Floor Plan Designer with live seat/table capacity counters and draft approval submission. |

---

## 2. Quick-Start Local Setup

### Step 1: Start Database, Redis & S3 Storage
```bash
docker-compose up -d
```

### Step 2: Configure Environment Variables (`.env`)
```env
DATABASE_URL="postgresql://venue_admin:venue_secret_password@localhost:5432/venue_erp_db?schema=public"
REDIS_URL="redis://localhost:6379"
NEXT_PUBLIC_ROOT_DOMAIN="localhost:3000"
ROOT_DOMAIN="localhost:3000"
JWT_SECRET="replace-with-strong-secret-key"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minio_admin"
S3_SECRET_KEY="minio_secret_password"
S3_BUCKET="venue-erp-assets"
```

### Step 3: Run Prisma Migrations & Seed Data
```bash
pnpm install
npx prisma migrate dev --name init_enterprise_venue_erp
npx ts-node packages/database/prisma/seed-v2.ts
```

### Step 4: Local Subdomain Testing
Add test entries to your OS `hosts` file (`/etc/hosts` on Linux/macOS or `C:\Windows\System32\drivers\etc\hosts` on Windows):
```text
127.0.0.1 yourdomain.local
127.0.0.1 admin.yourdomain.local
127.0.0.1 almassa.yourdomain.local
```
* **SaaS Landing Page:** `http://yourdomain.local:3000/ar`
* **Super-Admin Console:** `http://admin.yourdomain.local:3000/ar`
* **Tenant Portal & ERP:** `http://almassa.yourdomain.local:3000/ar/portal/dashboard` and `/ar/erp/dashboard`

---

## 3. Master Coding Agent Execution Checklist

- [ ] **Phase 1 (Core & Tenancy):** Initialize Turborepo (`apps/api` NestJS + `apps/web` Next.js 14 + `packages/database` Prisma), merge `schema.prisma` (v2 + v3 extensions), and wire `TenantResolverMiddleware` + Next.js subdomain `middleware.ts`.
- [ ] **Phase 2 (Auth & Client Control Panel):** Build OTP/2FA JWT auth, B2C/B2B profiles, sub-user delegation (`CO_HOST`, `WEDDING_PLANNER`, `VENDOR`), and the `SaaS Landing Page` self-onboarding endpoint.
- [ ] **Phase 3 (Bookings, Drafts & Approvals):** Implement partitionable hall availability checks, Redis 48h holds, `PricingRule` dynamic quotes, `EventDraft` lockout windows, and `ApprovalsService` Cross-ERP sync.
- [ ] **Phase 4 (Double-Entry Finance & Imports/Exports):** Wire `DoubleEntryService` auto-posting on payment verification, security deposit liability tracking, Event P&L calculation, UTF-8 CSV bulk imports, and Puppeteer bilingual PDF exports.
- [ ] **Phase 5 (UI Theme, Floor Plan & Offline PWA):** Apply `ThemeBrandingProvider` (dynamic favicon, Dark/Light mode, mouse-tracking `SpotlightCard` & `SpotlightHeading`), `FloorPlanCanvas`, WhatsApp Cloud API webhooks, and the IndexedDB offline Security Gate QR scanner.
