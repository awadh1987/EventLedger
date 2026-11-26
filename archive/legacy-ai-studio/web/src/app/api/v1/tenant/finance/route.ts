import { NextRequest, NextResponse } from 'next/server';
import { buildInitialEvents, VENUE_HALLS } from '@/lib/bookings-store';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import { ensureSeededVenueData, listScheduledEvents } from '@db/bookings.ts';
import {
  createInvoiceRecord,
  getTenantBrandingRecord,
  listInvoices,
  listPaymentMethods,
  recordInvoiceMilestonePayment,
  updateInvoiceDepositStatus,
  upsertPaymentMethodRecord,
} from '@db/tenant-erp.ts';

const SYSTEM_CHART_OF_ACCOUNTS = [
  { code: '1010', nameAr: 'الصندوق الرئيسي', nameEn: 'Main Cash Drawer', type: 'ASSET' },
  { code: '1020', nameAr: 'البنك والمحافظ الإلكترونية', nameEn: 'Bank & E-Wallets', type: 'ASSET' },
  { code: '1100', nameAr: 'ذمم العملاء', nameEn: 'Accounts Receivable', type: 'ASSET' },
  { code: '2100', nameAr: 'تأمينات الأضرار المستردة', nameEn: 'Refundable Security Deposits', type: 'LIABILITY' },
  { code: '2200', nameAr: 'ضريبة القيمة المضافة المستحقة', nameEn: 'Tax Payable', type: 'LIABILITY' },
  { code: '4000', nameAr: 'إيرادات تأجير القاعات', nameEn: 'Hall Rental Revenue', type: 'REVENUE' },
  { code: '4100', nameAr: 'إيرادات الضيافة والبوفيه', nameEn: 'Catering Revenue', type: 'REVENUE' },
  { code: '5000', nameAr: 'تكلفة المواد الغذائية والضيافة', nameEn: 'Catering COGS', type: 'EXPENSE' },
];

async function ensureBaseSeeds() {
  const initialEvents = buildInitialEvents().map((ev) => ({
    id: ev.id,
    eventCode: ev.eventCode,
    hallId: ev.hallId,
    titleEn: ev.titleEn,
    titleAr: ev.titleAr,
    eventType: ev.eventType,
    clientNameEn: ev.clientNameEn,
    clientNameAr: ev.clientNameAr,
    clientPhone: ev.clientPhone,
    assignedSalesEn: ev.assignedSalesEn,
    assignedSalesAr: ev.assignedSalesAr,
    startTime: ev.startTime,
    endTime: ev.endTime,
    cleaningBufferMinutes: ev.cleaningBufferMinutes,
    status: ev.status,
    guestCount: ev.guestCount,
    totalAmount: ev.totalAmount,
    paidAmount: ev.paidAmount,
    currency: ev.currency,
    notesEn: ev.notesEn,
    notesAr: ev.notesAr,
  }));
  await ensureSeededVenueData(VENUE_HALLS, initialEvents);
}

