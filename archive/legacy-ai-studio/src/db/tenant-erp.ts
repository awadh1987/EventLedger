import { asc, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  approvalDrafts,
  auditLogs,
  cateringMenus,
  clientProfiles,
  eventDelegates,
  events,
  gatePasses,
  halls,
  inventoryItems,
  invoices,
  paymentMethods,
  tenantBranding,
  type InvoiceLineItem,
  type InvoiceMilestone,
} from './schema.ts';

const DEFAULT_BRANDING_SEED = {
  id: 'almassa',
  venueNameAr: 'قصر الماسة للمؤتمرات والأفراح',
  venueNameEn: 'Al-Massa Grand Palace',
  taglineAr: 'أرقى قاعات الأفراح والمؤتمرات والضيافة الملكية في قلب العاصمة',
  taglineEn: 'Premier Wedding Halls, Executive Conferences & Royal Banquet Hospitality',
  slug: 'almassa',
  customDomain: 'events.almassa.ye',
  currency: 'YER',
  taxRate: 5,
  defaultSecurityDeposit: 150000,
  primaryColor: '#D4AF37',
  accentColor: '#0F172A',
  defaultTheme: 'DARK',
  enableSpotlight: true,
  spotlightColor: 'rgba(212, 175, 55, 0.18)',
  logoLightUrl: null,
  logoDarkUrl: null,
  contactPhone: '+967 770 000 001',
  contactEmail: 'concierge@almassa.ye',
  addressAr: 'شارع حدة الرئيسي — صنعاء، الجمهورية اليمنية',
  addressEn: 'Hadda Main Boulevard — Sanaa, Republic of Yemen',
  invoiceFooterAr:
    'تُعد هذه الفاتورة مستنداً مالياً معتمداً من قصر الماسة للمؤتمرات والأفراح. يُرد مبلغ التأمين خلال 48 ساعة بعد معاينة القاعة.',
  invoiceFooterEn:
    'Official financial invoice issued by Al-Massa Grand Palace. Security deposits are refunded within 48 hours after post-event inspection.',
};

const DEFAULT_INVENTORY_SEEDS = [
  {
    id: 'inv-chiavari',
    nameEn: 'Royal Gold Chiavari Chairs',
    nameAr: 'كراسي شيافاري ذهبية ملكية',
    category: 'FURNITURE',
    totalStock: 800,
    unitAddonPrice: 1500,
    isActive: true,
  },
  {
    id: 'inv-led-wall',
    nameEn: '4K Seamless LED Stage Wall (6x3m)',
    nameAr: 'شاشة مسرح LED فائقة الدقة (6×3 متر)',
    category: 'AV_LIGHTING',
    totalStock: 3,
    unitAddonPrice: 185000,
    isActive: true,
  },
  {
    id: 'inv-translation',
    nameEn: 'Simultaneous Translation Booth & 50 Headsets',
    nameAr: 'كبينة ترجمة فورية مع 50 سماعة',
    category: 'CONFERENCE',
    totalStock: 4,
    unitAddonPrice: 120000,
    isActive: true,
  },
  {
    id: 'inv-floral-arch',
    nameEn: 'Signature Bridal Floral Stage Arch',
    nameAr: 'كوشة وزهور طبيعية للمسرح الملكي',
    category: 'DECOR',
    totalStock: 6,
    unitAddonPrice: 240000,
    isActive: true,
  },
  {
    id: 'inv-valet',
    nameEn: 'VIP Valet & Red Carpet Arrival Team',
    nameAr: 'فريق استقبال السجادة الحمراء وصف السيارات VIP',
    category: 'HOSPITALITY',
    totalStock: 5,
    unitAddonPrice: 95000,
    isActive: true,
  },
];

const DEFAULT_CATERING_SEEDS = [
  {
    id: 'cat-royal-buffet',
    nameEn: 'Al-Massa Royal Banquet Buffet',
    nameAr: 'بوفيه الماسة الملكي الفاخر',
    descriptionEn: 'Full 3-course Yemeni & Levantine royal buffet, live grill station, artisanal desserts & Arabic coffee.',
    descriptionAr: 'بوفيه ملكي متكامل (أطباق يمنية وشامية فاخرة، محطة مشاوي حية، حلويات شرقية وقهوة عربية).',
    pricePerGuest: 6500,
    costPerGuest: 3800,
    isActive: true,
  },
  {
    id: 'cat-exec-summit',
    nameEn: 'Executive Summit Coffee & Lunch',
    nameAr: 'باقة ضيافة المؤتمرات والغداء التنفيذي',
    descriptionEn: 'Two specialty coffee breaks, fresh pastries, cold-pressed juices & plated executive business lunch.',
    descriptionAr: 'فترتا قهوة مختصة ومعجنات طازجة مع وجبة غداء تنفيذية فاخرة للمؤتمرات.',
    pricePerGuest: 4200,
    costPerGuest: 2300,
    isActive: true,
  },
  {
    id: 'cat-gala-gold',
    nameEn: 'Diamond Gala Plated Dinner',
    nameAr: 'عشاء الجالا الماسي (تقديم للطاولات)',
    descriptionEn: 'Four-course plated silver-service gala menu with dedicated table captains and signature mocktails.',
    descriptionAr: 'قائمة عشاء رسمي من 4 أطباق بخدمة طاولات مخصصة ومشروبات ترحيبية فاخرة.',
    pricePerGuest: 8500,
    costPerGuest: 4900,
    isActive: true,
  },
];

