import type { SubjectType } from '../../src/platform/auth/jwt.js';
import type { SessionAuthority, StaffRole } from '../../src/platform/auth/sessionAuthority.js';

export interface AllowAllOptions {
  accountId?: string;
  /** Snapshot permissions, e.g. `distributors.view`. Never the token claims. */
  permissions?: readonly string[];
  staffRole?: StaffRole | null;
  distributorId?: string | null;
  mustChangePassword?: boolean;
}

/** Test-only allow-all authority. Not imported from production code (N12-6). */
export function allowAllSessionAuthority(
  typ: SubjectType = 'shopkeeper',
  accountIdOrOptions: string | AllowAllOptions = 'user-1',
): SessionAuthority {
  const options: AllowAllOptions =
    typeof accountIdOrOptions === 'string' ? { accountId: accountIdOrOptions } : accountIdOrOptions;
  const accountId = options.accountId ?? 'user-1';
  return {
    hasPgFallback: true,
    check: (sid, claimedVersion) =>
      Promise.resolve({
        status: 'active',
        row: {
          sid,
          accountId,
          typ,
          familyId: 'family-1',
          sessionVersion: claimedVersion ?? 0,
          accountStatus: 'active',
          revokedAt: null,
          distributorId: options.distributorId ?? null,
          staffRole:
            options.staffRole !== undefined
              ? options.staffRole
              : typ === 'staff'
                ? 'distributor_admin'
                : null,
          permissions: options.permissions ?? [],
          mustChangePassword: options.mustChangePassword ?? false,
        },
      }),
    rememberLive: () => Promise.resolve(),
    deny: () => Promise.resolve(),
    invalidateLive: () => Promise.resolve(),
    breakerState: () => 'closed',
    pgFallbackTotal: () => 0,
    pgLookupsFor: () => 0,
  };
}
