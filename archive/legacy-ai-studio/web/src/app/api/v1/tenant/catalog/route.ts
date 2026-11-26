import { NextRequest, NextResponse } from 'next/server';
import { buildInitialEvents, VENUE_HALLS } from '@/lib/bookings-store';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import { ensureSeededVenueData } from '@db/bookings.ts';
import {
  deleteCateringMenuRecord,
  deleteInventoryItemRecord,
  listCatalogData,
  upsertCateringMenuRecord,
  upsertHallRecord,
  upsertInventoryItemRecord,
} from '@db/tenant-erp.ts';

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
    const data = await listCatalogData();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load catalog data.';
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
    const kind = String(body?.kind || '');

    if (kind === 'hall') {
      const nameEn = String(body?.nameEn || '').trim();
      const nameAr = String(body?.nameAr || '').trim() || nameEn;
      if (!nameEn) {
        return NextResponse.json({ detail: 'Hall name is required' }, { status: 400 });
      }
      const id = String(body?.id || `hall-${Date.now()}`);
      const saved = await upsertHallRecord({
        id,
        nameEn,
        nameAr,
        capacityBanquet: Math.max(10, Number(body?.capacityBanquet || 100)),
        capacityTheater: Math.max(10, Number(body?.capacityTheater || 150)),
        basePrice: Math.max(0, Math.round(Number(body?.basePrice || 0))),
        cleaningBufferMinutes: Math.max(30, Math.round(Number(body?.cleaningBufferMinutes || 120))),
      });
      return NextResponse.json({ hall: saved }, { status: 201 });
    }

    if (kind === 'inventory') {
      const nameEn = String(body?.nameEn || '').trim();
      const nameAr = String(body?.nameAr || '').trim() || nameEn;
      if (!nameEn) {
        return NextResponse.json({ detail: 'Item name is required' }, { status: 400 });
      }
      const id = String(body?.id || `inv-${Date.now()}`);
      const saved = await upsertInventoryItemRecord({
        id,
        nameEn,
        nameAr,
        category: String(body?.category || 'FURNITURE').toUpperCase(),
        totalStock: Math.max(0, Math.round(Number(body?.totalStock || 0))),
        unitAddonPrice: Math.max(0, Math.round(Number(body?.unitAddonPrice || 0))),
        isActive: body?.isActive !== false,
      });
      return NextResponse.json({ item: saved }, { status: 201 });
    }

    if (kind === 'catering') {
      const nameEn = String(body?.nameEn || '').trim();
      const nameAr = String(body?.nameAr || '').trim() || nameEn;
      if (!nameEn) {
        return NextResponse.json({ detail: 'Catering package name is required' }, { status: 400 });
      }
      const id = String(body?.id || `cat-${Date.now()}`);
      const saved = await upsertCateringMenuRecord({
        id,
        nameEn,
        nameAr,
        descriptionEn: String(body?.descriptionEn || '').trim(),
        descriptionAr: String(body?.descriptionAr || '').trim(),
        pricePerGuest: Math.max(0, Math.round(Number(body?.pricePerGuest || 0))),
        costPerGuest: Math.max(0, Math.round(Number(body?.costPerGuest || 0))),
        isActive: body?.isActive !== false,
      });
      return NextResponse.json({ menu: saved }, { status: 201 });
    }

    return NextResponse.json({ detail: 'Unknown catalog item kind' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save catalog item.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind');
    const id = searchParams.get('id');
    if (!kind || !id) {
      return NextResponse.json({ detail: 'kind and id are required' }, { status: 400 });
    }

    if (kind === 'inventory') {
      await deleteInventoryItemRecord(id);
      return NextResponse.json({ deleted: true, id });
    }
    if (kind === 'catering') {
      await deleteCateringMenuRecord(id);
      return NextResponse.json({ deleted: true, id });
    }
    return NextResponse.json({ detail: 'Unsupported delete kind' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete catalog item.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
