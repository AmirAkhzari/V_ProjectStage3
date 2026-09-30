import { describe, expect, it } from "vitest";
import { PRODUCTS, productsForDistributor } from "@/data/catalog";
import { catalogSections, categoryLabel } from "./catalogSections";

describe("catalogSections", () => {
  it("resolves API slugs and objects to Persian names", () => {
    const config = [
      { id: "cat-dairy", name: "لبنیات", slug: "dairy", showOnHome: true, showInSearch: true },
    ];
    expect(categoryLabel("dairy", config)).toBe("لبنیات");
    expect(categoryLabel({ name: "نوشیدنی" }, config)).toBe("نوشیدنی");
  });

  it("keeps discounted products inside their category", () => {
    const stock = productsForDistributor("d6");
    const sections = catalogSections(stock, ["خواربار", "لبنیات", "بهداشتی"]);
    expect(sections.map((section) => section.title)).toEqual(["خواربار", "لبنیات", "بهداشتی"]);
    expect(sections.find((section) => section.title === "خواربار")?.products.length).toBeGreaterThan(0);
    expect(sections.find((section) => section.title === "لبنیات")?.products.some((product) => product.disc)).toBe(true);
  });

  it("derives headings from products when the API category list is empty", () => {
    const drinks = PRODUCTS.filter((product) => product.category === "نوشیدنی");
    const sections = catalogSections(drinks, []);
    expect(sections).toEqual([{ title: "نوشیدنی", products: drinks }]);
  });

  it("falls back to a single heading when products have no category", () => {
    const orphan = { ...PRODUCTS[0], category: "" };
    expect(catalogSections([orphan], [])).toEqual([{ title: "همه کالاها", products: [orphan] }]);
  });
});
