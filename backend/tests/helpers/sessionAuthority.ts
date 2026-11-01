import type { SubjectType } from '../../src/platform/auth/jwt.js';
import type { SessionAuthority } from '../../src/platform/auth/sessionAuthority.js';

/** Test-only allow-all authority. Not imported from production code (N12-6). */
export function allowAllSessionAuthority(
  typ: SubjectType = 'shopkeeper',
  accountId = 'user-1',
): SessionAuthority {
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
          distributorId: null,
          staffRole: typ === 'staff' ? 'distributor_admin' : null,
          permissions: [],
          mustChangePassword: false,
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
