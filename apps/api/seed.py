import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.accounting import AccountingConfig, AccountType, ChartOfAccount, DepositStatus, Invoice, InvoiceStatus, PaymentMilestone
from app.models.events import ApprovalRequest, ApprovalStatus, AuditLog, DraftStatus, DraftType, Event, EventDraft, EventStatus, GatePass
from app.models.tenant import RecordLifecycle, SubscriptionTier, SystemLookup, Tenant, TenantBranding
from app.models.users import ClientCategory, ClientProfile, DelegateRole, EventDelegate, StaffProfile, StaffRole, User, UserType
from app.models.venue import CateringMenuItem, Hall, InventoryItem, PricingRule


async def seed_all():
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(Tenant).where(Tenant.slug == "almassa"))).scalar_one_or_none():
            print("Tenant 'almassa' already seeded.")
            return

        db.add(User(tenant_id=None, user_type=UserType.SUPER_ADMIN, email="superadmin@eventledger.cloud", phone="+967770000000", password_hash=hash_password("SuperAdmin@2026"), full_name="EventLedger Platform Admin", preferred_lang="en", is_2fa_enabled=True))

        tenant = Tenant(
            name="قصر الماسة للمؤتمرات والأفراح | Al-Massa Grand Palace",
            slug="almassa",
            custom_domain="events.almassa.ye",
            subscription_tier=SubscriptionTier.ENTERPRISE,
            currency="YER",
            tax_rate=Decimal("5.00"),
            settings={"cateringLockHours": 72, "floorPlanLockHours": 24, "holdExpiryHours": 48, "defaultSecurityDeposit": 150000},
        )
        db.add(tenant)
        await db.flush()

        db.add(TenantBranding(tenant_id=tenant.id, primary_color="#D4AF37", accent_color="#0F172A", default_theme="DARK", enable_spotlight=True, spotlight_color="rgba(212, 175, 55, 0.18)"))

        accounts_spec = [
            ("1010", "الصندوق الرئيسي", "Main Cash Drawer", AccountType.ASSET, True),
            ("1020", "البنك والمحافظ الإلكترونية", "Bank & E-Wallets", AccountType.ASSET, True),
            ("1100", "ذمم العملاء", "Accounts Receivable", AccountType.ASSET, True),
            ("2100", "تأمينات الأضرار المستردة", "Refundable Security Deposits", AccountType.LIABILITY, True),
            ("2200", "ضريبة القيمة المضافة المستحقة", "Tax Payable", AccountType.LIABILITY, True),
            ("4000", "إيرادات تأجير القاعات", "Hall Rental Revenue", AccountType.REVENUE, True),
            ("4100", "إيرادات الضيافة والبوفيه", "Catering Revenue", AccountType.REVENUE, True),
            ("5000", "تكلفة المواد الغذائية والضيافة", "Catering COGS", AccountType.EXPENSE, True),
        ]
        acc_map = {}
        for code, ar, en, atype, is_sys in accounts_spec:
            acc = ChartOfAccount(tenant_id=tenant.id, code=code, name_ar=ar, name_en=en, account_type=atype, is_system=is_sys)
            db.add(acc)
            await db.flush()
            acc_map[code] = acc.id

        db.add(AccountingConfig(tenant_id=tenant.id, cash_account_id=acc_map["1010"], bank_account_id=acc_map["1020"], accounts_receivable_id=acc_map["1100"], security_deposit_liab_id=acc_map["2100"], tax_payable_account_id=acc_map["2200"], hall_revenue_account_id=acc_map["4000"], catering_revenue_account_id=acc_map["4100"], catering_cogs_account_id=acc_map["5000"]))

        hall_a = Hall(tenant_id=tenant.id, name="Grand Diamond Hall", name_ar="قاعة الماسة الكبرى", capacity_banquet=500, capacity_theater=800, base_price=Decimal("1500000.00"), cleaning_buffer_minutes=120)
        hall_b = Hall(tenant_id=tenant.id, name="Royal Jasmine Hall", name_ar="قاعة الياسمين الملكية", capacity_banquet=300, capacity_theater=450, base_price=Decimal("950000.00"), cleaning_buffer_minutes=90)
        db.add_all([hall_a, hall_b])
        await db.flush()
        hall_a.combinable_with_hall_id = hall_b.id
        hall_b.combinable_with_hall_id = hall_a.id

        db.add(PricingRule(tenant_id=tenant.id, hall_id=hall_a.id, name="Weekend Peak (+20%)", days_of_week=[4, 5], multiplier=Decimal("1.20"), is_active=True))
        db.add(InventoryItem(tenant_id=tenant.id, name="Royal Gold Chiavari Chairs", category="FURNITURE", total_stock=800, unit_addon_price=Decimal("1500.00")))
        db.add(CateringMenuItem(tenant_id=tenant.id, name_ar="بوفيه الماسة الملكي", name_en="Al-Massa Royal Banquet Buffet", price_per_guest=Decimal("6500.00"), cost_per_guest=Decimal("3800.00")))

        owner = User(tenant_id=tenant.id, user_type=UserType.INTERNAL_STAFF, email="owner@almassa.eventledger.local", phone="+967770000001", password_hash=hash_password("Almassa@2026"), full_name="أ. طارق المنصور", preferred_lang="ar")
        client = User(tenant_id=tenant.id, user_type=UserType.CLIENT_PRIMARY, email="ahmed@client.local", phone="+967771112233", password_hash=hash_password("Client@2026"), full_name="أحمد عبدالله الشامي", preferred_lang="ar")
        planner = User(tenant_id=tenant.id, user_type=UserType.CLIENT_DELEGATE, email="layla.planner@studio.local", phone="+967773334455", password_hash=hash_password("Planner@2026"), full_name="ليلى الأهدل", preferred_lang="ar")
        db.add_all([owner, client, planner])
        await db.flush()

        db.add(StaffProfile(user_id=owner.id, role=StaffRole.OWNER, department="MANAGEMENT", max_discount_percent=Decimal("100.00")))
        db.add(ClientProfile(user_id=client.id, client_category=ClientCategory.INDIVIDUAL_B2C, national_id_or_cr="010100998877", refund_bank_details={"method": "Kuraimi / Jaib", "accountNumber": "301234567"}))

        start = datetime.utcnow() + timedelta(days=20)
        ev = Event(tenant_id=tenant.id, hall_id=hall_a.id, primary_client_id=client.id, assigned_sales_id=owner.id, event_code="EVT-2026-1001", event_type="WEDDING", start_time=start, end_time=start + timedelta(hours=6), status=EventStatus.CONFIRMED, guest_count=420)
        db.add(ev)
        await db.flush()

        db.add(EventDelegate(event_id=ev.id, user_id=planner.id, delegate_role=DelegateRole.WEDDING_PLANNER, permissions={"canViewFinance": False, "canEditFloorplan": True, "canRequestAddons": True}))
        draft = EventDraft(event_id=ev.id, created_by_id=planner.id, version_number=2, draft_type=DraftType.ADDON_REQUEST, payload={"addonItem": "Royal Gold Chiavari Chairs", "extraQty": 30}, financial_delta=Decimal("45000.00"), status=DraftStatus.PENDING_CLIENT_APPROVAL)
        db.add(draft)
        await db.flush()
        db.add(ApprovalRequest(event_id=ev.id, draft_id=draft.id, requested_by_id=planner.id, required_approver_role="CLIENT_PRIMARY", status=ApprovalStatus.PENDING))

        inv = Invoice(tenant_id=tenant.id, event_id=ev.id, invoice_number="INV-2026-1001", subtotal=Decimal("1500000.00"), tax_amount=Decimal("75000.00"), total_amount=Decimal("1575000.00"), security_deposit_amount=Decimal("150000.00"), deposit_status=DepositStatus.HELD, status=InvoiceStatus.PARTIALLY_PAID)
        db.add(inv)
        await db.flush()
        db.add(PaymentMilestone(invoice_id=inv.id, title="الدفعة الأولى (50%)", amount_due=Decimal("787500.00"), due_date=datetime.utcnow(), paid_amount=Decimal("787500.00"), payment_method="KURAIMI_BANK", status="PAID", paid_at=datetime.utcnow()))
        db.add(GatePass(event_id=ev.id, pass_type="VIP_PASS", holder_name="الشيخ عبدالله يحيى الشامي", qr_token="QR-EVT-2026-1001-VIP01", valid_from=start, valid_until=start + timedelta(hours=6)))
        db.add(AuditLog(tenant_id=tenant.id, event_id=ev.id, actor_id=owner.id, action="SEED_INITIALIZED_EVENT", new_value={"event_code": "EVT-2026-1001"}))
        await db.commit()
        print("✅ Seed completed for tenant: almassa")


if __name__ == "__main__":
    asyncio.run(seed_all())
