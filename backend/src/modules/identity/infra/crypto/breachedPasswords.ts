import { createHash } from 'node:crypto';
import { normalizePassword } from '../../domain/passwordPolicy.js';
import { BREACHED_LIST_BODY } from './breachedPasswordsData.js';

export const BREACHED_LIST_VERSION = '2026-10-15.1';

/** AppSec Low: the sha is pinned in code, not trusted from a sibling file. */
export const BREACHED_LIST_SHA256 =
  '510841f72880b13988200c81408f928c617559b3bb25ed900a9d2d3678a368dc';

export interface BreachedPasswordList {
  version: string;
  size: number;
  sha256: string;
  has(normalized: string): boolean;
}

export class BreachedListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreachedListError';
  }
}

/**
 * Offline list only. Never fetches HIBP or any other network (AUTH-PW-02-OFF).
 * P6-8: the body is embedded, so this never touches the filesystem — plain tsc
 * does not copy the .txt into dist and the production image only ships dist.
 */
export function loadBreachedPasswordList(): BreachedPasswordList {
  const body = BREACHED_LIST_BODY;
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (BREACHED_LIST_SHA256 !== sha256) {
    throw new BreachedListError(
      `breached-password list sha256 mismatch: expected ${BREACHED_LIST_SHA256}, got ${sha256}`,
    );
  }

  const entries = new Set<string>();
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    entries.add(normalizePassword(trimmed).toLocaleLowerCase('en-US'));
  }

  return {
    version: BREACHED_LIST_VERSION,
    size: entries.size,
    sha256,
    has(normalized: string): boolean {
      return entries.has(normalizePassword(normalized).toLocaleLowerCase('en-US'));
    },
  };
}

export function logBreachedListBoot(
  log: { info: (bindings: Record<string, unknown>, message: string) => void },
  list: BreachedPasswordList,
): void {
  log.info(
    {
      breachedListVersion: list.version,
      breachedListSize: list.size,
      breachedListSha256: list.sha256,
    },
    'offline breached-password list loaded',
  );
}
