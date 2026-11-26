# Enterprise Import/Export Services & Default Chart of Accounts Seed Pack
**Project:** Multi-Tenant Venue, Wedding Hall & Conference ERP + Interactive Client Portal  
**Includes:** NestJS CSV Bulk Import Service (`import.service.ts`), Bilingual Branded PDF Export Service (`pdf-export.service.ts`), and Default Hospitality Chart of Accounts + System Lookups Seed (`seed-accounting.ts`).

---

## 1. CSV Bulk Import Service (`apps/api/src/modules/import-export/import.service.ts`)

Supports UTF-8 BOM Arabic/English CSV files exported from Microsoft Excel for **Guest Lists (auto-generating QR Gate Passes)**, **Inventory Items**, and **Chart of Accounts**.

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parse } from 'csv-parse/sync';
import * as crypto from 'crypto';
import { AccountType, RecordLifecycle } from '@prisma/client';

export interface ImportResult {
  totalRows: number;
  importedCount: number;
  failedRows: { row: number; error: string; raw: any }[];
}

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  private parseCsvBuffer(buffer: Buffer): Record<string, string>[] {
    // Strip UTF-8 BOM if present (common in Arabic Excel CSV exports)
    const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  }

  /**
   * 1. Bulk Import Event Guests & Auto-Generate Security Gate QR Tokens
   * Expected CSV Columns: holderName, passType (GUEST_QR | VIP_PASS), holderIdNumber
   */
  async importEventGuestsCsv(
    tenantId: string,
    eventId: string,
    actorId: string,
    fileBuffer: Buffer,
  ): Promise<ImportResult> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event) throw new BadRequestException('Event not found for this tenant');

    const records = this.parseCsvBuffer(fileBuffer);
    const failedRows: ImportResult['failedRows'] = [];
    let importedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const holderName = row.holderName || row['الاسم'] || row['Name'];
      const passType = (row.passType || row['النوع'] || 'GUEST_QR').toUpperCase();
      const holderIdNumber = row.holderIdNumber || row['رقم الهوية'] || null;

      if (!holderName) {
        failedRows.push({ row: i + 2, error: 'Missing holderName / الاسم مطلوب', raw: row });
        continue;
      }

      if (!['GUEST_QR', 'VIP_PASS', 'VENDOR_CREW'].includes(passType)) {
        failedRows.push({ row: i + 2, error: `Invalid passType: ${passType}`, raw: row });
        continue;
      }

      const qrToken = `QR-${event.eventCode}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      await this.prisma.gatePass.create({
        data: {
          eventId,
          passType,
          holderName,
          holderIdNumber,
          qrToken,
          validFrom: event.startTime,
          validUntil: event.endTime,
        },
      });
      importedCount++;
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        eventId,
        actorId,
        action: 'CSV_BULK_IMPORT_GUESTS',
        newValue: { importedCount, failedCount: failedRows.length },
      },
    });

    return { totalRows: records.length, importedCount, failedRows };
  }

  /**
   * 2. Bulk Import Furniture & AV Inventory Items
   * Expected CSV Columns: name, category, totalStock, unitAddonPrice
   */
  async importInventoryCsv(
    tenantId: string,
    actorId: string,
    fileBuffer: Buffer,
  ): Promise<ImportResult> {
    const records = this.parseCsvBuffer(fileBuffer);
    const failedRows: ImportResult['failedRows'] = [];
    let importedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const name = row.name || row['اسم الصنف'];
      const category = (row.category || row['التصنيف'] || 'FURNITURE').toUpperCase();
      const totalStock = parseInt(row.totalStock || row['الكمية'] || '0', 10);
      const unitAddonPrice = parseFloat(row.unitAddonPrice || row['سعر الإضافة'] || '0');

      if (!name || isNaN(totalStock) || totalStock < 0) {
        failedRows.push({ row: i + 2, error: 'Invalid name or totalStock', raw: row });
        continue;
      }

      await this.prisma.inventoryItem.create({
        data: {
          tenantId,
          name,
          category,
          totalStock,
          unitAddonPrice,
        },
      });
      importedCount++;
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: 'CSV_BULK_IMPORT_INVENTORY',
        newValue: { importedCount, failedCount: failedRows.length },
      },
    });

    return { totalRows: records.length, importedCount, failedRows };
  }

  /**
   * 3. Bulk Import Chart of Accounts
   * Expected CSV Columns: code, nameAr, nameEn, accountType (ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE)
   */
  async importChartOfAccountsCsv(
    tenantId: string,
    actorId: string,
    fileBuffer: Buffer,
  ): Promise<ImportResult> {
    const records = this.parseCsvBuffer(fileBuffer);
    const failedRows: ImportResult['failedRows'] = [];
    let importedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const code = row.code || row['رقم الحساب'];
      const nameAr = row.nameAr || row['اسم الحساب بالعربي'];
      const nameEn = row.nameEn || row['Account Name'];
      const accountType = (row.accountType || row['نوع الحساب'] || '').toUpperCase() as AccountType;

      if (!code || !nameAr || !Object.values(AccountType).includes(accountType)) {
        failedRows.push({ row: i + 2, error: 'Invalid code, nameAr, or accountType', raw: row });
        continue;
      }

      await this.prisma.chartOfAccount.upsert({
        where: { tenantId_code: { tenantId, code } },
        update: { nameAr, nameEn: nameEn || nameAr, accountType },
        create: {
          tenantId,
          code,
          nameAr,
          nameEn: nameEn || nameAr,
          accountType,
          lifecycle: RecordLifecycle.ACTIVE,
        },
      });
      importedCount++;
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: 'CSV_BULK_IMPORT_COA',
        newValue: { importedCount, failedCount: failedRows.length },
      },
    });

    return { totalRows: records.length, importedCount, failedRows };
  }
}
```

