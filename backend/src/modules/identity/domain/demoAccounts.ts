/** Fixed non-prod demo identities. Defined once for the seed and the login path. */
export const DEMO_SHOPKEEPER_PHONE = '+989999999901';
export const DEMO_STAFF_PHONE = '+989999999902';
export const DEMO_SHOPKEEPER_ID = '03000000-0000-4000-8000-000000000001';
export const DEMO_STAFF_ID = '03000000-0000-4000-8000-000000000002';
export const DEMO_DISTRIBUTOR_ID = '03000000-0000-4000-8000-000000000010';

/** Read-only distributor-admin surface. A tampered membership cannot widen this. */
export const DEMO_DA_PERMISSIONS = [
  'dashboard.view',
  'orders.view',
  'products.view',
  'stock.view',
  'retailers.view',
  'coupons.view',
  'drivers.view',
] as const;

export function demoDaPermissions(stored: readonly string[]): string[] {
  const held = new Set(stored);
  return DEMO_DA_PERMISSIONS.filter((permission) => held.has(permission));
}

export { DEMO_AUD, DEMO_ISS, demoLoginEnabled } from '../../../platform/auth/demoLogin.js';
