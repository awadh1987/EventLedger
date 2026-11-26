# EventLedger FastAPI — HTTP Contract (v1)

Base URL: `${API_ORIGIN}` (default `http://localhost:8000`). All JSON. IDs are UUID strings, money values are JSON numbers, datetimes are ISO-8601 (naive UTC).

## Conventions
- **Tenant resolution** (server side, `TenantResolverMiddleware`): `{slug}.<ROOT_DOMAIN>` host → `Tenant.custom_domain` host → `X-Tenant-Slug` header (native apps / localhost dev). The web client MUST send `X-Tenant-Slug: <slug>` whenever it knows the slug (derived from hostname, native workspace config, or `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` on localhost).
- **Auth**: `Authorization: Bearer <access_token>`. Token claims: `sub, tenant_id, user_type, staff_role, exp`. A token is only valid on its own tenant (403 otherwise).
- The server NEVER accepts `tenant_id` or actor ids (`created_by_id`, `sender_id`, `approver_id`…) from bodies — they come from the token.
- Errors: `{ "detail": string | object }` with 400/401/403/404/409/422.
- Enums
  - `user_type`: `SUPER_ADMIN | INTERNAL_STAFF | CLIENT_PRIMARY | CLIENT_DELEGATE | EXTERNAL_VENDOR`
  - `staff_role`: `OWNER | SALES_MANAGER | SALES_REP | FINANCE | OPS_MANAGER | HEAD_CHEF | SECURITY`
  - `client_category`: `INDIVIDUAL_B2C | CORPORATE_B2B`; `delegate_role`: `CO_HOST | WEDDING_PLANNER | VENDOR`
  - `event status`: `INQUIRY | HOLD_48H | CONTRACT_PENDING | CONFIRMED | COMPLETED | CANCELLED`
  - `draft_type`: `PACKAGE_QUOTE | FLOOR_PLAN | CATERING_MENU | TIMELINE_BEO | ADDON_REQUEST`
  - `draft status`: `DRAFT | PENDING_CLIENT_APPROVAL | PENDING_INTERNAL_APPROVAL | APPROVED_SYNCED | REJECTED`
  - `lifecycle`: `DRAFT | ACTIVE | ARCHIVED | DELETED`; `tier`: `BASIC | PRO | ENTERPRISE`
  - `refund method`: `KURAIMI | JAIB | JAWALI | ONECASH | IBAN`

## Health
- `GET /health` → `{status:"ok", service, database:"ok"|"unavailable"}`

## Public (no auth)
- `GET /api/v1/public/plans` → `[{tier, name_ar, name_en, price_monthly_usd, max_halls, max_staff, features_ar[], features_en[]}]`
- `POST /api/v1/public/tenants/register` body `{venue_name, slug, owner_name, owner_phone, owner_email?, owner_password (min 8), currency="YER", subscription_tier="PRO", preferred_lang="ar"}` → `{tenant_id, slug, workspace_url, owner_id, access_token}` (409 slug taken, 400 reserved/invalid)
- `GET /api/v1/public/tenants/check-slug?slug=` → `{slug, available}`
- `GET /api/v1/public/tenant` (tenant required) → `{id, name, slug, currency, tax_rate, subscription_tier, branding:{primary_color, accent_color, spotlight_color, default_theme, enable_spotlight, logo_light_url, logo_dark_url, favicon_url}}`
- `GET /api/v1/public/halls` → `[{id, name, name_ar, capacity_banquet, capacity_theater, base_price, cleaning_buffer_minutes, combinable_with_hall_id}]`
- `GET /api/v1/public/halls/availability?hall_id&start_time&end_time` → `{availability:{available, checked_hall_ids[], conflicts:[{event_id,event_code,status}]}, quote:{base_price, effective_multiplier, applied_rules[], subtotal, tax_amount, total_amount, security_deposit_amount, currency}}`

## Auth
- `POST /api/v1/auth/login` `{identifier (phone|email), password}` → if user has 2FA: `{status:"OTP_REQUIRED", challenge_id, expires_in_seconds, dev_otp?}` else `{status:"OK", access_token, token_type:"bearer", user}`
- `POST /api/v1/auth/otp-request` `{identifier, password?}` → `{status:"OTP_SENT", challenge_id, expires_in_seconds, dev_otp?}` (`dev_otp` only when `DEBUG=true`)
- `POST /api/v1/auth/otp-login` `{identifier, otp_code}` → `{status:"OK", access_token, token_type, user}`
- `GET /api/v1/auth/me` → `user` = `{id, tenant_id, full_name, email, phone, user_type, staff_role|null, preferred_lang, is_2fa_enabled}`

