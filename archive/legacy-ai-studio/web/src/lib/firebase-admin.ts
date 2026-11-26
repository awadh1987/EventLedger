import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import type { NextRequest } from 'next/server';
import firebaseConfig from '@root/firebase-applet-config.json';
import { getOrCreateUser } from '@db/users.ts';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const adminAuth = getAuth();

export async function verifyBearerToken(token: string): Promise<DecodedIdToken> {
  const decoded = await adminAuth.verifyIdToken(token);
  await getOrCreateUser(
    decoded.uid,
    decoded.email ?? `${decoded.uid}@users.eventledger.local`,
    decoded.name ?? null,
    decoded.picture ?? null
  );
  return decoded;
}

export async function verifyFirebaseAuth(
  req: NextRequest
): Promise<{ user: DecodedIdToken } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Unauthorized: Please sign in with Google to access workspace data.', status: 401 };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { error: 'Unauthorized: Missing authentication token.', status: 401 };
  }

  try {
    const user = await verifyBearerToken(token);
    return { user };
  } catch (err) {
    console.error('Error verifying Firebase ID token:', err);
    return { error: 'Unauthorized: Invalid or expired authentication token.', status: 401 };
  }
}
