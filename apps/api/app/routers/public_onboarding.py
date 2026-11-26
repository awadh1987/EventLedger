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

    if (await db.execute(select(Tenant).where(Tenant.slug == clean_slug))).scalar_one_or_none():
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
        acc = ChartOfAccount(tenant_id=tenant.id, code=code, name_ar=ar, name_en=en, account_type=atype, is_system=is_sys)
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
    db.add(StaffProfile(user_id=owner.id, role=StaffRole.OWNER, department="MANAGEMENT", max_discount_percent=Decimal("100.00")))
    await db.commit()

    return {"tenant_id": str(tenant.id), "slug": tenant.slug, "workspace_url": f"https://{tenant.slug}.eventledger.cloud", "owner_id": str(owner.id)}
