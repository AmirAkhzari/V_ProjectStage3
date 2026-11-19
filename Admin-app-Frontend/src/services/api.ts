import type {
  Address,
  AdminNotification,
  AdminSession,
  AuditEntry,
  Banner,
  City,
  Coupon,
  DashboardStats,
  Delivery,
  DeliverySlotConfig,
  DeliveryStatus,
  Distributor,
  Driver,
  DriverInput,
  DriverListItem,
  Message,
  Order,
  OrderStatus,
  Payment,
  PlatformSettings,
  Product,
  Retailer,
  RetailerPlan,
  RetailerSubscription,
  Staff,
  StockEntry,
  SubscriptionAction,
  SubscriptionStatus,
  SubscriptionsResult,
  WalletAccount,
} from "@/types";

export type ApiError = { ok: false; error: string };
export type ApiOk<T> = { ok: true; data: T };
export type ApiResult<T> = ApiOk<T> | ApiError;

export type OrderFilters = {
  query?: string;
  status?: OrderStatus | "all";
  distributorId?: string;
  city?: string;
  from?: string;
  to?: string;
};

export type Scope = { distributorId: string | null };

export type RetailerFilters = {
  plan?: RetailerPlan | "all";
};

/**
 * B33 page request. `limit`/`after` are the server cursor; the remaining fields narrow the list in
 * the mock adapter and, once the profile schema exists, on the server too.
 */
export type RetailerListQuery = RetailerFilters & {
  q?: string;
  city?: string;
  status?: Retailer["status"] | "all";
  limit?: number;
  after?: string | null;
};

export type RetailerPage = {
  items: Retailer[];
  hasMore: boolean;
  nextAfter: string | null;
};

export type SubscriptionFilters = {
  plan?: RetailerPlan | "all";
  status?: SubscriptionStatus | "all";
};

export type DeliveryFilters = {
  driverId?: string;
  orderId?: string;
  status?: DeliveryStatus | "all";
  /** "today" = deliveryDate is today; omitted = all time. */
  range?: "today" | "all";
};

/**
 * Admin API contract. Every list/read call is implicitly scoped by the active
 * distributor (DistributorAdmin: forced to own id; SuperAdmin: optional switcher).
 */
export interface AdminApi {
  // scope
  setScope(scope: Scope): void;

  // auth
  sendOtp(phone: string): Promise<ApiResult<{ phone: string }>>;
  verifyOtp(phone: string, code: string): Promise<ApiResult<AdminSession>>;
  loginDemo(role: "super_admin" | "distributor_admin"): Promise<ApiOk<AdminSession>>;
  logout(): Promise<void>;
  getSession(): AdminSession | null;

  // dashboard
  getDashboard(): Promise<DashboardStats>;

  // orders
  getOrders(filters?: OrderFilters): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  updateOrderStatus(id: string, status: OrderStatus, note?: string): Promise<ApiResult<Order>>;

  // products
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  saveProduct(product: Omit<Product, "id" | "createdAt"> & { id?: string }): Promise<Product>;
  setProductActive(id: string, active: boolean): Promise<void>;
  deleteProduct(id: string): Promise<void>;

  // stock
  getStock(): Promise<StockEntry[]>;
  updateStock(entries: Array<Pick<StockEntry, "distributorId" | "productId"> & Partial<StockEntry>>): Promise<void>;
  setPriceMultiplier(distributorId: string, multiplier: number): Promise<void>;

  // distributors
  /**
   * `all: true` ignores the active scope (used by the SuperAdmin switcher and filters). It only
   * widens a platform-scoped super admin; inside a tenant scope the scoped list is returned.
   */
  getDistributors(opts?: { all?: boolean }): Promise<Distributor[]>;
  getDistributor(id: string): Promise<Distributor | null>;
  saveDistributor(distributor: Omit<Distributor, "id" | "createdAt"> & { id?: string }): Promise<Distributor>;

