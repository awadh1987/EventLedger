Master 8-Phase Execution Prompt for EventLedger (إيفنت ليدجر) covering the Python 3.12 + FastAPI backend, Next.js 14 bilingual RTL/LTR frontend, Mobile Responsive UI/UX, Standalone Windows Desktop (.exe via Tauri v2), and Android Mobile/Tablet (.apk via Capacitor 6).
________________________________________
Step 1: Confirm Your Repository File Layout
Make sure these files are saved in your workspace before pasting the prompts into Cursor, Claude Code, Windsurf, or Devin:
 
________________________________________
Step 2: Run These 8 Sequential Prompts in Your Coding Agent
Paste one phase at a time and wait for each phase to finish and pass build checks before starting the next.
Phase 1: Monorepo Setup, Python FastAPI Core, SQLAlchemy Models & Seed
"Read CLAUDE.md, docker-compose.yml, docs/eventledger-complete-bundle.md, docs/eventledger-python-fastapi-pack.md, docs/eventledger-python-services-pack.md, and docs/eventledger-python-routers-pack.md. Initialize the EventLedger (إيفنت ليدجر) monorepo with:
1.	apps/api: Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async with asyncpg) + Alembic + Pydantic v2 + Celery + Redis + WeasyPrint + Boto3. Extract .env.example from docs/eventledger-complete-bundle.md to .env, create app/core/config.py, app/core/database.py, app/core/tenant_middleware.py (supporting both subdomain {slug}.* / custom_domain and X-Tenant-Slug header for native apps), all SQLAlchemy models in app/models/, app/services/, app/routers/, app/main.py, and apps/api/seed.py.
2.	apps/web: Next.js 14 (App Router, TypeScript, Tailwind CSS, Shadcn/UI, next-intl supporting Arabic dir="rtl" and English dir="ltr", next-themes, react-konva).
Start Docker services (docker-compose up -d), generate and run Alembic migrations, run python seed.py to populate the almassa tenant, and verify both uvicorn app.main:app and pnpm --filter web build succeed."
Phase 2: Subdomain Routing, SaaS Landing Page & Self-Onboarding
"Read docs/eventledger-complete-bundle.md, docs/eventledger-python-routers-pack.md, and docs/eventledger-nextjs-frontend-pack.md.
1.	Implement apps/web/src/middleware.ts to route eventledger.local / eventledger.cloud to the SaaS Marketing Landing Page (app/[locale]/(marketing)/page.tsx), admin.* to the Super-Admin Console (app/[locale]/(super-admin)/), and {slug}.* + Tenant.custom_domain to Tenant Workspaces.
2.	Build the bilingual RTL/LTR SaaS Landing Page with pricing tiers (BASIC, PRO, ENTERPRISE) and a self-onboarding form wired to POST /api/v1/public/tenants/register that provisions a new venue subdomain, seeds its default double-entry Chart of Accounts, creates the OWNER account, and redirects to the workspace."
Phase 3: JWT + 2FA OTP Auth, RBAC & Client Account Control Panel
"Read CLAUDE.md and docs/eventledger-python-fastapi-pack.md.
1.	Implement JWT + 2FA OTP authentication in apps/api/app/core/security.py and apps/api/app/routers/auth.py supporting SUPER_ADMIN, INTERNAL_STAFF (OWNER, SALES_MANAGER, SALES_REP, FINANCE, OPS_MANAGER, HEAD_CHEF, SECURITY), CLIENT_PRIMARY (INDIVIDUAL_B2C and CORPORATE_B2B profiles), CLIENT_DELEGATE (CO_HOST, WEDDING_PLANNER, VENDOR), and EXTERNAL_VENDOR. Enforce strict tenant_id isolation on every endpoint.
2.	Build the Client Account Control Panel (apps/web/src/app/[locale]/portal/dashboard/page.tsx) with sub-user delegation permission toggles, B2C/B2B tax/ID profiles, refund bank/e-wallet details (Kuraimi, Jaib, Jawali, OneCash, IBAN), and the immutable AuditLog viewer."
Phase 4: Smart Availability, Dynamic Pricing, Celery 48h Holds & Cross-ERP Approvals
"Read docs/eventledger-python-fastapi-pack.md, docs/eventledger-python-services-pack.md, and docs/eventledger-python-routers-pack.md.
1.	Build apps/api/app/services/availability_service.py and apps/api/app/routers/bookings.py with partition-hall conflict detection (combinable_with_hall_id), cleaning buffers (cleaning_buffer_minutes), PricingRule weekend/seasonal multipliers, and a Celery background task (apps/api/app/workers/celery_tasks.py) that automatically expires unpaid HOLD_48H tentative bookings after 48 hours.
2.	Connect the ApprovalsService endpoints so approved drafts emit Cross-ERP updates to Finance invoices, payment milestones, Inventory allocations, and the live Banquet Event Order (BEO)."
Phase 5: White-Label Branding, Hover-Spotlight UI & Konva Floor Plan Designer
"Read docs/eventledger-nextjs-frontend-pack.md.
1.	Wrap apps/web/src/app/[locale]/layout.tsx with ThemeBrandingProvider (injecting dynamic Favicon, CSS brand variables --brand-primary, --brand-accent, --brand-glow, and Light/Dark/System themes) and apply SpotlightCard and SpotlightHeading across all dashboards, cards, headings, and dropdown menus so moving the cursor illuminates borders and surfaces.
2.	Build the Tenant Branding Customizer (/erp/settings/branding), standardized SystemLookup dropdown lists across all forms, and integrate FloorPlanCanvas.tsx inside /portal/events/[id]/floor-plan wired to POST /api/v1/events/{event_id}/drafts and POST /api/v1/drafts/{draft_id}/submit."
Phase 6: Double-Entry Ledger UI, Event P&L, CSV Import, PDF Export & WhatsApp Comms
"Read docs/eventledger-python-services-pack.md, docs/eventledger-python-routers-pack.md, and docs/eventledger-complete-bundle.md.
1.	Build the Double-Entry Trial Balance & Journal Entry UI (/erp/finance/ledger), Event Profit & Loss dashboard (/erp/finance/events/[id]/pnl), UTF-8 BOM CSV Bulk Importer modal (Guest Lists, Inventory, Chart of Accounts), and WeasyPrint Bilingual PDF Invoice/BEO download buttons.
2.	Build CommsService (apps/api/app/services/comms_service.py) with the unified EventMessage chat thread (supporting @Department tags and is_internal staff notes), two-way WhatsApp Business Cloud API webhooks, and the live Kitchen/Ops BEO tablet view (/erp/ops/beo)."
Phase 7: Mobile Responsive UI/UX & Touch Ergonomics
"Read docs/eventledger-mobile-responsive-ux-pack.md.
1.	Implement MobileBottomNav.tsx (with safe-area insets and role-adaptive tabs for CLIENT, ERP_STAFF, and SECURITY_GATE) and ResponsiveDataList.tsx across all financial ledgers, event schedules, and approval queues so zero tables overflow horizontally on mobile viewports (< 768px).
2.	Update SpotlightCard and SpotlightHeading to trigger brand glow on onPointerDown/onTouchStart, make FloorPlanCanvas.tsx responsive via ResizeObserver with pinch-zoom and a mobile bottom action sheet, and add direct camera receipt capture (capture="environment") plus one-tap account number copy on payment milestone cards."
Phase 8: Standalone Windows Desktop (.exe) & Android Mobile (.apk) Packaging
"Read docs/eventledger-desktop-mobile-pack.md.
1.	Configure dual-mode builds in apps/web/next.config.mjs (BUILD_TARGET=NATIVE), add WorkspaceConnectScreen.tsx so native apps can connect to either https://{slug}.eventledger.cloud or a local venue LAN IP (http://192.168.x.x:8000), and register apps/api/app/routers/offline_sync.py (GET /api/v1/sync/manifest and POST /api/v1/sync/batch).
2.	Initialize apps/desktop with Tauri v2 (SQLite plugin + Windows NSIS .exe installer config) and apps/mobile with Capacitor 6 (Android Gradle project + @capacitor-mlkit/barcode-scanning for offline Security Gate QR check-ins + SQLite offline queue), and add root scripts pnpm build:exe and pnpm build:apk. Verify all builds pass cleanly."
You now have the complete, end-to-end EventLedger (إيفنت ليدجر) specification and all 8 execution prompts ready to paste into your coding agent. Whenever your agent finishes a phase or needs help debugging any step, paste the logs here and we will take it from there.