const DEFAULT_PAYMENT_METHODS = [
  {
    id: 'pm-kuraimi',
    code: 'KURAIMI_BANK',
    nameEn: 'Al-Kuraimi Islamic Bank (M-Floos)',
    nameAr: 'بنك الكريمي الإسلامي (إم فلوس)',
    providerType: 'BANK',
    accountName: 'Al-Massa Grand Palace Events LLC',
    accountNumber: '301234567',
    instructionsEn: 'Transfer to YER/SAR business account and include your Event Code in transfer notes.',
    instructionsAr: 'حوّل إلى حساب قصر الماسة التجاري مع كتابة رقم الفعالية في ملاحظة الحوالة.',
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'pm-jaib',
    code: 'JAIB_WALLET',
    nameEn: 'Jaib E-Wallet',
    nameAr: 'محفظة جيب الإلكترونية',
    providerType: 'EWALLET',
    accountName: 'Al-Massa Venues',
    accountNumber: '770000001',
    instructionsEn: 'Instant merchant transfer via Jaib app — enter receipt number below for verification.',
    instructionsAr: 'تحويل فوري عبر تطبيق جيب للتجار مع إدخال رقم العملية للمطابقة السريعة.',
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'pm-jawali',
    code: 'JAWALI_WALLET',
    nameEn: 'Jawali Digital Wallet',
    nameAr: 'محفظة جوالي',
    providerType: 'EWALLET',
    accountName: 'Al-Massa Grand Palace',
    accountNumber: '770000002',
    instructionsEn: 'Pay deposit or milestone directly to merchant code ALMASSA-01.',
    instructionsAr: 'سدد الدفعة مباشرة إلى كود التاجر ALMASSA-01.',
    isActive: true,
    sortOrder: 3,
  },
  {
    id: 'pm-onecash',
    code: 'ONECASH',
    nameEn: 'OneCash Wallet',
    nameAr: 'محفظة ون كاش',
    providerType: 'EWALLET',
    accountName: 'Al-Massa Events',
    accountNumber: '770000003',
    instructionsEn: 'Supported for 50% booking confirmations and add-on invoice settlements.',
    instructionsAr: 'متاحة لتأكيد دفعات الحجز 50% وتسوية فواتير الإضافات.',
    isActive: true,
    sortOrder: 4,
  },
  {
    id: 'pm-iban',
    code: 'BANK_IBAN',
    nameEn: 'Corporate Bank Transfer (IBAN / SWIFT)',
    nameAr: 'تحويل بنكي مؤسسي (IBAN)',
    providerType: 'BANK',
    accountName: 'Al-Massa Grand Palace Hospitality Group',
    accountNumber: 'YE21-KURI-0001-3012-3456-7001',
    instructionsEn: 'Ideal for B2B corporate summits and government gala settlements.',
    instructionsAr: 'مناسب للشركات والجهات الرسمية وعقود المؤتمرات B2B.',
    isActive: true,
    sortOrder: 5,
  },
  {
    id: 'pm-cash',
    code: 'CASH_DRAWER',
    nameEn: 'On-Site Venue Cash Desk',
    nameAr: 'الصندوق النقدي بمقر الصالة',
    providerType: 'CASH',
    accountName: 'Main Cash Drawer (1010)',
    accountNumber: 'DESK-1010',
    instructionsEn: 'Pay in person at Al-Massa reception desk and receive an official stamped receipt.',
    instructionsAr: 'الدفع المباشر في مكتب الاستقبال واستلام سند قبض رسمي مختوم.',
    isActive: true,
    sortOrder: 6,
  },
];

