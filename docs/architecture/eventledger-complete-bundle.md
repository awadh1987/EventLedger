# EventLedger (إيفنت ليدجر) — Complete Repository Execution Bundle
**All 11 Project Files in One Self-Contained Document for AI Coding Agents**

> **Instructions for Your AI Coding Agent (Cursor / Claude Code / Windsurf / Devin):**  
> Extract each file block below (`File 1` through `File 11`) to its exact relative path in the repository root, then execute the build phases sequentially.

---

## Repository File Tree
```text
eventledger-saas/
├── .env.example
├── CLAUDE.md
├── README.md
├── docker-compose.yml
└── docs/
    ├── 01-master-blueprint-v2.md
    ├── 02-production-accounting-pack-v3.md
    ├── 03-domain-subdomain-landing-pack.md
    ├── 04-import-export-accounting-pack.md
    ├── 05-frontend-theme-ledger-pack.md
    ├── 06-floorplan-canvas-pack.md
    └── seed-v2.ts
```

---

## File 1: `.env.example`
```env
# ==========================================
# EventLedger (إيفنت ليدجر) — Environment Config
# ==========================================
BRAND_NAME_EN="EventLedger"
BRAND_NAME_AR="إيفنت ليدجر"

# Domain & Multi-Tenant Subdomain Routing
# Local testing (/etc/hosts): 127.0.0.1 eventledger.local admin.eventledger.local almassa.eventledger.local
NEXT_PUBLIC_ROOT_DOMAIN="eventledger.local:3000"
ROOT_DOMAIN="eventledger.local:3000"
NEXT_PUBLIC_API_URL="http://localhost:4000/api/v1"

# PostgreSQL & Redis
DATABASE_URL="postgresql://eventledger_admin:eventledger_secret_pass@localhost:5432/eventledger_db?schema=public"
REDIS_URL="redis://localhost:6379"

# Auth & Security
JWT_SECRET="change-this-to-a-64-char-random-secret"
JWT_EXPIRES_IN="7d"

# S3 / MinIO Object Storage (Logos, Favicons, Contracts, Receipts)
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY="minio_admin"
S3_SECRET_KEY="minio_secret_password"
S3_BUCKET="eventledger-assets"
S3_PUBLIC_URL="http://localhost:9000/eventledger-assets"

# WhatsApp Business Cloud API
WHATSAPP_API_URL="https://graph.facebook.com/v20.0"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="eventledger_wa_verify_token"
```

---

## File 2: `CLAUDE.md`
```markdown
# AI Coding Agent Rules (`CLAUDE.md` / `.cursorrules`)
**Project:** EventLedger (إيفنت ليدجر) — Multi-Tenant Venue, Wedding Hall & Conference ERP + Client Portal

## 1. Non-Negotiable Multi-Tenant & Security Rules
- **Strict Tenant Isolation:** Every tenant-owned database table MUST include `tenantId`. Every NestJS service query MUST scope by `tenantId` resolved from `TenantResolverMiddleware` or `req.user.tenantId`.
- **Subdomain & Root Routing:**
  - `eventledger.cloud` / `www.eventledger.cloud` → SaaS Marketing Landing Page & Tenant Self-Onboarding (`PLATFORM_ROOT`).
  - `admin.eventledger.cloud` → SaaS Super-Admin Console (`PLATFORM_SUPER_ADMIN`).
  - `{slug}.eventledger.cloud` or `Tenant.customDomain` → Tenant White-Label Hub, Client Portal (`/portal`), ERP (`/erp`), and Offline Security Gate (`/gate`).
- **Balanced Double-Entry Accounting:** Every `JournalEntry` MUST satisfy `Math.abs(sum(debit) - sum(credit)) < 0.01` inside `prisma.$transaction`. Refundable security deposits MUST post to Liability account `2100`, never Revenue `4000`.

## 2. Bilingual RTL / LTR & UI Consistency Rules
- **Always Support `ar` (RTL) and `en` (LTR):** Set `dir={locale === 'ar' ? 'rtl' : 'ltr'}` and use logical Tailwind spacing (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `text-end`).
- **Hover-Spotlight & White-Label Branding:** Wrap cards and section headings with `SpotlightCard` and `SpotlightHeading`, reading CSS variables (`--brand-primary`, `--brand-accent`, `--brand-glow`) from `ThemeBrandingProvider`.
- **Lifecycle & Dropdowns:** Use `SystemLookup` for configurable dropdown lists and enforce `RecordLifecycle` (`DRAFT`, `ACTIVE`, `ARCHIVED`, `DELETED`) on master records.
- **CSV & PDF Exports:** Always prepend UTF-8 BOM (`\uFEFF`) to CSV exports and support bilingual `ar`/`en` PDF templates.
```

