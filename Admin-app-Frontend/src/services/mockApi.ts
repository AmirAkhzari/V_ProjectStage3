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
  DeliveryClosedReason,
  DeliverySlotConfig,
  DeliverySummary,
  Distributor,
  Driver,
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
  WalletAccount,
} from "@/types";
import { DEMO_OTP } from "@/types";
import type { AdminApi, ApiError, ApiOk, RetailerFilters, RetailerListQuery, Scope, SubscriptionFilters } from "./api";
import {
  DRIVER_DEMO_ADDRESSES,
  DRIVER_DEMO_ORDERS,
  DRIVER_DEMO_RETAILERS,
  SEED_ADMIN_NOTIFICATIONS,
  SEED_DELIVERIES,
  SEED_DRIVERS,
} from "./seed/drivers";
import { ASSIGNABLE_ORDER_STATUSES, DELIVERY_STATUS_LABELS, isActiveDelivery } from "@/lib/deliveryStatus";
import { SEED_BANNERS, SEED_DISTRIBUTORS, SEED_PRODUCTS, SEED_STOCK } from "./seed/catalog";
import { SEED_COUPONS, SEED_MESSAGES, SEED_SETTINGS } from "./seed/account";
import { SEED_CITIES } from "./seed/cities";
import { DEMO_DISTRIBUTOR_ADMIN_PHONE, DEMO_SUPER_ADMIN_PHONE, SEED_STAFF } from "./seed/staff";
import {
  SEED_ADDRESSES,
  SEED_AUDIT,
  SEED_ORDERS,
  SEED_PAYMENTS,
  SEED_RETAILERS,
  SEED_SLOTS,
  SEED_SUBSCRIPTIONS,
  SEED_WALLETS,
} from "./seed/orders";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { canTransition, ORDER_STATUS_LABELS } from "@/lib/orderStatus";
import { createId, normalizePersian } from "@/lib/format";
import { isValidIranMobile, normalizePhone } from "@/lib/phone";

const KEY = "visitor-admin:db:v1";
const delay = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));

type Db = {
  session: AdminSession | null;
  otps: Record<string, string>;
  products: Product[];
  distributors: Distributor[];
  stock: StockEntry[];
  retailers: Retailer[];
  subscriptions: RetailerSubscription[];
  addresses: Address[];
  orders: Order[];
  payments: Payment[];
  wallets: WalletAccount[];
  coupons: Coupon[];
  banners: Banner[];
  messages: Message[];
  slots: DeliverySlotConfig[];
  cities: City[];
  settings: PlatformSettings;
  staff: Staff[];
  audit: AuditEntry[];
  drivers: Driver[];
  deliveries: Delivery[];
  adminNotifications: AdminNotification[];
};

const byCreatedDesc = (a: Order, b: Order) => b.createdAt.localeCompare(a.createdAt);

function seedDb(): Db {
  // Cloned so in-place mutations never leak back into the seed constants (and reset really resets).
  return structuredClone({
    session: null,
    otps: {},
    products: SEED_PRODUCTS,
    distributors: SEED_DISTRIBUTORS,
    stock: SEED_STOCK,
    retailers: [...SEED_RETAILERS, ...DRIVER_DEMO_RETAILERS],
    subscriptions: SEED_SUBSCRIPTIONS,
    addresses: [...SEED_ADDRESSES, ...DRIVER_DEMO_ADDRESSES],
    orders: [...DRIVER_DEMO_ORDERS, ...SEED_ORDERS].sort(byCreatedDesc),
    drivers: SEED_DRIVERS,
    deliveries: SEED_DELIVERIES,
    adminNotifications: SEED_ADMIN_NOTIFICATIONS,
    payments: SEED_PAYMENTS,
    wallets: SEED_WALLETS,
    coupons: SEED_COUPONS,
    banners: SEED_BANNERS,
    messages: SEED_MESSAGES,
    slots: SEED_SLOTS,
    cities: SEED_CITIES,
    settings: SEED_SETTINGS,
    staff: SEED_STAFF,
    audit: SEED_AUDIT,
  } satisfies Db);
}

let cache: Db | null = null;

function hydrateRetailer(row: Retailer, seed = SEED_RETAILERS.find((r) => r.id === row.id)): Retailer {
  return {
    ...row,
    primaryDistributorId: row.primaryDistributorId ?? seed?.primaryDistributorId ?? null,
    primaryDistributorName: row.primaryDistributorName ?? seed?.primaryDistributorName ?? null,
    plan: row.plan ?? seed?.plan ?? "free",
    subscriptionExpiresAt: row.subscriptionExpiresAt ?? seed?.subscriptionExpiresAt ?? null,
  };
}

function readDb(): Db {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      cache = seedDb();
    } else {
      const parsed = JSON.parse(raw) as Partial<Db>;
      const seeded = seedDb();
      if (!parsed.drivers) {
        // Stored before the driver module existed: add the driver demo world without dropping local edits.
        const known = new Set((parsed.orders ?? []).map((o) => o.id));
        parsed.orders = [...DRIVER_DEMO_ORDERS.filter((o) => !known.has(o.id)), ...(parsed.orders ?? [])].sort(
          byCreatedDesc,
        );
        parsed.retailers = [...(parsed.retailers ?? SEED_RETAILERS), ...DRIVER_DEMO_RETAILERS];
        parsed.addresses = [...(parsed.addresses ?? SEED_ADDRESSES), ...DRIVER_DEMO_ADDRESSES];
      }
      cache = {
        ...seeded,
        ...parsed,
        subscriptions: parsed.subscriptions ?? seeded.subscriptions,
        retailers: (parsed.retailers ?? seeded.retailers).map((r) => hydrateRetailer(r)),
        settings: {
          ...seeded.settings,
          ...parsed.settings,
          proMonthlyPrice: parsed.settings?.proMonthlyPrice ?? seeded.settings.proMonthlyPrice,
        },
      };
    }
  } catch {
    cache = seedDb();
  }
  return cache;
}

function writeDb(db: Db) {
  cache = db;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* quota exceeded in demo — keep in-memory */
  }
}

function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
function fail(error: string): ApiError {
  return { ok: false, error };
}

let scope: Scope = { distributorId: null };