export async function ensureSeededTenantControlData() {
  try {
    const existingBrand = await db
      .select({ id: tenantBranding.id })
      .from(tenantBranding)
      .where(eq(tenantBranding.id, 'almassa'))
      .limit(1);
    if (existingBrand.length === 0) {
      await db.insert(tenantBranding).values(DEFAULT_BRANDING_SEED).onConflictDoNothing();
    }

    const existingInv = await db.select({ id: inventoryItems.id }).from(inventoryItems).limit(1);
    if (existingInv.length === 0) {
      await db.insert(inventoryItems).values(DEFAULT_INVENTORY_SEEDS).onConflictDoNothing();
    }

    const existingCat = await db.select({ id: cateringMenus.id }).from(cateringMenus).limit(1);
    if (existingCat.length === 0) {
      await db.insert(cateringMenus).values(DEFAULT_CATERING_SEEDS).onConflictDoNothing();
    }

    const existingPm = await db.select({ id: paymentMethods.id }).from(paymentMethods).limit(1);
    if (existingPm.length === 0) {
      await db.insert(paymentMethods).values(DEFAULT_PAYMENT_METHODS).onConflictDoNothing();
    }

    // Seed invoices, delegates, approval drafts, gate passes, and audit logs if primary event exists
    const primaryEvents = await db.select().from(events).orderBy(asc(events.startTime)).limit(4);
    if (primaryEvents.length > 0) {
      const firstEv = primaryEvents.find((e) => e.eventCode === 'EVT-2026-1001') ?? primaryEvents[0];
      const secondEv = primaryEvents.find((e) => e.eventCode === 'EVT-2026-1002') ?? primaryEvents[1] ?? firstEv;

      const existingInvoices = await db.select({ id: invoices.id }).from(invoices).limit(1);
      if (existingInvoices.length === 0) {
        const nowIso = new Date().toISOString();
        const dueIso = new Date(Date.now() + 7 * 86400000).toISOString();
        await db
          .insert(invoices)
          .values([
            {
              id: 'inv-2026-1001',
              invoiceNumber: 'INV-2026-1001',
              eventId: firstEv.id,
              eventCode: firstEv.eventCode,
              clientNameEn: firstEv.clientNameEn,
              clientNameAr: firstEv.clientNameAr,
              clientPhone: firstEv.clientPhone,
              subtotal: 1500000,
              discountAmount: 0,
              taxRate: 5,
              taxAmount: 75000,
              totalAmount: 1575000,
              paidAmount: 787500,
              securityDepositAmount: 150000,
              depositStatus: 'HELD',
              currency: 'YER',
              status: 'PARTIALLY_PAID',
              lineItems: [
                {
                  id: 'li-1',
                  descriptionEn: 'Grand Diamond Hall — Evening Royal Wedding Package (420 Guests)',
                  descriptionAr: 'قاعة الماسة الكبرى — باقة حفل الزفاف الملكي (420 ضيفاً)',
                  quantity: 1,
                  unitPrice: 1500000,
                  total: 1500000,
                },
              ],
              milestones: [
                {
                  id: 'ms-1',
                  titleEn: 'Confirmation Deposit (50%)',
                  titleAr: 'الدفعة الأولى لتأكيد الحجز (50%)',
                  amountDue: 787500,
                  paidAmount: 787500,
                  dueDate: nowIso,
                  paymentMethod: 'KURAIMI_BANK',
                  referenceNumber: 'KRM-8841209',
                  status: 'PAID',
                  paidAt: nowIso,
                },
                {
                  id: 'ms-2',
                  titleEn: 'Final Balance Settlement (50%)',
                  titleAr: 'الدفعة النهائية قبل الفعالية (50%)',
                  amountDue: 787500,
                  paidAmount: 0,
                  dueDate: dueIso,
                  paymentMethod: null,
                  referenceNumber: null,
                  status: 'PENDING',
                  paidAt: null,
                },
              ],
              issuedAt: nowIso,
              dueDate: dueIso,
            },
            {
              id: 'inv-2026-1002',
              invoiceNumber: 'INV-2026-1002',
              eventId: secondEv.id,
              eventCode: secondEv.eventCode,
              clientNameEn: secondEv.clientNameEn,
              clientNameAr: secondEv.clientNameAr,
              clientPhone: secondEv.clientPhone,
              subtotal: 614286,
              discountAmount: 0,
              taxRate: 5,
              taxAmount: 30714,
              totalAmount: 645000,
              paidAmount: 645000,
              securityDepositAmount: 100000,
              depositStatus: 'INSPECTION_PASSED',
              currency: 'YER',
              status: 'PAID',
              lineItems: [
                {
                  id: 'li-2a',
                  descriptionEn: 'Emerald Executive Suite — Full-Day Conference Setup',
                  descriptionAr: 'جناح الزمرد التنفيذي — تجهيز مؤتمر ليوم كامل',
                  quantity: 1,
                  unitPrice: 494286,
                  total: 494286,
                },
                {
                  id: 'li-2b',
                  descriptionEn: 'Simultaneous Translation Booth & 50 Headsets',
                  descriptionAr: 'كبينة ترجمة فورية مع 50 سماعة',
                  quantity: 1,
                  unitPrice: 120000,
                  total: 120000,
                },
              ],
              milestones: [
                {
                  id: 'ms-2a',
                  titleEn: 'Full Corporate B2B Invoice Settlement',
                  titleAr: 'سداد فاتورة المؤتمر بالكامل (B2B)',
                  amountDue: 645000,
                  paidAmount: 645000,
                  dueDate: nowIso,
                  paymentMethod: 'BANK_IBAN',
                  referenceNumber: 'IBAN-2026-4410',
                  status: 'PAID',
                  paidAt: nowIso,
                },
              ],
              issuedAt: nowIso,
              dueDate: nowIso,
            },
          ])
          .onConflictDoNothing();
      }

      const existingDel = await db.select({ id: eventDelegates.id }).from(eventDelegates).limit(1);
      if (existingDel.length === 0) {
        await db
          .insert(eventDelegates)
          .values([
            {
              id: 'del-layla',
              eventId: firstEv.id,
              eventCode: firstEv.eventCode,
              delegateName: 'ليلى الأهدل — Layla Al-Ahdal',
              delegatePhone: '+967773334455',
              delegateEmail: 'layla.planner@studio.local',
              delegateRole: 'WEDDING_PLANNER',
              canViewFinance: false,
              canEditFloorplan: true,
              canRequestAddons: true,
            },
          ])
          .onConflictDoNothing();
      }

      const existingDrafts = await db.select({ id: approvalDrafts.id }).from(approvalDrafts).limit(1);
      if (existingDrafts.length === 0) {
        await db
          .insert(approvalDrafts)
          .values([
            {
              id: 'draft-chiavari-30',
              eventId: firstEv.id,
              eventCode: firstEv.eventCode,
              draftType: 'ADDON_REQUEST',
              titleEn: 'Add 30 Extra Royal Gold Chiavari Chairs',
              titleAr: 'إضافة 30 كرسي شيافاري ذهبي إضافي',
              requestedByName: 'ليلى الأهدل (Wedding Planner)',
              financialDelta: 45000,
              currency: 'YER',
              status: 'PENDING',
              notes: 'Requested for expanded VIP family seating row near the royal stage.',
            },
          ])
          .onConflictDoNothing();
      }

      const existingPasses = await db.select({ id: gatePasses.id }).from(gatePasses).limit(1);
      if (existingPasses.length === 0) {
        await db
          .insert(gatePasses)
          .values([
            {
              id: 'gp-vip-01',
              eventId: firstEv.id,
              eventCode: firstEv.eventCode,
              passType: 'VIP_PASS',
              holderName: 'الشيخ عبدالله يحيى الشامي',
              holderIdNumber: 'VIP-001',
              qrToken: 'QR-EVT-2026-1001-VIP01',
              isCheckedIn: false,
              checkedInAt: null,
            },
            {
              id: 'gp-vendor-02',
              eventId: firstEv.id,
              eventCode: firstEv.eventCode,
              passType: 'VENDOR_PASS',
              holderName: 'أستوديو النخبة للتصوير والإضاءة',
              holderIdNumber: 'VND-204',
              qrToken: 'QR-EVT-2026-1001-VND02',
              isCheckedIn: true,
              checkedInAt: new Date().toISOString(),
            },
          ])
          .onConflictDoNothing();
      }

      const existingAudit = await db.select({ id: auditLogs.id }).from(auditLogs).limit(1);
      if (existingAudit.length === 0) {
        await db.insert(auditLogs).values([
          {
            userUid: null,
            actorName: 'أ. طارق المنصور',
            eventCode: firstEv.eventCode,
            action: 'BOOKING_CONFIRMED_DEPOSIT_VERIFIED',
            details: { invoice: 'INV-2026-1001', method: 'KURAIMI_BANK', amount: 787500 },
          },
          {
            userUid: null,
            actorName: 'ليلى الأهدل',
            eventCode: firstEv.eventCode,
            action: 'ADDON_DRAFT_SUBMITTED',
            details: { item: 'Royal Gold Chiavari Chairs', extraQty: 30, delta: 45000 },
          },
        ]);
      }
    }
  } catch (error) {
    console.error('Database tenant seed check failed:', error);
    throw new Error('Unable to initialize tenant control records.', { cause: error });
  }
}

