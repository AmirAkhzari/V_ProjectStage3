import { describe, expect, it } from "vitest";
import { cityIdFromName, distributorsInCity, distributorServesCity, resolveDistributorForCity } from "./distributors";
import { DISTRIBUTORS } from "@/data/catalog";

describe("city distributors", () => {
  it("only returns companies that serve the shop city", () => {
    const tabriz = distributorsInCity("تبریز");
    const tehran = distributorsInCity("تهران");
    expect(tabriz.every((d) => d.cities.includes("تبریز"))).toBe(true);
    expect(tehran.every((d) => d.cities.includes("تهران"))).toBe(true);
    expect(tabriz.some((d) => d.id === "d4")).toBe(false);
    expect(tehran.some((d) => d.id === "d1")).toBe(false);
  });

  it("does not mix cities when matching", () => {
    const iran = DISTRIBUTORS.find((d) => d.id === "d1")!;
    expect(distributorServesCity(iran, "تبریز")).toBe(true);
    expect(distributorServesCity(iran, "تهران")).toBe(false);
  });

  it("keeps the current company if it already serves the city", () => {
    expect(resolveDistributorForCity("d5", "تبریز")).toBe("d5");
  });

  it("switches away from a company that does not serve the city", () => {
    const next = resolveDistributorForCity("d4", "تبریز");
    expect(next).not.toBe("d4");
    expect(distributorsInCity("تبریز").some((d) => d.id === next)).toBe(true);
  });

  it("resolves a city name to the platform city id", () => {
    expect(cityIdFromName("تبریز", [{ id: "ct_tabriz", name: "تبریز", province: "آذربایجان شرقی", lat: 0, lng: 0 }])).toBe("ct_tabriz");
    expect(cityIdFromName("تهران", [])).toBeNull();
  });
});