---

## 2. Bilingual White-Label PDF Export Service (`apps/api/src/modules/import-export/pdf-export.service.ts`)

Generates **Bilingual Arabic RTL / English LTR PDFs** for **Tax Invoices**, **Signed Contracts**, and **Banquet Event Orders (BEOs)** dynamically branded with the tenant's logo, primary color, and footer.

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as puppeteer from 'puppeteer';

@Injectable()
export class PdfExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateInvoicePdf(tenantId: string, invoiceId: string, lang: 'ar' | 'en' = 'ar'): Promise<Buffer> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        tenant: { include: { branding: true } },
        event: {
          include: {
            hall: true,
            primaryClient: { include: { clientProfile: true } },
          },
        },
        milestones: { orderBy: { dueDate: 'asc' } },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    const branding = invoice.tenant.branding;
    const primaryColor = branding?.primaryColor || '#D4AF37';
    const logoUrl = branding?.logoLightUrl || '';
    const isRtl = lang === 'ar';
    const currency = invoice.tenant.currency;

    const html = `
<!DOCTYPE html>
<html lang="${lang}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;600;700&display=swap');
    body {
      font-family: ${isRtl ? "'Cairo', sans-serif" : "'Inter', sans-serif"};
      color: #1e293b;
      margin: 0;
      padding: 32px;
      font-size: 13px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid ${primaryColor};
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .logo { max-height: 64px; }
    .title { font-size: 22px; font-weight: 700; color: ${primaryColor}; }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      background: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th {
      background: ${primaryColor};
      color: #fff;
      padding: 10px;
      text-align: ${isRtl ? 'right' : 'left'};
    }
    td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    .totals { width: 320px; margin-${isRtl ? 'right' : 'left'}: auto; }
    .totals tr td { font-weight: 600; }
    .grand-total { font-size: 16px; background: #f1f5f9; }
    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      font-size: 11px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      ${logoUrl ? `<img src="${logoUrl}" class="logo" />` : ''}
      <div class="title">${invoice.tenant.name}</div>
    </div>
    <div style="text-align: ${isRtl ? 'left' : 'right'}">
      <div style="font-size: 18px; font-weight: 700;">${isRtl ? 'فاتورة ضريبية / عقد حجز' : 'TAX INVOICE'}</div>
      <div>#${invoice.invoiceNumber}</div>
      <div>${isRtl ? 'رمز الفعالية:' : 'Event Code:'} ${invoice.event.eventCode}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div>
      <strong>${isRtl ? 'بيانات العميل:' : 'Billed To:'}</strong><br/>
      ${invoice.event.primaryClient.fullName}<br/>
      ${invoice.event.primaryClient.clientProfile?.companyName || ''}<br/>
      ${isRtl ? 'الرقم الضريبي / الهوية:' : 'Tax ID / National ID:'} ${invoice.event.primaryClient.clientProfile?.taxId || invoice.event.primaryClient.clientProfile?.nationalIdOrCr || '-'}
    </div>
    <div>
      <strong>${isRtl ? 'تفاصيل القاعة والموعد:' : 'Venue & Schedule:'}</strong><br/>
      ${isRtl ? invoice.event.hall.nameAr : invoice.event.hall.name}<br/>
      ${isRtl ? 'عدد الضيوف:' : 'Guests:'} ${invoice.event.guestCount}<br/>
      ${isRtl ? 'التاريخ:' : 'Date:'} ${invoice.event.startTime.toISOString().split('T')[0]}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>${isRtl ? 'الدفعة / البيان' : 'Milestone Description'}</th>
        <th>${isRtl ? 'تاريخ الاستحقاق' : 'Due Date'}</th>
        <th>${isRtl ? 'المبلغ المستحق' : 'Amount Due'}</th>
        <th>${isRtl ? 'المدفوع' : 'Paid'}</th>
        <th>${isRtl ? 'الحالة' : 'Status'}</th>
      </tr>
    </thead>
    <tbody>
      ${invoice.milestones
        .map(
          (m) => `
        <tr>
          <td>${m.title}</td>
          <td>${m.dueDate.toISOString().split('T')[0]}</td>
          <td>${Number(m.amountDue).toLocaleString()} ${currency}</td>
          <td>${Number(m.paidAmount).toLocaleString()} ${currency}</td>
          <td>${m.status}</td>
        </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <table class="totals">
    <tr>
      <td>${isRtl ? 'المجموع الفرعي:' : 'Subtotal:'}</td>
      <td>${Number(invoice.subtotal).toLocaleString()} ${currency}</td>
    </tr>
    <tr>
      <td>${isRtl ? 'الخصم:' : 'Discount:'}</td>
      <td>-${Number(invoice.discountAmount).toLocaleString()} ${currency}</td>
    </tr>
    <tr>
      <td>${isRtl ? 'الضريبة:' : 'Tax:'}</td>
      <td>${Number(invoice.taxAmount).toLocaleString()} ${currency}</td>
    </tr>
    <tr class="grand-total">
      <td>${isRtl ? 'الإجمالي النهائي:' : 'Grand Total:'}</td>
      <td>${Number(invoice.totalAmount).toLocaleString()} ${currency}</td>
    </tr>
    <tr>
      <td>${isRtl ? 'تأمين الأضرار المسترد:' : 'Refundable Deposit:'}</td>
      <td>${Number(invoice.securityDepositAmount).toLocaleString()} ${currency} (${invoice.depositStatus})</td>
    </tr>
  </table>

  <div class="footer">
    ${(isRtl ? branding?.footerTextAr : branding?.footerTextEn) || invoice.tenant.name}
  </div>
