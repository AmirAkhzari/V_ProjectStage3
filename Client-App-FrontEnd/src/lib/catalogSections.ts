import { HOME_CATEGORIES } from "@/data/catalog";
import type { ConfigCategory, Product } from "@/types";

export type CatalogSection = {
  title: string;
  products: Product[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function categoryLabel(
  value: unknown,
  configCategories: ConfigCategory[] = [],
): string {
  const row = asRecord(value);
  if (row) {
    return categoryLabel(row.name ?? row.label ?? row.slug ?? row.id, configCategories);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const fromConfig = configCategories.find((category) => (
    category.id === raw || category.slug === raw || category.name === raw
  ));
  if (fromConfig) return fromConfig.name;
  const fromHome = HOME_CATEGORIES.find((category) => category.label === raw);
  return fromHome?.label ?? raw;
}

export function productCategoryLabel(
  product: Product,
  configCategories: ConfigCategory[] = [],
): string {
  return categoryLabel(product.category, configCategories);
}

export function catalogSections(
  products: Product[],
  catalogCategories: unknown[] = [],
  configCategories: ConfigCategory[] = [],
): CatalogSection[] {
  const grouped = new Map<string, Product[]>();
  for (const product of products) {
    const title = productCategoryLabel(product, configCategories);
    if (!title) continue;
    const list = grouped.get(title) ?? [];
    list.push(product);
    grouped.set(title, list);
  }

  const preferred = catalogCategories
    .map((category) => categoryLabel(category, configCategories))
    .filter(Boolean);

  const seen = new Set<string>();
  const sections: CatalogSection[] = [];
  for (const title of preferred) {
    if (seen.has(title)) continue;
    const list = grouped.get(title);
    if (!list?.length) continue;
    seen.add(title);
    sections.push({ title, products: list });
  }
  for (const [title, list] of grouped) {
    if (seen.has(title)) continue;
    sections.push({ title, products: list });
  }

  if (!sections.length && products.length) {
    return [{ title: "همه کالاها", products }];
  }
  return sections;
}
