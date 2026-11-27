# 02 — جرد جميع الوحدات والمكونات المحاسبية
# Accounting Modules & Components Inventory

يقدّم هذا المستند جرداً شاملاً لكل مكون له أثر مالي أو محاسبي موجود فعلياً في مستودع `EventLedger` عبر الطبقات الخمس: قاعدة البيانات (`models` / `alembic`)، طبقة الخدمات (`services`)، واجهات البرمجة (`routers`)، واجهات المستخدم (`apps/web`)، والتغليف الأصلي (`apps/desktop`, `apps/mobile`).

---

## 1. خريطة الوحدات المحاسبية والمالية الموجودة / Existing Modules Map

| الوحدة / Module | الحالة الواقعية | الجداول (Tables) | الخدمات (Services) | الـ API Routers | الشاشات (Frontend Pages) |
|---|---|---|---|---|---|
| **1. دليل الحسابات والإعدادات** (`Chart of Accounts & Config`) | موجود جزئياً (مسطح) | `chart_of_accounts`, `accounting_configs`, `system_lookups` | `seed_tenant_defaults` (`public_onboarding.py`) | `finance.py` (`GET/POST /accounts`), `tenant_settings.py` (`/lookups`), `phase6_ops.py` (`/import/accounts`, `/exports/accounts.csv`) | `erp/finance/ledger/page.tsx` (عرض + استيراد CSV فقط)، `erp/settings/lookups/page.tsx` |
| **2. دفتر اليومية وميزان المراجعة** (`General Ledger & Trial Balance`) | موجود جزئياً (بسيط) | `journal_entries`, `journal_lines` | `DoubleEntryService` (`accounting_service.py`) | `finance.py` (`GET/POST /journal-entries`, `GET /trial-balance`), `phase6_ops.py` (`/exports/trial-balance.csv`, `/exports/journal.csv`) | `erp/finance/ledger/page.tsx` |
| **3. الفوترة والذمم المدينة وجدولة الدفعات** (`Invoicing, AR & Milestones`) | موجود جزئياً وبه عيوب حرجة | `invoices`, `payment_milestones`, `client_profiles` | `DoubleEntryService`, `ApprovalsService`, `AvailabilityService` | `bookings.py`, `portal.py`, `finance.py`, `lifecycle_ops.py`, `phase6_ops.py`, `tenant_settings.py` (`/tenant/clients`) | `ThreeMonthBookingEngine.tsx`, `portal/dashboard/page.tsx`, `erp/dashboard/page.tsx`, `erp/finance/ledger/page.tsx` |
| **4. خزينة تأمين الأضرار وفحص ما بعد الفعالية** (`Security Deposit Escrow & Inspection`) | موجود جزئياً (مفصول عن GL في الخصم/الرد) | `invoices` (`deposit_status`), `damage_inspections` | `DoubleEntryService` (للإيداع فقط) | `lifecycle_ops.py` (`/verify`, `/inspection`) | `portal/dashboard/page.tsx`, `erp/dashboard/page.tsx`, `erp/finance/ledger/page.tsx` |
| **5. مصروفات الفعالية وربحية الفعالية** (`Event Expenses & Event P&L`) | موجود جزئياً (معزول وبلا إدخال مصروفات) | `event_expenses`, `catering_menu_items` | `DoubleEntryService.get_event_pnl` | `finance.py` (`GET /events/{id}/pnl`) | `erp/finance/events/[id]/pnl/page.tsx` |
| **6. التسعير الديناميكي والعروض والاشتراكات** (`Dynamic Pricing & SaaS Billing Metadata`) | موجود تشغيلياً (بلا فوترة اشتراك فعلي) | `halls`, `pricing_rules`, `inventory_items`, `catering_menu_items`, `tenants` | `AvailabilityService.calculate_dynamic_quote`, `_compute_addons` | `bookings.py`, `admin.py`, `tenant_settings.py`, `public_onboarding.py` | `saas-portal/page.tsx`, `admin/page.tsx`, `venue/page.tsx`, `ThreeMonthBookingEngine.tsx`, `pricing-quote.ts` |
| **7. التعديلات والاعتمادات المزدوجة** (`Drafts & Approvals`) | موجود جزئياً (بلا قيود وبلا فحص صلاحيات) | `event_drafts`, `approval_requests`, `event_inventory_allocations` | `ApprovalsService` | `approvals.py` | `portal/dashboard/page.tsx`, `erp/dashboard/page.tsx`, `floor-plan/page.tsx` |
| **8. الرقابة والتدقيق** (`Audit & Governance`) | موجود جزئياً | `audit_logs`, `event_contracts`, `event_delegates`, `users`, `staff_profiles` | `core/security.py`, `core/tenant_middleware.py` | `auth.py`, `portal.py`, `admin.py`, `lifecycle_ops.py` | `portal/dashboard/page.tsx`, `admin/page.tsx` |

---

## 2. جرد الجداول والأعمدة المالية في قاعدة البيانات / Database Financial Schema Inventory

المصدر: `apps/api/app/models/accounting.py`, `apps/api/app/models/tenant.py`, `apps/api/app/models/users.py`, `apps/api/app/models/venue.py`, `apps/api/app/models/events.py`, `apps/api/app/models/events_extensions.py` والهجرة `apps/api/alembic/versions/a79d4cfabc65_phase1_dual_ecosystem_models.py`.

