export type Locale = 'ar' | 'en';

export type UserType =
  | 'SUPER_ADMIN'
  | 'INTERNAL_STAFF'
  | 'CLIENT_PRIMARY'
  | 'CLIENT_DELEGATE'
  | 'EXTERNAL_VENDOR';

export type StaffRole =
  | 'OWNER'
  | 'SALES_MANAGER'
  | 'SALES_REP'
  | 'FINANCE'
  | 'OPS_MANAGER'
  | 'HEAD_CHEF'
  | 'SECURITY';

export type SubscriptionTier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type RecordLifecycle = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export interface AuthUser {
  id: string;
  tenant_id: string | null;
  full_name: string;
  email: string | null;
  phone: string;
  user_type: UserType;
  staff_role: StaffRole | null;
  preferred_lang: string;
  is_2fa_enabled: boolean;
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
  is_security_deposit?: boolean;
}

export interface PortalEvent {
  id: string;
  event_code: string;
  event_type: string;
  hall_id: string;
  hall_name: string;
  hall_name_ar: string;
  start_time: string;
  end_time: string;
  status: string;
  guest_count: number;
  is_locked: boolean;
  my_role: string;
  permissions: Record<string, boolean>;
  invoice: {
    id: string;
    invoice_number: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    security_deposit_amount: number;
    deposit_status: string;
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