function inScope<T extends { distributorId?: string }>(rows: T[]) {
  return scope.distributorId ? rows.filter((r) => r.distributorId === scope.distributorId) : rows;
}

function actor(db: Db) {
  return db.session?.staff ?? { id: "system", name: "سیستم" };
}

function audit(db: Db, action: string, entity: string, entityId?: string) {
  const who = actor(db);
  db.audit = [
    {
      id: createId("au"),
      at: new Date().toISOString(),
      actorId: who.id,
      actorName: who.name,
      action,
      entity,
      entityId,
    },
    ...db.audit,
  ].slice(0, 500);
}

function sessionFor(staff: Staff): AdminSession {
  return {
    token: createId("tok"),
    staff,
    permissions: ROLE_PERMISSIONS[staff.role],
  };
}

function activeSubscription(subs: RetailerSubscription[], retailerId: string, now = Date.now()) {
  return (
    subs.find(
      (s) =>
        s.retailerId === retailerId &&
        s.plan === "pro" &&
        s.status === "active" &&
        new Date(s.expiresAt).getTime() > now,
    ) ?? null
  );
}

function nextExpiry(now: Date, currentExpiresAt: Date | null, days = 30) {
  const base = currentExpiresAt && currentExpiresAt.getTime() > now.getTime() ? currentExpiresAt : now;
  return new Date(base.getTime() + days * 86_400_000);
}

function applyPlan(retailer: Retailer, db: Db): Retailer {
  const active = activeSubscription(db.subscriptions, retailer.id);
  const dist = db.distributors.find((d) => d.id === retailer.primaryDistributorId);
  return {
    ...retailer,
    primaryDistributorName: dist?.name ?? null,
    plan: active ? "pro" : "free",
    subscriptionExpiresAt: active?.expiresAt ?? null,
  };
}

function parseRetailerCursor(after: string | null | undefined): number {
  const match = /^mock:(\d+)$/.exec(after ?? "");
  return match ? Number(match[1]) : 0;
}

function listRetailer(retailer: Retailer, db: Db): Retailer {
  return applyPlan(retailer, db);
}

