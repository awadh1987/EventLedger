# 10 — تقرير فجوات الاختبارات والجودة المالية
# Accounting Testing Gaps Report

يوثق هذا التقرير الاختبارات الموجودة فعلياً في المستودع، نتائج تشغيلها المباشرة، وفجوات التغطية الحرجة التي تجعل الكود عرضة لأعطال محاسبية وأمنية غير مكتشفة.

---

## 1. جرد الاختبارات الموجودة ونتائج فحصها الفعلي / Existing Tests Inventory & Observed Execution

| الملف / File | النوع / Type | النتيجة المرصودة عند التشغيل | ما يختبره فعلياً | قصوره / Why It Gives False Confidence |
|---|---|---|---|---|
| `apps/api/tests/test_invariants.py` | Unit + Integration/API (باستخدام SQLite مؤقت في `%TEMP%`) | **4 passed in 5.39s** (`pytest -q`) | 1) حساب توازن `Decimal` في الذاكرة (`test_balanced_journal_entry_validation`, `test_unbalanced_journal_entry_rejected`)؛<br>2) ترميز UTF-8 BOM للغة العربية؛<br>3) مسار API متكامل (`test_end_to_end_api_invariants`): يتحقق من ميزان المراجعة **المبذر من `seed.py`**، رفض قيد غير متوازن (400)، عزل مستأجر عبر `403`، حجز 48h، توقيع عقد، إضافة ضيف، وتحقق دفعة عبر `/erp/finance/milestones/{id}/verify`. | **ملاحظة حاسمة:** في السطر 317-318 من الاختبار، يتحقق فقط من `assert tb_after_verify["is_balanced"] is True` **ولا يتحقق أبداً من أن رصيد `1100` (ذمم العملاء) لم يتحول للسالب أو أن `4000` (الإيراد) زاد بعد الحجز الحقيقي!** لو فُحص `tb_after_verify` لظهر أن `1100` أصبح **أقل من استحقاقاته** و`4000` لم يزد فلساً! |
| `apps/web/src/lib/pricing-quote.test.ts` | Frontend Unit Test (`node:test`) | **FAILED (`ERR_MODULE_NOT_FOUND`)** عند التشغيل بـ `node --experimental-strip-types --test` | يختبر دوال التسعير المحلية (`isWeekendPeakDate`, `calculateVenueQuote`, `hasScheduleOverlap`) | لا يوجد سكريبت `test` في `apps/web/package.json` أو جذر المشروع؛ والاستيراد `./pricing-quote` بدون امتداد يفشل مع Node ESM، فضلاً عن أن هذه الدالة غير مستخدمة في `ThreeMonthBookingEngine.tsx` أصلاً! |

---

## 2. مصفوفة فجوات الاختبارات المحاسبية / Testing Coverage Matrix

| فئة الاختبار / Test Category | الحالة / Status | الخطورة / Severity | السيناريوهات الحرجة غير المختبرة |
|---|---|---|---|
| **1. اختبارات الترحيل المحاسبي الحي (`Booking -> Accrual -> Payment`)** | `MISSING` | `CRITICAL` | لم يختبر أحد ترحيل قيد استحقاق الفاتورة عند `POST /bookings/hold` أو أثره على حسابات `1100`, `4000`, `4100`, `2200` في ميزان المراجعة! |
| **2. اختبارات منع التكرار (`Idempotency & Double-Verify`)** | `MISSING` | `CRITICAL` | لا يوجد اختبار يحاول استدعاء `/verify` مرتين على نفس القسط؛ لذلك بقي عيب الترحيل المزدوج (DEF-02) مخفياً. |
| **3. اختبارات تعديل الفاتورة و`ApprovalsService`** | `MISSING` | `CRITICAL` | لا يوجد اختبار يمرر `financial_delta > 0` في مسودة ويعتمدها للتحقق من توازن الأقساط والضريبة وقيد التسوية في GL. |
| **4. اختبارات التأمين المسترد وخصم الأضرار** | `MISSING` | `CRITICAL` | `test_invariants.py:331-338` يختبر فقط `status="PASSED", deduction_amount=0`؛ لا يختبر `DAMAGE_CLAIMED` أو `deduction_amount > 0` أو رد التأمين على `2100`. |
| **5. اختبارات الصلاحيات والـ IDOR (`Authorization & SoD`)** | `MISSING` | `CRITICAL` | لا يوجد اختبار يحاول فيه مستخدم `SECURITY` أو `CLIENT_DELEGATE` استدعاء `POST /approvals/{id}/resolve` أو قراءة عقد/فاتورة PDF لعميل آخر في نفس المستأجر. |
| **6. اختبارات التلاعب السعري وحسابات الخصم** | `MISSING` | `HIGH` | لا يوجد اختبار يتحقق من رفض `unit_price=0` في `HoldAddonItem` أو تطابق خصم العروض بين الواجهة والخلفية. |
| **7. اختبارات التزامن وقفل الصفوف (`Concurrency & Race Conditions`)** | `MISSING` | `HIGH` | لا يوجد اختبار لإرسال طلبَي حجز متوازيين لنفس القاعة والوقت، أو طلبَي تحقق متوازيين لنفس القسط. |
| **8. اختبارات الفشل الجزئي وذرية المعاملات (`Transaction Rollback`)** | `MISSING` | `HIGH` | لا اختبار يحاكي فشل DB بعد `post_balanced_entry` داخل `verify_milestone_payment`. |
| **9. اختبارات التعدد اللغوي/الضرائب/الأرقام السالبة والكسور العشرية** | `MISSING` | `HIGH` | لا اختبارات لقبول أرقام سالبة في `JournalLineInput`، تقريب `0.005`، أو التوافق بين `Postgres` و`SQLite` (لاحظ: الاختبارات الحالية تعمل على SQLite فقط ولا تختبر PostgreSQL الفعلي!). |
| **10. اختبارات الإقفال وتعدد العملات وFX** | `MISSING` | `HIGH` | غير موجودة لغياب الوحدات نفسها. |
| **11. اختبارات مكونات الواجهة (`React Component Tests`) و`E2E` (Playwright/Cypress)** | `MISSING` | `HIGH` | لا يوجد أي اختبار مكونات React أو E2E؛ لوحات `ledger/page.tsx` و`erp/dashboard/page.tsx` و`portal/dashboard/page.tsx` و`ThreeMonthBookingEngine.tsx` غير مختبرة آلياً بالكامل. |
| **12. اختبارات مهمات Celery (`expire_unpaid_48h_hold`) والويبهوك** | `MISSING` | `MEDIUM` | لا اختبار لوظيفة انتهاء حجز 48 ساعة في `celery_tasks.py` أو التحقق من `InvoiceStatus.VOIDED`. |
