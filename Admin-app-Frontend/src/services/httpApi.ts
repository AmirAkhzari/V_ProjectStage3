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
  Distributor,
  Driver,
  DriverListItem,
  Message,
  Order,
  OrderStatus,
  Payment,
  Permission,
  PlatformSettings,
  Product,
  Retailer,
  RetailerPlan,
  RetailerSubscription,
  Staff,
  StockEntry,
  SubscriptionsResult,
  WalletAccount,
} from "@/types";
import { PRO_MONTHLY_PRICE } from "@/types";
import type {
  AdminApi,
  ApiError,
  ApiOk,
  OrderFilters,
  RetailerFilters,
  RetailerListQuery,
  Scope,
  SubscriptionFilters,
} from "./api";
import { apiFetch, readBundle, writeBundle, writeScope } from "./http";
import { ROLE_LABELS } from "@/lib/permissions";

function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
function fail(error: string): ApiError {
  return { ok: false, error };
}

function persistSession(data: {
  accessToken: string;
  refreshToken: string;
  staff: AdminSession["staff"];
  permissions: Permission[];
}): AdminSession {
  const session: AdminSession = {
    token: data.accessToken,
    staff: {
      ...data.staff,
      roleLabel: data.staff.roleLabel || ROLE_LABELS[data.staff.role],
    },
    permissions: data.permissions,
  };
  writeBundle({ accessToken: data.accessToken, refreshToken: data.refreshToken, session });
  if (session.staff.role === "distributor_admin" && session.staff.distributorId) {
    writeScope(session.staff.distributorId);
  }
  return session;
}

type DistributorListPayload = Record<string, unknown>[] | { items?: Record<string, unknown>[] };
type RetailerRowsPayload = Record<string, unknown>[] | { items?: Record<string, unknown>[] };

function mapDistributor(row: Record<string, unknown>): Distributor {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    logoText: String(row.logoText ?? ""),
    logoTone: (row.logoTone as Distributor["logoTone"]) ?? "accent",
    status: row.status === "full" || row.acceptingOrders === false ? "full" : "active",
    deliveryMins: Number(row.deliveryMins ?? 45),
    deliveryFee: row.deliveryFee === "free" || row.deliveryFee === 0 ? "free" : Number(row.deliveryFee ?? 0),
    priceMultiplier: Number(row.priceMultiplier ?? 1),
    cities: (row.cities as string[]) ?? [],
    rating: Number(row.rating ?? 4.5),
    area: row.area as string | undefined,
    pro: Boolean(row.pro),
    minBasket: Number(row.minBasket ?? 500_000),
    phone: row.phone as string | undefined,
    managerName: row.managerName as string | undefined,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
  };
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    size: String(row.size ?? ""),
    price: Number(row.price ?? row.basePrice ?? 0),
    original: row.original != null ? Number(row.original) : undefined,
    disc: row.disc != null ? Number(row.disc) : undefined,
    img: String(row.img ?? ""),
    brand: String(row.brand ?? ""),
    category: String(row.category ?? ""),
    subCategory: String(row.subCategory ?? row.category ?? ""),
    sku: String(row.sku ?? ""),
    unitsPerCarton: Number(row.unitsPerCarton ?? 1),
    minOrderQty: Number(row.minOrderQty ?? 1),
    active: row.active !== false,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    description: row.description as string | undefined,
  };
}

function mapOrder(row: Record<string, unknown>): Order {
  const status = (row.status === "awaiting_payment" ? "pending" : row.status) as OrderStatus;
  return {
    id: String(row.id),
    number: String(row.number ?? ""),
    status,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    deliveryDate: String(row.deliveryDate ?? ""),
    deliverySlot: String(row.deliverySlot ?? ""),
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    deliveryFee: Number(row.deliveryFee ?? 0),
    total: Number(row.total ?? 0),
    distributorId: String(row.distributorId ?? ""),
    distributorName: String(row.distributorName ?? ""),
    retailerId: String(row.retailerId ?? ""),
    retailerName: String(row.retailerName ?? ""),
    retailerPhone: String(row.retailerPhone ?? ""),
    addressLabel: String(row.addressLabel ?? ""),
    city: String(row.city ?? ""),
    items: (Array.isArray(row.items) ? row.items : []) as Order["items"],
    paymentMethod: (row.paymentMethod as Order["paymentMethod"]) ?? "gateway",
    paymentStatus: (row.paymentStatus as Order["paymentStatus"]) ?? "pending",
    couponCode: row.couponCode as string | undefined,
    events: (Array.isArray(row.events) ? row.events : []) as Order["events"],
    cancelReason: row.cancelReason as string | undefined,
  };
}