function detailRetailer(retailer: Retailer, db: Db): Retailer {
  const row = applyPlan(retailer, db);
  const primary = db.distributors.find((d) => d.id === retailer.primaryDistributorId);
  return {
    ...row,
    primaryDistributor: primary ? { id: primary.id, name: primary.name } : null,
    subscriptions: db.subscriptions
      .filter((s) => s.retailerId === retailer.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

function persistRetailerPlan(db: Db, retailerId: string) {
  const retailer = db.retailers.find((r) => r.id === retailerId);
  if (!retailer) return;
  const next = applyPlan(retailer, db);
  db.retailers = db.retailers.map((r) => (r.id === retailerId ? { ...r, ...next } : r));
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* ---------- deliveries ---------- */

const DELIVERY_PRIORITY: Record<Delivery["status"], number> = {
  awaiting_confirmation: 0,
  assigned: 1,
  rejected: 2,
  confirmed: 3,
  cancelled: 4,
};

function isToday(iso: string) {
  return startOfDay(new Date(iso)).getTime() === startOfDay(new Date()).getTime();
}

/** The delivery that represents the order right now: an active one if any, else the most relevant closed one. */
function currentDelivery(db: Db, orderId: string): Delivery | null {
  return (
    db.deliveries
      .filter((d) => d.orderId === orderId)
      .sort(
        (a, b) => DELIVERY_PRIORITY[a.status] - DELIVERY_PRIORITY[b.status] || b.assignedAt.localeCompare(a.assignedAt),
      )[0] ?? null
  );
}

function summarize(d: Delivery | null): DeliverySummary | null {
  if (!d) return null;
  return {
    id: d.id,
    driverId: d.driverId,
    driverName: d.driverName,
    status: d.status,
    sequence: d.sequence,
    submittedAt: d.submittedAt,
    confirmedAt: d.confirmedAt,
    rejectionReason: d.rejectionReason,
  };
}

function withDelivery(db: Db, order: Order): Order {
  return { ...order, delivery: summarize(currentDelivery(db, order.id)) };
}

function driverStats(db: Db, driverId: string) {
  const today = db.deliveries.filter(
    (d) => d.driverId === driverId && isToday(d.deliveryDate) && d.status !== "cancelled",
  );
  return {
    total: today.length,
    remaining: today.filter((d) => d.status === "assigned" || d.status === "rejected").length,
    awaiting: today.filter((d) => d.status === "awaiting_confirmation").length,
    confirmed: today.filter((d) => d.status === "confirmed").length,
  };
}

function listDriver(db: Db, driver: Driver): DriverListItem {
  return {
    ...driver,
    distributorName: db.distributors.find((d) => d.id === driver.distributorId)?.name ?? "—",
    today: driverStats(db, driver.id),
  };
}

function closeDelivery(d: Delivery, reason: DeliveryClosedReason) {
  d.status = "cancelled";
  d.closedReason = reason;
}

function syncOrderStatus(db: Db, order: Order) {
  for (const d of db.deliveries) if (d.orderId === order.id) d.orderStatus = order.status;
}

function pushOrderEvent(db: Db, order: Order, status: OrderStatus, note?: string) {
  order.status = status;
  order.events = [
    ...order.events,
    { id: createId("ev"), status, at: new Date().toISOString(), actorName: actor(db).name, note },
  ];
  syncOrderStatus(db, order);
}

function markNotificationRead(db: Db, deliveryId: string) {
  const now = new Date().toISOString();
  db.adminNotifications = db.adminNotifications.map((n) =>
    n.deliveryId === deliveryId && !n.readAt ? { ...n, readAt: now } : n,
  );
}

function scopedDelivery(db: Db, id: string) {
  const d = db.deliveries.find((x) => x.id === id);
  if (!d) return null;
  if (scope.distributorId && d.distributorId !== scope.distributorId) return null;
  return d;
}

const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;

export const mockApi: AdminApi = {
  setScope(next) {
    scope = next;
  },

  async sendOtp(phone) {
    await delay();
    const normalized = normalizePhone(phone);
    if (!isValidIranMobile(normalized)) return fail("شماره موبایل معتبر نیست");
    const db = readDb();
    if (!db.staff.some((s) => s.phone === normalized && s.active)) return fail("این شماره دسترسی مدیریتی ندارد");
    db.otps[normalized] = DEMO_OTP;
    writeDb(db);
    return ok({ phone: normalized });
  },

  async verifyOtp(phone, code) {
    await delay();
    const normalized = normalizePhone(phone);
    const db = readDb();
    const expected = db.otps[normalized] ?? DEMO_OTP;
    if (code !== expected && code !== DEMO_OTP) return fail("کد تایید نادرست است");
    const staff = db.staff.find((s) => s.phone === normalized && s.active);
    if (!staff) return fail("این شماره دسترسی مدیریتی ندارد");
    staff.lastLoginAt = new Date().toISOString();
    db.session = sessionFor(staff);
    delete db.otps[normalized];
    writeDb(db);
    return ok(db.session);
  },

  async loginDemo(role) {
    await delay(160);
    const db = readDb();
    const phone = role === "super_admin" ? DEMO_SUPER_ADMIN_PHONE : DEMO_DISTRIBUTOR_ADMIN_PHONE;
    const staff = db.staff.find((s) => s.phone === phone)!;
    staff.lastLoginAt = new Date().toISOString();
    db.session = sessionFor(staff);
    writeDb(db);
    return ok(db.session);
  },

  async logout() {
    const db = readDb();
    db.session = null;
    writeDb(db);
  },

  getSession() {
    return readDb().session;
  },

  async getDashboard() {
    await delay(260);
    const db = readDb();
    const orders = inScope(db.orders);
    const paid = orders.filter((o) => o.status !== "cancelled");
    const today = startOfDay(new Date()).getTime();
    const day = 86_400_000;
    const sum = (list: Order[]) => list.reduce((s, o) => s + o.total, 0);
    const inRange = (from: number, to: number) =>
      paid.filter((o) => {
        const t = new Date(o.createdAt).getTime();
        return t >= from && t < to;
      });
    const todayOrders = inRange(today, today + day);
    const yesterdayOrders = inRange(today - day, today);
    const last7 = inRange(today - 6 * day, today + day);
    const prev7 = inRange(today - 13 * day, today - 6 * day);
    const last30 = inRange(today - 29 * day, today + day);
    const ordersByStatus = {
      pending: 0,
      confirmed: 0,
      packing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    } as Record<OrderStatus, number>;
    for (const o of orders) ordersByStatus[o.status] += 1;
    const trend = Array.from({ length: 30 }, (_, i) => {
      const from = today - (29 - i) * day;
      const bucket = inRange(from, from + day);
      return {
        date: new Date(from).toISOString(),
        orders: bucket.length,
        gmv: sum(bucket),
      };
    });
    const byDist = new Map<string, { gmv: number; orders: number }>();
    for (const o of paid) {
      const cur = byDist.get(o.distributorId) ?? { gmv: 0, orders: 0 };
      byDist.set(o.distributorId, {
        gmv: cur.gmv + o.total,
        orders: cur.orders + 1,
      });
    }
    const topDistributors = [...byDist.entries()]
      .map(([id, v]) => {
        const d = db.distributors.find((x) => x.id === id)!;
        return { id, name: d.name, city: d.cities[0], ...v };
      })
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 5);
    const lowStock = inScope(db.stock)
      .filter((s) => s.available && s.cartonsLeft <= 5)
      .sort((a, b) => a.cartonsLeft - b.cartonsLeft)
      .slice(0, 6)
      .map((s) => ({
        productId: s.productId,
        productName: db.products.find((p) => p.id === s.productId)?.name ?? s.productId,
        distributorId: s.distributorId,
        distributorName: db.distributors.find((d) => d.id === s.distributorId)?.name ?? s.distributorId,
        cartonsLeft: s.cartonsLeft,
      }));
    const retailerIds = new Set(orders.map((o) => o.retailerId));
    const stats: DashboardStats = {
      gmvToday: sum(todayOrders),
      gmvYesterday: sum(yesterdayOrders),
      gmv7d: sum(last7),
      gmv30d: sum(last30),
      pendingOrders: ordersByStatus.pending,
      activeRetailers: scope.distributorId
        ? retailerIds.size
        : db.retailers.filter((r) => r.status === "active").length + 316,
      avgBasket: last7.length ? Math.round(sum(last7) / last7.length) : 0,
      avgBasketPrev: prev7.length ? Math.round(sum(prev7) / prev7.length) : 0,
      ordersByStatus,
      trend,
      topDistributors,
      lowStock,
      recentOrders: orders.slice(0, 8),
    };
    return stats;
  },

  async getOrders(filters = {}) {
    await delay(180);
    const db = readDb();
    let rows = inScope(db.orders);
    if (filters.status && filters.status !== "all") rows = rows.filter((o) => o.status === filters.status);
    if (filters.distributorId) rows = rows.filter((o) => o.distributorId === filters.distributorId);
    if (filters.city) rows = rows.filter((o) => o.city === filters.city);
    if (filters.from) rows = rows.filter((o) => o.createdAt >= filters.from!);
    if (filters.to) rows = rows.filter((o) => o.createdAt <= filters.to!);
    if (filters.query?.trim()) {
      const q = normalizePersian(filters.query.trim());
      rows = rows.filter((o) => normalizePersian(`${o.number} ${o.retailerName} ${o.retailerPhone}`).includes(q));
    }
    return rows.map((o) => withDelivery(db, o));
  },

  async getOrder(id) {
    await delay(120);
    const db = readDb();
    const order = db.orders.find((o) => o.id === id) ?? null;
    if (order && scope.distributorId && order.distributorId !== scope.distributorId) return null;
    return order ? withDelivery(db, order) : null;
  },

  async updateOrderStatus(id, status, note) {
    await delay(320);
    const db = readDb();
    const order = db.orders.find((o) => o.id === id);
    if (!order) return fail("سفارش یافت نشد");
    if (scope.distributorId && order.distributorId !== scope.distributorId) return fail("دسترسی به این سفارش ندارید");
    if (!canTransition(order.status, status))
      return fail(
        `تغییر وضعیت از «${ORDER_STATUS_LABELS[order.status]}» به «${ORDER_STATUS_LABELS[status]}» مجاز نیست`,
      );
    const active = currentDelivery(db, order.id);
    if (status === "delivered" && isActiveDelivery(active))
      return fail("این سفارش راننده دارد؛ تحویل فقط با تایید کد تحویل راننده ثبت می‌شود");
    if (status === "cancelled") {
      order.cancelReason = note;
      if (active && isActiveDelivery(active)) closeDelivery(active, "order_cancelled");
    }
    pushOrderEvent(db, order, status, note);
    audit(db, `تغییر وضعیت سفارش ${order.number} به «${ORDER_STATUS_LABELS[status]}»`, "order", order.id);
    writeDb(db);
    return ok(withDelivery(db, order));
  },

  async getProducts() {
    await delay(140);
    return readDb().products;
  },

  async getProduct(id) {
    await delay(100);
    return readDb().products.find((p) => p.id === id) ?? null;
  },

  async saveProduct(input) {
    await delay(260);
    const db = readDb();
    const existing = input.id ? db.products.find((p) => p.id === input.id) : undefined;
    const product: Product = {
      ...input,
      id: existing?.id ?? createId("prd"),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (existing) db.products = db.products.map((p) => (p.id === product.id ? product : p));
    else {
      db.products = [product, ...db.products];
      db.stock = [
        ...db.stock,
        ...db.distributors.map((d) => ({
          distributorId: d.id,
          productId: product.id,
          available: false,
          cartonsLeft: 0,
        })),
      ];
    }
    audit(db, `${existing ? "ویرایش" : "ایجاد"} محصول «${product.name}»`, "product", product.id);
    writeDb(db);
    return product;
  },

  async setProductActive(id, active) {
    await delay(120);
    const db = readDb();
    db.products = db.products.map((p) => (p.id === id ? { ...p, active } : p));
    audit(db, `${active ? "فعال" : "غیرفعال"} کردن محصول`, "product", id);
    writeDb(db);
  },

  async deleteProduct(id) {
    await delay(200);
    const db = readDb();
    const name = db.products.find((p) => p.id === id)?.name ?? id;
    db.products = db.products.filter((p) => p.id !== id);
    db.stock = db.stock.filter((s) => s.productId !== id);
    audit(db, `حذف محصول «${name}»`, "product", id);
    writeDb(db);
  },

  async getStock() {
    await delay(160);
    return inScope(readDb().stock);
  },

  async updateStock(entries) {
    await delay(200);
    const db = readDb();
    for (const e of entries) {
      if (scope.distributorId && e.distributorId !== scope.distributorId) continue;
      const idx = db.stock.findIndex((s) => s.distributorId === e.distributorId && s.productId === e.productId);
      if (idx >= 0) db.stock[idx] = { ...db.stock[idx], ...e };
      else
        db.stock.push({
          distributorId: e.distributorId,
          productId: e.productId,
          available: e.available ?? false,
          cartonsLeft: e.cartonsLeft ?? 0,
          priceOverride: e.priceOverride,
        });
    }
    audit(db, `به‌روزرسانی موجودی ${entries.length} ردیف`, "stock");
    writeDb(db);
  },

  async setPriceMultiplier(distributorId, multiplier) {
    await delay(160);
    const db = readDb();
    if (scope.distributorId && distributorId !== scope.distributorId) return;
    db.distributors = db.distributors.map((d) => (d.id === distributorId ? { ...d, priceMultiplier: multiplier } : d));
    audit(db, `تغییر ضریب قیمت به ${multiplier}`, "distributor", distributorId);
    writeDb(db);
  },

  async getDistributors(opts) {
    await delay(140);
    const db = readDb();
    if (opts?.all) return db.distributors;
    return scope.distributorId ? db.distributors.filter((d) => d.id === scope.distributorId) : db.distributors;
  },

  async getDistributor(id) {
    await delay(100);
    return readDb().distributors.find((d) => d.id === id) ?? null;
  },

  async saveDistributor(input) {
    await delay(260);
    const db = readDb();
    const existing = input.id ? db.distributors.find((d) => d.id === input.id) : undefined;
    const distributor: Distributor = {
      ...input,
      id: existing?.id ?? createId("dst"),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (existing) db.distributors = db.distributors.map((d) => (d.id === distributor.id ? distributor : d));
    else {
      db.distributors = [...db.distributors, distributor];
      db.stock = [
        ...db.stock,
        ...db.products.map((p) => ({
          distributorId: distributor.id,
          productId: p.id,
          available: false,
          cartonsLeft: 0,
        })),
      ];
      db.slots = [
        ...db.slots,
        {
          distributorId: distributor.id,
          days: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, []])),
          holidays: [],
        },
      ];
    }
    audit(db, `${existing ? "ویرایش" : "ایجاد"} شرکت پخش «${distributor.name}»`, "distributor", distributor.id);
    writeDb(db);
    return distributor;
  },

  async getRetailers(filters?: RetailerFilters) {
    await delay(160);
    const db = readDb();
    let rows = db.retailers.map((r) => listRetailer(r, db));
    if (scope.distributorId) {
      rows = rows.filter((r) => r.primaryDistributorId === scope.distributorId);
    }
    if (filters?.plan && filters.plan !== "all") {
      rows = rows.filter((r) => r.plan === filters.plan);
    }
    return rows;
  },

  async getRetailersPage(filters?: RetailerListQuery) {
    await delay(160);
    const db = readDb();
    let rows = db.retailers.map((r) => listRetailer(r, db));
    if (scope.distributorId) {
      rows = rows.filter((r) => r.primaryDistributorId === scope.distributorId);
    }
    if (filters?.status && filters.status !== "all") {
      rows = rows.filter((r) => r.status === filters.status);
    }
    const q = filters?.q?.replace(/\D/g, "") ?? "";
    if (q) rows = rows.filter((r) => r.phone.replace(/\D/g, "").includes(q));
    const limit = Math.max(1, Math.min(500, filters?.limit ?? 20));
    const start = parseRetailerCursor(filters?.after);
    const page = rows.slice(start, start + limit);
    const hasMore = start + page.length < rows.length;
    return {
      items: page,
      hasMore,
      nextAfter: hasMore ? `mock:${start + page.length}` : null,
    };
  },

  async getRetailer(id) {
    await delay(100);
    const db = readDb();
    const retailer = db.retailers.find((r) => r.id === id);
    if (!retailer) return null;
    if (scope.distributorId && retailer.primaryDistributorId !== scope.distributorId) return null;
    return detailRetailer(retailer, db);
  },

  async getRetailerAddresses(id) {
    await delay(100);
    return readDb().addresses.filter((a) => a.retailerId === id);
  },

  async setRetailerStatus(id, status) {
    await delay(180);
    const db = readDb();
    db.retailers = db.retailers.map((r) => (r.id === id ? { ...r, status } : r));
    audit(db, `${status === "blocked" ? "مسدود" : "فعال"} کردن فروشگاه`, "retailer", id);
    writeDb(db);
  },

  async setRetailerPrimaryDistributor(id, distributorId) {
    await delay(220);
    const db = readDb();
    if (db.session?.staff.role !== "super_admin") return fail("دسترسی غیرمجاز");
    const retailer = db.retailers.find((r) => r.id === id);
    if (!retailer) return fail("فروشگاه یافت نشد");
    const dist = db.distributors.find((d) => d.id === distributorId);
    if (!dist) return fail("شرکت پخش یافت نشد");
    db.retailers = db.retailers.map((r) =>
      r.id === id
        ? {
            ...r,
            primaryDistributorId: distributorId,
            primaryDistributorName: dist.name,
            primaryDistributor: { id: dist.id, name: dist.name },
          }
        : r,
    );
    audit(db, `تغییر شرکت پخش اصلی فروشگاه به «${dist.name}»`, "retailer", id);
    writeDb(db);
    return ok({ primaryDistributorId: distributorId });
  },

  async setRetailerSubscription(id, action, days) {
    await delay(220);
    const db = readDb();
    if (db.session?.staff.role !== "super_admin") return fail("دسترسی غیرمجاز");
    const retailer = db.retailers.find((r) => r.id === id);
    if (!retailer) return fail("فروشگاه یافت نشد");
    const now = new Date();
    if (action === "revoke") {
      db.subscriptions = db.subscriptions.map((s) =>
        s.retailerId === id && s.status === "active" && new Date(s.expiresAt).getTime() > now.getTime()
          ? { ...s, status: "cancelled", updatedAt: now.toISOString() }
          : s,
      );
      persistRetailerPlan(db, id);
      audit(db, "لغو اشتراک پرو فروشگاه", "retailer_subscription", id);
      writeDb(db);
      return ok({ plan: "free" as RetailerPlan });
    }
    const existing = activeSubscription(db.subscriptions, id, now.getTime());
    const expiresAt = nextExpiry(now, existing ? new Date(existing.expiresAt) : null, days ?? 30);
    let row: RetailerSubscription;
    if (existing) {
      row = { ...existing, expiresAt: expiresAt.toISOString(), updatedAt: now.toISOString() };
      db.subscriptions = db.subscriptions.map((s) => (s.id === existing.id ? row : s));
    } else {
      row = {
        id: createId("sub"),
        retailerId: id,
        plan: "pro",
        status: "active",
        startsAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        paymentId: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      db.subscriptions = [row, ...db.subscriptions];
    }
    persistRetailerPlan(db, id);
    audit(
      db,
      action === "extend" ? "تمدید اشتراک پرو فروشگاه" : "اعطای اشتراک پرو فروشگاه",
      "retailer_subscription",
      row.id,
    );
    writeDb(db);
    return ok({ plan: "pro" as RetailerPlan, subscription: row });
  },

  async getSubscriptions(filters?: SubscriptionFilters) {
    await delay(160);
    const db = readDb();
    if (db.session?.staff.role !== "super_admin") {
      return { items: [], summary: { total: 0, active: 0, revenue: 0 } };
    }
    const now = Date.now();
    let rows = [...db.subscriptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filters?.plan && filters.plan !== "all") rows = rows.filter((r) => r.plan === filters.plan);
    if (filters?.status && filters.status !== "all") rows = rows.filter((r) => r.status === filters.status);
    const revenue = db.payments
      .filter((p) => p.kind === "subscription" && p.status === "success")
      .reduce((s, p) => s + p.amount, 0);
    return {
      items: rows.map((row) => {
        const retailer = db.retailers.find((r) => r.id === row.retailerId);
        return {
          ...row,
          retailerName: retailer?.name ?? "",
          retailerPhone: retailer?.phone ?? "",
        };
      }),
      summary: {
        total: rows.length,
        active: rows.filter((r) => r.status === "active" && r.plan === "pro" && new Date(r.expiresAt).getTime() > now)
          .length,
        revenue,
      },
    };
  },

  async getCoupons() {
    await delay(120);
    const db = readDb();
    return scope.distributorId ? db.coupons.filter((c) => c.distributorId === scope.distributorId) : db.coupons;
  },

  async saveCoupon(input) {
    await delay(220);
    const db = readDb();
    const existing = input.id ? db.coupons.find((c) => c.id === input.id) : undefined;
    const coupon: Coupon = {
      ...input,
      code: input.code.trim().toUpperCase(),
      id: existing?.id ?? createId("cp"),
      usedCount: existing?.usedCount ?? 0,
    };
    if (scope.distributorId) coupon.distributorId = scope.distributorId;
    db.coupons = existing ? db.coupons.map((c) => (c.id === coupon.id ? coupon : c)) : [coupon, ...db.coupons];
    audit(db, `${existing ? "ویرایش" : "ایجاد"} کد تخفیف ${coupon.code}`, "coupon", coupon.id);
    writeDb(db);
    return coupon;
  },

  async deleteCoupon(id) {
    await delay(160);
    const db = readDb();
    db.coupons = db.coupons.filter((c) => c.id !== id);
    audit(db, "حذف کد تخفیف", "coupon", id);
    writeDb(db);
  },

  async getBanners() {
    await delay(100);
    return [...readDb().banners].sort((a, b) => a.order - b.order);
  },

  async saveBanner(input) {
    await delay(200);
    const db = readDb();
    const existing = input.id ? db.banners.find((b) => b.id === input.id) : undefined;
    const banner: Banner = {
      ...input,
      id: existing?.id ?? createId("bn"),
      order: existing?.order ?? db.banners.length,
    };
    db.banners = existing ? db.banners.map((b) => (b.id === banner.id ? banner : b)) : [...db.banners, banner];
    audit(db, `${existing ? "ویرایش" : "ایجاد"} بنر «${banner.title}»`, "banner", banner.id);
    writeDb(db);
    return banner;
  },

  async reorderBanners(ids) {
    await delay(100);
    const db = readDb();
    db.banners = db.banners.map((b) => ({
      ...b,
      order: ids.indexOf(b.id) < 0 ? b.order : ids.indexOf(b.id),
    }));
    writeDb(db);
  },

  async deleteBanner(id) {
    await delay(140);
    const db = readDb();
    db.banners = db.banners.filter((b) => b.id !== id);
    audit(db, "حذف بنر", "banner", id);
    writeDb(db);
  },

  async getMessages() {
    await delay(120);
    const db = readDb();
    return scope.distributorId
      ? db.messages.filter((m) => m.audience.type === "distributor" && m.audience.distributorId === scope.distributorId)
      : db.messages;
  },

  async sendMessage(input) {
    await delay(300);
    const db = readDb();
    const recipients =
      input.audience.type === "all"
        ? db.retailers.length + 316
        : input.audience.type === "city"
          ? db.retailers.filter((r) => r.city === (input.audience as { city: string }).city).length * 8
          : new Set(
              db.orders
                .filter((o) => o.distributorId === (input.audience as { distributorId: string }).distributorId)
                .map((o) => o.retailerId),
            ).size;
    const message: Message = {
      ...input,
      id: createId("msg"),
      sentAt: new Date().toISOString(),
      recipients,
    };
    db.messages = [message, ...db.messages];
    audit(db, `ارسال پیام «${message.title}» به ${recipients} گیرنده`, "message", message.id);
    writeDb(db);
    return message;
  },

  async getPayments() {
    await delay(160);
    return inScope(readDb().payments);
  },

  async getWallets() {
    await delay(160);
    return readDb().wallets;
  },

  async adjustWallet(retailerId, amount, note) {
    await delay(260);
    const db = readDb();
    const wallet = db.wallets.find((w) => w.retailerId === retailerId);
    if (!wallet) return fail("کیف پول یافت نشد");
    if (wallet.balance + amount < 0) return fail("موجودی کیف پول نمی‌تواند منفی شود");
    wallet.balance += amount;
    wallet.transactions = [
      {
        id: createId("tx"),
        amount,
        createdAt: new Date().toISOString(),
        status: "success",
        kind: "adjustment",
        note,
      },
      ...wallet.transactions,
    ];
    db.retailers = db.retailers.map((r) => (r.id === retailerId ? { ...r, walletBalance: wallet.balance } : r));
    audit(db, `تعدیل دستی کیف پول ${wallet.retailerName} (${amount > 0 ? "+" : ""}${amount})`, "wallet", retailerId);
    writeDb(db);
    return ok({ ...wallet });
  },

  async getSlots(distributorId) {
    await delay(120);
    const db = readDb();
    return (
      db.slots.find((s) => s.distributorId === distributorId) ?? {
        distributorId,
        days: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, []])),
        holidays: [],
      }
    );
  },

  async saveSlots(config) {
    await delay(200);
    const db = readDb();
    if (scope.distributorId && config.distributorId !== scope.distributorId) return;
    const idx = db.slots.findIndex((s) => s.distributorId === config.distributorId);
    if (idx >= 0) db.slots[idx] = config;
    else db.slots.push(config);
    audit(db, "به‌روزرسانی بازه‌های تحویل", "delivery", config.distributorId);
    writeDb(db);
  },

  async getCities() {
    await delay(100);
    return readDb().cities;
  },

  async saveCity(city) {
    await delay(160);
    const db = readDb();
    const idx = db.cities.findIndex((c) => c.name === city.name);
    if (idx >= 0) db.cities[idx] = city;
    else db.cities.push(city);
    audit(db, `ثبت شهر «${city.name}»`, "city", city.name);
    writeDb(db);
  },

  async deleteCity(name) {
    await delay(140);
    const db = readDb();
    db.cities = db.cities.filter((c) => c.name !== name);
    audit(db, `حذف شهر «${name}»`, "city", name);
    writeDb(db);
  },

  async getSettings() {
    await delay(100);
    const settings = readDb().settings;
    return { ...settings, proMonthlyPrice: settings.proMonthlyPrice ?? 1_490_000 };
  },

  async saveSettings(settings) {
    await delay(200);
    const db = readDb();
    db.settings = settings;
    audit(db, "به‌روزرسانی تنظیمات پلتفرم", "settings");
    writeDb(db);
  },

  async getStaff() {
    await delay(120);
    const db = readDb();
    return scope.distributorId ? db.staff.filter((s) => s.distributorId === scope.distributorId) : db.staff;
  },

  async saveStaff(input) {
    await delay(220);
    const db = readDb();
    const existing = input.id ? db.staff.find((s) => s.id === input.id) : undefined;
    const staff: Staff = {
      ...input,
      phone: normalizePhone(input.phone),
      roleLabel: ROLE_LABELS[input.role],
      id: existing?.id ?? createId("st"),
    };
    db.staff = existing ? db.staff.map((s) => (s.id === staff.id ? staff : s)) : [...db.staff, staff];
    audit(db, `${existing ? "ویرایش" : "دعوت"} کاربر «${staff.name}»`, "staff", staff.id);
    writeDb(db);
    return staff;
  },

  async getAuditLog() {
    await delay(140);
    return readDb().audit;
  },

  async getDrivers(opts) {
    await delay(140);
    const db = readDb();
    let rows = inScope(db.drivers);
    if (opts?.distributorId) rows = rows.filter((d) => d.distributorId === opts.distributorId);
    if (opts?.activeOnly) rows = rows.filter((d) => d.active);
    return rows.map((d) => listDriver(db, d));
  },

  async getDriver(id) {
    await delay(100);
    const db = readDb();
    const driver = db.drivers.find((d) => d.id === id);
    if (!driver || (scope.distributorId && driver.distributorId !== scope.distributorId)) return null;
    return listDriver(db, driver);
  },

  async saveDriver(input) {
    await delay(260);
    const db = readDb();
    const existing = input.id ? db.drivers.find((d) => d.id === input.id) : undefined;
    const distributorId = scope.distributorId ?? input.distributorId;
    if (existing && scope.distributorId && existing.distributorId !== scope.distributorId)
      return fail("دسترسی به این راننده ندارید");
    if (!db.distributors.some((d) => d.id === distributorId)) return fail("شرکت پخش معتبر نیست");
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username))
      return fail("شناسه باید با حرف انگلیسی شروع شود و فقط حروف کوچک، عدد، نقطه یا خط تیره داشته باشد");
    if (db.drivers.some((d) => d.username === username && d.id !== existing?.id))
      return fail("این شناسه قبلاً برای راننده دیگری ثبت شده است");
    if (!isValidIranMobile(input.phone)) return fail("شماره موبایل معتبر نیست");
    if (!existing && (!input.password || input.password.length < 6)) return fail("رمز عبور حداقل ۶ کاراکتر باشد");
    const now = new Date().toISOString();
    const driver: Driver = {
      id: existing?.id ?? createId("drv"),
      distributorId: existing?.distributorId ?? distributorId,
      username,
      name: input.name.trim(),
      phone: normalizePhone(input.phone),
      vehicle: input.vehicle?.type.trim()
        ? { type: input.vehicle.type.trim(), plate: input.vehicle.plate.trim() }
        : null,
      active: input.active,
      createdAt: existing?.createdAt ?? now,
      lastLoginAt: existing?.lastLoginAt,
      passwordUpdatedAt: existing?.passwordUpdatedAt ?? now,
    };
    db.drivers = existing ? db.drivers.map((d) => (d.id === driver.id ? driver : d)) : [...db.drivers, driver];
    audit(db, `${existing ? "ویرایش" : "ایجاد"} راننده «${driver.name}» (${driver.username})`, "driver", driver.id);
    writeDb(db);
    return ok(driver);
  },

  async setDriverActive(id, active) {
    await delay(180);
    const db = readDb();
    const driver = db.drivers.find((d) => d.id === id);
    if (!driver || (scope.distributorId && driver.distributorId !== scope.distributorId))
      return fail("راننده یافت نشد");
    driver.active = active;
    audit(db, `${active ? "فعال" : "غیرفعال"} کردن راننده «${driver.name}»`, "driver", id);
    writeDb(db);
    return ok({ ...driver });
  },

  async resetDriverPassword(id, password) {
    await delay(220);
    const db = readDb();
    const driver = db.drivers.find((d) => d.id === id);
    if (!driver || (scope.distributorId && driver.distributorId !== scope.distributorId))
      return fail("راننده یافت نشد");
    if (password.length < 6) return fail("رمز عبور حداقل ۶ کاراکتر باشد");
    driver.passwordUpdatedAt = new Date().toISOString();
    audit(db, `بازنشانی رمز عبور راننده «${driver.name}»`, "driver", id);
    writeDb(db);
    return ok({ passwordUpdatedAt: driver.passwordUpdatedAt });
  },

  async getDeliveries(filters = {}) {
    await delay(160);
    const db = readDb();
    let rows = inScope(db.deliveries);
    if (filters.driverId) rows = rows.filter((d) => d.driverId === filters.driverId);
    if (filters.orderId) rows = rows.filter((d) => d.orderId === filters.orderId);
    if (filters.status && filters.status !== "all") rows = rows.filter((d) => d.status === filters.status);
    if (filters.range === "today") rows = rows.filter((d) => isToday(d.deliveryDate));
    return [...rows].sort(
      (a, b) => b.deliveryDate.slice(0, 10).localeCompare(a.deliveryDate.slice(0, 10)) || a.sequence - b.sequence,
    );
  },

  async assignDriver(orderId, driverId) {
    await delay(240);
    const db = readDb();
    const order = db.orders.find((o) => o.id === orderId);
    if (!order || (scope.distributorId && order.distributorId !== scope.distributorId)) return fail("سفارش یافت نشد");
    if (!ASSIGNABLE_ORDER_STATUSES.includes(order.status))
      return fail(`برای سفارش «${ORDER_STATUS_LABELS[order.status]}» نمی‌توان راننده تعیین کرد`);
    const active = db.deliveries.find((d) => d.orderId === orderId && isActiveDelivery(d));
    if (active?.status === "awaiting_confirmation")
      return fail("کد تحویل این سفارش ثبت شده است؛ ابتدا تحویل را تایید یا رد کنید");

    if (driverId === null) {
      if (!active) return fail("برای این سفارش راننده‌ای تعیین نشده است");
      closeDelivery(active, "unassigned");
      audit(db, `برداشتن راننده «${active.driverName}» از سفارش ${order.number}`, "delivery", active.id);
      writeDb(db);
      return ok(withDelivery(db, order));
    }

    const driver = db.drivers.find((d) => d.id === driverId);
    if (!driver) return fail("راننده یافت نشد");
    if (driver.distributorId !== order.distributorId) return fail("این راننده متعلق به شرکت پخش این سفارش نیست");
    if (!driver.active) return fail("راننده غیرفعال است و نمی‌تواند سفارش بگیرد");
    if (active?.driverId === driverId) return ok(withDelivery(db, order));
    if (active) closeDelivery(active, "reassigned");

    const openToday = db.deliveries.filter(
      (d) => d.driverId === driverId && isToday(d.deliveryDate) && d.status !== "cancelled",
    );
    const delivery: Delivery = {
      id: createId("dl"),
      orderId: order.id,
      orderNumber: order.number,
      distributorId: order.distributorId,
      driverId,
      driverName: driver.name,
      sequence: Math.max(0, ...openToday.map((d) => d.sequence)) + 1,
      status: "assigned",
      closedReason: null,
      retailerName: order.retailerName,
      city: order.city,
      addressLabel: order.addressLabel,
      deliveryDate:
        isToday(order.deliveryDate) || new Date(order.deliveryDate) < new Date()
          ? new Date().toISOString()
          : order.deliveryDate,
      deliverySlot: order.deliverySlot,
      cartons: order.items.reduce((s, i) => s + i.qty, 0),
      orderStatus: order.status,
      assignedAt: new Date().toISOString(),
      assignedByName: actor(db).name,
      submittedAt: null,
      confirmedAt: null,
      confirmedByName: null,
      rejectedAt: null,
      rejectedByName: null,
      rejectionReason: null,
      failedAttempts: 0,
    };
    db.deliveries = [...db.deliveries, delivery];
    audit(
      db,
      active
        ? `واگذاری سفارش ${order.number} از «${active.driverName}» به «${driver.name}»`
        : `تخصیص سفارش ${order.number} به راننده «${driver.name}»`,
      "delivery",
      delivery.id,
    );
    writeDb(db);
    return ok(withDelivery(db, order));
  },

  async reorderRoute(driverId, deliveryIds) {
    await delay(160);
    const db = readDb();
    const own = db.deliveries.filter(
      (d) =>
        d.driverId === driverId &&
        isToday(d.deliveryDate) &&
        (!scope.distributorId || d.distributorId === scope.distributorId),
    );
    if (!deliveryIds.every((id) => own.some((d) => d.id === id))) return fail("ترتیب مسیر معتبر نیست");
    deliveryIds.forEach((id, i) => {
      const d = own.find((x) => x.id === id)!;
      d.sequence = i + 1;
    });
    audit(db, `تغییر ترتیب مسیر راننده «${own[0]?.driverName ?? ""}»`, "driver", driverId);
    writeDb(db);
    return ok(undefined);
  },

  async dispatchRoute(driverId) {
    await delay(260);
    const db = readDb();
    const driver = db.drivers.find((d) => d.id === driverId);
    if (!driver || (scope.distributorId && driver.distributorId !== scope.distributorId))
      return fail("راننده یافت نشد");
    const ready = db.deliveries.filter((d) => d.driverId === driverId && d.status === "assigned");
    let shipped = 0;
    for (const d of ready) {
      const order = db.orders.find((o) => o.id === d.orderId);
      if (order?.status !== "packing") continue;
      pushOrderEvent(db, order, "shipped", `ارسال با راننده ${driver.name}`);
      shipped += 1;
    }
    if (!shipped) return fail("سفارش آماده ارسالی (در حال بسته‌بندی) در مسیر این راننده نیست");
    audit(db, `ثبت ارسال ${shipped} سفارش با راننده «${driver.name}»`, "driver", driverId);
    writeDb(db);
    return ok({ shipped });
  },

  async confirmDelivery(deliveryId) {
    await delay(300);
    const db = readDb();
    const d = scopedDelivery(db, deliveryId);
    if (!d) return fail("تحویل یافت نشد");
    if (d.status === "confirmed") return fail("این تحویل قبلاً تایید شده است");
    if (d.status !== "awaiting_confirmation")
      return fail(`تحویل در وضعیت «${DELIVERY_STATUS_LABELS[d.status]}» قابل تایید نیست`);
    const order = db.orders.find((o) => o.id === d.orderId);
    if (!order || !canTransition(order.status, "delivered")) return fail("وضعیت سفارش اجازه ثبت تحویل نمی‌دهد");
    const now = new Date().toISOString();
    d.status = "confirmed";
    d.confirmedAt = now;
    d.confirmedByName = actor(db).name;
    pushOrderEvent(db, order, "delivered", `تایید تحویل با کد — راننده ${d.driverName}`);
    markNotificationRead(db, d.id);
    audit(db, `تایید تحویل سفارش ${d.orderNumber} (راننده «${d.driverName}»)`, "delivery", d.id);
    writeDb(db);
    return ok({ ...d });
  },

  async rejectDelivery(deliveryId, reason) {
    await delay(260);
    const db = readDb();
    const d = scopedDelivery(db, deliveryId);
    if (!d) return fail("تحویل یافت نشد");
    if (d.status !== "awaiting_confirmation")
      return fail(`تحویل در وضعیت «${DELIVERY_STATUS_LABELS[d.status]}» قابل رد نیست`);
    if (reason.trim().length < 3) return fail("دلیل رد را بنویسید");
    d.status = "rejected";
    d.rejectedAt = new Date().toISOString();
    d.rejectedByName = actor(db).name;
    d.rejectionReason = reason.trim();
    markNotificationRead(db, d.id);
    audit(db, `رد تایید تحویل سفارش ${d.orderNumber} (راننده «${d.driverName}»)`, "delivery", d.id);
    writeDb(db);
    return ok({ ...d });
  },

  async getAdminNotifications() {
    await delay(120);
    return [...inScope(readDb().adminNotifications)].sort((a, b) => b.at.localeCompare(a.at));
  },

  async markAdminNotificationsRead(ids) {
    await delay(60);
    const db = readDb();
    const now = new Date().toISOString();
    db.adminNotifications = db.adminNotifications.map((n) =>
      !n.readAt && (!ids || ids.includes(n.id)) && (!scope.distributorId || n.distributorId === scope.distributorId)
        ? { ...n, readAt: now }
        : n,
    );
    writeDb(db);
  },

  async devSimulateVerification(deliveryId) {
    await delay(500);
    const db = readDb();
    const d = scopedDelivery(db, deliveryId);
    if (!d || d.status !== "assigned") return fail("این تحویل در مسیر راننده نیست");
    if (d.orderStatus !== "shipped") return fail("ابتدا ارسال سفارش را ثبت کنید");
    d.status = "awaiting_confirmation";
    d.submittedAt = new Date().toISOString();
    db.adminNotifications = [
      {
        id: createId("an"),
        kind: "delivery_verified",
        distributorId: d.distributorId,
        deliveryId: d.id,
        orderId: d.orderId,
        orderNumber: d.orderNumber,
        retailerName: d.retailerName,
        driverName: d.driverName,
        at: d.submittedAt,
        readAt: null,
      },
      ...db.adminNotifications,
    ];
    writeDb(db);
    return ok({ ...d });
  },

  async resetDemoData() {
    const session = readDb().session;
    const db = seedDb();
    db.session = session;
    writeDb(db);
  },
};
