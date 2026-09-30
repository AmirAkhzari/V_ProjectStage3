import { DISTRIBUTORS } from "@/data/catalog";
import type { Address, ConfigCity, Distributor } from "@/types";
import { normalizePersian } from "@/lib/format";

export function normalizeCity(name: string) {
  return normalizePersian(name).replace(/\s+/g, " ").trim();
}

export function userCity(addresses: Address[], selectedAddressId: string | null) {
  const selected = addresses.find((address) => address.id === selectedAddressId);
  return selected?.city || addresses[0]?.city || "";
}

export function distributorServesCity(distributor: Distributor, city: string) {
  const target = normalizeCity(city);
  if (!target) return false;
  return distributor.cities.some((item) => normalizeCity(item) === target);
}

export function distributorsInCity(city: string, list: Distributor[] = DISTRIBUTORS) {
  if (!normalizeCity(city)) return [];
  return list.filter((distributor) => distributorServesCity(distributor, city));
}

export function getDistributor(id: string, list: Distributor[] = DISTRIBUTORS) {
  return list.find((distributor) => distributor.id === id) ?? null;
}

export function resolveDistributorForCity(currentId: string, city: string, list: Distributor[] = DISTRIBUTORS) {
  const local = distributorsInCity(city, list);
  if (local.length === 0) return null;
  if (local.some((distributor) => distributor.id === currentId)) return currentId;
  return local.find((distributor) => distributor.status === "active")?.id ?? local[0].id;
}

export function cityIdFromName(name: string, cities: ConfigCity[] = []) {
  const target = normalizeCity(name);
  if (!target) return null;
  return cities.find((city) => normalizeCity(city.name) === target)?.id ?? null;
}
