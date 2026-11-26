import {
  PrismaClient,
  UserType,
  StaffRole,
  ClientCategory,
  EventStatus,
  DelegateRole,
  DraftType,
  DraftStatus,
  ApprovalStatus,
  DepositStatus,
  InvoiceStatus,
} from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('🌱 Seeding Multi-Tenant Venue ERP & Client Portal Database...');

  // 1. Create Tenant (Venue Organization in Sana'a)
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'al-massa-palace' },
    update: {},
    create: {
      name: 'قصر الماسة للمؤتمرات والأفراح | Al-Massa Grand Palace',
      slug: 'al-massa-palace',
      currency: 'YER',
      taxRate: 5.0,
      settings: {
        cateringLockHours: 72,
        floorPlanLockHours: 24,
        holdExpiryHours: 48,
        defaultSecurityDeposit: 150000,
      },
    },
  });

  // 2. Create Partitionable Halls
  const hallA = await prisma.hall.create({
    data: {
      tenantId: tenant.id,
      name: 'Al-Massa Royal Hall A',
      nameAr: 'قاعة الماسة الملكية (أ)',
      capacityBanquet: 350,
      capacityTheater: 500,
      basePrice: 800000,
      cleaningBufferMinutes: 120,
    },
  });

  const hallB = await prisma.hall.create({
    data: {
      tenantId: tenant.id,
      name: 'Al-Massa Royal Hall B',
      nameAr: 'قاعة الماسة الملكية (ب)',
      capacityBanquet: 350,
      capacityTheater: 500,
      basePrice: 800000,
      cleaningBufferMinutes: 120,
      combinableWithHallId: hallA.id,
    },
  });

  await prisma.hall.update({
    where: { id: hallA.id },
    data: { combinableWithHallId: hallB.id },
  });

  // 3. Create Internal ERP Staff Users
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.INTERNAL_STAFF,
      email: 'owner@almassa.ye',
      phone: '+967770000001',
      passwordHash: hashPassword('Admin@123'),
      fullName: 'أ. عبدالله المنصور (المالك)',
      preferredLang: 'ar',
      is2faEnabled: true,
      staffProfile: {
        create: {
          role: StaffRole.OWNER,
          department: 'Executive Management',
          maxDiscountPercent: 100.0,
          commissionRate: 0.0,
        },
      },
    },
  });

  const salesRep = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.INTERNAL_STAFF,
      email: 'sales@almassa.ye',
      phone: '+967770000002',
      passwordHash: hashPassword('Sales@123'),
      fullName: 'سارة القباطي (منسقة مبيعات)',
      preferredLang: 'ar',
      staffProfile: {
        create: {
          role: StaffRole.SALES_REP,
          department: 'Sales & Events',
          maxDiscountPercent: 10.0,
          commissionRate: 2.5,
        },
      },
    },
  });

  const financeOfficer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.INTERNAL_STAFF,
      email: 'finance@almassa.ye',
      phone: '+967770000003',
      passwordHash: hashPassword('Finance@123'),
      fullName: 'طارق الحداد (المدير المالي)',
      preferredLang: 'ar',
      staffProfile: {
        create: {
          role: StaffRole.FINANCE,
          department: 'Finance & Accounting',
          maxDiscountPercent: 0.0,
          commissionRate: 0.0,
        },
      },
    },
  });

  const opsManager = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.INTERNAL_STAFF,
      email: 'ops@almassa.ye',
      phone: '+967770000004',
      passwordHash: hashPassword('Ops@123'),
      fullName: 'م. خالد الشميري (مدير العمليات)',
      preferredLang: 'ar',
      staffProfile: {
        create: {
          role: StaffRole.OPS_MANAGER,
          department: 'Operations & Logistics',
          maxDiscountPercent: 0.0,
          commissionRate: 0.0,
        },
      },
    },
  });

  const securityGuard = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.INTERNAL_STAFF,
      email: 'security@almassa.ye',
      phone: '+967770000005',
      passwordHash: hashPassword('Gate@123'),
      fullName: 'فهد الحميري (مشرف البوابات)',
      preferredLang: 'ar',
      staffProfile: {
        create: {
          role: StaffRole.SECURITY,
          department: 'Security & Gate Control',
          maxDiscountPercent: 0.0,
          commissionRate: 0.0,
        },
      },
    },
  });

  // 4. Create External Clients (B2C Individual & B2B Corporate) & Delegates
  const b2cClient = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.CLIENT_PRIMARY,
      email: 'ahmed.wedding@gmail.com',
      phone: '+967771112233',
      passwordHash: hashPassword('Client@123'),
      fullName: 'أحمد محمد الإرياني',
      preferredLang: 'ar',
      is2faEnabled: true,
      clientProfile: {
        create: {
          clientCategory: ClientCategory.INDIVIDUAL_B2C,
          nationalIdOrCr: '01010098765',
          billingAddress: 'صنعاء - حي حدة',
          refundBankDetails: {
            method: 'Al-Kuraimi / Jaib Wallet',
            accountNumber: '304958210',
            accountName: 'أحمد محمد الإرياني',
          },
          vipTier: 'GOLD',
        },
      },
    },
  });

  const weddingPlanner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.CLIENT_DELEGATE,
      email: 'noor.events@planner.ye',
      phone: '+967774445566',
      passwordHash: hashPassword('Planner@123'),
      fullName: 'نور السقاف (منسقة أفراح)',
      preferredLang: 'ar',
    },
  });

  const b2bClient = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      userType: UserType.CLIENT_PRIMARY,
      email: 'events@yementechnology.ye',
      phone: '+967779998877',
      passwordHash: hashPassword('Corp@123'),
      fullName: 'شركة تقنية اليمن للاتصالات',
      preferredLang: 'ar',
      clientProfile: {
        create: {
          clientCategory: ClientCategory.CORPORATE_B2B,
          nationalIdOrCr: 'CR-2024-88412',
          taxId: 'TAX-9910234',
          companyName: 'شركة تقنية اليمن للاتصالات المحدودة',
          billingAddress: 'صنعاء - شارع الستين الجنوبي',
          vipTier: 'CORPORATE_PARTNER',
        },
      },
    },
  });

  // 5. Create Inventory Items
  const goldChair = await prisma.inventoryItem.create({
    data: {
      tenantId: tenant.id,
      name: 'كرسي ملكي ذهبي (Chiavari Gold Chair)',
      category: 'FURNITURE',
      totalStock: 800,
      unitAddonPrice: 1500,
    },
  });

  const roundTable = await prisma.inventoryItem.create({
    data: {
      tenantId: tenant.id,
      name: 'طاولة دائرية 180 سم (10 أشخاص)',
      category: 'FURNITURE',
      totalStock: 80,
      unitAddonPrice: 5000,
    },
  });

  // 6. Create Confirmed Wedding Event with Delegation, Draft, Approval & Invoice
  const weddingDateStart = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000); // +20 days
  const weddingDateEnd = new Date(weddingDateStart.getTime() + 6 * 60 * 60 * 1000);

  const weddingEvent = await prisma.event.create({
    data: {
      tenantId: tenant.id,
      hallId: hallA.id,
      primaryClientId: b2cClient.id,
      assignedSalesId: salesRep.id,
      eventCode: 'EVT-2026-101',
      eventType: 'WEDDING',
      startTime: weddingDateStart,
      endTime: weddingDateEnd,
      status: EventStatus.CONFIRMED,
      guestCount: 300,
      delegates: {
        create: {
          userId: weddingPlanner.id,
          delegateRole: DelegateRole.WEDDING_PLANNER,
          permissions: {
            canViewFinance: false,
            canEditFloorplan: true,
            canEditCatering: true,
            canRequestAddons: true,
          },
        },
      },
      inventoryAllocations: {
        create: [
          { itemId: goldChair.id, quantityReserved: 300 },
          { itemId: roundTable.id, quantityReserved: 30 },
        ],
      },
    },
  });

  // 7. Create a Pending Add-On Draft submitted by the Wedding Planner
  const addonDraft = await prisma.eventDraft.create({
    data: {
      eventId: weddingEvent.id,
      createdById: weddingPlanner.id,
      versionNumber: 2,
      draftType: DraftType.ADDON_REQUEST,
      payload: {
        note: 'إضافة 30 كرسي ملكي ذهبي و 3 طاولات إضافية لضيوف كبار الشخصيات',
        addedItems: [
          { itemId: goldChair.id, name: 'كرسي ملكي ذهبي', qty: 30, unitPrice: 1500 },
          { itemId: roundTable.id, name: 'طاولة دائرية 180 سم', qty: 3, unitPrice: 5000 },
        ],
      },
      financialDelta: 60000,
      status: DraftStatus.PENDING_CLIENT_APPROVAL,
    },
  });

  await prisma.approvalRequest.create({
    data: {
      eventId: weddingEvent.id,
      draftId: addonDraft.id,
      requestedById: weddingPlanner.id,
      requiredApproverRole: 'CLIENT_PRIMARY',
      status: ApprovalStatus.PENDING,
    },
  });

  // 8. Create Invoice & Payment Milestones
  await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      eventId: weddingEvent.id,
      invoiceNumber: 'INV-2026-0001',
      subtotal: 1200000,
      discountAmount: 50000,
      taxAmount: 57500,
      totalAmount: 1207500,
      securityDepositAmount: 150000,
      depositStatus: DepositStatus.HELD,
      status: InvoiceStatus.PARTIALLY_PAID,
      milestones: {
        create: [
          {
            title: 'دفعة تثبيت الحجز (50%)',
            amountDue: 603750,
            dueDate: new Date(),
            paidAmount: 603750,
            paymentMethod: 'BANK_TRANSFER',
            status: 'PAID',
            paidAt: new Date(),
          },
          {
            title: 'الدفعة النهائية قبل الحفل بـ 48 ساعة (50%)',
            amountDue: 603750,
            dueDate: new Date(weddingDateStart.getTime() - 2 * 24 * 60 * 60 * 1000),
            paidAmount: 0,
            status: 'PENDING',
          },
        ],
      },
    },
  });

  // 9. Create Sample Security Gate Passes
  await prisma.gatePass.createMany({
    data: [
      {
        eventId: weddingEvent.id,
        passType: 'VIP_PASS',
        holderName: 'الشيخ محمد الإرياني',
        qrToken: 'QR-VIP-2026-889900',
        validFrom: weddingDateStart,
        validUntil: weddingDateEnd,
      },
      {
        eventId: weddingEvent.id,
        passType: 'VENDOR_CREW',
        holderName: 'استوديو الأضواء للتصوير (طاقم 3 أفراد)',
        holderIdNumber: 'VND-4421',
        qrToken: 'QR-VND-2026-112233',
        validFrom: new Date(weddingDateStart.getTime() - 3 * 60 * 60 * 1000),
        validUntil: weddingDateEnd,
      },
    ],
  });

  // 10. Write Initial Audit Log
  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      eventId: weddingEvent.id,
      actorId: weddingPlanner.id,
      action: 'ADDON_DRAFT_SUBMITTED_FOR_CLIENT_APPROVAL',
      newValue: { draftId: addonDraft.id, financialDelta: 60000 },
      ipAddress: '127.0.0.1',
    },
  });

  console.log('✅ Seeding completed successfully!');
  console.log({
    tenant: tenant.slug,
    ownerLogin: owner.email,
    clientLogin: b2cClient.email,
    plannerLogin: weddingPlanner.email,
    corporateLogin: b2bClient.email,
    securityLogin: securityGuard.email,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
