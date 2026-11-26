# Enterprise SaaS Execution Pack (v3.0 - Production Modules, UI Theme & Accounting Engine)
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Includes:** NestJS Approval & Comms Services, Double-Entry Accounting Config, Full Item Lifecycle (Draft/Save/Archive/Soft-Delete), CSV Import & Bilingual PDF Export, Tenant White-Label Branding (Logo/Favicon), and Interactive Hover-Spotlight Dark/Light UI System.

---

## 1. Schema Additions (`schema-v3-extensions.prisma`)

Append these models and fields to your `packages/database/prisma/schema.prisma` to support **White-Label Branding**, **Full Item Lifecycle (`DRAFT`, `ACTIVE`, `ARCHIVED`, `DELETED`)**, **Double-Entry Accounting**, and **Dropdown Lookups**:

```prisma
// ==========================================
// A. WHITE-LABEL BRANDING & THEME CONFIG
// ==========================================

model TenantBranding {
  tenantId        String  @id
  tenant          Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  logoLightUrl    String?
  logoDarkUrl     String?
  faviconUrl      String?
  primaryColor    String  @default("#D4AF37") // Royal Gold
  accentColor     String  @default("#1E293B")
  defaultTheme    String  @default("SYSTEM")  // LIGHT, DARK, SYSTEM
  enableHoverGlow Boolean @default(true)      // Mouse-tracking spotlight glow on cards & titles
  footerTextAr    String?
  footerTextEn    String?
}

// ==========================================
// B. FULL ITEM LIFECYCLE & DYNAMIC DROPDOWNS
// ==========================================

enum RecordLifecycle {
  DRAFT
  ACTIVE
  ARCHIVED
  DELETED
}

// Add `lifecycle RecordLifecycle @default(ACTIVE)` and `deletedAt DateTime?`
// to Hall, InventoryItem, CateringMenuItem, PricingRule, and Event.

model SystemLookup {
  id        String          @id @default(uuid())
  tenantId  String
  tenant    Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  category  String          // EVENT_TYPE, PAYMENT_METHOD, EXPENSE_CATEGORY, INVENTORY_CATEGORY, UNIT_TYPE
  code      String          // e.g., 'WEDDING', 'KURAIMI_TRANSFER', 'CATERING_RAW'
  labelAr   String          // e.g., 'حفل زفاف', 'تحويل الكريمي'
  labelEn   String          // e.g., 'Wedding', 'Al-Kuraimi Transfer'
  sortOrder Int             @default(0)
  lifecycle RecordLifecycle @default(ACTIVE)

  @@unique([tenantId, category, code])
  @@index([tenantId, category])
}

// ==========================================
// C. DOUBLE-ENTRY ACCOUNTING ENGINE
// ==========================================

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
}

model ChartOfAccount {
  id            String          @id @default(uuid())
  tenantId      String
  tenant        Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  code          String          // e.g., "1101" (Cash/Bank), "2101" (Client Deposits Held), "4101" (Hall Revenue)
  nameAr        String
  nameEn        String
  accountType   AccountType
  isSystem      Boolean         @default(false) // Prevents deletion of core accounts
  lifecycle     RecordLifecycle @default(ACTIVE)
  journalLines  JournalLine[]

  @@unique([tenantId, code])
}

model AccountingConfig {
  tenantId                String  @id
  tenant                  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  cashBankAccountId       String  // Debit when payment received
  accountsReceivableId    String  // Debit when invoice issued
  hallRevenueAccountId    String  // Credit for hall rental revenue
  cateringRevenueId       String  // Credit for catering revenue
  taxPayableAccountId     String  // Credit for VAT/Tax collected
  securityDepositLiabId   String  // Credit when security deposit held (Liability, not Revenue!)
  discountExpenseId       String  // Debit for discounts granted
  cogsExpenseAccountId    String  // Debit for event expenses / catering raw cost
  fiscalYearStartMonth    Int     @default(1)
  autoPostOnVerify        Boolean @default(true)
}

model JournalEntry {
  id          String        @id @default(uuid())
  tenantId    String
  tenant      Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  eventId     String?
  entryNumber String        @unique // e.g., "JE-2026-0001"
  entryDate   DateTime      @default(now())
  reference   String        // e.g., "Invoice INV-2026-0001 Payment"
  status      String        @default("POSTED") // DRAFT, POSTED, REVERSED
  createdById String
  lines       JournalLine[]

  @@index([tenantId, entryDate])
}

model JournalLine {
  id          String         @id @default(uuid())
  entryId     String
  entry       JournalEntry   @relation(fields: [entryId], references: [id], onDelete: Cascade)
  accountId   String
  account     ChartOfAccount @relation(fields: [accountId], references: [id])
  description String?
  debit       Decimal        @default(0.00) @db.Decimal(14, 2)
  credit      Decimal        @default(0.00) @db.Decimal(14, 2)
}
```

