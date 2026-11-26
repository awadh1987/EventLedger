import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export interface GroundingLinkRecord {
  title: string;
  uri: string;
  snippet?: string;
}

export interface InvoiceLineItem {
  id: string;
  descriptionEn: string;
  descriptionAr: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceMilestone {
  id: string;
  titleEn: string;
  titleAr: string;
  amountDue: number;
  paidAmount: number;
  dueDate: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  photoUrl: text('photo_url'),
  role: text('role').notNull().default('ERP_STAFF'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  venueName: text('venue_name').notNull(),
  ownerName: text('owner_name').notNull(),
  ownerPhone: text('owner_phone').notNull(),
  ownerEmail: text('owner_email'),
  currency: text('currency').notNull().default('YER'),
  subscriptionTier: text('subscription_tier').notNull().default('PRO'),
  ownerUid: text('owner_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tenantBranding = pgTable('tenant_branding', {
  id: text('id').primaryKey(),
  venueNameAr: text('venue_name_ar').notNull(),
  venueNameEn: text('venue_name_en').notNull(),
  taglineAr: text('tagline_ar').notNull(),
  taglineEn: text('tagline_en').notNull(),
  slug: text('slug').notNull(),
  customDomain: text('custom_domain').notNull().default('events.almassa.ye'),
  currency: text('currency').notNull().default('YER'),
  taxRate: integer('tax_rate').notNull().default(5),
  defaultSecurityDeposit: integer('default_security_deposit').notNull().default(150000),
  primaryColor: text('primary_color').notNull().default('#D4AF37'),
  accentColor: text('accent_color').notNull().default('#0F172A'),
  defaultTheme: text('default_theme').notNull().default('DARK'),
  enableSpotlight: boolean('enable_spotlight').notNull().default(true),
  spotlightColor: text('spotlight_color').notNull().default('rgba(212, 175, 55, 0.18)'),
  logoLightUrl: text('logo_light_url'),
  logoDarkUrl: text('logo_dark_url'),
  contactPhone: text('contact_phone').notNull().default('+967 770 000 001'),
  contactEmail: text('contact_email').notNull().default('concierge@almassa.ye'),
  addressAr: text('address_ar').notNull().default('شارع حدة الرئيسي — صنعاء، الجمهورية اليمنية'),
  addressEn: text('address_en').notNull().default('Hadda Main Boulevard — Sanaa, Republic of Yemen'),
  invoiceFooterAr: text('invoice_footer_ar')
    .notNull()
    .default('تُعد هذه الفاتورة مستنداً مالياً معتمداً من قصر الماسة للمؤتمرات والأفراح. يُرد مبلغ التأمين خلال 48 ساعة بعد معاينة القاعة.'),
  invoiceFooterEn: text('invoice_footer_en')
    .notNull()
    .default('Official financial invoice issued by Al-Massa Grand Palace. Security deposits are refunded within 48 hours after post-event inspection.'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const halls = pgTable('halls', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  capacityBanquet: integer('capacity_banquet').notNull(),
  capacityTheater: integer('capacity_theater').notNull(),
  basePrice: integer('base_price').notNull(),
  cleaningBufferMinutes: integer('cleaning_buffer_minutes').notNull().default(120),
});

export const inventoryItems = pgTable('inventory_items', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  category: text('category').notNull(),
  totalStock: integer('total_stock').notNull().default(0),
  unitAddonPrice: integer('unit_addon_price').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const cateringMenus = pgTable('catering_menus', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  descriptionEn: text('description_en').notNull().default(''),
  descriptionAr: text('description_ar').notNull().default(''),
  pricePerGuest: integer('price_per_guest').notNull(),
  costPerGuest: integer('cost_per_guest').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const paymentMethods = pgTable('payment_methods', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  providerType: text('provider_type').notNull(),
  accountName: text('account_name').notNull(),
  accountNumber: text('account_number').notNull(),
  instructionsEn: text('instructions_en').notNull().default(''),
  instructionsAr: text('instructions_ar').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  eventCode: text('event_code').notNull().unique(),
  hallId: text('hall_id')
    .references(() => halls.id)
    .notNull(),
  titleEn: text('title_en').notNull(),
  titleAr: text('title_ar').notNull(),
  eventType: text('event_type').notNull(),
  clientNameEn: text('client_name_en').notNull(),
  clientNameAr: text('client_name_ar').notNull(),
  clientPhone: text('client_phone').notNull(),
  assignedSalesEn: text('assigned_sales_en').notNull(),
  assignedSalesAr: text('assigned_sales_ar').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  cleaningBufferMinutes: integer('cleaning_buffer_minutes').notNull().default(120),
  status: text('status').notNull().default('HOLD_48H'),
  guestCount: integer('guest_count').notNull(),
  totalAmount: integer('total_amount').notNull(),
  paidAmount: integer('paid_amount').notNull().default(0),
  currency: text('currency').notNull().default('YER'),
  notesEn: text('notes_en').notNull().default(''),
  notesAr: text('notes_ar').notNull().default(''),
  createdByUid: text('created_by_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull().unique(),
  eventId: text('event_id')
    .references(() => events.id)
    .notNull(),
  eventCode: text('event_code').notNull(),
  clientNameEn: text('client_name_en').notNull(),
  clientNameAr: text('client_name_ar').notNull(),
  clientPhone: text('client_phone').notNull(),
  subtotal: integer('subtotal').notNull(),
  discountAmount: integer('discount_amount').notNull().default(0),
  taxRate: integer('tax_rate').notNull().default(5),
  taxAmount: integer('tax_amount').notNull().default(0),
  totalAmount: integer('total_amount').notNull(),
  paidAmount: integer('paid_amount').notNull().default(0),
  securityDepositAmount: integer('security_deposit_amount').notNull().default(150000),
  depositStatus: text('deposit_status').notNull().default('UNPAID'),
  currency: text('currency').notNull().default('YER'),
  status: text('status').notNull().default('ISSUED'),
  lineItems: jsonb('line_items').$type<InvoiceLineItem[]>().notNull(),
  milestones: jsonb('milestones').$type<InvoiceMilestone[]>().notNull(),
  issuedAt: text('issued_at').notNull(),
  dueDate: text('due_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const clientProfiles = pgTable('client_profiles', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull()
    .unique(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  preferredLang: text('preferred_lang').notNull().default('ar'),
  is2faEnabled: boolean('is_2fa_enabled').notNull().default(false),
  clientCategory: text('client_category').notNull().default('INDIVIDUAL_B2C'),
  nationalIdOrCr: text('national_id_or_cr').notNull().default(''),
  taxId: text('tax_id').notNull().default(''),
  companyName: text('company_name').notNull().default(''),
  billingAddress: text('billing_address').notNull().default(''),
  refundMethod: text('refund_method').notNull().default('KURAIMI_BANK'),
  refundAccountNumber: text('refund_account_number').notNull().default(''),
  refundAccountHolder: text('refund_account_holder').notNull().default(''),
  vipTier: text('vip_tier').notNull().default('STANDARD'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const eventDelegates = pgTable('event_delegates', {
  id: text('id').primaryKey(),
  eventId: text('event_id')
    .references(() => events.id)
    .notNull(),
  eventCode: text('event_code').notNull(),
  delegateName: text('delegate_name').notNull(),
  delegatePhone: text('delegate_phone').notNull(),
  delegateEmail: text('delegate_email').notNull().default(''),
  delegateRole: text('delegate_role').notNull().default('WEDDING_PLANNER'),
  canViewFinance: boolean('can_view_finance').notNull().default(false),
  canEditFloorplan: boolean('can_edit_floorplan').notNull().default(true),
  canRequestAddons: boolean('can_request_addons').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const approvalDrafts = pgTable('approval_drafts', {
  id: text('id').primaryKey(),
  eventId: text('event_id')
    .references(() => events.id)
    .notNull(),
  eventCode: text('event_code').notNull(),
  draftType: text('draft_type').notNull(),
  titleEn: text('title_en').notNull(),
  titleAr: text('title_ar').notNull(),
  requestedByName: text('requested_by_name').notNull(),
  financialDelta: integer('financial_delta').notNull().default(0),
  currency: text('currency').notNull().default('YER'),
  status: text('status').notNull().default('PENDING'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gatePasses = pgTable('gate_passes', {
  id: text('id').primaryKey(),
  eventId: text('event_id')
    .references(() => events.id)
    .notNull(),
  eventCode: text('event_code').notNull(),
  passType: text('pass_type').notNull().default('VIP_PASS'),
  holderName: text('holder_name').notNull(),
  holderIdNumber: text('holder_id_number').notNull().default(''),
  qrToken: text('qr_token').notNull().unique(),
  isCheckedIn: boolean('is_checked_in').notNull().default(false),
  checkedInAt: text('checked_in_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid'),
  actorName: text('actor_name').notNull(),
  eventCode: text('event_code'),
  action: text('action').notNull(),
  details: jsonb('details').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  role: text('role').notNull(),
  model: text('model').notNull(),
  content: text('content').notNull(),
  groundingLinks: jsonb('grounding_links').$type<GroundingLinkRecord[] | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  tenants: many(tenants),
  events: many(events),
  chatMessages: many(chatMessages),
  clientProfile: one(clientProfiles, {
    fields: [users.uid],
    references: [clientProfiles.userUid],
  }),
}));

export const hallsRelations = relations(halls, ({ many }) => ({
  events: many(events),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  hall: one(halls, {
    fields: [events.hallId],
    references: [halls.id],
  }),
  creator: one(users, {
    fields: [events.createdByUid],
    references: [users.uid],
  }),
  invoices: many(invoices),
  delegates: many(eventDelegates),
  approvals: many(approvalDrafts),
  gatePasses: many(gatePasses),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  event: one(events, {
    fields: [invoices.eventId],
    references: [events.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  user: one(users, {
    fields: [chatMessages.userUid],
    references: [users.uid],
  }),
}));
