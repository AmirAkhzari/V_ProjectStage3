import { describe, expect, it } from "vitest";
import { addJalaliDays, deliveryDays, JALALI_TODAY, slotLabel, timeSlots } from "./delivery";

describe("delivery slots", () => {
  it("rolls شهریور into مهر after day 31", () => {
    const next = addJalaliDays(JALALI_TODAY, 5);
    expect(next).toMatchObject({ year: 1405, month: 7, day: 1 });
  });

  it("hides today when the last window has passed", () => {
    const days = deliveryDays(23 * 60 + 19);
    expect(days[0]?.title).toBe("امروز");
    expect(days[0]?.available).toBe(false);
    expect(days[1]?.title).toBe("فردا");
    expect(days[1]?.available).toBe(true);
    expect(timeSlots(23 * 60 + 19, true)).toEqual([]);
  });

  it("keeps later today windows after morning", () => {
    const slots = timeSlots(10 * 60, true);
    expect(slots[0]?.time).toBe("10:45");
  });

  it("builds a Persian slot label", () => {
    const tomorrow = deliveryDays(23 * 60)[1]!;
    expect(slotLabel(tomorrow, "09:45")).toContain("فردا");
    expect(slotLabel(tomorrow, "09:45")).toContain("۰۹:۴۵");
  });
});
