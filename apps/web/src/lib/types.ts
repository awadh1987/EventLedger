export type Locale = 'ar' | 'en';

export type UserType =
  | 'SUPER_ADMIN'
  | 'INTERNAL_STAFF'
  | 'CLIENT_PRIMARY'
  | 'CLIENT_DELEGATE'
  | 'EXTERNAL_VENDOR';

export type StaffRole =
  | 'OWNER'
  | 'ADMIN'
  | 'SALES_MANAGER'
  | 'SALES_REP'
  | 'SALES'
  | 'FINANCE'
  | 'OPS_MANAGER'
  | 'HEAD_CHEF'
  | 'SECURITY'
  | 'STAFF'
  | 'OTHER';

export type SubscriptionTier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type RecordLifecycle = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export interface AuthUser {
  id: string;
  tenant_id: string | null;
  tenant_slug?: string | null;
  full_name: string;
  email: string | null;
  phone: string;
  user_type: UserType;
  staff_role: StaffRole | null;
  custom_role_title?: string | null;
  permissions?: Record<string, string[]> | null;
  preferred_lang: string;
  is_2fa_enabled: boolean;
  phone_verified?: boolean;
  last_login_at?: string | null;
}

export interface BrandingTokens {
  theme_preset: string;
  surface_light: string;
  surface_dark: string;
  card_light: string;
  card_dark: string;
  border_light: string;
  border_dark: string;
  button_text_color: string;
  card_radius: string;
}

export interface TenantBrandingInfo {
  primary_color: string;
  accent_color: string;
  spotlight_color: string;
  default_theme: 'LIGHT' | 'DARK' | 'SYSTEM' | string;
  enable_spotlight: boolean;
  logo_light_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  invoice_footer_ar?: string | null;
  invoice_footer_en?: string | null;
  theme_preset?: string;
  tokens?: Partial<BrandingTokens>;
  owner_avatar_url?: string | null;
  presets?: Record<string, Record<string, string>>;
}

export interface PublicTenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  tax_rate: number;
  subscription_tier: SubscriptionTier;
  branding: TenantBrandingInfo;
}

export interface PlanInfo {
  tier: SubscriptionTier;
  name_ar: string;
  name_en: string;
  price_monthly_usd: number;
  max_halls: number;
  max_staff: number;
  features_ar: string[];
  features_en: string[];
}

export interface HallInfo {
  id: string;
  name: string;
  name_ar: string;
  capacity_banquet: number;
  capacity_theater: number;
  base_price: number;
  cleaning_buffer_minutes: number;
  combinable_with_hall_id: string | null;
  lifecycle?: RecordLifecycle;
  events_count?: number;
}

export interface MilestoneInfo {
  id: string;
  title: string;
  amount_due: number;
  due_date: string;
  paid_amount: number;
  payment_method: string | null;
  receipt_url: string | null;
  status: string;
  reviewer_remarks?: string | null;
  is_security_deposit?: boolean;
}

export interface PortalEvent {
  id: string;
  event_code: string;
  title?: string | null;
  event_type: string;
  hall_id: string;
  hall_name: string;
  hall_name_ar: string;
  start_time: string;
  end_time: string;
  status: string;
  created_at?: string;
  hold_expires_at?: string | null;
  guest_count: number;
  is_locked: boolean;
  closed_at?: string | null;
  closing_remarks?: string | null;
  security_status?: string;
  inspection?: {
    status: 'PASSED' | 'DAMAGE_CLAIMED';
    approval_status: string;
    deduction_amount: number;
    deduction_items: { category: string; description: string; amount: number; remarks?: string }[];
    notes: string | null;
    client_remarks: string | null;
    amendment_remarks: string | null;
  } | null;
  my_role: string;
  permissions: Record<string, boolean>;
  invoice: {
    id: string;
    invoice_number: string;
    subtotal: number;
    discount_percent?: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    security_deposit_amount: number;
    deposit_status: string;
    refund_voucher_number?: string | null;
    refund_payment_method?: string | null;
    status: string;
    milestones: MilestoneInfo[];
  } | null;
}

export interface SystemLookupItem {
  id: string;
  category: string;
  code: string;
  label_ar: string;
  label_en: string;
  sort_order: number;
  lifecycle: RecordLifecycle;
  usage_count?: number;
}

export interface FloorPlanElement {
  id: string;
  type: 'ROUND_TABLE' | 'RECT_TABLE' | 'STAGE' | 'DANCE_FLOOR' | 'BUFFET' | 'DJ';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  seats: number;
  label: string;
}
