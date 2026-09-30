import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DISTRIBUTORS } from "@/data/catalog";
import { applyCoupon } from "@/lib/coupon";
import { api } from "@/services/client";
import type { DeliverySlot } from "@/lib/delivery";
import type { Address, AppConfig, CartItem, Distributor, Order, RetailerMe, RetailerPlan, Session, WalletTransaction } from "@/types";
import { cartTotal, type DistributorCatalog } from "@/services/api";
import { MIN_ORDER, PRO_MONTHLY_PRICE } from "@/types";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/theme";
import { cityIdFromName, distributorServesCity, getDistributor, resolveDistributorForCity, userCity } from "@/lib/distributors";
import { canAccessDistributor, canBrowseMarketplace } from "@/lib/plan";
import { isMarketplaceRequiresPro } from "@/lib/apiError";

type DraftPin = {
  city: string;
  lat: number;
  lng: number;
  streetLabel: string;
};

type AppState = {
  hydrated: boolean;
  session: Session | null;
  cartItems: CartItem[];
  distributorId: string;
  plan: RetailerPlan;
  primaryDistributorId: string | null;
  subscriptionExpiresAt: string | null;
  cityMismatch: boolean;
  upsellOpen: boolean;
  addresses: Address[];
  selectedAddressId: string | null;
  orders: Order[];
  walletBalance: number;
  walletTx: WalletTransaction[];
  toast: string;
  toastAction: { label: string; onClick: () => void } | null;
  couponCode: string | null;
  lastStoreId: string | null;
  draftPin: DraftPin | null;
  theme: Theme;
  deliverySlot: DeliverySlot | null;
  config: AppConfig | null;
  distributors: Distributor[];
  catalogs: Record<string, DistributorCatalog>;
  minOrder: number;
  proMonthlyPrice: number;
  hydrate: () => Promise<void>;
  applyMe: (me: RetailerMe) => void;
  refreshEntitlement: () => Promise<void>;
  refreshDistributors: () => Promise<void>;
  openPlanUpsell: () => void;
  closePlanUpsell: () => void;
  handleMarketplaceError: (err: unknown) => boolean;
  ensureDistributor: (id: string) => Promise<Distributor | null>;
  loadCatalog: (id: string, force?: boolean) => Promise<DistributorCatalog>;
  setTheme: (theme: Theme) => void;
  setToast: (msg: string, action?: { label: string; onClick: () => void } | null) => void;
  rememberStore: (id: string) => void;
  applyCouponCode: (code: string) => string | null;
  clearCoupon: () => void;
  setSession: (session: Session | null) => void;
  logout: () => Promise<void>;
  setDistributor: (id: string, clearCart?: boolean) => boolean;
  ensureCityDistributor: () => void;
  addItem: (item: CartItem) => void;
  inc: (id: string) => void;
  dec: (id: string) => void;
  remove: (id: string) => void;
  clearCart: () => void;
  setDeliverySlot: (slot: DeliverySlot | null) => void;
  setDraftPin: (pin: DraftPin | null) => void;
  saveAddress: (address: Omit<Address, "id"> & { id?: string }) => Promise<Address>;
  selectAddress: (id: string) => Promise<void>;
  refreshOrders: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  refreshAddresses: () => Promise<void>;
};

