import type { Address, AppConfig, CartItem, Distributor, Order, PendingPayment, Product, RetailerMe, RetailerSubscription, Session, User, WalletTransaction } from "@/types";
import type { CityDeal, PriceCompareRow } from "@/lib/deals";
import type { DeliveryDay, DeliveryTimeSlot } from "@/lib/delivery";

export type ApiError = { ok: false; error: string };
export type ApiOk<T> = { ok: true; data: T };

export type SlotDay = DeliveryDay & { times: DeliveryTimeSlot[] };

export type DistributorCatalog = {
  products: Product[];
  categories: string[];
};

export interface VisitorApi {
  sendOtp(phone: string): Promise<ApiOk<{ phone: string }> | ApiError>;
  verifyOtp(phone: string, code: string): Promise<ApiOk<Session> | ApiError>;
  loginDemo(): Promise<ApiOk<Session>>;
  logout(): Promise<void>;
  getSession(): Session | null;
  updateProfile(patch: Partial<Pick<User, "name">>): Promise<ApiOk<User> | ApiError>;
  getMe(): Promise<RetailerMe>;
  getSubscription(): Promise<RetailerSubscription>;
  checkoutSubscription(): Promise<{ paymentId: string; redirectUrl?: string; amount: number }>;
  setPrimaryDistributor(distributorId: string): Promise<{ primaryDistributorId: string }>;
  getConfig(): Promise<AppConfig>;
  getDistributors(cityId?: string): Promise<Distributor[]>;
  getDistributor(id: string): Promise<Distributor | null>;
  getCatalog(distributorId: string): Promise<DistributorCatalog>;
  getDeals(cityId: string): Promise<CityDeal[]>;
  getCompare(leftId: string, rightId: string): Promise<PriceCompareRow[]>;
  getSlots(distributorId: string): Promise<SlotDay[]>;
  getProducts(): Promise<Product[]>;
  searchProducts(query: string, distributorId?: string): Promise<Product[]>;
  getAddresses(): Promise<Address[]>;
  saveAddress(address: Omit<Address, "id"> & { id?: string }): Promise<Address>;
  selectAddress(id: string): Promise<void>;
  selectedAddressId(): string | null;
  getOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  getPayment(id: string): Promise<PendingPayment | null>;
  createPayment(kind: "order" | "wallet" | "subscription", amount: number, orderDraft?: PendingPayment["orderDraft"]): Promise<PendingPayment>;
  completePayment(id: string, status: "ok" | "fail"): Promise<ApiOk<{ order?: Order; balance?: number; plan?: "free" | "pro" }> | ApiError>;
  getWallet(): Promise<{ balance: number; transactions: WalletTransaction[] }>;
}

export function cartTotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function scaledCart(items: CartItem[], multiplier: number): CartItem[] {
  return items.map((item) => ({ ...item, price: Math.round(item.price * multiplier) }));
}
