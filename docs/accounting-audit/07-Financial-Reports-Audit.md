# 07 — تقرير تدقيق التقارير والقوائم المالية
# Financial Reports & Statements Audit

يفحص هذا التقرير جميع التقارير المالية الموجودة فعلياً في `EventLedger`، ويتحقق من صحة معادلاتها، مصادر بياناتها، إمكانية تتبعها إلى المستندات الأصلية، وتوافقها مع متطلبات التقارير المالية المعيارية.

---

## 1. جرد التقارير المالية الموجودة فعلياً / Existing Financial Reports

| التقرير / Report | المسار / Endpoint & UI | مصدر البيانات / Data Source | التقييم / Audit Verdict | العيوب المكتشفة |
|---|---|---|---|---|
| **1. ميزان المراجعة (`Trial Balance`)** | `GET /api/v1/finance/trial-balance` (`finance.py:197`)، `GET /api/v1/exports/trial-balance.csv` (`phase6_ops.py:76`)، شاشة `erp/finance/ledger/page.tsx:438-463` | `ChartOfAccount` + تجميع `SUM(JournalLine.debit/credit)` (`accounting_service.py:224-270`) | `IMPLEMENTED BUT DEFECTIVE` (`HIGH`) | 1) لا يفلتر `JournalEntry.status == "POSTED"` (يقرأ `JournalLine` مباشرة)؛<br>2) لا يدعم فلترة `from_date` / `to_date` أو فترة مالية؛<br>3) يحسب الرصيد دائماً كـ `debit - credit` فتعرض الالتزامات والإيرادات بالسالب؛<br>4) لا يوجد Drill-down لسطور القيود؛<br>5) يحول المبالغ إلى `float`؛<br>6) **المحتوى نفسه مضلل** لغياب قيود الفواتير الحية. |
| **2. سجل قيود اليومية (`Posted Journal Entries`)** | `GET /api/v1/finance/journal-entries` (`finance.py:113-174`)، `GET /api/v1/exports/journal.csv` (`phase6_ops.py:81-101`)، شاشة `ledger/page.tsx:465-481` | `JournalEntry` + `JournalLine` | `PARTIALLY IMPLEMENTED` (`MEDIUM`) | 1) محدود بـ `limit=50` (بحد أقصى 200) دون `pagination` أو `offset` أو بحث أو تصفية تاريخ؛<br>2) تصدير `journal.csv` يصدّر رأس القيد فقط (`entry_number, entry_date, reference, description, status`) **بلا سطور ولا حسابات ولا مبالغ**! |
| **3. تقرير أرباح وخسائر الفعالية (`Event P&L`)** | `GET /api/v1/finance/events/{event_id}/pnl` (`finance.py:286`)، شاشة `erp/finance/events/[id]/pnl/page.tsx` | `Invoice` + `EventExpense` (`accounting_service.py:273-321`) | `IMPLEMENTED BUT DEFECTIVE` (`CRITICAL`) | 1) يقرأ من `Invoice` و`EventExpense` لا من GL (فلا يتطابق مع ميزان المراجعة)؛<br>2) `EventExpense` بلا API/شاشة، و`CateringMenuItem.cost_per_guest` غير محتسب؛<br>3) شاشة `pnl/page.tsx` لا تعرض حتى قائمة `pnl.expenses` ولا `gross_revenue` ولا `discounts` ولا `catering_cogs` رغم إرجاعها في JSON؛<br>4) يشمل الفواتير الـ `VOIDED` أو الملغاة لأنه لا يفلتر `Invoice.status != VOIDED`. |
| **4. كشف الفواتير والدفعات (`Invoices List`)** | `GET /api/v1/finance/invoices` (`finance.py:207-264`)، شاشات `erp/dashboard/page.tsx` و`ledger/page.tsx` | `Invoice` + `PaymentMilestone` | `PARTIALLY IMPLEMENTED` (`MEDIUM`) | لا يفلتر بالحالة أو العميل أو التاريخ، ولا يحسب المتبقي/المتأخر رسمياً، ولا يوفر تصدير CSV/Excel. |
| **5. فاتورة PDF ثنائية اللغة (`Invoice PDF`)** | `GET /api/v1/exports/invoices/{id}/pdf` (`phase6_ops.py:130`, `import_export_service.py:141-184`) | `Invoice` + `Tenant` + `TenantBranding` | `PARTIALLY IMPLEMENTED` (`HIGH`) | 1) لا يعرض بيانات العميل ولا رقمه الضريبي (`ClientProfile.tax_id`) ولا تفاصيل البنود (القاعة، الضيافة، الإضافات) ولا الأقساط المدفوعة والمتبقية؛<br>2) يفتقر إلى فحص ملكية العميل؛<br>3) يعيد HTML خاماً عند تعطل WeasyPrint. |
| **6. أرصدة العملاء في لوحة التحكم (`Clients Balances`)** | `GET /api/v1/tenant/clients` (`tenant_settings.py:474-535`) | `Event` + `Invoice` + `PaymentMilestone` | `PARTIALLY IMPLEMENTED` (`HIGH`) | يحسب `outstanding_balance` من `Invoice - paid_milestones` دون ربط بحساب `1100` في الأستاذ العام ودون استبعاد الفواتير الملغاة. |

