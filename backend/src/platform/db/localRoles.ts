export class LocalRolesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalRolesError';
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isIpv4(host: string): number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
  return nums;
}

/** RFC1918 / link-local — Testcontainers may publish on a docker bridge in CI. */
export function isPrivateOrLoopbackHost(host: string): boolean {
  if (LOOPBACK.has(host)) return true;
  if (host.endsWith('.testcontainers.internal')) return true;
  const ip = isIpv4(host);
  if (!ip) return false;
  const [a, b] = ip as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Local `roles.sql` may run only against loopback/Testcontainers, and never in production.
 */
export function assertLocalRolesTarget(
  databaseUrl: string,
  nodeEnv: string | undefined = process.env['NODE_ENV'],
): void {
  if (nodeEnv === 'production') {
    throw new LocalRolesError('local roles.sql must not run when NODE_ENV=production');
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new LocalRolesError('local roles.sql refused: DATABASE_URL is not a valid URL');
  }
  if (LOOPBACK.has(host)) return;
  if (nodeEnv === 'test' && isPrivateOrLoopbackHost(host)) return;
  throw new LocalRolesError('local roles.sql refused: target host is not loopback/Testcontainers');
}

/** Missing DB roles may be skipped only on loopback/Testcontainers, never in production (AppSec N-3). */
export function allowMissingRoles(
  databaseUrl: string,
  nodeEnv: string | undefined = process.env['NODE_ENV'],
): boolean {
  if (nodeEnv === 'production') return false;
  try {
    return isPrivateOrLoopbackHost(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}
