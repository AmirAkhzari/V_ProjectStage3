import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePassword } from '../../domain/passwordPolicy.js';

export const BREACHED_LIST_VERSION = '2026-10-15.1';

const LIST_FILE = 'breached-passwords.txt';
const SHA_FILE = 'breached-passwords.txt.sha256';

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

export function defaultBreachedListDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Offline list only. Never fetches HIBP or any other network (AUTH-PW-02-OFF). */
export function loadBreachedPasswordList(
  dir: string = defaultBreachedListDir(),
): BreachedPasswordList {
  const body = readFileSync(join(dir, LIST_FILE));
  const recorded = readFileSync(join(dir, SHA_FILE), 'utf8').trim().split(/\s+/)[0];
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (recorded !== sha256) {
    throw new BreachedListError(
      `breached-password list sha256 mismatch: expected ${recorded}, got ${sha256}`,
    );
  }

  const entries = new Set<string>();
  for (const line of body.toString('utf8').split('\n')) {
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