</body>
</html>`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}
```

---

## 3. Default Chart of Accounts, Accounting Config & Dropdown Lookups Seed (`packages/database/prisma/seed-accounting.ts`)

Run this seed function during tenant onboarding (`POST /api/v1/super-admin/tenants`) so every new venue tenant immediately has a balanced **Double-Entry Chart of Accounts**, **Auto-Posting Accounting Configuration**, **White-Label Branding**, and **Bilingual Dropdown Lookups**.

```typescript
import { PrismaClient, AccountType, RecordLifecycle } from '@prisma/client';

export async function seedTenantAccountingAndLookups(prisma: PrismaClient, tenantId: string) {
  console.log(`📊 Seeding Double-Entry Chart of Accounts & Dropdown Lookups for Tenant: ${tenantId}`);

  // 1. Default Hospitality & Event Venue Chart of Accounts
  const accountsData = [
    // ASSETS (1000 - 1999)
    { code: '1101', nameAr: 'الصندوق والبنوك والمحافظ الإلكترونية', nameEn: 'Cash, Banks & E-Wallets', accountType: AccountType.ASSET, isSystem: true },
    { code: '1102', nameAr: 'الذمم المدينة - مستحقات العملاء', nameEn: 'Accounts Receivable - Clients', accountType: AccountType.ASSET, isSystem: true },
    { code: '1201', nameAr: 'مخزون المواد الغذائية والضيافة', nameEn: 'Catering & Food Inventory', accountType: AccountType.ASSET, isSystem: false },

    // LIABILITIES (2000 - 2999)
    { code: '2101', nameAr: 'تأمينات الأضرار المستردة للعملاء', nameEn: 'Client Security Deposits Held (Liability)', accountType: AccountType.LIABILITY, isSystem: true },
    { code: '2102', nameAr: 'عربون ودفعات مقدمة من العملاء', nameEn: 'Unearned Client Deposits', accountType: AccountType.LIABILITY, isSystem: true },
    { code: '2201', nameAr: 'ضريبة القيمة المضافة / المبيعات المستحقة', nameEn: 'Sales / VAT Tax Payable', accountType: AccountType.LIABILITY, isSystem: true },
    { code: '2301', nameAr: 'مستحقات الموردين والعمالة المؤقتة', nameEn: 'Accounts Payable - Vendors & Temp Staff', accountType: AccountType.LIABILITY, isSystem: false },

    // EQUITY (3000 - 3999)
    { code: '3101', nameAr: 'رأس المال', nameEn: 'Owner Capital', accountType: AccountType.EQUITY, isSystem: true },
    { code: '3201', nameAr: 'الأرباح المبقاة', nameEn: 'Retained Earnings', accountType: AccountType.EQUITY, isSystem: true },

    // REVENUE (4000 - 4999)
    { code: '4101', nameAr: 'إيرادات تأجير القاعات', nameEn: 'Hall Rental Revenue', accountType: AccountType.REVENUE, isSystem: true },
    { code: '4102', nameAr: 'إيرادات البوفيه والضيافة', nameEn: 'Catering & Banquet Revenue', accountType: AccountType.REVENUE, isSystem: true },
    { code: '4103', nameAr: 'إيرادات الخدمات الإضافية والتجهيزات', nameEn: 'Add-Ons & AV Equipment Revenue', accountType: AccountType.REVENUE, isSystem: false },
    { code: '4104', nameAr: 'إيرادات خصم تلفيات القاعة من التأمين', nameEn: 'Forfeited Damage Deposit Revenue', accountType: AccountType.REVENUE, isSystem: false },

    // EXPENSES (5000 - 5999)
    { code: '5101', nameAr: 'تكلفة المواد الغذائية والضيافة (COGS)', nameEn: 'Catering Raw Materials Cost', accountType: AccountType.EXPENSE, isSystem: true },
    { code: '5102', nameAr: 'أجور العمالة المؤقتة للمناسبات', nameEn: 'Temporary Event Staff Wages', accountType: AccountType.EXPENSE, isSystem: false },
    { code: '5103', nameAr: 'خصومات ممنوحة للعملاء', nameEn: 'Sales Discounts Granted', accountType: AccountType.EXPENSE, isSystem: true },
    { code: '5104', nameAr: 'عمولات المبيعات والوسطاء', nameEn: 'Sales & Referral Commissions', accountType: AccountType.EXPENSE, isSystem: false },
    { code: '5201', nameAr: 'مصروفات الكهرباء والوقود والمولدات', nameEn: 'Utilities & Generator Fuel', accountType: AccountType.EXPENSE, isSystem: false },
  ];

  const createdAccounts: Record<string, string> = {};
  for (const acc of accountsData) {
    const record = await prisma.chartOfAccount.upsert({
      where: { tenantId_code: { tenantId, code: acc.code } },
      update: {},
      create: {
        tenantId,
        code: acc.code,
        nameAr: acc.nameAr,
        nameEn: acc.nameEn,
        accountType: acc.accountType,
        isSystem: acc.isSystem,
        lifecycle: RecordLifecycle.ACTIVE,
      },
    });
    createdAccounts[acc.code] = record.id;
  }

  // 2. Link AccountingConfig Default Posting Accounts
  await prisma.accountingConfig.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      cashBankAccountId: createdAccounts['1101'],
      accountsReceivableId: createdAccounts['1102'],
      hallRevenueAccountId: createdAccounts['4101'],
      cateringRevenueId: createdAccounts['4102'],
      taxPayableAccountId: createdAccounts['2201'],
      securityDepositLiabId: createdAccounts['2101'],
      discountExpenseId: createdAccounts['5103'],
      cogsExpenseAccountId: createdAccounts['5101'],
      fiscalYearStartMonth: 1,
      autoPostOnVerify: true,
    },
  });

  // 3. Seed Default Tenant Branding & Hover-Spotlight Theme
  await prisma.tenantBranding.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      primaryColor: '#D4AF37',
      accentColor: '#0F172A',
      defaultTheme: 'DARK',
      enableHoverGlow: true,
      footerTextAr: 'شكراً لاختياركم قاعاتنا لإحياء مناسباتكم السعيدة',
      footerTextEn: 'Thank you for choosing our venues for your memorable events',
    },
  });

  // 4. Seed Standardized Dropdown Lookups (SystemLookup)
  const lookups = [
    // Event Types
    { category: 'EVENT_TYPE', code: 'WEDDING', labelAr: 'حفل زفاف', labelEn: 'Wedding Reception', sortOrder: 1 },
    { category: 'EVENT_TYPE', code: 'CONFERENCE', labelAr: 'مؤتمر / ندوة', labelEn: 'Conference / Seminar', sortOrder: 2 },
    { category: 'EVENT_TYPE', code: 'GRADUATION', labelAr: 'حفل تخرج', labelEn: 'Graduation Ceremony', sortOrder: 3 },
    { category: 'EVENT_TYPE', code: 'EXHIBITION', labelAr: 'معرض تجاري', labelEn: 'Trade Exhibition', sortOrder: 4 },
    { category: 'EVENT_TYPE', code: 'PRIVATE_DINNER', labelAr: 'وليمة / عشاء خاص', labelEn: 'Private Banquet Dinner', sortOrder: 5 },

    // Payment Methods (Localized for Yemen & GCC)
    { category: 'PAYMENT_METHOD', code: 'KURAIMI_BANK', labelAr: 'بنك الكريمي (حوالة / إيداع)', labelEn: 'Al-Kuraimi Islamic Bank', sortOrder: 1 },
    { category: 'PAYMENT_METHOD', code: 'JAIB_WALLET', labelAr: 'محفظة جيب (Jaib)', labelEn: 'Jaib E-Wallet', sortOrder: 2 },
    { category: 'PAYMENT_METHOD', code: 'JAWALI_WALLET', labelAr: 'محفظة جوالي (Jawali)', labelEn: 'Jawali E-Wallet', sortOrder: 3 },
    { category: 'PAYMENT_METHOD', code: 'BANK_TRANSFER', labelAr: 'تحويل بنكي / صرافة', labelEn: 'Bank / Exchange Transfer', sortOrder: 4 },
    { category: 'PAYMENT_METHOD', code: 'CASH', labelAr: 'نقداً في الخزينة', labelEn: 'Cash at Venue Cashier', sortOrder: 5 },

    // Expense Categories
    { category: 'EXPENSE_CATEGORY', code: 'CATERING_RAW', labelAr: 'مشتريات الضيافة والمطبخ', labelEn: 'Catering Raw Materials', sortOrder: 1 },
    { category: 'EXPENSE_CATEGORY', code: 'TEMP_STAFF', labelAr: 'أجور العمالة المؤقتة', labelEn: 'Temporary Event Staff', sortOrder: 2 },
    { category: 'EXPENSE_CATEGORY', code: 'UTILITIES', labelAr: 'وقود المولدات والكهرباء', labelEn: 'Generator Fuel & Utilities', sortOrder: 3 },
    { category: 'EXPENSE_CATEGORY', code: 'VENDOR_PAYOUT', labelAr: 'مستحقات موردين خارجيين', labelEn: 'External Vendor Payout', sortOrder: 4 },
    { category: 'EXPENSE_CATEGORY', code: 'DAMAGE_REPAIR', labelAr: 'صيانة وإصلاح تلفيات', labelEn: 'Damage Repair & Maintenance', sortOrder: 5 },

    // Inventory Categories
    { category: 'INVENTORY_CATEGORY', code: 'FURNITURE', labelAr: 'أثاث وكراسي وطاولات', labelEn: 'Furniture, Chairs & Tables', sortOrder: 1 },
    { category: 'INVENTORY_CATEGORY', code: 'AV_GEAR', labelAr: 'صوتيات وإضاءة وشاشات', labelEn: 'Audio, Lighting & Screens', sortOrder: 2 },
    { category: 'INVENTORY_CATEGORY', code: 'LINENS', labelAr: 'مفارش وزينة طاولات', labelEn: 'Linens & Table Decor', sortOrder: 3 },
    { category: 'INVENTORY_CATEGORY', code: 'CONSUMABLES', labelAr: 'مواد استهلاكية', labelEn: 'Consumables', sortOrder: 4 },
  ];

  for (const item of lookups) {
    await prisma.systemLookup.upsert({
      where: {
        tenantId_category_code: {
          tenantId,
          category: item.category,
          code: item.code,
        },
      },
      update: {},
      create: {
        tenantId,
        category: item.category,
        code: item.code,
        labelAr: item.labelAr,
        labelEn: item.labelEn,
        sortOrder: item.sortOrder,
        lifecycle: RecordLifecycle.ACTIVE,
      },
    });
  }

  console.log('✅ Accounting Config, Chart of Accounts, Branding & Lookups seeded!');
}
```
