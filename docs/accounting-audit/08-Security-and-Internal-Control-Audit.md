# 08 — تقرير تدقيق الأمن المالي والرقابة الداخلية وعزل المستأجرين
# Security, Multi-Tenancy & Internal Control Audit

يفحص هذا التقرير ضوابط الحوكمة المالية، الفصل بين المهام (SoD)، الصلاحيات (RBAC)، عزل المستأجرين (`tenant_id`)، سجل التدقيق (`AuditLog`)، وحماية نقاط النهاية الحساسة.

---

## 1. تقييم عزل المستأجرين (`Multi-Tenancy Isolation`)

### نقاط القوة المثبتة:
- **على مستوى النماذج:** جميع الجداول الخاصة بالمستأجر ترث `TenantOwnedMixin` (`apps/api/app/models/base.py:30-33`) بعمود `tenant_id` مفهرس (`index=True`).
- **على مستوى Middleware:** `TenantResolverMiddleware` (`apps/api/app/core/tenant_middleware.py:12-50`) يحل المستأجر من `X-Tenant-Slug` أو `X-Tenant-Custom-Domain` أو النطاق الفرعي `{slug}.{ROOT_DOMAIN}` أو `custom_domain`.
- **على مستوى JWT (`core/security.py:121-129`):** يرفض `get_current_auth` أي توكن لمستخدم يختلف `user.tenant_id` فيه عن `request.state.tenant.id` برمز `403 Cross-tenant access denied`.
- **على مستوى `DoubleEntryService` (`accounting_service.py:44-54`):** يتحقق من أن جميع `account_id` في سطور القيد تنتمي إلى `tenant_id` الخاص بالعملية.

### ثغرات وفجوات عزل المستأجرين والأمن (`CRITICAL` / `HIGH`):
1. **الوصول العام لملفات الإيصالات عبر `/uploads` (`HIGH`):**  
   `app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")` (`apps/api/app/main.py:42`). أي رابط إيصال بنكي/تحويل مرفوع (`/uploads/receipts/...`) يمكن تحميله مباشرة عبر HTTP **بدون JWT وبدون `tenant_id` check**!
2. **نقطة رفع الإيصال العامة غير المصادق عليها (`CRITICAL`):**  
   `POST /api/v1/public/milestones/{milestone_id}/receipt` (`bookings.py:679-711`) لا تتطلب توكن مصادقة ولا رمز حجز سري؛ معرفة أو تخمين UUID لأي `milestone_id` في المستأجر يسمح باستبدال `receipt_url` وتحويل الحالة إلى `UNDER_REVIEW`.
3. **اختلاط العمالة الخلفية (`Celery Worker`):**  
   `_expire_hold_async` (`celery_tasks.py:13-29`) يستعلم بـ `Event.id == event_id` دون تقييد `tenant_id` (مقبول فقط لأن `id` UUID فريد، لكن الأفضل تمرير `tenant_id` صراحةً والالتزام بعقد العزل).
4. **ثغرة `WhatsApp Webhook` غير الموقع (`HIGH`):**  
   `POST /api/v1/webhooks/whatsapp` (`phase6_ops.py:227-229`) لا يتحقق من توقيع Meta HMAC (`X-Hub-Signature-256`)، ويبحث برقم الهاتف عبر جميع المستأجرين (`comms_service.py:69-71`) ما يسمح بحقن رسائل مزورة في أي مستأجر!
5. **توحيد `phone` و`email` عالمياً عبر المستأجرين (`MEDIUM`/`HIGH`):**  
   `User.phone` و`User.email` فريدان عالمياً (`users.py:49-50`) وليس `UniqueConstraint("tenant_id", "phone")`. هذا يكشف وجود مستخدم لدى منشأة أخرى عند التسجيل (`409 Phone number is already registered in another workspace`, `bookings.py:232`).

---

## 2. ثغرات الصلاحيات والفصل بين المهام (`RBAC & Segregation of Duties`)

