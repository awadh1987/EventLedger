import re
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.models.accounting import AccountingConfig, AccountType, ChartOfAccount
from app.models.tenant import SubscriptionTier, SystemLookup, Tenant, TenantBranding
from app.models.users import StaffProfile, StaffRole, User, UserType
from app.models.venue import Hall

router = APIRouter(prefix="/api/v1/public", tags=["Public & SaaS Onboarding"])

DEFAULT_LOOKUPS = [
    ("EVENT_TYPE", "WEDDING", "حفل زفاف", "Wedding", 1),
    ("EVENT_TYPE", "CONFERENCE", "مؤتمر", "Conference", 2),
    ("EVENT_TYPE", "GALA", "حفل عشاء رسمي", "Gala Dinner", 3),
    ("EVENT_TYPE", "ENGAGEMENT", "حفل خطوبة", "Engagement", 4),
    ("INVENTORY_CATEGORY", "FURNITURE", "أثاث وكراسي", "Furniture", 1),
    ("INVENTORY_CATEGORY", "AV_LIGHTING", "صوتيات وإضاءة", "AV & Lighting", 2),
    ("INVENTORY_CATEGORY", "DECOR", "ديكور وزينة", "Decor", 3),
    ("EXPENSE_CATEGORY", "CATERING", "تكلفة الضيافة", "Catering COGS", 1),
    ("EXPENSE_CATEGORY", "STAFFING", "أجور تشغيلية", "Event Staffing", 2),
    ("EXPENSE_CATEGORY", "DECOR", "تجهيزات وزهور", "Decor & Florals", 3),
    ("PAYMENT_METHOD", "KURAIMI", "بنك الكريمي", "Kuraimi Bank", 1),
    ("PAYMENT_METHOD", "JAIB", "محفظة جيب", "Jaib Wallet", 2),
    ("PAYMENT_METHOD", "JAWALI", "محفظة جوالي", "Jawali Wallet", 3),
    ("PAYMENT_METHOD", "ONECASH", "ون كاش", "OneCash", 4),
    ("PAYMENT_METHOD", "CASH", "نقداً", "Cash", 5),
    ("REFUND_METHOD", "KURAIMI", "حساب الكريمي", "Kuraimi Account", 1),
    ("REFUND_METHOD", "JAIB", "محفظة جيب", "Jaib Wallet", 2),
    ("REFUND_METHOD", "JAWALI", "محفظة جوالي", "Jawali Wallet", 3),
    ("REFUND_METHOD", "ONECASH", "ون كاش", "OneCash", 4),
    ("REFUND_METHOD", "IBAN", "حوالة بنكية IBAN", "Bank Transfer (IBAN)", 5),
    ("GATE_PASS_TYPE", "VIP_PASS", "تصريح كبار الشخصيات", "VIP Pass", 1),
    ("GATE_PASS_TYPE", "GUEST_PASS", "دعوة ضيف", "Guest Pass", 2),
    ("GATE_PASS_TYPE", "VENDOR_PASS", "تصريح مورد", "Vendor Pass", 3),
    ("DEPARTMENT", "KITCHEN", "المطبخ والضيافة", "Kitchen", 1),
    ("DEPARTMENT", "OPS", "التشغيل والقاعات", "Operations", 2),
    ("DEPARTMENT", "FINANCE", "المالية", "Finance", 3),
    ("DEPARTMENT", "SECURITY", "الأمن والبوابات", "Security", 4),
    ("DEPARTMENT", "SALES", "المبيعات", "Sales", 5),
]


async def seed_tenant_defaults(db: AsyncSession, tenant_id) -> None:
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
            tenant_id=tenant_id,
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
            tenant_id=tenant_id,
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

    for cat, code, ar, en, order in DEFAULT_LOOKUPS:
        db.add(
            SystemLookup(
                tenant_id=tenant_id,
                category=cat,
                code=code,
                label_ar=ar,
                label_en=en,
                sort_order=order,
            )
        )


class TenantRegisterRequest(BaseModel):
    venue_name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=3, max_length=50)
    owner_name: str = Field(..., min_length=2, max_length=150)
    owner_phone: str = Field(..., min_length=7, max_length=30)
    owner_email: Optional[str] = None
    owner_password: str = Field(default="VenueOwner@2026", min_length=8)
    currency: str = Field(default="YER")
    subscription_tier: SubscriptionTier = Field(default=SubscriptionTier.PRO)
    preferred_lang: str = Field(default="ar")


