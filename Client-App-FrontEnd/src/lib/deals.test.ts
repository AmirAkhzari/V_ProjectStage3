import { describe, expect, it } from "vitest";
import { cityDealTiles, overlappingPrices } from "./deals";

describe("city deals", () => {
  it("only lists discounted stock from active companies in that city", () => {
    const deals = cityDealTiles("تبریز");
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((deal) => deal.distributor.cities.includes("تبریز"))).toBe(true);
    expect(deals.every((deal) => deal.distributor.status === "active")).toBe(true);
    expect(deals.every((deal) => deal.product.disc)).toBe(true);
  });

  it("does not invent an ownerless deal", () => {
    const deals = cityDealTiles("تبریز");
    const ids = new Set(deals.map((deal) => `${deal.distributor.id}:${deal.product.id}`));
    expect(ids.size).toBe(deals.length);
    expect(new Set(deals.map((deal) => deal.distributor.id)).size).toBeGreaterThan(1);
  });

  it("compares overlapping SKUs between two companies", () => {
    const rows = overlappingPrices("d1", "d5");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.left.id === row.right.id)).toBe(true);
  });
});
