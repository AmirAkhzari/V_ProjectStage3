import type { Permission, Role } from "@/types";

const ALL: Permission[] = [
  "dashboard.view",
  "orders.view",
  "orders.update",
  "orders.cancel",
  "products.view",
  "products.manage",
  "stock.view",
  "stock.manage",
  "distributors.view",
  "distributors.manage",
  "retailers.view",
  "retailers.manage",
  "coupons.view",
  "coupons.manage",
  "banners.manage",
  "messages.send",
  "finance.view",
  "finance.adjust",
  "delivery.manage",
  "settings.manage",
  "staff.manage",
  "audit.view",
  "subscriptions.manage",
  "drivers.view",
  "drivers.manage",
  "deliveries.assign",
  "deliveries.confirm",
];

const DISTRIBUTOR: Permission[] = [
  "dashboard.view",
  "orders.view",
  "orders.update",
  "orders.cancel",
  "products.view",
  "stock.view",
  "stock.manage",
  "distributors.view",
  "retailers.view",
  "coupons.view",
  "coupons.manage",
  "messages.send",
  "delivery.manage",
  "drivers.view",
  "drivers.manage",
  "deliveries.assign",
  "deliveries.confirm",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  distributor_admin: DISTRIBUTOR,
};

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "مدیر پلتفرم",
  distributor_admin: "مدیر شرکت پخش",
};

export function hasPermission(
  permissions: readonly Permission[] | undefined,
  perm: Permission | Permission[] | undefined,
) {
  if (!perm) return true;
  if (!permissions) return false;
  const list = Array.isArray(perm) ? perm : [perm];
  return list.some((p) => permissions.includes(p));
}
