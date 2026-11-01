import { describe, expect, it } from 'vitest';
import { principalToTenant } from './tenantPrincipal.js';
import type { SessionSnapshot } from './sessionAuthority.js';

const sa: SessionSnapshot = {
  sid: 's1',
  accountId: 'sa-1',
  typ: 'staff',
  familyId: 'f1',
  sessionVersion: 0,
  accountStatus: 'active',
  revokedAt: null,
  distributorId: null,
  staffRole: 'super_admin',
  permissions: ['drivers.manage'],
  mustChangePassword: false,
};

describe('TEN-05-PLAT / SCOPE-SA-01 tenant mapping', () => {
  it('SA without scope is platform; with scope is not', () => {
    const open = principalToTenant({ sub: 'sa-1', typ: 'staff', sid: 's1', sv: 0 }, sa, undefined);
    expect(open.tenant.isPlatform).toBe(true);
    expect(open.tenant.distributorId).toBeUndefined();

    const scoped = principalToTenant(
      { sub: 'sa-1', typ: 'staff', sid: 's1', sv: 0 },
      sa,
      '22222222-2222-2222-2222-222222222222',
    );
    expect(scoped.tenant.isPlatform).toBe(false);
    expect(scoped.tenant.distributorId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('ignores X-Scope-Distributor for DA / shopkeeper / driver', () => {
    const da = principalToTenant(
      { sub: 'da-1', typ: 'staff', sid: 's2', sv: 0 },
      { ...sa, accountId: 'da-1', staffRole: 'distributor_admin', distributorId: 'd1' },
      '22222222-2222-2222-2222-222222222222',
    );
    expect(da.tenant.isPlatform).toBe(false);
    expect(da.tenant.distributorId).toBe('d1');
  });

  it('11-7: does not fall back to the token did and rejects a subject mismatch', () => {
    const driver = principalToTenant(
      { sub: 'drv-1', typ: 'driver', sid: 's3', sv: 0, did: 'from-token' },
      {
        ...sa,
        sid: 's3',
        accountId: 'drv-1',
        typ: 'driver',
        staffRole: null,
        distributorId: null,
      },
      undefined,
    );
    expect(driver.tenant.distributorId).toBeUndefined();
    expect(driver.tenant.driverId).toBe('drv-1');
    expect(() =>
      principalToTenant({ sub: 'other', typ: 'driver', sid: 's3', sv: 0 }, sa, undefined),
    ).toThrow(/mismatch/);
  });
});
