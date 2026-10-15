import { describe, expect, it } from 'vitest';
import { inspectRuntimeDbRole, UnsafeDbRoleError } from './runtimeRole.js';

describe('ROLE-GUARD-01 inspectRuntimeDbRole', () => {
  it('allows vproject_app, vproject_worker, and vproject_identity', () => {
    expect(() =>
      inspectRuntimeDbRole({
        current_user: 'vproject_app',
        rolsuper: false,
        rolbypassrls: false,
      }),
    ).not.toThrow();
    expect(() =>
      inspectRuntimeDbRole({
        current_user: 'vproject_worker',
        rolsuper: false,
        rolbypassrls: false,
      }),
    ).not.toThrow();
    expect(() =>
      inspectRuntimeDbRole({
        current_user: 'vproject_identity',
        rolsuper: false,
        rolbypassrls: false,
      }),
    ).not.toThrow();
  });

  it('refuses a superuser', () => {
    expect(() =>
      inspectRuntimeDbRole({ current_user: 'postgres', rolsuper: true, rolbypassrls: true }),
    ).toThrow(UnsafeDbRoleError);
    expect(() =>
      inspectRuntimeDbRole({ current_user: 'postgres', rolsuper: true, rolbypassrls: true }),
    ).toThrow(/superuser/);
  });

  it('refuses a BYPASSRLS role', () => {
    expect(() =>
      inspectRuntimeDbRole({
        current_user: 'vproject_app',
        rolsuper: false,
        rolbypassrls: true,
      }),
    ).toThrow(/BYPASSRLS/);
  });

  it('refuses the migrator', () => {
    expect(() =>
      inspectRuntimeDbRole({
        current_user: 'vproject_migrator',
        rolsuper: false,
        rolbypassrls: false,
      }),
    ).toThrow(/migrator/);
  });

  it('refuses a missing row', () => {
    expect(() => inspectRuntimeDbRole(undefined)).toThrow(/could not resolve/);
  });

  it('ROLE-GUARD-01: pins the expected role and refuses a swapped pool', () => {
    expect(() =>
      inspectRuntimeDbRole(
        { current_user: 'vproject_app', rolsuper: false, rolbypassrls: false },
        'vproject_app',
      ),
    ).not.toThrow();
    expect(() =>
      inspectRuntimeDbRole(
        { current_user: 'vproject_identity', rolsuper: false, rolbypassrls: false },
        'vproject_app',
      ),
    ).toThrow(/must connect as vproject_app, got vproject_identity/);
    expect(() =>
      inspectRuntimeDbRole(
        { current_user: 'vproject_app', rolsuper: false, rolbypassrls: false },
        'vproject_identity',
      ),
    ).toThrow(/must connect as vproject_identity, got vproject_app/);
    expect(() =>
      inspectRuntimeDbRole(
        { current_user: 'vproject_worker', rolsuper: false, rolbypassrls: false },
        'vproject_worker',
      ),
    ).not.toThrow();
  });
});
