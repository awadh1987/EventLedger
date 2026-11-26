```markdown
# EventLedger (إيفنت ليدجر) — Multi-Phase Coding Agent Execution Guide
**File Path:** `docs/04-multi-phase-agent-execution-prompt.md`  
**Target Agents:** Cursor, Claude Code, Windsurf, Devin  
**Scope:** End-to-End Implementation & Verification of Both **Ecosystem Tier 1 (EventLedger SaaS & Venue Tenants)** and **Ecosystem Tier 2 (`<slug>` Venues & End Clients)**

---

## Step 1: Confirm Saved Architecture & Code Packs in `docs/`
Before pasting the prompts below into your coding agent, verify that these files exist in your repository:
- `CLAUDE.md`
- `docs/01-dual-ecosystem-architecture-and-models.md`
- `docs/02-backend-fastapi-engines-and-routers.md`
- `docs/03-frontend-nextjs-dual-portal-pack.md`
- `docs/04-multi-phase-agent-execution-prompt.md` (this file)

---

## Step 2: Execute These 6 Sequential Prompts (One Phase at a Time)
Paste **one phase prompt at a time** into your coding agent. Wait for each phase to finish and pass its verification check before moving to the next.

### Phase 1: Dual-Ecosystem Database Extensions, Migrations & Seed Parity
```text
Read CLAUDE.md, docs/01-dual-ecosystem-architecture-and-models.md, and docs/02-backend-fastapi-engines-and-routers.md.
1. Update apps/api/app/models/tenant.py with SubscriptionStatus, custom_domain_verified, trial_ends_at, max_halls, monthly_whatsapp_quota, whatsapp_used_this_month, and bilingual hero_tagline_ar/en fields.
2. Create apps/api/app/models/events_extensions.py implementing EventContract, EventGuest, and DamageInspection, and import them in apps/api/alembic/env.py and apps/api/seed.py.
3. Update apps/api/seed.py so that running `python seed.py` also creates the initial EventContract, sample EventGuests with QR GatePasses, and posts balanced Double-Entry JournalEntries for the seeded 787,500 paid milestone and 150,000 Liability 2100 security deposit so the Trial Balance shows live non-zero balances.
4. Run `python seed.py` against local SQLite or PostgreSQL and verify `pytest` passes with zero errors.

```

### Phase 2: Tier 1 Super-Admin Router, Partition Reservation Engine & Lifecycle Ops APIs

```text
Read docs/02-backend-fastapi-engines-and-routers.md.
1. Create apps/api/app/routers/admin.py implementing GET /api/v1/public/tenants/{slug}, GET /api/v1/admin/tenants, and PATCH /api/v1/admin/tenants/{tenant_id}.
2. Upgrade apps/api/app/routers/bookings.py with GET /api/v1/public/halls/availability (returning occupied_slots, partition-hall merge bundle quotes, and catering totals) and POST /api/v1/bookings/hold (creating/reusing CLIENT_PRIMARY, Event, Invoice, split PaymentMilestones, EventContract, AuditLog, and Redis/Celery 48h expiry).
3. Create apps/api/app/routers/lifecycle_ops.py implementing POST /api/v1/portal/events/{event_id}/contract/sign, POST /api/v1/portal/events/{event_id}/guests, PATCH /api/v1/erp/finance/milestones/{milestone_id}/verify (with automatic DoubleEntryService journal posting), and POST /api/v1/erp/ops/events/{event_id}/inspection.
4. Register admin.router and lifecycle_ops.router in apps/api/app/main.py and verify `uvicorn app.main:app` boots cleanly with all endpoints visible in /docs.

```

### Phase 3: `<slug>` Path/Subdomain Middleware, Auth Session (`Logout`) & Role-Aware Navigation

```text
Read docs/01-dual-ecosystem-architecture-and-models.md and docs/03-frontend-nextjs-dual-portal-pack.md.
1. Update apps/web/src/middleware.ts to support both wildcard subdomains ({slug}.eventledger.local / custom domains) AND path-based tenant prefixes (/[locale]/t/[slug]/...) by rewriting to /[locale]/... while setting x-tenant-slug and x-tenant-mode headers.
2. Update apps/web/src/lib/api.ts to automatically attach X-Tenant-Slug (from /t/[slug], subdomain, or localStorage) and Authorization Bearer tokens on every request.
3. Update apps/web/src/components/providers/auth-provider.tsx and apps/web/src/components/layout/AppHeader.tsx to:
   - Separate Public SaaS Marketing links (Capabilities, Pricing, Venue Booking, Live ERP) from authenticated Tenant Portal/ERP links.
   - Display the active <slug> workspace switcher dropdown.
   - Display the authenticated user's name/role badge and a working Logout button that clears localStorage and redirects to /[locale]/login.
   - Guard theme icon rendering behind a `mounted` state so SSR hydration produces zero errors.
