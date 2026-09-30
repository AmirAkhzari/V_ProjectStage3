import { describe, expect, it } from "vitest";
import { DISTRIBUTORS } from "@/data/catalog";
import { canAccessDistributor, canBrowseMarketplace, canComparePrices, lockedCityTeasers, selectVisibleDistributors } from "./plan";

describe("retailer plan entitlements", () => {
  it("locks marketplace and compare to pro", () => {
    expect(canBrowseMarketplace("free")).toBe(false);
    expect(canBrowseMarketplace("pro")).toBe(true);
    expect(canComparePrices("free")).toBe(false);
    expect(canComparePrices("pro")).toBe(true);
  });

  it("always allows the primary distributor", () => {
    expect(canAccessDistributor("free", "d1", "d1")).toBe(true);
    expect(canAccessDistributor("free", "d1", "d5")).toBe(false);
    expect(canAccessDistributor("pro", "d1", "d5")).toBe(true);
  });

  it("hides other companies from free users", () => {
    const visible = selectVisibleDistributors(DISTRIBUTORS, "free", "d1");
    expect(visible.map((row) => row.id)).toEqual(["d1"]);
  });

  it("marks non-primary city companies as locked for free users", () => {
    const tabriz = DISTRIBUTORS.filter((row) => row.cities.includes("تبریز"));
    const rows = lockedCityTeasers(tabriz, "d1", "free");
    expect(rows.find((row) => row.id === "d1")?.locked).toBe(false);
    expect(rows.find((row) => row.id === "d1")?.isPrimary).toBe(true);
    expect(rows.filter((row) => row.id !== "d1").every((row) => row.locked)).toBe(true);
  });
});
