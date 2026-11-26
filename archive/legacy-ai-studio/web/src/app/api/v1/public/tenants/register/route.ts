import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import { createTenantRecord, findTenantBySlug } from '@db/bookings.ts';

const RESERVED_SLUGS = new Set(['www', 'admin', 'api', 'app', 'mail', 'static']);

export async function POST(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const body = await req.json();
    const venueName = String(body?.venue_name || '').trim();
    const rawSlug = String(body?.slug || '').toLowerCase().trim();
    const cleanSlug = rawSlug.replace(/[^a-z0-9-]/g, '');
    const ownerName = String(body?.owner_name || '').trim();
    const ownerPhone = String(body?.owner_phone || '').trim();
    const ownerEmail = body?.owner_email ? String(body.owner_email).trim() : authResult.user.email ?? null;
    const currency = String(body?.currency || 'YER').toUpperCase();
    const subscriptionTier = String(body?.subscription_tier || 'PRO').toUpperCase();

    if (venueName.length < 2) {
      return NextResponse.json({ detail: 'Venue name must be at least 2 characters' }, { status: 400 });
    }

    if (cleanSlug.length < 3 || RESERVED_SLUGS.has(cleanSlug)) {
      return NextResponse.json(
        { detail: 'Subdomain slug must be at least 3 characters and not reserved' },
        { status: 400 }
      );
    }

    if (ownerName.length < 2 || ownerPhone.length < 7) {
      return NextResponse.json({ detail: 'Valid owner name and phone number are required' }, { status: 400 });
    }

    const existing = await findTenantBySlug(cleanSlug);
    if (existing) {
      return NextResponse.json({ detail: 'Subdomain slug is already taken' }, { status: 409 });
    }

    const created = await createTenantRecord({
      slug: cleanSlug,
      venueName,
      ownerName,
      ownerPhone,
      ownerEmail,
      currency,
      subscriptionTier,
      ownerUid: authResult.user.uid,
    });

    return NextResponse.json(
      {
        tenant_id: String(created.id),
        slug: created.slug,
        venue_name: created.venueName,
        owner_name: created.ownerName,
        owner_phone: created.ownerPhone,
        owner_email: created.ownerEmail,
        currency: created.currency,
        subscription_tier: created.subscriptionTier,
        workspace_url: `https://${created.slug}.eventledger.cloud`,
        owner_id: authResult.user.uid,
        seeded_accounts: 8,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to register venue workspace.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