export async function getTenantBrandingRecord() {
  try {
    await ensureSeededTenantControlData();
    const rows = await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.id, 'almassa'))
      .limit(1);
    return rows[0] ?? DEFAULT_BRANDING_SEED;
  } catch (error) {
    console.error('Database query failed (getTenantBrandingRecord):', error);
    throw new Error('Unable to load tenant branding configuration.', { cause: error });
  }
}

export async function updateTenantBrandingRecord(patch: Partial<typeof DEFAULT_BRANDING_SEED>) {
  try {
    await ensureSeededTenantControlData();
    const [updated] = await db
      .update(tenantBranding)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(tenantBranding.id, 'almassa'))
      .returning();
    return updated;
  } catch (error) {
    console.error('Database update failed (updateTenantBrandingRecord):', error);
    throw new Error('Unable to update tenant branding configuration.', { cause: error });
  }
}

export async function listCatalogData() {
  try {
    await ensureSeededTenantControlData();
    const [hallRows, inventoryRows, cateringRows] = await Promise.all([
      db.select().from(halls).orderBy(asc(halls.id)),
      db.select().from(inventoryItems).orderBy(asc(inventoryItems.category), asc(inventoryItems.nameEn)),
      db.select().from(cateringMenus).orderBy(asc(cateringMenus.pricePerGuest)),
    ]);
    return { halls: hallRows, inventoryItems: inventoryRows, cateringMenus: cateringRows };
  } catch (error) {
    console.error('Database query failed (listCatalogData):', error);
    throw new Error('Unable to load venue catalog items.', { cause: error });
  }
}

