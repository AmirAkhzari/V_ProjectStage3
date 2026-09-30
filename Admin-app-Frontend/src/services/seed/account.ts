// Mirrors ../FrontEnd/src/data/account.ts (coupons, messages) with admin fields.
import type { Coupon, Message, PlatformSettings } from "@/types";
import { MIN_ORDER, PRO_MONTHLY_PRICE, WALLET_MAX, WALLET_MIN } from "@/types";
import { daysAgo, daysAhead } from "@/lib/jalali";

export const SEED_COUPONS: Coupon[] = [
  {
    id: "cp1",
    code: "VISIT12",
    title: "۱۲٪ تخفیف خرید اول",
    kind: "percent",
    value: 12,
    minTotal: MIN_ORDER,
    expiresAt: daysAhead(10).toISOString(),
    usedCount: 148,
    maxUses: 500,
    active: true,
  },
  {
    id: "cp2",
    code: "ALBORZ50",
    title: "۵۰ هزار تومان اعتبار پخش البرز",
    kind: "fixed",
    value: 50_000,
    distributorId: "d2",
    expiresAt: daysAhead(25).toISOString(),
    usedCount: 37,
    maxUses: 200,
    active: true,
  },
  {
    id: "cp3",
    code: "TABRIZ8",
    title: "۸٪ تخفیف پخش‌های تبریز",
    kind: "percent",
    value: 8,
    minTotal: 1_000_000,
    distributorId: "d5",
    expiresAt: daysAhead(45).toISOString(),
    usedCount: 12,
    active: true,
  },
  {
    id: "cp4",
    code: "MEHR100",
    title: "۱۰۰ هزار تومان اعتبار مهرگان",
    kind: "fixed",
    value: 100_000,
    minTotal: 2_000_000,
    expiresAt: daysAgo(5).toISOString(),
    usedCount: 320,
    maxUses: 320,
    active: false,
  },
];

export const SEED_MESSAGES: Message[] = [
  {
    id: "m1",
    title: "سفارش VT-482193 در مسیر ارسال",
    body: "توزیع البرز تا ساعت ۱۸ امروز به فروشگاه شما می‌رسد.",
    kind: "order",
    audience: { type: "distributor", distributorId: "d2" },
    sentAt: daysAgo(0, 14, 20).toISOString(),
    recipients: 1,
  },
  {
    id: "m2",
    title: "تخفیف ویژه روغن اویلا",
    body: "تا پایان هفته ۱۲٪ تخفیف روی روغن نباتی ۱.۸ لیتری.",
    kind: "promo",
    audience: { type: "all" },
    sentAt: daysAgo(1, 9, 10).toISOString(),
    recipients: 328,
  },
  {
    id: "m3",
    title: "موجودی آب معدنی دماوند",
    body: "موجودی کارتن‌های ۱.۵ لیتری دوباره تکمیل شد.",
    kind: "stock",
    audience: { type: "city", city: "تبریز" },
    sentAt: daysAgo(3, 12, 0).toISOString(),
    recipients: 96,
  },
  {
    id: "m4",
    title: "پخش نقش جهان به ویزیتور پیوست",
    body: "فروشگاه‌های اصفهان و نجف‌آباد از امروز می‌توانند سفارش دهند.",
    kind: "promo",
    audience: { type: "city", city: "اصفهان" },
    sentAt: daysAgo(9, 10, 30).toISOString(),
    recipients: 41,
  },
];

export const SEED_SETTINGS: PlatformSettings = {
  brandName: "ویزیتور",
  minOrder: MIN_ORDER,
  walletMin: WALLET_MIN,
  walletMax: WALLET_MAX,
  supportPhone: "02191001234",
  proMonthlyPrice: PRO_MONTHLY_PRICE,
};
