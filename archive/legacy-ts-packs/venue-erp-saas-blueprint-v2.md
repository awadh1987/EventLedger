# Master Software Architecture & Execution Blueprint (v2.0 - Enterprise SaaS Edition)
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Target Execution:** AI Coding Agents (Cursor, Windsurf, Claude Code, Devin)  
**Localization:** Bilingual First (Arabic `dir="rtl"` & English `dir="ltr"`)  

---

## 1. Executive Summary & System Vision
This system is an **Enterprise Multi-Tenant SaaS ERP & Interactive Client Portal** designed specifically for wedding halls, event venues, and conference centers. It eliminates double-bookings, prevents revenue leakage, enforces multi-tier approval workflows, centralizes omnichannel client communication, and synchronizes all operations across **Sales, Finance, Kitchen/Catering, Operations, Inventory, Event P&L Accounting, and Offline-Capable QR Gate Control** in real time.

### Core Architectural Pillars
1. **Multi-Tenant SaaS Isolation & Super-Admin:** Supports unlimited venue organizations (`Tenants`), white-label subdomains, subscription plans, message quotas, and partitionable halls that merge into larger spaces.
2. **Client Account Control Panel:** Full self-service portal for B2C (Individuals/Weddings) and B2B (Corporates/Conferences) with granular sub-user delegation (Wedding Planners, Co-Hosts, External Vendors).
3. **Versioned Draft & Lockout Engine:** Clients and planners experiment safely in `DRAFT` mode without disrupting kitchen or floor operations. Automated lockout windows freeze edits prior to the event (e.g., Catering locks 72h before; Floor Plan locks 24h before).
4. **Multi-Tier Approval Matrix & Cross-ERP Sync:** Paid add-ons require Primary Client sign-off; operational changes require Operations/Kitchen sign-off; discounts above staff limits require Owner/Manager sign-off. Approved drafts automatically sync across Finance, Inventory, Kitchen BEOs, and Gate Passes.
5. **Omnichannel Communication Chain:** Unifies In-App Event Threads, WhatsApp Business API webhooks, SMS OTP/alerts, Email PDFs, and real-time WebSockets into a single auditable timeline.
6. **Financial, Deposit Vault & Event P&L Engine:** Enforces payment milestones, receipt verification, immutable tax ledger rules, refundable security deposit inspections, dynamic pricing rules, and per-event profit/loss calculation.
7. **Offline-First Gate Control & Live BEO:** Local PWA caching ensures QR guest check-ins and kitchen BEO screens function uninterrupted even during internet outages.

---

## 2. Recommended Tech Stack & Repository Structure

### Tech Stack
* **Monorepo Manager:** Turborepo (`pnpm`)
* **Backend API:** Node.js + NestJS + TypeScript (strict typing for AI coding agents) + `@nestjs/event-emitter` (Cross-ERP sync bus) + BullMQ (delayed jobs & WhatsApp/SMS queues)
* **Database & ORM:** PostgreSQL 16 + Prisma ORM + Redis (48h tentative hold TTL locks, pub/sub WebSockets, BullMQ)
* **Frontend (ERP + Client Portal + Offline Gate PWA):** Next.js 14+ (App Router) + Tailwind CSS + Shadcn/UI + `next-intl` (Arabic RTL / English LTR) + Service Workers / IndexedDB (Offline Gate Scanner & BEO caching)
* **Interactive Floor Plan Canvas:** `react-konva` / `konva` (drag-and-drop tables, VIP zones, stage layouts)
* **PDF & QR Generation:** `@react-pdf/renderer` or `pdf-lib` (Contracts, Tax Invoices, Credit Notes, BEOs) + `qrcode` (Guest & Vendor Gate Passes)
* **Storage & Messaging:** S3-compatible storage (Cloudflare R2 / AWS S3 / MinIO) + WhatsApp Business Cloud API + SMS Gateway