function emptyCatalog(): DistributorCatalog {
  return { products: [], categories: [] };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      session: null,
      cartItems: [],
      distributorId: "",
      plan: "free",
      primaryDistributorId: null,
      subscriptionExpiresAt: null,
      cityMismatch: false,
      upsellOpen: false,
      addresses: [],
      selectedAddressId: null,
      orders: [],
      walletBalance: 0,
      walletTx: [],
      toast: "",
      toastAction: null,
      couponCode: null,
      lastStoreId: null,
      draftPin: null,
      deliverySlot: null,
      config: null,
      distributors: DISTRIBUTORS,
      catalogs: {},
      minOrder: MIN_ORDER,
      proMonthlyPrice: PRO_MONTHLY_PRICE,
      theme: typeof document === "undefined" ? "light" : readStoredTheme(),
      setToast: (toast, toastAction = null) => set({ toast, toastAction: toast ? toastAction : null }),
      rememberStore: (id) => set({ lastStoreId: id }),
      openPlanUpsell: () => set({ upsellOpen: true }),
      closePlanUpsell: () => set({ upsellOpen: false }),
      handleMarketplaceError: (err) => {
        if (!isMarketplaceRequiresPro(err)) return false;
        set({ upsellOpen: true });
        return true;
      },
      applyCouponCode: (code) => {
        const result = applyCoupon(code, cartTotal(get().cartItems), get().distributorId);
        if (!result.ok) {
          set({ toast: result.error, toastAction: null });
          return result.error;
        }
        set({ couponCode: result.code, toast: `${result.title} اعمال شد`, toastAction: null });
        return null;
      },
      clearCoupon: () => set({ couponCode: null }),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setDraftPin: (draftPin) => set({ draftPin }),
      setDeliverySlot: (deliverySlot) => set({ deliverySlot }),
      applyMe(me) {
        const lastStoreId = get().lastStoreId;
        const nextId = me.plan === "pro" && lastStoreId
          ? lastStoreId
          : me.primaryDistributorId ?? "";
        set({
          session: get().session ? { ...get().session!, user: me.user } : get().session,
          plan: me.plan,
          primaryDistributorId: me.primaryDistributorId,
          subscriptionExpiresAt: me.subscriptionExpiresAt,
          distributorId: nextId,
        });
        get().ensureCityDistributor();
      },
      async refreshEntitlement() {
        try {
          const me = await api.getMe();
          get().applyMe(me);
          await get().refreshDistributors();
        } catch (err) {
          get().handleMarketplaceError(err);
        }
      },
      async refreshDistributors() {
        try {
          const city = userCity(get().addresses, get().selectedAddressId);
          const cityId = cityIdFromName(city, get().config?.cities ?? []);
          const distributors = await api.getDistributors(cityId ?? undefined);
          set({ distributors });
          get().ensureCityDistributor();
        } catch (err) {
          if (!get().handleMarketplaceError(err)) {
            set({ distributors: get().distributors.length ? get().distributors : DISTRIBUTORS });
          }
        }
      },
      async hydrate() {
        try {
          const session = api.getSession() ?? get().session;
          try {
            const config = await api.getConfig();
            set({
              config,
              minOrder: config.minOrder || MIN_ORDER,
              proMonthlyPrice: config.proMonthlyPrice || PRO_MONTHLY_PRICE,
            });
          } catch {
            set({ minOrder: MIN_ORDER, proMonthlyPrice: PRO_MONTHLY_PRICE });
          }
          if (session) {
            try {
              const [me, addresses, orders, wallet] = await Promise.all([
                api.getMe(),
                api.getAddresses(),
                api.getOrders(),
                api.getWallet(),
              ]);
              const selectedAddressId = api.selectedAddressId() ?? me.defaultAddressId ?? addresses[0]?.id ?? null;
              set({
                session: { ...session, user: me.user },
                addresses,
                selectedAddressId,
                orders,
                walletBalance: wallet.balance,
                walletTx: wallet.transactions,
                plan: me.plan,
                primaryDistributorId: me.primaryDistributorId,
                subscriptionExpiresAt: me.subscriptionExpiresAt,
                distributorId: me.plan === "pro" && get().lastStoreId ? get().lastStoreId! : me.primaryDistributorId ?? "",
                hydrated: true,
              });
              await get().refreshDistributors();
              return;
            } catch {
              set({
                session,
                hydrated: true,
                distributors: get().distributors.length ? get().distributors : DISTRIBUTORS,
              });
              return;
            }
          }
          try {
            const distributors = await api.getDistributors();
            if (distributors.length) set({ distributors });
          } catch {
            set({ distributors: get().distributors.length ? get().distributors : DISTRIBUTORS });
          }
          set({ hydrated: true, session: null, plan: "free", primaryDistributorId: null, subscriptionExpiresAt: null, distributorId: "" });
        } catch {
          set({
            hydrated: true,
            session: get().session,
            distributors: get().distributors.length ? get().distributors : DISTRIBUTORS,
            minOrder: MIN_ORDER,
            proMonthlyPrice: PRO_MONTHLY_PRICE,
          });
        }
      },
      async ensureDistributor(id) {
        if (!id) return null;
        const existing = getDistributor(id, get().distributors);
        if (existing && !existing.locked) return existing;
        try {
          const next = await api.getDistributor(id);
          if (next) {
            const list = get().distributors;
            set({ distributors: list.some((item) => item.id === next.id) ? list.map((item) => (item.id === next.id ? next : item)) : [...list, next] });
          }
          return next;
        } catch (err) {
          get().handleMarketplaceError(err);
          return null;
        }
      },
      async loadCatalog(id, force = false) {
        if (!id) return emptyCatalog();
        if (!force && get().catalogs[id]) return get().catalogs[id];
        try {
          const catalog = await api.getCatalog(id);
          set({ catalogs: { ...get().catalogs, [id]: catalog } });
          return catalog;
        } catch (err) {
          get().handleMarketplaceError(err);
          throw err;
        }
      },
      setSession: (session) => set({ session }),
      async logout() {
        await api.logout();
        set({
          session: null,
          cartItems: [],
          orders: [],
          walletBalance: 0,
          walletTx: [],
          addresses: [],
          selectedAddressId: null,
          deliverySlot: null,
          couponCode: null,
          plan: "free",
          primaryDistributorId: null,
          subscriptionExpiresAt: null,
          distributorId: "",
          cityMismatch: false,
          upsellOpen: false,
          catalogs: {},
        });
      },
      setDistributor: (id, clearCart) => {
        const { plan, primaryDistributorId, addresses, selectedAddressId, distributors } = get();
        if (!canAccessDistributor(plan, primaryDistributorId, id)) {
          set({ upsellOpen: true });
          return false;
        }
        const city = userCity(addresses, selectedAddressId);
        const list = distributors;
        const current = getDistributor(get().distributorId, list);
        const next = getDistributor(id, list);
        if (!next) return false;
        if (city && !distributorServesCity(next, city) && !canBrowseMarketplace(plan)) return false;
        const ratio = next.priceMultiplier / (current?.priceMultiplier ?? 1);
        const items = get().cartItems;
        const switching = next.id !== get().distributorId;
        const repriced = !clearCart && items.length > 0 && switching && Math.abs(ratio - 1) > 0.001;
        set({
          distributorId: id,
          lastStoreId: id,
          couponCode: get().couponCode && switching ? null : get().couponCode,
          cartItems: clearCart ? [] : items.map((item) => ({ ...item, price: Math.round(item.price * ratio) })),
          toast: repriced ? `قیمت سبد با ${next.name} به‌روز شد` : get().toast,
          toastAction: repriced ? null : get().toastAction,
          cityMismatch: false,
        });
        return true;
      },
      ensureCityDistributor: () => {
        const { addresses, selectedAddressId, distributorId, cartItems, distributors, plan, primaryDistributorId } = get();
        const city = userCity(addresses, selectedAddressId);
        if (!city) {
          set({ cityMismatch: false });
          return;
        }
        if (!canBrowseMarketplace(plan)) {
          const primary = getDistributor(primaryDistributorId ?? distributorId, distributors)
            ?? getDistributor(primaryDistributorId ?? "", DISTRIBUTORS);
          const mismatch = Boolean(primary && !distributorServesCity(primary, city));
          if (primary && get().distributorId !== primary.id) {
            set({ distributorId: primary.id, cityMismatch: mismatch });
            return;
          }
          set({ cityMismatch: mismatch });
          return;
        }
        const nextId = resolveDistributorForCity(distributorId || primaryDistributorId || "", city, distributors);
        if (!nextId || nextId === distributorId) {
          set({ cityMismatch: false });
          return;
        }
        const leaving = getDistributor(distributorId, distributors);
        const mustClear = Boolean(leaving && city && !distributorServesCity(leaving, city) && cartItems.length);
        get().setDistributor(nextId, mustClear);
        set({
          cityMismatch: false,
          toast: mustClear ? "سبد خرید با شرکت پخش این شهر هماهنگ شد" : "شرکت پخش این شهر انتخاب شد",
        });
      },
      addItem: (item) => {
        const existing = get().cartItems.find((i) => i.id === item.id);
        set((state) => {
          const found = state.cartItems.find((i) => i.id === item.id);
          if (found) {
            return { cartItems: state.cartItems.map((i) => (i.id === item.id ? { ...i, qty: i.qty + item.qty } : i)) };
          }
          return { cartItems: [...state.cartItems, item] };
        });
        if (!existing) {
          set({
            toast: `${item.name} به سبد اضافه شد`,
            toastAction: { label: "بازگردانی", onClick: () => get().remove(item.id) },
          });
        }
      },
      inc: (id) => set((state) => ({ cartItems: state.cartItems.map((i) => (i.id === id ? { ...i, qty: i.qty + 1 } : i)) })),
      dec: (id) =>
        set((state) => ({
          cartItems: state.cartItems
            .map((i) => (i.id === id ? { ...i, qty: i.qty - 1 } : i))
            .filter((i) => i.qty > 0),
        })),
      remove: (id) => set((state) => ({ cartItems: state.cartItems.filter((i) => i.id !== id) })),
      clearCart: () => set({ cartItems: [] }),
      async saveAddress(address) {
        const saved = await api.saveAddress(address);
        try {
          await get().refreshAddresses();
        } catch {
          set({
            addresses: [saved, ...get().addresses.filter((row) => row.id !== saved.id)],
            selectedAddressId: saved.id,
          });
          try {
            await get().refreshDistributors();
          } catch {
            /* shopping gates stay as-is; the address itself is saved */
          }
        }
        return saved;
      },
      async selectAddress(id) {
        await api.selectAddress(id);
        set({ selectedAddressId: id });
        await get().refreshDistributors();
      },
      async refreshOrders() {
        set({ orders: await api.getOrders() });
      },
      async refreshWallet() {
        const wallet = await api.getWallet();
        set({ walletBalance: wallet.balance, walletTx: wallet.transactions });
      },
      async refreshAddresses() {
        const addresses = await api.getAddresses();
        set({ addresses, selectedAddressId: api.selectedAddressId() ?? addresses[0]?.id ?? null });
        await get().refreshDistributors();
      },
    }),
    {
      name: "visitor:ui:v1",
      partialize: (s) => ({
        session: s.session,
        cartItems: s.cartItems,
        lastStoreId: s.lastStoreId,
        deliverySlot: s.deliverySlot,
        couponCode: s.couponCode,
        theme: s.theme,
      }),
    },
  ),
);

export function useCartMeta() {
  const items = useAppStore((s) => s.cartItems);
  const minOrder = useAppStore((s) => s.minOrder);
  const total = cartTotal(items);
  return { items, total, qty: items.reduce((s, i) => s + i.qty, 0), minMet: total >= minOrder, minOrder };
}
