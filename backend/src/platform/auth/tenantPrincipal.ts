import type { TenantContext } from '../db/tenant.js';
import { parseScopeDistributorHeader } from '../http/scope.js';
import type { AccessClaims } from './jwt.js';
import type { SessionSnapshot } from './sessionAuthority.js';

export interface ResolvedPrincipal {
  tenant: TenantContext;
  permissions: readonly string[];
}

/**
 * TEN-05-PLAT / SCOPE-SA-01: isPlatform is true only for SA without X-Scope-Distributor
 * (and workers, which never go through this path). Non-SA headers are ignored.
 */
export function principalToTenant(
  claims: AccessClaims,
  snapshot: SessionSnapshot,
  scopeHeader: string | string[] | undefined,
): ResolvedPrincipal {
  const scoped =
    snapshot.staffRole === 'super_admin' ? parseScopeDistributorHeader(scopeHeader) : undefined;

  if (claims.typ === 'staff' && snapshot.staffRole === 'super_admin') {
    return {
      tenant: {
        subjectType: 'staff',
        ...(scoped ? { distributorId: scoped } : {}),
        isPlatform: scoped === undefined,
      },
      permissions: snapshot.permissions,
    };
  }

  if (claims.typ === 'staff') {
    return {
      tenant: {
        subjectType: 'staff',
        ...(snapshot.distributorId ? { distributorId: snapshot.distributorId } : {}),
        isPlatform: false,
      },
      permissions: snapshot.permissions,
    };
  }

  if (claims.typ === 'driver') {
    const distributorId = snapshot.distributorId ?? claims.did;
    return {
      tenant: {
        subjectType: 'driver',
        driverId: claims.sub,
        ...(distributorId ? { distributorId } : {}),
        isPlatform: false,
      },
      permissions: [],
    };
  }

  return {
    tenant: {
      subjectType: 'shopkeeper',
      shopkeeperId: claims.sub,
      isPlatform: false,
    },
    permissions: [],
  };
}
