# 06 — تقرير تدقيق التكامل المالي والمحاسبي بين الوحدات
# ERP Financial Integration Audit

يتتبع هذا التقرير جميع العمليات ذات الأثر المالي عبر وحدات النظام (الحجوزات، العقود، الاعتمادات، الضيافة، المخزون، الفحص، المدفوعات، التسويات، الضرائب، والإدارة) من الحدث المصدري إلى دفتر الأستاذ العام.

---

## 1. مصفوفة التتبع المالي الشاملة (End-to-End Financial Event Trace)

| الحدث التشغيلي / Operational Event | المستند المصدر & المسار / Source Doc & Endpoint | الحسابات المتوقعة (DR / CR) | القيد الفعلي الناتج في الكود / Actual GL Result | توقيت الترحيل والاعتماد | مخاطر التكرار / الفقدان | إمكانية التتبع (Drill-Down) |
|---|---|---|---|---|---|---|
| **1. إنشاء حجز مؤقت 48 ساعة أو دفع فوري** | `Event` + `Invoice` + `PaymentMilestone` (`POST /api/v1/bookings/hold`, `bookings.py:200-439`) | `Dr 1100 ذمم العملاء` / `Cr 4000 إيراد القاعات` + `Cr 4100 الضيافة` + `Cr 2200 ضريبة مستحقة` (أو إيراد مؤجل قبل الإقامة) | **لا شيء (ZERO Journal Entries!)** — فقط ينشئ `Invoice(status=ISSUED)`. *(في `seed.py:423-450` تم إدراج القيد يدوياً للعرض فقط!)* | لا يوجد ترحيل | فقدان 100% من قيود الاستحقاق والإيراد والضريبة؛ انعكاس AR بالسالب لاحقاً | منقطع (الفاتورة بلا `journal_entry_id`) |
| **2. تحقق المالية من دفعة عميل (غير تأمين)** | `PaymentMilestone` (`PATCH /api/v1/erp/finance/milestones/{id}/verify`, `lifecycle_ops.py:203` و`POST /api/v1/finance/milestones/{id}/verify`, `finance.py:267`) | `Dr 1010/1020 Cash/Bank` / `Cr 1100 Accounts Receivable` | يرحّل قيداً متوازناً عبر `DoubleEntryService` بمبلغ `milestone.amount_due` كاملة (`accounting_service.py:118,192`) | فوري عند التحقق (لا يحترم `auto_post_on_payment_verify`) | **خطر تكرار حرج (`CRITICAL`)**: عدم فحص `status == "PAID"`؛ عدم ذرية `commit()` في `verify_milestone_payment` | جزئي (`JE.event_id` و`reference` نصي، بدون رابط `milestone_id` مباشر إلا في `AuditLog`) |
| **3. تحقق المالية من دفعة تأمين الأضرار** | `PaymentMilestone` مع `is_security_deposit=true` (`lifecycle_ops.py:236`, `accounting_service.py:116`) | `Dr 1010/1020` / `Cr 2100 تأمينات مستردة` | يرحّل `Dr 1010/1020` / `Cr 2100` بشكل سليم في التوجيه، **لكن:** لا ينشأ أصلاً قسط مستقل للتأمين عند الحجز! | فوري عند التحقق | خلط قسط الفاتورة مع التأمين إذا لم يُنشأ قسط منفصل؛ قابل للتكرار | جزئي عبر `event_id` |
| **4. اعتماد طلب تعديل مالي (`Draft` مع `financial_delta`)** | `EventDraft` + `ApprovalRequest` (`POST /api/v1/approvals/{id}/resolve`, `approvals_service.py:146-171`) | `Dr 1100 AR` / `Cr 4000/4100` + `Cr 2200 Tax` (للفرق الموجب أو العكس للسالب) | **لا شيء (ZERO Journal Entries!)** — يعدل `Invoice.subtotal/tax_amount/total_amount` ويضيف `financial_delta` فقط (بدون الضريبة!) لأحد الأقساط المعلقة | عند الاعتماد الثاني (`OPS_MANAGER`) — **بلا فحص دور المعتمد** | تلف توازن الفاتورة مع أقساطها + فجوة مع GL | منعدم في GL |
| **5. فحص ما بعد المناسبة — خصم أضرار (`DAMAGE_CLAIMED`)** | `DamageInspection` (`POST /api/v1/erp/ops/events/{id}/inspection`, `lifecycle_ops.py:272-335`) | `Dr 2100 تأمينات مستردة` / `Cr إيراد تعويض أضرار أو مصروف إصلاح` | **لا شيء (ZERO Journal Entries!)** — يغير `deposit_status = DEDUCTED` فقط | فوري من `OPS_MANAGER`/`OWNER` | تضخم دائم في حساب `2100` | منعدم في GL |
| **6. فحص ما بعد المناسبة — نجاح واسترداد التأمين (`PASSED` -> `REFUNDED`)** | `DamageInspection` + سداد رد للعميل (`DepositStatus.REFUNDED`) | `Dr 2100 تأمينات مستردة` / `Cr 1010/1020 Cash/Bank` | **مفقود كلياً** (لا يوجد endpoint أو قيد لرد التأمين للعميل) | غير موجود | التزامات `2100` لا تُصفى أبداً | غير موجود |
| **7. انتهاء مهلة الحجز 48 ساعة أو إلغاء فعالية** | `Event` (`celery_tasks.py:13-29` أو `POST /bookings/events/{id}/status`) | عكس استحقاق الفاتورة (إشعار دائن / Void) | **لا شيء** — يُغيّر `Event.status = CANCELLED` دون إلغاء `Invoice` ودون أي قيد عكسي | غير متكامل | بقاء فواتير نشطة لفعاليات ملغاة | منعدم |
| **8. تخصيص المخزون والتجهيزات (`InventoryItem`)** | `HoldAddonItem` (`bookings.py`) أو `EventDraft` (`approvals_service.py:172-200`) | محاسبياً: قيد إيراد إضافات (أو تكلفة استهلاك/تلف) | الحجز العام يكتب `addons` في `AuditLog` فقط؛ الاعتماد يكتب `EventInventoryAllocation` دون فحص توفر الكمية ودون أي قيد GL | عند اعتماد المسودة فقط | تضارب حجز المخزون وعدم انعكاسه في الدفاتر | غير مترابط |
| **9. الضيافة والوجبات (`CateringMenuItem` & `recipe_bom`)** | `CateringMenuItem` (`venue.py:57-65`) | `Dr 5000 Catering COGS` / `Cr Inventory or AP` + فصل إيراد الضيافة في `4100` | `4100` و`5000` (`catering_revenue_account_id` و`catering_cogs_account_id`) **غير مستخدمين أبداً في الكود الحي**! و`recipe_bom` غير مقروء | غير موجود | تداخل إيرادات الضيافة أو اختفاؤها من GL، وغياب تكلفة المبيعات COGS | منعدم |
| **10. مصروفات الفعالية (`EventExpense`)** | `EventExpense` (`accounting.py:123-131`) | `Dr Expense (5xxx)` / `Cr Cash/Bank/AP` | **لا يوجد endpoint إنشاء أصلاً** | غير موجود | لا يمكن تسجيل مصروفات الفعاليات أو إثباتها في GL | منعدم |
| **11. المشتريات والموردون / الرواتب / العمولات / الأصول الثابتة** | `StaffProfile.commission_rate` (`users.py:69`) والباقي مفقود | `Dr Commission/Salaries/Asset/Expense` / `Cr Payable/Bank` | **مفقود بالكامل** (عمود `commission_rate` غير مستخدم) | غير موجود | تغطية مفقودة للمصاريف التشغيلية والرأسمالية | غير موجود |
| **12. قيد اليومية اليدوي (`Manual Journal`)** | `POST /api/v1/finance/journal-entries` (`finance.py:177-194`) | حسب اختيار المحاسب (`lines`) | ينشئ `JournalEntry` + `JournalLine` بحالة `POSTED` فورية | فوري بلا اعتماد، بلا قفل فترة | مخاطر ترحيل على الحسابات الرقابية (`1100`, `2100`, `2200`) وكسر تطابق الدفاتر المساعدة | يربط بـ `event_id` اختيارياً (بلا FK) |

