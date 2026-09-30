import { describe, expect, it } from "vitest";
import { applyCoupon } from "./coupon";

describe("coupons", () => {
  it("applies VISIT12 as 12 percent after minimum order", () => {
    const result = applyCoupon("visit12", 1_000_000, "d1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amount).toBe(120_000);
  });

  it("rejects ALBORZ50 on a non-Alborz company", () => {
    const result = applyCoupon("ALBORZ50", 600_000, "d1");
    expect(result.ok).toBe(false);
  });

  it("applies ALBORZ50 on البرز", () => {
    const result = applyCoupon("ALBORZ50", 600_000, "d2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amount).toBe(50_000);
  });
});
