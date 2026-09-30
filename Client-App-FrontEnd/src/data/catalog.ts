import type { CategoryMeta, Distributor, HomeBanner, Product } from "@/types";
import { MIN_ORDER } from "@/types";

export const DISTRIBUTORS: Distributor[] = [
  { id: "d1", name: "شرکت پخش ایران", logoText: "پخش\nایران", logoTone: "accent", status: "active", deliveryMins: 45, deliveryFee: 14_000, priceMultiplier: 1, cities: ["تبریز", "مراغه"], rating: 4.8, area: "مرکزی", pro: true, minBasket: MIN_ORDER },
  { id: "d2", name: "توزیع و پخش البرز", logoText: "البرز\nپخش", logoTone: "secondary", status: "active", deliveryMins: 60, deliveryFee: "free", priceMultiplier: 1.05, cities: ["کرج", "تهران"], rating: 4.5, area: "البرز", pro: true, minBasket: MIN_ORDER },
  { id: "d3", name: "شرکت توزیع آریا تجارت", logoText: "آریا\nتجارت", logoTone: "accent", status: "full", deliveryMins: 90, deliveryFee: "free", priceMultiplier: 0.97, cities: ["تبریز"], rating: 4.2, area: "گجیل", pro: true, minBasket: MIN_ORDER },
  { id: "d4", name: "پخش پیشرو نوین", logoText: "پیشرو\nنوین", logoTone: "secondary", status: "active", deliveryMins: 30, deliveryFee: 8_000, priceMultiplier: 1.08, cities: ["تهران", "اسلامشهر", "شهریار"], rating: 4.6, area: "تهران", pro: true, minBasket: MIN_ORDER },
  { id: "d5", name: "پخش آذربایجان", logoText: "پخش\nآذر", logoTone: "accent", status: "active", deliveryMins: 40, deliveryFee: "free", priceMultiplier: 1.02, cities: ["تبریز", "خوی"], rating: 4.7, area: "نیروی هوایی", pro: true, minBasket: MIN_ORDER },
  { id: "d6", name: "پخش سهند تبریز", logoText: "سهند", logoTone: "secondary", status: "active", deliveryMins: 55, deliveryFee: 12_000, priceMultiplier: 0.99, cities: ["تبریز"], rating: 4.3, area: "گلشهر", minBasket: MIN_ORDER },
  { id: "d7", name: "پخش پایتخت", logoText: "پایتخت", logoTone: "accent", status: "active", deliveryMins: 35, deliveryFee: "free", priceMultiplier: 1.04, cities: ["تهران"], rating: 4.4, area: "مرکز", pro: true, minBasket: MIN_ORDER },
  { id: "d8", name: "پخش نقش جهان", logoText: "نقش\nجهان", logoTone: "secondary", status: "active", deliveryMins: 50, deliveryFee: 10_000, priceMultiplier: 1.01, cities: ["اصفهان", "نجف‌آباد"], rating: 4.1, area: "اصفهان", minBasket: MIN_ORDER },
];

export const HOME_BANNERS: HomeBanner[] = [
  { id: "b1", title: "ویژه خرید اول!", subtitle: "تخفیف روی اولین سفارش عمده از شرکت پخش شهر شما" },
  { id: "b2", title: "ارسال رایگان", subtitle: "برای سفارش بالای حداقل از پخش‌های منتخب" },
  { id: "b3", title: "تخفیف تا ۴۰٪", subtitle: "کالاهایی که همه شرکت‌های پخش با تخفیف دارند" },
];

export const HOME_CATEGORIES = [
  { id: 0, label: "همه" },
  { id: 1, label: "نوشیدنی" },
  { id: 2, label: "لبنیات" },
  { id: 3, label: "خواربار" },
  { id: 4, label: "بهداشتی" },
  { id: 5, label: "تنقلات" },
  { id: 6, label: "روغن و چربی" },
  { id: 7, label: "کنسرو" },
];

export const SEARCH_CATEGORIES: CategoryMeta[] = [
  { label: "تنقلات", img: "/images/dairy/dkp_11920446.webp" },
  { label: "لبنیات", img: "/images/dairy/dkp_1927692.webp" },
  { label: "خواربار", img: "/images/dairy/dkp_13577334.webp" },
  { label: "میوه و سبزیجات", img: "/images/dairy/dkp_21808495.webp" },
  { label: "نوشیدنی", img: "/images/dairy/dkp_856657.webp" },
  { label: "بهداشتی", img: "/images/dairy/dkp_11649950.webp" },
  { label: "کنسرو", img: "/images/dairy/dkp_1514409.webp" },
  { label: "صبحانه", img: "/images/dairy/dkp_20446800.webp" },
];

export const TRENDING = ["شیر", "روغن", "بستنی", "پنیر", "تخم مرغ", "چیپس", "ماست", "آب معدنی", "نوشابه"];