export async function GET(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    await ensureBaseSeeds();
    const [paymentMethods, invoices, branding] = await Promise.all([
      listPaymentMethods(false),
      listInvoices(),
      getTenantBrandingRecord(),
    ]);

    return NextResponse.json({
      paymentMethods,
      invoices,
      branding,
      chartOfAccounts: SYSTEM_CHART_OF_ACCOUNTS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load financial data.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    await ensureBaseSeeds();
    const body = await req.json();
    const action = String(body?.action || '');
    const actorName = authResult.user.name || authResult.user.email || 'ERP User';

    if (action === 'upsert_payment_method') {
      const nameEn = String(body?.nameEn || '').trim();
      const nameAr = String(body?.nameAr || '').trim() || nameEn;
      const code = String(body?.code || `PM_${Date.now()}`)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_');

      if (!nameEn) {
        return NextResponse.json({ detail: 'Payment method name is required' }, { status: 400 });
      }

      const saved = await upsertPaymentMethodRecord({
        id: String(body?.id || `pm-${Date.now()}`),
        code,
        nameEn,
        nameAr,
        providerType: String(body?.providerType || 'BANK').toUpperCase(),
        accountName: String(body?.accountName || '').trim() || 'Al-Massa Grand Palace',
        accountNumber: String(body?.accountNumber || '').trim() || 'N/A',
        instructionsEn: String(body?.instructionsEn || '').trim(),
        instructionsAr: String(body?.instructionsAr || '').trim(),
        isActive: body?.isActive !== false,
        sortOrder: Number(body?.sortOrder || 10),
      });
      return NextResponse.json({ paymentMethod: saved }, { status: 201 });
    }

    if (action === 'create_invoice') {
      const eventId = String(body?.eventId || '');
      const allEvents = await listScheduledEvents();
      const targetEvent = allEvents.find((ev) => ev.id === eventId);
      if (!targetEvent) {
        return NextResponse.json({ detail: 'Target event not found' }, { status: 404 });
      }

      const branding = await getTenantBrandingRecord();
      const taxRate = typeof body?.taxRate === 'number' ? body.taxRate : branding.taxRate;
      const discountAmount = Math.max(0, Math.round(Number(body?.discountAmount || 0)));
      const subtotal = Math.max(
        0,
        Math.round(Number(body?.subtotal || Math.round(targetEvent.totalAmount / (1 + taxRate / 100))))
      );
      const taxAmount = Math.round(((subtotal - discountAmount) * taxRate) / 100);
      const totalAmount = Math.max(0, subtotal - discountAmount + taxAmount);
      const securityDepositAmount = Math.max(
        0,
        Math.round(Number(body?.securityDepositAmount ?? branding.defaultSecurityDeposit))
      );

      const nowIso = new Date().toISOString();
      const dueIso = new Date(Date.now() + 7 * 86400000).toISOString();
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
      const half = Math.round(totalAmount * 0.5);

      const created = await createInvoiceRecord({
        id: `inv-${Date.now()}`,
        invoiceNumber,
        eventId: targetEvent.id,
        eventCode: targetEvent.eventCode,
        clientNameEn: targetEvent.clientNameEn,
        clientNameAr: targetEvent.clientNameAr,
        clientPhone: targetEvent.clientPhone,
        subtotal,
        discountAmount,
        taxRate,
        taxAmount,
        totalAmount,
        paidAmount: 0,
        securityDepositAmount,
        depositStatus: 'UNPAID',
        currency: branding.currency || targetEvent.currency,
        status: 'ISSUED',
        lineItems: [
          {
            id: `li-${Date.now()}`,
            descriptionEn: `${targetEvent.hallNameEn} — ${targetEvent.titleEn} (${targetEvent.guestCount} guests)`,
            descriptionAr: `${targetEvent.hallNameAr} — ${targetEvent.titleAr} (${targetEvent.guestCount} ضيفاً)`,
            quantity: 1,
            unitPrice: subtotal,
            total: subtotal,
          },
        ],
        milestones: [
          {
            id: `ms-${Date.now()}-1`,
            titleEn: 'Confirmation Deposit (50%)',
            titleAr: 'الدفعة الأولى لتأكيد الحجز (50%)',
            amountDue: half,
            paidAmount: 0,
            dueDate: nowIso,
            paymentMethod: null,
            referenceNumber: null,
            status: 'PENDING',
            paidAt: null,
          },
          {
            id: `ms-${Date.now()}-2`,
            titleEn: 'Final Balance Settlement (50%)',
            titleAr: 'الدفعة النهائية قبل الفعالية (50%)',
            amountDue: totalAmount - half,
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
      });

      return NextResponse.json({ invoice: created }, { status: 201 });
    }

    if (action === 'record_payment') {
      const invoiceId = String(body?.invoiceId || '');
      const milestoneId = String(body?.milestoneId || '');
      const paymentMethod = String(body?.paymentMethod || 'KURAIMI_BANK');
      const referenceNumber = String(body?.referenceNumber || `REF-${String(Date.now()).slice(-6)}`).trim();

      if (!invoiceId || !milestoneId) {
        return NextResponse.json({ detail: 'invoiceId and milestoneId are required' }, { status: 400 });
      }

      const updated = await recordInvoiceMilestonePayment({
        invoiceId,
        milestoneId,
        paymentMethod,
        referenceNumber,
        actorName,
        userUid: authResult.user.uid,
      });
      if (!updated) {
        return NextResponse.json({ detail: 'Invoice not found' }, { status: 404 });
      }
      return NextResponse.json({ invoice: updated });
    }

    if (action === 'update_deposit_status') {
      const invoiceId = String(body?.invoiceId || '');
      const depositStatus = String(body?.depositStatus || 'HELD');
      if (!invoiceId) {
        return NextResponse.json({ detail: 'invoiceId is required' }, { status: 400 });
      }
      const updated = await updateInvoiceDepositStatus(
        invoiceId,
        depositStatus,
        actorName,
        authResult.user.uid
      );
      if (!updated) {
        return NextResponse.json({ detail: 'Invoice not found' }, { status: 404 });
      }
      return NextResponse.json({ invoice: updated });
    }

    return NextResponse.json({ detail: 'Unknown finance action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process financial action.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
