import { describe, expect, it } from 'vitest';
import {
  CITY_FILTER_MAX,
  readCityFilter,
} from '../../src/modules/tenancy/application/listAppDistributors.js';

describe('A17 cityId filter', () => {
  it('treats an absent parameter as no filter', () => {
    expect(readCityFilter({})).toBeNull();
    expect(readCityFilter(undefined)).toBeNull();
    expect(readCityFilter({ cityId: undefined })).toBeNull();
  });

  it('accepts one trimmed value', () => {
    expect(readCityFilter({ cityId: 'tabriz' })).toBe('tabriz');
    expect(readCityFilter({ cityId: '  تبریز  ' })).toBe('تبریز');
  });

  it('refuses a repeated, empty, over-long or control-bearing value', () => {
    for (const value of [
      ['a', 'b'],
      ['tabriz'],
      '',
      '   ',
      'x'.repeat(CITY_FILTER_MAX + 1),
      'a\nb',
      42,
      null,
    ]) {
      expect(() => readCityFilter({ cityId: value }), JSON.stringify(value)).toThrow();
    }
    expect(readCityFilter({ cityId: 'x'.repeat(CITY_FILTER_MAX) })).toHaveLength(CITY_FILTER_MAX);
  });
});
