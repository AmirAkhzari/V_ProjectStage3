import { describe, expect, it } from 'vitest';
import { ignoreAdminTerminate } from '../helpers/containers.js';

describe('N10-1 / A-11-11 admin terminate', () => {
  it('swallows only 57P01 and rethrows every other pool error', () => {
    expect(() =>
      ignoreAdminTerminate(Object.assign(new Error('admin terminate'), { code: '57P01' })),
    ).not.toThrow();
    expect(() =>
      ignoreAdminTerminate(Object.assign(new Error('connection lost'), { code: 'XX000' })),
    ).toThrow(/connection lost/);
  });
});
