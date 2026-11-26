# Master Software Architecture & Execution Blueprint
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Target Execution:** AI Coding Agents (Cursor, Windsurf, Claude Code, Devin)  
**Localization:** Bilingual First (Arabic `dir="rtl"` & English `dir="ltr"`)  

---

## 1. Executive Summary & System Vision
This system is a **Multi-Tenant SaaS ERP & Interactive Client Portal** designed specifically for wedding halls, event venues, and conference centers. It eliminates double-bookings, prevents revenue leakage, enforces multi-tier approval workflows, and synchronizes client modifications across **Sales, Finance, Kitchen/Catering, Operations, Inventory, and Security Gate Control** in real time.

### Core Architectural Pillars
1. **Multi-Tenant Isolation:** Every organization (`Tenant`) manages multiple branches and halls, including partitionable halls that can merge into larger spaces.
2. **Client Account Control Panel:** Full self-service portal for B2C (Individuals/Weddings) and B2B (Corporates/Conferences) with granular sub-user delegation (Wedding Planners, Co-Hosts, External Vendors).
3. **Versioned Draft & Lockout Engine:** Clients and planners experiment safely in `DRAFT` mode without disrupting kitchen or floor operations. Automated lockout windows freeze edits prior to the event (e.g., Catering locks 72h before; Floor Plan locks 24h before).
4. **Multi-Tier Approval Matrix & Cross-ERP Sync:** Changes with financial impact require Primary Client sign-off; operational changes require Operations/Kitchen sign-off; discounts above staff limits require Owner/Manager sign-off. Approved drafts automatically sync across Finance, Inventory, Kitchen BEOs, and Gate Passes.
5. **Financial & Security Deposit Vault:** Enforces payment milestones, receipt verification, tax compliance, and a post-event Damage Inspection workflow to release refundable security deposits.

---

## 2. Recommended Tech Stack & Repository Structure

### Tech Stack
* **Monorepo Manager:** Turborepo (`pnpm`)
* **Backend API:** Node.js + NestJS + TypeScript (strict typing for AI coding agents)
* **Database & ORM:** PostgreSQL 16 + Prisma ORM + Redis (for 48h tentative booking TTL locks & real-time WebSockets)
* **Frontend (ERP + Client Portal):** Next.js 14+ (App Router) + Tailwind CSS + Shadcn/UI + `next-intl` (Arabic RTL / English LTR)
* **Interactive Floor Plan Canvas:** `react-konva` / `konva` (drag-and-drop tables, VIP zones, stage layouts)
* **PDF & QR Generation:** `@react-pdf/renderer` or `pdf-lib` (Contracts, Tax Invoices, BEOs) + `qrcode` (Guest & Vendor Gate Passes)
* **Storage & Messaging:** S3-compatible storage (Cloudflare R2 / AWS S3) + WhatsApp Business API (Twilio / Meta Cloud API)

### Recommended Monorepo Folder Structure
```text
venue-erp-saas/
├── apps/
│   ├── api/                        # NestJS Backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/           # OTP, 2FA, RBAC, Multi-Tenant Guards
│   │   │   │   ├── tenants/        # Tenant config, branches, partitionable halls
│   │   │   │   ├── bookings/       # Availability engine, 48h holds, dynamic pricing
│   │   │   │   ├── drafts/         # Versioned drafts, lockout windows, diff engine
│   │   │   │   ├── approvals/      # Multi-tier approval state machine & ERP sync bus
│   │   │   │   ├── finance/        # Invoices, milestones, receipts, security deposit vault
│   │   │   │   ├── operations/     # Live BEO generator, kitchen prep, damage inspection
│   │   │   │   ├── inventory/      # Furniture/AV stock & event allocations
│   │   │   │   └── gate-passes/    # QR generation & security scanner validation
│   │   │   └── common/             # Tenant interceptor, audit log decorator
│   └── web/                        # Next.js Frontend (ERP + Client Portal)
│       ├── src/
│       │   ├── app/[locale]/
│       │   │   ├── (public)/       # Live availability calendar & instant quote builder
│       │   │   ├── (portal)/       # Client Account Control Panel & Floor Plan Designer
│       │   │   └── (erp)/          # Internal Staff ERP (Sales, Finance, Kitchen, Ops, Gate)
│       │   └── components/
│       │       ├── floorplan/      # Konva.js drag-and-drop hall layout editor
│       │       └── shared/         # RTL/LTR layout wrappers, approval diff cards
├── packages/
│   └── database/                   # Prisma schema, migrations, seed scripts
├── docker-compose.yml              # PostgreSQL, Redis, MinIO (local S3)
└── package.json
```

