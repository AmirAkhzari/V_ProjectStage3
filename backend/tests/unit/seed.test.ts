import { describe, expect, it } from 'vitest';
import { assertNonProdSeed, SEED, SeedError } from '../../scripts/seed.js';

describe('assertNonProdSeed', () => {
  it('allows development and test', () => {
    expect(() => assertNonProdSeed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertNonProdSeed({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('refuses production', () => {
    expect(() => assertNonProdSeed({ NODE_ENV: 'production' })).toThrow(SeedError);
    expect(() => assertNonProdSeed({ NODE_ENV: 'production' })).toThrow(/must not run/);
  });

  it('refuses an unset NODE_ENV', () => {
    expect(() => assertNonProdSeed({})).toThrow(/development or NODE_ENV=test/);
  });

  it('describes the S11b-1 fixture counts', () => {
    expect(SEED.distributors).toHaveLength(2);
    expect(SEED.das).toHaveLength(2);
    expect(SEED.drivers).toHaveLength(4);
    expect(SEED.das.every((da) => SEED.distributors.some((d) => d.id === da.distributorId))).toBe(
      true,
    );
    expect(SEED.drivers.filter((d) => d.distributorId === SEED.distributors[0]?.id)).toHaveLength(
      2,
    );
    expect(SEED.drivers.filter((d) => d.distributorId === SEED.distributors[1]?.id)).toHaveLength(
      2,
    );
  });
});