export const CATEGORY_TABS: Record<string, { subs: string[]; filters: string[] }> = {
  نوشیدنی: { subs: ["نوشیدنی", "لبنیات", "تنقلات", "خواربار"], filters: ["آب معدنی", "ماءالشعیر", "آبمیوه", "چای و قهوه"] },
  لبنیات: { subs: ["لبنیات", "نوشیدنی", "تنقلات", "خواربار"], filters: ["شیر", "ماست", "پنیر", "کره"] },
  تنقلات: { subs: ["تنقلات", "لبنیات", "خواربار", "نوشیدنی"], filters: ["چیپس", "پفک", "آجیل", "شکلات"] },
  خواربار: { subs: ["خواربار", "تنقلات", "کنسرو", "نوشیدنی"], filters: ["برنج", "روغن", "قند و شکر", "آرد"] },
  بهداشتی: { subs: ["بهداشتی", "خواربار"], filters: ["شامپو", "صابون", "خمیردندان", "مایع ظرفشویی"] },
  default: { subs: ["نوشیدنی", "لبنیات", "تنقلات", "خواربار"], filters: ["همه", "پرفروش", "تخفیف‌دار", "جدید"] },
};

export const PRODUCTS: Product[] = [
  { id: "c1", name: "نوشابه پرتقالی فانتا ۳۳۰ میلی‌لیتری", size: "۳۳۰ میلی لیتری", price: 83_400, img: "/images/dairy/dkp_8927256.webp", brand: "فانتا", category: "نوشیدنی", subCategory: "نوشابه", sku: "FT-330-OR", unitsPerCarton: 24, minOrderQty: 1, lastOrder: { cartons: 5, daysAgo: 12 } },
  { id: "c2", name: "نوشابه کوکاکولا ۳۳۰ میلی‌لیتری", size: "۳۳۰ میلی لیتری", price: 83_500, img: "/images/dairy/dkp_801329.webp", brand: "کوکاکولا", category: "نوشیدنی", subCategory: "نوشابه", sku: "CC-330", unitsPerCarton: 24, minOrderQty: 2 },
  { id: "c3", name: "نوشابه کوکاکولا ۱.۵ لیتری", size: "۱.۵ لیتری", price: 115_900, original: 122_000, disc: 5, img: "/images/dairy/dkp_20828858.webp", brand: "کوکاکولا", category: "نوشیدنی", subCategory: "نوشابه", sku: "CC-1500", unitsPerCarton: 12, minOrderQty: 1, lastOrder: { cartons: 10, daysAgo: 3 } },
  { id: "c4", name: "نوشیدنی هلو پالپ‌دار رانی ۲۴۰ میلی‌لیتری", size: "۲۴۰ میلی لیتری", price: 85_500, original: 95_000, disc: 10, img: "/images/dairy/dkp_6350879.webp", brand: "رانی", category: "نوشیدنی", subCategory: "آبمیوه", sku: "RN-240-PE", unitsPerCarton: 30, minOrderQty: 3 },
  { id: "c5", name: "آب معدنی دماوند ۱.۵ لیتری", size: "۱.۵ لیتری", price: 28_000, img: "/images/dairy/dkp_2726997.webp", brand: "دماوند", category: "نوشیدنی", subCategory: "آب معدنی", sku: "DW-1500", unitsPerCarton: 12, minOrderQty: 1, lastOrder: { cartons: 20, daysAgo: 7 } },
  { id: "c6", name: "آبمیوه سیب طبیعی ۱ لیتری", size: "۱ لیتری", price: 72_000, original: 80_000, disc: 10, img: "/images/dairy/dkp_1688250.webp", brand: "محلی", category: "نوشیدنی", subCategory: "آبمیوه", sku: "AJ-1000-AP", unitsPerCarton: 6, minOrderQty: 2 },
  { id: "d1p", name: "شیر پاستوریزه میهن ۱ لیتری", size: "۱ لیتری", price: 45_000, img: "/images/dairy/dkp_17665891.webp", brand: "میهن", category: "لبنیات", subCategory: "شیر", sku: "MH-1000", unitsPerCarton: 12, minOrderQty: 1, lastOrder: { cartons: 8, daysAgo: 5 } },
  { id: "d2p", name: "ماست پاستوریزه کاله ۴۵۰ گرمی", size: "۴۵۰ گرمی", price: 38_000, img: "/images/dairy/dkp_888330.webp", brand: "کاله", category: "لبنیات", subCategory: "ماست", sku: "KL-450-YG", unitsPerCarton: 12, minOrderQty: 2 },
  { id: "d3p", name: "پنیر پیتزای رامک ۴۵۰ گرمی", size: "۴۵۰ گرمی", price: 85_000, original: 95_000, disc: 11, img: "/images/dairy/dkp_13972449.webp", brand: "رامک", category: "لبنیات", subCategory: "پنیر", sku: "RM-450-CH", unitsPerCarton: 8, minOrderQty: 1 },
  { id: "d4p", name: "کره حیوانی صباح ۱۰۰ گرمی", size: "۱۰۰ گرمی", price: 68_000, img: "/images/dairy/dkp_22765361.webp", brand: "صباح", category: "لبنیات", subCategory: "کره", sku: "SB-100-BT", unitsPerCarton: 24, minOrderQty: 5 },
  { id: "t1", name: "چیپس خانواده ۱۷۰ گرمی", size: "۱۷۰ گرمی", price: 42_000, img: "/images/dairy/dkp_21963470.webp", brand: "خانواده", category: "تنقلات", subCategory: "چیپس", sku: "KH-170-CH", unitsPerCarton: 24, minOrderQty: 1, lastOrder: { cartons: 6, daysAgo: 20 } },
  { id: "t2", name: "شکلات کیت‌کت ۴۱.۵ گرمی", size: "۴۱.۵ گرمی", price: 55_000, original: 60_000, disc: 8, img: "/images/dairy/dkp_20381248.webp", brand: "کیت‌کت", category: "تنقلات", subCategory: "شکلات", sku: "KK-415", unitsPerCarton: 36, minOrderQty: 2 },
  { id: "t3", name: "پفک نمکی ۶۵ گرمی", size: "۶۵ گرمی", price: 22_000, img: "/images/dairy/dkp_2692305.webp", brand: "محلی", category: "تنقلات", subCategory: "پفک", sku: "PF-065", unitsPerCarton: 48, minOrderQty: 1 },
  { id: "t4", name: "آجیل مخلوط ممتاز ۵۰۰ گرمی", size: "۵۰۰ گرمی", price: 185_000, original: 220_000, disc: 16, img: "/images/dairy/dkp_1515226.webp", brand: "ممتاز", category: "تنقلات", subCategory: "آجیل", sku: "MZ-500-NX", unitsPerCarton: 12, minOrderQty: 3 },
  { id: "p2", name: "روغن نباتی اویلا ۱.۸ لیتر", size: "۱.۸ لیتری", price: 1_850_000, original: 2_100_000, disc: 12, img: "/images/dairy/dkp_4347782.webp", brand: "اویلا", category: "خواربار", subCategory: "روغن", sku: "OL-180", unitsPerCarton: 6, minOrderQty: 1 },
  { id: "p6", name: "مایع ظرفشویی گلرنگ ۱ لیتر", size: "۱ لیتری", price: 880_000, original: 1_020_000, disc: 14, img: "/images/dairy/dkp_7230365.webp", brand: "گلرنگ", category: "بهداشتی", subCategory: "مایع ظرفشویی", sku: "DW-100", unitsPerCarton: 12, minOrderQty: 1 },
];