---

## 3. Complete Database Schema (`schema.prisma`)

Copy this exact schema into `packages/database/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ==========================================
// 1. MULTI-TENANCY & VENUE CONFIGURATION
// ==========================================

model Tenant {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  currency  String   @default("USD") // Supports USD, SAR, YER, AED, etc.
  taxRate   Decimal  @default(0.00) @db.Decimal(5, 2)
  settings  Json     // { "cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48 }
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  halls          Hall[]
  users          User[]
  events         Event[]
  invoices       Invoice[]
  inventoryItems InventoryItem[]
  auditLogs      AuditLog[]
}

model Hall {
  id                    String   @id @default(uuid())
  tenantId              String
  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name                  String
  nameAr                String
  capacityBanquet       Int
  capacityTheater       Int
  basePrice             Decimal  @db.Decimal(12, 2)
  cleaningBufferMinutes Int      @default(120)
  combinableWithHallId  String?  // Handles partition halls that merge into one large hall
  isActive              Boolean  @default(true)

  events Event[]

  @@index([tenantId])
}

// ==========================================
// 2. UNIFIED USERS, STAFF & CLIENT PROFILES
// ==========================================

enum UserType {
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

model User {
  id            String   @id @default(uuid())
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
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
  auditLogs          AuditLog[]

  @@index([tenantId, userType])
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
  user              User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientCategory    ClientCategory
  nationalIdOrCr    String?        // National ID/Passport (B2C) or Commercial Registration (B2B)
  taxId             String?        // Tax/VAT ID for Corporate B2B invoices
  companyName       String?
  billingAddress    String?
  refundBankDetails Json?          // { "method": "Bank/Wallet", "accountNumber": "...", "accountName": "..." }
  vipTier           String         @default("STANDARD")
}

// ==========================================
// 3. EVENTS, DELEGATION & VERSIONED DRAFTS
// ==========================================

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
  eventType       String      // WEDDING, CONFERENCE, GRADUATION
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
  gatePasses           GatePass[]
  auditLogs            AuditLog[]

  @@index([tenantId, startTime, endTime])
}

model EventDelegate {
  id           String       @id @default(uuid())
  eventId      String
  event        Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId       String
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  delegateRole DelegateRole
  permissions  Json         // { "canViewFinance": false, "canEditFloorplan": true, "canRequestAddons": true }

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
  payload        Json        // Snapshot of Floorplan, Menu, Timeline, or Quote
  financialDelta Decimal     @default(0.00) @db.Decimal(12, 2)
  status         DraftStatus @default(DRAFT)
  createdAt      DateTime    @default(now())

  approvals ApprovalRequest[]

  @@index([eventId, draftType])
}

// ==========================================
// 4. APPROVAL MATRIX & IMMUTABLE AUDIT LOG
// ==========================================

enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
}

model ApprovalRequest {
  id                   String         @id @default(uuid())
  eventId              String
  event                Event          @relation(fields: [eventId], references: [id], onDelete: Cascade)
  draftId              String
  draft                EventDraft     @relation(fields: [draftId], references: [id], onDelete: Cascade)
  requestedById        String
  requestedBy          User           @relation("ApprovalRequester", fields: [requestedById], references: [id])
  requiredApproverRole String         // 'CLIENT_PRIMARY', 'OPS_MANAGER', 'OWNER'
  approvedById         String?
  approvedBy           User?          @relation("ApprovalResolver", fields: [approvedById], references: [id])
  status               ApprovalStatus @default(PENDING)
  rejectionReason      String?
  signatureHash        String?
  createdAt            DateTime       @default(now())
  resolvedAt           DateTime?
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

  @@index([tenantId, eventId])
}

// ==========================================
// 5. FINANCIALS, MILESTONES & DEPOSIT VAULT
// ==========================================

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

  milestones PaymentMilestone[]
}

model PaymentMilestone {
  id            String    @id @default(uuid())
  invoiceId     String
  invoice       Invoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  title         String
  amountDue     Decimal   @db.Decimal(12, 2)
  dueDate       DateTime
  paidAmount    Decimal   @default(0.00) @db.Decimal(12, 2)
  paymentMethod String?   // CASH, BANK_TRANSFER, E_WALLET, CARD
  receiptUrl    String?
  status        String    @default("PENDING") // PENDING, UNDER_REVIEW, PAID
  paidAt        DateTime?
}

// ==========================================
// 6. INVENTORY, BEO & SECURITY GATE PASSES
// ==========================================

model InventoryItem {
  id             String  @id @default(uuid())
  tenantId       String
  tenant         Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name           String
  category       String  // FURNITURE, AV_GEAR, LINENS, CONSUMABLES
  totalStock     Int
  unitAddonPrice Decimal @default(0.00) @db.Decimal(10, 2)

  allocations EventInventoryAllocation[]
}

model EventInventoryAllocation {
  id               String        @id @default(uuid())
  eventId          String
  event            Event         @relation(fields: [eventId], references: [id], onDelete: Cascade)
  itemId           String
  item             InventoryItem @relation(fields: [itemId], references: [id])
  quantityReserved Int
}

model GatePass {
  id             String    @id @default(uuid())
  eventId        String
  event          Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  passType       String    // GUEST_QR, VENDOR_CREW, VIP_PASS
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

## 4. Core Business Logic & State Machines

### 4.1 Double-Booking & Partition Hall Conflict Prevention
When evaluating availability for `Hall A` over `[startTime, endTime]`:
1. Expand requested range by cleaning buffers: `[startTime - cleaningBufferMinutes, endTime + cleaningBufferMinutes]`.
2. Query `Event` where `status IN ('HOLD_48H', 'CONTRACT_PENDING', 'CONFIRMED')` and `hallId IN (Hall A, Hall A.combinableWithHallId)` overlapping the expanded range.
3. For `HOLD_48H` bookings, set a Redis key with a 48-hour TTL (`hold:event:{id}`). A background worker checks expired holds and transitions `status` to `CANCELLED` if the first `PaymentMilestone` is not paid/under review.

### 4.2 Draft -> Approval -> Cross-ERP Sync Pipeline
1. **Draft Creation:** Any edit to Floor Plan, Catering Menu, Timeline, or Add-ons creates a new `EventDraft` with an incremented `versionNumber` and `status = DRAFT`.
2. **Lockout Check:** Before submitting a draft (`POST /drafts/:id/submit`), verify `now() < event.startTime - tenant.settings[lockHours]`. If past the lockout window, mark the draft as an **Urgent Post-Lock Change Request** requiring `OPS_MANAGER` override.
3. **Routing Logic:**
   * If `financialDelta > 0` and `requestedBy != primaryClientId`: Create `ApprovalRequest` for `CLIENT_PRIMARY`.
   * If `draftType == PACKAGE_QUOTE` and `discountPercent > staff.maxDiscountPercent`: Create `ApprovalRequest` for `OWNER` or `SALES_MANAGER`.
   * Once financial/client approvals pass, create `ApprovalRequest` for `OPS_MANAGER` (and `HEAD_CHEF` if `draftType == CATERING_MENU`).
4. **Cross-ERP Synchronization (`APPROVED_SYNCED`):**
   * **Finance Module:** Appends `financialDelta` to `Invoice.subtotal`, recalculates `taxAmount` and `totalAmount`, and updates unpaid `PaymentMilestone` records.
   * **Inventory Module:** Recalculates `EventInventoryAllocation` quantities (tables, chairs, AV equipment) and flags stock shortages across overlapping events.
   * **Operations & Kitchen (BEO):** Compiles the latest approved drafts into the live **Banquet Event Order (BEO)** visible on kitchen and floor tablets.
   * **Audit Log:** Records an immutable entry in `AuditLog` with `actorId`, `oldValue`, `newValue`, and timestamp.

### 4.3 Role-Based Permission Matrix

| Role | View Financials & Contracts | Edit Event Drafts | Approve Add-On Costs | Operational Feasibility Sign-Off | Synced ERP Views |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Primary Client (B2C/B2B)** | Full Access | Yes | Yes (Final Authority) | No | Client Portal, Invoices, BEO |
| **Client Delegate (Planner)** | Hidden (Unless Granted) | Yes | No (Request Only) | No | Floor Plan, Catering, Timeline |
| **External Vendor** | Hidden | Gate/Load-In Info Only | No | No | Gate Pass Submission |
| **Sales Rep / Manager** | Quote & Invoice View | Yes (Internal Drafts) | Up to Discount Limit | No | CRM, Calendar, Quotes |
| **Finance Officer** | Full Financial Access | Read-Only | Receipt & Refund Verify | No | Accounting, Tax, Deposit Vault |
| **Operations / Head Chef** | Hidden | Read-Only (Approved) | No | Yes (Feasibility Gate) | Live BEO, Inventory, Damage Check |
| **Security Supervisor** | Hidden | Hidden | No | No | QR Gate Scanner, VIP/Vendor Logs |

---

## 5. REST API Specification

### Authentication & Client Control Panel
* `POST /api/v1/auth/otp-login` — Phone/Email + 2FA OTP login returning JWT with `tenantId` and `role`.
* `GET /api/v1/portal/dashboard` — Returns active events, pending approval cards, countdown timers, and payment milestones.
* `POST /api/v1/portal/events/:id/delegates` — Invites a Co-Host, Wedding Planner, or Vendor with custom JSON permissions.
* `PATCH /api/v1/portal/profile` — Updates B2C National ID/Passport or B2B Commercial Registration, Tax ID, and Deposit Refund Bank/Wallet details.

### Booking & Dynamic Pricing
* `GET /api/v1/public/halls/availability` — Checks open slots accounting for cleaning buffers and combinable partition halls.
* `POST /api/v1/bookings/quote` — Calculates package pricing, seasonal multipliers, add-ons, and taxes.
* `POST /api/v1/bookings/hold` — Places a 48-hour `HOLD_48H` on the calendar and generates a digital contract PDF.

### Drafts, Approvals & Cross-ERP Sync
* `POST /api/v1/events/:id/drafts` — Saves a new versioned `EventDraft` (`FLOOR_PLAN`, `CATERING_MENU`, `TIMELINE_BEO`, `ADDON_REQUEST`).
* `POST /api/v1/drafts/:id/submit` — Validates lockout windows and routes to the required `ApprovalRequest` gates.
* `POST /api/v1/approvals/:id/resolve` — Approves or rejects a request; triggers Cross-ERP Sync upon final approval.

### Finance, Deposits, Operations & Security Gate
* `POST /api/v1/invoices/:id/milestones/:mId/receipt` — Client uploads bank/wallet transfer receipt.
* `PATCH /api/v1/erp/finance/milestones/:mId/verify` — Finance Officer verifies payment and updates invoice status.
* `POST /api/v1/erp/ops/events/:id/inspection` — Ops Manager submits post-event damage inspection (`INSPECTION_PASSED` or `DEDUCTED`), unlocking deposit refund for Finance.
* `GET /api/v1/erp/ops/events/:id/beo` — Live Banquet Event Order data for Kitchen and Floor tablets.
* `POST /api/v1/events/:id/gate-passes/bulk` — Generates unique QR tokens for guests and external vendor crews.
* `POST /api/v1/erp/security/scan` — Validates QR token against event time window and marks `isCheckedIn = true`.

---

## 6. UI/UX Screen Specifications

### 6.1 Client Account Control Panel (`/portal/dashboard`)
* **Top Bar:** Venue Branding, Active Event Switcher Dropdown, `AR/EN` Language Switcher, Notification Bell, Profile Menu.
* **Pending Approval Alert Banner:** Highlights delegate requests requiring client financial sign-off with `[Approve & Add to Invoice]` and `[Reject]` buttons.
* **KPI Cards:** Event Countdown & Lockout Timer, Contract E-Signature Status, Payment Milestone Progress Bar, Security Deposit Vault Status.
* **Workspace Tabs:**
  1. **Interactive Floor Plan (`Konva.js`):** Drag-and-drop Stage, VIP Tables, Guest Tables, Save Draft, Version History Rollback, Submit for Approval.
  2. **Catering & Timeline:** Menu selection, dietary allergy notes, minute-by-minute event schedule.
  3. **Team & Vendor Delegation:** Add/revoke Planners and Vendors with granular permission switches.
  4. **Guest List & QR Invitations:** CSV/Excel import generating downloadable/WhatsApp-ready QR entry cards.
  5. **Account & Audit Vault:** B2C/B2B Tax profile, Deposit Refund IBAN/Wallet settings, 2FA toggle, and immutable Audit Log.

### 6.2 Internal ERP Operations Hub (`/erp/dashboard`)
* **Master Hall Gantt Calendar:** Color-coded timeline (`Green = Confirmed`, `Yellow = 48h Hold`, `Grey = Cleaning Buffer`).
* **Unified Approval Queue:** Side-by-side JSON diff viewer comparing the current approved BEO/Quote against incoming draft changes.
* **Live BEO Tablet View:** High-contrast kitchen and floor display showing headcount, meal service timestamps, and special equipment allocations.
* **Security Gate Scanner PWA:** Mobile-friendly camera QR scanner with instant green/red validity feedback.

---

## 7. Step-by-Step AI Coding Agent Execution Prompts

Run these prompts sequentially in your coding agent:

1. **Prompt 1 — Monorepo & Database Setup:**
   > "Initialize a Turborepo monorepo with a NestJS backend (`apps/api`), a Next.js 14 App Router frontend (`apps/web`) configured with Tailwind CSS, Shadcn/UI, and `next-intl` (Arabic RTL and English LTR), and a shared Prisma package (`packages/database`). Use the exact `schema.prisma` from Section 3, generate migrations, and create a `docker-compose.yml` with PostgreSQL and Redis."

2. **Prompt 2 — Multi-Tenant Auth, Profiles & RBAC:**
   > "Implement JWT + OTP authentication in `apps/api` supporting `INTERNAL_STAFF`, `CLIENT_PRIMARY` (B2C & B2B), `CLIENT_DELEGATE`, and `EXTERNAL_VENDOR`. Enforce `tenantId` isolation via global NestJS guards/interceptors and build the Client Control Panel profile and delegation endpoints."

3. **Prompt 3 — Availability Engine, Dynamic Pricing & Contracts:**
   > "Build the Hall Availability Engine in `apps/api` with cleaning buffer calculations, partition-hall conflict detection, and Redis-backed 48-hour tentative holds (`HOLD_48H`). Implement the Instant Quote Calculator and automated PDF contract generation."

4. **Prompt 4 — Draft Versioning, Multi-Tier Approvals & Cross-ERP Sync:**
   > "Implement the `EventDraft` versioning system with automated lockout windows and the `ApprovalRequest` state machine. When a draft reaches `APPROVED_SYNCED`, emit an internal event that automatically updates `Invoice` totals, `PaymentMilestone` balances, `EventInventoryAllocation` counts, the live BEO, and `AuditLog`."

5. **Prompt 5 — Frontend Portals, Interactive Floor Plan & QR Gate Scanner:**
   > "Build the bilingual RTL/LTR Next.js interfaces for the Client Control Panel (including the `react-konva` drag-and-drop floor plan editor, milestone receipt uploader, and audit log viewer) and the Internal ERP (Master Gantt Calendar, Split-Screen Approval Diff Queue, Live Kitchen BEO, and Mobile QR Gate Scanner)."
