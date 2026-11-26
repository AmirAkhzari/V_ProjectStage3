import { HOME_BANNERS, SEARCH_CATEGORIES, DISTRIBUTOR_STOCK, DISTRIBUTORS, PRODUCTS, categoriesForDistributor, pricedProduct, productsForDistributor } from "@/data/catalog";
import { cityDealTiles, overlappingPrices } from "@/lib/deals";
import { clockMinutes, deliveryDays, timeSlots } from "@/lib/delivery";
import { createId, nowLabel } from "@/lib/format";
import { isValidIranMobile, normalizePhone } from "@/lib/phone";
import { fuzzyScore } from "@/lib/search";
import { CITIES } from "@/data/cities";
import { marketplaceRequiresPro } from "@/lib/apiError";
import { canAccessDistributor, canComparePrices, selectVisibleDistributors, withPrimaryFlag } from "@/lib/plan";
import { DEMO_OTP, MIN_ORDER, PRO_MONTHLY_PRICE, WALLET_MAX, WALLET_MIN, type Address, type AppConfig, type ConfigCity, type Order, type PendingPayment, type Product, type RetailerMe, type RetailerPlan, type RetailerSubscription, type Session, type User, type WalletTransaction } from "@/types";
import type { ApiError, ApiOk, VisitorApi } from "./api";

export const MOCK_PLAN_KEY = "visitor:mock:plan";

const CITY_IDS: Record<string, string> = {
  تهران: "ct_tehran",
  تبریز: "ct_tabriz",
  کرج: "ct_karaj",
  اصفهان: "ct_isfahan",
  مراغه: "ct_maragheh",
  خوی: "ct_khoy",
  شهریار: "ct_shahriar",
  اسلامشهر: "ct_eslamshahr",
  "نجف‌آباد": "ct_najafabad",
};

function configCities(): ConfigCity[] {
  return CITIES.map((city) => ({
    id: CITY_IDS[city.main] ?? `ct_${city.main}`,
    name: city.main,
    province: city.sub.replace(/^شهر .+، استان /, ""),
    lat: city.lat,
    lng: city.lng,
  }));
}

function mockConfig(entitlement?: { plan: RetailerPlan; primaryDistributorId: string | null; subscriptionExpiresAt: string | null }): AppConfig {
  return {
    minOrder: MIN_ORDER,
    walletMin: WALLET_MIN,
    walletMax: WALLET_MAX,
    proMonthlyPrice: PRO_MONTHLY_PRICE,
    plan: entitlement?.plan ?? "free",
    primaryDistributorId: entitlement?.primaryDistributorId ?? null,
    subscriptionExpiresAt: entitlement?.subscriptionExpiresAt ?? null,
    cities: configCities(),
    categories: SEARCH_CATEGORIES.map((cat, index) => ({
      id: `cat_${index}`,
      name: cat.label,
      slug: cat.label,
      imageUrl: cat.img,
      showOnHome: true,
      showInSearch: true,
    })),
    banners: HOME_BANNERS,
  };
}

function catalogFor(distributorId: string) {
  const dist = DISTRIBUTORS.find((item) => item.id === distributorId);
  const products = productsForDistributor(distributorId).map((product, index, list) => ({
    ...pricedProduct(product, dist?.priceMultiplier ?? 1),
    available: index !== list.length - 1,
  }));
  return { products, categories: categoriesForDistributor(distributorId) };
}

const KEY = "visitor:db:v1";
const delay = (ms = 280) => new Promise((resolve) => setTimeout(resolve, ms));

type Db = {
  session: Session | null;
  users: Record<string, User>;
  otps: Record<string, string>;
  addresses: Address[];
  selectedAddressId: string | null;
  orders: Order[];
  walletBalance: number;
  walletTx: WalletTransaction[];
  payments: PendingPayment[];
  plan: RetailerPlan;
  primaryDistributorId: string | null;
  subscriptionExpiresAt: string | null;
};

function emptyDb(): Db {
  return {
    session: null,
    users: {},
    otps: {},
    addresses: [],
    selectedAddressId: null,
    orders: [],
    walletBalance: 0,
    walletTx: [],
    payments: [],
    plan: "free",
    primaryDistributorId: null,
    subscriptionExpiresAt: null,
  };
}