### Monorepo Folder Structure
```text
venue-erp-saas/
├── apps/
│   ├── api/                        # NestJS Backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── super-admin/    # SaaS tenant onboarding, plans, usage quotas
│   │   │   │   ├── auth/           # OTP, 2FA, RBAC, Multi-Tenant Guards
│   │   │   │   ├── tenants/        # Tenant branding, branches, partitionable halls
│   │   │   │   ├── bookings/       # Availability engine, 48h holds, dynamic pricing rules
│   │   │   │   ├── drafts/         # Versioned drafts, lockout windows, JSON diff engine
│   │   │   │   ├── approvals/      # Multi-tier approval state machine & Cross-ERP sync bus
│   │   │   │   ├── comms/          # Omnichannel event threads, WhatsApp webhooks, SMS/Email
│   │   │   │   ├── finance/        # Invoices, credit notes, milestones, deposit vault, Event P&L
│   │   │   │   ├── operations/     # Live BEO generator, kitchen recipes/POs, damage inspection
│   │   │   │   ├── inventory/      # Furniture/AV stock & event allocations
│   │   │   │   └── gate-passes/    # QR generation, offline manifest sync & scanner validation
│   │   │   └── common/             # Tenant interceptor, audit log decorator
│   └── web/                        # Next.js Frontend (ERP + Client Portal + PWA)
│       ├── src/
│       │   ├── app/[locale]/
│       │   │   ├── (public)/       # Live availability calendar & instant quote builder
│       │   │   ├── (portal)/       # Client Account Control Panel & Floor Plan Designer
│       │   │   ├── (erp)/          # Internal Staff ERP (Sales, Finance, Kitchen, Ops, P&L)
│       │   │   └── (pwa-gate)/     # Offline-capable Security Gate QR Scanner & Kitchen BEO
│       │   └── components/
│       │       ├── floorplan/      # Konva.js drag-and-drop hall layout editor
│       │       ├── comms/          # Unified WhatsApp + In-App Event Chat Thread
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
// 1. MULTI-TENANCY, SAAS PLANS & VENUES
// ==========================================

enum SubscriptionPlan {
  BASIC
  PRO
  ENTERPRISE
}

model Tenant {
  id               String           @id @default(uuid())
  name             String
  slug             String           @unique
  customDomain     String?          @unique
  plan             SubscriptionPlan @default(PRO)
  currency         String           @default("YER") // Supports YER, SAR, USD, AED
  taxRate          Decimal          @default(0.00) @db.Decimal(5, 2)
  whatsappConfig   Json?            // { "phoneNumberId": "...", "accessToken": "...", "webhookVerifyToken": "..." }
  settings         Json             // { "cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48, "defaultSecurityDeposit": 150000 }
  isActive         Boolean          @default(true)
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  halls          Hall[]
  pricingRules   PricingRule[]
  users          User[]
  events         Event[]
  invoices       Invoice[]
  expenses       EventExpense[]
  inventoryItems InventoryItem[]
  cateringItems  CateringMenuItem[]
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
  combinableWithHallId  String?  // Partition hall merging logic
  isActive              Boolean  @default(true)

  events       Event[]
  pricingRules PricingRule[]

  @@index([tenantId])
}

model PricingRule {
  id         String    @id @default(uuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  hallId     String?
  hall       Hall?     @relation(fields: [hallId], references: [id], onDelete: Cascade)
  name       String    // e.g., "Weekend Peak (+25%)", "Eid Season (+40%)", "Midweek Discount (-15%)"
  daysOfWeek Int[]     // 0=Sun .. 4=Thu, 5=Fri, 6=Sat
  startDate  DateTime?
  endDate    DateTime?
  multiplier Decimal   @db.Decimal(4, 2) // e.g., 1.25 for +25%, 0.85 for -15%
  isActive   Boolean   @default(true)

  @@index([tenantId])
}

// ==========================================
// 2. UNIFIED USERS, STAFF & CLIENT PROFILES
// ==========================================

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

model User {
  id            String   @id @default(uuid())
  tenantId      String?  // Null only for SaaS Platform SUPER_ADMIN
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
  sentMessages       EventMessage[]
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
  messages             EventMessage[]
  invoices             Invoice[]
  expenses             EventExpense[]
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
  permissions  Json         // { "canViewFinance": false, "canEditFloorplan": true, "canEditCatering": true, "canRequestAddons": true }

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
// 4. APPROVAL MATRIX, COMMS & AUDIT LOG
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
  requiredApproverRole String         // 'CLIENT_PRIMARY', 'OPS_MANAGER', 'HEAD_CHEF', 'OWNER'
  approvedById         String?
  approvedBy           User?          @relation("ApprovalResolver", fields: [approvedById], references: [id])
  status               ApprovalStatus @default(PENDING)
  rejectionReason      String?
  signatureHash        String?
  createdAt            DateTime       @default(now())
  resolvedAt           DateTime?
}

enum MessageChannel {
  IN_APP
  WHATSAPP
  SMS
  EMAIL
  SYSTEM_BOT
}

model EventMessage {
  id          String         @id @default(uuid())
  eventId     String
  event       Event          @relation(fields: [eventId], references: [id], onDelete: Cascade)
  senderId    String
  sender      User           @relation(fields: [senderId], references: [id])
  channel     MessageChannel @default(IN_APP)
  department  String?        // ALL, FINANCE, OPS, KITCHEN
  content     String
  attachments Json?
  externalId  String?        // WhatsApp/SMS provider message SID for webhook delivery status
  isInternal  Boolean        @default(false) // True = Staff-only internal note
  createdAt   DateTime       @default(now())

  @@index([eventId, createdAt])
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
// 5. FINANCIALS, MILESTONES, DEPOSITS & P&L
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
  CREDIT_NOTE
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

model EventExpense {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  eventId     String
  event       Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  category    String   // CATERING_RAW, TEMP_STAFF, VENDOR_PAYOUT, UTILITIES, DAMAGE_REPAIR
  description String
  amount      Decimal  @db.Decimal(12, 2)
  recordedBy  String
  createdAt   DateTime @default(now())

  @@index([tenantId, eventId])
}

// ==========================================
// 6. INVENTORY, CATERING RECIPES & QR GATES
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

model CateringMenuItem {
  id              String  @id @default(uuid())
  tenantId        String
  tenant          Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name            String
  nameAr          String
  unitPrice       Decimal @db.Decimal(10, 2) // Selling price per guest/tray
  estimatedCost   Decimal @db.Decimal(10, 2) // Raw ingredient cost for Event P&L
  recipeBom       Json?   // [{ "ingredient": "Basmati Rice", "qtyPerPortion": 0.25, "unit": "kg" }]
  isActive        Boolean @default(true)
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

## 4. Omnichannel Communication Chain & Webhook Engine

To eliminate scattered phone messages and establish a legally auditable communication trail, every event runs a unified **Communication Bus**:

### 4.1 Supported Channels
1. **In-App Event Thread (`EventMessage`):** Real-time chat embedded in both the Client Control Panel and Internal ERP. Supports `@Department` mentions (`@Finance`, `@Kitchen`, `@Ops`), file attachments, and inline approval cards.
2. **WhatsApp Business Cloud API:** Primary external messaging channel for automated alerts, payment reminders, one-click approval links, and bulk QR Guest Invitations. Two-way webhooks capture client WhatsApp replies and append them directly into `EventMessage`.
3. **SMS Gateway:** High-priority delivery for 2FA OTP authentication codes and urgent post-lockout alerts.
4. **Email & WebSockets:** Email delivers formal B2B tax invoices, signed PDF contracts, and consolidated P&L/financial statements. Redis-backed WebSockets push live updates to ERP Approval Queues, Kitchen BEO tablets, and Gate Scanners.

### 4.2 Automated Trigger Matrix

| Trigger Event | Target Recipient(s) | Primary Channel | Secondary / Fallback | Logged in Event Thread? |
| :--- | :--- | :--- | :--- | :--- |
| **48h Hold Created** | Primary Client + Sales Rep | WhatsApp + In-App | Email (Contract PDF) | Yes (`SYSTEM_BOT`) |
| **Hold Expiring in 6 Hours** | Primary Client | WhatsApp + SMS | In-App Alert Banner | Yes (`SYSTEM_BOT`) |
| **Planner Submits Paid Add-On** | Primary Client (Payer) | WhatsApp (Action Link) | In-App Approval Card | Yes (`SYSTEM_BOT`) |
| **Client Approves Add-On** | Ops Manager + Finance + Chef | WebSocket (ERP Push) | In-App Notification | Yes (`SYSTEM_BOT`) |
| **Client Uploads Bank Receipt** | Finance Officer | WebSocket + In-App | Email | Yes (`SYSTEM_BOT`) |
| **72h Catering Lockout Warning** | Client + Wedding Planner | WhatsApp + In-App | Email | Yes (`SYSTEM_BOT`) |
| **Urgent Post-Lock Change** | Venue Owner + Ops Manager | WhatsApp + Mobile Push | SMS | Yes (`SYSTEM_BOT`) |
| **Event Confirmed (-3 Days)** | Invited Guests + External Vendors | WhatsApp (QR Pass Card) | SMS Link | Yes (`SYSTEM_BOT`) |
| **Post-Event Inspection Passed** | Finance Officer + Client | In-App + WhatsApp | Email (Refund Receipt) | Yes (`SYSTEM_BOT`) |

---

## 5. Core Business Logic & State Machines

### 5.1 Double-Booking, Partition Hall & Dynamic Pricing Engine
1. **Availability Window:** Expand requested `[startTime, endTime]` by `cleaningBufferMinutes` on both ends. Check for overlapping events (`HOLD_48H`, `CONTRACT_PENDING`, `CONFIRMED`) on both `hallId` and `hall.combinableWithHallId`.
2. **Dynamic Quote Calculation:** Apply active `PricingRule` multipliers matching the booking's `daysOfWeek` or seasonal `[startDate, endDate]` range, add selected packages/add-ons, and apply `tenant.taxRate`.
3. **48-Hour Tentative Hold:** Store `hold:event:{id}` in Redis with a 48-hour TTL. A BullMQ delayed job fires at `T+42h` (6h warning via WhatsApp/SMS) and `T+48h` (auto-cancels unpaid holds).

### 5.2 Draft -> Approval -> Cross-ERP Sync Pipeline
1. **Draft Isolation:** Edits create a new `EventDraft` (`versionNumber + 1`, `status = DRAFT`). Zero operational impact until submitted.
2. **Lockout Enforcement:** On `POST /drafts/:id/submit`, compare `now()` against `event.startTime - tenant.settings[lockHours]`. Past-lockout submissions require `OPS_MANAGER` override.
3. **Multi-Tier Routing:**
   * `financialDelta > 0` & submitted by delegate -> Route to `CLIENT_PRIMARY` first.
   * `discountPercent > staff.maxDiscountPercent` -> Route to `OWNER` or `SALES_MANAGER`.
   * Operational/Menu changes -> Route to `OPS_MANAGER` (and `HEAD_CHEF` if `CATERING_MENU`).
4. **Cross-ERP Synchronization (`APPROVED_SYNCED`):**
   * **Finance:** Updates `Invoice` totals and unpaid `PaymentMilestone` balances. Prohibits hard-deleting issued invoices (uses `CREDIT_NOTE` for reductions).
   * **Inventory & Kitchen:** Updates `EventInventoryAllocation` counts, calculates raw ingredient needs from `CateringMenuItem.recipeBom`, and updates live BEO tablets.
   * **Audit & Comms:** Appends immutable `AuditLog` record and posts a `SYSTEM_BOT` summary to `EventMessage`.

### 5.3 Event Profit & Loss (P&L) & Offline Gate Resilience
* **Event P&L Formula:** `Net Profit = Invoice.totalAmount - Invoice.taxAmount - SUM(EventExpense.amount) - SalesCommission`.
* **Offline Gate PWA:** 2 hours before `event.startTime`, the Security Gate PWA downloads an encrypted manifest of all `GatePass.qrToken` hashes for that event into IndexedDB. Guards can scan guest and vendor QR codes offline; check-in timestamps sync back to the server automatically when connectivity resumes.

---

## 6. REST API Specification

### Super-Admin & Tenant Configuration
* `POST /api/v1/super-admin/tenants` — Onboards a new venue tenant, configures subscription plan, currency, and custom subdomain.
* `POST /api/v1/erp/settings/pricing-rules` — Creates weekend/seasonal dynamic pricing multipliers.

### Auth, Client Control Panel & Omnichannel Comms
* `POST /api/v1/auth/otp-login` — Phone/Email + 2FA OTP login returning scoped JWT (`tenantId`, `role`).
* `GET /api/v1/portal/dashboard` — Active events, pending approval cards, countdown timers, and payment milestones.
* `POST /api/v1/portal/events/:id/delegates` — Invites Co-Host, Wedding Planner, or Vendor with custom JSON permissions.
* `GET /api/v1/events/:id/messages` & `POST /api/v1/events/:id/messages` — Unified event chat thread (supports `isInternal` staff notes).
* `POST /api/v1/webhooks/whatsapp` — Receives incoming WhatsApp messages and delivery receipts, mapping them to `EventMessage`.

### Bookings, Drafts & Multi-Tier Approvals
* `GET /api/v1/public/halls/availability` — Returns open slots with dynamic seasonal pricing and partition-hall checks.
* `POST /api/v1/bookings/hold` — Places a 48-hour `HOLD_48H` and generates a PDF contract.
* `POST /api/v1/events/:id/drafts` — Auto-saves versioned drafts (`FLOOR_PLAN`, `CATERING_MENU`, `TIMELINE_BEO`, `ADDON_REQUEST`).
* `POST /api/v1/drafts/:id/submit` & `POST /api/v1/approvals/:id/resolve` — Routes approvals and triggers Cross-ERP Sync.

### Finance, P&L, Operations & Offline Gate Control
* `POST /api/v1/invoices/:id/milestones/:mId/receipt` — Uploads payment transfer receipt.
* `PATCH /api/v1/erp/finance/milestones/:mId/verify` — Verifies payment receipt and updates invoice balance.
* `POST /api/v1/erp/ops/events/:id/inspection` — Submits post-event damage check to release or deduct the security deposit.
* `GET /api/v1/erp/finance/events/:id/pnl` — Calculates real-time Event Profit & Loss (`Revenue vs. Catering BOM + Temp Staff + Expenses`).
* `GET /api/v1/erp/security/events/:id/offline-manifest` — Downloads encrypted QR token list for offline PWA gate scanning.
* `POST /api/v1/erp/security/scan-batch` — Validates single or batched offline QR check-ins.

---

## 7. Step-by-Step AI Coding Agent Execution Prompts

Run these prompts sequentially in your coding agent:

1. **Prompt 1 — Monorepo, Multi-Tenant Schema & Infrastructure:**
   > "Initialize a Turborepo monorepo with a NestJS backend (`apps/api`), a Next.js 14 App Router frontend (`apps/web`) configured with Tailwind CSS, Shadcn/UI, and `next-intl` (Arabic RTL and English LTR), and a shared Prisma package (`packages/database`). Implement the exact `schema.prisma` from Section 3 and configure `docker-compose.yml` with PostgreSQL, Redis, and MinIO."

2. **Prompt 2 — Super-Admin, Multi-Tenant Auth & Client Control Panel:**
   > "Implement JWT + OTP authentication in `apps/api` supporting `SUPER_ADMIN`, `INTERNAL_STAFF`, `CLIENT_PRIMARY` (B2C & B2B), `CLIENT_DELEGATE`, and `EXTERNAL_VENDOR`. Enforce `tenantId` isolation via global NestJS guards, and build the Client Account Control Panel with sub-user delegation, B2C/B2B tax profiles, and deposit refund bank/wallet settings."

3. **Prompt 3 — Availability Engine, Dynamic Pricing & 48h Holds:**
   > "Build the Hall Availability Engine in `apps/api` with cleaning buffers, partition-hall conflict checks, `PricingRule` seasonal/weekend multipliers, and BullMQ + Redis 48-hour tentative holds (`HOLD_48H`) with automated 6-hour expiration warnings."

4. **Prompt 4 — Versioned Drafts, Multi-Tier Approvals & Cross-ERP Sync:**
   > "Implement the `EventDraft` versioning engine with automated lockout windows and the `ApprovalRequest` state machine. When a draft reaches `APPROVED_SYNCED`, emit an internal event that updates `Invoice` totals, `PaymentMilestone` balances, `EventInventoryAllocation` counts, the live BEO, and `AuditLog`."

5. **Prompt 5 — Omnichannel Comms (WhatsApp Webhooks), Event P&L & Offline Gate PWA:**
   > "Build the unified `EventMessage` chat module with WhatsApp Business API webhook ingestion and automated trigger alerts, the Event Profit & Loss (`EventExpense` + `CateringMenuItem` BOM) dashboard, the `react-konva` drag-and-drop Floor Plan Designer, and the offline-capable PWA Security Gate QR Scanner."
