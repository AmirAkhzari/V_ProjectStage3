/**
 * Jalali conversion lives at the API/display boundary; the DB stores Gregorian DATE/TIMESTAMPTZ.
 * No conversion is implemented in Foundation (no display endpoints).
 */
export function notImplementedJalali(): never {
  throw new Error('jalali conversion is not implemented in P0 Foundation');
}
