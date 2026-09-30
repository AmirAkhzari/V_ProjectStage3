import { describe, expect, it } from "vitest";
import { toGregorian, toJalali } from "./jalali";

describe("jalali", () => {
  it("converts known dates", () => {
    expect(toJalali(new Date(2026, 8, 20))).toEqual({
      year: 1405,
      month: 6,
      day: 29,
    });
    expect(toJalali(new Date(2024, 2, 20))).toEqual({
      year: 1403,
      month: 1,
      day: 1,
    });
  });

  it("round-trips", () => {
    const d = new Date(2025, 11, 31);
    const back = toGregorian(toJalali(d));
    expect(back.getFullYear()).toBe(2025);
    expect(back.getMonth()).toBe(11);
    expect(back.getDate()).toBe(31);
  });
});
