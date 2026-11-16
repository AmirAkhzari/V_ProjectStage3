/**
 * The 28 staff permission codes of `BACKEND_ARCHITECTUREMain.md` §7.3 / PERMISSION_MATRIX.
 * The identity module re-exports `SUPER_ADMIN_PERMISSIONS` from this list, so a typo in a
 * route registry row or in `requirePermission` is a compile error. Do not add or remove
 * codes here without a contract change.
 */
export const STAFF_PERMISSION_CODES = [
  'dashboard.view',
  'orders.view',
  'orders.update',
  'orders.cancel',
  'orders.deliver_manual',
  'products.view',
  'products.manage',
  'stock.view',
  'stock.manage',
  'distributors.view',
  'distributors.manage',
  'retailers.view',
  'retailers.manage',
  'coupons.view',
  'coupons.manage',
  'banners.manage',
  'messages.send',
  'finance.view',
  'finance.adjust',
  'delivery.manage',
  'settings.manage',
  'staff.manage',
  'audit.view',
  'subscriptions.manage',
  'drivers.view',
  'drivers.manage',
  'deliveries.assign',
  'deliveries.confirm',
] as const;

export type PermissionCode = (typeof STAFF_PERMISSION_CODES)[number];