| الضابط الرقابي | الحالة | الدليل البرمجي | تقييم المخاطرة |
|---|---|---|---|
| **فحص دور المعتمد في `/approvals/{id}/resolve`** | `IMPLEMENTED BUT DEFECTIVE` | `approvals.py:155-166`, `approvals_service.py:81-142` | **CRITICAL:** أي مستخدم في المستأجر (بمن فيهم `SECURITY` أو أي عميل آخر أو مفوض) يمكنه استدعاء `/resolve` واعتماد تعديلات مالية بقيمة موجبة أو سالبة! |
| **ملكية الفعالية في بوابة العميل وتصدير PDF** | `IMPLEMENTED BUT DEFECTIVE` | `lifecycle_ops.py:48-200`, `portal.py:231-458`, `phase6_ops.py:130-144, 164-213` | **CRITICAL:** أي `CLIENT_PRIMARY` أو `CLIENT_DELEGATE` داخل نفس المنشأة يستطيع قراءة عقود عميل آخر، توقيع عقده، قراءة ضيوفه، تحميل فاتورته PDF، وقراءة رسائله وسجل التدقيق الخاص به بمجرد تمرير `event_id` أو `invoice_id`! |
| **صلاحيات المفوضين (`EventDelegate.permissions`)** | `IMPLEMENTED BUT DEFECTIVE` | `portal.py:174` مقابل `approvals.py`, `lifecycle_ops.py` | **HIGH:** علم `canViewFinance` يُطبَّق في `GET /portal/events` فقط، لكن المفوض المحروم من المالية يستطيع تحميل الفاتورة PDF من `/exports/invoices/{id}/pdf`، كما أن `canEditFloorplan` و`canRequestAddons` لا تُفحص عند إنشاء المسودات! |
| **تغيير حالة الفعالية (`bookings/events/{id}/status`)** | `PARTIALLY IMPLEMENTED` | `bookings.py:750-766` | **HIGH:** مسموح لأي `INTERNAL_STAFF` (بمن فيهم `SECURITY` و`HEAD_CHEF`!) بتغيير حالة الفعالية إلى `CONFIRMED` أو `CANCELLED` دون قيد أو `AuditLog`! |
| **الفصل بين المهام (SoD) في المحاسبة** | `MISSING` | `finance.py:74,178,268` | **CRITICAL:** نفس الموظف (`FINANCE` أو `OWNER`) يفتح الحسابات، ينشئ القيود ويرحّلها فوراً دون اعتماد مراجع، ويعتمد إيصالات التحصيل، ويصدر التقارير. |
| **الحدود المالية (`max_discount_percent`)** | `MISSING` (عمود معطل) | `users.py:68`, `bookings.py`, `approvals_service.py` | **HIGH:** حد الخصم للموظف غير منفذ في أي عملية تسعير أو اعتماد. |
| **كلمة المرور الافتراضية للحجوزات العامة** | `IMPLEMENTED BUT DEFECTIVE` | `bookings.py:243` | **HIGH:** يُنشأ حساب العميل بكلمة مرور ثابتة `"Client@2026"` ما يسهل الاستيلاء على حسابات العملاء الذين حجزوا عبر الواجهة العامة! |
| **مخزن OTP في الذاكرة المحلية** | `IMPLEMENTED BUT DEFECTIVE` | `core/security.py:20-67` | **HIGH:** `_OTP_STORE` في الذاكرة يضيع مع تعدد العمليات وإعادة التشغيل ويفتقر لـ Rate Limiting. |
| **معرف `Tenant` عبر الترويسة `X-Tenant-Slug`** | `PARTIALLY IMPLEMENTED` | `tenant_middleware.py:15,28-30` | **MEDIUM:** جيد لتطبيقات Native، لكن في `auth.py:107` يأخذ التوكن `tenant.id` من الميدلوير (ومع فحص `user.tenant_id != resolved_tenant.id` في `get_current_auth` يمنع التزوير، بشرط أن لا يكون `SUPER_ADMIN`). |

---

## 3. تقييم سجل التدقيق (`AuditLog`) وحماية القيود المرحلة

- **ما يتم تسجيله حالياً:** `PAYMENT_VERIFIED`, `DRAFT_REJECTED`, `DRAFT_APPROVED_AND_SYNCED`, `HOLD_48H_CREATED`, `CONTRACT_ESIGNED_BY_CLIENT`, `POST_EVENT_DAMAGE_INSPECTION`, `MILESTONE_RECEIPT_UPLOADED`, `CLIENT_PROFILE_UPDATED`, `DELEGATE_UPDATED`, `CLIENT_ACCOUNT_UPDATED`, `CLIENT_PASSWORD_RESET`.
- **ما لا يُسجّل في `AuditLog`:**
  - إنشاء القيود اليومية اليدوية (`POST /finance/journal-entries`).
  - إنشاء الحسابات (`POST /finance/accounts`) أو استيراد CSV (`POST /import/{entity}`).
  - تغيير حالة الفعالية (`POST /bookings/events/{id}/status`) — **لا يسجل أي أثر تدقيقي!**
  - تعديل إعدادات المنشأة/الباقات/الحصص في `admin.py` و`tenant_settings.py` (مثل `SystemLookup` و`Hall`).
- **حماية عدم القابلية للتعديل (`Immutability`):**  
  لا توجد أي آلية (Database Triggers، قيود ORM، أو قواعد صلاحيات DB) تمنع `UPDATE` أو `DELETE` على `journal_entries` أو `journal_lines` أو `audit_logs` من طبقة قاعدة البيانات أو أي كود مستقبلي.
- **الاستيراد الجماعـي (`POST /import/{accounts|inventory|guests}`):**  
  مفتوح لأي `INTERNAL_STAFF` (`phase6_ops.py:36`) بما فيهم موظف الأمن أو الشيف لاستيراد حسابات في `ChartOfAccount`!