---

## 2. NestJS Backend: Approvals, Cross-ERP Sync & Double-Entry Posting

### 2.1 `apps/api/src/modules/approvals/approvals.service.ts`

```typescript
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DraftStatus, ApprovalStatus } from '@prisma/client';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async submitDraftForApproval(tenantId: string, draftId: string, actorId: string) {
    const draft = await this.prisma.eventDraft.findUnique({
      where: { id: draftId },
      include: { event: { include: { tenant: true } } },
    });

    if (!draft || draft.event.tenantId !== tenantId) {
      throw new BadRequestException('Draft not found');
    }

    const settings = draft.event.tenant.settings as any;
    const lockHours =
      draft.draftType === 'CATERING_MENU'
        ? settings.cateringLockHours ?? 72
        : settings.floorPlanLockHours ?? 24;

    const lockoutTime = new Date(draft.event.startTime.getTime() - lockHours * 3600 * 1000);
    const isPastLockout = new Date() > lockoutTime;

    // Determine required approver gate
    let requiredApproverRole = 'OPS_MANAGER';
    let nextDraftStatus: DraftStatus = DraftStatus.PENDING_INTERNAL_APPROVAL;

    if (Number(draft.financialDelta) > 0 && actorId !== draft.event.primaryClientId) {
      requiredApproverRole = 'CLIENT_PRIMARY';
      nextDraftStatus = DraftStatus.PENDING_CLIENT_APPROVAL;
    } else if (isPastLockout) {
      requiredApproverRole = 'OWNER';
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.eventDraft.update({
        where: { id: draftId },
        data: { status: nextDraftStatus },
      });

      const approval = await tx.approvalRequest.create({
        data: {
          eventId: draft.eventId,
          draftId: draft.id,
          requestedById: actorId,
          requiredApproverRole,
          status: ApprovalStatus.PENDING,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          eventId: draft.eventId,
          actorId,
          action: isPastLockout ? 'POST_LOCKOUT_DRAFT_SUBMITTED' : 'DRAFT_SUBMITTED',
          newValue: { draftId, requiredApproverRole, financialDelta: draft.financialDelta },
        },
      });

      this.eventEmitter.emit('approval.created', { tenantId, approval, draft, isPastLockout });
      return approval;
    });
  }

  async resolveApproval(
    tenantId: string,
    approvalId: string,
    resolverId: string,
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { draft: true, event: true },
    });

    if (!approval || approval.event.tenantId !== tenantId) {
      throw new BadRequestException('Approval request not found');
    }
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Approval already resolved');
    }

    if (decision === 'REJECTED') {
      return this.prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({
          where: { id: approvalId },
          data: {
            status: ApprovalStatus.REJECTED,
            approvedById: resolverId,
            rejectionReason,
            resolvedAt: new Date(),
          },
        });
        await tx.eventDraft.update({
          where: { id: approval.draftId },
          data: { status: DraftStatus.REJECTED },
        });
        this.eventEmitter.emit('approval.rejected', { tenantId, approval, rejectionReason });
        return { status: 'REJECTED' };
      });
    }

    // If Client approved a paid add-on, chain to OPS_MANAGER for operational feasibility
    if (approval.requiredApproverRole === 'CLIENT_PRIMARY') {
      return this.prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({
          where: { id: approvalId },
          data: { status: ApprovalStatus.APPROVED, approvedById: resolverId, resolvedAt: new Date() },
        });
        await tx.eventDraft.update({
          where: { id: approval.draftId },
          data: { status: DraftStatus.PENDING_INTERNAL_APPROVAL },
        });
        const nextGate = await tx.approvalRequest.create({
          data: {
            eventId: approval.eventId,
            draftId: approval.draftId,
            requestedById: approval.requestedById,
            requiredApproverRole: 'OPS_MANAGER',
            status: ApprovalStatus.PENDING,
          },
        });
        this.eventEmitter.emit('approval.chained_to_ops', { tenantId, nextGate });
        return { status: 'CHAINED_TO_OPS', nextGate };
      });
    }

    // Final Approval -> Sync across Finance, Inventory, Kitchen BEO & Accounting
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalRequest.update({
        where: { id: approvalId },
        data: { status: ApprovalStatus.APPROVED, approvedById: resolverId, resolvedAt: new Date() },
      });
      await tx.eventDraft.update({
        where: { id: approval.draftId },
        data: { status: DraftStatus.APPROVED_SYNCED },
      });

      // Emit Cross-ERP Sync Event
      this.eventEmitter.emit('erp.draft.synced', {
        tenantId,
        eventId: approval.eventId,
        draft: approval.draft,
        resolverId,
      });

      return { status: 'APPROVED_SYNCED' };
    });
  }
}
```

