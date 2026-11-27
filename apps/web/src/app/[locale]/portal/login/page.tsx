'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, UserRound } from 'lucide-react';
import { apiFetch, setTenantSlug, tenantPath } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';
import { AppHeader } from '@/components/layout/AppHeader';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { AuthUser } from '@/lib/types';

type Tab = 'SIGN_IN' | 'REGISTER' | 'RESET';

interface AuthResponse {
  status: string;
  access_token?: string;
  user?: AuthUser;
  dev_otp?: string;
}

const showDemo = process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';
const DEMO_CLIENT = {
  id: process.env.NEXT_PUBLIC_DEMO_CLIENT_ID || '',
  pw: process.env.NEXT_PUBLIC_DEMO_CLIENT_PW || '',
};

const inputCls =
  'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950';
const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
const btnCls =
  'min-h-[44px] w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60';

function ClientPortalLoginInner() {
  const params = useParams<{ locale: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const { loginSession, tenantSlug } = useAuth();
  const branding = useTenantBranding();
  const tr = (ar: string, en: string) => (isRtl ? ar : en);

  const hasSlugInPath = /^\/(?:ar|en)\/t\/([a-z0-9-]+)/i.test(pathname);
  const [venues, setVenues] = useState<{ name: string; slug: string }[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(tenantSlug || '');

  useEffect(() => {
    setSelectedSlug(tenantSlug || '');
  }, [tenantSlug]);

  useEffect(() => {
    if (hasSlugInPath) return;
    let alive = true;
    apiFetch<{ tenants: { name: string; slug: string }[] }>('/api/v1/public/tenants', { skipAuth: true })
      .then((res) => {
        if (!alive || !res.tenants?.length) return;
        setVenues(res.tenants);
        setSelectedSlug((prev) => (res.tenants.some((v) => v.slug === prev) ? prev : res.tenants[0].slug));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasSlugInPath]);

  const effectiveSlug = hasSlugInPath ? tenantSlug : selectedSlug;

  const initialTab: Tab = searchParams.get('tab') === 'register' ? 'REGISTER' : 'SIGN_IN';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [clientCategory, setClientCategory] = useState<'INDIVIDUAL_B2C' | 'CORPORATE_B2B'>('INDIVIDUAL_B2C');
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('tab') === 'register') setTab('REGISTER');
  }, [searchParams]);

  useEffect(() => {
    const code = searchParams.get('booking');
    try {
      const raw = localStorage.getItem('el_pending_booking');
      const pending = raw ? (JSON.parse(raw) as { booking_code?: string; client_phone?: string }) : null;
      if (code || pending?.booking_code) {
        setBookingCode(code || pending?.booking_code || null);
      }
      if (pending?.client_phone) {
        setIdentifier((prev) => prev || pending.client_phone || '');
      }
    } catch {
      if (code) setBookingCode(code);
    }
  }, [searchParams]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
    setInfo(null);
  };

  const finish = (token: string, user: AuthUser): boolean => {
    if (user.user_type === 'SUPER_ADMIN' || user.user_type === 'INTERNAL_STAFF') {
      setError(
        tr(
          'هذا حساب موظف. استخدم تسجيل دخول الموظفين والملاك.',
          'This is a staff account. Please use the Venue Staff & Owner sign-in.'
        )
      );
      return false;
    }
    const targetSlug = user.tenant_slug || effectiveSlug;
    loginSession(token, user, targetSlug);
    router.push(tenantPath(locale, targetSlug, '/portal/dashboard'));
    return true;
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('حدث خطأ', 'Something went wrong'));
    } finally {
      setLoading(false);
    }
  };

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await apiFetch<AuthResponse>(
        '/api/v1/auth/login',
        {
          method: 'POST',
          body: { identifier: identifier.trim(), password },
          skipAuth: true,
        },
        effectiveSlug
      );
      if (res.status === 'OTP_REQUIRED') {
        setTab('RESET');
        setOtpSent(true);
        if (res.dev_otp) setDevOtp(res.dev_otp);
        setInfo(tr('أدخل رمز التحقق المرسل إليك.', 'Enter the verification code sent to you.'));
      } else if (res.access_token && res.user) {
        finish(res.access_token, res.user);
      }
    });
  };

  const onRegister = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await apiFetch<AuthResponse>(
        '/api/v1/auth/register-client',
        {
          method: 'POST',
          body: {
            full_name: fullName.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            password,
            client_category: clientCategory,
            company_name: clientCategory === 'CORPORATE_B2B' ? companyName.trim() || null : null,
            tax_id: clientCategory === 'CORPORATE_B2B' ? taxId.trim() || null : null,
          },
          skipAuth: true,
        },
        effectiveSlug
      );
      if (res.access_token && res.user) finish(res.access_token, res.user);
    });
  };

  const onRequestOtp = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await apiFetch<AuthResponse>(
        '/api/v1/auth/otp-request',
        {
          method: 'POST',
          body: { identifier: identifier.trim() },
          skipAuth: true,
        },
        effectiveSlug
      );
      setOtpSent(true);
      setDevOtp(res.dev_otp ?? null);
      setInfo(tr('تم إرسال رمز التحقق.', 'Verification code sent.'));
    });
  };

  const onResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiFetch<{ status: string }>(
        '/api/v1/auth/reset-password',
        {
          method: 'POST',
          body: { identifier: identifier.trim(), otp_code: otpCode.trim(), new_password: newPassword },
          skipAuth: true,
        },
        effectiveSlug
      );
      setOtpSent(false);
      setOtpCode('');
      setNewPassword('');
      setDevOtp(null);
      setTab('SIGN_IN');
      setPassword('');
      setInfo(tr('تم تغيير كلمة المرور. سجّل الدخول الآن.', 'Password updated. You can sign in now.'));
    });
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'SIGN_IN', label: tr('دخول العميل', 'Client Sign In') },
    { key: 'REGISTER', label: tr('إنشاء حساب عميل', 'New Client Registration') },
    { key: 'RESET', label: tr('نسيت كلمة المرور / OTP', 'Forgot Password / OTP Reset') },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader locale={locale} />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
        <SpotlightCard className="space-y-5 p-6">
          <div className="flex items-center gap-2">
            <UserRound className="h-6 w-6 text-[var(--brand-primary,#D4AF37)]" />
            <SpotlightHeading as="h1" className="text-xl">
              {tr('بوابة العميل', 'Client Portal')}
              {hasSlugInPath ? ` — ${branding.venueName}` : ''}
            </SpotlightHeading>
          </div>

          {!hasSlugInPath && venues.length > 0 && (
            <div>
              <label className={labelCls} htmlFor="cp-venue">
                {tr('اختر القاعة / المنشأة', 'Select Venue Workspace')}
              </label>
              <select
                id="cp-venue"
                value={selectedSlug}
                onChange={(e) => {
                  setSelectedSlug(e.target.value);
                  setTenantSlug(e.target.value);
                }}
                className={inputCls}
              >
                <option value="">{tr('دخول موحد عبر إيفنت ليدجر (تلقائي)', 'Unified EventLedger Sign In (Auto-Detect)')}</option>
                {venues.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name} (/{v.slug})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div role="tablist" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={tab === tb.key}
                onClick={() => switchTab(tb.key)}
                className={`-mb-px flex-1 border-b-2 px-1 py-2 text-[11px] leading-tight transition ${
                  tab === tb.key
                    ? 'border-[var(--brand-primary)] font-semibold text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {bookingCode && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-300">
              {tr(
                `تم تسجيل حجزك (${bookingCode}). سجّل الدخول برقم جوالك وكلمة المرور أو اطلب رمز OTP.`,
                `Booking ${bookingCode} is reserved. Sign in with your phone and password or request an OTP.`
              )}
            </div>
          )}
          {info && <p className="rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-600">{info}</p>}
          {error && (
            <p role="alert" className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-500">
              {error}
            </p>
          )}

          {tab === 'SIGN_IN' && (
            <form onSubmit={onSignIn} className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="cp-id">
                  {tr('البريد الإلكتروني أو رقم الجوال', 'Email or Phone')}
                </label>
                <input id="cp-id" dir="ltr" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="cp-pw">
                  {tr('كلمة المرور', 'Password')}
                </label>
                <input id="cp-pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              </div>
              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? tr('جارٍ الدخول...', 'Signing in...') : tr('دخول', 'Sign In')}
              </button>
              {showDemo && DEMO_CLIENT.id && DEMO_CLIENT.pw && (
                <button
                  type="button"
                  onClick={() => {
                    setIdentifier(DEMO_CLIENT.id);
                    setPassword(DEMO_CLIENT.pw);
                  }}
                  className="flex w-full items-center justify-center gap-1 rounded border border-slate-200 px-2 py-1.5 text-[11px] hover:border-[var(--brand-primary)] dark:border-slate-800"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {tr('تعبئة عميل تجريبي', 'Fill demo client')} ({DEMO_CLIENT.id})
                </button>
              )}
            </form>
          )}

          {tab === 'REGISTER' && (
            <form onSubmit={onRegister} className="space-y-3.5">
              <div>
                <label className={labelCls}>{tr('نوع الحساب', 'Client Type')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setClientCategory('INDIVIDUAL_B2C')}
                    className={`min-h-[40px] rounded-lg border text-xs font-semibold ${
                      clientCategory === 'INDIVIDUAL_B2C'
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/15 text-slate-900 dark:text-white'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {tr('أفراد (B2C)', 'Individual (B2C)')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClientCategory('CORPORATE_B2B')}
                    className={`min-h-[40px] rounded-lg border text-xs font-semibold ${
                      clientCategory === 'CORPORATE_B2B'
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/15 text-slate-900 dark:text-white'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {tr('شركات (B2B)', 'Corporate (B2B)')}
                  </button>
                </div>
              </div>

              {clientCategory === 'CORPORATE_B2B' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="cp-company">
                      {tr('اسم الشركة', 'Company Name')}
                    </label>
                    <input id="cp-company" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="cp-tax">
                      {tr('الرقم الضريبي / السجل', 'Tax / CR ID')}
                    </label>
                    <input id="cp-tax" dir="ltr" required value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls} htmlFor="cp-name">
                  {tr('الاسم الكامل', 'Full Name')}
                </label>
                <input id="cp-name" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="cp-phone">
                  {tr('الجوال / واتساب', 'Phone / WhatsApp')}
                </label>
                <input id="cp-phone" dir="ltr" required minLength={7} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="cp-email">
                  {tr('البريد الإلكتروني (اختياري)', 'Email (optional)')}
                </label>
                <input id="cp-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="cp-newpw">
                  {tr('كلمة المرور (8 أحرف على الأقل)', 'Password (min 8 characters)')}
                </label>
                <input id="cp-newpw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              </div>
              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? tr('جارٍ التسجيل...', 'Creating Account...') : tr('إنشاء حساب والدخول للبوابة', 'Create Account & Enter Portal')}
              </button>
            </form>
          )}

          {tab === 'RESET' && (
            <form onSubmit={otpSent ? onResetPassword : onRequestOtp} className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="cp-rid">
                  {tr('البريد الإلكتروني أو رقم الجوال', 'Email or Phone')}
                </label>
                <input id="cp-rid" dir="ltr" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={inputCls} />
              </div>
              {otpSent && (
                <>
                  {devOtp && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-500">
                      {tr('رمز التطوير', 'Dev OTP')}: {devOtp}
                    </div>
                  )}
                  <div>
                    <label className={labelCls} htmlFor="cp-otp">
                      {tr('رمز التحقق (6 أرقام)', '6-digit OTP Code')}
                    </label>
                    <input
                      id="cp-otp"
                      required
                      maxLength={6}
                      inputMode="numeric"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      className={`${inputCls} text-center font-mono text-lg tracking-widest`}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="cp-rpw">
                      {tr('كلمة المرور الجديدة', 'New Password')}
                    </label>
                    <input id="cp-rpw" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
                  </div>
                </>
              )}
              <button type="submit" disabled={loading} className={btnCls}>
                {otpSent ? tr('تعيين كلمة المرور', 'Reset Password') : tr('إرسال رمز التحقق', 'Send OTP')}
              </button>
            </form>
          )}

          <Link
            href={tenantPath(locale, effectiveSlug, '/staff-login')}
            className="block border-t border-slate-200 pt-3 text-center text-xs font-medium text-[var(--brand-primary,#D4AF37)] hover:underline dark:border-slate-800"
          >
            {tr('موظف أو مالك قاعة؟ ادخل من هنا ›', 'Venue staff or owner? Sign in here ›')}
          </Link>
        </SpotlightCard>
      </main>
    </div>
  );
}

export default function ClientPortalLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
      <ClientPortalLoginInner />
    </Suspense>
  );
}