---

## File 3: `docker-compose.yml`
```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    container_name: eventledger_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: eventledger_admin
      POSTGRES_PASSWORD: eventledger_secret_pass
      POSTGRES_DB: eventledger_db
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: eventledger_redis
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    container_name: eventledger_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio_admin
      MINIO_ROOT_PASSWORD: minio_secret_password
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

---

## File 4: `README.md`
```markdown
# EventLedger (إيفنت ليدجر) — Multi-Tenant Venue & Conference SaaS ERP + Client Portal

## Quick Start
1. Copy `.env.example` to `.env`.
2. Run `docker-compose up -d` to launch PostgreSQL, Redis, and MinIO.
3. Add local hosts entries: `127.0.0.1 eventledger.local admin.eventledger.local almassa.eventledger.local`.
4. Run `pnpm install`, `npx prisma migrate dev`, and execute `docs/seed-v2.ts`.
```

---

## File 5: `docs/01-master-blueprint-v2.md` & `docs/02-production-accounting-pack-v3.md` (Complete Merged `schema.prisma`)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SubscriptionTier {
  BASIC
  PRO
  ENTERPRISE
}

enum UserType {
  SUPER_ADMIN
  INTERNAL_STAFF
  CLIENT_PRIMARY
  CLIENT_DELEGATE
  EXTERNAL_VENDOR
}

enum StaffRole {
  OWNER
  SALES_MANAGER
  SALES_REP
  FINANCE
  OPS_MANAGER
  HEAD_CHEF
  SECURITY
}

enum ClientCategory {
  INDIVIDUAL_B2C
  CORPORATE_B2B
}

enum RecordLifecycle {
  DRAFT
  ACTIVE
  ARCHIVED
  DELETED
}

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
}

enum EventStatus {
  INQUIRY
  HOLD_48H
  CONTRACT_PENDING
  CONFIRMED
  COMPLETED
  CANCELLED
}

enum DelegateRole {
  CO_HOST
  WEDDING_PLANNER
  VENDOR
}

enum DraftType {
  PACKAGE_QUOTE
  FLOOR_PLAN
  CATERING_MENU
  TIMELINE_BEO
  ADDON_REQUEST
}

enum DraftStatus {
  DRAFT
  PENDING_CLIENT_APPROVAL
  PENDING_INTERNAL_APPROVAL
  APPROVED_SYNCED
  REJECTED
}

enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
}

enum DepositStatus {
  UNPAID
  HELD
  INSPECTION_PASSED
  REFUNDED
  DEDUCTED
}

enum InvoiceStatus {
  DRAFT
  ISSUED
  PARTIALLY_PAID
  PAID
  OVERDUE
  VOIDED
}

model Tenant {
  id               String           @id @default(uuid())
  name             String
  slug             String           @unique
  customDomain     String?          @unique
  subscriptionTier SubscriptionTier @default(PRO)
  currency         String           @default("YER")
  taxRate          Decimal          @default(0.00) @db.Decimal(5, 2)
  settings         Json
  whatsappConfig   Json?
  isActive         Boolean          @default(true)
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  branding         TenantBranding?
  accountingConfig AccountingConfig?
  chartOfAccounts  ChartOfAccount[]
  journalEntries   JournalEntry[]
  systemLookups    SystemLookup[]
  halls            Hall[]
  users            User[]
  events           Event[]
  pricingRules     PricingRule[]
  invoices         Invoice[]
  inventoryItems   InventoryItem[]
  cateringItems    CateringMenuItem[]
  expenses         EventExpense[]
  auditLogs        AuditLog[]
}

model TenantBranding {
  id              String   @id @default(uuid())
  tenantId        String   @unique
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  logoLightUrl    String?
  logoDarkUrl     String?
  faviconUrl      String?
  primaryColor    String   @default("#D4AF37")
  accentColor     String   @default("#1E293B")
  defaultTheme    String   @default("SYSTEM")
  enableSpotlight Boolean  @default(true)
  spotlightColor  String   @default("rgba(212, 175, 55, 0.18)")
  invoiceFooterAr String?
  invoiceFooterEn String?
  updatedAt       DateTime @updatedAt
}

model SystemLookup {
  id        String          @id @default(uuid())
  tenantId  String
  tenant    Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  category  String
  code      String
  labelAr   String
  labelEn   String
  sortOrder Int             @default(0)
  lifecycle RecordLifecycle @default(ACTIVE)

  @@unique([tenantId, category, code])
}

model ChartOfAccount {
  id          String          @id @default(uuid())
  tenantId    String
  tenant      Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  code        String
  nameAr      String
  nameEn      String
  accountType AccountType
  parentId    String?
  parent      ChartOfAccount? @relation("AccountHierarchy", fields: [parentId], references: [id])
  children    ChartOfAccount[] @relation("AccountHierarchy")
  isSystem    Boolean         @default(false)
  lifecycle   RecordLifecycle @default(ACTIVE)
  journalLines JournalLine[]

  @@unique([tenantId, code])
}

model AccountingConfig {
  id                       String  @id @default(uuid())
  tenantId                 String  @unique
  tenant                   Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  fiscalYearStartMonth     Int     @default(1)
  autoPostOnPaymentVerify  Boolean @default(true)
  cashAccountId            String?
  bankAccountId            String?
  accountsReceivableId     String?
  hallRevenueAccountId     String?
  cateringRevenueAccountId String?
  securityDepositLiabId    String?
  taxPayableAccountId      String?
  cateringCogsAccountId    String?
}

model JournalEntry {
  id          String        @id @default(uuid())
  tenantId    String
  tenant      Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  entryNumber String
  entryDate   DateTime      @default(now())
  reference   String?
  description String
  eventId     String?
  status      String        @default("POSTED")
  createdById String
  createdAt   DateTime      @default(now())
  lines       JournalLine[]

  @@unique([tenantId, entryNumber])
}

model JournalLine {
  id             String         @id @default(uuid())
  journalEntryId String
  journalEntry   JournalEntry   @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  accountId      String
  account        ChartOfAccount @relation(fields: [accountId], references: [id])
  debit          Decimal        @default(0.00) @db.Decimal(14, 2)
  credit         Decimal        @default(0.00) @db.Decimal(14, 2)
  memo           String?
}

model Hall {
  id                    String          @id @default(uuid())
  tenantId              String
  tenant                Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name                  String
  nameAr                String
  capacityBanquet       Int
  capacityTheater       Int
  basePrice             Decimal         @db.Decimal(12, 2)
  cleaningBufferMinutes Int             @default(120)
  combinableWithHallId  String?
  lifecycle             RecordLifecycle @default(ACTIVE)
  events                Event[]
}

model User {
  id            String   @id @default(uuid())
  tenantId      String?
  tenant        Tenant?  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userType      UserType
  email         String?  @unique
  phone         String   @unique
  passwordHash  String?
  fullName      String
  preferredLang String   @default("ar")
  is2faEnabled  Boolean  @default(false)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  staffProfile       StaffProfile?
  clientProfile      ClientProfile?
  primaryEvents      Event[]           @relation("PrimaryClientEvents")
  assignedEvents     Event[]           @relation("AssignedSalesEvents")
  eventDelegates     EventDelegate[]
  createdDrafts      EventDraft[]
  requestedApprovals ApprovalRequest[] @relation("ApprovalRequester")
  resolvedApprovals  ApprovalRequest[] @relation("ApprovalResolver")
  messages           EventMessage[]
  auditLogs          AuditLog[]
}

model StaffProfile {
  userId             String    @id
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role               StaffRole
  department         String
  maxDiscountPercent Decimal   @default(0.00) @db.Decimal(5, 2)
  commissionRate     Decimal   @default(0.00) @db.Decimal(5, 2)
}

model ClientProfile {
  userId            String         @id
  user               User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientCategory    ClientCategory
  nationalIdOrCr    String?
  taxId             String?
  companyName       String?
  billingAddress    String?
  refundBankDetails Json?
  vipTier           String         @default("STANDARD")
}

model Event {
  id              String      @id @default(uuid())
  tenantId        String
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  hallId          String
  hall            Hall        @relation(fields: [hallId], references: [id])
  primaryClientId String
  primaryClient   User        @relation("PrimaryClientEvents", fields: [primaryClientId], references: [id])
  assignedSalesId String?
  assignedSales   User?       @relation("AssignedSalesEvents", fields: [assignedSalesId], references: [id])
  eventCode       String      @unique
  eventType       String
  startTime       DateTime
  endTime         DateTime
  status          EventStatus @default(INQUIRY)
  guestCount      Int
  isLocked        Boolean     @default(false)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  delegates            EventDelegate[]
  drafts               EventDraft[]
  approvals            ApprovalRequest[]
  invoices             Invoice[]
  inventoryAllocations EventInventoryAllocation[]
  expenses             EventExpense[]
  gatePasses           GatePass[]
  messages             EventMessage[]
  auditLogs            AuditLog[]
}

model EventDelegate {
  id           String       @id @default(uuid())
  eventId      String
  event        Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId       String
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  delegateRole DelegateRole
  permissions  Json

  @@unique([eventId, userId])
}

model EventDraft {
  id             String      @id @default(uuid())
  eventId        String
  event          Event       @relation(fields: [eventId], references: [id], onDelete: Cascade)
  createdById    String
  createdBy      User        @relation(fields: [createdById], references: [id])
  versionNumber  Int
  draftType      DraftType
  payload        Json
  financialDelta Decimal     @default(0.00) @db.Decimal(12, 2)
  status         DraftStatus @default(DRAFT)
  createdAt      DateTime    @default(now())
  approvals      ApprovalRequest[]
}

model ApprovalRequest {
  id                   String         @id @default(uuid())
  eventId              String
  event                Event          @relation(fields: [eventId], references: [id], onDelete: Cascade)
  draftId              String
  draft                EventDraft     @relation(fields: [draftId], references: [id], onDelete: Cascade)
  requestedById        String
  requestedBy          User           @relation("ApprovalRequester", fields: [requestedById], references: [id])
  requiredApproverRole String
  approvedById         String?
  approvedBy           User?          @relation("ApprovalResolver", fields: [approvedById], references: [id])
  status               ApprovalStatus @default(PENDING)
  rejectionReason      String?
  signatureHash        String?
  createdAt            DateTime       @default(now())
  resolvedAt           DateTime?
}

model EventMessage {
  id          String   @id @default(uuid())
  eventId     String
  event       Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  senderId    String
  sender      User     @relation(fields: [senderId], references: [id])
  channel     String
  department  String?
  content     String
  attachments Json?
  isInternal  Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model AuditLog {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  eventId   String?
  event     Event?   @relation(fields: [eventId], references: [id], onDelete: SetNull)
  actorId   String
  actor     User     @relation(fields: [actorId], references: [id])
  action    String
  oldValue  Json?
  newValue  Json?
  ipAddress String?
  createdAt DateTime @default(now())
}

model PricingRule {
  id         String    @id @default(uuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  hallId     String?
  name       String
  daysOfWeek Int[]
  startDate  DateTime?
  endDate    DateTime?
  multiplier Decimal   @db.Decimal(4, 2)
  isActive   Boolean   @default(true)
}

model Invoice {
  id                    String        @id @default(uuid())
  tenantId              String
  tenant                Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  eventId               String
  event                 Event         @relation(fields: [eventId], references: [id], onDelete: Cascade)
  invoiceNumber         String        @unique
  subtotal              Decimal       @db.Decimal(12, 2)
  discountAmount        Decimal       @default(0.00) @db.Decimal(12, 2)
  taxAmount             Decimal       @default(0.00) @db.Decimal(12, 2)
  totalAmount           Decimal       @db.Decimal(12, 2)
  securityDepositAmount Decimal       @default(0.00) @db.Decimal(12, 2)
  depositStatus         DepositStatus @default(UNPAID)
  status                InvoiceStatus @default(DRAFT)
  createdAt             DateTime      @default(now())
  milestones            PaymentMilestone[]
}

model PaymentMilestone {
  id            String    @id @default(uuid())
  invoiceId     String
  invoice       Invoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  title         String
  amountDue     Decimal   @db.Decimal(12, 2)
  dueDate       DateTime
  paidAmount    Decimal   @default(0.00) @db.Decimal(12, 2)
  paymentMethod String?
  receiptUrl    String?
  status        String    @default("PENDING")
  paidAt        DateTime?
}

model InventoryItem {
  id             String          @id @default(uuid())
  tenantId       String
  tenant         Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name           String
  category       String
  totalStock     Int
  unitAddonPrice Decimal         @default(0.00) @db.Decimal(10, 2)
  lifecycle      RecordLifecycle @default(ACTIVE)
  allocations    EventInventoryAllocation[]
}

model EventInventoryAllocation {
  id               String        @id @default(uuid())
  eventId          String
  event            Event         @relation(fields: [eventId], references: [id], onDelete: Cascade)
  itemId           String
  item             InventoryItem @relation(fields: [itemId], references: [id])
  quantityReserved Int
}

model CateringMenuItem {
  id            String          @id @default(uuid())
  tenantId      String
  tenant        Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  nameAr        String
  nameEn        String
  pricePerGuest Decimal         @db.Decimal(10, 2)
  costPerGuest  Decimal         @db.Decimal(10, 2)
  recipeBom     Json
  lifecycle     RecordLifecycle @default(ACTIVE)
}

model EventExpense {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  eventId     String
  event       Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  category    String
  description String
  amount      Decimal  @db.Decimal(12, 2)
  recordedBy  String
  createdAt   DateTime @default(now())
}

model GatePass {
  id             String    @id @default(uuid())
  eventId        String
  event          Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  passType       String
  holderName     String
  holderIdNumber String?
  qrToken        String    @unique
  validFrom      DateTime
  validUntil     DateTime
  isCheckedIn    Boolean   @default(false)
  checkedInAt    DateTime?
}
```