function mapBanner(row: Record<string, unknown>): Banner {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    subtitle: String(row.subtitle ?? ""),
    cta: String(row.cta ?? row.ctaLabel ?? ""),
    active: row.active !== false,
    order: Number(row.order ?? row.sort ?? 0),
  };
}

function mapCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    title: String(row.title ?? ""),
    kind: (row.kind as Coupon["kind"]) ?? "percent",
    value: Number(row.value ?? 0),
    minTotal: row.minTotal != null ? Number(row.minTotal) : undefined,
    distributorId: row.distributorId as string | undefined,
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : new Date(row.expiresAt as string).toISOString(),
    usedCount: Number(row.usedCount ?? 0),
    maxUses: row.maxUses != null ? Number(row.maxUses) : undefined,
    active: row.active !== false,
  };
}

function mapCity(row: Record<string, unknown>): City {
  return {
    name: String(row.name ?? ""),
    province: String(row.province ?? ""),
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
  };
}

function mapRetailer(row: Record<string, unknown>): Retailer {
  // `customers.shopkeepers` stores no name, city, plan or wallet yet, so B33 answers only what
  // exists; the missing columns fall back to the phone and to the free plan.
  return {
    id: String(row.id),
    name: String(row.name ?? row.phone ?? ""),
    phone: String(row.phone ?? ""),
    city: String(row.city ?? ""),
    status: row.status === "blocked" ? "blocked" : "active",
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    walletBalance: Number(row.walletBalance ?? 0),
    primaryDistributorId: (row.primaryDistributorId as string | null) ?? null,
    primaryDistributorName: (row.primaryDistributorName as string | null) ?? null,
    plan: (row.plan as RetailerPlan) ?? "free",
  };
}

function mapStaff(row: Record<string, unknown>): Staff {
  const role = (row.role as Staff["role"]) ?? "distributor_admin";
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    role,
    roleLabel: String(row.roleLabel ?? ROLE_LABELS[role]),
    distributorId: row.distributorId as string | undefined,
    lastLoginAt: row.lastLoginAt as string | undefined,
    active: row.active !== false,
  };
}