export async function upsertHallRecord(input: {
  id: string;
  nameEn: string;
  nameAr: string;
  capacityBanquet: number;
  capacityTheater: number;
  basePrice: number;
  cleaningBufferMinutes: number;
}) {
  try {
    const [saved] = await db
      .insert(halls)
      .values(input)
      .onConflictDoUpdate({
        target: halls.id,
        set: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          capacityBanquet: input.capacityBanquet,
          capacityTheater: input.capacityTheater,
          basePrice: input.basePrice,
          cleaningBufferMinutes: input.cleaningBufferMinutes,
        },
      })
      .returning();
    return saved;
  } catch (error) {
    console.error('Database upsert failed (upsertHallRecord):', error);
    throw new Error('Unable to save hall settings.', { cause: error });
  }
}

export async function upsertInventoryItemRecord(input: {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  totalStock: number;
  unitAddonPrice: number;
  isActive: boolean;
}) {
  try {
    const [saved] = await db
      .insert(inventoryItems)
      .values(input)
      .onConflictDoUpdate({
        target: inventoryItems.id,
        set: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          category: input.category,
          totalStock: input.totalStock,
          unitAddonPrice: input.unitAddonPrice,
          isActive: input.isActive,
        },
      })
      .returning();
    return saved;
  } catch (error) {
    console.error('Database upsert failed (upsertInventoryItemRecord):', error);
    throw new Error('Unable to save inventory item.', { cause: error });
  }
}

export async function deleteInventoryItemRecord(id: string) {
  try {
    await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
  } catch (error) {
    console.error('Database delete failed (deleteInventoryItemRecord):', error);
    throw new Error('Unable to remove inventory item.', { cause: error });
  }
}

export async function upsertCateringMenuRecord(input: {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  pricePerGuest: number;
  costPerGuest: number;
  isActive: boolean;
}) {
  try {
    const [saved] = await db
      .insert(cateringMenus)
      .values(input)
      .onConflictDoUpdate({
        target: cateringMenus.id,
        set: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          pricePerGuest: input.pricePerGuest,
          costPerGuest: input.costPerGuest,
          isActive: input.isActive,
        },
      })
      .returning();
    return saved;
  } catch (error) {
    console.error('Database upsert failed (upsertCateringMenuRecord):', error);
    throw new Error('Unable to save catering package.', { cause: error });
  }
}

export async function deleteCateringMenuRecord(id: string) {
  try {
    await db.delete(cateringMenus).where(eq(cateringMenus.id, id));
  } catch (error) {
    console.error('Database delete failed (deleteCateringMenuRecord):', error);
    throw new Error('Unable to remove catering package.', { cause: error });
  }
}

export async function listPaymentMethods(onlyActive = false) {
  try {
    await ensureSeededTenantControlData();
    const rows = onlyActive
      ? await db
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.isActive, true))
          .orderBy(asc(paymentMethods.sortOrder))
      : await db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder));
    return rows;
  } catch (error) {
    console.error('Database query failed (listPaymentMethods):', error);
    throw new Error('Unable to load payment methods.', { cause: error });
  }
}

export async function upsertPaymentMethodRecord(input: {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  providerType: string;
  accountName: string;
  accountNumber: string;
  instructionsEn: string;
  instructionsAr: string;
  isActive: boolean;
  sortOrder: number;
}) {
  try {
    const [saved] = await db
      .insert(paymentMethods)
      .values(input)
      .onConflictDoUpdate({
        target: paymentMethods.id,
        set: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          providerType: input.providerType,
          accountName: input.accountName,
          accountNumber: input.accountNumber,
          instructionsEn: input.instructionsEn,
          instructionsAr: input.instructionsAr,
          isActive: input.isActive,
          sortOrder: input.sortOrder,
        },
      })
      .returning();
    return saved;
  } catch (error) {
    console.error('Database upsert failed (upsertPaymentMethodRecord):', error);
    throw new Error('Unable to save payment method.', { cause: error });
  }
}

