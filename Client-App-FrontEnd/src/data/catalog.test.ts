import { describe, expect, it } from "vitest";
import { categoriesForDistributor, dealsForDistributor, PRODUCTS, productsForDistributor } from "./catalog";

describe("distributor catalog", () => {
  it("gives ایران the full catalog", () => {
    expect(productsForDistributor("d1")).toHaveLength(PRODUCTS.length);
  });

  it("limits آریا تجارت to dairy and snacks", () => {
    const stock = productsForDistributor("d3");
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.every((product) => product.category === "لبنیات" || product.category === "تنقلات")).toBe(true);
    expect(stock.some((product) => product.category === "نوشیدنی")).toBe(false);
  });

  it("only lists discounted items that the company actually stocks", () => {
    const deals = dealsForDistributor("d6");
    const ids = new Set(productsForDistributor("d6").map((product) => product.id));
    expect(deals.every((product) => product.disc && ids.has(product.id))).toBe(true);
  });

  it("returns empty stock for an unknown company", () => {
    expect(productsForDistributor("missing")).toEqual([]);
    expect(categoriesForDistributor("missing")).toEqual([]);
  });
});