export const httpApi: AdminApi = {
  setScope(scope: Scope) {
    writeScope(scope.distributorId);
  },

  async sendOtp(phone) {
    try {
      return ok(await apiFetch<{ phone: string }>("/admin/auth/otp/send", { method: "POST", json: { phone } }));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "ارسال کد ناموفق بود");
    }
  },

  async verifyOtp(phone, code) {
    try {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        staff: AdminSession["staff"];
        permissions: Permission[];
      }>("/admin/auth/otp/verify", { method: "POST", json: { phone, code } });
      return ok(persistSession(data));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "کد تایید نادرست است");
    }
  },

  async loginDemo(role) {
    const data = await apiFetch<{
      accessToken: string;
      refreshToken: string;
      staff: AdminSession["staff"];
      permissions: Permission[];
    }>("/admin/auth/demo", { method: "POST", json: { role } });
    return ok(persistSession(data));
  },

  async logout() {
    const bundle = readBundle();
    try {
      if (bundle?.refreshToken) {
        await apiFetch("/admin/auth/logout", { method: "POST", json: { refreshToken: bundle.refreshToken } });
      }
    } catch {
      /* ignore */
    }
    writeBundle(null);
  },

  getSession() {
    return (readBundle()?.session as AdminSession | undefined) ?? null;
  },

  async getDashboard() {
    const row = await apiFetch<DashboardStats>("/admin/dashboard");
    return {
      ...row,
      recentOrders: (row.recentOrders ?? []).map((o) => mapOrder(o as unknown as Record<string, unknown>)),
    };
  },

  async getOrders(filters: OrderFilters = {}) {
    const qs = new URLSearchParams();
    if (filters.query) qs.set("q", filters.query);
    if (filters.status && filters.status !== "all") qs.set("status", filters.status);
    if (filters.distributorId) qs.set("distributorId", filters.distributorId);
    if (filters.city) qs.set("city", filters.city);
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    const rows = await apiFetch<Record<string, unknown>[]>(`/admin/orders?${qs}`);
    return rows.map(mapOrder);
  },

  async getOrder(id) {
    try {
      return mapOrder(await apiFetch<Record<string, unknown>>(`/admin/orders/${id}`));
    } catch {
      return null;
    }
  },

  async updateOrderStatus(id, status, note) {
    try {
      const res = await apiFetch<{ ok?: boolean; data?: Record<string, unknown>; error?: string }>(
        `/admin/orders/${id}/transition`,
        {
          method: "POST",
          json: { status, note },
        },
      );
      const row = res.data ?? (res as unknown as Record<string, unknown>);
      return ok(mapOrder(row));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "تغییر وضعیت ناموفق بود");
    }
  },

  async getProducts() {
    const rows = await apiFetch<Record<string, unknown>[]>("/admin/products");
    return rows.map(mapProduct);
  },

  async getProduct(id) {
    try {
      return mapProduct(await apiFetch<Record<string, unknown>>(`/admin/products/${id}`));
    } catch {
      return null;
    }
  },

  async saveProduct(product) {
    const body = {
      ...product,
      category: product.category,
      price: product.price,
      original: product.original,
      img: product.img,
    };
    const row = product.id
      ? await apiFetch<Record<string, unknown>>(`/admin/products/${product.id}`, { method: "PUT", json: body })
      : await apiFetch<Record<string, unknown>>("/admin/products", { method: "POST", json: body });
    return mapProduct(row);
  },

  async setProductActive(id, active) {
    await apiFetch(`/admin/products/${id}`, { method: "PATCH", json: { active } });
  },

  async deleteProduct(id) {
    await apiFetch(`/admin/products/${id}`, { method: "DELETE" });
  },

  async getStock() {
    return apiFetch<StockEntry[]>("/admin/stock");
  },

  async updateStock(entries) {
    await apiFetch("/admin/stock", { method: "PUT", json: entries });
  },

  async setPriceMultiplier(distributorId, multiplier) {
    await apiFetch(`/admin/distributors/${distributorId}/price-multiplier`, { method: "PUT", json: { multiplier } });
  },

  async getDistributors(opts) {
    // B24 answers `{ items, hasMore, nextAfter }`; older builds answered a bare array, so accept
    // both shapes. `all=1` only widens a platform-scoped (super admin) caller: the backend refuses
    // it inside a tenant scope, so a distributor admin keeps the scoped list and the platform call
    // goes out without the scope header.
    const platform = readBundle()?.session.staff.role === "super_admin";
    const all = Boolean(opts?.all) && platform;
    const data = await apiFetch<DistributorListPayload>(
      `/admin/distributors${all ? "?all=1" : ""}`,
      all ? { scope: false } : undefined,
    );
    const rows = Array.isArray(data) ? data : (data.items ?? []);
    return rows.map(mapDistributor);
  },

  async getDistributor(id) {
    try {
      return mapDistributor(await apiFetch<Record<string, unknown>>(`/admin/distributors/${id}`));
    } catch {
      return null;
    }
  },

  async saveDistributor(input) {
    const fee = input.deliveryFee === "free" ? 0 : Number(input.deliveryFee);
    const body = {
      ...input,
      acceptingOrders: input.status !== "full",
      deliveryFee: fee,
    };
    const row = input.id
      ? await apiFetch<Record<string, unknown>>(`/admin/distributors/${input.id}`, { method: "PUT", json: body })
      : await apiFetch<Record<string, unknown>>("/admin/distributors", { method: "POST", json: body });
    const saved = mapDistributor(row);
    if (input.cities?.length) {
      const cities = await apiFetch<Array<{ id: string; name: string }>>("/admin/cities");
      const cityIds = input.cities
        .map((name) => cities.find((c) => c.name === name)?.id)
        .filter((id): id is string => Boolean(id));
      if (cityIds.length) {
        await apiFetch(`/admin/distributors/${saved.id}/cities`, { method: "PUT", json: { cityIds } });
      }
    }
    return saved;
  },

  async getRetailers(_filters?: RetailerFilters) {
    // Unpaged callers (command palette, city coverage) read the first B33 page; the page is capped
    // at RETAILERS_LIST_MAX server-side, exactly like the B24 list. `plan` is not a B33 parameter:
    // `customers.shopkeepers` has no plan column yet, so no caller can narrow by it here.
    const qs = new URLSearchParams({ limit: "500" });
    const data = await apiFetch<RetailerRowsPayload>(`/admin/retailers?${qs}`);
    const rows = Array.isArray(data) ? data : (data.items ?? []);
    return rows.map(mapRetailer);
  },

  async getRetailersPage(filters?: RetailerListQuery) {
    // `q` (a phone fragment) and `status` are applied by the endpoint before it pages, so a filter
    // is never limited to the rows this page already loaded.
    const qs = new URLSearchParams({ limit: String(filters?.limit ?? 20) });
    if (filters?.after) qs.set("after", filters.after);
    if (filters?.q) qs.set("q", filters.q);
    if (filters?.status && filters.status !== "all") qs.set("status", filters.status);
    const data = await apiFetch<{
      items?: Record<string, unknown>[];
      hasMore?: boolean;
      nextAfter?: string | null;
    }>(`/admin/retailers?${qs}`);
    return {
      items: (data.items ?? []).map(mapRetailer),
      hasMore: Boolean(data.hasMore),
      nextAfter: data.nextAfter ?? null,
    };
  },

  async getRetailer(id) {
    try {
      return await apiFetch<Retailer>(`/admin/retailers/${id}`);
    } catch {
      return null;
    }
  },

  async getRetailerAddresses(id) {
    const row = await apiFetch<{ addresses?: Address[] }>(`/admin/retailers/${id}`);
    return (row.addresses ?? []).map((a) => ({
      ...a,
      city: (a as Address & { cityName?: string }).cityName ?? a.city,
    }));
  },

  async setRetailerStatus(id, status) {
    await apiFetch(`/admin/retailers/${id}`, { method: "PATCH", json: { status } });
  },

  async setRetailerPrimaryDistributor(id, distributorId) {
    try {
      const res = await apiFetch<{ ok: true; primaryDistributorId: string }>(
        `/admin/retailers/${id}/primary-distributor`,
        { method: "PUT", json: { distributorId } },
      );
      return ok({ primaryDistributorId: res.primaryDistributorId });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "خطا در تغییر شرکت پخش اصلی");
    }
  },

  async setRetailerSubscription(id, action, days) {
    try {
      const res = await apiFetch<{ ok: true; plan: RetailerPlan; subscription?: RetailerSubscription }>(
        `/admin/retailers/${id}/subscription`,
        { method: "POST", json: { action, days } },
      );
      return ok({ plan: res.plan, subscription: res.subscription });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "خطا در به‌روزرسانی اشتراک");
    }
  },

  async getSubscriptions(filters?: SubscriptionFilters) {
    const qs = new URLSearchParams();
    if (filters?.plan && filters.plan !== "all") qs.set("plan", filters.plan);
    if (filters?.status && filters.status !== "all") qs.set("status", filters.status);
    const query = qs.toString();
    return apiFetch<SubscriptionsResult>(`/admin/subscriptions${query ? `?${query}` : ""}`);
  },

  async getCoupons() {
    const rows = await apiFetch<Record<string, unknown>[]>("/admin/coupons");
    return rows.map(mapCoupon);
  },

  async saveCoupon(coupon) {
    const body = { ...coupon, expiresAt: coupon.expiresAt };
    const row = coupon.id
      ? await apiFetch<Record<string, unknown>>(`/admin/coupons/${coupon.id}`, { method: "PUT", json: body })
      : await apiFetch<Record<string, unknown>>("/admin/coupons", { method: "POST", json: body });
    return mapCoupon(row);
  },

  async deleteCoupon(id) {
    await apiFetch(`/admin/coupons/${id}`, { method: "DELETE" });
  },

  async getBanners() {
    const rows = await apiFetch<Record<string, unknown>[]>("/admin/banners");
    return rows.map(mapBanner);
  },

  async saveBanner(banner) {
    const body = { title: banner.title, subtitle: banner.subtitle, ctaLabel: banner.cta, active: banner.active };
    const row = banner.id
      ? await apiFetch<Record<string, unknown>>(`/admin/banners/${banner.id}`, { method: "PUT", json: body })
      : await apiFetch<Record<string, unknown>>("/admin/banners", { method: "POST", json: body });
    return mapBanner(row);
  },

  async reorderBanners(ids) {
    await apiFetch("/admin/banners/order", { method: "PUT", json: { ids } });
  },

  async deleteBanner(id) {
    await apiFetch(`/admin/banners/${id}`, { method: "DELETE" });
  },

  async getMessages() {
    const rows = await apiFetch<Message[]>("/admin/messages");
    return rows.map((m) => ({
      ...m,
      sentAt: String(m.sentAt),
      recipients: Number((m as Message & { recipientsCount?: number }).recipientsCount ?? m.recipients ?? 0),
    }));
  },

  async sendMessage(message) {
    const row = await apiFetch<Message & { recipientsCount?: number }>("/admin/messages", {
      method: "POST",
      json: message,
    });
    return { ...row, recipients: row.recipientsCount ?? row.recipients ?? 0, sentAt: String(row.sentAt) };
  },

  async getPayments() {
    const rows = await apiFetch<Payment[]>("/admin/payments");
    return rows;
  },

  async getWallets() {
    return apiFetch<WalletAccount[]>("/admin/wallets");
  },

  async adjustWallet(retailerId, amount, note) {
    try {
      const res = await apiFetch<{ ok?: boolean; data?: WalletAccount }>(`/admin/wallets/${retailerId}/adjust`, {
        method: "POST",
        json: { amount, note },
      });
      return ok(res.data ?? (res as unknown as WalletAccount));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "تعدیل ناموفق بود");
    }
  },

  async getSlots(distributorId) {
    const row = await apiFetch<DeliverySlotConfig & { days: Record<string, string[]> | string }>(
      "/admin/distributors/" + distributorId + "/slots",
    );
    const days =
      typeof row.days === "string"
        ? (JSON.parse(row.days) as Record<number, string[]>)
        : (row.days as Record<number, string[]>);
    return {
      distributorId,
      days: Object.fromEntries(Object.entries(days).map(([k, v]) => [Number(k), v])) as DeliverySlotConfig["days"],
      holidays: (row.holidays ?? []) as string[],
    };
  },

  async saveSlots(config) {
    await apiFetch(`/admin/distributors/${config.distributorId}/slots`, {
      method: "PUT",
      json: { days: config.days, holidays: config.holidays },
    });
  },

  async getCities() {
    const rows = await apiFetch<Record<string, unknown>[]>("/admin/cities");
    return rows.map(mapCity);
  },

  async saveCity(city) {
    const rows = await apiFetch<Array<{ id: string; name: string }>>("/admin/cities");
    const existing = rows.find((c) => c.name === city.name);
    if (existing) {
      await apiFetch(`/admin/cities/${existing.id}`, { method: "PUT", json: city });
    } else {
      await apiFetch("/admin/cities", { method: "POST", json: city });
    }
  },

  async deleteCity(name) {
    const rows = await apiFetch<Array<{ id: string; name: string }>>("/admin/cities");
    const existing = rows.find((c) => c.name === name);
    if (existing) await apiFetch(`/admin/cities/${existing.id}`, { method: "DELETE" });
  },

  async getSettings() {
    const row = await apiFetch<PlatformSettings>("/admin/settings");
    return { ...row, proMonthlyPrice: row.proMonthlyPrice ?? PRO_MONTHLY_PRICE };
  },

  async saveSettings(settings) {
    await apiFetch("/admin/settings", { method: "PUT", json: settings });
  },

  async getStaff() {
    const rows = await apiFetch<Record<string, unknown>[]>("/admin/staff");
    return rows.map(mapStaff);
  },

  async saveStaff(input) {
    const row = input.id
      ? await apiFetch<Record<string, unknown>>(`/admin/staff/${input.id}`, { method: "PUT", json: input })
      : await apiFetch<Record<string, unknown>>("/admin/staff", { method: "POST", json: input });
    return mapStaff(row);
  },

  async getAuditLog() {
    return apiFetch<AuditEntry[]>("/admin/audit");
  },

  async resetDemoData() {
    await apiFetch("/admin/dev/reset-demo", { method: "POST" });
  },

  // Driver/delivery endpoints are specified in ../Driver-FrontEnd/docs/DRIVER_DESIGN_PROPOSAL.md §18;
  // the backend does not implement them yet.
  async getDrivers(opts) {
    const qs = new URLSearchParams();
    if (opts?.activeOnly) qs.set("active", "true");
    if (opts?.distributorId) qs.set("distributorId", opts.distributorId);
    return apiFetch<DriverListItem[]>(`/admin/drivers?${qs}`);
  },

  async getDriver(id) {
    try {
      return await apiFetch<DriverListItem>(`/admin/drivers/${id}`);
    } catch {
      return null;
    }
  },

  async saveDriver(input) {
    return guarded(() =>
      input.id
        ? apiFetch<Driver>(`/admin/drivers/${input.id}`, { method: "PATCH", json: input })
        : apiFetch<Driver>("/admin/drivers", { method: "POST", json: input }),
    );
  },

  async setDriverActive(id, active) {
    return guarded(() => apiFetch<Driver>(`/admin/drivers/${id}`, { method: "PATCH", json: { active } }));
  },

  async resetDriverPassword(id, password) {
    return guarded(() =>
      apiFetch<{ passwordUpdatedAt: string }>(`/admin/drivers/${id}/password`, { method: "POST", json: { password } }),
    );
  },

  async getDeliveries(filters = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, String(v));
    return apiFetch<Delivery[]>(`/admin/deliveries?${qs}`);
  },

  async assignDriver(orderId, driverId) {
    return guarded(async () =>
      mapOrder(
        await apiFetch<Record<string, unknown>>(`/admin/orders/${orderId}/driver`, {
          method: "PUT",
          json: { driverId },
        }),
      ),
    );
  },

  async reorderRoute(driverId, deliveryIds) {
    return guarded(async () => {
      await apiFetch(`/admin/drivers/${driverId}/route`, { method: "PUT", json: { deliveryIds } });
    });
  },

  async dispatchRoute(driverId) {
    return guarded(() => apiFetch<{ shipped: number }>(`/admin/drivers/${driverId}/dispatch`, { method: "POST" }));
  },

  async confirmDelivery(deliveryId) {
    return guarded(() => apiFetch<Delivery>(`/admin/deliveries/${deliveryId}/confirm`, { method: "POST" }));
  },

  async rejectDelivery(deliveryId, reason) {
    return guarded(() =>
      apiFetch<Delivery>(`/admin/deliveries/${deliveryId}/reject`, { method: "POST", json: { reason } }),
    );
  },

  async getAdminNotifications() {
    return apiFetch<AdminNotification[]>("/admin/notifications");
  },

  async markAdminNotificationsRead(ids) {
    await apiFetch("/admin/notifications/read", { method: "POST", json: { ids: ids ?? null } });
  },
};

async function guarded<T>(fn: () => Promise<T>): Promise<ApiOk<T> | ApiError> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e instanceof Error ? e.message : "درخواست ناموفق بود");
  }
}
