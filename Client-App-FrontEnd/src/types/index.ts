export type AddressTag = "store" | "warehouse" | "branch";

export type OrderStatus = "current" | "delivered" | "cancelled";

export type PaymentKind = "order" | "wallet" | "subscription";

export type RetailerPlan = "free" | "pro";

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
  lastOrder?: { cartons: number; daysAgo: number };
  available?: boolean;
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
  isPrimary?: boolean;
  locked?: boolean;
};

export type HomeBanner = {
  id: string;
  title: string;
  subtitle: string;
};

export type Address = {
  id: string;
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

export type Order = {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  deliveryDate: string;
  total: number;
  discount: number;
  distributorId: string;
  distributorName: string;
  addressLabel: string;
  items: OrderItem[];
};

export type WalletTransaction = {
  id: string;
  amount: number;
  createdAt: string;
  status: "success" | "failed";
  kind: "topup";
};

export type PendingPayment = {
  id: string;
  kind: PaymentKind;
  amount: number;
  orderDraft?: {
    deliveryDate: string;
    discount: number;
    items: CartItem[];
    distributorId: string;
    addressLabel: string;
    addressId?: string;
    deliveryDay?: string;
    deliveryTime?: string;
    couponCode?: string;
  };
};

export type Session = {
  token: string;
  user: User;
};

export type City = {
  main: string;
  sub: string;
  lat: number;
  lng: number;
};

export type CategoryMeta = {
  label: string;
  img: string;
};

export type ConfigCity = {
  id: string;
  name: string;
  province: string;
  lat: number;
  lng: number;
};

export type ConfigCategory = {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
  showOnHome: boolean;
  showInSearch: boolean;
};

export type AppConfig = {
  minOrder: number;
  walletMin: number;
  walletMax: number;
  cities: ConfigCity[];
  categories: ConfigCategory[];
  banners: HomeBanner[];
  proMonthlyPrice: number;
  plan?: RetailerPlan;
  primaryDistributorId?: string | null;
  subscriptionExpiresAt?: string | null;
};

export type RetailerMe = {
  user: User;
  defaultAddressId: string | null;
  plan: RetailerPlan;
  primaryDistributorId: string | null;
  subscriptionExpiresAt: string | null;
};

export type SubscriptionHistoryItem = {
  id: string;
  plan: RetailerPlan;
  status: "active" | "expired" | "cancelled";
  startsAt: string;
  expiresAt: string;
};

export type RetailerSubscription = {
  plan: RetailerPlan;
  primaryDistributorId: string | null;
  expiresAt: string | null;
  renewal: boolean;
  price: number;
  history?: SubscriptionHistoryItem[];
};

export const PRO_MONTHLY_PRICE = 1_490_000;

export const MIN_ORDER = 500_000;
export const WALLET_MIN = 10_000;
export const WALLET_MAX = 10_000_000;
export const DEMO_OTP = "12345";
