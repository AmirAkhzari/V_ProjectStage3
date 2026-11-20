import type { Address, AppConfig, CartItem, Distributor, HomeBanner, Order, PendingPayment, Product, RetailerMe, RetailerSubscription, Session, SubscriptionHistoryItem, User, WalletTransaction } from "@/types";
import type { CityDeal, PriceCompareRow } from "@/lib/deals";
import { isMarketplaceRequiresPro } from "@/lib/apiError";
import { MIN_ORDER, PRO_MONTHLY_PRICE, WALLET_MAX, WALLET_MIN } from "@/types";
import type { ApiError, ApiOk, SlotDay, VisitorApi } from "./api";
import { apiFetch, readBundle, writeBundle } from "./http";

function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
function fail(error: string): ApiError {
  return { ok: false, error };
}

function toAddress(row: Record<string, unknown>): Address {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    fullAddress: String(row.fullAddress ?? ""),
    plaque: String(row.plaque ?? ""),
    unit: String(row.unit ?? ""),
    tag: (row.tag as Address["tag"]) ?? null,
    branchName: row.branchName as string | undefined,
    city: String(row.cityName ?? row.city ?? ""),
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
    streetLabel: String(row.streetLabel ?? ""),
  };
}

function toOrder(row: Record<string, unknown>): Order {
  const items = (Array.isArray(row.items) ? row.items : []) as CartItem[];
  return {
    id: String(row.id),
    number: String(row.number ?? ""),
    status: (row.clientStatus as Order["status"]) ?? (row.status === "delivered" || row.status === "cancelled" ? row.status : "current"),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    deliveryDate: [row.deliveryDate, row.deliverySlot].filter(Boolean).join("، ") || String(row.deliveryDate ?? ""),
    total: Number(row.total ?? 0),
    discount: Number(row.discount ?? 0),
    distributorId: String(row.distributorId ?? ""),
    distributorName: String(row.distributorName ?? ""),
    addressLabel: String(row.addressLabel ?? ""),
    items,
  };
}

function readCategory(row: Record<string, unknown>): string {
  const raw = row.category ?? row.categoryName ?? row.categoryId;
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    return String(value.name ?? value.label ?? value.slug ?? value.id ?? "");
  }
  return String(raw ?? "");
}

function readCatalogCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const value = item as Record<string, unknown>;
      return String(value.name ?? value.label ?? value.slug ?? value.id ?? "");
    }
    return "";
  }).filter(Boolean);
}

function toProduct(row: Record<string, unknown>): Product {
  const category = readCategory(row);
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    size: String(row.size ?? ""),
    price: Number(row.price ?? 0),
    original: row.original != null ? Number(row.original) : undefined,
    disc: row.disc != null ? Number(row.disc) : undefined,
    img: String(row.img ?? ""),
    brand: String(row.brand ?? ""),
    category,
    subCategory: String(row.subCategory ?? category),
    sku: String(row.sku ?? ""),
    unitsPerCarton: Number(row.unitsPerCarton ?? 1),
    minOrderQty: Number(row.minOrderQty ?? 1),
    lastOrder: row.lastOrder as Product["lastOrder"],
    available: row.available as boolean | undefined,
  };
}

function toDistributor(row: Record<string, unknown>): Distributor {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    logoText: String(row.logoText ?? ""),
    logoTone: row.logoTone === "secondary" ? "secondary" : "accent",
    status: row.status === "full" ? "full" : "active",
    deliveryMins: Number(row.deliveryMins ?? 45),
    deliveryFee: row.deliveryFee === "free" || row.deliveryFee === 0 ? "free" : Number(row.deliveryFee ?? 0),
    priceMultiplier: Number(row.priceMultiplier ?? 1),
    cities: Array.isArray(row.cities) ? row.cities.map(String) : [],
    rating: Number(row.rating ?? 0),
    area: row.area ? String(row.area) : undefined,
    pro: Boolean(row.pro),
    minBasket: Number(row.minBasket ?? MIN_ORDER),
    isPrimary: Boolean(row.isPrimary),
    locked: Boolean(row.locked),
  };
}

function persistAuth(data: { accessToken: string; refreshToken: string; user: User }) {
  writeBundle({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
    selectedAddressId: readBundle()?.selectedAddressId ?? null,
  });
  return { token: data.accessToken, user: data.user } satisfies Session;
}

