import { NextRequest, NextResponse } from 'next/server';
import { buildInitialEvents, VENUE_HALLS } from '@/lib/bookings-store';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import {
  ensureSeededVenueData,
  findDbScheduleConflict,
  findHallById,
  insertBookingEvent,
} from '@db/bookings.ts';
import {
  addAuditLog,
  createInvoiceRecord,
  getTenantBrandingRecord,
  listCatalogData,
  listPaymentMethods,
  updateClientProfileRecord,
} from '@db/tenant-erp.ts';
import type { InvoiceLineItem } from '@db/schema.ts';

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

export async function GET() {
  try {
    await ensureBaseSeeds();
    const [branding, catalog, paymentMethods] = await Promise.all([
      getTenantBrandingRecord(),
      listCatalogData(),
      listPaymentMethods(true),
    ]);

    return NextResponse.json({
      branding,
      halls: catalog.halls,
      cateringMenus: catalog.cateringMenus.filter((m) => m.isActive),
      inventoryItems: catalog.inventoryItems.filter((i) => i.isActive),
      paymentMethods,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load venue storefront.';
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

    const hallId = String(body?.hallId || '');
    const hall = await findHallById(hallId);
    if (!hall) {
      return NextResponse.json({ detail: 'Selected hall not found' }, { status: 400 });
    }

    const title = String(body?.title || '').trim();
    const eventType = String(body?.eventType || 'WEDDING');
    const eventDate = String(body?.eventDate || '').trim();
    const startHour = String(body?.startHour || '17:00').trim();
    const endHour = String(body?.endHour || '22:00').trim();
    const guestCount = Number(body?.guestCount || 150);
    const clientName = String(body?.clientName || authResult.user.name || '').trim();
    const clientPhone = String(body?.clientPhone || '').trim();
    const clientCategory = String(body?.clientCategory || 'INDIVIDUAL_B2C');
    const companyName = String(body?.companyName || '').trim();
    const nationalIdOrCr = String(body?.nationalIdOrCr || '').trim();
    const taxId = String(body?.taxId || '').trim();
    const refundMethod = String(body?.refundMethod || 'KURAIMI_BANK');
    const refundAccountNumber = String(body?.refundAccountNumber || '').trim();
    const preferredPaymentMethod = String(body?.preferredPaymentMethod || 'KURAIMI_BANK');
    const cateringMenuId = body?.cateringMenuId ? String(body.cateringMenuId) : null;
    const addonSelections = Array.isArray(body?.addons)
      ? (body.addons as Array<{ id: string; quantity: number }>)
      : [];
    const notes = String(body?.notes || '').trim();

    if (!title || !eventDate || !clientName || clientPhone.length < 7) {
      return NextResponse.json(
        { detail: 'Please complete event title, date, full name, and valid phone number.' },
        { status: 400 }
      );
    }

    const startDate = new Date(`${eventDate}T${startHour}:00`);
    const endDate = new Date(`${eventDate}T${endHour}:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return NextResponse.json({ detail: 'Invalid event date or time range.' }, { status: 400 });
    }

    if (guestCount < 1 || guestCount > hall.capacityTheater) {
      return NextResponse.json(
        { detail: `Guest count must be between 1 and ${hall.capacityTheater} for ${hall.nameEn}.` },
        { status: 400 }
      );
    }

    const conflict = await findDbScheduleConflict(
      hall.id,
      startDate.toISOString(),
      endDate.toISOString(),
      hall.cleaningBufferMinutes
    );
    if (conflict) {
      return NextResponse.json(
        {
          detail: `Selected slot conflicts with ${conflict.eventCode} (including ${hall.cleaningBufferMinutes}m turnaround buffer). Please choose another time or hall.`,
        },
        { status: 409 }
      );
    }

    const [branding, catalog] = await Promise.all([getTenantBrandingRecord(), listCatalogData()]);

    // Build itemized quote & invoice lines
    const dow = startDate.getDay();
    const isWeekendPeak = dow === 4 || dow === 5;
    const hallPrice = Math.round(hall.basePrice * (isWeekendPeak ? 1.2 : 1.0));

    const lineItems: InvoiceLineItem[] = [
      {
        id: 'li-hall',
        descriptionEn: `${hall.nameEn}${isWeekendPeak ? ' (Weekend Peak +20%)' : ''}`,
        descriptionAr: `${hall.nameAr}${isWeekendPeak ? ' (ذروة نهاية الأسبوع +20%)' : ''}`,
        quantity: 1,
        unitPrice: hallPrice,
        total: hallPrice,
      },
    ];

    if (cateringMenuId) {
      const menu = catalog.cateringMenus.find((m) => m.id === cateringMenuId);
      if (menu) {
        const menuTotal = menu.pricePerGuest * guestCount;
        lineItems.push({
          id: `li-cat-${menu.id}`,
          descriptionEn: `${menu.nameEn} (${guestCount} guests)`,
          descriptionAr: `${menu.nameAr} (${guestCount} ضيفاً)`,
          quantity: guestCount,
          unitPrice: menu.pricePerGuest,
          total: menuTotal,
        });
      }
    }

    for (const sel of addonSelections) {
      const qty = Math.max(0, Math.round(Number(sel.quantity || 0)));
      if (qty <= 0) continue;
      const item = catalog.inventoryItems.find((i) => i.id === sel.id);
      if (!item) continue;
      lineItems.push({
        id: `li-addon-${item.id}`,
        descriptionEn: item.nameEn,
        descriptionAr: item.nameAr,
        quantity: qty,
        unitPrice: item.unitAddonPrice,
        total: qty * item.unitAddonPrice,
      });
    }

    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const taxRate = branding.taxRate;
    const taxAmount = Math.round((subtotal * taxRate) / 100);
    const totalAmount = subtotal + taxAmount;
    const half = Math.round(totalAmount * 0.5);

    const year = startDate.getFullYear();
    const suffix = String(Date.now()).slice(-4);
    const eventId = `evt-${Date.now()}`;
    const eventCode = `EVT-${year}-${suffix}`;
    const invoiceNumber = `INV-${year}-${suffix}`;

    // 1. Register / update Client Portal Profile
    await updateClientProfileRecord(authResult.user.uid, {
      fullName: clientName,
      phone: clientPhone,
      email: authResult.user.email || '',
      clientCategory,
      companyName,
      nationalIdOrCr,
      taxId,
      refundMethod,
      refundAccountNumber,
      refundAccountHolder: clientName,
    });

    // 2. Create Event Booking (48-hour hold)
    const createdEvent = await insertBookingEvent({
      id: eventId,
      eventCode,
      hallId: hall.id,
      titleEn: title,
      titleAr: title,
      eventType,
      clientNameEn: clientName,
      clientNameAr: clientName,
      clientPhone,
      assignedSalesEn: 'Tariq Al-Mansoor',
      assignedSalesAr: 'أ. طارق المنصور',
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      cleaningBufferMinutes: hall.cleaningBufferMinutes,
      status: 'HOLD_48H',
      guestCount,
      totalAmount,
      paidAmount: 0,
      currency: branding.currency,
      notesEn: notes || `Booked via Tenant Storefront (${preferredPaymentMethod}).`,
      notesAr: notes || `تم الحجز عبر بوابة الصالة المباشرة (${preferredPaymentMethod}).`,
      createdByUid: authResult.user.uid,
    });

    // 3. Issue linked Invoice with 50% / 50% payment milestones
    const nowIso = new Date().toISOString();
    const holdDueIso = new Date(Date.now() + 2 * 86400000).toISOString();
    const finalDueIso = new Date(Math.max(Date.now() + 3 * 86400000, startDate.getTime() - 3 * 86400000)).toISOString();

    const createdInvoice = await createInvoiceRecord({
      id: `inv-${Date.now()}`,
      invoiceNumber,
      eventId,
      eventCode,
      clientNameEn: clientName,
      clientNameAr: clientName,
      clientPhone,
      subtotal,
      discountAmount: 0,
      taxRate,
      taxAmount,
      totalAmount,
      paidAmount: 0,
      securityDepositAmount: branding.defaultSecurityDeposit,
      depositStatus: 'UNPAID',
      currency: branding.currency,
      status: 'ISSUED',
      lineItems,
      milestones: [
        {
          id: `ms-${Date.now()}-1`,
          titleEn: 'Confirmation Deposit (50% — 48h Hold)',
          titleAr: 'دفعة تأكيد الحجز (50% خلال 48 ساعة)',
          amountDue: half,
          paidAmount: 0,
          dueDate: holdDueIso,
          paymentMethod: preferredPaymentMethod,
          referenceNumber: null,
          status: 'PENDING',
          paidAt: null,
        },
        {
          id: `ms-${Date.now()}-2`,
          titleEn: 'Final Balance Settlement (50%)',
          titleAr: 'سداد الرصيد النهائي (50%)',
          amountDue: totalAmount - half,
          paidAmount: 0,
          dueDate: finalDueIso,
          paymentMethod: null,
          referenceNumber: null,
          status: 'PENDING',
          paidAt: null,
        },
      ],
      issuedAt: nowIso,
      dueDate: holdDueIso,
    });

    await addAuditLog({
      userUid: authResult.user.uid,
      actorName: clientName,
      eventCode,
      action: 'STOREFRONT_BOOKING_AND_PORTAL_REGISTERED',
      details: {
        hall: hall.nameEn,
        invoiceNumber,
        totalAmount,
        preferredPaymentMethod,
      },
    });

    return NextResponse.json(
      {
        event: { ...createdEvent, hallNameEn: hall.nameEn, hallNameAr: hall.nameAr },
        invoice: createdInvoice,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit venue booking.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
