import { NextRequest, NextResponse } from 'next/server';
import {
  buildInitialEvents,
  VENUE_HALLS,
  type EventStatus,
  type EventType,
} from '@/lib/bookings-store';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import {
  ensureSeededVenueData,
  findDbScheduleConflict,
  findHallById,
  insertBookingEvent,
  listAllHalls,
  listScheduledEvents,
  updateBookingEventStatus,
} from '@db/bookings.ts';

async function initVenueSeeds() {
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
    await initVenueSeeds();
    const { searchParams } = new URL(req.url);
    const hallId = searchParams.get('hallId');
    const status = searchParams.get('status');

    const [halls, events] = await Promise.all([
      listAllHalls(),
      listScheduledEvents({ hallId, status }),
    ]);

    return NextResponse.json({ halls, events });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load scheduled events.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    await initVenueSeeds();
    const body = await req.json();
    const hallId = String(body?.hallId || '');
    const hall = await findHallById(hallId);
    if (!hall) {
      return NextResponse.json({ detail: 'Selected hall not found' }, { status: 400 });
    }

    const title = String(body?.title || '').trim();
    const clientName = String(body?.clientName || '').trim();
    const clientPhone = String(body?.clientPhone || '').trim();
    const startTime = String(body?.startTime || '');
    const endTime = String(body?.endTime || '');
    const guestCount = Number(body?.guestCount || 0);
    const eventType = (body?.eventType || 'WEDDING') as EventType;
    const status = (body?.status || 'HOLD_48H') as EventStatus;
    const notes = String(body?.notes || '').trim();

    if (!title || !clientName || !startTime || !endTime) {
      return NextResponse.json({ detail: 'Missing required booking fields' }, { status: 400 });
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return NextResponse.json({ detail: 'End time must be after start time' }, { status: 400 });
    }

    if (guestCount < 1 || guestCount > hall.capacityTheater) {
      return NextResponse.json(
        { detail: `Guest count must be between 1 and ${hall.capacityTheater} for ${hall.nameEn}` },
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
          detail: `Schedule conflict with ${conflict.eventCode} (${conflict.titleEn}) including ${hall.cleaningBufferMinutes}m turnaround buffer`,
          conflictEventCode: conflict.eventCode,
        },
        { status: 409 }
      );
    }

    const year = startDate.getFullYear();
    const suffix = String(Date.now()).slice(-4);
    const eventCode = `EVT-${year}-${suffix}`;

    // Weekend peak pricing multiplier (+20% on Thu/Fri)
    const dow = startDate.getDay();
    const multiplier = dow === 4 || dow === 5 ? 1.2 : 1.0;
    const totalAmount = Math.round(hall.basePrice * multiplier * 1.05);

    const inserted = await insertBookingEvent({
      id: `evt-${Date.now()}`,
      eventCode,
      hallId: hall.id,
      titleEn: title,
      titleAr: title,
      eventType,
      clientNameEn: clientName,
      clientNameAr: clientName,
      clientPhone: clientPhone || '+967770000000',
      assignedSalesEn: authResult.user.name || 'Tariq Al-Mansoor',
      assignedSalesAr: authResult.user.name || 'أ. طارق المنصور',
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      cleaningBufferMinutes: hall.cleaningBufferMinutes,
      status,
      guestCount,
      totalAmount,
      paidAmount: status === 'CONFIRMED' ? Math.round(totalAmount * 0.5) : 0,
      currency: 'YER',
      notesEn: notes || 'Scheduled directly from ERP Operations Calendar.',
      notesAr: notes || 'تم جدولة الحجز مباشرة من تقويم عمليات الصالة.',
      createdByUid: authResult.user.uid,
    });

    return NextResponse.json(
      {
        event: {
          ...inserted,
          hallNameEn: hall.nameEn,
          hallNameAr: hall.nameAr,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create booking.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const body = await req.json();
    const id = String(body?.id || '');
    const nextStatus = body?.status as EventStatus | undefined;

    if (!id || !nextStatus) {
      return NextResponse.json({ detail: 'Event id and target status are required' }, { status: 400 });
    }

    const updated = await updateBookingEventStatus(id, nextStatus);
    if (!updated) {
      return NextResponse.json({ detail: 'Booking not found' }, { status: 404 });
    }

    return NextResponse.json({ event: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update booking status.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
