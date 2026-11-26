# EventLedger (إيفنت ليدجر) — Python + Next.js Master Execution Prompts
**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Alembic + Celery + WeasyPrint | Next.js 14 (App Router, Tailwind, Shadcn/UI, `next-intl` RTL/LTR, `react-konva`)

---

## 1. Exact Repository File Map (Save These Files in Your IDE Root)
```text
eventledger-saas/
├── CLAUDE.md                                 # AI Agent architecture & security rules
├── docker-compose.yml                        # PostgreSQL 16, Redis 7, MinIO (S3)
├── PYTHON_MASTER_PROMPT.md                   # This execution guide
└── docs/
    ├── eventledger-complete-bundle.md        # Master architecture, .env.example & domain specs
    ├── eventledger-python-fastapi-pack.md    # SQLAlchemy 2.0 models, DoubleEntryService & TenantResolverMiddleware
    ├── eventledger-python-services-pack.md   # ApprovalsService, ImportExportService (CSV/WeasyPrint) & seed.py
    ├── eventledger-python-routers-pack.md    # FastAPI routers (public_onboarding, approvals, finance) & main.py
    └── eventledger-nextjs-frontend-pack.md   # Next.js middleware.ts, ThemeBrandingProvider, Spotlight UI & FloorPlanCanvas
```

---

## 2. Sequential Copy-Paste Prompts for Your AI Coding Agent

Run these **6 prompts one by one** in Cursor, Claude Code, Windsurf, or Devin. Verify each phase compiles cleanly before starting the next.

### Phase 1: Monorepo Setup, Python FastAPI Core, SQLAlchemy Models & Seed
> "Read `CLAUDE.md`, `docker-compose.yml`, `docs/eventledger-complete-bundle.md`, `docs/eventledger-python-fastapi-pack.md`, `docs/eventledger-python-services-pack.md`, and `docs/eventledger-python-routers-pack.md`. Initialize the **EventLedger (إيفنت ليدجر)** monorepo with:
> 1. `apps/api`: Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async with `asyncpg`) + Alembic + Pydantic v2 + Celery + Redis + WeasyPrint + Boto3. Create `pyproject.toml`, `.env` (from `.env.example` in `docs/eventledger-complete-bundle.md`), `app/core/config.py`, `app/core/database.py`, `app/core/tenant_middleware.py`, all SQLAlchemy models in `app/models/`, `app/services/`, `app/routers/`, `app/main.py`, and `apps/api/seed.py`.
> 2. `apps/web`: Next.js 14 (App Router, TypeScript, Tailwind CSS, Shadcn/UI, `next-intl` supporting Arabic `dir="rtl"` and English `dir="ltr"`, `next-themes`, `react-konva`).
> Start Docker services (`docker-compose up -d`), generate and apply the initial Alembic migration, run `python seed.py` to seed the `almassa` tenant, and verify both `uvicorn app.main:app` and `pnpm --filter web build` succeed."

### Phase 2: Subdomain Routing, SaaS Landing Page & Self-Onboarding
> "Read `docs/eventledger-complete-bundle.md`, `docs/eventledger-python-routers-pack.md`, and `docs/eventledger-nextjs-frontend-pack.md`.
> 1. Wire `apps/web/src/middleware.ts` to route `eventledger.local` / `eventledger.cloud` to the SaaS Marketing Landing Page (`app/[locale]/(marketing)/page.tsx`), `admin.*` to the Super-Admin Console (`app/[locale]/(super-admin)/`), and `{slug}.*` + `Tenant.custom_domain` to Tenant Workspaces.
> 2. Build the bilingual RTL/LTR SaaS Landing Page with pricing tiers (`BASIC`, `PRO`, `ENTERPRISE`) and a self-onboarding form wired to `POST /api/v1/public/tenants/register` that provisions a new venue subdomain, seeds its default Chart of Accounts, and redirects the owner to their workspace."