---

## File 6: `docs/03-domain-subdomain-landing-pack.md` — Subdomain & Landing Page Rules
- `eventledger.cloud` / `www.eventledger.cloud` → Root SaaS Marketing Landing Page (`app/[locale]/(marketing)/page.tsx`) + Tenant Self-Onboarding (`POST /api/v1/public/tenants/register`).
- `admin.eventledger.cloud` → SaaS Super-Admin Console (`app/[locale]/(super-admin)/`).
- `{slug}.eventledger.cloud` or `Tenant.customDomain` → White-Label Tenant Hub (`/book`, `/portal`, `/erp`, `/gate`), resolved via Next.js Edge `middleware.ts` (`x-tenant-slug` / `x-tenant-custom-domain`) and NestJS `TenantResolverMiddleware`.

---

## File 7: `docs/04-import-export-accounting-pack.md` — Double-Entry, CSV Import & PDF Export
- **Default Accounts:** `1010` Cash, `1020` Bank/E-Wallet, `1100` Accounts Receivable, `2100` Refundable Security Deposits (Liability), `2200` Tax Payable, `4000` Hall Rental Revenue, `4100` Catering Revenue, `5000` Catering COGS.
- **CSV Bulk Import:** UTF-8 BOM (`\uFEFF`) parser with row-level error reporting for Guest Lists (auto-generating QR tokens), Inventory Items, and Chart of Accounts.
- **Bilingual PDF Export:** White-labeled Arabic (`Cairo` font, `dir="rtl"`) and English (`Inter` font, `dir="ltr"`) invoices, BEOs, and financial statements styled with `TenantBranding`.