function jalaliKeyToIso(key: string) {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return key;
  const jy = Number(match[1]);
  if (jy < 1700) {
    const { toGregorian } = jalaliToGregorian;
    const g = toGregorian({ year: jy, month: Number(match[2]), day: Number(match[3]) });
    const y = g.getFullYear();
    const m = String(g.getMonth() + 1).padStart(2, "0");
    const d = String(g.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return key;
}

const jalaliToGregorian = {
  toGregorian(j: { year: number; month: number; day: number }) {
    const div = (a: number, b: number) => Math.trunc(a / b);
    const jy = j.year + 1595;
    let days = -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + j.day + (j.month < 7 ? (j.month - 1) * 31 : (j.month - 7) * 30 + 186);
    let gy = 400 * div(days, 146097);
    days %= 146097;
    if (days > 36524) {
      gy += 100 * div(--days, 36524);
      days %= 36524;
      if (days >= 365) days++;
    }
    gy += 4 * div(days, 1461);
    days %= 1461;
    if (days > 365) {
      gy += div(days - 1, 365);
      days = (days - 1) % 365;
    }
    let gd = days + 1;
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 1;
    for (; gm <= 12 && gd > monthDays[gm]; gm++) gd -= monthDays[gm];
    return new Date(gy, gm - 1, gd);
  },
};

export const httpApi: VisitorApi = {
  async sendOtp(phone) {
    try {
      const data = await apiFetch<{ phone: string }>("/auth/otp/send", { method: "POST", json: { phone } });
      return ok(data);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "ارسال کد ناموفق بود");
    }
  },

  async verifyOtp(phone, code) {
    try {
      const data = await apiFetch<{ accessToken: string; refreshToken: string; user: User }>("/auth/otp/verify", {
        method: "POST",
        json: { phone, code },
      });
      return ok(persistAuth(data));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "کد تایید نادرست است");
    }
  },

  async loginDemo() {
    try {
      const data = await apiFetch<{ accessToken: string; refreshToken: string; user: User }>("/auth/demo", { method: "POST" });
      return ok(persistAuth(data));
    } catch (e) {
      throw e instanceof Error ? e : new Error("ورود آزمایشی ناموفق بود");
    }
  },

  async logout() {
    const bundle = readBundle();
    try {
      if (bundle?.refreshToken) {
        await apiFetch("/auth/logout", { method: "POST", json: { refreshToken: bundle.refreshToken } });
      }
    } catch {
      /* still clear local session */
    }
    writeBundle(null);
  },

  getSession() {
    const bundle = readBundle();
    if (!bundle) return null;
    return { token: bundle.accessToken, user: bundle.user };
  },

  async updateProfile(patch) {
    try {
      // A8 answers the same profile envelope A7 reads, so the session stores its `user` part. `name`
      // is null on a shop that has never saved one; the UI keeps the phone fallback.
      const row = await apiFetch<{ user: User }>("/me", { method: "PATCH", json: patch });
      const user = { ...row.user, name: row.user.name ?? "" };
      const bundle = readBundle();
      if (bundle) writeBundle({ ...bundle, user });
      return ok(user);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "ذخیره ناموفق بود");
    }
  },

  async getMe() {
    const row = await apiFetch<{
      user: User;
      defaultAddressId: string | null;
      plan?: "free" | "pro";
      primaryDistributorId?: string | null;
      subscriptionExpiresAt?: string | null;
    }>("/me");
    return {
      // A7's `name` is null until A8 saves one; the PWA's `User` type keeps a string.
      user: { ...row.user, name: row.user.name ?? "" },
      defaultAddressId: row.defaultAddressId ?? null,
      plan: row.plan === "pro" ? "pro" : "free",
      primaryDistributorId: row.primaryDistributorId ?? null,
      subscriptionExpiresAt: row.subscriptionExpiresAt ?? null,
    } satisfies RetailerMe;
  },

  async getSubscription() {
    const row = await apiFetch<{
      plan?: "free" | "pro";
      primaryDistributorId?: string | null;
      expiresAt?: string | null;
      renewal?: boolean;
      price?: number;
      history?: SubscriptionHistoryItem[];
    }>("/me/subscription");
    return {
      plan: row.plan === "pro" ? "pro" : "free",
      primaryDistributorId: row.primaryDistributorId ?? null,
      expiresAt: row.expiresAt ?? null,
      renewal: Boolean(row.renewal),
      price: row.price ?? PRO_MONTHLY_PRICE,
      history: Array.isArray(row.history) ? (row.history as SubscriptionHistoryItem[]) : [],
    } satisfies RetailerSubscription;
  },

  async checkoutSubscription() {
    return apiFetch<{ paymentId: string; redirectUrl?: string; amount: number }>("/me/subscription/checkout", {
      method: "POST",
    });
  },

  async setPrimaryDistributor(distributorId) {
    return apiFetch<{ primaryDistributorId: string }>("/me/primary-distributor", {
      method: "POST",
      json: { distributorId },
    });
  },

  async getConfig() {
    const row = await apiFetch<{
      minOrder?: number;
      walletMin?: number;
      walletMax?: number;
      proMonthlyPrice?: number;
      plan?: "free" | "pro";
      primaryDistributorId?: string | null;
      subscriptionExpiresAt?: string | null;
      cities?: Array<{ id: string; name: string; province: string; lat: number; lng: number }>;
      categories?: Array<{ id: string; name: string; slug: string; imageUrl?: string | null; showOnHome?: boolean; showInSearch?: boolean }>;
      banners?: Array<{ id: string; title: string; subtitle: string }>;
    }>("/config");
    return {
      minOrder: row.minOrder ?? MIN_ORDER,
      walletMin: row.walletMin ?? WALLET_MIN,
      walletMax: row.walletMax ?? WALLET_MAX,
      proMonthlyPrice: row.proMonthlyPrice ?? PRO_MONTHLY_PRICE,
      plan: row.plan === "pro" ? "pro" : "free",
      primaryDistributorId: row.primaryDistributorId ?? null,
      subscriptionExpiresAt: row.subscriptionExpiresAt ?? null,
      cities: row.cities ?? [],
      categories: (row.categories ?? []).map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        imageUrl: cat.imageUrl,
        showOnHome: Boolean(cat.showOnHome),
        showInSearch: Boolean(cat.showInSearch),
      })),
      banners: (row.banners ?? []) as HomeBanner[],
    } satisfies AppConfig;
  },

  async getDistributors(cityId) {
    const qs = cityId ? `?cityId=${encodeURIComponent(cityId)}` : "";
    const rows = await apiFetch<Record<string, unknown>[]>(`/distributors${qs}`);
    return rows.map(toDistributor);
  },

  async getDistributor(id) {
    try {
      return toDistributor(await apiFetch<Record<string, unknown>>(`/distributors/${id}`));
    } catch (err) {
      if (isMarketplaceRequiresPro(err)) throw err;
      return null;
    }
  },

  async getCatalog(distributorId) {
    const row = await apiFetch<{ products: Record<string, unknown>[]; categories?: unknown[] }>(`/distributors/${distributorId}/catalog`);
    const products = (row.products ?? []).map(toProduct);
    const fromApi = readCatalogCategories(row.categories);
    const fromProducts = [...new Set(products.map((product) => product.category).filter(Boolean))];
    return {
      products,
      categories: fromApi.length ? [...new Set([...fromApi, ...fromProducts])] : fromProducts,
    };
  },

  async getDeals(cityId) {
    const rows = await apiFetch<Array<{ product: Record<string, unknown>; distributor: Record<string, unknown> }>>(`/deals?cityId=${encodeURIComponent(cityId)}`);
    return rows.map((row) => ({
      product: toProduct(row.product),
      distributor: toDistributor(row.distributor),
    })) satisfies CityDeal[];
  },

  async getCompare(leftId, rightId) {
    const qs = new URLSearchParams({ left: leftId, right: rightId });
    const rows = await apiFetch<Array<{
      product: Record<string, unknown>;
      left: Record<string, unknown>;
      right: Record<string, unknown>;
      leftDistributor?: Record<string, unknown>;
      rightDistributor?: Record<string, unknown>;
    }>>(`/compare?${qs}`);
    const [leftDist, rightDist] = await Promise.all([
      rows[0]?.leftDistributor ? toDistributor(rows[0].leftDistributor) : this.getDistributor(leftId),
      rows[0]?.rightDistributor ? toDistributor(rows[0].rightDistributor) : this.getDistributor(rightId),
    ]);
    if (!leftDist || !rightDist) return [];
    return rows
      .filter((row) => row.right)
      .map((row) => ({
        product: toProduct(row.product),
        left: toProduct(row.left),
        right: toProduct(row.right),
        leftDistributor: leftDist,
        rightDistributor: rightDist,
      })) satisfies PriceCompareRow[];
  },

  async getSlots(distributorId) {
    return apiFetch<SlotDay[]>(`/distributors/${distributorId}/slots`);
  },

  async getProducts() {
    const me = await apiFetch<{ user: User; defaultAddressId: string | null }>("/me").catch(() => null);
    if (me?.defaultAddressId) {
      const bundle = readBundle();
      if (bundle) writeBundle({ ...bundle, selectedAddressId: me.defaultAddressId });
    }
    const rows = await apiFetch<Product[] | { products: Product[] }>("/search?q=");
    if (Array.isArray(rows)) return rows.map((p) => toProduct(p as unknown as Record<string, unknown>));
    return (rows.products ?? []).map((p) => toProduct(p as unknown as Record<string, unknown>));
  },

  async searchProducts(query, distributorId) {
    const qs = new URLSearchParams({ q: query });
    if (distributorId) qs.set("distributorId", distributorId);
    const rows = await apiFetch<Product[]>(`/search?${qs}`);
    return rows.map((p) => toProduct(p as unknown as Record<string, unknown>));
  },

  async getAddresses() {
    const rows = await apiFetch<Record<string, unknown>[]>("/me/addresses");
    return rows.map(toAddress);
  },

  async saveAddress(address) {
    const path = address.id ? `/me/addresses/${address.id}` : "/me/addresses";
    try {
      const row = await apiFetch<Record<string, unknown>>(path, {
        method: address.id ? "PUT" : "POST",
        // A10's body is strict: exactly the fields it stores, with the city as `cityName` and no
        // client-side `id`. An edit still goes through A11, which is not live yet.
        json: {
          title: address.title,
          fullAddress: address.fullAddress,
          plaque: address.plaque,
          unit: address.unit,
          tag: address.tag,
          branchName: address.branchName,
          cityName: address.city,
          lat: address.lat,
          lng: address.lng,
          streetLabel: address.streetLabel,
        },
      });
      const saved = toAddress(row);
      const bundle = readBundle();
      if (bundle) writeBundle({ ...bundle, selectedAddressId: saved.id });
      return saved;
    } catch (err) {
      if (err instanceof Error && /failed to fetch|network/i.test(err.message)) {
        throw new Error("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
      }
      throw err instanceof Error ? err : new Error("ثبت آدرس انجام نشد. دوباره تلاش کنید.");
    }
  },

  async selectAddress(id) {
    await apiFetch("/me/addresses/default", { method: "PUT", json: { addressId: id } });
    const bundle = readBundle();
    if (bundle) writeBundle({ ...bundle, selectedAddressId: id });
  },

  selectedAddressId() {
    return readBundle()?.selectedAddressId ?? null;
  },

  async getOrders() {
    const rows = await apiFetch<Record<string, unknown>[]>("/me/orders");
    return rows.map(toOrder);
  },

  async getOrder(id) {
    try {
      return toOrder(await apiFetch<Record<string, unknown>>(`/me/orders/${id}`));
    } catch {
      return null;
    }
  },

  async getPayment(id) {
    try {
      const row = await apiFetch<{ id: string; amount: number; kind: "order" | "wallet_topup" | "subscription"; orderId?: string }>(`/payments/${id}`);
      return {
        id: row.id,
        kind: row.kind === "wallet_topup" ? "wallet" : row.kind === "subscription" ? "subscription" : "order",
        amount: row.amount,
      };
    } catch {
      return null;
    }
  },

  async createPayment(kind, amount, orderDraft) {
    if (kind === "subscription") {
      const row = await this.checkoutSubscription();
      return { id: row.paymentId, kind, amount: row.amount };
    }
    if (kind === "wallet") {
      const row = await apiFetch<{ paymentId: string }>("/me/wallet/topups", { method: "POST", json: { amount }, idempotency: true });
      return { id: row.paymentId, kind, amount };
    }
    if (!orderDraft) throw new Error("ORDER_DRAFT");
    const bundle = readBundle();
    const addressId = orderDraft.addressId ?? bundle?.selectedAddressId;
    if (!addressId) throw new Error("ADDRESS_REQUIRED");
    const payload = {
      distributorId: orderDraft.distributorId,
      items: orderDraft.items.map((item) => ({ productId: item.id, qty: item.qty })),
      couponCode: orderDraft.couponCode,
      addressId,
      deliveryDate: jalaliKeyToIso(orderDraft.deliveryDay ?? orderDraft.deliveryDate),
      deliverySlot: orderDraft.deliveryTime ?? "10:00",
      paymentMethod: "gateway" as const,
      expectedTotal: amount,
    };
    const result = await apiFetch<{ order: Record<string, unknown>; payment?: { id: string } }>("/checkout", {
      method: "POST",
      json: payload,
      idempotency: true,
    });
    return {
      id: result.payment?.id ?? String(result.order.id),
      kind,
      amount,
      orderDraft,
    };
  },

  async completePayment(id, status) {
    try {
      const res = await apiFetch<{ ok: boolean; data?: { order?: Record<string, unknown>; balance?: number; plan?: "free" | "pro" } }>(
        `/payments/${id}/mock-complete`,
        { method: "POST", json: { outcome: status === "ok" ? "ok" : "fail" } },
      );
      if (!res.ok) return fail("پرداخت ناموفق بود");
      return ok({
        order: res.data?.order ? toOrder(res.data.order) : undefined,
        balance: res.data?.balance,
        plan: res.data?.plan,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "پرداخت ناموفق بود");
    }
  },

  async getWallet() {
    const row = await apiFetch<{
      balance: number;
      transactions: Array<{ id: string; amount: number; createdAt: string; kind: string }>;
    }>("/me/wallet");
    const transactions: WalletTransaction[] = row.transactions.map((tx) => ({
      id: tx.id,
      amount: tx.amount,
      createdAt: tx.createdAt,
      status: "success",
      kind: "topup",
    }));
    return { balance: row.balance, transactions };
  },
};
