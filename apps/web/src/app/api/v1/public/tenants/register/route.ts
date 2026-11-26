import { NextRequest, NextResponse } from 'next/server';

// MOCKED — in-memory tenant store for AI Studio runtime (replaces Python FastAPI/PostgreSQL backend)
const registeredTenants = new Map<string, {
  tenant_id: string;
  slug: string;
  venue_name: string;
  owner_name: string;
  owner_phone: string;
  workspace_url: string;
  owner_id: string;
}>();

const RESERVED_SLUGS = new Set(['www', 'admin', 'api', 'app', 'mail', 'static']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const venueName = String(body?.venue_name || '').trim();
    const rawSlug = String(body?.slug || '').toLowerCase().trim();
    const cleanSlug = rawSlug.replace(/[^a-z0-9-]/g, '');
    const ownerName = String(body?.owner_name || '').trim();
    const ownerPhone = String(body?.owner_phone || '').trim();

    if (cleanSlug.length < 3 || RESERVED_SLUGS.has(cleanSlug)) {
      return NextResponse.json({ detail: 'Invalid or reserved subdomain slug' }, { status: 400 });
    }

    if (registeredTenants.has(cleanSlug)) {
      return NextResponse.json({ detail: 'Subdomain slug is already taken' }, { status: 409 });
    }

    const record = {
      tenant_id: crypto.randomUUID(),
      slug: cleanSlug,
      venue_name: venueName,
      owner_name: ownerName,
      owner_phone: ownerPhone,
      workspace_url: `https://${cleanSlug}.eventledger.cloud`,
      owner_id: crypto.randomUUID(),
    };

    registeredTenants.set(cleanSlug, record);
    return NextResponse.json(record, { status: 201 });
  } catch {
    return NextResponse.json({ detail: 'Invalid request payload' }, { status: 400 });
  }
}