### 2.2 `apps/api/src/modules/finance/double-entry.service.ts`

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
}

@Injectable()
export class DoubleEntryService {
  constructor(private readonly prisma: PrismaService) {}

  async postBalancedEntry(
    tenantId: string,
    createdById: string,
    reference: string,
    lines: JournalLineInput[],
    eventId?: string,
  ) {
    const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.009 || totalDebit <= 0) {
      throw new BadRequestException(
        `Unbalanced Journal Entry: Debit (${totalDebit}) != Credit (${totalCredit})`,
      );
    }

    const entryNumber = `JE-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    return this.prisma.journalEntry.create({
      data: {
        tenantId,
        eventId,
        entryNumber,
        reference,
        createdById,
        status: 'POSTED',
        lines: {
          create: lines.map((l) => ({
            accountId: l.accountId,
            description: l.description,
            debit: new Prisma.Decimal(l.debit),
            credit: new Prisma.Decimal(l.credit),
          })),
        },
      },
      include: { lines: true },
    });
  }

  /**
   * Automatically posts double-entry lines when Finance verifies a client payment milestone
   */
  async postPaymentVerification(
    tenantId: string,
    financeUserId: string,
    eventId: string,
    invoiceNumber: string,
    amountPaid: number,
    isSecurityDeposit: boolean,
  ) {
    const config = await this.prisma.accountingConfig.findUnique({ where: { tenantId } });
    if (!config || !config.autoPostOnVerify) return null;

    const creditAccountId = isSecurityDeposit
      ? config.securityDepositLiabId // Held as Liability until post-event inspection
      : config.accountsReceivableId; // Reduces Client Receivable

    return this.postBalancedEntry(
      tenantId,
      financeUserId,
      `${isSecurityDeposit ? 'Security Deposit' : 'Payment'} Verified - ${invoiceNumber}`,
      [
        { accountId: config.cashBankAccountId, description: 'Cash/Bank Inflow', debit: amountPaid, credit: 0 },
        { accountId: creditAccountId, description: invoiceNumber, debit: 0, credit: amountPaid },
      ],
      eventId,
    );
  }
}
```

### 2.3 `apps/api/src/modules/comms/comms.service.ts` (Omnichannel + WhatsApp Webhook)

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageChannel } from '@prisma/client';

@Injectable()
export class CommsService {
  constructor(private readonly prisma: PrismaService) {}

  async sendEventMessage(params: {
    eventId: string;
    senderId: string;
    channel: MessageChannel;
    content: string;
    department?: string;
    isInternal?: boolean;
  }) {
    const msg = await this.prisma.eventMessage.create({
      data: {
        eventId: params.eventId,
        senderId: params.senderId,
        channel: params.channel,
        department: params.department ?? 'ALL',
        content: params.content,
        isInternal: params.isInternal ?? false,
      },
    });

    if (params.channel === MessageChannel.WHATSAPP && !params.isInternal) {
      // Queue outbound WhatsApp Business Cloud API call via BullMQ
      await this.dispatchWhatsAppTemplate(params.eventId, params.content);
    }
    return msg;
  }

  async handleIncomingWhatsAppWebhook(payload: any) {
    const entry = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message) return { status: 'ignored' };

    const senderPhone = `+${message.from}`;
    const textBody = message.text?.body ?? '[Media Attachment]';

    const user = await this.prisma.user.findUnique({ where: { phone: senderPhone } });
    if (!user) return { status: 'unknown_sender' };

    const activeEvent = await this.prisma.event.findFirst({
      where: { primaryClientId: user.id, status: { in: ['HOLD_48H', 'CONTRACT_PENDING', 'CONFIRMED'] } },
      orderBy: { startTime: 'asc' },
    });

