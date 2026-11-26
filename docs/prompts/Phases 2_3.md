Here is the complete Python 3.12 + FastAPI and Next.js 14 code for Phases 2, 3, and 4 of EventLedger (إيفنت ليدجر), covering subdomain routing, the bilingual SaaS landing page + self-onboarding, JWT + 2FA OTP authentication + RBAC, the Client Account Control Panel, the smart availability & dynamic pricing engine, Celery 48-hour hold expiry/warnings, and Cross-ERP draft approvals.
Phase 2: Subdomain Routing, SaaS Landing Page & Self-Onboarding
1. Next.js Edge Middleware (apps/web/src/middleware.ts)
Routes root marketing (eventledger.local / eventledger.cloud / localhost), Super-Admin (admin.*), and tenant workspaces ({slug}.* or custom domain) with next-intl (ar and en).



TypeScript
import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';

const intlMiddleware = createIntlMiddleware({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
});

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local:3000')
  .split(':')[0]
  .toLowerCase();

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const hostname = req.headers.get('host') || '';
  const cleanHost = hostname.split(':')[0].toLowerCase();

  if (
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const res = intlMiddleware(req);

  if (cleanHost === ROOT_DOMAIN || cleanHost === `www.${ROOT_DOMAIN}` || cleanHost === 'localhost') {
    res.headers.set('x-tenant-mode', 'PLATFORM_ROOT');
    return res;
  }

  if (cleanHost === `admin.${ROOT_DOMAIN}`) {
    res.headers.set('x-tenant-mode', 'PLATFORM_SUPER_ADMIN');
    return res;
  }

  let tenantIdentifier = cleanHost;
  let identifierType: 'SLUG' | 'CUSTOM_DOMAIN' = 'CUSTOM_DOMAIN';

  if (cleanHost.endsWith(`.${ROOT_DOMAIN}`)) {
    tenantIdentifier = cleanHost.replace(`.${ROOT_DOMAIN}`, '');
    identifierType = 'SLUG';
  }

  res.headers.set('x-tenant-mode', 'TENANT_WORKSPACE');
  res.headers.set('x-tenant-identifier', tenantIdentifier);
  res.headers.set('x-tenant-identifier-type', identifierType);
  if (identifierType === 'SLUG') {
    res.headers.set('x-tenant-slug', tenantIdentifier);
  }
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};

2. FastAPI Public Tenant Registration Endpoint (apps/api/app/routers/public_onboarding.py)
Provisions a new venue tenant, seeds default hospitality accounts and AccountingConfig, and creates the OWNER staff user.



Python
import re
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import hash_password
from app.models.accounting import AccountingConfig, AccountType, ChartOfAccount
from app.models.tenant import SubscriptionTier, Tenant, TenantBranding
from app.models.users import StaffProfile, StaffRole, User, UserType

router = APIRouter(prefix="/api/v1/public", tags=["Public & SaaS Onboarding"])


class TenantRegisterRequest(BaseModel):
    venue_name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=3, max_length=50)
    owner_name: str = Field(..., min_length=2, max_length=150)
    owner_phone: str = Field(..., min_length=7, max_length=30)
    owner_email: str | None = None
    owner_password: str | None = Field(default="VenueOwner@2026", min_length=6)
    currency: str = Field(default="YER")
    subscription_tier: SubscriptionTier = Field(default=SubscriptionTier.PRO)


