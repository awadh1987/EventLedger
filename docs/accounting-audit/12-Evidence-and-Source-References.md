# 12 — سجل الأدلة والمراجع البرمجية الدقيقة
# Evidence and Source References Index

يجمع هذا المستند جميع المراجع الدقيقة للملفات، أرقام الأسطر، الكلاسات، الدوال، نقاط النهاية (`Endpoints`)، الجداول، العلاقات، والاختبارات التي استند إليها هذا التدقيق.

---

## 1. النواة والأمن والميدلوير (`apps/api/app/core/` & `main.py`)

| الملف | الأسطر | الرموز / التفاصيل المستند إليها |
|---|---|---|
| `apps/api/app/main.py` | 12–55 | تسجيل 11 راوتر + `TenantResolverMiddleware`؛ السطر 42 يركّب `app.mount("/uploads", StaticFiles(...))` دون مصادقة. |
| `apps/api/app/core/config.py` | 4–26 | إعدادات `Settings`: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `DEBUG`, `UPLOAD_DIR`, `S3_*`, `WHATSAPP_*`. |
| `apps/api/app/core/database.py` | 5–24 | `normalize_db_url`, `create_async_engine`, `AsyncSessionLocal`, `get_db`. |
| `apps/api/app/core/tenant_middleware.py` | 12–50 | `TenantResolverMiddleware.dispatch`: حل المستأجر عبر `x-tenant-slug`, `x-tenant-custom-domain`, أو host. |
| `apps/api/app/core/security.py` | 20–68, 70–151 | `_OTP_STORE` في الذاكرة المحلية؛ `create_access_token`, `get_current_auth` (عزل cross-tenant عند سطر 123-128)، `require_roles` (سطر 140-151). |

---

## 2. نماذج قاعدة البيانات والهجرات (`apps/api/app/models/` & `alembic/`)

| الملف | الأسطر | الجداول والأعمدة والعلاقات |
|---|---|---|
| `apps/api/app/models/base.py` | 10–33 | `utcnow()`, `RecordLifecycle`, `UUIDPkMixin`, `TenantOwnedMixin` (`tenant_id` FK -> `tenants.id` CASCADE, `index=True`). |
| `apps/api/app/models/accounting.py` | 13–131 | `AccountType`, `DepositStatus`, `InvoiceStatus`, `ChartOfAccount` (`uq_tenant_account_code`), `AccountingConfig` (`tenant_id` unique؛ 8 حسابات UUID بلا FK؛ `fiscal_year_start_month`, `auto_post_on_payment_verify`), `JournalEntry` (`uq_tenant_entry_number`, `event_id` بلا FK, `status` String(30)), `JournalLine` (`Numeric(14,2)`), `Invoice` (`invoice_number` unique عالمياً, `Numeric(12,2)`), `PaymentMilestone` (`Numeric(12,2)`), `EventExpense` (`Numeric(12,2)`). |
| `apps/api/app/models/tenant.py` | 23–91 | `Tenant` (`currency`, `tax_rate Numeric(5,2)`, `settings JSON`, `payment_accounts JSON`), `TenantBranding`, `SystemLookup` (`uq_tenant_category_code`). |
| `apps/api/app/models/users.py` | 13–97 | `User` (`email` unique عالمياً, `phone` unique عالمياً), `StaffProfile` (`role`, `max_discount_percent`, `commission_rate`), `ClientProfile` (`client_category`, `tax_id`, `refund_bank_details`), `EventDelegate` (`uq_event_delegate`, `permissions JSON`). |
| `apps/api/app/models/events.py` | 13–124 | `Event` (`event_code` unique عالمياً), `EventDraft` (`financial_delta Numeric(12,2)`), `ApprovalRequest`, `EventMessage`, `GatePass`, `AuditLog`. |
| `apps/api/app/models/events_extensions.py` | 14–69 | `EventContract`, `EventGuest`, `DamageInspection` (`deduction_amount Numeric(12,2)`). |
| `apps/api/app/models/venue.py` | 12–65 | `Hall` (`base_price`, `cleaning_buffer_minutes`, `combinable_with_hall_id`), `PricingRule` (`multiplier`), `InventoryItem` (`total_stock`, `unit_addon_price`), `EventInventoryAllocation`, `CateringMenuItem` (`price_per_guest`, `cost_per_guest`, `recipe_bom`). |
| `apps/api/alembic/versions/a79d4cfabc65_phase1_dual_ecosystem_models.py` | 18–564 | الهجرة الوحيدة الموجودة في المستودع؛ تطابق النماذج أعلاه. |

---

## 3. الخدمات والعمليات الخلفية (`apps/api/app/services/` & `workers/`)