function readPlanOverride(): RetailerPlan | null {
  try {
    const raw = localStorage.getItem(MOCK_PLAN_KEY);
    return raw === "pro" || raw === "free" ? raw : null;
  } catch {
    return null;
  }
}

export function setMockPlan(plan: RetailerPlan) {
  localStorage.setItem(MOCK_PLAN_KEY, plan);
  const db = readDb();
  db.plan = plan;
  db.subscriptionExpiresAt = plan === "pro" ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null;
  writeDb(db);
}

function entitlementOf(db: Db) {
  const override = readPlanOverride();
  const expired = db.subscriptionExpiresAt ? new Date(db.subscriptionExpiresAt).getTime() <= Date.now() : true;
  const plan: RetailerPlan = override ?? (db.plan === "pro" && !expired ? "pro" : "free");
  return {
    plan,
    primaryDistributorId: db.primaryDistributorId,
    subscriptionExpiresAt: plan === "pro" ? db.subscriptionExpiresAt : null,
  };
}

function assertDistributorAccess(db: Db, distributorId: string) {
  const entitlement = entitlementOf(db);
  if (!canAccessDistributor(entitlement.plan, entitlement.primaryDistributorId, distributorId)) {
    throw marketplaceRequiresPro();
  }
}

function decorateDistributor(id: string, primaryDistributorId: string | null) {
  const row = DISTRIBUTORS.find((item) => item.id === id);
  if (!row) return null;
  return withPrimaryFlag(row, primaryDistributorId);
}

function readDb(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDb();
    return { ...emptyDb(), ...JSON.parse(raw) } as Db;
  } catch {
    return emptyDb();
  }
}

