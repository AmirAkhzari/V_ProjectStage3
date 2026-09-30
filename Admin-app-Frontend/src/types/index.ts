// Superset of ../FrontEnd/src/types/index.ts — keep client-shared shapes in sync.

/* ---------- Shared with client ---------- */

export type AddressTag = "store" | "warehouse" | "branch";

/** Client-facing status (what the retailer PWA shows). */
export type ClientOrderStatus = "current" | "delivered" | "cancelled";

/** Admin-side status pipeline. Maps to ClientOrderStatus via lib/orderStatus. */
export type OrderStatus = "pending" | "confirmed" | "packing" | "shipped" | "delivered" | "cancelled";

export type PaymentKind = "order" | "wallet" | "subscription";
export type PaymentMethod = "wallet" | "gateway";
export type PaymentStatus = "success" | "failed" | "pending";

/** Retailer marketplace tier. Unrelated to `Distributor.pro` (delivery-priority badge). */
export type RetailerPlan = "free" | "pro";
export type SubscriptionStatus = "active" | "expired" | "cancelled";
export type SubscriptionAction = "grant" | "extend" | "revoke";

export type RetailerSubscription = {
  id: string;
  retailerId: string;
  plan: RetailerPlan;
  status: SubscriptionStatus;
  startsAt: string;
  expiresAt: string;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionListItem = RetailerSubscription & {
  retailerName: string;
  retailerPhone: string;
};

export type SubscriptionsResult = {
  items: SubscriptionListItem[];
  summary: { total: number; active: number; revenue: number };
};

export type User = {
  id: string;
  name: string;
  phone: string;
};

export type CartItem = {
  id: string;
  name: string;
  price: number;
  img: string;
  unitsPerCarton: number;
  qty: number;
};

export type Product = {
  id: string;
  name: string;
  size: string;
  price: number;
  original?: number;
  disc?: number;
  img: string;
  brand: string;
  category: string;
  subCategory: string;
  sku: string;
  unitsPerCarton: number;
  minOrderQty: number;
  active: boolean;
  createdAt: string;
  description?: string;
};

export type Distributor = {
  id: string;
  name: string;
  logoText: string;
  logoTone: "accent" | "secondary";
  status: "active" | "full";
  deliveryMins: number;
  deliveryFee: number | "free";
  priceMultiplier: number;
  cities: string[];
  rating: number;
  area?: string;
  pro?: boolean;
  minBasket: number;
  phone?: string;
  managerName?: string;
  createdAt: string;
};

export type Address = {
  id: string;
  retailerId: string;
  title: string;
  fullAddress: string;
  plaque: string;
  unit: string;
  tag: AddressTag | null;
  branchName?: string;
  city: string;
  lat: number;
  lng: number;
  streetLabel: string;
};

export type OrderItem = CartItem;

export type OrderEvent = {
  id: string;
  status: OrderStatus;
  at: string;
  actorName: string;
  note?: string;
};

export type Order = {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  deliveryDate: string;
  deliverySlot: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  distributorId: string;
  distributorName: string;
  retailerId: string;
  retailerName: string;
  retailerPhone: string;
  addressLabel: string;
  city: string;
  items: OrderItem[];
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  couponCode?: string;
  events: OrderEvent[];
  cancelReason?: string;
  /** Current (latest non-closed, or last) driver assignment. Joined by the API; never set by the client. */
  delivery?: DeliverySummary | null;
};

/* ---------- Driver & delivery — mirrored in ../Driver-FrontEnd/src/types/index.ts ---------- */

/**
 * Lifecycle of one driver assignment for one order (backend-owned).
 * The order itself only becomes `delivered` when an admin confirms an `awaiting_confirmation` delivery.
 */
export type DeliveryStatus = "assigned" | "awaiting_confirmation" | "confirmed" | "rejected" | "cancelled";
export type DeliveryClosedReason = "order_cancelled" | "reassigned" | "unassigned";

export type VehicleInfo = { type: string; plate: string };

export type Driver = {
  id: string;
  distributorId: string;
  username: string;
  name: string;
  phone: string;
  vehicle: VehicleInfo | null;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
  passwordUpdatedAt: string;
};

export type DriverTodayStats = { total: number; remaining: number; awaiting: number; confirmed: number };

export type DriverListItem = Driver & { distributorName: string; today: DriverTodayStats };

export type DriverInput = Omit<Driver, "id" | "createdAt" | "lastLoginAt" | "passwordUpdatedAt"> & {
  id?: string;
  /** Required on create; ignored on edit (use resetDriverPassword). */
  password?: string;
};

export type Delivery = {
  id: string;
  orderId: string;
  orderNumber: string;
  distributorId: string;
  driverId: string;
  driverName: string;
  sequence: number;
  status: DeliveryStatus;
  closedReason: DeliveryClosedReason | null;
  retailerName: string;
  city: string;
  addressLabel: string;
  deliveryDate: string;
  deliverySlot: string;
  cartons: number;
  orderStatus: OrderStatus;
  assignedAt: string;
  assignedByName: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  failedAttempts: number;
};

export type DeliverySummary = Pick<
  Delivery,
  "id" | "driverId" | "driverName" | "status" | "sequence" | "submittedAt" | "confirmedAt" | "rejectionReason"
>;

export type AdminNotification = {
  id: string;
  kind: "delivery_verified";
  distributorId: string;
  deliveryId: string;
  orderId: string;
  orderNumber: string;
  retailerName: string;
  driverName: string;
  at: string;
  readAt: string | null;
};

export type WalletTransaction = {
  id: string;
  amount: number;
  createdAt: string;
  status: "success" | "failed";
  kind: "topup" | "adjustment" | "order";
  note?: string;
};

export type City = {
  name: string;
  province: string;
  lat: number;
  lng: number;
};

/* ---------- Admin-only ---------- */

export type Retailer = User & {
  city: string;
  status: "active" | "blocked";
  createdAt: string;
  lastOrderAt?: string;
  walletBalance: number;
  primaryDistributorId: string | null;
  primaryDistributorName?: string | null;
  primaryDistributor?: { id: string; name: string } | null;
  plan: RetailerPlan;
  subscriptionExpiresAt?: string | null;
  subscriptions?: RetailerSubscription[];
};

export type StockEntry = {
  distributorId: string;
  productId: string;
  available: boolean;
  priceOverride?: number;
  cartonsLeft: number;
};

export type CouponKind = "percent" | "fixed";

export type Coupon = {
  id: string;
  code: string;
  title: string;
  kind: CouponKind;
  value: number;
  minTotal?: number;
  distributorId?: string;
  expiresAt: string;
  usedCount: number;
  maxUses?: number;
  active: boolean;
};

export type Banner = {
  id: string;
  title: string;
  subtitle: string;
  cta: string;
  active: boolean;
  order: number;
};

export type MessageKind = "order" | "promo" | "stock";
export type MessageAudience =
  | { type: "all" }
  | {
      type: "city";
      city: string;
    }
  | { type: "distributor"; distributorId: string };

export type Message = {
  id: string;
  title: string;
  body: string;
  kind: MessageKind;
  audience: MessageAudience;
  sentAt: string;
  recipients: number;
};

export type Payment = {
  id: string;
  kind: PaymentKind;
  retailerId: string;
  retailerName: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: string;
  orderNumber?: string;
  distributorId?: string;
};

export type WalletAccount = {
  retailerId: string;
  retailerName: string;
  phone: string;
  balance: number;
  transactions: WalletTransaction[];
};

/** Weekday index: 0 = شنبه … 6 = جمعه. Values are enabled "HH:MM" slots. */
export type DeliverySlotConfig = {
  distributorId: string;
  days: Record<number, string[]>;
  holidays: string[];
};

export type Role = "super_admin" | "distributor_admin";

export type Permission =
  | "dashboard.view"
  | "orders.view"
  | "orders.update"
  | "orders.cancel"
  | "products.view"
  | "products.manage"
  | "stock.view"
  | "stock.manage"
  | "distributors.view"
  | "distributors.manage"
  | "retailers.view"
  | "retailers.manage"
  | "coupons.view"
  | "coupons.manage"
  | "banners.manage"
  | "messages.send"
  | "finance.view"
  | "finance.adjust"
  | "delivery.manage"
  | "settings.manage"
  | "staff.manage"
  | "audit.view"
  | "subscriptions.manage"
  | "drivers.view"
  | "drivers.manage"
  | "deliveries.assign"
  | "deliveries.confirm";

export type Staff = {
  id: string;
  name: string;
  phone: string;
  role: Role;
  roleLabel: string;
  distributorId?: string;
  lastLoginAt?: string;
  active: boolean;
};

export type AdminSession = {
  token: string;
  staff: Staff;
  permissions: Permission[];
};

export type AuditEntry = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  entityId?: string;
};

export type PlatformSettings = {
  brandName: string;
  minOrder: number;
  walletMin: number;
  walletMax: number;
  supportPhone: string;
  proMonthlyPrice: number;
};

export type DashboardStats = {
  gmvToday: number;
  gmvYesterday: number;
  gmv7d: number;
  gmv30d: number;
  pendingOrders: number;
  activeRetailers: number;
  avgBasket: number;
  avgBasketPrev: number;
  ordersByStatus: Record<OrderStatus, number>;
  trend: { date: string; orders: number; gmv: number }[];
  topDistributors: {
    id: string;
    name: string;
    city: string;
    gmv: number;
    orders: number;
  }[];
  lowStock: {
    productId: string;
    productName: string;
    distributorId: string;
    distributorName: string;
    cartonsLeft: number;
  }[];
  recentOrders: Order[];
};

export const MIN_ORDER = 500_000;
export const WALLET_MIN = 10_000;
export const WALLET_MAX = 10_000_000;
export const PRO_MONTHLY_PRICE = 1_490_000;
export const DEMO_OTP = "12345";
