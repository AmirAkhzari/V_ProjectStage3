import { describe, expect, it } from 'vitest';
import {
  ADDRESS_FIELD_MAX,
  parseMyAddressBody,
  type MyAddressInput,
} from '../../src/modules/customers/domain/address.js';

const valid = {
  title: 'فروشگاه اصلی',
  fullAddress: 'تبریز، نیروی هوایی، گجیل، پلاک ۲۴',
  plaque: '۲۴',
  unit: '۱',
  tag: 'store',
  cityName: 'تبریز',
  lat: 38.08,
  lng: 46.29,
  streetLabel: 'نیروی هوایی',
} satisfies Omit<MyAddressInput, 'branchName'>;

describe('A10 address body', () => {
  it('accepts the client shape and trims every text field', () => {
    const parsed = parseMyAddressBody({
      ...valid,
      title: '  فروشگاه اصلی  ',
      cityName: ' تبریز ',
    });
    expect(parsed).toEqual({
      ...valid,
      title: 'فروشگاه اصلی',
      cityName: 'تبریز',
      branchName: null,
    });
  });

  it('accepts every tag and a null tag', () => {
    for (const tag of ['store', 'warehouse', 'branch', null]) {
      expect(parseMyAddressBody({ ...valid, tag }).tag).toBe(tag);
    }
  });

  it('treats an absent, null, empty or blank branchName as null', () => {
    for (const branchName of [undefined, null, '', '   ']) {
      const body = { ...valid, ...(branchName === undefined ? {} : { branchName }) };
      expect(parseMyAddressBody(body).branchName).toBeNull();
    }
    expect(parseMyAddressBody({ ...valid, branchName: ' شعبه ۲ ' }).branchName).toBe('شعبه ۲');
  });

  it('requires every field the client renders', () => {
    for (const key of Object.keys(valid)) {
      const body: Record<string, unknown> = { ...valid };
      delete body[key];
      expect(() => parseMyAddressBody(body), key).toThrow();
    }
  });

  it('refuses any unknown key, so the owner and default stay server decisions', () => {
    for (const extra of [
      { id: '02000000-0000-4000-8000-00000000000a' },
      { shopkeeperId: '02000000-0000-4000-8000-00000000000b' },
      { isDefault: true },
      { city: 'تبریز' },
    ]) {
      expect(() => parseMyAddressBody({ ...valid, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });

  it('refuses an unknown tag, a missing tag and non-object bodies', () => {
    for (const body of [
      { ...valid, tag: 'other' },
      { ...valid, tag: 'STORE' },
      (({ tag: _tag, ...rest }) => rest)(valid),
      null,
      undefined,
      [],
      'address',
    ]) {
      expect(() => parseMyAddressBody(body)).toThrow();
    }
  });

  it('refuses coordinates that are not finite numbers in range', () => {
    for (const body of [
      { ...valid, lat: 91 },
      { ...valid, lat: -91 },
      { ...valid, lng: 181 },
      { ...valid, lng: -181 },
      { ...valid, lat: Number.NaN },
      { ...valid, lat: Number.POSITIVE_INFINITY },
      { ...valid, lat: '38.08' },
      { ...valid, lng: null },
    ]) {
      expect(() => parseMyAddressBody(body), JSON.stringify(body)).toThrow();
    }
    expect(parseMyAddressBody({ ...valid, lat: 90, lng: 180 }).lat).toBe(90);
    expect(parseMyAddressBody({ ...valid, lat: -90, lng: -180 }).lng).toBe(-180);
  });

  it('refuses empty required text, over-long text and control characters', () => {
    for (const body of [
      { ...valid, title: '   ' },
      { ...valid, fullAddress: '' },
      { ...valid, cityName: ' ' },
      { ...valid, title: 'x'.repeat(ADDRESS_FIELD_MAX.title + 1) },
      { ...valid, fullAddress: 'x'.repeat(ADDRESS_FIELD_MAX.fullAddress + 1) },
      { ...valid, cityName: 'x'.repeat(ADDRESS_FIELD_MAX.cityName + 1) },
      { ...valid, streetLabel: 'x'.repeat(ADDRESS_FIELD_MAX.streetLabel + 1) },
      { ...valid, title: 'a\nb' },
      { ...valid, fullAddress: 'a\rb' },
      { ...valid, cityName: 'a\tb' },
      { ...valid, title: 5 },
      { ...valid, plaque: null },
    ]) {
      expect(() => parseMyAddressBody(body), JSON.stringify(body)).toThrow();
    }
  });

  it('accepts empty plaque/unit/streetLabel, which real addresses often lack', () => {
    const parsed = parseMyAddressBody({ ...valid, plaque: '', unit: '', streetLabel: '' });
    expect(parsed).toMatchObject({ plaque: '', unit: '', streetLabel: '' });
  });
});
