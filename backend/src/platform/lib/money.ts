/**
 * Money is BIGINT toman (DL-04). Domain amounts are not modeled in Foundation; this helper only
 * exists so later modules share one integer-toman constructor instead of spreading `number`.
 */
export type Toman = bigint;

export function toman(value: bigint | number | string): Toman {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new RangeError('toman amounts must be whole integers');
    }
    return BigInt(value);
  }
  return BigInt(value);
}
