/**
 * SA permissions are derived from role, not `staff_memberships.permissions`
 * (Architect note on the empty seed column / SCOPE-SA-01).
 */
export const SUPER_ADMIN_PERMISSIONS = [
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

export type StaffRole = 'super_admin' | 'distributor_admin';

export function permissionsForRole(role: StaffRole, stored: readonly string[]): readonly string[] {
  if (role === 'super_admin') return SUPER_ADMIN_PERMISSIONS;
  return stored;
}