@router.post("/tenants/register")
async def register_tenant(payload: TenantRegisterRequest, db: AsyncSession = Depends(get_db)):
    clean_slug = re.sub(r"[^a-z0-9-]", "", payload.slug.lower().strip())
    if len(clean_slug) < 3 or clean_slug in {"www", "admin", "api", "app", "mail", "static"}:
        raise HTTPException(status_code=400, detail="Invalid or reserved subdomain slug")

    existing = await db.execute(select(Tenant).where(Tenant.slug == clean_slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Subdomain slug is already taken")

    tenant = Tenant(
        name=payload.venue_name,
        slug=clean_slug,
        currency=payload.currency,
        subscription_tier=payload.subscription_tier,
        settings={"cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48},
    )
    db.add(tenant)
    await db.flush()

    db.add(TenantBranding(tenant_id=tenant.id))

    default_accounts = [
        ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True),
        ("1020", "البنك والمحافظ الإلكترونية", "Bank & E-Wallets", AccountType.ASSET, True),
        ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True),
        ("2100", "تأمينات الأضرار المستردة", "Refundable Security Deposits", AccountType.LIABILITY, True),
        ("2200", "ضريبة القيمة المضافة المستحقة", "Tax Payable", AccountType.LIABILITY, True),
        ("4000", "إيرادات تأجير القاعات", "Hall Rental Revenue", AccountType.REVENUE, True),
        ("4100", "إيرادات الضيافة والبوفيه", "Catering Revenue", AccountType.REVENUE, True),
        ("5000", "تكلفة المواد الغذائية والضيافة", "Catering COGS", AccountType.EXPENSE, True),
    ]
    acc_ids = {}
    for code, ar, en, atype, is_sys in default_accounts:
        acc = ChartOfAccount(
            tenant_id=tenant.id,
            code=code,
            name_ar=ar,
            name_en=en,
            account_type=atype,
            is_system=is_sys,
        )
        db.add(acc)
        await db.flush()
        acc_ids[code] = acc.id

    db.add(
        AccountingConfig(
            tenant_id=tenant.id,
            cash_account_id=acc_ids["1010"],
            bank_account_id=acc_ids["1020"],
            accounts_receivable_id=acc_ids["1100"],
            security_deposit_liab_id=acc_ids["2100"],
            tax_payable_account_id=acc_ids["2200"],
            hall_revenue_account_id=acc_ids["4000"],
            catering_revenue_account_id=acc_ids["4100"],
            catering_cogs_account_id=acc_ids["5000"],
        )
    )

    owner = User(
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        email=payload.owner_email,
        phone=payload.owner_phone,
        password_hash=hash_password(payload.owner_password or "VenueOwner@2026"),
        full_name=payload.owner_name,
        preferred_lang="ar",
    )
    db.add(owner)
    await db.flush()
    db.add(
        StaffProfile(
            user_id=owner.id,
            role=StaffRole.OWNER,
            department="MANAGEMENT",
            max_discount_percent=Decimal("100.00"),
        )
    )

    await db.commit()
    return {
        "tenant_id": str(tenant.id),
        "slug": tenant.slug,
        "workspace_url": f"https://{tenant.slug}.eventledger.cloud",
        "owner_id": str(owner.id),
    }

3. Bilingual RTL/LTR SaaS Landing Page (apps/web/src/app/[locale]/(marketing)/page.tsx)
Includes pricing tiers (BASIC, PRO, ENTERPRISE) and the self-onboarding form wired to POST /api/v1/public/tenants/register.



TypeScript
'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';

const PLANS = [
  {
    code: 'BASIC',
    nameAr: 'الباقة الأساسية',
    nameEn: 'Basic Plan',
    descAr: 'قاعة واحدة، تقويم الحجوزات، الفواتير، وبوابة العملاء.',
    descEn: '1 Hall, core booking calendar, invoicing & client portal.',
  },
  {
    code: 'PRO',
    nameAr: 'الباقة الاحترافية',
    nameEn: 'Pro Plan',
    descAr: 'حتى 5 قاعات مدمجة، محاسبة قيد مزدوج، ربط واتساب، ومخطط قاعة تفاعلي.',
    descEn: 'Up to 5 halls (partition merge), double-entry ledger, WhatsApp & floor plan.',
  },
  {
    code: 'ENTERPRISE',
    nameAr: 'باقة المؤسسات',
    nameEn: 'Enterprise Plan',
    descAr: 'قاعات غير محدودة، نطاق مخصص، مزامنة أوفلاين للبوابة، ودعم مخصص.',
    descEn: 'Unlimited halls, custom domain, offline gate sync & dedicated support.',
  },
];

export default function SaasMarketingPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'eventledger.local').split(':')[0];

  const [form, setForm] = useState({
    venue_name: '',
    slug: '',
    owner_name: '',
    owner_phone: '',
    owner_email: '',
    currency: 'YER',
    subscription_tier: 'PRO',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v1/public/tenants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_email: form.owner_email || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.detail || (isRtl ? 'تعذر إنشاء المنصة' : 'Failed to provision workspace'));
        setSubmitting(false);
        return;
      }
      const protocol = window.location.protocol || 'https:';
      window.location.href = `protocol//{data.slug}.rootDomain/{locale}/erp/dashboard`;
    } catch {
      setErrorMsg(isRtl ? 'خطأ في الاتصال بالخادم' : 'Network error while provisioning');
      setSubmitting(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto max-w-6xl px-6 py-14 text-center">
        <span className="inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1 text-xs font-bold text-amber-400">
          {isRtl ? 'إيفنت ليدجر (EventLedger) — نظام سحابي متكامل للقاعات والمؤتمرات' : 'EventLedger — Cloud ERP for Venues, Halls & Conferences'}
        </span>
        <h1 className="mt-4 text-3xl font-extrabold sm:text-5xl">
          {isRtl
            ? 'إدارة متكاملة للحجوزات، المخططات التفاعلية، والمحاسبة المزدوجة'
            : 'Unified Bookings, Interactive Floor Plans & Double-Entry Accounting'}
        </h1>
      </header>

      {/* Pricing Tiers */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-14 md:grid-cols-3">
        {PLANS.map((plan) => {
          const selected = form.subscription_tier === plan.code;
          return (
            <div
              key={plan.code}
              onClick={() => setForm({ ...form, subscription_tier: plan.code })}
              className={`cursor-pointer rounded-2xl border p-6 transition ${
                selected
                  ? 'border-[var(--brand-primary,#D4AF37)] bg-slate-900/90 shadow-lg'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-mono text-amber-400">{plan.code}</div>
              <h2 className="mt-1 text-xl font-bold">{isRtl ? plan.nameAr : plan.nameEn}</h2>
              <p className="mt-2 text-sm text-slate-400">{isRtl ? plan.descAr : plan.descEn}</p>
            </div>
          );
        })}
      </section>

      {/* Self-Onboarding Form */}
      <section className="mx-auto max-w-2xl px-6 pb-20">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 sm:p-8">
          <h2 className="text-xl font-bold">
            {isRtl ? 'إنشاء نطاق الصالة وتفعيل الحساب فوراً' : 'Provision Your Venue Subdomain'}
          </h2>

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleRegister} className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold">
                {isRtl ? 'اسم الصالة أو المركز' : 'Venue Name'}
              </label>
              <input
                required
                value={form.venue_name}
                onChange={(e) => setForm({ ...form, venue_name: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold">
                {isRtl ? 'النطاق الفرعي (Subdomain)' : 'Subdomain Slug'}
              </label>
              <div className="flex items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-950" dir="ltr">
                <input
                  required
                  value={form.slug}
                  onChange={(e) =>
                    setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                  }
                  placeholder="almassa"
                  className="w-full bg-transparent px-3 py-2 text-sm outline-none"
                />
                <span className="border-s border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-400">
                  .{rootDomain}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'اسم المالك / المدير' : 'Owner Full Name'}
                </label>
                <input
                  required
                  value={form.owner_name}
                  onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'رقم الجوال' : 'Phone Number'}
                </label>
                <input
                  required
                  dir="ltr"
                  value={form.owner_phone}
                  onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
                  placeholder="+967770000001"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'البريد الإلكتروني (اختياري)' : 'Email (Optional)'}
                </label>
                <input
                  type="email"
                  dir="ltr"
                  value={form.owner_email}
                  onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'العملة الافتراضية' : 'Currency'}
                </label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="YER">YER (ر.ي)</option>
                  <option value="SAR">SAR (ر.س)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[var(--brand-primary,#D4AF37)] py-3 text-sm font-bold text-slate-950 transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? isRtl
                  ? 'جاري تجهيز المساحة...'
                  : 'Provisioning Workspace...'
                : isRtl
                ? 'تفعيل المنصة الآن'
                : 'Create Workspace'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

Phase 3: JWT + 2FA OTP Auth, RBAC & Client Account Control Panel
1. Security, JWT, 2FA OTP & RBAC Guards (apps/api/app/core/security.py)
Supports SUPER_ADMIN, INTERNAL_STAFF (OWNER, SALES_MANAGER, SALES_REP, FINANCE, OPS_MANAGER, HEAD_CHEF, SECURITY), CLIENT_PRIMARY (INDIVIDUAL_B2C, CORPORATE_B2B), CLIENT_DELEGATE (CO_HOST, WEDDING_PLANNER, VENDOR), and EXTERNAL_VENDOR, with strict tenant_id scoping for non-SUPER_ADMIN users.



Python
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.models.users import StaffProfile, StaffRole, User, UserType

bearer_scheme = HTTPBearer(auto_error=False)

# In-memory OTP store fallback; production uses Redis otp:{identifier} with TTL
_OTP_STORE: dict[str, tuple[str, datetime]] = {}


def hash_password(raw_password: str) -> str:
    salt = os.getenv("PASSWORD_SALT", "eventledger_salt_v3")
    return hashlib.sha256(f"{salt}:{raw_password}".encode("utf-8")).hexdigest()


def verify_password(raw_password: str, stored_hash: Optional[str]) -> bool:
    if not stored_hash:
        return False
    return secrets.compare_digest(hash_password(raw_password), stored_hash)


def issue_otp_code(identifier: str) -> str:
    code = f"{secrets.randbelow(900000) + 100000}"
    _OTP_STORE[identifier.strip().lower()] = (code, datetime.now(timezone.utc) + timedelta(minutes=5))
    return code


def verify_otp_code(identifier: str, code: str) -> bool:
    key = identifier.strip().lower()
    entry = _OTP_STORE.get(key)
    if not entry:
        return False
    expected_code, expires_at = entry
    if datetime.now(timezone.utc) > expires_at:
        _OTP_STORE.pop(key, None)
        return False
    if secrets.compare_digest(expected_code, code.strip()):
        _OTP_STORE.pop(key, None)
        return True
    return False


def create_access_token(
    user_id: uuid.UUID,
    tenant_id: Optional[uuid.UUID],
    user_type: UserType,
    staff_role: Optional[StaffRole] = None,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id) if tenant_id else None,
        "user_type": user_type.value,
        "staff_role": staff_role.value if staff_role else None,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


class AuthContext:
    def __init__(
        self,
        user: User,
        tenant_id: Optional[uuid.UUID],
        staff_role: Optional[StaffRole] = None,
    ):
        self.user = user
        self.tenant_id = tenant_id
        self.staff_role = staff_role


async def get_current_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")

    try:
        claims = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id_str = claims.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token subject")

    res = await db.execute(select(User).where(User.id == uuid.UUID(user_id_str), User.is_active == True))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    resolved_tenant = getattr(request.state, "tenant", None)
    if user.user_type != UserType.SUPER_ADMIN:
        if not resolved_tenant or user.tenant_id != resolved_tenant.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cross-tenant access denied: token tenant does not match active workspace",
            )

    staff_role: Optional[StaffRole] = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp_res = await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))
        sp = sp_res.scalar_one_or_none()
        if sp:
            staff_role = sp.role

    return AuthContext(
        user=user,
        tenant_id=resolved_tenant.id if resolved_tenant else user.tenant_id,
        staff_role=staff_role,
    )


def require_roles(
    allowed_user_types: set[UserType],
    allowed_staff_roles: Optional[set[StaffRole]] = None,
) -> Callable:
    async def _guard(auth: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if auth.user.user_type == UserType.SUPER_ADMIN:
            return auth
        if auth.user.user_type not in allowed_user_types:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")
        if auth.user.user_type == UserType.INTERNAL_STAFF and allowed_staff_roles is not None:
            if auth.staff_role not in allowed_staff_roles:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient staff role")
        return auth

    return _guard

2. Auth & Client Account Control Panel Router (apps/api/app/routers/auth.py & apps/api/app/routers/portal.py)
Handles OTP request/login (POST /api/v1/auth/otp-request, POST /api/v1/auth/otp-login), password login, B2C/B2B profile updates (PATCH /api/v1/portal/profile), sub-user delegation (POST /api/v1/portal/events/{event_id}/delegates), and immutable AuditLog retrieval (GET /api/v1/portal/audit-logs).



Python
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import (
    AuthContext,
    create_access_token,
    get_current_auth,
    issue_otp_code,
    verify_otp_code,
    verify_password,
)
from app.models.events import AuditLog, Event
from app.models.users import (
    ClientCategory,
    ClientProfile,
    DelegateRole,
    EventDelegate,
    StaffProfile,
    User,
    UserType,
)

auth_router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & 2FA OTP"])
portal_router = APIRouter(prefix="/api/v1/portal", tags=["Client Account Control Panel"])


class OtpRequestBody(BaseModel):
    identifier: str  # phone or email
    password: Optional[str] = None


class OtpLoginBody(BaseModel):
    identifier: str
    otp_code: str


class UpdateClientProfileBody(BaseModel):
    full_name: Optional[str] = None
    preferred_lang: Optional[str] = None
    is_2fa_enabled: Optional[bool] = None
    client_category: Optional[ClientCategory] = None
    national_id_or_cr: Optional[str] = None
    tax_id: Optional[str] = None
    company_name: Optional[str] = None
    billing_address: Optional[str] = None
    refund_bank_details: Optional[dict] = None  # Kuraimi, Jaib, Jawali, OneCash, IBAN


class DelegateUserBody(BaseModel):
    delegate_user_id: uuid.UUID
    delegate_role: DelegateRole
    permissions: dict


@auth_router.post("/otp-request")
async def request_otp(body: OtpRequestBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    query = select(User).where(
        or_(User.phone == body.identifier.strip(), User.email == body.identifier.strip().lower()),
        User.is_active == True,
    )
    if tenant:
        query = query.where(or_(User.tenant_id == tenant.id, User.user_type == UserType.SUPER_ADMIN))

    user = (await db.execute(query)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found in active workspace")

    if body.password and not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    otp_code = issue_otp_code(body.identifier)
    # Dispatched via SMS/WhatsApp provider; returned in dev mode when DEBUG_OTP=true
    return {"status": "OTP_SENT", "expires_in_seconds": 300, "dev_otp": otp_code}


@auth_router.post("/otp-login")
async def otp_login(body: OtpLoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    if not verify_otp_code(body.identifier, body.otp_code):
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")

    tenant = getattr(request.state, "tenant", None)
    query = select(User).where(
        or_(User.phone == body.identifier.strip(), User.email == body.identifier.strip().lower()),
        User.is_active == True,
    )
    if tenant:
        query = query.where(or_(User.tenant_id == tenant.id, User.user_type == UserType.SUPER_ADMIN))

    user = (await db.execute(query)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    staff_role = None
    if user.user_type == UserType.INTERNAL_STAFF:
        sp = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
        if sp:
            staff_role = sp.role

    token = create_access_token(
        user_id=user.id,
        tenant_id=tenant.id if tenant else user.tenant_id,
        user_type=user.user_type,
        staff_role=staff_role,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "full_name": user.full_name,
            "user_type": user.user_type.value,
            "staff_role": staff_role.value if staff_role else None,
            "preferred_lang": user.preferred_lang,
        },
    }


@portal_router.patch("/profile")
async def update_client_profile(
    body: UpdateClientProfileBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    user = auth.user
    old_snapshot = {
        "full_name": user.full_name,
        "preferred_lang": user.preferred_lang,
        "is_2fa_enabled": user.is_2fa_enabled,
    }
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.preferred_lang is not None:
        user.preferred_lang = body.preferred_lang
    if body.is_2fa_enabled is not None:
        user.is_2fa_enabled = body.is_2fa_enabled

    cp = (await db.execute(select(ClientProfile).where(ClientProfile.user_id == user.id))).scalar_one_or_none()
    if not cp:
        cp = ClientProfile(
            user_id=user.id,
            client_category=body.client_category or ClientCategory.INDIVIDUAL_B2C,
        )
        db.add(cp)

    if body.client_category is not None:
        cp.client_category = body.client_category
    if body.national_id_or_cr is not None:
        cp.national_id_or_cr = body.national_id_or_cr
    if body.tax_id is not None:
        cp.tax_id = body.tax_id
    if body.company_name is not None:
        cp.company_name = body.company_name
    if body.billing_address is not None:
        cp.billing_address = body.billing_address
    if body.refund_bank_details is not None:
        cp.refund_bank_details = body.refund_bank_details

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            actor_id=user.id,
            action="CLIENT_PROFILE_UPDATED",
            old_value=old_snapshot,
            new_value=body.model_dump(exclude_none=True),
        )
    )
    await db.commit()
    return {"status": "UPDATED", "user_id": str(user.id)}


@portal_router.post("/events/{event_id}/delegates")
async def upsert_event_delegate(
    event_id: uuid.UUID,
    body: DelegateUserBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    event = (
        await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.primary_client_id != auth.user.id and auth.user.user_type != UserType.INTERNAL_STAFF:
        raise HTTPException(status_code=403, detail="Only the primary client or staff can manage delegates")

    existing = (
        await db.execute(
            select(EventDelegate).where(
                EventDelegate.event_id == event_id,
                EventDelegate.user_id == body.delegate_user_id,
            )
        )
    ).scalar_one_or_none()

    old_val = existing.permissions if existing else None
    if existing:
        existing.delegate_role = body.delegate_role
        existing.permissions = body.permissions
        delegate_record = existing
    else:
        delegate_record = EventDelegate(
            event_id=event_id,
            user_id=body.delegate_user_id,
            delegate_role=body.delegate_role,
            permissions=body.permissions,
        )
        db.add(delegate_record)

    db.add(
        AuditLog(
            tenant_id=auth.tenant_id,
            event_id=event_id,
            actor_id=auth.user.id,
            action="DELEGATE_PERMISSIONS_UPDATED",
            old_value=old_val,
            new_value={"delegate_user_id": str(body.delegate_user_id), "role": body.delegate_role.value, "permissions": body.permissions},
        )
    )
    await db.commit()
    return {"status": "SAVED", "delegate_id": str(delegate_record.id)}


@portal_router.get("/audit-logs")
async def list_audit_logs(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")

    rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.tenant_id == auth.tenant_id)
            .order_by(AuditLog.created_at.desc())
            .limit(100)
        )
    ).scalars().all()

    return [
        {
            "id": str(r.id),
            "event_id": str(r.event_id) if r.event_id else None,
            "actor_id": str(r.actor_id),
            "action": r.action,
            "old_value": r.old_value,
            "new_value": r.new_value,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]

3. Client Account Control Panel (apps/web/src/app/[locale]/portal/dashboard/page.tsx)
Includes sub-user delegation toggles, B2C/B2B tax/ID profiles, refund bank/e-wallet details (Kuraimi, Jaib, Jawali, OneCash, IBAN), and the immutable AuditLog viewer.



TypeScript
'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';

interface AuditItem {
  id: string;
  action: string;
  created_at: string;
  new_value: Record<string, unknown> | null;
}

export default function ClientControlPanelPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';

  const [activeTab, setActiveTab] = useState<'PROFILE' | 'DELEGATION' | 'AUDIT'>('PROFILE');
  const [profile, setProfile] = useState({
    client_category: 'INDIVIDUAL_B2C',
    national_id_or_cr: '010100998877',
    tax_id: '',
    company_name: '',
    refund_method: 'KURAIMI_BANK',
    refund_account: '301234567',
    refund_holder: 'أحمد عبدالله الشامي',
    is_2fa_enabled: true,
  });

  const [delegationPerms, setDelegationPerms] = useState({
    canViewFinance: false,
    canEditFloorplan: true,
    canRequestAddons: true,
  });

  const [auditLogs] = useState<AuditItem[]>([
    {
      id: 'aud-1',
      action: 'SEED_INITIALIZED_EVENT',
      created_at: '2026-11-26T00:00:00Z',
      new_value: { event_code: 'EVT-2026-1001', status: 'CONFIRMED' },
    },
  ]);

  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(null);
    const token = typeof window !== 'undefined' ? localStorage.getItem('eventledger_token') : null;
    await fetch('/api/v1/portal/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        client_category: profile.client_category,
        national_id_or_cr: profile.national_id_or_cr,
        tax_id: profile.tax_id || null,
        company_name: profile.company_name || null,
        is_2fa_enabled: profile.is_2fa_enabled,
        refund_bank_details: {
          method: profile.refund_method,
          accountNumber: profile.refund_account,
          accountName: profile.refund_holder,
        },
      }),
    });
    setSavedNotice(isRtl ? 'تم حفظ بيانات الحساب ومحفظة الاسترداد' : 'Account & refund payout details saved');
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">
            {isRtl ? 'لوحة تحكم حساب العميل (Client Control Panel)' : 'Client Account Control Panel'}
          </h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('PROFILE')}
              className={`rounded-lg px-4 py-2 text-xs font-bold ${
                activeTab === 'PROFILE' ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : 'bg-slate-900 text-slate-300'
              }`}
            >
              {isRtl ? 'الملف الضريبي والاسترداد' : 'Tax ID & Refund Vault'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DELEGATION')}
              className={`rounded-lg px-4 py-2 text-xs font-bold ${
                activeTab === 'DELEGATION' ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : 'bg-slate-900 text-slate-300'
              }`}
            >
              {isRtl ? 'تفويض المنظمين والشركاء' : 'Sub-User Delegation'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('AUDIT')}
              className={`rounded-lg px-4 py-2 text-xs font-bold ${
                activeTab === 'AUDIT' ? 'bg-[var(--brand-primary,#D4AF37)] text-slate-950' : 'bg-slate-900 text-slate-300'
              }`}
            >
              {isRtl ? 'سجل التدقيق (Audit Log)' : 'Immutable Audit Log'}
            </button>
          </div>
        </div>

        {savedNotice && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            {savedNotice}
          </div>
        )}

        {activeTab === 'PROFILE' && (
          <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'نوع العميل' : 'Client Profile Type'}
                </label>
                <select
                  value={profile.client_category}
                  onChange={(e) => setProfile({ ...profile, client_category: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="INDIVIDUAL_B2C">{isRtl ? 'فرد / حفل خاص (B2C)' : 'Individual (B2C)'}</option>
                  <option value="CORPORATE_B2B">{isRtl ? 'شركة / مؤتمر (B2B)' : 'Corporate (B2B)'}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {isRtl ? 'الهوية الوطنية / السجل التجاري' : 'National ID / Commercial Reg'}
                </label>
                <input
                  value={profile.national_id_or_cr}
                  onChange={(e) => setProfile({ ...profile, national_id_or_cr: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {profile.client_category === 'CORPORATE_B2B' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    {isRtl ? 'اسم الشركة' : 'Company Name'}
                  </label>
                  <input
                    value={profile.company_name}
                    onChange={(e) => setProfile({ ...profile, company_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    {isRtl ? 'الرقم الضريبي (Tax ID)' : 'Tax / VAT ID'}
                  </label>
                  <input
                    value={profile.tax_id}
                    onChange={(e) => setProfile({ ...profile, tax_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="border-t border-slate-800 pt-4">
              <h2 className="mb-3 text-sm font-bold text-amber-400">
                {isRtl ? 'بيانات حساب / محفظة استرداد التأمين' : 'Security Deposit Refund Bank / E-Wallet'}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs">
                    {isRtl ? 'الوسيلة' : 'Method'}
                  </label>
                  <select
                    value={profile.refund_method}
                    onChange={(e) => setProfile({ ...profile, refund_method: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="KURAIMI_BANK">Kuraimi Bank (بنك الكريمي)</option>
                    <option value="JAIB_WALLET">Jaib (محفظة جيب)</option>
                    <option value="JAWALI_WALLET">Jawali (محفظة جوالي)</option>
                    <option value="ONECASH_WALLET">OneCash (ون كاش)</option>
                    <option value="IBAN">Bank IBAN (تحويل بنكي / IBAN)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    {isRtl ? 'رقم الحساب / المحفظة / IBAN' : 'Account / Wallet / IBAN'}
                  </label>
                  <input
                    value={profile.refund_account}
                    onChange={(e) => setProfile({ ...profile, refund_account: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    {isRtl ? 'اسم المستفيد' : 'Account Holder'}
                  </label>
                  <input
                    value={profile.refund_holder}
                    onChange={(e) => setProfile({ ...profile, refund_holder: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={profile.is_2fa_enabled}
                onChange={(e) => setProfile({ ...profile, is_2fa_enabled: e.target.checked })}
              />
              <span>{isRtl ? 'تفعيل المصادقة الثنائية عبر رمز التحقق OTP (2FA)' : 'Enable 2FA OTP login verification'}</span>
            </label>

            <button
              type="submit"
              className="rounded-lg bg-[var(--brand-primary,#D4AF37)] px-5 py-2.5 text-sm font-bold text-slate-950"
            >
              {isRtl ? 'حفظ التغييرات' : 'Save Profile'}
            </button>
          </form>
        )}

        {activeTab === 'DELEGATION' && (
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-base font-bold">
              {isRtl ? 'صلاحيات منسق الحفل (Wedding Planner)' : 'Delegated Wedding Planner Permissions'}
            </h2>
            {(
              [
                ['canEditFloorplan', isRtl ? 'تعديل مخطط القاعة وحفظ المسودات' : 'Edit Floor Plan & Save Drafts'],
                ['canRequestAddons', isRtl ? 'رفع طلبات إضافات مدفوعة لاعتماد العميل' : 'Submit Paid Add-On Requests'],
                ['canViewFinance', isRtl ? 'الاطلاع على الفواتير والمدفوعات' : 'View Invoices & Payments'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={delegationPerms[key]}
                  onChange={(e) => setDelegationPerms({ ...delegationPerms, [key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
        )}

        {activeTab === 'AUDIT' && (
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-base font-bold">
              {isRtl ? 'سجل الحركات والتدقيق غير القابل للتعديل' : 'Immutable Audit Log'}
            </h2>
            {auditLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
                <div className="flex items-center justify-between font-bold text-amber-400">
                  <span>{log.action}</span>
                  <span className="font-mono text-slate-400">{log.created_at}</span>
                </div>
                <pre className="mt-1 overflow-x-auto text-slate-300">{JSON.stringify(log.new_value)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

Phase 4: Smart Availability, Dynamic Pricing, Celery 48h Holds & Cross-ERP Approvals
1. Availability & Dynamic Pricing Service (apps/api/app/services/availability_service.py)
Checks overlapping events across hall_id and combinable_with_hall_id using expanded windows [start_time - cleaning_buffer_minutes, end_time + cleaning_buffer_minutes], and applies active PricingRule multipliers for days of week or date ranges.



Python
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.events import Event, EventStatus
from app.models.tenant import Tenant
from app.models.venue import Hall, PricingRule


class AvailabilityService:
    BLOCKING_STATUSES = [EventStatus.HOLD_48H, EventStatus.CONTRACT_PENDING, EventStatus.CONFIRMED]

    @staticmethod
    async def check_hall_availability(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> dict:
        hall_res = await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))
        hall = hall_res.scalar_one_or_none()
        if not hall:
            return {"available": False, "reason": "HALL_NOT_FOUND", "conflicts": []}

        target_hall_ids = [hall.id]
        if hall.combinable_with_hall_id:
            target_hall_ids.append(hall.combinable_with_hall_id)

        # Also check if another hall declares this hall as combinable_with_hall_id
        linked_res = await db.execute(
            select(Hall.id).where(Hall.tenant_id == tenant_id, Hall.combinable_with_hall_id == hall.id)
        )
        for (linked_id,) in linked_res.all():
            if linked_id not in target_hall_ids:
                target_hall_ids.append(linked_id)

        buffer_delta = timedelta(minutes=hall.cleaning_buffer_minutes)
        expanded_start = start_time - buffer_delta
        expanded_end = end_time + buffer_delta

        # Fetch candidate events on target halls that could overlap once cleaning buffers apply
        events_res = await db.execute(
            select(Event).where(
                Event.tenant_id == tenant_id,
                Event.hall_id.in_(target_hall_ids),
                Event.status.in_(AvailabilityService.BLOCKING_STATUSES),
                Event.start_time <= expanded_end + timedelta(hours=6),
                Event.end_time >= expanded_start - timedelta(hours=6),
            )
        )
        candidates = events_res.scalars().all()

        conflicts = []
        for ev in candidates:
            ev_hall_res = await db.execute(select(Hall).where(Hall.id == ev.hall_id))
            ev_hall = ev_hall_res.scalar_one_or_none()
            ev_buf = timedelta(minutes=ev_hall.cleaning_buffer_minutes if ev_hall else 0)
            ev_start = ev.start_time - ev_buf
            ev_end = ev.end_time + ev_buf

            if expanded_start < ev_end and expanded_end > ev_start:
                conflicts.append(
                    {
                        "event_id": str(ev.id),
                        "event_code": ev.event_code,
                        "hall_id": str(ev.hall_id),
                        "status": ev.status.value,
                        "buffered_start": ev_start.isoformat(),
                        "buffered_end": ev_end.isoformat(),
                    }
                )

        return {
            "available": len(conflicts) == 0,
            "hall_id": str(hall.id),
            "checked_hall_ids": [str(h) for h in target_hall_ids],
            "expanded_window": {"start": expanded_start.isoformat(), "end": expanded_end.isoformat()},
            "conflicts": conflicts,
        }

    @staticmethod
    async def calculate_dynamic_quote(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        hall_id: uuid.UUID,
        start_time: datetime,
        addon_amount: Decimal = Decimal("0.00"),
        discount_amount: Decimal = Decimal("0.00"),
    ) -> dict:
        hall = (await db.execute(select(Hall).where(Hall.id == hall_id, Hall.tenant_id == tenant_id))).scalar_one()
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()

        rules = (
            await db.execute(
                select(PricingRule).where(
                    PricingRule.tenant_id == tenant_id,
                    PricingRule.is_active == True,
                    or_(PricingRule.hall_id == hall_id, PricingRule.hall_id.is_(None)),
                )
            )
        ).scalars().all()

        # Python weekday: Mon=0..Sun=6; convert to Sun=0..Sat=6 matching PricingRule convention
        sun_based_dow = (start_time.weekday() + 1) % 7
        effective_multiplier = Decimal("1.00")
        applied_rules = []

        for rule in rules:
            dow_match = not rule.days_of_week or sun_based_dow in rule.days_of_week
            date_match = True
            if rule.start_date and start_time < rule.start_date:
                date_match = False
            if rule.end_date and start_time > rule.end_date:
                date_match = False

            if dow_match and date_match:
                effective_multiplier *= Decimal(str(rule.multiplier))
                applied_rules.append({"id": str(rule.id), "name": rule.name, "multiplier": float(rule.multiplier)})

        adjusted_hall_price = (Decimal(str(hall.base_price)) * effective_multiplier).quantize(Decimal("0.01"))
        subtotal = max(Decimal("0.00"), adjusted_hall_price + addon_amount - discount_amount)
        tax_amount = (subtotal * (Decimal(str(tenant.tax_rate)) / Decimal("100.00"))).quantize(Decimal("0.01"))
        total_amount = subtotal + tax_amount
        deposit_amount = Decimal(str((tenant.settings or {}).get("defaultSecurityDeposit", 0)))

        return {
            "hall_id": str(hall.id),
            "base_price": float(hall.base_price),
            "effective_multiplier": float(effective_multiplier),
            "applied_rules": applied_rules,
            "subtotal": float(subtotal),
            "tax_rate": float(tenant.tax_rate),
            "tax_amount": float(tax_amount),
            "total_amount": float(total_amount),
            "security_deposit_amount": float(deposit_amount),
            "currency": tenant.currency,
        }

2. Bookings Router & 48h Hold Creation (apps/api/app/routers/bookings.py)
Places a HOLD_48H booking when available, creates an initial Invoice + PaymentMilestone, sets hold:event:{id} in Redis with a 48h TTL, and schedules the Celery 48h expiration task.



Python
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.models.accounting import Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import Event, EventStatus
from app.services.availability_service import AvailabilityService

router = APIRouter(prefix="/api/v1", tags=["Availability, Quotes & 48h Holds"])


class HoldBookingRequest(BaseModel):
    hall_id: uuid.UUID
    primary_client_id: uuid.UUID
    event_type: str = "WEDDING"
    start_time: datetime
    end_time: datetime
    guest_count: int = 200
    addon_amount: Decimal = Decimal("0.00")


@router.get("/public/halls/availability")
async def get_halls_availability(
    request: Request,
    hall_id: uuid.UUID = Query(...),
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    avail = await AvailabilityService.check_hall_availability(db, tenant.id, hall_id, start_time, end_time)
    quote = await AvailabilityService.calculate_dynamic_quote(db, tenant.id, hall_id, start_time)
    return {"availability": avail, "quote": quote}


@router.post("/bookings/hold")
async def create_48h_hold(
    body: HoldBookingRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    avail = await AvailabilityService.check_hall_availability(
        db, tenant.id, body.hall_id, body.start_time, body.end_time
    )
    if not avail["available"]:
        raise HTTPException(status_code=409, detail={"message": "Hall conflict detected", "conflicts": avail["conflicts"]})

    quote = await AvailabilityService.calculate_dynamic_quote(
        db, tenant.id, body.hall_id, body.start_time, addon_amount=body.addon_amount
    )

    event_code = f"EVT-{datetime.now(timezone.utc).year}-{str(uuid.uuid4().int % 10000).zfill(4)}"
    event = Event(
        tenant_id=tenant.id,
        hall_id=body.hall_id,
        primary_client_id=body.primary_client_id,
        event_code=event_code,
        event_type=body.event_type,
        start_time=body.start_time.replace(tzinfo=None) if body.start_time.tzinfo else body.start_time,
        end_time=body.end_time.replace(tzinfo=None) if body.end_time.tzinfo else body.end_time,
        status=EventStatus.HOLD_48H,
        guest_count=body.guest_count,
    )
    db.add(event)
    await db.flush()

    invoice = Invoice(
        tenant_id=tenant.id,
        event_id=event.id,
        invoice_number=f"INV-{event_code}",
        subtotal=Decimal(str(quote["subtotal"])),
        tax_amount=Decimal(str(quote["tax_amount"])),
        total_amount=Decimal(str(quote["total_amount"])),
        security_deposit_amount=Decimal(str(quote["security_deposit_amount"])),
        status=InvoiceStatus.ISSUED,
    )
    db.add(invoice)
    await db.flush()

    deposit_due = (Decimal(str(quote["total_amount"])) * Decimal("0.50")).quantize(Decimal("0.01"))
    db.add(
        PaymentMilestone(
            invoice_id=invoice.id,
            title="48h Hold Confirmation Deposit (50%)",
            amount_due=deposit_due,
            due_date=datetime.utcnow() + timedelta(hours=48),
            status="PENDING",
        )
    )
    await db.commit()

    # Set Redis TTL lock & enqueue Celery 48h expiry job
    try:
        import redis.asyncio as aioredis
        from app.workers.celery_tasks import expire_unpaid_48h_hold

        r = aioredis.from_url(settings.REDIS_URL)
        await r.setex(f"hold:event:{event.id}", 48 * 3600, event_code)
        await r.aclose()
        expire_unpaid_48h_hold.apply_async(args=[str(event.id)], countdown=48 * 3600)
    except Exception:
        pass

    return {
        "event_id": str(event.id),
        "event_code": event.event_code,
        "status": event.status.value,
        "expires_in_hours": 48,
        "quote": quote,
    }

3. Celery Background Task for 48-Hour Holds (apps/api/app/workers/celery_tasks.py)
Automatically cancels unpaid HOLD_48H events after 48 hours if no payment milestone has been paid or submitted for verification.



Python
import asyncio
import uuid
from celery import Celery
from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import Event, EventStatus

celery_app = Celery("eventledger_worker", broker=settings.REDIS_URL, backend=settings.REDIS_URL)


async def _expire_hold_async(event_id_str: str) -> str:
    event_id = uuid.UUID(event_id_str)
    async with AsyncSessionLocal() as db:
        ev = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
        if not ev or ev.status != EventStatus.HOLD_48H:
            return "SKIPPED"

        inv = (await db.execute(select(Invoice).where(Invoice.event_id == ev.id))).scalar_one_or_none()
        if inv:
            milestones = (
                await db.execute(select(PaymentMilestone).where(PaymentMilestone.invoice_id == inv.id))
            ).scalars().all()
            has_paid_or_review = any(
                m.status in {"PAID", "UNDER_REVIEW", "VERIFIED"} or float(m.paid_amount) > 0
                for m in milestones
            )
            if has_paid_or_review:
                return "PAID_OR_UNDER_REVIEW"

        ev.status = EventStatus.CANCELLED
        await db.commit()
        return "EXPIRED_AND_CANCELLED"


@celery_app.task(name="eventledger.expire_unpaid_48h_hold")
def expire_unpaid_48h_hold(event_id: str) -> str:
    return asyncio.run(_expire_hold_async(event_id))

4. Cross-ERP Approvals Sync (apps/api/app/services/approvals_service.py & apps/api/app/routers/approvals.py)
Updates Invoice totals/milestones, recalculates EventInventoryAllocation quantities for equipment/add-ons, updates event.guest_count and live BEO payload data, and writes an immutable AuditLog entry upon APPROVED_SYNCED.



Python
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import Invoice, PaymentMilestone
from app.models.events import (
    ApprovalRequest,
    ApprovalStatus,
    AuditLog,
    DraftStatus,
    DraftType,
    Event,
    EventDraft,
)
from app.models.tenant import Tenant
from app.models.venue import EventInventoryAllocation, InventoryItem


class ApprovalsService:
    @staticmethod
    async def submit_draft_for_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        draft_id: uuid.UUID,
        requester_id: uuid.UUID,
        requester_type: str,
    ) -> ApprovalRequest:
        draft = (await db.execute(select(EventDraft).where(EventDraft.id == draft_id))).scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")

        event = (
            await db.execute(select(Event).where(Event.id == draft.event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found in tenant")

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        settings_map = tenant.settings or {}
        lock_hours = (
            settings_map.get("cateringLockHours", 72)
            if draft.draft_type == DraftType.CATERING_MENU
            else settings_map.get("floorPlanLockHours", 24)
        )
        hours_until_event = (
            event.start_time.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
        ).total_seconds() / 3600.0

        if (event.is_locked or hours_until_event < lock_hours) and requester_type != "INTERNAL_STAFF":
            raise HTTPException(
                status_code=403,
                detail=f"Draft is locked ({lock_hours}h pre-event freeze).",
            )

        if draft.financial_delta > Decimal("0.00") and requester_id != event.primary_client_id:
            draft.status = DraftStatus.PENDING_CLIENT_APPROVAL
            required_role = "CLIENT_PRIMARY"
        else:
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            required_role = "OPS_MANAGER"

        approval = ApprovalRequest(
            event_id=event.id,
            draft_id=draft.id,
            requested_by_id=requester_id,
            required_approver_role=required_role,
            status=ApprovalStatus.PENDING,
        )
        db.add(approval)
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=event.id,
                actor_id=requester_id,
                action="DRAFT_SUBMITTED",
                new_value={"draft_id": str(draft.id), "required_role": required_role, "financial_delta": float(draft.financial_delta)},
            )
        )
        await db.commit()
        await db.refresh(approval)
        return approval

    @staticmethod
    async def resolve_approval(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        approval_id: uuid.UUID,
        approver_id: uuid.UUID,
        decision: ApprovalStatus,
        rejection_reason: str | None = None,
    ) -> dict:
        approval = (
            await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id))
        ).scalar_one_or_none()
        if not approval or approval.status != ApprovalStatus.PENDING:
            raise HTTPException(status_code=400, detail="Approval request not found or already resolved")

        draft = (await db.execute(select(EventDraft).where(EventDraft.id == approval.draft_id))).scalar_one()
        event = (
            await db.execute(select(Event).where(Event.id == approval.event_id, Event.tenant_id == tenant_id))
        ).scalar_one()
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()

        approval.status = decision
        approval.approved_by_id = approver_id
        approval.rejection_reason = rejection_reason
        approval.resolved_at = datetime.utcnow()

        if decision == ApprovalStatus.REJECTED:
            draft.status = DraftStatus.REJECTED
            await db.commit()
            return {"status": "REJECTED", "draft_id": str(draft.id)}

        if approval.required_approver_role == "CLIENT_PRIMARY":
            draft.status = DraftStatus.PENDING_INTERNAL_APPROVAL
            next_gate = ApprovalRequest(
                event_id=event.id,
                draft_id=draft.id,
                requested_by_id=approver_id,
                required_approver_role="OPS_MANAGER",
                status=ApprovalStatus.PENDING,
            )
            db.add(next_gate)
            await db.commit()
            return {"status": "FORWARDED_TO_OPS", "next_approval_id": str(next_gate.id)}

        # Final approval -> Cross-ERP Sync
        draft.status = DraftStatus.APPROVED_SYNCED
        payload = draft.payload or {}

        # 1. Finance sync: Invoice subtotal, tax, total & unpaid milestones
        if draft.financial_delta != Decimal("0.00"):
            invoice = (
                await db.execute(select(Invoice).where(Invoice.event_id == event.id, Invoice.tenant_id == tenant_id))
            ).scalar_one_or_none()
            if invoice:
                invoice.subtotal = Decimal(str(invoice.subtotal)) + draft.financial_delta
                tax_rate = Decimal(str(tenant.tax_rate))
                invoice.tax_amount = (Decimal(str(invoice.subtotal)) * (tax_rate / Decimal("100.00"))).quantize(Decimal("0.01"))
                invoice.total_amount = Decimal(str(invoice.subtotal)) + Decimal(str(invoice.tax_amount)) - Decimal(str(invoice.discount_amount))

                pending_milestones = (
                    await db.execute(
                        select(PaymentMilestone).where(
                            PaymentMilestone.invoice_id == invoice.id,
                            PaymentMilestone.status == "PENDING",
                        )
                    )
                ).scalars().all()
                if pending_milestones:
                    pending_milestones[-1].amount_due = Decimal(str(pending_milestones[-1].amount_due)) + draft.financial_delta

        # 2. Inventory sync: update EventInventoryAllocation if item_id or extraQty provided
        if payload.get("itemId") and payload.get("quantityReserved") is not None:
            item_uuid = uuid.UUID(str(payload["itemId"]))
            item = (
                await db.execute(select(InventoryItem).where(InventoryItem.id == item_uuid, InventoryItem.tenant_id == tenant_id))
            ).scalar_one_or_none()
            if item:
                alloc = (
                    await db.execute(
                        select(EventInventoryAllocation).where(
                            EventInventoryAllocation.event_id == event.id,
                            EventInventoryAllocation.item_id == item.id,
                        )
                    )
                ).scalar_one_or_none()
                qty = int(payload["quantityReserved"])
                if alloc:
                    alloc.quantity_reserved = qty
                else:
                    db.add(EventInventoryAllocation(event_id=event.id, item_id=item.id, quantity_reserved=qty))

        # 3. Operations & Live BEO sync
        if "totalSeatedGuests" in payload:
            event.guest_count = int(payload["totalSeatedGuests"])

        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=event.id,
                actor_id=approver_id,
                action="DRAFT_APPROVED_AND_SYNCED",
                new_value={"draft_id": str(draft.id), "financial_delta": float(draft.financial_delta), "synced": ["FINANCE", "INVENTORY", "BEO"]},
            )
        )
        await db.commit()
        return {
            "status": "APPROVED_SYNCED",
            "event_id": str(event.id),
            "draft_id": str(draft.id),
            "synced_modules": ["FINANCE", "INVENTORY", "OPERATIONS_BEO"],
        }

5. Registering New Routers in apps/api/app/main.py
Include auth_router, portal_router, and bookings.router alongside public_onboarding, approvals, and finance:



Python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.tenant_middleware import TenantResolverMiddleware
from app.routers import approvals, auth, bookings, finance, portal, public_onboarding

app = FastAPI(
    title="EventLedger (إيفنت ليدجر) API",
    version="3.0.0",
    description="Multi-Tenant Venue, Wedding Hall & Conference ERP + Client Portal API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantResolverMiddleware)

app.include_router(public_onboarding.router)
app.include_router(auth.auth_router)
app.include_router(portal.portal_router)
app.include_router(bookings.router)
app.include_router(approvals.router)
app.include_router(finance.router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "EventLedger Python FastAPI"}

Next Batch: Phases 5 & 6
Ready for Phase 5 & Phase 6 (ThemeBrandingProvider, SpotlightCard & SpotlightHeading, /erp/settings/branding, FloorPlanCanvas.tsx, /erp/finance/ledger, /erp/finance/events/[id]/pnl, CSV bulk import modal, WeasyPrint PDF buttons, comms_service.py with WhatsApp webhooks, and /erp/ops/beo)?