export async function listInvoices() {
  try {
    await ensureSeededTenantControlData();
    return await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  } catch (error) {
    console.error('Database query failed (listInvoices):', error);
    throw new Error('Unable to load invoices.', { cause: error });
  }
}

export async function createInvoiceRecord(input: {
  id: string;
  invoiceNumber: string;
  eventId: string;
  eventCode: string;
  clientNameEn: string;
  clientNameAr: string;
  clientPhone: string;
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  securityDepositAmount: number;
  depositStatus: string;
  currency: string;
  status: string;
  lineItems: InvoiceLineItem[];
  milestones: InvoiceMilestone[];
  issuedAt: string;
  dueDate: string;
}) {
  try {
    const [created] = await db.insert(invoices).values(input).returning();
    return created;
  } catch (error) {
    console.error('Database insert failed (createInvoiceRecord):', error);
    throw new Error('Unable to create invoice.', { cause: error });
  }
}

export async function recordInvoiceMilestonePayment(input: {
  invoiceId: string;
  milestoneId: string;
  paymentMethod: string;
  referenceNumber: string;
  actorName: string;
  userUid?: string | null;
}) {
  try {
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    const inv = rows[0];
    if (!inv) return null;

    const nowIso = new Date().toISOString();
    const updatedMilestones: InvoiceMilestone[] = inv.milestones.map((ms) =>
      ms.id === input.milestoneId
        ? {
            ...ms,
            paidAmount: ms.amountDue,
            paymentMethod: input.paymentMethod,
            referenceNumber: input.referenceNumber,
            status: 'PAID',
            paidAt: nowIso,
          }
        : ms
    );

    const nextPaidAmount = updatedMilestones.reduce((acc, ms) => acc + ms.paidAmount, 0);
    const nextStatus =
      nextPaidAmount >= inv.totalAmount
        ? 'PAID'
        : nextPaidAmount > 0
        ? 'PARTIALLY_PAID'
        : inv.status;

    const [updated] = await db
      .update(invoices)
      .set({
        milestones: updatedMilestones,
        paidAmount: nextPaidAmount,
        status: nextStatus,
        depositStatus: inv.depositStatus === 'UNPAID' && nextPaidAmount > 0 ? 'HELD' : inv.depositStatus,
      })
      .where(eq(invoices.id, input.invoiceId))
      .returning();

    // Sync paidAmount & confirmation status on parent event
    await db
      .update(events)
      .set({
        paidAmount: nextPaidAmount,
        ...(nextPaidAmount >= Math.round(inv.totalAmount * 0.5) ? { status: 'CONFIRMED' } : {}),
      })
      .where(eq(events.id, inv.eventId));

    await addAuditLog({
      userUid: input.userUid ?? null,
      actorName: input.actorName,
      eventCode: inv.eventCode,
      action: 'PAYMENT_MILESTONE_SETTLED',
      details: {
        invoiceNumber: inv.invoiceNumber,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber,
        paidAmount: nextPaidAmount,
      },
    });

    return updated;
  } catch (error) {
    console.error('Database update failed (recordInvoiceMilestonePayment):', error);
    throw new Error('Unable to record payment milestone.', { cause: error });
  }
}

export async function updateInvoiceDepositStatus(
  invoiceId: string,
  depositStatus: string,
  actorName: string,
  userUid?: string | null
) {
  try {
    const [updated] = await db
      .update(invoices)
      .set({ depositStatus })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (!updated) return null;

    await addAuditLog({
      userUid: userUid ?? null,
      actorName,
      eventCode: updated.eventCode,
      action: 'SECURITY_DEPOSIT_STATUS_UPDATED',
      details: { invoiceNumber: updated.invoiceNumber, depositStatus },
    });
    return updated;
  } catch (error) {
    console.error('Database update failed (updateInvoiceDepositStatus):', error);
    throw new Error('Unable to update security deposit status.', { cause: error });
  }
}

export async function getOrCreateClientProfile(
  userUid: string,
  defaults: { fullName: string; email: string }
) {
  try {
    const existing = await db
      .select()
      .from(clientProfiles)
      .where(eq(clientProfiles.userUid, userUid))
      .limit(1);
    if (existing[0]) return existing[0];

    const [created] = await db
      .insert(clientProfiles)
      .values({
        userUid,
        fullName: defaults.fullName,
        email: defaults.email,
        phone: '+967771112233',
        preferredLang: 'ar',
        clientCategory: 'INDIVIDUAL_B2C',
        refundMethod: 'KURAIMI_BANK',
        refundAccountHolder: defaults.fullName,
      })
      .onConflictDoUpdate({
        target: clientProfiles.userUid,
        set: { email: defaults.email },
      })
      .returning();
    return created;
  } catch (error) {
    console.error('Database upsert failed (getOrCreateClientProfile):', error);
    throw new Error('Unable to load client profile.', { cause: error });
  }
}

