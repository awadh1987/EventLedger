# 05 — تقرير الأخطاء والمخاطر المحاسبية والتقنية المكتشفة
# Accounting & Technical Defects and Risks Report

يوثق هذا التقرير جميع العيوب البرمجية والمحاسبية ومخاطر سلامة البيانات المكتشفة في مستودع `EventLedger` مع أدلتها الدقيقة وأثرها المالي.

---

## 1. العيوب الحرجة (`CRITICAL`)

### DEF-01: إصدار الفواتير الحية دون ترحيل قيد استحقاق في الأستاذ العام
- **الموقع:** `apps/api/app/routers/bookings.py:302-342` (`create_public_or_staff_48h_hold`) مقارنة بـ `apps/api/seed.py:423-450`.
- **الوصف:** عند إنشاء حجز عبر `POST /api/v1/bookings/hold`، ينشئ الخادم `Invoice` بحالة `InvoiceStatus.ISSUED` وقسطين في `payment_milestones` دون استدعاء `DoubleEntryService` لترحيل قيد الاستحقاق (`Dr 1100 Accounts Receivable / Cr 4000 Hall Revenue / Cr 4100 Catering Revenue / Cr 2200 Tax Payable`).
- **الأثر المالي:** عند اعتماد أي دفعة لاحقاً عبر `verify_payment_milestone`، يتم ترحيل `Dr 1020 Bank / Cr 1100 AR`. وبما أن `1100` لم يُجعل مديناً مسبقاً، **ينعكس رصيد ذمم العملاء بالسالب**، وتختفي إيرادات القاعات والضيافة والضريبة تماماً من ميزان المراجعة.

### DEF-02: قابلية التكرار والترحيل المزدوج لنفس القسط + كسر ذرية المعاملة (Non-Atomic Commit)
- **الموقع:**
  - `apps/api/app/routers/lifecycle_ops.py:203-269` (`PATCH /api/v1/erp/finance/milestones/{milestone_id}/verify`)
  - `apps/api/app/routers/finance.py:267-283` (`POST /api/v1/finance/milestones/{milestone_id}/verify`)
  - `apps/api/app/services/accounting_service.py:83-168` (`DoubleEntryService.verify_milestone_payment`) و`171-221` (`record_verified_payment`).
- **الوصف:**
  1. لا تتحقق أي من الدالتين من أن `ms.status == "PAID"` ولا تستخدم قفل صف (`SELECT ... FOR UPDATE`) ولا `idempotency_key`. إرسال الطلب مرتين (أو النقر المزدوج) يرحّل **قيدين متطابقين** لنفس القسط.
  2. في `verify_milestone_payment` (`accounting_service.py:118-167`), يُستدعى `post_balanced_entry` الذي ينفذ `await db.commit()` في السطر `78` **قبل** تحديث `milestone.status = "PAID"` و`invoice.status` وتنفيذ `commit()` ثانية في السطر `167`. أي فشل بينهما يترك القيد مرحلاً والفاتورة غير مسددة!
  3. في `lifecycle_ops.py:230-267` يحدث العكس: يحدّث `ms` و`inv` و`ev` ثم يستدعي `record_verified_payment` الذي يستدعي `post_balanced_entry` فينفذ `commit()` مبكراً في السطر `78` قبل `AuditLog` في السطر `206-219`.
  4. **تضارب سلوك الـ endpoints:** `lifecycle_ops.py` يحوّل حالة الفعالية `HOLD_48H -> CONFIRMED` ويضيف `AuditLog`، بينما `finance.py` (`verify_milestone_payment`) لا يحوّل حالة الفعالية ولا يفحص `not debit_acc or not credit_acc` ولا يحترم `AccountingConfig.auto_post_on_payment_verify`.

### DEF-03: انقطاع خصم الأضرار واسترداد التأمين عن الأستاذ العام (`2100`)
- **الموقع:** `apps/api/app/routers/lifecycle_ops.py:272-335` (`submit_damage_inspection`), `apps/api/app/routers/bookings.py:302-342`.
- **الوصف:**
  - لا يُنشئ الحجز قسطاً مخصصاً لمبلغ التأمين (`security_deposit_amount`).
  - عند تسجيل فحص أضرار `DAMAGE_CLAIMED` بمبلغ خصم (`deduction_amount > 0`)، يتغير `inv.deposit_status = DepositStatus.DEDUCTED` دون ترحيل أي قيد من حساب الالتزام `2100`.
  - لا يوجد أي endpoint أو دالة لترحيل قيد استرداد التأمين (`DepositStatus.REFUNDED` مهجورة في الـ Enum).
- **الأثر:** يظل التزام `2100` متضخماً في الدفاتر حتى بعد خصم الأضرار أو رد التأمين للعميل.

