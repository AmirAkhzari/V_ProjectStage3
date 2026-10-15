import { describe, expect, it } from 'vitest';
import { allowMissingRoles, assertLocalRolesTarget, LocalRolesError } from './localRoles.js';

describe('assertLocalRolesTarget', () => {
  it('allows loopback outside production', () => {
    expect(() =>
      assertLocalRolesTarget('postgres://u:p@127.0.0.1:5432/db', 'development'),
    ).not.toThrow();
    expect(() => assertLocalRolesTarget('postgres://u:p@localhost:5432/db', 'test')).not.toThrow();
  });

  it('allows Testcontainers private hosts in test', () => {
    expect(() => assertLocalRolesTarget('postgres://u:p@172.17.0.2:5432/db', 'test')).not.toThrow();
  });

  it('hard-fails in production even on localhost', () => {
    expect(() => assertLocalRolesTarget('postgres://u:p@127.0.0.1:5432/db', 'production')).toThrow(
      LocalRolesError,
    );
  });

  it('hard-fails a remote host in development', () => {
    expect(() =>
      assertLocalRolesTarget('postgres://u:p@db.example.ir:5432/db', 'development'),
    ).toThrow(LocalRolesError);
  });
});

describe('allowMissingRoles', () => {
  it('is false in production even on loopback', () => {
    expect(allowMissingRoles('postgres://u:p@127.0.0.1:5432/db', 'production')).toBe(false);
  });

  it('is true for local and Testcontainers hosts outside production', () => {
    expect(allowMissingRoles('postgres://u:p@127.0.0.1:5432/db', 'test')).toBe(true);
    expect(allowMissingRoles('postgres://u:p@172.17.0.2:5432/db', 'development')).toBe(true);
  });

  it('is false for a remote host', () => {
    expect(allowMissingRoles('postgres://u:p@db.example.ir:5432/db', 'development')).toBe(false);
  });
});
