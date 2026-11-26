import { NextRequest, NextResponse } from 'next/server';
import { buildInitialEvents, VENUE_HALLS } from '@/lib/bookings-store';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import { ensureSeededVenueData, listScheduledEvents } from '@db/bookings.ts';
import {
  createGatePassRecord,
  deleteDelegateRecord,
  getOrCreateClientProfile,
  getTenantBrandingRecord,
  listInvoices,
  listPaymentMethods,
  listPortalOperationsData,
  resolveApprovalDraftRecord,
  toggleGatePassCheckIn,
  updateClientProfileRecord,
  upsertDelegateRecord,
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
    const [profile, events, invoices, paymentMethods, ops, branding] = await Promise.all([
      getOrCreateClientProfile(authResult.user.uid, {
        fullName: authResult.user.name || 'Ahmed Abdullah Al-Shami',
        email: authResult.user.email || '',
      }),
      listScheduledEvents(),
      listInvoices(),
      listPaymentMethods(true),
      listPortalOperationsData(),
      getTenantBrandingRecord(),
    ]);

    return NextResponse.json({
      profile,
      events,
      invoices,
      paymentMethods,
      delegates: ops.delegates,
      drafts: ops.drafts,
      passes: ops.passes,
      auditLogs: ops.logs,
      branding,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load client portal.';
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
    const actorName = authResult.user.name || authResult.user.email || 'Client User';

    if (action === 'update_profile') {
      const updated = await updateClientProfileRecord(authResult.user.uid, {
        fullName: String(body?.fullName || actorName).trim(),
        phone: String(body?.phone || '').trim(),
        email: String(body?.email || authResult.user.email || '').trim(),
        preferredLang: body?.preferredLang === 'en' ? 'en' : 'ar',
        is2faEnabled: Boolean(body?.is2faEnabled),
        clientCategory: body?.clientCategory === 'CORPORATE_B2B' ? 'CORPORATE_B2B' : 'INDIVIDUAL_B2C',
        nationalIdOrCr: String(body?.nationalIdOrCr || '').trim(),
        taxId: String(body?.taxId || '').trim(),
        companyName: String(body?.companyName || '').trim(),
        billingAddress: String(body?.billingAddress || '').trim(),
        refundMethod: String(body?.refundMethod || 'KURAIMI_BANK').trim(),
        refundAccountNumber: String(body?.refundAccountNumber || '').trim(),
        refundAccountHolder: String(body?.refundAccountHolder || actorName).trim(),
      });
      return NextResponse.json({ profile: updated });
    }

    if (action === 'upsert_delegate') {
      const delegateName = String(body?.delegateName || '').trim();
      const delegatePhone = String(body?.delegatePhone || '').trim();
      const eventId = String(body?.eventId || '');
      const eventCode = String(body?.eventCode || '');
      if (!delegateName || !delegatePhone || !eventId) {
        return NextResponse.json({ detail: 'Delegate name, phone, and event are required' }, { status: 400 });
      }
      const saved = await upsertDelegateRecord({
        id: String(body?.id || `del-${Date.now()}`),
        eventId,
        eventCode: eventCode || eventId,
        delegateName,
        delegatePhone,
        delegateEmail: String(body?.delegateEmail || '').trim(),
        delegateRole: String(body?.delegateRole || 'WEDDING_PLANNER'),
        canViewFinance: Boolean(body?.canViewFinance),
        canEditFloorplan: body?.canEditFloorplan !== false,
        canRequestAddons: body?.canRequestAddons !== false,
        actorName,
        userUid: authResult.user.uid,
      });
      return NextResponse.json({ delegate: saved }, { status: 201 });
    }

    if (action === 'delete_delegate') {
      const id = String(body?.id || '');
      if (!id) return NextResponse.json({ detail: 'Delegate id required' }, { status: 400 });
      await deleteDelegateRecord(id);
      return NextResponse.json({ deleted: true, id });
    }

    if (action === 'resolve_approval') {
      const id = String(body?.id || '');
      const decision = body?.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';
      if (!id) return NextResponse.json({ detail: 'Approval draft id required' }, { status: 400 });
      const updated = await resolveApprovalDraftRecord({
        id,
        decision,
        actorName,
        userUid: authResult.user.uid,
      });
      if (!updated) return NextResponse.json({ detail: 'Draft not found' }, { status: 404 });
      return NextResponse.json({ draft: updated });
    }

    if (action === 'issue_gate_pass') {
      const eventId = String(body?.eventId || '');
      const eventCode = String(body?.eventCode || '');
      const holderName = String(body?.holderName || '').trim();
      if (!eventId || !holderName) {
        return NextResponse.json({ detail: 'Event and pass holder name are required' }, { status: 400 });
      }
      const created = await createGatePassRecord({
        eventId,
        eventCode: eventCode || eventId,
        passType: String(body?.passType || 'VIP_PASS'),
        holderName,
        holderIdNumber: String(body?.holderIdNumber || '').trim(),
        actorName,
        userUid: authResult.user.uid,
      });
      return NextResponse.json({ pass: created }, { status: 201 });
    }

    if (action === 'toggle_gate_pass') {
      const id = String(body?.id || '');
      if (!id) return NextResponse.json({ detail: 'Gate pass id required' }, { status: 400 });
      const updated = await toggleGatePassCheckIn(id, actorName, authResult.user.uid);
      if (!updated) return NextResponse.json({ detail: 'Gate pass not found' }, { status: 404 });
      return NextResponse.json({ pass: updated });
    }

    return NextResponse.json({ detail: 'Unknown portal action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save portal action.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
