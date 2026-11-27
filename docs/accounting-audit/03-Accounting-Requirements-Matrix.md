# 03 — مصفوفة المتطلبات المحاسبية الشاملة (المجالات A إلى P)
# Comprehensive Accounting Requirements Matrix (Domains A–P)

**تصنيف الحالات المعتمد / Status Taxonomy:** `IMPLEMENTED` | `PARTIALLY IMPLEMENTED` | `IMPLEMENTED BUT DEFECTIVE` | `MISSING` | `NOT VERIFIED` | `NOT APPLICABLE`  
**مستوى الخطورة / Severity:** `CRITICAL` | `HIGH` | `MEDIUM` | `LOW`

---

## Domain A: Financial Foundation & Accounting Configuration (الأساس المحاسبي والإعدادات)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| A.01 | إعدادات المنشأة المالية (`Tenant` & `AccountingConfig`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `models/tenant.py:51-53`, `models/accounting.py:50-63`, `public_onboarding.py:78-88` | توجد حقول لكن لا توجد شاشة أو API لتعديل `AccountingConfig` أو `Tenant.tax_rate` أو `currency` بعد التسجيل؛ و6 من أصل 8 حسابات غير مستخدمة حياً. **P0** |
| A.02 | دليل الحسابات (`Chart of Accounts`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `models/accounting.py:38-48`, `routers/finance.py:46-110`, `ledger/page.tsx` | عرض وإضافة عبر API واستيراد CSV فقط؛ لا يوجد `PATCH/DELETE` للحساب، ولا نموذج إضافة حساب في الواجهة. **P1** |
| A.03 | أنواع الحسابات وطبيعتها (`Normal Balance`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `models/accounting.py:13-18`, `accounting_service.py:259-262` | الـ Enum يحدد 5 أنواع، لكن لا يوجد حقل `normal_balance`؛ ميزان المراجعة يحسب `d - c` لجميع الحسابات فتظهر الإيرادات والالتزامات بالسالب. **P1** |
| A.04 | مستويات الحسابات والتجميع الهرمي (`Hierarchy / Rollups`) | `MISSING` | `HIGH` | `models/accounting.py:38-48` | لا يوجد `parent_id` أو `level` أو `is_group`؛ الدليل مسطح بالكامل. **P1** |
| A.05 | الحسابات الرقابية (`Control Accounts`) | `MISSING` | `HIGH` | `models/accounting.py:38-48`, `accounting_service.py:26-80` | يمكن الترحيل يدوياً مباشرة على `1100` (AR) أو `2100` أو `1010` دون أي حماية للحسابات الرقابية. **P1** |
| A.06 | إعدادات الترحيل التلقائي (`Auto-Posting Rules`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `models/accounting.py:55`, `accounting_service.py:83-168` | `auto_post_on_payment_verify` مخزن في DB ومهمل في الكود؛ لا توجد شجرة قواعد ترحيل للأحداث الأخرى. **P0** |
| A.07 | الحسابات الافتراضية للعمليات | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `accounting.py:56-63`, `public_onboarding.py:78-88`, `accounting_service.py:115-116` | يُقرأ فقط `cash_account_id`, `bank_account_id`, `accounts_receivable_id`, `security_deposit_liab_id`؛ أما `hall_revenue`, `catering_revenue`, `tax_payable`, `catering_cogs` غير مستخدمة في أي endpoint! **P0** |
| A.08 | إعدادات العملات والدقة والتقريب | `PARTIALLY IMPLEMENTED` | `HIGH` | `tenant.py:51`, `accounting.py:87-88,99-103`, `pricing-quote.ts:41-58` | الأعمدة تستخدم `Numeric(14,2)`/`(12,2)`، لكن الواجهة تقرّب بـ `Math.round` بينما الخلفية بـ `Decimal.quantize("0.01")`؛ لا دعم لمنازل عشرية مختلفة حسب العملة (مثل 3 منازل). **P1** |
| A.09 | إعدادات السنوات والفترات المالية | `MISSING` | `CRITICAL` | `accounting.py:54` (`fiscal_year_start_month`) | حقل واحد مهمل في الكود؛ لا جداول سنوات أو فترات مالية. **P1** |
| A.10 | الأبعاد المحاسبية (`Dimensions`: فرع/مركز تكلفة/فعالية) | `PARTIALLY IMPLEMENTED` | `MEDIUM` | `accounting.py:74` (`JournalEntry.event_id`) | يوجد فقط ربط اختياري بـ `event_id` دون FK؛ لا مراكز تكلفة ولا فروع ولا أقسام في القيود. **P2** |
| A.11 | السياسات المحاسبية (`Accounting Policies`) | `MISSING` | `MEDIUM` | فحص شامل لـ `apps/api` | لا توجد سياسات مسجلة (الاعتراف بالإيراد، تقييم المخزون، الإهلاك). **P2** |
| A.12 | إدارة الأرقام المرجعية للمستندات (`Document Numbering`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `accounting_service.py:59`, `bookings.py:286,305,347` | أرقام عشوائية `uuid4().int % 1000000` (لـ JE) أو `% 10000` (للحجز `EVT-`)! غير متسلسلة ومعرضة للتصادم عند ارتفاع عدد المستندات. **P0** |

---

## Domain B: General Ledger (الأستاذ العام)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| B.01 | قيود اليومية اليدوية (`Manual Journals`) | `PARTIALLY IMPLEMENTED` | `MEDIUM` | `finance.py:177-194`, `accounting_service.py:26-80`, `ledger/page.tsx:331-385` | نموذج الواجهة يدعم سطرين فقط (مدين واحد / دائن واحد)، بينما API يدعم قائمة سطور، لكن بدون تحديد `entry_date`! **P1** |
| B.02 | القيود المتكررة (`Recurring Journals`) | `MISSING` | `MEDIUM` | فحص `apps/api` | غير موجود. **P3** |
| B.03 | القيود العكسية (`Reversing Journals`) | `MISSING` | `CRITICAL` | `models/accounting.py:66-80`, `routers/finance.py` | لا يوجد حقل `reversed_entry_id` ولا endpoint لعكس قيد مرحّل؛ تصحيح الأخطاء مستحيل محاسبياً بطريقة نظامية. **P0** |
| B.04 | قيود الاستحقاق والتسوية (`Accrual & Adjustment Entries`) | `MISSING` | `HIGH` | `bookings.py:302-342`, `approvals_service.py:146-171` | الفواتير الحية وتعديلاتها لا تولد قيود استحقاق أو تسوية تلقائياً؛ ولا توجد واجهة قيود تسوية. **P0** |
| B.05 | الأرصدة الافتتاحية (`Opening Balances`) | `MISSING` | `HIGH` | `apps/api` | لا توجد آلية أو شاشة مخصصة لإدخال وموازنة الأرصدة الافتتاحية للعملاء والحسابات. **P1** |
| B.06 | اعتماد القيود (`Journal Approval`) | `MISSING` | `HIGH` | `accounting_service.py:62` | كل قيد يُنشأ مباشرة بحالة `"POSTED"`؛ لا توجد حالة `DRAFT` أو `PENDING_APPROVAL`. **P1** |
| B.07 | ترحيل القيود (`Journal Posting`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `accounting_service.py:26-80` | يفرض توازن القيد (`< 0.01`) وعزل `tenant_id`؛ لكن يلتزم بـ `commit()` داخل الدالة ما يكسر ذرية العمليات المركبة، ولا يفحص الفترة المالية أو `Idempotency`. **P0** |
| B.08 | دفتر الأستاذ العام وحساب الأستاذ التفصيلي (`General Ledger & Account Ledger`) | `MISSING` | `CRITICAL` | `routers/finance.py`, `ledger/page.tsx` | لا يوجد endpoint أو شاشة لعرض حركة حساب محدد مع الرصيد التراكمي (`Running Balance`) وتصفية التاريخ. **P1** |
| B.09 | ميزان المراجعة (`Trial Balance`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `accounting_service.py:224-270`, `finance.py:197-205` | يفتقد لتصفية التاريخ، ولا يفلتر `JournalEntry.status == 'POSTED'`، ويحسب الرصيد كـ `d - c` دون مراعاة طبيعة الحساب، ويحول القيم إلى `float`. **P1** |
| B.10 | مطابقة الحسابات (`Account Reconciliation`) | `MISSING` | `HIGH` | `apps/api` | لا يوجد ربط تسوية بنود مفتوحة أو مطابقة حسابات. **P2** |
| B.11 | الحسابات المعلقة (`Suspense Accounts`) | `MISSING` | `MEDIUM` | `public_onboarding.py:53-62` | غير معرف في الدليل الافتراضي ولا آلية لتصفيته. **P3** |
| B.12 | قيود بين الشركات (`Intercompany Journals`) | `MISSING` | `LOW` | `apps/api` | غير موجود (يعتمد على تعدد الشركات). **P4** |
| B.13 | سجل تدقيق القيود (`Journal Audit Trail`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `accounting.py:76-77`, `events.py:115-124`, `accounting_service.py:153-166` | `JournalEntry` يسجل `created_by_id` و`created_at`؛ `AuditLog` يسجل فقط تحقق الدفع ولا يسجل القيود اليدوية، ولا يوجد منع DB Trigger ضد تعديل القيود المرحلة. **P1** |

---

## Domain C: Accounts Receivable (AR — الذمم المدينة)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| C.01 | إدارة العملاء والأرصدة (`Customer Master & Balances`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `users.py:74-86`, `tenant_settings.py:474-535`, `erp/dashboard/page.tsx:775-897` | توجد شاشة وAPI لحساب `total_contracted` و`outstanding_balance` من `Invoice`/`PaymentMilestone` (وليس من GL `1100`!). **P1** |
| C.02 | فواتير المبيعات (`Sales Invoices`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `bookings.py:302-314`, `finance.py:207-264` | تُنشأ الفواتير تلقائياً عند الحجز بحالة `ISSUED`، **لكن دون ترحيل قيد استحقاق في GL** ودون إمكانية إنشاء فاتورة يدوية أو تعديل البنود مباشرة. **P0** |
| C.03 | الإشعارات المدينة والدائنة (`Debit / Credit Notes`) | `MISSING` | `CRITICAL` | `models/accounting.py`, `routers/finance.py` | لا توجد إشعارات دائنة أو مدينة؛ لا يمكن إلغاء أو تخفيض فاتورة مصدرة محاسبياً بشكل نظامي. **P1** |
| C.04 | سندات القبض والتحصيل (`Receipts`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `portal.py:432-458`, `bookings.py:679-711`, `lifecycle_ops.py:203-269`, `finance.py:267-283` | رفع إيصال + اعتماد المالية يولّد قيداً، لكن **بدون فحص تكرار الدفع**، بدون دعم التحصيل الجزئي، مع وجود endpointين متناقضين للتحقق، ورفع عام غير محمي. **P0** |
| C.05 | الدفعات المقدمة (`Advance Deposits / Deferred Revenue`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `accounting.py:21-26`, `bookings.py:316-341`, `accounting_service.py:116` | تأمين الأضرار مصمم في حساب `2100`، أما الدفعة المقدمة للحجز (50%) فتُقيد على `AR 1100` قبل إثبات الإيراد أو الذمة أصلاً! لا يوجد حساب التزام "إيرادات مقدمة/مؤجلة" (IFRS 15) للمناسبات المستقبلية. **P0** |
| C.06 | تسويات العملاء (`Customer Settlements`) | `MISSING` | `HIGH` | `apps/api` | لا توجد آلية لمقاصة أو تسوية الأرصدة أو رد المبالغ الفائضة للعميل (بما فيه رد تأمين `2100`). **P0** |
| C.07 | تحليل أعمار الديون (`AR Aging Analysis`) | `MISSING` | `HIGH` | `apps/api`, `apps/web` | لا يوجد تقرير 0-30 / 31-60 / 61-90 / 90+ يوماً رغم وجود `due_date` على `PaymentMilestone`. **P1** |
| C.08 | الحدود الائتمانية (`Credit Limits`) | `MISSING` | `MEDIUM` | `users.py:74-86` | غير موجود للعملاء (خاصة `CORPORATE_B2B`). **P2** |
| C.09 | كشوف حساب العملاء (`Customer Statements`) | `MISSING` | `HIGH` | `apps/api`, `apps/web` | لا يوجد كشف حساب تجميعي لحركات العميل (فواتير، مقبوضات، إشعارات، رصيد ختامي). **P1** |
| C.10 | توزيع الدفعات (`Payment Allocation`) | `PARTIALLY IMPLEMENTED` | `MEDIUM` | `accounting.py:109-120` | الربط 1-to-1 عبر `PaymentMilestone` المحدد سلفاً فقط؛ لا يوجد تحصيل واحد موزّع على عدة فواتير أو أقساط. **P2** |
| C.11 | مخصص الديون المشكوك فيها (`Bad Debt Provision / ECL`) | `MISSING` | `MEDIUM` | `apps/api` | غير موجود (مطلوب لـ IFRS 9 عند التعامل بالآجل B2B). **P3** |
| C.12 | شطب الديون (`Write-off Management`) | `MISSING` | `MEDIUM` | `apps/api` | غير موجود. **P3** |
| C.13 | الاعتراف بالإيراد (`Revenue Recognition — IFRS 15`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `bookings.py:302-342`, `seed.py:423-450` | لا يَعترف بالإيراد في GL عند الحجز الحقيقي إطلاقاً، ولا يفصل بين الإيراد المؤجل قبل إقامة الحفل والإيراد المكتسب عند إتمام الفعالية (`COMPLETED`). **P0** |

---

## Domain D: Accounts Payable (AP — الذمم الدائنة)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| D.01–D.12 | الموردون، فواتير المشتريات، الإشعارات، سندات الصرف، الدفعات المقدمة للموردين، جدولة المدفوعات، المطابقة الثلاثية (PO/GRN/Bill)، مطابقة الموردين، أعمار الديون، كشوف الموردين، ضريبة الاستقطاع، كشف الفواتير المكررة | `MISSING` | `CRITICAL` (للمنظومة المتكاملة) / `HIGH` (للصرف التشغيلي) | فحص شامل لجميع ملفات `apps/api/app/models/`, `routers/`, `services/`, `apps/web/src/` | **غياب كامل (0%)** لوحدة المشتريات والذمم الدائنة. يوجد فقط `UserType.EXTERNAL_VENDOR` و`DelegateRole.VENDOR` كـ "مفوض دخول فعالية" في البوابة، وليس مورداً محاسبياً! لا يمكن تسجيل مشتريات الضيافة أو أجور الموردين أو سدادها في النظام. **P2** |

---

## Domain E: Cash & Bank Management (إدارة النقدية والبنوك)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| E.01 | الحسابات النقدية (`Cash Accounts`) | `PARTIALLY IMPLEMENTED` | `MEDIUM` | `public_onboarding.py:54`, `accounting_service.py:115` | حساب `1010` واحد فقط لكل مستأجر دون صناديق متعددة أو أمناء عهد. **P2** |
| E.02 | المقبوضات النقدية (`Cash Receipts`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `accounting_service.py:115,187` | تتحقق فقط عند تمرير `payment_method="CASH"` على قسط موجود؛ بدون سند قبض مستقل أو رقم إيصال أو قيد على التكرار. **P0** |
| E.03 | المدفوعات النقدية (`Cash Payments`) | `MISSING` | `HIGH` | `apps/api` | لا توجد سندات صرف للمصروفات أو استرداد التأمين. **P1** |
| E.04 | الحسابات البنكية (`Bank Accounts`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `tenant.py:55`, `public_onboarding.py:55`, `portal.py:465-473` | `payment_accounts` مخزنة كـ JSON للعرض والنسخ للعميل، بينما كل التحويلات (كريمي/جيب/جوالي/ون كاش) تُرمى في حساب GL واحد `1020` دون تمييز مصرفي! **P1** |
| E.05 | التحويلات البنكية (`Bank Transfers`) | `MISSING` | `MEDIUM` | `apps/api` | لا يوجد تحويل بين الصندوق والبنك أو بين المحافظ الإلكترونية إلا عبر قيد يدوي عام. **P2** |
| E.06–E.07 | الشيكات والشيكات الآجلة (`Cheques & PDCs`) | `MISSING` | `MEDIUM` | `apps/api` | غير موجود. **P3** |
| E.08 | التسوية البنكية (`Bank Reconciliation`) | `MISSING` | `HIGH` | `apps/api`, `apps/web` | غير موجود (أمر حرج لبيئة تعتمد على تحويلات الكريمي والمحافظ). **P1** |
| E.09–E.10 | التدفق النقدي والتنبؤ النقدي (`Cash Flow & Forecasting`) | `MISSING` | `HIGH` | `apps/api`, `apps/web` | غير موجود. **P2** |
| E.11 | المصروفات النثرية / العهد (`Petty Cash`) | `MISSING` | `MEDIUM` | `apps/api` | غير موجود. **P3** |
| E.12 | تقارير الموقف النقدي (`Cash Position Reporting`) | `MISSING` | `MEDIUM` | `apps/api` | غير موجود سوى قراءة سطر `1010`/`1020` في ميزان المراجعة. **P2** |
| E.13–E.14 | استيراد كشوف البنك والمطابقة التلقائية | `MISSING` | `MEDIUM` | `apps/api` | غير موجود. **P3** |

---

## Domain F: Multi-Currency Management (إدارة تعدد العملات)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| F.01–F.10 | تعدد العملات، العملة الأساسية/الوظيفية/العرض، أسعار الصرف التاريخية والمعاملات، إعادة التقييم، أرباح/خسائر الصرف المحققة وغير المحققة، الترجمة، تقريب العملات، مطابقة العملات | `MISSING` (باستثناء رمز عملة نصي `Tenant.currency`) | `HIGH` | `tenant.py:51`, `saas-portal/page.tsx:25-29` | حقل `Tenant.currency` نص وصفي (`YER`/`SAR`/`USD`) فقط. لا توجد عملة على القيود أو الفواتير، ولا جدول أسعار صرف. الأسعار في `saas-portal` مجرد عرض ثابت (`USD:1, SAR:3.75, YER:530`). **P2** |

---

## Domain G: Fixed Assets Management (إدارة الأصول الثابتة)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| G.01–G.14 | سجل الأصول، التصنيفات، الاستحواذ، الرسملة، طرق الإهلاك، ترحيل الإهلاك، النقل، الاستبعاد، إعادة التقييم، الاضمحلال، الصيانة، المكونات، السجل التاريخي، التقارير | `MISSING` | `HIGH` | فحص شامل لـ `apps/api` و`apps/web` | غير موجود كلياً (رغم أن القاعات تملك أصولاً ثقيلة كالمباني وأنظمة الصوت والإضاءة والأثاث). **P2** |

---

## Domain H: Cost & Management Accounting (محاسبة التكاليف والإدارية)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| H.01–H.09 | مراكز التكلفة، مراكز الربحية، عناصر التكلفة، توزيع التكاليف المباشرة وغير المباشرة، قواعد التوزيع، تكلفة المنتج/الخدمة | `MISSING` | `HIGH` | `models/accounting.py`, `models/venue.py:64` (`recipe_bom` غير مستخدم) | `recipe_bom` حقل JSON غير مستخدم؛ لا مراكز تكلفة ولا تحميل غير مباشر. **P2** |
| H.10 | تكلفة المشروع / الفعالية (`Project / Event Costing`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `models/accounting.py:123-131`, `accounting_service.py:273-321`, `pnl/page.tsx` | يجمع `EventExpense` التي لا يوجد لها endpoint إدخال، ويتجاهل `CateringMenuItem.cost_per_guest` و`JournalLine`. **P0** |
| H.11–H.16 | تكلفة التصنيع، المعيارية مقابل الفعلية، تحليل الانحرافات، تحليل الربحية، الأبعاد التحليلية | `MISSING` | `MEDIUM` | `apps/api` | غير موجود (باستثناء `margin_percent` بسيط للفعالية في `get_event_pnl`). **P3** |

---

## Domain I: Budgeting & Financial Planning (الموازنات والتخطيط المالي)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| I.01–I.15 | الموازنات السنوية/الإدارات/الفروع/المشاريع/مراكز التكلفة/الإيرادات/المصروفات، الاعتماد، التعديل، الرقابة ومنع التجاوز، الفعلي مقابل الموازنة، التنبيهات، التنبؤ المتدحرج | `MISSING` | `MEDIUM` | فحص شامل لـ `apps/api` و`apps/web` | غير موجود كلياً. **P3** |

---

## Domain J: Tax Management (إدارة الضرائب)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| J.01 | إعدادات الضرائب (`Tax Configuration`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `tenant.py:52` (`tax_rate`), `public_onboarding.py:58` (`2200 Tax Payable`) | نسبة مفردة لكل مستأجر بدون أنواع ضرائب أو تفعيل/تعطيل أو شاشة تعديل `tax_rate` في الواجهة! **P1** |
| J.02 | ضريبة القيمة المضافة (`VAT`) وضريبة المبيعات (`Sales Tax`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `availability_service.py:122`, `bookings.py:307`, `approvals_service.py:152-154` | تُحسب الضريبة على الفاتورة ولا تُرحّل لـ `2200` عند الحجز الحقيقي أو عند اعتماد تعديل مسودة. **P0** |
| J.03–J.12 | ضريبة الاستقطاع (WHT)، ضريبة المشتريات (Input VAT)، الإعفاءات، الأسعار حسب تاريخ السريان، التسوية الضريبية، الإقرارات، تقارير الضرائب، سجل التدقيق الضريبي | `MISSING` | `HIGH` | `apps/api` | غير موجود كلياً (عدا `client_profiles.tax_id` المطبوع في البيانات فقط — ولا يُطبع حتى في PDF الفاتورة `import_export_service.py:141-184`!). **P1** |

---

## Domain K: Financial Closing & Fiscal Year Management (الإقفال المالي والسنوي)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| K.01–K.15 | إعداد السنة المالية، إدارة الفترات، فتح/إغلاق/قفل الفترات، الإقفال الشهري والسنوي، الاستحقاقات، إقفال الإهلاك والمخزون، إقفال الإيرادات والمصروفات، الأرباح المحتجزة، ترحيل الأرصدة الافتتاحية، تسويات الفترات السابقة، ميزان المراجعة بعد الإقفال | `MISSING` | `CRITICAL` | `accounting.py:54` (`fiscal_year_start_month` غير مستخدم) | **غياب كامل (0%)** لجميع آليات الإقفال وقفل الفترات؛ يمكن الترحيل بأي تاريخ دون قيود. **P1** |

---

## Domain L: Financial Statements & Reporting (التقارير والقوائم المالية)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| L.01 | تقارير الأستاذ العام (`GL Reports`) | `MISSING` | `CRITICAL` | `routers/finance.py`, `ledger/page.tsx` | لا يوجد تقرير أستاذ عام تفصيلي. **P1** |
| L.02 | تقارير اليومية (`Journal Reports`) | `PARTIALLY IMPLEMENTED` | `MEDIUM` | `finance.py:113-174`, `phase6_ops.py:81-101` | حد أقصى 50-200 قيد في الواجهة، وتصدير CSV يعرض رأس القيد فقط **دون السطور والمدين والدائن** (`phase6_ops.py:89-100`)! **P1** |
| L.03 | ميزان المراجعة (`Trial Balance`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `accounting_service.py:224-270`, `phase6_ops.py:76-80` | بلا تصفية تاريخ/فترة، رصيد خاطئ الإشارة لحسابات الدائن، ولا يفلتر `status == POSTED`. **P1** |
| L.04–L.08 | الميزانية العمومية، قائمة الدخل الشاملة، التدفقات النقدية، التغير في حقوق الملكية، الإيضاحات | `MISSING` | `CRITICAL` | `apps/api`, `apps/web` | **مفقودة بالكامل**؛ لا يوجد أي من القوائم المالية الأساسية الأربعة (يوجد P&L لفعالية منفردة فقط). **P1** |
| L.09–L.17 | تقارير AR/AP/الأعمار/التسوية البنكية/الأصول/الإهلاك/التكاليف/الموازنة/الضرائب/النسب المالية | `MISSING` (عدا قائمة فواتير مسطحة) | `HIGH` | `finance.py:207-264` | توجد قائمة فواتير فقط دون تقارير تحليلية أو أعمار أو ضرائب أو بنوك. **P1** |
| L.18 | تقارير الربحية (`Profitability Reports`) | `PARTIALLY IMPLEMENTED` | `HIGH` | `accounting_service.py:273-321`, `pnl/page.tsx` | لفعالية واحدة فقط، وبأرقام تشغيلية غير مربوطة بالأستاذ العام ومفقودة المصروفات. **P1** |
| L.19–L.20 | القوائم الموحدة والمقارنة (`Consolidated & Comparative`) | `MISSING` | `MEDIUM` | `apps/api` | غير موجود. **P3** |
| L.21 | التتبع العكسي للمستند المصدر (`Drill-down to Source Docs`) | `MISSING` | `HIGH` | `ledger/page.tsx`, `finance.py` | لا يمكن النقر على رصيد حساب في ميزان المراجعة لرؤية قيوده أو فواتيره المصدرية. **P1** |
| L.22 | التصدير إلى Excel وPDF | `PARTIALLY IMPLEMENTED` | `MEDIUM` | `phase6_ops.py:53-161`, `import_export_service.py:132-252` | يدعم CSV (UTF-8 BOM) وفاتورة/BEO PDF (مع fallback صامت لإرجاع HTML خام إذا تعطل WeasyPrint في `_html_to_pdf_bytes`!)؛ لا يوجد Excel `.xlsx` حقيقي ولا PDF للقوائم المالية. **P2** |

---

## Domain M: Financial Consolidation & Multi-Company (التوحيد وتعدد الشركات)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| M.01–M.09 | المحاسبة متعددة الشركات، المعاملات البينية، المطابقة، التوحيد، قيود الاستبعاد، ترجمة العملات، دليل الحسابات الموحد | `MISSING` (`NOT APPLICABLE` لكيان فردي؛ `MISSING` لمشغل متعدد القاعات/الشركات) | `LOW` | `routers/admin.py:244-311` | النظام Multi-Tenant SaaS بعزل تام بين المستأجرين، لكن لا يدعم شركات شقيقة/تابعة ضمن مجموعة واحدة أو توحيداً مالياً. **P4** |

---

## Domain N: Internal Control & Financial Governance (الرقابة الداخلية والحوكمة)

| ID | المتطلب / Requirement | الحالة / Status | الخطورة / Severity | الدليل البرمجي / Evidence | الملاحظات والأولوية |
|---|---|---|---|---|---|
| N.01 | الفصل بين المهام (`Segregation of Duties`) | `MISSING` | `CRITICAL` | `finance.py:74,178,268`, `lifecycle_ops.py:204` | نفس المستخدم (`FINANCE` أو `OWNER`) ينشئ الحساب، يرحّل القيد مباشرة دون اعتماد، ويعتمد الإيصال؛ لا يوجد `approved_by != created_by`. **P0** |
| N.02 | الصلاحيات المبنية على الأدوار (`RBAC`) | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `core/security.py:140-151`, `approvals.py:155-166`, `portal.py`, `lifecycle_ops.py` | `require_roles` يعمل على مسارات `finance`، لكن `resolve_approval` مفتوح لأي مستخدم في المستأجر، ومسارات `portal` و`invoices/pdf` لا تفحص ملكية العميل! **P0** |
| N.03–N.04 | سير عمل الاعتماد متعدد المستويات | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `approvals_service.py:60-142`, `approvals.py:155-166` | المسار الثنائي (`CLIENT_PRIMARY` -> `OPS_MANAGER`) مبرمج نظرياً لكن بدون التحقق من دور من يستدعي `/resolve`! **P0** |
| N.05–N.06 | صلاحيات الترحيل وقفل الفترات | `PARTIALLY IMPLEMENTED` / `MISSING` | `CRITICAL` | `finance.py:180`, `apps/api` | الترحيل محصور بـ `OWNER`/`FINANCE`، لكن قفل الفترات مفقود كلياً. **P0** |
| N.07–N.09 | سجل التدقيق وتاريخ التغييرات وتتبع المستند | `PARTIALLY IMPLEMENTED` | `HIGH` | `events.py:115-124`, `portal.py:353-376` | `AuditLog` مسجل في عدة عمليات لكن ليس في كل العمليات (مثل القيود اليدوية أو `update_event_status`)، ومفتوح لجميع عملاء المستأجر عبر `/portal/audit-logs` دون تصفية! **P0** |
| N.10–N.11 | منع التكرار والترحيل غير المصرح | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | `lifecycle_ops.py:204-269`, `accounting_service.py:83-168` | لا يوجد `Idempotency` أو منع التحقق المكرر من القسط. **P0** |
| N.12 | الحدود المالية (`Financial Limits`) | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | `models/users.py:68` (`max_discount_percent`) | العمود مخزن في `StaffProfile` ولا يُفحص أبداً! **P1** |
| N.13–N.15 | مراقبة الاستثناءات، مؤشرات الاحتيال، ضوابط العكس | `MISSING` | `HIGH` | `apps/api` | غير موجود. **P1** |

---

## Domain O: Accounting Standards & Compliance (الامتثال للمعايير الدولية IAS / IFRS)

*(انظر المصفوفة التفصيلية لكل معيار في `09-Accounting-Standards-Compliance.md`)*  
الملخص: لا يوجد امتثال مثبت لأي من معايير `IAS 1`, `IAS 2`, `IAS 7`, `IAS 8`, `IAS 10`, `IAS 12`, `IAS 16`, `IAS 19`, `IAS 21`, `IAS 36`, `IAS 37`, `IFRS 9`, `IFRS 15`, `IFRS 16` باستثناء عزل أمانة تأمين الأضرار في الالتزامات (`2100`) جزئياً عند الدفع (دون اكتمال دورة الاعتراف والرد/الخصم).

---

## Domain P: ERP Financial Integration (التكامل المحاسبي مع وحدات النظام)

*(انظر التتبع الكامل لكل حدث في `06-Financial-Integration-Audit.md`)*

| الوحدة / ERP Module | الحالة / Status | الخطورة / Severity | الملخص المدعم بالأدلة |
|---|---|---|---|
| **Sales / Bookings (الحجوزات والعقود)** | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | إنشاء الحجز والفاتورة (`bookings.py`) لا يولد أي قيد استحقاق أو إيراد مؤجل. |
| **Purchasing (المشتريات)** | `MISSING` | `HIGH` | لا توجد وحدة مشتريات. |
| **Inventory (المخزون والتجهيزات)** | `IMPLEMENTED BUT DEFECTIVE` | `HIGH` | لا يحجز المخزون عند الحجز العام، ولا يخصم التكلفة أو الإهلاك في GL. |
| **Point of Sale (POS)** | `NOT APPLICABLE` | `LOW` | لا توجد وحدة POS في نظام القاعات الحالي (إلا إذا اعتُبرت مبيعات إضافية في القاعة، وهي عبر الفاتورة). |
| **Payroll & HR (الرواتب والموارد البشرية)** | `MISSING` | `HIGH` | `StaffProfile.commission_rate` موجود ولا يُحسب أو يُرحّل كاستحقاق عمولات أو رواتب. |
| **Fixed Assets & Manufacturing** | `MISSING` | `HIGH` / `MEDIUM` | لا أصول ثابتة؛ `CateringMenuItem.recipe_bom` غير منفذ لتصنيع الوجبات أو سحب المكونات. |
| **Projects / Events & Contracts** | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | تعديل المسودات يغيّر الفاتورة دون قيد GL ودون تعديل الضريبة على القسط؛ `EventExpense` بلا API. |
| **Warehouse Ops / BEO** | `PARTIALLY IMPLEMENTED` | `MEDIUM` | BEO يقرأ `EventInventoryAllocation` لكنه معزول مالياً عن GL. |
| **Banking & Payment Verification** | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | مسار التحقق من الدفعة يرحّل قيد `Cash/Bank -> AR/2100` لكنه قابل للتكرار وغير ذري في إحدى الدالتين. |
| **Tax Management** | `IMPLEMENTED BUT DEFECTIVE` | `CRITICAL` | تحسب الضريبة على الفاتورة ولا تُرحل إلى `2200` في العمليات الحية. |