| الملف | الأسطر | الدوال / الملاحظات الدقيقة |
|---|---|---|
| `apps/api/app/services/accounting_service.py` | 24–321 | `DoubleEntryService`:<br>- `post_balanced_entry` (26–80): يفحص توازن القيد `< 0.01` وعزل `tenant_id`، يولد `JE-YYYY-XXXXXX` عشوائياً (59)، وينفذ `db.commit()` (78).<br>- `verify_milestone_payment` (83–168): يرحّل القيد ثم يحدث `PaymentMilestone` و`Invoice` (commit مزدوج، بلا فحص تكرار، يتجاهل `auto_post_on_payment_verify`).<br>- `record_verified_payment` (171–221): يُستدعى من `lifecycle_ops.py`، ينشئ القيد و`AuditLog`، ثم `db.commit()`.<br>- `get_trial_balance` (224–270): يجمع `JournalLine` بدون ربط `JournalEntry.status`، ويحسب `float(d - c)`.<br>- `get_event_pnl` (273–321): يقرأ `Invoice` و`EventExpense` فقط. |
| `apps/api/app/services/approvals_service.py` | 25–215 | `ApprovalsService.submit_draft_for_approval` (27–78) و`resolve_approval` (81–215): يعدل الفاتورة والضريبة في 146–171 دون الضريبة على القسط ودون قيد GL؛ وبدون فحص دور `approver_id`. |
| `apps/api/app/services/availability_service.py` | 14–135 | `check_hall_availability` (18–81، بدون قفل صفوف) و`calculate_dynamic_quote` (84–135). |
| `apps/api/app/services/comms_service.py` | 15–98 | `CommsService.post_message` و`ingest_whatsapp_webhook` (بحث عام برقم الهاتف بدون تحقق توقيع). |
| `apps/api/app/services/import_export_service.py` | 16–252 | استيراد وتصدير CSV (`utf-8-sig` / `\ufeff`)؛ `_html_to_pdf_bytes` (132–138 fallback إلى HTML)، `render_invoice_pdf` (141–184)، `render_beo_pdf` (187–252). |
| `apps/api/app/workers/celery_tasks.py` | 13–33 | `_expire_hold_async` و`expire_unpaid_48h_hold` (يلغي الحدث دون إلغاء الفاتورة). |

---

## 4. واجهات الـ API Routers (`apps/api/app/routers/`)

| الملف | نقاط النهاية (Endpoints) والأدلة |
|---|---|
| `finance.py` | `GET /api/v1/finance/accounts` (46), `POST /accounts` (74), `GET /journal-entries` (113), `POST /journal-entries` (177), `GET /trial-balance` (197), `GET /invoices` (207), `POST /milestones/{id}/verify` (267), `GET /events/{id}/pnl` (286). |
| `bookings.py` | `GET /api/v1/public/halls/availability` (134), `POST /api/v1/bookings/hold` (200 — بلا قيد GL، يقبل `unit_price` من العميل، كلمة مرور `Client@2026`), `GET /api/v1/public/calendar/three-month` (448), `POST /api/v1/public/milestones/{id}/receipt` (679 — بدون auth), `GET /api/v1/bookings/events` (713), `POST /api/v1/bookings/events/{id}/status` (750 — أي staff بدون `AuditLog`). |
| `lifecycle_ops.py` | `GET /portal/events/{id}/contract` (48), `POST /contract/sign` (81), `GET/POST /guests` (124, 158 — كلها بلا فحص ملكية الحدث للعميل), `PATCH /api/v1/erp/finance/milestones/{id}/verify` (203 — بلا فحص تكرار), `POST /api/v1/erp/ops/events/{id}/inspection` (272 — بلا قيد GL للخصم). |
| `approvals.py` | `POST /events/{id}/drafts` (30), `GET /events/{id}/drafts` (67), `POST /drafts/{id}/submit` (98), `GET /approvals` (116), `POST /approvals/{id}/resolve` (155 — بلا فحص دور المعتمد). |
| `portal.py` | `GET /portal/me` (43), `PATCH /portal/profile` (74), `GET /portal/events` (111 — يفحص `canViewFinance`), `GET/POST/DELETE /delegates` (231, 258, 328), `GET /portal/audit-logs` (353 — بلا تصفية للعميل), `POST /portal/milestones/{id}/receipt` (432), `GET /portal/payment-accounts` (460). |
| `phase6_ops.py` | `POST /import/{accounts\|inventory\|guests}` (31), `GET /exports/{accounts\|trial-balance\|journal\|guests}.csv` (53), `GET /exports/invoices/{id}/pdf` (130 — بلا فحص ملكية), `GET /exports/events/{id}/beo.pdf` (147), `GET/POST /events/{id}/messages` (164, 196), `GET/POST /webhooks/whatsapp` (216, 227), `GET /ops/beo` (232). |
| `public_onboarding.py` | `seed_tenant_defaults` (52–102 — يبذر 8 حسابات و`AccountingConfig` و28 `SystemLookup`), `POST /public/tenants/register` (162). |
| `tenant_settings.py` | `GET/PUT /erp/settings/storefront` (86, 104), `GET/PUT /tenant/branding` (153, 184), `GET/POST/PATCH /lookups` (204, 233, 255), `GET/POST/PATCH /venue/halls` (323, 344, 386), `GET /venue/inventory` (419), `GET /venue/pricing-rules` (437), `GET/PATCH /tenant/clients` (474, 538), `POST /tenant/clients/{id}/reset-password` (594). |
| `admin.py` | `GET /public/tenants` (38), `GET /public/verify/{code}` (69), `GET /public/tenants/{slug}` (222), `GET/PATCH /admin/tenants` (244, 314 — يحسب GMV من `Invoice`), `POST /admin/tenants/{id}/reset-owner-password` (342). |
| `auth.py` | `/login`, `/otp-request`, `/otp-login`, `/register-client`, `/reset-password`, `/change-password`, `/me`. |
| `offline_sync.py` | `POST /gate/check-in` (33), `GET /sync/manifest` (81), `POST /sync/batch` (136). |