### DEF-04: اعتماد التعديل المالي (`financial_delta`) يشوّه الأقساط ولا يرحّل قيداً للدفاتر
- **الموقع:** `apps/api/app/services/approvals_service.py:146-171`.
- **الوصف:**
  - يضيف `draft.financial_delta` إلى `invoice.subtotal`، ثم يعيد حساب `invoice.tax_amount` و`invoice.total_amount`، **لكنه يضيف `draft.financial_delta` فقط (دون الضريبة الجديدة!) إلى `pending[-1].amount_due`**.
  - النتيجة الرياضية: `sum(milestones.amount_due) < invoice.total_amount` دائماً عندما تكون `tax_rate > 0`!
  - إذا لم يكن هناك قسط `PENDING` (كأن دُفع الكل)، لا ينشأ قسط جديد ولا تتغير حالة الفاتورة من `PAID`.
  - لا يتم إنشاء أي قيد يومية لتعديل الفاتورة والضريبة في الأستاذ العام.

### DEF-05: حل طلبات الاعتماد (`resolve_approval`) بلا فحص صلاحيات المعتمد
- **الموقع:** `apps/api/app/routers/approvals.py:155-166` و`apps/api/app/services/approvals_service.py:81-142`.
- **الوصف:** يستعمل `Depends(get_current_auth)` فقط دون التحقق من `approval.required_approver_role` (`CLIENT_PRIMARY` أو `OPS_MANAGER`) أو ملكية الفعالية.
- **الأثر:** أي مستخدم مسجل في المستأجر (حارس أمن، مفوض، أو عميل آخر) يستطيع اعتماد تغييرات مالية وتعديل الفواتير والمخزون.

### DEF-06: يتيمية جدول مصروفات الفعاليات (`EventExpense`) وعدم ربط P&L بالأستاذ العام
- **الموقع:** `apps/api/app/models/accounting.py:123-131`, `apps/api/app/services/accounting_service.py:273-321`.
- **الوصف:** لا يوجد أي endpoint أو شاشة لإضافة `EventExpense`. و`get_event_pnl` يقرأ الإيرادات من `Invoice` والمصروفات من `EventExpense` بدلاً من قيود الأستاذ العام، ويتجاهل `CateringMenuItem.cost_per_guest`.

### DEF-07: إمكانية التلاعب بأسعار الإضافات وغياب تطبيق الخصم في الحجز العام
- **الموقع:** `apps/api/app/routers/bookings.py:43-46, 261-263, 275-285` و`apps/web/src/components/booking/ThreeMonthBookingEngine.tsx:401-407`.
- **الوصف:**
  - `HoldAddonItem` يقبل `unit_price` مباشرة من العميل في الطلب HTTP دون الرجوع إلى `InventoryItem.unit_addon_price` في قاعدة البيانات، كما يقبل `addon_amount` الحر من العميل.
  - الواجهة الأمامية تحسب خصم العرض الترويجي (`appliedOffer.discount_percent`) في معاينة السعر، لكن `POST /bookings/hold` لا يقبل العرض أو الخصم، فتصدر الفاتورة بسعر أعلى مما رآه العميل!

---

## 2. العيوب عالية الخطورة (`HIGH`)

### DEF-08: ثغرات تفويض الوصول على مستوى السجل في بوابة العميل وملفات PDF والإيصالات
- **الموقع:** `lifecycle_ops.py:48-200`, `portal.py:231-255, 328-376, 432-458`, `phase6_ops.py:130-144, 164-213`, `bookings.py:679-711`, `main.py:42`.
- **التفاصيل:**
  - لا يوجد فحص ملكية الفعالية (`Event.primary_client_id == auth.user.id` أو `EventDelegate`) على العقود، التوقيع الإلكتروني، الضيوف، المفوضين، الرسائل، سجل التدقيق `/portal/audit-logs`، تحميل PDF الفاتورة، أو رفع الإيصالات داخل البوابة.
  - نقطة `POST /api/v1/public/milestones/{milestone_id}/receipt` مفتوحة دون مصادقة.
  - مجلد `/uploads` منشور عبر `StaticFiles` بدون تحقق من التوكن أو المستأجر.

### DEF-09: سباق التزامن في حجز القاعات (`Double-Booking Race Condition`) وعدم خصم المخزون
- **الموقع:** `apps/api/app/services/availability_service.py:18-81`, `apps/api/app/routers/bookings.py:215-300`.
- **الوصف:** الفحص يتم عبر `SELECT` غير مقفل؛ طلبان متزامنان لنفس القاعة والوقت سيجتازان `check_hall_availability` ويحجزان نفس الفترة. كما أن `addons` في الحجز لا تُنشئ `EventInventoryAllocation` ولا تتحقق من `total_stock` الفعلي المتاح في نفس التاريخ.

### DEF-10: إلغاء الحجز المنتهي (48h Celery Task) لا يلغي الفاتورة
- **الموقع:** `apps/api/app/workers/celery_tasks.py:13-29`, `apps/api/app/routers/bookings.py:404-414`.
- **الوصف:** عند انتهاء مهلة 48 ساعة، يحوّل `_expire_hold_async` حالة `Event` إلى `CANCELLED` **دون تحويل `Invoice.status` إلى `VOIDED`**. كما أن فشل اتصال Redis/Celery يُبتلع بصمت (`except Exception: pass`) دون جدول بديل أو تنبيه.

