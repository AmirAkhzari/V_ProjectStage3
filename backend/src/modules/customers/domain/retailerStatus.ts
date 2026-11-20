/** The two states `customers.shopkeepers.status` holds today: the B33 filter and the B35 write. */
export const RETAILER_STATUSES = ['active', 'blocked'] as const;

export type RetailerStatus = (typeof RETAILER_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set(RETAILER_STATUSES);

export function isRetailerStatus(value: unknown): value is RetailerStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}