---

## 5. الواجهات الأمامية والتغليف (`apps/web/`, `apps/desktop/`, `apps/mobile/`)

| الملف | الأسطر | الأدوار والروابط المالية الملاحظة |
|---|---|---|
| `apps/web/src/app/[locale]/erp/finance/ledger/page.tsx` | 1–486 | يستدعي `/finance/accounts`, `/trial-balance`, `/journal-entries`, `/invoices`, و`PATCH /erp/finance/milestones/{id}/verify`؛ ينقصه إضافة/تعديل حساب، دفتر الأستاذ التفصيلي، عكس القيود، والقوائم المالية. |
| `apps/web/src/app/[locale]/erp/finance/events/[id]/pnl/page.tsx` | 1–87 | يعرض 4 بطاقات فقط (`net_revenue`, `total_expenses`, `net_profit`, `security_deposit_held`) ولا يعرض قائمة `expenses` أو `catering_cogs`. |
| `apps/web/src/app/[locale]/erp/dashboard/page.tsx` | 1–1252 | يربط الموافقات (`OPERATIONS`)، الفواتير والتحقق (`INVOICING`)، العملاء وأرصدتهم (`CLIENTS`)، فحص الأضرار (`submitInspection`)، ورابط P&L. |
| `apps/web/src/app/[locale]/portal/dashboard/page.tsx` | 1–1295 | يعرض الأقساط ورفع الإيصالات وPDF الفاتورة وخزينة التأمين `2100` وحساب الاسترداد، التفويض، التوقيع الإلكتروني، و`AuditLog`. |
| `apps/web/src/components/booking/ThreeMonthBookingEngine.tsx` | 1–1160 | يحسب المعاينة السعرية (مع `appliedOffer.discount_percent` التي لا يرسلها في `POST /bookings/hold`) ويرسل التوقيت بلا timezone. |
| `apps/web/src/lib/pricing-quote.ts` & `pricing-quote.test.ts` | 1–91 / 1–102 | منطق تسعير محلي مكرر وغير متطابق مع الخلفية (`Math.round`, `1.2`). |
| `apps/web/src/app/[locale]/saas-portal/page.tsx` | 25–29, 570–641 | مُضاعِف عملة ثابت (`USD:1, SAR:3.75, YER:530`) لعرض باقات SaaS فقط. |
| `apps/web/src/components/layout/MobileBottomNav.tsx` | 38 | يبني روابط بـ `/${locale}${tab.href}` متجاهلاً `/t/${slug}`. |
| `apps/desktop/` & `apps/mobile/` | configs | مجرد غلاف Tauri v2 / Capacitor 6 لـ `apps/web/out` دون أي منطق محاسبي محلي. |

---

## 6. البذور والاختبارات (`seed.py`, `bootstrap_prod.py`, `tests/`)

- `apps/api/seed.py` (47–502): يبذر `almassa` ويزرع 3 قيود محاسبية (`INV-2026-1001`, `PAY-INV-2026-1001-M1`, `DEP-INV-2026-1001`) يدوياً عند الأسطر 423–496.
- `apps/api/bootstrap_prod.py` (25–59): ينشئ `SUPER_ADMIN` فقط للإنتاج.
- `apps/api/tests/test_invariants.py` (1–338): 4 اختبارات ناجحة (`4 passed in 5.39s`) على SQLite مؤقت؛ لم تختبر القصور الحقيقي في الفوترة الحية أو التكرار أو الصلاحيات.