export async function updateClientProfileRecord(
  userUid: string,
  patch: Partial<{
    fullName: string;
    phone: string;
    email: string;
    preferredLang: string;
    is2faEnabled: boolean;
    clientCategory: string;
    nationalIdOrCr: string;
    taxId: string;
    companyName: string;
    billingAddress: string;
    refundMethod: string;
    refundAccountNumber: string;
    refundAccountHolder: string;
  }>
) {
  try {
    const [updated] = await db
      .insert(clientProfiles)
      .values({
        userUid,
        fullName: patch.fullName || 'Client',
        email: patch.email || '',
        ...patch,
      })
      .onConflictDoUpdate({
        target: clientProfiles.userUid,
        set: {
          ...patch,
          updatedAt: new Date(),
        },
      })
      .returning();

    await addAuditLog({
      userUid,
      actorName: updated.fullName,
      eventCode: null,
      action: 'CLIENT_PROFILE_UPDATED',
      details: { category: updated.clientCategory, refundMethod: updated.refundMethod },
    });
    return updated;
  } catch (error) {
    console.error('Database update failed (updateClientProfileRecord):', error);
    throw new Error('Unable to update client profile.', { cause: error });
  }
}

export async function listPortalOperationsData() {
  try {
    await ensureSeededTenantControlData();
    const [delegates, drafts, passes, logs] = await Promise.all([
      db.select().from(eventDelegates).orderBy(desc(eventDelegates.createdAt)),
      db.select().from(approvalDrafts).orderBy(desc(approvalDrafts.createdAt)),
      db.select().from(gatePasses).orderBy(desc(gatePasses.createdAt)),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40),
    ]);
    return { delegates, drafts, passes, logs };
  } catch (error) {
    console.error('Database query failed (listPortalOperationsData):', error);
    throw new Error('Unable to load operations & portal records.', { cause: error });
  }
}

export async function upsertDelegateRecord(input: {
  id: string;
  eventId: string;
  eventCode: string;
  delegateName: string;
  delegatePhone: string;
  delegateEmail: string;
  delegateRole: string;
  canViewFinance: boolean;
  canEditFloorplan: boolean;
  canRequestAddons: boolean;
  actorName: string;
  userUid?: string | null;
}) {
  try {
    const [saved] = await db
      .insert(eventDelegates)
      .values({
        id: input.id,
        eventId: input.eventId,
        eventCode: input.eventCode,
        delegateName: input.delegateName,
        delegatePhone: input.delegatePhone,
        delegateEmail: input.delegateEmail,
        delegateRole: input.delegateRole,
        canViewFinance: input.canViewFinance,
        canEditFloorplan: input.canEditFloorplan,
        canRequestAddons: input.canRequestAddons,
      })
      .onConflictDoUpdate({
        target: eventDelegates.id,
        set: {
          delegateName: input.delegateName,
          delegatePhone: input.delegatePhone,
          delegateEmail: input.delegateEmail,
          delegateRole: input.delegateRole,
          canViewFinance: input.canViewFinance,
          canEditFloorplan: input.canEditFloorplan,
          canRequestAddons: input.canRequestAddons,
        },
      })
      .returning();

    await addAuditLog({
      userUid: input.userUid ?? null,
      actorName: input.actorName,
      eventCode: input.eventCode,
      action: 'DELEGATE_PERMISSIONS_SAVED',
      details: { delegateName: input.delegateName, role: input.delegateRole },
    });
    return saved;
  } catch (error) {
    console.error('Database upsert failed (upsertDelegateRecord):', error);
    throw new Error('Unable to save event delegate.', { cause: error });
  }
}

export async function deleteDelegateRecord(id: string) {
  try {
    await db.delete(eventDelegates).where(eq(eventDelegates.id, id));
  } catch (error) {
    console.error('Database delete failed (deleteDelegateRecord):', error);
    throw new Error('Unable to remove event delegate.', { cause: error });
  }
}

