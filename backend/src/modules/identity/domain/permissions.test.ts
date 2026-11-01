import { describe, expect, it } from 'vitest';
import { SUPER_ADMIN_PERMISSIONS, permissionsForRole } from './permissions.js';

describe('SA permissions from role', () => {
  it('SCOPE-SA-01: super_admin ignores the empty stored column', () => {
    expect(permissionsForRole('super_admin', [])).toEqual(SUPER_ADMIN_PERMISSIONS);
    expect(SUPER_ADMIN_PERMISSIONS).toHaveLength(28);
    expect(SUPER_ADMIN_PERMISSIONS).toContain('drivers.manage');
    expect(SUPER_ADMIN_PERMISSIONS).toContain('orders.deliver_manual');
  });

  it('keeps distributor_admin stored permissions', () => {
    expect(permissionsForRole('distributor_admin', ['drivers.manage'])).toEqual(['drivers.manage']);
  });
});
