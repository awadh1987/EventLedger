# EventLedger (إيفنت ليدجر) — Dual-Ecosystem End-to-End Architecture & Data Models

**File Path:** `docs/01-dual-ecosystem-architecture-and-models.md`  
**Platform Scope:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal (Dual-Ecosystem: **EventLedger SaaS & Venue Tenants** + **`<slug>` Venues & End Clients**)  
**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (Async) + Alembic + Celery + Redis + WeasyPrint | Next.js 14 (RTL/LTR) + Tailwind CSS + Konva.js | Tauri v2 (`.exe`) + Capacitor 6 (`.apk`)

---

## 1. Dual-Ecosystem Product Architecture

EventLedger operates across **two interconnected commercial ecosystems** within a single strictly isolated multi-tenant deployment:

### Ecosystem Tier 1: EventLedger SaaS Platform & Venue Tenants (B2B SaaS Layer)

Designed for the platform operator (`SUPER_ADMIN`) and venue owners/organizations (`TENANT` / `<slug>`):

1. **SaaS Marketing & Interactive Live Sandbox (`eventledger.cloud` / `localhost:3000`):**
   - Bilingual RTL/LTR product showcase with live interactive demos (Hover-Spotlight UI preview, Konva Floor Plan sandbox, WhatsApp Approval simulator), multi-currency pricing matrix (`BASIC`, `PRO`, `ENTERPRISE` in `YER`, `SAR`, `USD`, `AED`), and **1-Click Tenant Self-Onboarding** (`POST /api/v1/public/tenants/register`).
2. **Subscription, Quota Metering & Billing Engine:**
   - Enforces plan limits per `<slug>` tenant (`max_halls`, `max_staff_users`, `monthly_whatsapp_quota`, `custom_domain_enabled`, `offline_sync_enabled`), tracks subscription renewals (`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`), and generates SaaS platform invoices.
3. **Custom Domain (`CNAME`) & Wildcard Subdomain Provisioning:**
   - Every tenant receives `{slug}.eventledger.cloud` (plus path fallback `/{locale}/t/{slug}/...` for local/LAN environments) and Enterprise custom domain binding (`events.almassa.ye`) with DNS `CNAME` verification status.
4. **Platform Super-Admin Console (`admin.eventledger.cloud` / `/{locale}/admin`):**
   - Global tenant directory, plan upgrades/downgrades, tenant suspension/activation, WhatsApp/SMS quota resets, platform MRR analytics, and one-click impersonation/preview into any `<slug>` workspace.

### Ecosystem Tier 2: `<slug>` Venue Organizations & Their End Clients (Venue ERP + Client Portal Layer)

Designed for each venue tenant (`<slug>`), its internal departments (`OWNER`, `SALES_MANAGER`, `SALES_REP`, `FINANCE`, `OPS_MANAGER`, `HEAD_CHEF`, `SECURITY`), and its end clients (`INDIVIDUAL_B2C` weddings/private events, `CORPORATE_B2B` conferences/summits, `CLIENT_DELEGATE` wedding planners/co-hosts, and `EXTERNAL_VENDOR`s):

1. **White-Label Public Venue Storefront (`{slug}.eventledger.cloud/venue` or `/{locale}/t/{slug}/venue`):**
   - Branded hall showcase (banquet & theater capacities, partition-hall merge options, 360°/gallery media), **Real-Time Availability Calendar** (showing confirmed events, `HOLD_48H` holds, and pre/post cleaning buffers), **Dynamic Pricing Quote Calculator** (weekend/seasonal multipliers, catering packages, equipment add-ons, taxes), and **1-Click 48-Hour Tentative Hold Checkout**.
2. **End-to-End Reservation & Booking Lifecycle Engine:**
   - State machine: `INQUIRY` → `HOLD_48H` (Redis TTL + Celery 42h warning & 48h auto-expiry) → `CONTRACT_PENDING` (bilingual PDF contract + digital e-signature) → `CONFIRMED` → `IN_PROGRESS` → `COMPLETED` (post-event damage inspection & deposit settlement) / `CANCELLED`.
