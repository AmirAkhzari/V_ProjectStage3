import { DISTRIBUTORS, dealsForDistributor, pricedProduct, productsForDistributor } from "@/data/catalog";
import { distributorsInCity } from "@/lib/distributors";
import type { Distributor, Product } from "@/types";

export type CityDeal = {
  product: Product;
  distributor: Distributor;
};

export type PriceCompareRow = {
  product: Product;
  left: Product;
  right: Product;
  leftDistributor: Distributor;
  rightDistributor: Distributor;
};

export function cityDealTiles(city: string): CityDeal[] {
  const companies = distributorsInCity(city).filter((company) => company.status === "active");
  const out: CityDeal[] = [];
  for (const company of companies) {
    for (const raw of dealsForDistributor(company.id)) {
      out.push({ product: pricedProduct(raw, company.priceMultiplier), distributor: company });
    }
  }
  return out.sort((a, b) => (b.product.disc ?? 0) - (a.product.disc ?? 0) || a.distributor.name.localeCompare(b.distributor.name, "fa"));
}

export function overlappingPrices(leftId: string, rightId: string): PriceCompareRow[] {
  const leftDistributor = DISTRIBUTORS.find((company) => company.id === leftId);
  const rightDistributor = DISTRIBUTORS.find((company) => company.id === rightId);
  if (!leftDistributor || !rightDistributor) return [];
  const rightStock = new Set(productsForDistributor(rightId).map((product) => product.id));
  return productsForDistributor(leftId)
    .filter((product) => rightStock.has(product.id))
    .map((product) => ({
      product,
      left: pricedProduct(product, leftDistributor.priceMultiplier),
      right: pricedProduct(product, rightDistributor.priceMultiplier),
      leftDistributor,
      rightDistributor,
    }))
    .sort((a, b) => Math.abs(b.left.price - b.right.price) - Math.abs(a.left.price - a.right.price));
}
