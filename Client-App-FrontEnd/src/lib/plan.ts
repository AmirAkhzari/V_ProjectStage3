import type { Distributor, RetailerPlan } from "@/types";

export function isProPlan(plan: RetailerPlan | null | undefined) {
  return plan === "pro";
}

export function canBrowseMarketplace(plan: RetailerPlan | null | undefined) {
  return plan === "pro";
}

export function canComparePrices(plan: RetailerPlan | null | undefined) {
  return plan === "pro";
}

export function canAccessDistributor(
  plan: RetailerPlan | null | undefined,
  primaryDistributorId: string | null | undefined,
  targetDistributorId: string,
) {
  if (primaryDistributorId && targetDistributorId === primaryDistributorId) return true;
  return plan === "pro";
}

export function withPrimaryFlag<T extends { id: string }>(row: T, primaryDistributorId: string | null | undefined): T & { isPrimary: boolean } {
  return { ...row, isPrimary: Boolean(primaryDistributorId) && row.id === primaryDistributorId };
}

export function selectVisibleDistributors<T extends { id: string }>(
  rows: T[],
  plan: RetailerPlan | null | undefined,
  primaryDistributorId: string | null | undefined,
) {
  if (plan !== "pro" && primaryDistributorId) {
    return rows.filter((row) => row.id === primaryDistributorId);
  }
  return rows;
}

export function lockedCityTeasers(
  cityDistributors: Distributor[],
  primaryDistributorId: string | null | undefined,
  plan: RetailerPlan | null | undefined,
): Distributor[] {
  if (plan === "pro") return cityDistributors.map((row) => withPrimaryFlag(row, primaryDistributorId));
  return cityDistributors.map((row) => ({
    ...withPrimaryFlag(row, primaryDistributorId),
    locked: Boolean(primaryDistributorId) && row.id !== primaryDistributorId,
  }));
}

export function formatPlanExpiry(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(date);
}
