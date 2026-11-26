'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '@/lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  getAuthToken: (forceRefresh?: boolean) => Promise<string | null>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // Keep ID token strictly in memory — never in localStorage
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        try {
          tokenRef.current = await nextUser.getIdToken();
        } catch {
          tokenRef.current = null;
        }
      } else {
        tokenRef.current = null;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const token = await credential.user.getIdToken();
      tokenRef.current = token;
      setUser(credential.user);
      return credential.user;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to sign in with Google. Please allow popups and try again.';
      setAuthError(message);
      return null;
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    tokenRef.current = null;
    await signOut(auth);
    setUser(null);
  }, []);

  const getAuthToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    const current = auth.currentUser;
    if (!current) {
      tokenRef.current = null;
      return null;
    }
    const token = await current.getIdToken(forceRefresh);
    tokenRef.current = token;
    return token;
  }, []);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const token = await getAuthToken(false);
      const headers = new Headers(init?.headers ?? {});
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      const res = await fetch(input, { ...init, headers });
      if (res.status === 401 && auth.currentUser) {
        const refreshed = await getAuthToken(true);
        if (refreshed) {
          headers.set('Authorization', `Bearer ${refreshed}`);
          return fetch(input, { ...init, headers });
        }
      }
      return res;
    },
    [getAuthToken]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      authError,
      signInWithGoogle,
      signOutUser,
      getAuthToken,
      authFetch,
    }),
    [user, loading, authError, signInWithGoogle, signOutUser, getAuthToken, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