    if (activeEvent) {
      await this.prisma.eventMessage.create({
        data: {
          eventId: activeEvent.id,
          senderId: user.id,
          channel: MessageChannel.WHATSAPP,
          content: textBody,
          externalId: message.id,
          isInternal: false,
        },
      });
    }
    return { status: 'synced' };
  }

  @OnEvent('erp.draft.synced')
  async notifyOnDraftSynced(payload: { tenantId: string; eventId: string; draft: any; resolverId: string }) {
    await this.sendEventMessage({
      eventId: payload.eventId,
      senderId: payload.resolverId,
      channel: MessageChannel.SYSTEM_BOT,
      content: `✅ Draft v${payload.draft.versionNumber} (${payload.draft.draftType}) approved and synced across Finance, Inventory & BEO.`,
    });
  }

  private async dispatchWhatsAppTemplate(eventId: string, body: string) {
    // Integrate Meta WhatsApp Cloud API POST https://graph.facebook.com/v20.0/{phoneNumberId}/messages
  }
}
```

---

## 3. Full Item Lifecycle Control (Draft, Save, Archive, Soft-Delete & Restore)

Every master entity (`Hall`, `InventoryItem`, `CateringMenuItem`, `PricingRule`, `ChartOfAccount`) implements a standardized lifecycle controller so staff never lose historical audit integrity:

* **`SAVE AS DRAFT` (`lifecycle = DRAFT`):** Hidden from public booking & client portal while managers configure pricing or recipes.
* **`PUBLISH / ACTIVATE` (`lifecycle = ACTIVE`):** Live in quotes, dropdowns, and client portal.
* **`ARCHIVE` (`lifecycle = ARCHIVED`):** Hidden from new bookings/dropdowns, but remains intact on historical invoices and past event BEOs.
* **`SOFT DELETE` (`lifecycle = DELETED`, `deletedAt = now()`):** Only allowed if the item has zero active future allocations; recoverable by `OWNER` from the Trash/Audit vault.

```typescript
// Reusable Generic Lifecycle Service Snippet
async transitionItemLifecycle(
  model: 'hall' | 'inventoryItem' | 'cateringMenuItem' | 'pricingRule',
  tenantId: string,
  itemId: string,
  targetState: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED',
  actorId: string,
) {
  const updated = await (this.prisma[model] as any).update({
    where: { id: itemId, tenantId },
    data: {
      lifecycle: targetState,
      deletedAt: targetState === 'DELETED' ? new Date() : null,
      isActive: targetState === 'ACTIVE',
    },
  });

  await this.prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      action: `${model.toUpperCase()}_LIFECYCLE_${targetState}`,
      newValue: { itemId, targetState },
    },
  });

  return updated;
}
```

---

## 4. CSV Bulk Import & Bilingual PDF Export Service

### 4.1 CSV Import (Guest Lists, Inventory Items, Chart of Accounts)
* **Endpoint:** `POST /api/v1/erp/import/:entityType` (`guests` | `inventory` | `accounts`)
* **Validation Pipeline:** Uses `papaparse` / `csv-parse` with UTF-8 BOM support (essential for Arabic Excel CSV exports). Validates columns, highlights row-level errors before committing, and auto-generates `GatePass` QR tokens when importing guest lists.

### 4.2 Bilingual Branded PDF Export (Contracts, Tax Invoices, BEOs, Trial Balance)
* **Engine:** `puppeteer` or `@react-pdf/renderer` using **Cairo / Tajawal** Arabic fonts and **Inter** English fonts.
* **Dynamic White-Label Header:** Automatically injects `TenantBranding.logoLightUrl`, `primaryColor`, Tax ID, and bilingual footer on every exported PDF.

---

## 5. Interactive Hover-Spotlight Theme System (Dark / Light + Mouse Glow)

To deliver a luxury hospitality UI feel in both **Dark Mode** and **Light Mode**, implement a mouse-tracking radial spotlight effect (`SpotlightCard` and `SpotlightHeading`) that illuminates borders and surfaces as the user moves their mouse over cards, titles, KPI boxes, and dropdown triggers.

### `apps/web/src/components/ui/spotlight-card.tsx`

```tsx
'use client';

import React, { useRef, useState } from 'react';

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  glowColor?: string; // Defaults to Tenant primary brand color (e.g., Gold rgba(212, 175, 55, 0.18))
}

export function SpotlightCard({
  children,
  className = '',
  glowColor = 'var(--brand-glow, rgba(212, 175, 55, 0.22))',
  ...props
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-all duration-300 hover:border-amber-400/60 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-amber-500/50 ${className}`}
      {...props}
    >
      {/* Mouse-Following Spotlight Overlay */}
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300"
        style={{
          opacity: isHovered ? 1 : 0,
          background: `radial-gradient(420px circle at ${coords.x}px ${coords.y}px, ${glowColor}, transparent 75%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
```

### Dynamic Tenant Branding & Favicon Injection (`apps/web/src/app/[locale]/layout.tsx`)
1. Fetch `TenantBranding` by host/subdomain on server render.
2. Inject dynamic `<link rel="icon" href={branding.faviconUrl} />` and CSS variables (`--brand-primary`, `--brand-glow`).
3. Use `next-themes` (`attribute="class"`, `defaultTheme={branding.defaultTheme}`) so users can switch instantaneously between **Light Mode**, **Dark Mode**, and **System**.
4. Standardize all forms across the ERP and Client Portal with searchable **Shadcn/UI Combobox / Select Drop Lists** bound to `SystemLookup` (Event Types, Payment Methods, Expense Categories, Halls, Accounts, and Lifecycle Filters: `All | Active | Drafts | Archived`).
