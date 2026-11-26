import asyncio
import os
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.security import hash_password
from app.models.accounting import AccountingConfig, DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.base import Base, utcnow
from app.models.events import (
    ApprovalRequest,
    ApprovalStatus,
    AuditLog,
    DraftStatus,
    DraftType,
    Event,
    EventDraft,
    EventStatus,
    GatePass,
)
from app.models.events_extensions import (  # noqa: F401
    DamageInspection,
    EventContract,
    EventGuest,
    InspectionStatus,
    RsvpStatus,
)
from app.models.tenant import SubscriptionStatus, SubscriptionTier, Tenant, TenantBranding
from app.models.users import (
    ClientCategory,
    ClientProfile,
    DelegateRole,
    EventDelegate,
    StaffProfile,
    StaffRole,
    User,
    UserType,
)
from app.models.venue import CateringMenuItem, Hall, InventoryItem, PricingRule
from app.routers.public_onboarding import seed_tenant_defaults
from app.services.accounting_service import DoubleEntryService


async def seed_all() -> None:
    env = (os.getenv("APP_ENV") or settings.APP_ENV).strip().lower()
    if env == "production":
        raise RuntimeError("Refusing to run demo seed.py when APP_ENV=production. Use bootstrap_prod.py instead.")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        super_admin = (
            await db.execute(select(User).where(User.email == "admin@eventledger.cloud"))
        ).scalar_one_or_none()
        if not super_admin:
            db.add(
                User(
                    tenant_id=None,
                    user_type=UserType.SUPER_ADMIN,
                    email="admin@eventledger.cloud",
                    phone="+967770000000",
                    password_hash=hash_password("SuperAdmin@2026"),
                    full_name="Platform Super Admin",
                    preferred_lang="en",
                )
            )
            await db.flush()

        existing = (await db.execute(select(Tenant).where(Tenant.slug == "almassa"))).scalar_one_or_none()
        if existing:
            await db.commit()
            print("Seed already exists for tenant: almassa")
            return

        tenant = Tenant(
            name="قاعات الماسة الملكية (Al-Massa Royal Venues)",
            slug="almassa",
            custom_domain="events.almassa.ye",
            custom_domain_verified=True,
            currency="YER",
            tax_rate=Decimal("5.00"),
            subscription_tier=SubscriptionTier.ENTERPRISE,
            subscription_status=SubscriptionStatus.ACTIVE,
            max_halls=10,
            monthly_whatsapp_quota=10000,
            whatsapp_used_this_month=42,
            settings={
                "cateringLockHours": 72,
                "floorPlanLockHours": 24,
                "holdExpiryHours": 48,
                "defaultSecurityDeposit": 150000,
            },
        )
        db.add(tenant)
        await db.flush()

        db.add(
            TenantBranding(
                tenant_id=tenant.id,
                primary_color="#D4AF37",
                accent_color="#0F172A",
                default_theme="SYSTEM",
                enable_spotlight=True,
                spotlight_color="rgba(212, 175, 55, 0.18)",
                hero_tagline_ar="حيث تلتقي الفخامة الملكية بدقة التنظيم في كل مناسبة",
                hero_tagline_en="Where royal elegance meets flawless event execution",
                invoice_footer_ar="شكراً لاختياركم قاعات الماسة الملكية — تخضع جميع العقود للشروط والأحكام",
                invoice_footer_en="Thank you for choosing Al-Massa Royal Venues.",
            )
        )

        await seed_tenant_defaults(db, tenant.id)

        hall_a = Hall(
            tenant_id=tenant.id,
            name="Grand Diamond Hall",
            name_ar="قاعة الماسة الكبرى",
            capacity_banquet=500,
            capacity_theater=800,
            base_price=Decimal("1500000.00"),
            cleaning_buffer_minutes=120,
        )
        hall_b = Hall(
            tenant_id=tenant.id,
            name="Royal Jasmine Hall",
            name_ar="قاعة الياسمين الملكية",
            capacity_banquet=300,
            capacity_theater=450,
            base_price=Decimal("950000.00"),
            cleaning_buffer_minutes=90,
        )
        db.add_all([hall_a, hall_b])
        await db.flush()
        hall_a.combinable_with_hall_id = hall_b.id
        hall_b.combinable_with_hall_id = hall_a.id

        db.add(
            PricingRule(
                tenant_id=tenant.id,
                hall_id=hall_a.id,
                name="Weekend Peak (+20%)",
                days_of_week=[4, 5],
                multiplier=Decimal("1.20"),
                is_active=True,
            )
        )
        db.add(
            InventoryItem(
                tenant_id=tenant.id,
                name="Royal Gold Chiavari Chairs",
                category="FURNITURE",
                total_stock=800,
                unit_addon_price=Decimal("1500.00"),
            )
        )
        db.add(
            CateringMenuItem(
                tenant_id=tenant.id,
                name_ar="بوفيه الماسة الملكي",
                name_en="Al-Massa Royal Banquet Buffet",
                price_per_guest=Decimal("6500.00"),
                cost_per_guest=Decimal("3800.00"),
            )
        )

        owner = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            email="owner@almassa.eventledger.local",
            phone="+967770000001",
            password_hash=hash_password("Almassa@2026"),
            full_name="أ. طارق المنصور",
            preferred_lang="ar",
        )
        finance_user = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            email="finance@almassa.eventledger.local",
            phone="+967770000002",
            password_hash=hash_password("Finance@2026"),
            full_name="سارة العولقي",
            preferred_lang="ar",
        )
        ops_user = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            email="ops@almassa.eventledger.local",
            phone="+967770000003",
            password_hash=hash_password("Ops@2026"),
            full_name="م. خالد الحداد",
            preferred_lang="ar",
        )
        gate_user = User(
            tenant_id=tenant.id,
            user_type=UserType.INTERNAL_STAFF,
            email="gate@almassa.eventledger.local",
            phone="+967770000004",
            password_hash=hash_password("Gate@2026"),
            full_name="أمن البوابة الرئيسية",
            preferred_lang="ar",
        )
        client = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_PRIMARY,
            email="ahmed@client.local",
            phone="+967771112233",
            password_hash=hash_password("Client@2026"),
            full_name="أحمد عبدالله الشامي",
            preferred_lang="ar",
        )
        planner = User(
            tenant_id=tenant.id,
            user_type=UserType.CLIENT_DELEGATE,
            email="layla.planner@studio.local",
            phone="+967773334455",
            password_hash=hash_password("Planner@2026"),
            full_name="ليلى الأهدل",
            preferred_lang="ar",
        )
        db.add_all([owner, finance_user, ops_user, gate_user, client, planner])
        await db.flush()

        db.add_all(
            [
                StaffProfile(
                    user_id=owner.id, role=StaffRole.OWNER, department="MANAGEMENT", max_discount_percent=Decimal("100.00")
                ),
                StaffProfile(user_id=finance_user.id, role=StaffRole.FINANCE, department="FINANCE"),
                StaffProfile(user_id=ops_user.id, role=StaffRole.OPS_MANAGER, department="OPS"),
                StaffProfile(user_id=gate_user.id, role=StaffRole.SECURITY, department="SECURITY"),
                ClientProfile(
                    user_id=client.id,
                    client_category=ClientCategory.INDIVIDUAL_B2C,
                    national_id_or_cr="010100998877",
                    refund_bank_details={"method": "KURAIMI", "account_name": "أحمد الشامي", "account_number": "301234567"},
                ),
            ]
        )

        start = utcnow() + timedelta(days=20)
        ev = Event(
            tenant_id=tenant.id,
            hall_id=hall_a.id,
            primary_client_id=client.id,
            assigned_sales_id=owner.id,
            event_code="EVT-2026-1001",
            event_type="WEDDING",
            start_time=start,
            end_time=start + timedelta(hours=6),
            status=EventStatus.CONFIRMED,
            guest_count=420,
        )
        db.add(ev)
        await db.flush()

        db.add(
            EventDelegate(
                tenant_id=tenant.id,
                event_id=ev.id,
                user_id=planner.id,
                delegate_role=DelegateRole.WEDDING_PLANNER,
                permissions={"canViewFinance": False, "canEditFloorplan": True, "canRequestAddons": True, "canChat": True},
            )
        )
        draft = EventDraft(
            tenant_id=tenant.id,
            event_id=ev.id,
            created_by_id=planner.id,
            version_number=2,
            draft_type=DraftType.ADDON_REQUEST,
            payload={"addonItem": "Royal Gold Chiavari Chairs", "extraQty": 30},
            financial_delta=Decimal("45000.00"),
            status=DraftStatus.PENDING_CLIENT_APPROVAL,
        )
        db.add(draft)
        await db.flush()
        db.add(
            ApprovalRequest(
                tenant_id=tenant.id,
                event_id=ev.id,
                draft_id=draft.id,
                requested_by_id=planner.id,
                required_approver_role="CLIENT_PRIMARY",
                status=ApprovalStatus.PENDING,
            )
        )

        inv = Invoice(
            tenant_id=tenant.id,
            event_id=ev.id,
            invoice_number="INV-2026-1001",
            subtotal=Decimal("1500000.00"),
            tax_amount=Decimal("75000.00"),
            total_amount=Decimal("1575000.00"),
            security_deposit_amount=Decimal("150000.00"),
            deposit_status=DepositStatus.HELD,
            status=InvoiceStatus.PARTIALLY_PAID,
        )
        db.add(inv)
        await db.flush()
        db.add_all(
            [
                PaymentMilestone(
                    tenant_id=tenant.id,
                    invoice_id=inv.id,
                    title="الدفعة الأولى (50%)",
                    amount_due=Decimal("787500.00"),
                    due_date=utcnow(),
                    paid_amount=Decimal("787500.00"),
                    payment_method="KURAIMI",
                    status="PAID",
                    paid_at=utcnow(),
                ),
                PaymentMilestone(
                    tenant_id=tenant.id,
                    invoice_id=inv.id,
                    title="الدفعة النهائية (50%)",
                    amount_due=Decimal("787500.00"),
                    due_date=start - timedelta(days=3),
                    status="PENDING",
                ),
            ]
        )
        db.add(
            EventContract(
                tenant_id=tenant.id,
                event_id=ev.id,
                contract_number="CTR-EVT-2026-1001",
                terms_ar="يلتزم الطرف الثاني بسداد دفعة التأكيد (50%) وتأمين الأضرار المسترد (150,000)، ويُسترد التأمين بعد فحص القاعة.",
                terms_en="Second Party agrees to pay the 50% confirmation deposit and 150,000 refundable security deposit, released after post-event inspection.",
                client_signed_at=utcnow(),
                client_signature_name="أحمد عبدالله الشامي",
                client_signature_ip="127.0.0.1",
                staff_countersigned_at=utcnow(),
            )
        )

        vip_pass = GatePass(
            tenant_id=tenant.id,
            event_id=ev.id,
            pass_type="VIP_PASS",
            holder_name="الشيخ عبدالله يحيى الشامي",
            qr_token="QR-EVT-2026-1001-VIP01",
            valid_from=start - timedelta(hours=2),
            valid_until=start + timedelta(hours=8),
        )
        family_pass = GatePass(
            tenant_id=tenant.id,
            event_id=ev.id,
            pass_type="VIP_PASS",
            holder_name="د. نادية المتوكل",
            qr_token="QR-EVT-2026-1001-FAM02",
            valid_from=start - timedelta(hours=2),
            valid_until=start + timedelta(hours=8),
        )
        guest_pass = GatePass(
            tenant_id=tenant.id,
            event_id=ev.id,
            pass_type="GUEST_PASS",
            holder_name="م. سامي الحكيمي",
            qr_token="QR-EVT-2026-1001-GST03",
            valid_from=start - timedelta(hours=2),
            valid_until=start + timedelta(hours=8),
        )
        db.add_all([vip_pass, family_pass, guest_pass])
        await db.flush()

        db.add_all(
            [
                EventGuest(
                    tenant_id=tenant.id,
                    event_id=ev.id,
                    full_name="الشيخ عبدالله يحيى الشامي",
                    phone="+967771000101",
                    vip_tier="VIP",
                    table_label="VIP-T1",
                    rsvp_status=RsvpStatus.CONFIRMED,
                    gate_pass_id=vip_pass.id,
                ),
                EventGuest(
                    tenant_id=tenant.id,
                    event_id=ev.id,
                    full_name="د. نادية المتوكل",
                    phone="+967771000102",
                    vip_tier="FAMILY",
                    dietary_notes="بدون مكسرات / Nut-free",
                    table_label="FAM-T2",
                    rsvp_status=RsvpStatus.CONFIRMED,
                    gate_pass_id=family_pass.id,
                ),
                EventGuest(
                    tenant_id=tenant.id,
                    event_id=ev.id,
                    full_name="م. سامي الحكيمي",
                    phone="+967771000103",
                    vip_tier="STANDARD",
                    table_label="TBL-05",
                    rsvp_status=RsvpStatus.INVITED,
                    gate_pass_id=guest_pass.id,
                ),
            ]
        )

        db.add(
            AuditLog(
                tenant_id=tenant.id,
                event_id=ev.id,
                actor_id=owner.id,
                action="SEED_INITIALIZED_EVENT",
                new_value={"event_code": "EVT-2026-1001"},
            )
        )
        await db.commit()

        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant.id))
        ).scalar_one()

        await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant.id,
            created_by_id=finance_user.id,
            reference="INV-2026-1001",
            description="استحقاق فاتورة حجز قاعة الماسة الكبرى / Invoice accrual for EVT-2026-1001",
            event_id=ev.id,
            lines=[
                {
                    "account_id": cfg.accounts_receivable_id,
                    "debit": Decimal("1575000.00"),
                    "credit": Decimal("0.00"),
                    "memo": "INV-2026-1001 Accounts Receivable",
                },
                {
                    "account_id": cfg.hall_revenue_account_id,
                    "debit": Decimal("0.00"),
                    "credit": Decimal("1500000.00"),
                    "memo": "Grand Diamond Hall Rental Revenue",
                },
                {
                    "account_id": cfg.tax_payable_account_id,
                    "debit": Decimal("0.00"),
                    "credit": Decimal("75000.00"),
                    "memo": "Tax Payable (5%)",
                },
            ],
        )

        await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant.id,
            created_by_id=finance_user.id,
            reference="PAY-INV-2026-1001-M1",
            description="تحصيل الدفعة الأولى (50%) عبر الكريمي / Verified 50% milestone via KURAIMI",
            event_id=ev.id,
            lines=[
                {
                    "account_id": cfg.bank_account_id,
                    "debit": Decimal("787500.00"),
                    "credit": Decimal("0.00"),
                    "memo": "الدفعة الأولى (50%) - KURAIMI",
                },
                {
                    "account_id": cfg.accounts_receivable_id,
                    "debit": Decimal("0.00"),
                    "credit": Decimal("787500.00"),
                    "memo": "Settle 50% of INV-2026-1001",
                },
            ],
        )

        await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant.id,
            created_by_id=finance_user.id,
            reference="DEP-INV-2026-1001",
            description="تأمين الأضرار المسترد (التزامات 2100) / Refundable security deposit held in Liability 2100",
            event_id=ev.id,
            lines=[
                {
                    "account_id": cfg.bank_account_id,
                    "debit": Decimal("150000.00"),
                    "credit": Decimal("0.00"),
                    "memo": "Security deposit received via KURAIMI",
                },
                {
                    "account_id": cfg.security_deposit_liab_id,
                    "debit": Decimal("0.00"),
                    "credit": Decimal("150000.00"),
                    "memo": "Liability 2100 Refundable Security Deposit",
                },
            ],
        )

        print("Seed completed for tenant: almassa")


if __name__ == "__main__":
    asyncio.run(seed_all())
