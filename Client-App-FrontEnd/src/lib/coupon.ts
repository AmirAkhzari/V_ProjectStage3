import { DEMO_COUPONS } from "@/data/account";
import { MIN_ORDER } from "@/types";

export type CouponResult =
  | { ok: true; code: string; amount: number; title: string }
  | { ok: false; error: string };

export function normalizeCoupon(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function applyCoupon(code: string, total: number, distributorId: string): CouponResult {
  const normalized = normalizeCoupon(code);
  if (!normalized) return { ok: false, error: "کد تخفیف را وارد کنید" };
  const coupon = DEMO_COUPONS.find((item) => item.code === normalized);
  if (!coupon) return { ok: false, error: "کد تخفیف معتبر نیست" };
  if (normalized === "VISIT12") {
    if (total < MIN_ORDER) return { ok: false, error: "این کد پس از رسیدن به حداقل سفارش اعمال می‌شود" };
    return { ok: true, code: normalized, amount: Math.round(total * 0.12), title: coupon.title };
  }
  if (normalized === "ALBORZ50") {
    if (distributorId !== "d2") return { ok: false, error: "این کد فقط برای پخش البرز است" };
    return { ok: true, code: normalized, amount: 50_000, title: coupon.title };
  }
  return { ok: false, error: "کد تخفیف معتبر نیست" };
}
