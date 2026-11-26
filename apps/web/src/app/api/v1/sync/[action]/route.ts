import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    tenant_slug: 'almassa',
    synced_at: new Date().toISOString(),
    events: [
      {
        id: 'EVT-2026-101',
        event_code: 'EVT-2026-101',
        start_time: new Date().toISOString(),
        guest_count: 250,
      },
    ],
    gate_passes: [
      {
        id: 'gp-101',
        qr_token: 'QR-ALMASSA-VIP-001',
        holder_name: 'Ahmed Al-Shami',
        is_checked_in: false,
      },
    ],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mutations = Array.isArray(body?.mutations) ? body.mutations : [];
  return NextResponse.json({
    status: 'SYNCED',
    device_id: body?.device_id || 'native-device',
    processed_count: mutations.length,
    processed_ids: mutations.map((m: { mutation_id?: string }) => m.mutation_id || ''),
  });
}
