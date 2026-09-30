import { useActiveDistributorId } from "@/store/useSessionStore";

/** All scoped queries include the active distributor so switching scope refetches. */
export function useScopeKey() {
  return useActiveDistributorId() ?? "all";
}

export const keys = {
  dashboard: (scope: string) => ["dashboard", scope] as const,
  orders: (scope: string, filters?: unknown) => ["orders", scope, filters ?? {}] as const,
  order: (id: string) => ["order", id] as const,
  products: () => ["products"] as const,
  product: (id: string) => ["product", id] as const,
  stock: (scope: string) => ["stock", scope] as const,
  distributors: (scope: string) => ["distributors", scope] as const,
  distributor: (id: string) => ["distributor", id] as const,
  retailers: (scope: string, filters?: unknown) => ["retailers", scope, filters ?? {}] as const,
  retailer: (id: string) => ["retailer", id] as const,
  subscriptions: (filters?: unknown) => ["subscriptions", filters ?? {}] as const,
  retailerAddresses: (id: string) => ["retailer-addresses", id] as const,
  coupons: (scope: string) => ["coupons", scope] as const,
  banners: () => ["banners"] as const,
  messages: (scope: string) => ["messages", scope] as const,
  payments: (scope: string) => ["payments", scope] as const,
  wallets: () => ["wallets"] as const,
  slots: (distributorId: string) => ["slots", distributorId] as const,
  cities: () => ["cities"] as const,
  settings: () => ["settings"] as const,
  staff: (scope: string) => ["staff", scope] as const,
  audit: () => ["audit"] as const,
  drivers: (scope: string, opts?: unknown) => ["drivers", scope, opts ?? {}] as const,
  driver: (id: string) => ["driver", id] as const,
  deliveries: (scope: string, filters?: unknown) => ["deliveries", scope, filters ?? {}] as const,
  adminNotifications: (scope: string) => ["admin-notifications", scope] as const,
};
