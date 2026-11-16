import {
  STAFF_PERMISSION_CODES,
  type PermissionCode,
} from '../../../platform/auth/permissionCodes.js';

export type { PermissionCode };

/**
 * SA permissions are derived from role, not `staff_memberships.permissions`
 * (Architect note on the empty seed column / SCOPE-SA-01). The single source of truth for
 * the 28 codes is `src/platform/auth/permissionCodes.ts` so registry rows cannot typo one.
 */
export const SUPER_ADMIN_PERMISSIONS: readonly PermissionCode[] = STAFF_PERMISSION_CODES;

export type StaffRole = 'super_admin' | 'distributor_admin';

export function permissionsForRole(role: StaffRole, stored: readonly string[]): readonly string[] {
  if (role === 'super_admin') return SUPER_ADMIN_PERMISSIONS;
  return stored;
}