### Phase 3: JWT + 2FA OTP Auth, RBAC & Client Account Control Panel
> "Read `CLAUDE.md` and `docs/eventledger-python-fastapi-pack.md`.
> 1. Implement JWT + 2FA OTP authentication in `apps/api/app/core/security.py` and `apps/api/app/routers/auth.py` supporting `SUPER_ADMIN`, `INTERNAL_STAFF` (`OWNER`, `SALES_MANAGER`, `SALES_REP`, `FINANCE`, `OPS_MANAGER`, `HEAD_CHEF`, `SECURITY`), `CLIENT_PRIMARY` (`INDIVIDUAL_B2C` and `CORPORATE_B2B` profiles), `CLIENT_DELEGATE` (`CO_HOST`, `WEDDING_PLANNER`, `VENDOR`), and `EXTERNAL_VENDOR`. Enforce strict `tenant_id` isolation on every endpoint.
> 2. Build the Client Account Control Panel (`apps/web/src/app/[locale]/portal/dashboard/page.tsx`) with sub-user delegation permission toggles, B2C/B2B tax/ID profiles, refund bank/e-wallet details (e.g. Kuraimi/Jaib/IBAN), and the immutable `AuditLog` viewer."

### Phase 4: Smart Availability, Dynamic Pricing, Celery 48h Holds & Cross-ERP Approvals
> "Read `docs/eventledger-python-fastapi-pack.md`, `docs/eventledger-python-services-pack.md`, and `docs/eventledger-python-routers-pack.md`.
> 1. Build `apps/api/app/services/availability_service.py` and `apps/api/app/routers/bookings.py` with partition-hall conflict detection (`combinable_with_hall_id`), cleaning buffers (`cleaning_buffer_minutes`), `PricingRule` weekend/seasonal multipliers, and a Celery background task (`apps/api/app/workers/celery_tasks.py`) that automatically expires unpaid `HOLD_48H` tentative bookings after 48 hours.
> 2. Connect the `ApprovalsService` endpoints so approved drafts emit Cross-ERP updates to Finance invoices, Inventory allocations, and the live Banquet Event Order (BEO)."

### Phase 5: White-Label Branding, Hover-Spotlight UI & Konva Floor Plan Designer
> "Read `docs/eventledger-nextjs-frontend-pack.md`.
> 1. Wrap `apps/web/src/app/[locale]/layout.tsx` with `ThemeBrandingProvider` (injecting dynamic Favicon, CSS brand variables, and Light/Dark/System themes) and apply `SpotlightCard` and `SpotlightHeading` across all dashboards, cards, headings, and dropdown menus so moving the mouse illuminates borders and surfaces.
> 2. Build the Tenant Branding Customizer (`/erp/settings/branding`) and integrate `FloorPlanCanvas.tsx` inside `/portal/events/[id]/floor-plan` wired to `POST /api/v1/events/{event_id}/drafts` and `POST /api/v1/drafts/{draft_id}/submit`."

### Phase 6: Double-Entry Ledger UI, CSV/PDF Import-Export, WhatsApp Comms & Offline Gate PWA
> "Read `docs/eventledger-python-services-pack.md`, `docs/eventledger-python-routers-pack.md`, and `docs/eventledger-complete-bundle.md`.
> 1. Build the Double-Entry Trial Balance & Journal Entry UI (`/erp/finance/ledger`), Event Profit & Loss view (`/erp/finance/events/[id]/pnl`), UTF-8 BOM CSV Bulk Importer modal (Guest Lists, Inventory, Chart of Accounts), and WeasyPrint Bilingual PDF Invoice/BEO download buttons.
> 2. Build `CommsService` (`apps/api/app/services/comms_service.py`) with the unified `EventMessage` chat thread, two-way WhatsApp Business Cloud API webhooks, the live Kitchen/Ops BEO tablet screen (`/erp/ops/beo`), and the offline-capable PWA Security Gate QR Scanner (`/gate/scanner`) using IndexedDB."
