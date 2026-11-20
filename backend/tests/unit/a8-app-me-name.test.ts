import { describe, expect, it } from 'vitest';
import {
  parseShopNameBody,
  SHOP_NAME_MAX,
} from '../../src/modules/customers/application/updateMyName.js';

describe('A8 shop name body', () => {
  it('accepts exactly one trimmed string name', () => {
    expect(parseShopNameBody({ name: 'فروشگاه الف' })).toBe('فروشگاه الف');
    expect(parseShopNameBody({ name: '  فروشگاه الف  ' })).toBe('فروشگاه الف');
    expect(parseShopNameBody({ name: 'x'.repeat(SHOP_NAME_MAX) })).toHaveLength(SHOP_NAME_MAX);
  });

  it('counts code points, so 100 emoji fit and 101 do not', () => {
    expect(parseShopNameBody({ name: '🏪'.repeat(SHOP_NAME_MAX) })).toBe(
      '🏪'.repeat(SHOP_NAME_MAX),
    );
    expect(() => parseShopNameBody({ name: '🏪'.repeat(SHOP_NAME_MAX + 1) })).toThrow();
  });

  it('refuses an empty, over-long, control-bearing or non-string value', () => {
    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(SHOP_NAME_MAX + 1) },
      { name: 'a\nb' },
      { name: 'a\rb' },
      { name: 'a\tb' },
      { name: 1 },
      { name: null },
      { name: true },
    ]) {
      expect(() => parseShopNameBody(body), JSON.stringify(body)).toThrow();
    }
  });

  it('refuses any extra key instead of ignoring it', () => {
    for (const body of [
      { name: 'ok', phone: '09120000000' },
      { name: 'ok', status: 'blocked' },
      { name: 'ok', primaryDistributorId: '01000000-0000-4000-8000-000000000001' },
      { name: 'ok', id: '02000000-0000-4000-8000-00000000000b' },
    ]) {
      expect(() => parseShopNameBody(body), JSON.stringify(body)).toThrow();
    }
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'name', 5, ['name'], []]) {
      expect(() => parseShopNameBody(body), String(body)).toThrow();
    }
  });
});