4. Verify `npm --prefix apps/web run build` passes with zero TypeScript errors.

```

### Phase 4: Tier 1 SaaS Landing Page Sandbox, Multi-Currency Pricing & Super-Admin Console

```text
Read docs/03-frontend-nextjs-dual-portal-pack.md.
1. Update apps/web/src/app/[locale]/(marketing)/page.tsx with:
   - Interactive Capabilities Sandbox tabs (Partition Booking Engine, Client Portal & Floor Plan, Double-Entry & Deposit Vault).
   - Multi-currency SaaS Pricing Tiers (USD, SAR, YER) synced to the selected plan in the onboarding form.
   - 1-Click Venue Self-Onboarding wired to POST /api/v1/public/tenants/register, redirecting immediately to /[locale]/t/{slug}/erp/dashboard.
2. Build apps/web/src/app/[locale]/admin/page.tsx (Platform Super-Admin Console) wired to GET /api/v1/admin/tenants and PATCH /api/v1/admin/tenants/{id} to manage tenant activation, subscription plans, custom CNAME domains, and GMV metrics.
3. Verify both `/ar` and `/en` render cleanly in RTL and LTR with logical Tailwind CSS (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `text-end`).

```

### Phase 5: Tier 2 `<slug>` Venue Storefront Booking Engine & Complete 6-Tab Client Control Panel

```text
Read docs/01-dual-ecosystem-architecture-and-models.md and docs/03-frontend-nextjs-dual-portal-pack.md.
1. Upgrade apps/web/src/app/[locale]/venue/page.tsx into a full white-label `<slug>` storefront featuring hall selection cards, Partition-Hall Merge toggle (15% bundle discount), Dynamic Quote calculator, 1-Click 48-Hour Tentative Hold checkout form, and live occupied calendar slots.
2. Upgrade apps/web/src/app/[locale]/portal/dashboard/page.tsx to include all 6 Client Control Panel modules:
   - Active Event Switcher + Event Countdown & Lockout Window banners (72h Catering Lock / 24h Floor Plan Lock) + Pending Delegate Approval banner.
   - Digital Contract Viewer & E-Signature pad wired to POST /api/v1/portal/events/{id}/contract/sign.
   - Payment Milestones with one-tap bank/e-wallet copy (Kuraimi, Jaib, Jawali, OneCash), camera receipt upload (`capture="environment"`), and Security Deposit Vault status tracker.
   - Guest List & Auto QR Pass generator wired to POST /api/v1/portal/events/{id}/guests.
   - Sub-User Delegation (Co-Host, Wedding Planner, External Vendor) with granular permission switches.
   - Unified Event Chat Thread & Immutable AuditLog viewer.

```

### Phase 6: Internal ERP Master Gantt, Split-Screen Approval Diff Queue, Receipt Verification & Gate Manifest

```text
Read docs/01-dual-ecosystem-architecture-and-models.md and docs/02-backend-fastapi-engines-and-routers.md.
1. Upgrade apps/web/src/app/[locale]/(erp)/dashboard/page.tsx with a Master Hall Gantt Timeline, Split-Screen Approval Diff Queue (approving/rejecting pending drafts like +30 Gold Chairs with live Cross-ERP sync), and a Post-Event Damage Inspection modal wired to POST /api/v1/erp/ops/events/{id}/inspection.
2. Upgrade apps/web/src/app/[locale]/erp/finance/ledger/page.tsx with a Milestone Receipt Verification queue wired to PATCH /api/v1/erp/finance/milestones/{id}/verify so verified receipts automatically post balanced double-entry journal entries and update the Trial Balance.
3. Upgrade apps/web/src/app/[locale]/gate/page.tsx with a searchable Guest & Vendor Manifest table (VIP / Guest / Vendor badges) and instant green/red pass validation feedback.
4. Run final verification across backend (`pytest`) and frontend (`npm --prefix apps/web run build` and `BUILD_TARGET=NATIVE npm --prefix apps/web run build`).

```

```

---

### Summary of Your 4 Saved Documentation Packs
You now have the complete, copy-pasteable set of `.md` files to save in your `docs/` directory and feed directly to your coding agent:
1. `docs/01-dual-ecosystem-architecture-and-models.md`
2. `docs/02-backend-fastapi-engines-and-routers.md`
3. `docs/03-frontend-nextjs-dual-portal-pack.md`
4. `docs/04-multi-phase-agent-execution-prompt.md`