function writeDb(db: Db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
function fail(error: string): ApiError {
  return { ok: false, error };
}

function requireSession(db: Db) {
  if (!db.session) throw new Error("UNAUTH");
  return db.session;
}

const demoUser: User = { id: "user_demo", name: "فروشگاه ملحمی", phone: "09143662051" };

const demoAddress: Address = {
  id: "addr_demo",
  title: "فروشگاه اصلی",
  fullAddress: "تبریز، نیروی هوایی، گجیل، پلاک ۲۴",
  plaque: "۲۴",
  unit: "۱",
  tag: "store",
  city: "تبریز",
  lat: 38.08,
  lng: 46.29,
  streetLabel: "نیروی هوایی",
};

function demoOrders(): Order[] {
  const soda = PRODUCTS[0];
  const cola = PRODUCTS[2];
  const oil = PRODUCTS.find((p) => p.id === "p2")!;
  return [
    {
      id: "ord_demo_1",
      number: "VT-482193",
      status: "current",
      createdAt: new Date().toISOString(),
      deliveryDate: "۲۳ شهریور ۱۴۰۵",
      total: soda.price * 2 + cola.price,
      discount: 18_000,
      distributorId: "d2",
      distributorName: "توزیع و پخش البرز",
      addressLabel: demoAddress.fullAddress,
      items: [
        { id: soda.id, name: soda.name, price: soda.price, img: soda.img, unitsPerCarton: soda.unitsPerCarton, qty: 2 },
        { id: cola.id, name: cola.name, price: cola.price, img: cola.img, unitsPerCarton: cola.unitsPerCarton, qty: 1 },
      ],
    },
    {
      id: "ord_demo_2",
      number: "VT-471002",
      status: "delivered",
      createdAt: new Date().toISOString(),
      deliveryDate: "۱۲ شهریور ۱۴۰۵",
      total: oil.price,
      discount: 0,
      distributorId: "d1",
      distributorName: "شرکت پخش ایران (مرکزی)",
      addressLabel: demoAddress.fullAddress,
      items: [{ id: oil.id, name: oil.name, price: oil.price, img: oil.img, unitsPerCarton: oil.unitsPerCarton, qty: 1 }],
    },
    {
      id: "ord_demo_3",
      number: "VT-460881",
      status: "cancelled",
      createdAt: new Date().toISOString(),
      deliveryDate: "۸ شهریور ۱۴۰۵",
      total: soda.price,
      discount: 0,
      distributorId: "d1",
      distributorName: "شرکت پخش ایران (مرکزی)",
      addressLabel: demoAddress.fullAddress,
      items: [{ id: soda.id, name: soda.name, price: soda.price, img: soda.img, unitsPerCarton: soda.unitsPerCarton, qty: 1 }],
    },
  ];
}

export const mockApi: VisitorApi = {
  async sendOtp(phone) {
    await delay();
    const normalized = normalizePhone(phone);
    if (!isValidIranMobile(normalized)) return fail("شماره موبایل معتبر نیست");
    const db = readDb();
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
    const user = db.users[normalized] ?? { id: createId("user"), name: "فروشگاه جدید", phone: normalized };
    db.users[normalized] = user;
    db.session = { token: createId("tok"), user };
    delete db.otps[normalized];
    writeDb(db);
    return ok(db.session);
  },

  async loginDemo() {
    await delay(180);
    const db = readDb();
    db.users[demoUser.phone] = demoUser;
    db.session = { token: createId("tok"), user: demoUser };
    if (!db.addresses.some((a) => a.id === demoAddress.id)) {
      db.addresses = [demoAddress, ...db.addresses];
    }
    db.selectedAddressId = demoAddress.id;
    if (!db.primaryDistributorId) db.primaryDistributorId = "d1";
    if (db.orders.length === 0) db.orders = demoOrders();
    if (db.walletBalance === 0) {
      db.walletBalance = 185_000;
      db.walletTx = [{ id: "tx_demo", amount: 185_000, createdAt: "۱۴ شهریور", status: "success", kind: "topup" }];
    }
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

  async updateProfile(patch) {
    await delay(160);
    const db = readDb();
    const session = requireSession(db);
    const next = { ...session.user, ...patch };
    db.session = { ...session, user: next };
    db.users[next.phone] = next;
    writeDb(db);
    return ok(next);
  },

  async getMe() {
    await delay(40);
    const db = readDb();
    const session = requireSession(db);
    const entitlement = entitlementOf(db);
    return {
      user: session.user,
      defaultAddressId: db.selectedAddressId,
      plan: entitlement.plan,
      primaryDistributorId: entitlement.primaryDistributorId,
      subscriptionExpiresAt: entitlement.subscriptionExpiresAt,
    } satisfies RetailerMe;
  },

  async getSubscription() {
    await delay(40);
    const db = readDb();
    requireSession(db);
    const entitlement = entitlementOf(db);
    return {
      plan: entitlement.plan,
      primaryDistributorId: entitlement.primaryDistributorId,
      expiresAt: entitlement.subscriptionExpiresAt,
      renewal: entitlement.plan === "pro",
      price: PRO_MONTHLY_PRICE,
      history: entitlement.subscriptionExpiresAt
        ? [{
            id: "sub_mock",
            plan: "pro",
            status: entitlement.plan === "pro" ? "active" : "expired",
            startsAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
            expiresAt: entitlement.subscriptionExpiresAt,
          }]
        : [],
    } satisfies RetailerSubscription;
  },

  async checkoutSubscription() {
    await delay(120);
    const db = readDb();
    requireSession(db);
    const payment: PendingPayment = { id: createId("pay"), kind: "subscription", amount: PRO_MONTHLY_PRICE };
    db.payments = [payment, ...db.payments].slice(0, 12);
    writeDb(db);
    return { paymentId: payment.id, amount: payment.amount };
  },

  async startPayment(id) {
    await delay(80);
    const db = readDb();
    requireSession(db);
    const payment = db.payments.find((p) => p.id === id);
    if (!payment) throw new Error("پرداخت یافت نشد");
    const gatewayAuthority = `MOCK-${payment.id}`;
    return {
      paymentId: payment.id,
      redirectUrl: `mock://pay/${gatewayAuthority}`,
      amount: payment.amount,
      status: "pending",
      authority: gatewayAuthority,
    };
  },

  async completeGatewayPayment(gatewayAuthority, status) {
    // The mock gateway encodes the payment in the authority, mirroring the server's mock:// redirect.
    return this.completePayment(gatewayAuthority.replace(/^MOCK-/, ""), status);
  },

  async setPrimaryDistributor(distributorId) {
    await delay(80);
    const db = readDb();
    requireSession(db);
    if (db.primaryDistributorId) {
      throw new Error("شرکت پخش اصلی قبلا انتخاب شده است");
    }
    const dist = DISTRIBUTORS.find((item) => item.id === distributorId);
    if (!dist) throw new Error("شرکت پخش معتبر نیست");
    const selected = db.addresses.find((item) => item.id === db.selectedAddressId) ?? db.addresses[0];
    if (selected && !dist.cities.includes(selected.city)) {
      throw new Error("این شرکت پخش شهر شما را پوشش نمی‌دهد");
    }
    db.primaryDistributorId = distributorId;
    writeDb(db);
    return { primaryDistributorId: distributorId };
  },

  async getConfig() {
    await delay(40);
    const db = readDb();
    return mockConfig(db.session ? entitlementOf(db) : undefined);
  },

  async getDistributors(cityId) {
    await delay(60);
    const db = readDb();
    const entitlement = db.session ? entitlementOf(db) : null;
    const city = cityId ? mockConfig().cities.find((item) => item.id === cityId) : undefined;
    const rows = city ? DISTRIBUTORS.filter((item) => item.cities.includes(city.name)) : DISTRIBUTORS;
    if (!entitlement) return [];
    return selectVisibleDistributors(rows, entitlement.plan, entitlement.primaryDistributorId)
      .map((row) => withPrimaryFlag(row, entitlement.primaryDistributorId));
  },

  async getDistributor(id) {
    await delay(40);
    const db = readDb();
    if (db.session) assertDistributorAccess(db, id);
    return decorateDistributor(id, db.primaryDistributorId);
  },

  async getCatalog(distributorId) {
    await delay(80);
    const db = readDb();
    if (db.session) assertDistributorAccess(db, distributorId);
    return catalogFor(distributorId);
  },

  async getDeals(cityId) {
    await delay(80);
    const db = readDb();
    const city = mockConfig().cities.find((item) => item.id === cityId);
    if (!city) return [];
    const entitlement = db.session ? entitlementOf(db) : null;
    const tiles = cityDealTiles(city.name);
    if (!entitlement) return [];
    const allowed = new Set(selectVisibleDistributors(tiles.map((tile) => tile.distributor), entitlement.plan, entitlement.primaryDistributorId).map((row) => row.id));
    return tiles.filter((tile) => allowed.has(tile.distributor.id));
  },

  async getCompare(leftId, rightId) {
    await delay(80);
    const db = readDb();
    const entitlement = db.session ? entitlementOf(db) : null;
    if (!entitlement || !canComparePrices(entitlement.plan)) throw marketplaceRequiresPro();
    assertDistributorAccess(db, leftId);
    assertDistributorAccess(db, rightId);
    return overlappingPrices(leftId, rightId);
  },

  async getSlots(distributorId) {
    await delay(60);
    const db = readDb();
    if (db.session) assertDistributorAccess(db, distributorId);
    const now = clockMinutes();
    return deliveryDays(now).map((day) => ({
      ...day,
      times: timeSlots(now, day.offset === 0),
    }));
  },

  async getProducts() {
    await delay(120);
    const db = readDb();
    const entitlement = db.session ? entitlementOf(db) : null;
    const distributorId = entitlement?.plan === "free" ? entitlement.primaryDistributorId ?? undefined : undefined;
    if (distributorId) return catalogFor(distributorId).products;
    return PRODUCTS;
  },

  async searchProducts(query, distributorId) {
    await delay(80);
    const db = readDb();
    const entitlement = db.session ? entitlementOf(db) : null;
    const scopedId = distributorId ?? (entitlement?.plan === "free" ? entitlement.primaryDistributorId ?? undefined : undefined);
    if (scopedId && db.session) assertDistributorAccess(db, scopedId);
    if (!query.trim()) return [];
    const stock = scopedId ? new Set(DISTRIBUTOR_STOCK[scopedId] ?? []) : null;
    const dist = scopedId ? DISTRIBUTORS.find((item) => item.id === scopedId) : null;
    return PRODUCTS
      .filter((p) => !stock || stock.has(p.id))
      .map((p) => {
        const product = dist ? pricedProduct(p, dist.priceMultiplier) : p;
        return { p: product, score: Math.max(fuzzyScore(query, p.name), fuzzyScore(query, p.sku), fuzzyScore(query, p.brand)) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  },

  async getAddresses() {
    await delay(80);
    return readDb().addresses;
  },

  async saveAddress(address) {
    await delay(160);
    const db = readDb();
    requireSession(db);
    const saved: Address = { ...address, id: address.id ?? createId("addr") };
    const idx = db.addresses.findIndex((a) => a.id === saved.id);
    if (idx >= 0) db.addresses[idx] = saved;
    else db.addresses = [saved, ...db.addresses];
    db.selectedAddressId = saved.id;
    writeDb(db);
    return saved;
  },

  async selectAddress(id) {
    const db = readDb();
    db.selectedAddressId = id;
    writeDb(db);
  },

  selectedAddressId() {
    return readDb().selectedAddressId;
  },

  async getOrders() {
    await delay(100);
    const db = readDb();
    if (db.session?.user.id === "user_demo" && db.orders.length === 0) {
      db.orders = demoOrders();
      writeDb(db);
    }
    return db.orders;
  },

  async getOrder(id) {
    await delay(80);
    return readDb().orders.find((o) => o.id === id) ?? null;
  },

  async getPayment(id) {
    await delay(40);
    return readDb().payments.find((p) => p.id === id) ?? null;
  },

  async createPayment(kind, amount, orderDraft) {
    await delay(200);
    const db = readDb();
    requireSession(db);
    if (kind === "order") {
      if (!orderDraft) throw new Error("ORDER_DRAFT");
      assertDistributorAccess(db, orderDraft.distributorId);
      const total = orderDraft.items.reduce((s, i) => s + i.price * i.qty, 0);
      if (total < MIN_ORDER) throw new Error("MIN_ORDER");
    }
    if (kind === "subscription") {
      const row = await this.checkoutSubscription();
      return { id: row.paymentId, kind, amount: row.amount };
    }
    const payment: PendingPayment = { id: createId("pay"), kind, amount, orderDraft };
    db.payments = [payment, ...db.payments].slice(0, 12);
    writeDb(db);
    return payment;
  },

  async completePayment(id, status) {
    await delay(400);
    const db = readDb();
    const session = requireSession(db);
    const payment = db.payments.find((p) => p.id === id);
    if (!payment) return fail("پرداخت یافت نشد");
    db.payments = db.payments.filter((p) => p.id !== id);
    if (status !== "ok") {
      writeDb(db);
      return fail("پرداخت ناموفق بود");
    }
    if (payment.kind === "subscription") {
      db.plan = "pro";
      db.subscriptionExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
      localStorage.setItem(MOCK_PLAN_KEY, "pro");
      writeDb(db);
      return ok({ plan: "pro" as const });
    }
    if (payment.kind === "wallet") {
      db.walletBalance += payment.amount;
      db.walletTx = [{ id: createId("tx"), amount: payment.amount, createdAt: nowLabel(), status: "success", kind: "topup" }, ...db.walletTx];
      writeDb(db);
      return ok({ balance: db.walletBalance });
    }
    const draft = payment.orderDraft!;
    const order: Order = {
      id: createId("ord"),
      number: `VT-${Math.floor(100000 + Math.random() * 900000)}`,
      status: "current",
      createdAt: new Date().toISOString(),
      deliveryDate: draft.deliveryDate,
      total: payment.amount,
      discount: draft.discount,
      distributorId: draft.distributorId,
      distributorName: DISTRIBUTORS.find((d) => d.id === draft.distributorId)?.name ?? "شرکت پخش",
      addressLabel: draft.addressLabel,
      items: draft.items,
    };
    db.orders = [order, ...db.orders];
    writeDb(db);
    void session;
    return ok({ order });
  },

  async getWallet() {
    await delay(80);
    const db = readDb();
    if (db.session?.user.id === "user_demo" && db.walletBalance === 0 && db.walletTx.length === 0) {
      db.walletBalance = 185_000;
      db.walletTx = [{ id: "tx_demo", amount: 185_000, createdAt: "۱۴ شهریور", status: "success", kind: "topup" }];
      writeDb(db);
    }
    return { balance: db.walletBalance, transactions: db.walletTx };
  },
};

export function getProductsSync(): Product[] {
  return PRODUCTS;
}
