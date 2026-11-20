import { AppError } from '../../../platform/http/errors.js';

/**
 * The shop's address book. `store`/`warehouse`/`branch` is the same tag set the client already
 * renders. A10 is the only writer in this slice; A11/A12/A13 stay pending.
 */
export const ADDRESS_TAGS = ['store', 'warehouse', 'branch'] as const;

export type AddressTag = (typeof ADDRESS_TAGS)[number];

const TAG_SET: ReadonlySet<string> = new Set(ADDRESS_TAGS);

export function isAddressTag(value: unknown): value is AddressTag {
  return typeof value === 'string' && TAG_SET.has(value);
}

/** One definition of the row shape: A9 lists it and A10 answers with the row it just wrote. */
export const ADDRESS_SELECT = `SELECT id, title, full_address, plaque, unit, tag, branch_name,
              city_name, lat, lng, street_label, created_at
         FROM customers.addresses`;

export interface AddressRow {
  id: string;
  title: string;
  full_address: string;
  plaque: string;
  unit: string;
  tag: string | null;
  branch_name: string | null;
  city_name: string;
  lat: number;
  lng: number;
  street_label: string;
  created_at: Date;
}

export interface AddressView {
  id: string;
  title: string;
  fullAddress: string;
  plaque: string;
  unit: string;
  tag: AddressTag | null;
  branchName: string | null;
  cityName: string;
  lat: number;
  lng: number;
  streetLabel: string;
  createdAt: string;
}

export function toAddressView(row: AddressRow): AddressView {
  return {
    id: row.id,
    title: row.title,
    fullAddress: row.full_address,
    plaque: row.plaque,
    unit: row.unit,
    tag: isAddressTag(row.tag) ? row.tag : null,
    branchName: row.branch_name,
    cityName: row.city_name,
    lat: row.lat,
    lng: row.lng,
    streetLabel: row.street_label,
    createdAt: row.created_at.toISOString(),
  };
}

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');

export const ADDRESS_FIELD_MAX = {
  title: 100,
  fullAddress: 500,
  plaque: 20,
  unit: 20,
  branchName: 100,
  cityName: 100,
  streetLabel: 200,
} as const;

/** Trimmed text of 1..max code points (or 0..max when `allowEmpty`), controls refused. */
function readText(
  value: unknown,
  field: keyof typeof ADDRESS_FIELD_MAX,
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') throw validationFailed();
  const text = value.trim();
  const points = Array.from(text);
  const min = options.allowEmpty === true ? 0 : 1;
  if (points.length < min || points.length > ADDRESS_FIELD_MAX[field]) throw validationFailed();
  // CR/LF/TAB and the other C0/C1 controls would let a label forge a log or an audit line.
  if (/\p{Cc}/u.test(text)) throw validationFailed();
  return text;
}

function readCoordinate(value: unknown, limit: number): number {
  // A numeric string would silently change meaning once stored; only real JSON numbers are accepted.
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw validationFailed();
  }
  return value;
}

export interface MyAddressInput {
  title: string;
  fullAddress: string;
  plaque: string;
  unit: string;
  tag: AddressTag | null;
  branchName: string | null;
  cityName: string;
  lat: number;
  lng: number;
  streetLabel: string;
}

const REQUIRED_KEYS = [
  'title',
  'fullAddress',
  'plaque',
  'unit',
  'tag',
  'cityName',
  'lat',
  'lng',
  'streetLabel',
] as const;

const ALLOWED_KEYS: ReadonlySet<string> = new Set([...REQUIRED_KEYS, 'branchName']);

/**
 * Strict A10 body: every field the client renders, plus an optional `branchName`. Missing required
 * fields and any unknown key (an `id`, a `shopkeeperId`, an `isDefault` flag) are a 400 instead of
 * being ignored — the row's owner and its default pointer are server decisions.
 */
export function parseMyAddressBody(body: unknown): MyAddressInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationFailed();
  const source = body as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!ALLOWED_KEYS.has(key)) throw validationFailed();
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in source)) throw validationFailed();
  }
  const tag = source['tag'];
  if (tag !== null && !isAddressTag(tag)) throw validationFailed();
  const branchName =
    'branchName' in source && source['branchName'] !== null
      ? readText(source['branchName'], 'branchName', { allowEmpty: true })
      : '';
  return {
    title: readText(source['title'], 'title'),
    fullAddress: readText(source['fullAddress'], 'fullAddress'),
    plaque: readText(source['plaque'], 'plaque', { allowEmpty: true }),
    unit: readText(source['unit'], 'unit', { allowEmpty: true }),
    tag: tag as AddressTag | null,
    branchName: branchName || null,
    cityName: readText(source['cityName'], 'cityName'),
    lat: readCoordinate(source['lat'], 90),
    lng: readCoordinate(source['lng'], 180),
    streetLabel: readText(source['streetLabel'], 'streetLabel', { allowEmpty: true }),
  };
}