---

## 2. التقارير والقوائم المالية المفقودة بالكامل / Completely Missing Financial Statements & Reports

| التقرير المفقود | الأهمية المحاسبية / المعيارية |
|---|---|
| **قائمة المركز المالي (`Balance Sheet / Statement of Financial Position`)** | إلزامي بموجب IAS 1 لعرض الأصول والالتزامات وحقوق الملكية بتاريخ محدد. |
| **قائمة الدخل الشاملة للشركة (`Company Income Statement / P&L`)** | إلزامي بموجب IAS 1 لعرض إجمالي إيرادات وتكاليف المنشأة خلال فترة. |
| **قائمة التدفقات النقدية (`Cash Flow Statement`)** | إلزامي بموجب IAS 7 (الأنشطة التشغيلية، الاستثمارية، التمويلية). |
| **قائمة التغير في حقوق الملكية (`Statement of Changes in Equity`)** | إلزامي بموجب IAS 1 (والنظام لا يحتوي أصلاً على حسابات حقوق ملكية `3xxx`!). |
| **الإيضاحات المتممة والقوائم المقارنة (`Notes & Comparative Statements`)** | إلزامي بموجب IAS 1 لعرض أرقام السنة/الفترة المقارنة. |
| **دفتر الأستاذ التفصيلي لحساب (`Account Ledger / General Ledger Detail`)** | أساسي لأي مراجعة محاسبية لتتبع الرصيد الافتتاحي والحركات والرصيد الختامي. |
| **تقرير أعمار الذمم المدينة والدائنة (`AR & AP Aging Reports`)** | أساسي لمتابعة التحصيل ومخاطر الائتمان (IFRS 9). |
| **تقارير الضرائب والإقرار الضريبي (`VAT Return / Tax Summary & Audit Report`)** | إلزامي للامتثال الضريبي ومطابقة `2200 Tax Payable`. |
| **تقارير التسوية البنكية والموقف النقدي (`Bank Reconciliation & Cash Position`)** | أساسي للرقابة على الحسابات البنكية والمحافظ اليمنية. |
| **تقرير سجل الأصول والإهلاك / الموازنة مقابل الفعلي / مراكز التكلفة** | مفقود لغياب الوحدات المغذية. |
| **تصدير Excel الحقيقي (`.xlsx`) وتقارير PDF للقوائم المالية** | يوجد CSV بترميز UTF-8 BOM فقط دون `.xlsx` متعدد الأوراق أو تنسيق قوائم مالية. |

---

## 3. تقييم الموثوقية وإمكانية التتبع (Reliability & Drill-Down)

- **النتيجة:** **غير موثوقة (`NOT RELIABLE`)**.
- **التعارض بين الجداول:** يمكن لـ `Invoice` و`tenant/clients` و`Event P&L` إظهار إيرادات بالملايين بينما يعرض `Trial Balance` إيراداً مقداره **صفر** (ورصيد ذمم عملاء **سالب**) لأن الحجوزات الحية لا تُرحّل قيد الفاتورة!
- **غياب التتبع (Drill-Down):** لا توجد روابط في الواجهة (`ledger/page.tsx`) للنقر على أي حساب في ميزان المراجعة أو أي سطر في P&L للانتقال إلى القيود اليومية أو الفواتير أو الإيصالات المصدرية.