---

## 2. تقييم مركزية محرك الترحيل / Posting Engine Centralization Assessment

- **المركزية الظاهرية vs الواقع:** يوجد `DoubleEntryService` في `apps/api/app/services/accounting_service.py`، لكن منطق التحقق من الأقساط وتحديث الفواتير والفعاليات **مكرر ومتضارب** بين:
  - `DoubleEntryService.verify_milestone_payment` (`accounting_service.py:83-168`) المربوط بـ `POST /api/v1/finance/milestones/{id}/verify`،
  - و`verify_payment_milestone` (`lifecycle_ops.py:203-269`) الذي يستدعي `DoubleEntryService.record_verified_payment` (`accounting_service.py:171-221`).
- **العملة والفرع ومركز التكلفة في التكامل:** غير مررة في أي عملية ترحيل؛ `JournalEntry` و`JournalLine` لا يحتويان على `currency`، `exchange_rate`، `branch_id`، أو `cost_center_id`.

---

## 3. ملخص أخطاء التكامل الأكثر خطورة / Summary of Integration Breakdowns

1. **فجوة الفوترة–الأستاذ العام:** الفواتير الحية (`bookings.py`) لا تصل إلى GL إطلاقاً.
2. **فجوة التعديلات–الأقساط–الأستاذ العام:** تعديلات المسودات (`approvals_service.py`) تكسر مجموع الأقساط ولا تصل إلى GL.
3. **فجوة التأمين–الأضرار–الاسترداد:** `2100` يستقبل ولا يُصرف ولا يُخصم منه محاسبياً.
4. **فجوة التكاليف–المخزون–الضيافة:** `cost_per_guest` و`recipe_bom` و`EventExpense` لا تغذي الأستاذ العام ولا تُدار عبر API.
