# AI Coding Agent Rules (`CLAUDE.md` / `.cursorrules`)
**Project:** EventLedger (إيفنت ليدجر) — Multi-Tenant Venue, Wedding Hall & Conference SaaS ERP + Client Portal  
**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Alembic + Celery + WeasyPrint (`apps/api`) | Next.js 14 App Router + Tailwind + Shadcn/UI + `next-intl` + Konva.js (`apps/web`) | Tauri v2 (`apps/desktop`) | Capacitor 6 (`apps/mobile`)

---

## 1. Repository & Infrastructure Paths
- **Backend API:** `apps/api/` (FastAPI app in `apps/api/app/main.py`, SQLAlchemy models in `app/models/`, business logic in `app/services/`, routers in `app/routers/`, seed script in `apps/api/seed.py`).
- **Frontend Web:** `apps/web/` (Next.js 14 App Router in `apps/web/src/app/[locale]/`, shared UI in `apps/web/src/components/`).
- **Native Wrappers:** `apps/desktop/` (Tauri v2 `.exe`) and `apps/mobile/` (Capacitor 6 `.apk`).
- **Docker Infrastructure:** `infra/docker/docker-compose.yml` (start with `docker compose -f infra/docker/docker-compose.yml up -d`).
- **Specifications:**
  - Core architecture & `.env.example`: `docs/architecture/eventledger-complete-bundle.md`
  - Python models, services & routers: `docs/backend/`
  - Next.js branding, spotlight UI, Konva floor plan & mobile UX: `docs/frontend/`
  - Windows `.exe` & Android `.apk` packaging: `docs/mobile-desktop/`
  - Execution prompts: `docs/prompts/`
- **Do Not Use `archive/`:** Never use Prisma or TypeScript backend files from `archive/legacy-ts-packs/`; the backend MUST be pure Python FastAPI + SQLAlchemy.

---

## 2. Non-Negotiable Multi-Tenant & Security Rules
- **Strict Tenant Isolation:** Every tenant-owned database table MUST include `tenant_id`. Every SQLAlchemy query MUST filter by `tenant_id` resolved from `TenantResolverMiddleware` (subdomain `{slug}.*`, `Tenant.custom_domain`, or `X-Tenant-Slug` header for native apps) or the authenticated JWT (`current_user.tenant_id`).
- **Subdomain & Root Routing:**
  - `eventledger.cloud` / `eventledger.local` → SaaS Marketing Landing Page & Tenant Self-Onboarding (`PLATFORM_ROOT`).
  - `admin.eventledger.cloud` / `admin.eventledger.local` → SaaS Super-Admin Console (`PLATFORM_SUPER_ADMIN`).
  - `{slug}.eventledger.cloud` or `Tenant.custom_domain` → White-Label Tenant Hub (`/portal`, `/erp`, `/gate`).
- **No Raw SQL String Interpolation:** Always use SQLAlchemy ORM expressions or parameterized `text()` bindings.
- **Balanced Double-Entry Accounting:** Every `JournalEntry` created in `DoubleEntryService` MUST satisfy `abs(sum(debit) - sum(credit)) < Decimal("0.01")` inside a single async DB transaction. Refundable security deposits MUST post to Liability account `2100`, never Revenue `4000`.

---

## 3. Bilingual RTL / LTR & Responsive UI Rules
- **Always Support `ar` (RTL) and `en` (LTR):** Every page/layout accepting `locale` (`'ar' | 'en'`) MUST set `dir={locale === 'ar' ? 'rtl' : 'ltr'}` and use logical Tailwind spacing (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `text-end`).
- **Hover-Spotlight & White-Label Branding:** Wrap cards and section headings with `SpotlightCard` and `SpotlightHeading` (triggering brand glow on both `onMouseMove` and `onPointerDown`/`onTouchStart`), reading CSS variables (`--brand-primary`, `--brand-accent`, `--brand-glow`) from `ThemeBrandingProvider`.
- **Mobile-First Zero-Overflow:** Use `MobileBottomNav` on viewports `< 768px` and `ResponsiveDataList` so wide financial/booking tables render as stacked cards on phones.
- **Standardized Dropdowns & Lifecycle:** Use `SystemLookup` for configurable category/status dropdowns and enforce `RecordLifecycle` (`DRAFT`, `ACTIVE`, `ARCHIVED`, `DELETED`) on master records.
- **CSV & PDF Exports:** Always decode/encode CSVs with UTF-8 BOM (`utf-8-sig` / `\ufeff`) for Arabic Excel compatibility, and render bilingual RTL/LTR PDFs via WeasyPrint.

---

## 4. Verification Before Finishing Each Phase
- Preserve all files in `docs/`, `infra/`, and `archive/`.
- After backend edits, verify Alembic migrations and FastAPI startup (`uvicorn app.main:app --port 8000`).
- After frontend edits, verify TypeScript and Next.js build (`pnpm --filter web build` or `npm run build`).
