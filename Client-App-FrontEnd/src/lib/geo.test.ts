import { describe, expect, it } from "vitest";
import { nearestCity, pinLabel } from "./geo";

describe("local map geocode", () => {
  it("resolves a Tabriz pin without a network lookup", () => {
    expect(nearestCity(38.08, 46.29).main).toBe("تبریز");
    expect(pinLabel(38.08, 46.29)).toBe("تبریز");
  });

  it("resolves Tehran from nearby coordinates", () => {
    expect(nearestCity(35.7, 51.4).main).toBe("تهران");
    expect(pinLabel(35.6892, 51.389)).toBe("تهران");
  });
});