3. **Interactive Client Account Control Panel (`/{locale}/t/{slug}/portal/dashboard`):**
   - **Active Event Switcher & Countdown/Lockout Timers:** Displays live countdowns to event start and pre-event edit lockout windows (`72h` catering freeze, `24h` floor plan freeze).
   - **Interactive Konva Floor Plan Designer:** Drag-and-drop Stage/Kosha, VIP Tables, Guest Tables, Buffet Stations, and AV Booths with live capacity validation, extra-table cost delta calculation, version history rollback, and draft submission.
   - **Catering Menu & Dietary Matrix:** Per-guest menu selection, allergy/VIP meal notes, and minute-by-minute event timeline editor.
   - **Team & Vendor Delegation:** Invite Wedding Planners, Co-Hosts, and External Vendors with granular JSON permission switches (`canViewFinance`, `canEditFloorplan`, `canEditCatering`, `canRequestAddons`, `canManageGuests`).
   - **Guest List & QR Pass Studio:** UTF-8 BOM CSV/Excel guest import, RSVP status tracking (`INVITED`, `CONFIRMED`, `DECLINED`), and instant generation of branded QR entry passes (Guest, VIP, Vendor Crew) shareable via WhatsApp or downloadable PDF/PNG.
   - **Contract E-Signature, Milestone Receipts & Security Deposit Vault:** Digital contract signing, split payment milestones with one-tap local bank/e-wallet copy (`Kuraimi`, `Jaib`, `Jawali`, `OneCash`, `IBAN`), mobile camera receipt capture (`capture="environment"`), refundable security deposit status tracker, and immutable `AuditLog` viewer.
4. **Internal Venue ERP Operations Hub (`/{locale}/t/{slug}/erp/...`):**
   - **Master Hall Gantt Calendar:** Multi-hall timeline with partition-merge conflict locking and color-coded status + cleaning buffer blocks.
   - **Split-Screen Approval Diff Queue:** Multi-tier approval matrix (`CLIENT_PRIMARY` → `SALES_MANAGER`/`OWNER` for discounts → `OPS_MANAGER`/`HEAD_CHEF` for feasibility) with side-by-side JSON diff inspection and automated Cross-ERP sync.
   - **Double-Entry Accounting, Trial Balance & Event P&L:** Automated journal posting on payment verification, strict Liability `2100` segregation for refundable security deposits, `CREDIT_NOTE` adjustments, Trial Balance, and per-event Profit & Loss (revenue vs. recipe BOM COGS & event expenses).
   - **Live Kitchen & Ops Banquet Event Order (BEO):** Tablet-optimized live BEO showing headcount, recipe BOM ingredient prep quantities, timeline cues, floor plan snapshot, and post-event Damage Inspection checklist.
   - **Omnichannel Communications:** Unified `EventMessage` thread with `@Department` routing (`@Kitchen`, `@Ops`, `@Finance`), internal staff-only notes (`is_internal`), and two-way WhatsApp Business Cloud API webhooks.
   - **Offline-First Security Gate Scanner (`/{locale}/t/{slug}/gate`):** Camera QR scanner + local SQLite/IndexedDB manifest caching for uninterrupted guest/vendor check-ins during internet outages.

---

## 2. Routing & Multi-Tenant Resolution Matrix

| Surface / URL Pattern | Resolved Context | Target Route Group | Access Control |
| :--- | :--- | :--- | :--- |
| `eventledger.cloud` / `localhost:3000/{locale}` | `PLATFORM_ROOT` | `app/[locale]/(marketing)/` | Public SaaS Landing, Pricing, Interactive Sandbox & Tenant Signup |
| `admin.eventledger.cloud` / `/{locale}/admin` | `PLATFORM_SUPER_ADMIN` | `app/[locale]/admin/` | `SUPER_ADMIN` Only (Tenants, Subscriptions, Quotas, CNAMEs) |
| `{slug}.eventledger.cloud/venue` or `/{locale}/t/{slug}/venue` | `TENANT_WORKSPACE` | `app/[locale]/venue/` | Public `<slug>` Storefront, Availability Calendar & 48h Hold Booking |
| `{slug}.eventledger.cloud/portal` or `/{locale}/t/{slug}/portal` | `TENANT_WORKSPACE` | `app/[locale]/portal/` | `CLIENT_PRIMARY`, `CLIENT_DELEGATE`, `EXTERNAL_VENDOR` |
| `{slug}.eventledger.cloud/erp` or `/{locale}/t/{slug}/erp` | `TENANT_WORKSPACE` | `app/[locale]/erp/` | `INTERNAL_STAFF` (`OWNER`, `SALES_*`, `FINANCE`, `OPS_*`, `HEAD_CHEF`) |
| `{slug}.eventledger.cloud/gate` or `/{locale}/t/{slug}/gate` | `TENANT_WORKSPACE` | `app/[locale]/gate/` | `INTERNAL_STAFF` (`SECURITY`, `OPS_MANAGER`, `OWNER`) |
| `events.almassa.ye` (Custom `CNAME`) | `TENANT_CUSTOM_DOMAIN` | Same as `{slug}` Workspace | Resolves via `Tenant.custom_domain` |