### DEF-11: خلل حساب الأرصدة والإشارات والفلترة في ميزان المراجعة + استخدام `float`
- **الموقع:** `apps/api/app/services/accounting_service.py:224-270`.
- **الوصف:** يحسب `balance = float(d - c)` دون مراعاة طبيعة الحساب الدائنة (`LIABILITY`, `EQUITY`, `REVENUE`)، لا يربط بـ `JournalEntry` للتأكد من `status == 'POSTED'`، ولا يدعم تصفية التاريخ، ويحوّل المبالغ لـ `float` بدلاً من إرجاع سلاسل عشرية دقيقة أو تنسيق عشري محكوم.

### DEF-12: أرقام قيود وفواتير عشوائية قابلة للتصادم وغير متسلسلة
- **الموقع:** `accounting_service.py:59` (`uuid4().int % 1000000`), `bookings.py:286` (`uuid4().int % 10000`).
- **الأثر:** خطر تصادم عالٍ في `EVT-YYYY-XXXX` (10,000 احتمال فقط!) و`uq_tenant_entry_number`، وفقدان التسلسل التدقيقي.

### DEF-13: تعارض الحسابات في `bookings.py` vs `pricing-quote.ts` وتوقيت المناطق الزمنية
- **الموقع:** `apps/web/src/lib/pricing-quote.ts:40-58` مقابل `apps/api/app/services/availability_service.py:110-135`, و`ThreeMonthBookingEngine.tsx:487-488`.
- **الوصف:** `pricing-quote.ts` يثبت مضاعف عطلة نهاية الأسبوع `1.2` ويقرّب بـ `Math.round` لأقرب عدد صحيح، بينما الخلفية تقرأ `PricingRule` من قاعدة البيانات وتقرّب لمنزلتين عشريتين `Decimal("0.01")`. كما أن `ThreeMonthBookingEngine` يرسل `2026-12-01T17:00:00` دون منطقة زمنية وتعامله الخلفية كـ UTC بينما قد يعرضه المتصفح بالتوقيت المحلي.

### DEF-14: قيود العالمية على هاتف وبريد المستخدم تعيق الحجز بين منشأتين + كلمة مرور افتراضية ثابتة
- **الموقع:** `apps/api/app/models/users.py:49-50`, `apps/api/app/routers/bookings.py:230-243`.
- **الوصف:** `User.phone` و`User.email` فريدان على مستوى المنصة كلها (`unique=True`)، ما يمنع نفس العميل من الحجز لدى منشأتين مختلفتين (`409 Conflict`). وعند إنشاء حساب عميل جديد من الحجز العام، تُعيَّن كلمة مروره افتراضياً إلى `"Client@2026"` المكشوفة في `API_CONTRACT.md` والشفرة المصدرية!

### DEF-15: مخاطر المصادقة وWebhook (OTP بالذاكرة المحلية وWhatsApp بلا توقيع)
- **الموقع:** `apps/api/app/core/security.py:20-67`, `apps/api/app/routers/phase6_ops.py:227-229`.
- **الوصف:** `_OTP_STORE` قاموس في الذاكرة المحلية لا يعمل عبر عدة Workers ولا يحتوي حد محاولات؛ و`POST /webhooks/whatsapp` لا يتحقق من ترويسة `X-Hub-Signature-256`.

---

## 3. العيوب متوسطة الخطورة (`MEDIUM`)

### DEF-16: غياب قيود FK في `AccountingConfig` و`JournalEntry.event_id` وحماية قاعدة البيانات
- **الموقع:** `apps/api/app/models/accounting.py:56-63, 74`.
- **الوصف:** معرفات الحسابات الافتراضية الثمانية في `AccountingConfig` و`event_id` في `JournalEntry` هي `Uuid` بلا `ForeignKey`. كذلك لا توجد `CHECK` constraints على `debit >= 0` أو `credit >= 0` (يمكن تمرير أرقام سالبة في `JournalLineInput` بشرط تساوي المجموع!).

### DEF-17: Fallback صامت في تصدير PDF + غياب تفاصيل السطور في تصدير اليومية CSV
- **الموقع:** `apps/api/app/services/import_export_service.py:132-138`, `apps/api/app/routers/phase6_ops.py:81-101`.
- **الوصف:** إذا فشل WeasyPrint، يرجع `_html_to_pdf_bytes` بايتات HTML بمحتوى `application/pdf` ما يُنتج ملفاً تالفاً! وتصدير `/exports/journal.csv` يصدّر رأس القيد فقط دون سطوره المحاسبية.

### DEF-18: خطأ منطقي طفيف في واجهة `MobileBottomNav` للمسارات متعددة المستأجرين
- **الموقع:** `apps/web/src/components/layout/MobileBottomNav.tsx:38`.
- **الوصف:** يبني الروابط بـ `/${locale}${tab.href}` متجاهلاً `tenantPath(locale, tenantSlug, ...)`، ما يفقد سياق `/t/[slug]` على الجوال عند التنقل من الشريط السفلي!