## Client portal (auth: any tenant user)
- `GET /api/v1/portal/me` → `{user, profile:{client_category, national_id_or_cr, tax_id, company_name, billing_address, refund_bank_details:{method, account_name, account_number, iban?}|null, vip_tier}|null}`
- `PATCH /api/v1/portal/profile` body any of `{full_name, preferred_lang, is_2fa_enabled, client_category, national_id_or_cr, tax_id, company_name, billing_address, refund_bank_details}` → `{status:"UPDATED"}`
- `GET /api/v1/portal/events` → `[{id, event_code, event_type, hall_id, hall_name, hall_name_ar, start_time, end_time, status, guest_count, is_locked, my_role:"PRIMARY"|delegate_role, permissions, invoice:{id, invoice_number, subtotal, discount_amount, tax_amount, total_amount, security_deposit_amount, deposit_status, status, milestones:[{id, title, amount_due, due_date, paid_amount, payment_method, receipt_url, status}]}|null}]` (finance stripped for delegates without `canViewFinance`)
- `GET /api/v1/portal/events/{event_id}/delegates` → `[{id, user_id, full_name, phone, email, delegate_role, permissions:{canViewFinance, canEditFloorplan, canRequestAddons, canChat}}]`
- `POST /api/v1/portal/events/{event_id}/delegates` `{full_name, phone, email?, delegate_role, permissions}` (creates/links delegate user in same tenant) → `{status:"SAVED", delegate_id}`
- `DELETE /api/v1/portal/events/{event_id}/delegates/{delegate_id}` → `{status:"REMOVED"}`
- `GET /api/v1/portal/audit-logs?event_id=` → `[{id, action, actor_name, event_id, old_value, new_value, created_at}]` (clients see only their events' logs; staff see tenant)
- `POST /api/v1/portal/milestones/{milestone_id}/receipt` multipart `file` → `{status:"UNDER_REVIEW", receipt_url}`
- `GET /api/v1/portal/payment-accounts` → `[{method, label_ar, label_en, account_name, account_number}]` (tenant settings — for one-tap copy)

## Bookings & availability
- `POST /api/v1/bookings/hold` `{hall_id, event_type, start_time, end_time, guest_count, addon_amount=0, client_id? (staff only; clients book for themselves)}` → `{event_id, event_code, status:"HOLD_48H", hold_expires_at, quote}` (409 with conflicts)
- `GET /api/v1/bookings/events?status=&from=&to=` (staff) → `[{id, event_code, event_type, hall_id, hall_name, hall_name_ar, client_name, start_time, end_time, status, guest_count, total_amount}]`
- `POST /api/v1/bookings/events/{event_id}/status` (staff) `{status}` → `{status}`

## Drafts & approvals
- `POST /api/v1/events/{event_id}/drafts` `{draft_type, payload, financial_delta=0}` → `{draft_id, version_number, status}`
  - FLOOR_PLAN payload: `{elements:[{id, type:"ROUND_TABLE"|"RECT_TABLE"|"STAGE"|"DANCE_FLOOR"|"BUFFET"|"DJ", x, y, width, height, rotation, seats, label}], totalSeatedGuests}`
- `GET /api/v1/events/{event_id}/drafts` → `[{id, version_number, draft_type, payload, financial_delta, status, created_at, created_by_name}]`
- `POST /api/v1/drafts/{draft_id}/submit` → `{approval_id, required_approver_role, draft_status}` (403 when inside lockout window for non-staff)
- `GET /api/v1/approvals?status=PENDING` → `[{id, event_id, event_code, draft_id, draft_type, financial_delta, required_approver_role, status, requested_by_name, created_at, payload}]` (clients: only CLIENT_PRIMARY gates on their events; staff: OPS gates)
- `POST /api/v1/approvals/{approval_id}/resolve` `{decision:"APPROVED"|"REJECTED", rejection_reason?}` → `{status:"APPROVED_SYNCED"|"FORWARDED_TO_OPS"|"REJECTED", ...}`

## Finance (staff: OWNER/FINANCE for writes)
- `GET /api/v1/finance/accounts` → `[{id, code, name_ar, name_en, account_type, is_system, lifecycle}]`
- `POST /api/v1/finance/accounts` `{code, name_ar, name_en, account_type}`
- `GET /api/v1/finance/journal-entries?limit=50` → `[{id, entry_number, entry_date, reference, description, event_id, status, total_debit, total_credit, lines:[{account_id, account_code, account_name_ar, account_name_en, debit, credit, memo}]}]`
- `POST /api/v1/finance/journal-entries` `{reference, description, event_id?, lines:[{account_id, debit, credit, memo?}]}` (400 if unbalanced)
- `GET /api/v1/finance/trial-balance` → `{rows:[{account_id, code, name_ar, name_en, account_type, total_debit, total_credit, balance}], total_debit, total_credit, is_balanced}`
- `GET /api/v1/finance/invoices` → `[{id, invoice_number, event_id, event_code, client_name, total_amount, paid_amount, security_deposit_amount, deposit_status, status, milestones:[...]}]`
- `POST /api/v1/finance/milestones/{milestone_id}/verify` `{payment_method, is_security_deposit=false}` → `{status:"PAID", journal_entry_id}` (deposits → 2100)
- `GET /api/v1/finance/events/{event_id}/pnl` → `{event_id, event_code, gross_revenue, discounts, net_revenue, catering_cogs, expenses:[{category, description, amount}], total_expenses, net_profit, margin_percent, security_deposit_held}`

## Import / export
- `POST /api/v1/import/{accounts|inventory|guests}` multipart `file` (+ `event_id` form field for guests) → `{entity_type, imported_rows, skipped_rows, errors:[{row, error}]}`; CSV decoded with `utf-8-sig`
  - accounts headers: `code,name_ar,name_en,account_type`; inventory: `name,category,total_stock,unit_addon_price`; guests: `holder_name,holder_id_number,pass_type`
- `GET /api/v1/exports/{accounts|trial-balance|journal|guests}.csv?event_id=` → `text/csv` with UTF-8 BOM
- `GET /api/v1/exports/invoices/{invoice_id}/pdf?locale=ar|en` → `application/pdf`
- `GET /api/v1/exports/events/{event_id}/beo.pdf?locale=ar|en` → `application/pdf`

## Comms & ops
- `GET /api/v1/events/{event_id}/messages` → `[{id, sender_id, sender_name, channel:"IN_APP"|"WHATSAPP", department, mentions[], content, is_internal, created_at}]` (`is_internal` hidden from clients)
- `POST /api/v1/events/{event_id}/messages` `{content, is_internal=false}` — `@Kitchen @Finance @Ops @Security @Sales` tags are parsed server-side → `{id, status:"SENT", mentions[]}`
- `GET /api/v1/webhooks/whatsapp` (hub.challenge verification) / `POST /api/v1/webhooks/whatsapp`
- `GET /api/v1/ops/beo?date=` (staff) → `{orders:[{event_id, event_code, event_type, hall_name, hall_name_ar, start_time, end_time, guest_count, status, floor_plan:{...}|null, catering:{...}|null, timeline:[...], inventory:[{item_name, quantity}], internal_notes:[...]}]}`

## Tenant settings (staff OWNER for writes)
- `GET /api/v1/tenant/branding` / `PUT /api/v1/tenant/branding` `{primary_color, accent_color, spotlight_color, default_theme:"LIGHT"|"DARK"|"SYSTEM", enable_spotlight, logo_light_url, logo_dark_url, favicon_url, invoice_footer_ar, invoice_footer_en}`
- `GET /api/v1/lookups?category=` → `[{id, category, code, label_ar, label_en, sort_order, lifecycle}]` (ACTIVE only unless `include_inactive=true`)
- `POST /api/v1/lookups` `{category, code, label_ar, label_en, sort_order}`; `PATCH /api/v1/lookups/{id}` `{label_ar?, label_en?, sort_order?, lifecycle?}`
  - seeded categories: `EVENT_TYPE, INVENTORY_CATEGORY, EXPENSE_CATEGORY, PAYMENT_METHOD, REFUND_METHOD, GATE_PASS_TYPE, DEPARTMENT`
- `GET /api/v1/venue/halls`, `GET /api/v1/venue/inventory`, `GET /api/v1/venue/pricing-rules`

## Super admin (host `admin.*`, user_type SUPER_ADMIN)
- `GET /api/v1/admin/tenants` → `[{id, name, slug, custom_domain, subscription_tier, is_active, created_at, users_count, events_count}]`
- `PATCH /api/v1/admin/tenants/{id}` `{is_active?, subscription_tier?, custom_domain?}`

## Gate & offline sync (native apps send `X-Tenant-Slug`)
- `POST /api/v1/gate/check-in` `{qr_token}` (staff SECURITY/OPS/OWNER) → `{result:"ADMITTED"|"ALREADY_CHECKED_IN"|"INVALID"|"OUTSIDE_WINDOW", holder_name, pass_type, event_code, checked_in_at}`
- `GET /api/v1/sync/manifest` → `{tenant_slug, synced_at, events[], gate_passes[]}`
- `POST /api/v1/sync/batch` `{device_id, mutations:[{mutation_id, action_type:"GATE_QR_CHECKIN", payload:{qr_token}, recorded_at}]}` → `{status:"SYNCED", processed_ids[], results:[{mutation_id, result}]}`

## Seed accounts (tenant `almassa`, send `X-Tenant-Slug: almassa`)
| Role | Identifier | Password |
|---|---|---|
| OWNER | owner@almassa.eventledger.local | Almassa@2026 |
| FINANCE | finance@almassa.eventledger.local | Finance@2026 |
| OPS_MANAGER | ops@almassa.eventledger.local | Ops@2026 |
| SECURITY | gate@almassa.eventledger.local | Gate@2026 |
| CLIENT_PRIMARY | ahmed@client.local | Client@2026 |
| CLIENT_DELEGATE (planner) | layla.planner@studio.local | Planner@2026 |
| SUPER_ADMIN (no tenant) | admin@eventledger.cloud | SuperAdmin@2026 |