---

## 3. Complete SQLAlchemy 2.0 Models (`apps/api/app/models/`)

Ensure all models inherit `TenantOwnedMixin` (for tenant-scoped tables) and include `RecordLifecycle` (`DRAFT`, `ACTIVE`, `ARCHIVED`, `DELETED`):

### 3.1 SaaS Platform & Tenant Extensions (`app/models/tenant.py`)

```python
import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SubscriptionTier(str, enum.Enum):
    BASIC = "BASIC"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


class SubscriptionStatus(str, enum.Enum):
    TRIAL = "TRIAL"
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    SUSPENDED = "SUSPENDED"


class RecordLifecycle(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    DELETED = "DELETED"


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    custom_domain: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    custom_domain_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    subscription_tier: Mapped[SubscriptionTier] = mapped_column(Enum(SubscriptionTier), default=SubscriptionTier.PRO)
    subscription_status: Mapped[SubscriptionStatus] = mapped_column(Enum(SubscriptionStatus), default=SubscriptionStatus.ACTIVE)
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    max_halls: Mapped[int] = mapped_column(Integer, default=5)
    monthly_whatsapp_quota: Mapped[int] = mapped_column(Integer, default=2000)
    whatsapp_used_this_month: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(10), default="YER")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    whatsapp_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    payment_accounts: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    branding: Mapped[Optional["TenantBranding"]] = relationship(back_populates="tenant", uselist=False)


class TenantBranding(Base):
    __tablename__ = "tenant_brandings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True)
    logo_light_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logo_dark_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    favicon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_color: Mapped[str] = mapped_column(String(20), default="#D4AF37")
    accent_color: Mapped[str] = mapped_column(String(20), default="#0F172A")
    default_theme: Mapped[str] = mapped_column(String(20), default="DARK")
    enable_spotlight: Mapped[bool] = mapped_column(Boolean, default=True)
    spotlight_color: Mapped[str] = mapped_column(String(50), default="rgba(212, 175, 55, 0.18)")
    hero_tagline_ar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hero_tagline_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invoice_footer_ar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invoice_footer_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="branding")


class SystemLookup(Base):
    __tablename__ = "system_lookups"
    __table_args__ = (UniqueConstraint("tenant_id", "category", "code", name="uq_tenant_category_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(60))
    code: Mapped[str] = mapped_column(String(60))
    label_ar: Mapped[str] = mapped_column(String(255))
    label_en: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    lifecycle: Mapped[RecordLifecycle] = mapped_column(Enum(RecordLifecycle), default=RecordLifecycle.ACTIVE)

3.2 Events, Digital Contracts, Guest RSVPs & Damage Inspection (app/models/events.py Additions)
In addition to Event, EventDraft, ApprovalRequest, EventMessage, GatePass, and AuditLog, include:

EventContract: id, tenant_id, event_id, contract_number, terms_ar, terms_en, client_signed_at, client_signature_name, client_signature_ip, staff_countersigned_at, pdf_url.

EventGuest: id, tenant_id, event_id, full_name, phone, vip_tier (STANDARD, VIP, FAMILY, SPEAKER), dietary_notes, table_label, rsvp_status (INVITED, CONFIRMED, DECLINED), gate_pass_id.

DamageInspection: id, tenant_id, event_id, inspected_by_id, checklist_json, photos_json, deduction_amount, notes, status (PASSED, DAMAGE_CLAIMED), inspected_at.

4. Non-Negotiable Architectural & Security Invariants
Strict tenant_id Isolation: Every tenant-scoped query MUST filter by tenant_id derived from TenantResolverMiddleware ({slug}.*, custom_domain, or X-Tenant-Slug) or the authenticated JWT. Cross-tenant token access MUST return HTTP 403.

Balanced Double-Entry Ledger: Every JournalEntry MUST satisfy abs(sum(debit) - sum(credit)) < 0.01 inside a single DB transaction. Refundable security deposits MUST post to Liability 2100, never Revenue 4000.

Bilingual RTL/LTR Logical CSS: Use dir="rtl" for ar and dir="ltr" for en, and enforce logical Tailwind properties (ps-*, pe-*, ms-*, me-*, text-start, text-end).

UTF-8 BOM CSVs: Prepend \uFEFF to all CSV exports and decode imports with utf-8-sig.
