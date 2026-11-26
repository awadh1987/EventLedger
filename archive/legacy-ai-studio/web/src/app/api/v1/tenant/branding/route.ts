import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import {
  getTenantBrandingRecord,
  updateTenantBrandingRecord,
} from '@db/tenant-erp.ts';

export async function GET() {
  try {
    const branding = await getTenantBrandingRecord();
    return NextResponse.json({ branding });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load tenant branding.';
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
    const patch: Record<string, unknown> = {};

    const stringFields = [
      'venueNameAr',
      'venueNameEn',
      'taglineAr',
      'taglineEn',
      'slug',
      'customDomain',
      'currency',
      'primaryColor',
      'accentColor',
      'defaultTheme',
      'spotlightColor',
      'contactPhone',
      'contactEmail',
      'addressAr',
      'addressEn',
      'invoiceFooterAr',
      'invoiceFooterEn',
    ] as const;

    for (const key of stringFields) {
      if (typeof body?.[key] === 'string' && body[key].trim().length > 0) {
        patch[key] = body[key].trim();
      }
    }

    if (body?.logoLightUrl === null || typeof body?.logoLightUrl === 'string') {
      patch.logoLightUrl = body.logoLightUrl ? body.logoLightUrl.trim() : null;
    }
    if (body?.logoDarkUrl === null || typeof body?.logoDarkUrl === 'string') {
      patch.logoDarkUrl = body.logoDarkUrl ? body.logoDarkUrl.trim() : null;
    }
    if (typeof body?.enableSpotlight === 'boolean') {
      patch.enableSpotlight = body.enableSpotlight;
    }
    if (typeof body?.taxRate === 'number' && Number.isFinite(body.taxRate)) {
      patch.taxRate = Math.max(0, Math.min(30, Math.round(body.taxRate)));
    }
    if (
      typeof body?.defaultSecurityDeposit === 'number' &&
      Number.isFinite(body.defaultSecurityDeposit)
    ) {
      patch.defaultSecurityDeposit = Math.max(0, Math.round(body.defaultSecurityDeposit));
    }

    const updated = await updateTenantBrandingRecord(patch);
    return NextResponse.json({ branding: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save tenant branding.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