export const BESTSELLERS = ["c5", "p2", "t1", "d1p", "c6", "p6"];

const idsByCategory = (category: string) => PRODUCTS.filter((product) => product.category === category).map((product) => product.id);

export const DISTRIBUTOR_STOCK: Record<string, string[]> = {
  d1: PRODUCTS.map((product) => product.id),
  d2: [...idsByCategory("نوشیدنی"), ...idsByCategory("لبنیات")],
  d3: [...idsByCategory("لبنیات"), ...idsByCategory("تنقلات")],
  d4: [...idsByCategory("تنقلات"), ...idsByCategory("خواربار")],
  d5: [...idsByCategory("نوشیدنی"), ...idsByCategory("تنقلات"), ...idsByCategory("بهداشتی")],
  d6: [...idsByCategory("خواربار"), ...idsByCategory("لبنیات"), ...idsByCategory("بهداشتی")],
  d7: [...idsByCategory("نوشیدنی"), ...idsByCategory("تنقلات")],
  d8: [...idsByCategory("خواربار"), ...idsByCategory("لبنیات")],
};

export function productsForDistributor(distributorId: string) {
  const stock = new Set(DISTRIBUTOR_STOCK[distributorId] ?? []);
  return PRODUCTS.filter((product) => stock.has(product.id));
}

export function dealsForDistributor(distributorId: string) {
  return productsForDistributor(distributorId)
    .filter((product) => product.disc)
    .sort((a, b) => (b.disc ?? 0) - (a.disc ?? 0));
}

export function categoriesForDistributor(distributorId: string) {
  return [...new Set(productsForDistributor(distributorId).map((product) => product.category))];
}

export function pricedProduct(product: Product, multiplier: number) {
  const price = Math.round(product.price * multiplier);
  const original = product.original ? Math.round(product.original * multiplier) : undefined;
  return { ...product, price, original };
}

export function productToCartItem(product: Product, qty = 1) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    img: product.img,
    unitsPerCarton: product.unitsPerCarton,
    qty,
  };
}

export function oosProductId(products: Product[]) {
  return products.at(-1)?.id;
}
