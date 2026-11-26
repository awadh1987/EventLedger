'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { apiFetch, getNativeWorkspace, isNativeRuntime } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { AppHeader } from '@/components/layout/AppHeader';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import { WorkspaceConnectScreen } from '@/components/native/WorkspaceConnectScreen';
import type { AuthUser } from '@/lib/types';

export default function LoginPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const router = useRouter();
  const { setSession } = useAuth();

  const [showConnect, setShowConnect] = useState(isNativeRuntime() && !getNativeWorkspace());
  const [identifier, setIdentifier] = useState('owner@almassa.eventledger.local');
  const [password, setPassword] = useState('Almassa@2026');
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (showConnect) {
    return <WorkspaceConnectScreen locale={locale} onConnected={() => setShowConnect(false)} />;
  }

  const routeAfterLogin = (u: AuthUser) => {
    if (u.user_type === 'SUPER_ADMIN') {
      router.push(`/${locale}/admin`);
    } else if (u.user_type === 'INTERNAL_STAFF') {
      if (u.staff_role === 'SECURITY') router.push(`/${locale}/gate`);
      else router.push(`/${locale}/erp/dashboard`);
    } else {
      router.push(`/${locale}/portal/dashboard`);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        status: string;
        access_token?: string;
        user?: AuthUser;
        dev_otp?: string;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: { identifier, password },
        skipAuth: true,
      });
      if (res.status === 'OTP_REQUIRED') {
        setOtpStep(true);
        if (res.dev_otp) setDevOtpHint(res.dev_otp);
      } else if (res.access_token && res.user) {
        setSession(res.access_token, res.user);
        routeAfterLogin(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ access_token: string; user: AuthUser }>('/api/v1/auth/otp-login', {
        method: 'POST',
        body: { identifier, otp_code: otpCode },
        skipAuth: true,
      });
      setSession(res.access_token, res.user);
      routeAfterLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
        <SpotlightCard className="space-y-5 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
            <SpotlightHeading as="h1" className="text-xl">
              {otpStep
                ? isRtl
                  ? 'التحقق الثنائي (OTP)'
                  : 'Two-Factor Verification'
                : isRtl
                  ? 'تسجيل الدخول إلى مساحة العمل'
                  : 'Sign In to Workspace'}
            </SpotlightHeading>
          </div>

          {!otpStep ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'البريد الإلكتروني أو رقم الجوال' : 'Email or Phone'}
                </label>
                <input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'كلمة المرور' : 'Password'}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              {error && <p className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60"
              >
                {loading ? (isRtl ? 'جارٍ الدخول...' : 'Signing in...') : isRtl ? 'دخول' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              {devOtpHint && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-400">
                  {isRtl ? `رمز التطوير: ${devOtpHint}` : `Dev OTP: ${devOtpHint}`}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {isRtl ? 'رمز التحقق (6 أرقام)' : '6-digit OTP Code'}
                </label>
                <input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                  maxLength={6}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              {error && <p className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950"
              >
                {isRtl ? 'تأكيد الرمز' : 'Verify OTP'}
              </button>
            </form>
          )}

          <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
            <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
              <KeyRound className="h-3.5 w-3.5" />
              {isRtl ? 'حسابات التجربة السريعة (almassa):' : 'Quick Demo Accounts (almassa):'}
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {[
                { label: 'Owner', id: 'owner@almassa.eventledger.local', pw: 'Almassa@2026' },
                { label: 'Finance', id: 'finance@almassa.eventledger.local', pw: 'Finance@2026' },
                { label: 'Client', id: 'ahmed@client.local', pw: 'Client@2026' },
                { label: 'Gate', id: 'gate@almassa.eventledger.local', pw: 'Gate@2026' },
              ].map((acc) => (
                <button
                  key={acc.label}
                  type="button"
                  onClick={() => {
                    setIdentifier(acc.id);
                    setPassword(acc.pw);
                  }}
                  className="rounded border border-slate-200 px-2 py-1.5 text-start hover:border-[var(--brand-primary)] dark:border-slate-800"
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>
        </SpotlightCard>
      </main>
    </div>
  );
}