@router.get("/plans")
async def list_plans():
    return [
        {
            "tier": "BASIC",
            "name_ar": "الباقة الأساسية",
            "name_en": "Basic",
            "price_monthly_usd": 79,
            "max_halls": 2,
            "max_staff": 5,
            "features_ar": ["إدارة الحجوزات والتقويم", "بوابة العميل ومخطط القاعة", "فواتير PDF ثنائية اللغة"],
            "features_en": ["Bookings & smart calendar", "Client portal & floor plan", "Bilingual PDF invoices"],
        },
        {
            "tier": "PRO",
            "name_ar": "الباقة الاحترافية",
            "name_en": "Pro",
            "price_monthly_usd": 199,
            "max_halls": 8,
            "max_staff": 25,
            "features_ar": ["القيد المزدوج وميزان المراجعة", "دمج القاعات والتسعير الديناميكي", "أمر التشغيل BEO والواتساب"],
            "features_en": ["Double-entry ledger & trial balance", "Partition halls & dynamic pricing", "Live BEO & WhatsApp sync"],
        },
        {
            "tier": "ENTERPRISE",
            "name_ar": "باقة المؤسسات",
            "name_en": "Enterprise",
            "price_monthly_usd": 499,
            "max_halls": 99,
            "max_staff": 999,
            "features_ar": ["نطاق مخصص وهوية بيضاء كاملة", "تطبيق سطح المكتب والأندرويد دون إنترنت", "دعم الأولوية والتدقيق المتقدم"],
            "features_en": ["Custom domain & full white-label", "Offline desktop .exe & Android .apk", "Priority SLA & audit suite"],
        },
    ]


@router.get("/tenants/check-slug")
async def check_slug(slug: str = Query(..., min_length=2), db: AsyncSession = Depends(get_db)):
    clean_slug = re.sub(r"[^a-z0-9-]", "", slug.lower().strip())
    reserved = {"www", "admin", "api", "app", "mail", "static"}
    if len(clean_slug) < 3 or clean_slug in reserved:
        return {"slug": clean_slug, "available": False}
    exists = (await db.execute(select(Tenant.id).where(Tenant.slug == clean_slug))).scalar_one_or_none()
    return {"slug": clean_slug, "available": exists is None}


@router.post("/tenants/register")
async def register_tenant(payload: TenantRegisterRequest, db: AsyncSession = Depends(get_db)):
    clean_slug = re.sub(r"[^a-z0-9-]", "", payload.slug.lower().strip())
    if len(clean_slug) < 3 or clean_slug in {"www", "admin", "api", "app", "mail", "static"}:
        raise HTTPException(status_code=400, detail="Invalid or reserved subdomain slug")

    if (await db.execute(select(Tenant).where(Tenant.slug == clean_slug))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Subdomain slug is already taken")

    tenant = Tenant(
        name=payload.venue_name,
        slug=clean_slug,
        currency=payload.currency,
        subscription_tier=payload.subscription_tier,
        settings={
            "cateringLockHours": 72,
            "floorPlanLockHours": 24,
            "holdExpiryHours": 48,
            "defaultSecurityDeposit": 100000,
        },
    )
    db.add(tenant)
    await db.flush()
    db.add(TenantBranding(tenant_id=tenant.id))

    await seed_tenant_defaults(db, tenant.id)

    owner = User(
        tenant_id=tenant.id,
        user_type=UserType.INTERNAL_STAFF,
        email=payload.owner_email.lower().strip() if payload.owner_email else None,
        phone=payload.owner_phone.strip(),
        password_hash=hash_password(payload.owner_password),
        full_name=payload.owner_name,
        preferred_lang=payload.preferred_lang,
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

    token = create_access_token(owner.id, tenant.id, UserType.INTERNAL_STAFF, StaffRole.OWNER)
    root_domain = settings.ROOT_DOMAIN.split(":")[0]
    return {
        "tenant_id": str(tenant.id),
        "slug": tenant.slug,
        "workspace_url": f"https://{tenant.slug}.{root_domain}",
        "owner_id": str(owner.id),
        "access_token": token,
        "user": {
            "id": str(owner.id),
            "tenant_id": str(tenant.id),
            "full_name": owner.full_name,
            "email": owner.email,
            "phone": owner.phone,
            "user_type": owner.user_type.value,
            "staff_role": StaffRole.OWNER.value,
            "preferred_lang": owner.preferred_lang,
            "is_2fa_enabled": owner.is_2fa_enabled,
        },
    }


@router.get("/tenant")
async def get_public_tenant(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    branding = (
        await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    ).scalar_one_or_none()
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "currency": tenant.currency,
        "tax_rate": float(tenant.tax_rate),
        "subscription_tier": tenant.subscription_tier.value,
        "branding": {
            "primary_color": branding.primary_color if branding else "#D4AF37",
            "accent_color": branding.accent_color if branding else "#0F172A",
            "spotlight_color": branding.spotlight_color if branding else "rgba(212, 175, 55, 0.18)",
            "default_theme": branding.default_theme if branding else "SYSTEM",
            "enable_spotlight": branding.enable_spotlight if branding else True,
            "logo_light_url": branding.logo_light_url if branding else None,
            "logo_dark_url": branding.logo_dark_url if branding else None,
            "favicon_url": branding.favicon_url if branding else None,
        },
    }


@router.get("/halls")
async def list_public_halls(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    halls = (await db.execute(select(Hall).where(Hall.tenant_id == tenant.id))).scalars().all()
    return [
        {
            "id": str(h.id),
            "name": h.name,
            "name_ar": h.name_ar,
            "capacity_banquet": h.capacity_banquet,
            "capacity_theater": h.capacity_theater,
            "base_price": float(h.base_price),
            "cleaning_buffer_minutes": h.cleaning_buffer_minutes,
            "combinable_with_hall_id": str(h.combinable_with_hall_id) if h.combinable_with_hall_id else None,
        }
        for h in halls
    ]