1. **`chart_of_accounts`** (`accounting.py:38-48`): `id`, `tenant_id`, `code` (unique per tenant), `name_ar`, `name_en`, `account_type` (`ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE`), `is_system`, `lifecycle`.
2. **`accounting_configs`** (`accounting.py:50-63`): `id`, `tenant_id` (unique), `fiscal_year_start_month`, `auto_post_on_payment_verify`, `cash_account_id`, `bank_account_id`, `accounts_receivable_id`, `hall_revenue_account_id`, `catering_revenue_account_id`, `security_deposit_liab_id`, `tax_payable_account_id`, `catering_cogs_account_id`. *(ملاحظة: لا توجد قيود FK على معرفات الحسابات الثمانية!)*
3. **`journal_entries`** (`accounting.py:66-80`): `id`, `tenant_id`, `entry_number` (unique per tenant), `entry_date`, `reference`, `description`, `event_id` (UUID بلا FK)، `status` (`String(30)`, default `"POSTED"`), `created_by_id`, `created_at`.
4. **`journal_lines`** (`accounting.py:82-92`): `id`, `tenant_id`, `journal_entry_id` (FK CASCADE), `account_id` (FK `chart_of_accounts.id`), `debit` (`Numeric(14,2)`), `credit` (`Numeric(14,2)`), `memo`.
5. **`invoices`** (`accounting.py:94-107`): `id`, `tenant_id`, `event_id` (FK CASCADE), `invoice_number` (unique عالمياً), `subtotal`, `discount_amount`, `tax_amount`, `total_amount`, `security_deposit_amount` (`Numeric(12,2)`), `deposit_status` (`UNPAID|HELD|INSPECTION_PASSED|REFUNDED|DEDUCTED`), `status` (`DRAFT|ISSUED|PARTIALLY_PAID|PAID|OVERDUE|VOIDED`), `created_at`.
6. **`payment_milestones`** (`accounting.py:109-121`): `id`, `tenant_id`, `invoice_id` (FK CASCADE), `title`, `amount_due` (`Numeric(12,2)`), `due_date`, `paid_amount` (`Numeric(12,2)`), `payment_method`, `receipt_url`, `status` (`PENDING|UNDER_REVIEW|PAID`), `paid_at`.
7. **`event_expenses`** (`accounting.py:123-131`): `id`, `tenant_id`, `event_id` (FK CASCADE), `category`, `description`, `amount` (`Numeric(12,2)`), `recorded_by`, `created_at`.
8. **`damage_inspections`** (`events_extensions.py:58-69`): `id`, `tenant_id`, `event_id` (unique), `inspected_by_id`, `deduction_amount` (`Numeric(12,2)`), `status` (`PASSED|DAMAGE_CLAIMED`), `inspected_at`.
9. **`tenants`** (`tenant.py:36-60`): `currency` (`String(10)`), `tax_rate` (`Numeric(5,2)`), `subscription_tier`, `subscription_status`, `payment_accounts` (`JSON`), `settings` (`JSON`).
10. **`halls`, `pricing_rules`, `inventory_items`, `catering_menu_items`** (`venue.py:12-65`): `base_price`, `multiplier`, `unit_addon_price`, `price_per_guest`, `cost_per_guest`, `recipe_bom`.
11. **`staff_profiles` & `client_profiles`** (`users.py:62-87`): `max_discount_percent`, `commission_rate`, `tax_id`, `national_id_or_cr`, `refund_bank_details`.

---

## 3. جرد الوحدات المفقودة كلياً (Zero Code Footprint) / Completely Missing Modules

بعد البحث الكامل في `apps/` و`alembic/`, لا يوجد أي أثر برمجي للوحدات التالية:
- **الموردون والذمم الدائنة والمشتريات (AP / Purchasing):** لا نماذج `Vendor`, `PurchaseOrder`, `GoodsReceipt`, `VendorBill`, `VendorPayment`.
- **الأصول الثابتة (Fixed Assets):** لا نماذج `Asset`, `AssetCategory`, `DepreciationSchedule`.
- **تعدد العملات وأسعار الصرف (Multi-Currency & FX):** لا جدول `ExchangeRate`, ولا عملة على القيود أو الفواتير.
- **الفترات المالية والإقفال (Fiscal Years & Closing):** لا `FiscalYear`, `AccountingPeriod`, `PeriodClose`.
- **الموازنات ومراكز التكلفة (Budgets & Cost Centers):** لا `Budget`, `CostCenter`, `ProfitCenter`.
- **البنوك والتسوية البنكية والشيكات (Banking & Reconciliation):** لا `BankAccount`, `BankStatement`, `BankReconciliation`, `Cheque`.
- **القوائم المالية المعيارية والتوحيد (Financial Statements & Consolidation):** لا `BalanceSheet`, `IncomeStatement`, `CashFlowStatement`, `EquityStatement`, `CompanyGroup`.

---

## 4. مكونات التغليف المكتبية والمحمولة (`apps/desktop`, `apps/mobile`)

- **`apps/desktop` (Tauri v2):** يحتوي فقط على `package.json` و`src-tauri/tauri.conf.json` (يغلف مخرجات `apps/web/out` المبنية بـ `BUILD_TARGET=NATIVE`). تم تضمين `@tauri-apps/plugin-sql` في `package.json` لكنه **غير مستخدم في أي كود TypeScript** داخل `apps/web/src/`.
- **`apps/mobile` (Capacitor 6):** يحتوي فقط على `package.json` و`capacitor.config.ts` مع `@capacitor-mlkit/barcode-scanning` المستخدم في `apps/web/src/app/[locale]/gate/page.tsx:171` لمسح QR في البوابة الأمنية، ولا يحتوي على أي مكون محاسبي خاص.