  // retailers
  getRetailers(filters?: RetailerFilters): Promise<Retailer[]>;
  /** B33 paged list: `after` is the opaque `nextAfter` of the previous page. */
  getRetailersPage(filters?: RetailerListQuery): Promise<RetailerPage>;
  getRetailer(id: string): Promise<Retailer | null>;
  getRetailerAddresses(id: string): Promise<Address[]>;
  setRetailerStatus(id: string, status: Retailer["status"]): Promise<void>;
  setRetailerPrimaryDistributor(
    id: string,
    distributorId: string,
  ): Promise<ApiResult<{ primaryDistributorId: string }>>;
  setRetailerSubscription(
    id: string,
    action: SubscriptionAction,
    days?: number,
  ): Promise<ApiResult<{ plan: RetailerPlan; subscription?: RetailerSubscription }>>;
  getSubscriptions(filters?: SubscriptionFilters): Promise<SubscriptionsResult>;

  // marketing
  getCoupons(): Promise<Coupon[]>;
  saveCoupon(coupon: Omit<Coupon, "id" | "usedCount"> & { id?: string }): Promise<Coupon>;
  deleteCoupon(id: string): Promise<void>;
  getBanners(): Promise<Banner[]>;
  saveBanner(banner: Omit<Banner, "id" | "order"> & { id?: string }): Promise<Banner>;
  reorderBanners(ids: string[]): Promise<void>;
  deleteBanner(id: string): Promise<void>;
  getMessages(): Promise<Message[]>;
  sendMessage(message: Omit<Message, "id" | "sentAt" | "recipients">): Promise<Message>;

  // finance
  getPayments(): Promise<Payment[]>;
  getWallets(): Promise<WalletAccount[]>;
  adjustWallet(retailerId: string, amount: number, note: string): Promise<ApiResult<WalletAccount>>;

  // delivery
  getSlots(distributorId: string): Promise<DeliverySlotConfig>;
  saveSlots(config: DeliverySlotConfig): Promise<void>;
  getCities(): Promise<City[]>;
  saveCity(city: City): Promise<void>;
  deleteCity(name: string): Promise<void>;

  // settings
  getSettings(): Promise<PlatformSettings>;
  saveSettings(settings: PlatformSettings): Promise<void>;
  getStaff(): Promise<Staff[]>;
  saveStaff(staff: Omit<Staff, "id" | "roleLabel"> & { id?: string }): Promise<Staff>;
  getAuditLog(): Promise<AuditEntry[]>;

  // drivers (tenant-scoped: DistributorAdmin sees and edits only its own drivers)
  getDrivers(opts?: { activeOnly?: boolean; distributorId?: string }): Promise<DriverListItem[]>;
  getDriver(id: string): Promise<DriverListItem | null>;
  saveDriver(input: DriverInput): Promise<ApiResult<Driver>>;
  setDriverActive(id: string, active: boolean): Promise<ApiResult<Driver>>;
  resetDriverPassword(id: string, password: string): Promise<ApiResult<{ passwordUpdatedAt: string }>>;

  // deliveries
  getDeliveries(filters?: DeliveryFilters): Promise<Delivery[]>;
  /** `driverId: null` removes the current driver. */
  assignDriver(orderId: string, driverId: string | null): Promise<ApiResult<Order>>;
  reorderRoute(driverId: string, deliveryIds: string[]): Promise<ApiResult<void>>;
  /** Marks the driver's `packing` orders as `shipped` (existing packing → shipped transition). */
  dispatchRoute(driverId: string): Promise<ApiResult<{ shipped: number }>>;
  confirmDelivery(deliveryId: string): Promise<ApiResult<Delivery>>;
  rejectDelivery(deliveryId: string, reason: string): Promise<ApiResult<Delivery>>;

  // operational notifications
  getAdminNotifications(): Promise<AdminNotification[]>;
  markAdminNotificationsRead(ids?: string[]): Promise<void>;

  // dev
  resetDemoData(): Promise<void>;
  /** Mock only: stands in for the driver app submitting a valid code. */
  devSimulateVerification?(deliveryId: string): Promise<ApiResult<Delivery>>;
}