---

## File 8: `docs/05-frontend-theme-ledger-pack.md` — Theme, Branding & Hover-Spotlight UI
- **`ThemeBrandingProvider`:** Injects `--brand-primary`, `--brand-accent`, `--brand-glow`, dynamically updates `<link rel="icon">` with `TenantBranding.faviconUrl`, and toggles Light / Dark / System themes via `next-themes`.
- **Mouse-Tracking Hover Illumination (`SpotlightCard` & `SpotlightHeading`):** Tracks `onMouseMove` (`--mouse-x`, `--mouse-y`) to illuminate card borders, headings, and dropdown surfaces in both Light and Dark modes.

---

## File 9: `docs/06-floorplan-canvas-pack.md` — Konva.js Interactive Floor Plan
- **`FloorPlanCanvas.tsx`:** Drag-and-drop canvas (`react-konva`) supporting Stages/Kosha, VIP Tables, Guest Tables, Buffet Stations, and AV Booths. Computes live guest capacity vs. `hall.capacityBanquet` and calculates `financialDelta` when extra tables exceed included package quotas.

---

## File 10: `docs/seed-v2.ts` — Database Seed Summary
- Seeds `SUPER_ADMIN`, sample tenant `almassa` (`Al-Massa Grand Palace / قصر الماسة للمؤتمرات والأفراح`), two partitionable halls (`Grand Diamond Hall` + `Royal Jasmine Hall`), staff (`OWNER`, `SALES_REP`, `FINANCE`, `OPS_MANAGER`, `HEAD_CHEF`, `SECURITY`), B2C & B2B clients, a delegated wedding planner, a confirmed wedding event (`EVT-2026-1001`), a pending add-on approval draft (`+30 Gold Chairs`), split payment milestones, security deposit liability tracking, and QR gate passes.