export async function resolveApprovalDraftRecord(input: {
  id: string;
  decision: 'APPROVED' | 'REJECTED';
  actorName: string;
  userUid?: string | null;
}) {
  try {
    const existing = await db
      .select()
      .from(approvalDrafts)
      .where(eq(approvalDrafts.id, input.id))
      .limit(1);
    const draft = existing[0];
    if (!draft) return null;

    const [updated] = await db
      .update(approvalDrafts)
      .set({ status: input.decision })
      .where(eq(approvalDrafts.id, input.id))
      .returning();

    if (input.decision === 'APPROVED' && draft.status !== 'APPROVED' && draft.financialDelta !== 0) {
      // Sync financial delta onto event and linked invoice
      const evRows = await db.select().from(events).where(eq(events.id, draft.eventId)).limit(1);
      if (evRows[0]) {
        await db
          .update(events)
          .set({ totalAmount: evRows[0].totalAmount + draft.financialDelta })
          .where(eq(events.id, draft.eventId));
      }

      const invRows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.eventId, draft.eventId))
        .limit(1);
      if (invRows[0]) {
        const inv = invRows[0];
        const nextLineItems: InvoiceLineItem[] = [
          ...inv.lineItems,
          {
            id: `li-draft-${draft.id}`,
            descriptionEn: draft.titleEn,
            descriptionAr: draft.titleAr,
            quantity: 1,
            unitPrice: draft.financialDelta,
            total: draft.financialDelta,
          },
        ];
        const nextSubtotal = inv.subtotal + draft.financialDelta;
        const nextTax = Math.round((nextSubtotal * inv.taxRate) / 100);
        const nextTotal = nextSubtotal + nextTax - inv.discountAmount;
        await db
          .update(invoices)
          .set({
            lineItems: nextLineItems,
            subtotal: nextSubtotal,
            taxAmount: nextTax,
            totalAmount: nextTotal,
            status: inv.paidAmount >= nextTotal ? 'PAID' : 'PARTIALLY_PAID',
          })
          .where(eq(invoices.id, inv.id));
      }
    }

    await addAuditLog({
      userUid: input.userUid ?? null,
      actorName: input.actorName,
      eventCode: draft.eventCode,
      action: input.decision === 'APPROVED' ? 'ADDON_DRAFT_APPROVED' : 'ADDON_DRAFT_REJECTED',
      details: { title: draft.titleEn, financialDelta: draft.financialDelta },
    });

    return updated;
  } catch (error) {
    console.error('Database update failed (resolveApprovalDraftRecord):', error);
    throw new Error('Unable to process approval request.', { cause: error });
  }
}

export async function createGatePassRecord(input: {
  eventId: string;
  eventCode: string;
  passType: string;
  holderName: string;
  holderIdNumber: string;
  actorName: string;
  userUid?: string | null;
}) {
  try {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const qrToken = `QR-${input.eventCode}-${input.passType.slice(0, 3)}-${suffix}`;
    const [created] = await db
      .insert(gatePasses)
      .values({
        id: `gp-${Date.now()}`,
        eventId: input.eventId,
        eventCode: input.eventCode,
        passType: input.passType,
        holderName: input.holderName,
        holderIdNumber: input.holderIdNumber,
        qrToken,
        isCheckedIn: false,
        checkedInAt: null,
      })
      .returning();

    await addAuditLog({
      userUid: input.userUid ?? null,
      actorName: input.actorName,
      eventCode: input.eventCode,
      action: 'VIP_GATE_PASS_ISSUED',
      details: { holderName: input.holderName, qrToken },
    });
    return created;
  } catch (error) {
    console.error('Database insert failed (createGatePassRecord):', error);
    throw new Error('Unable to issue gate pass.', { cause: error });
  }
}

export async function toggleGatePassCheckIn(id: string, actorName: string, userUid?: string | null) {
  try {
    const rows = await db.select().from(gatePasses).where(eq(gatePasses.id, id)).limit(1);
    const pass = rows[0];
    if (!pass) return null;

    const nextChecked = !pass.isCheckedIn;
    const [updated] = await db
      .update(gatePasses)
      .set({
        isCheckedIn: nextChecked,
        checkedInAt: nextChecked ? new Date().toISOString() : null,
      })
      .where(eq(gatePasses.id, id))
      .returning();

    await addAuditLog({
      userUid: userUid ?? null,
      actorName,
      eventCode: pass.eventCode,
      action: nextChecked ? 'GATE_PASS_CHECKED_IN' : 'GATE_PASS_CHECKIN_REVERTED',
      details: { qrToken: pass.qrToken, holderName: pass.holderName },
    });
    return updated;
  } catch (error) {
    console.error('Database update failed (toggleGatePassCheckIn):', error);
    throw new Error('Unable to update gate pass check-in.', { cause: error });
  }
}

export async function addAuditLog(input: {
  userUid: string | null;
  actorName: string;
  eventCode: string | null;
  action: string;
  details: Record<string, unknown> | null;
}) {
  try {
    await db.insert(auditLogs).values(input);
  } catch (error) {
    console.error('Database insert failed (addAuditLog):', error);
  }
}
