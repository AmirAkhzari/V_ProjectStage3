import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { AppError } from '../../../platform/http/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../../platform/auth/jwt.js';
import { systemClock } from '../../../platform/lib/clock.js';
import { isRetryableLockError } from '../infra/session/lockOrder.js';
import type { StaffRole } from '../domain/permissions.js';
import type { OtpAuthRuntime } from './otpAuth.js';
import type { RefreshCallContext, RefreshSubjectProfile } from './refreshStore.js';

const RT_MIN = 43;
const RT_MAX = 512;

export function refreshUnauthenticated(): AppError {
  return new AppError('UNAUTHENTICATED', 401, 'Authentication required');
}

function unavailable(): AppError {
  return new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
    retryAfter: 2,
  });
}

function internal(runtime: OtpAuthRuntime, keywords?: string): never {
  runtime.log.error(
    { alert: 'refresh_response_shape', ...(keywords ? { keywords } : {}) },
    'refresh response rejected by schema',
  );
  throw new AppError('INTERNAL', 500, 'Internal server error');
}

export function mapRefreshTransport(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (isRetryableLockError(error) || isPgDown(error)) throw unavailable();
  throw error;
}

const PG_DOWN_MESSAGE =
  /connection terminated|connection timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|getaddrinfo/i;

function isPgDown(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (
    code &&
    (code.startsWith('08') ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03' ||
      code === '53300' ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND')
  ) {
    return true;
  }
  if (code) return false;
  const message = error instanceof Error ? error.message : '';
  return PG_DOWN_MESSAGE.test(message);
}

/** Schema-valid refresh token, or undefined (A3/B3/C2 then 401, never 422). */
export function presentedRefreshToken(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'refreshToken') return undefined;
  const token = record['refreshToken'];
  if (typeof token !== 'string' || token.length < RT_MIN || token.length > RT_MAX) return undefined;
  return token;
}

/** A4 only: missing or out-of-range refreshToken is 422 with no token echo. */
export function requireLogoutToken(body: unknown): string {
  const token = presentedRefreshToken(body);
  if (!token) throw new AppError('VALIDATION_FAILED', 422, 'Request validation failed');
  return token;
}

export function assertEmptyLogoutBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return;
  throw new AppError('VALIDATION_FAILED', 422, 'Request validation failed');
}

export function refreshCallContext(
  ip: string,
  userAgent: string | string[] | undefined,
  demoLogin = false,
): RefreshCallContext {
  const ua = Array.isArray(userAgent) ? userAgent[0] : userAgent;
  return { ip, demoLogin, ...(ua ? { userAgent: ua.slice(0, 200) } : {}) };
}

export interface ShopkeeperRefreshBody {
  accessToken: string;
  accessTokenExpiresAt: string;
  absoluteExpiresAt: string;
  tokenType: 'Bearer';
  user: { id: string; phone: string; isNewAccount: boolean };
  refreshToken?: string;
  refreshExpiresAt?: string;
}

export interface StaffRefreshBody {
  accessToken: string;
  accessTokenExpiresAt: string;
  absoluteExpiresAt: string;
  tokenType: 'Bearer';
  staff: {
    id: string;
    phone: string;
    role: StaffRole;
    distributorId: string | null;
    permissions: string[];
  };
  refreshToken?: string;
  refreshExpiresAt?: string;
}

export async function refreshShopkeeper(
  runtime: OtpAuthRuntime,
  refreshToken: string,
  context: RefreshCallContext,
): Promise<ShopkeeperRefreshBody> {
  const result = await rotateOrThrow(runtime, refreshToken, 'shopkeeper', context);
  const profile = result.profile;
  if (!profile) internal(runtime);
  const body: ShopkeeperRefreshBody = {
    accessToken: await sign(runtime, result, profile, 'shopkeeper'),
    accessTokenExpiresAt: accessExpiry(runtime),
    absoluteExpiresAt: result.absoluteExpiresAt.toISOString(),
    tokenType: 'Bearer',
    user: { id: result.accountId, phone: profile.phone, isNewAccount: false },
    ...refreshPair(result),
  };
  if (result.status === 'rotated' && !body.refreshToken) internal(runtime, 'dependentRequired');
  assertRefreshShape(runtime, 'ShopkeeperRefreshSession', body);
  return body;
}

export async function refreshStaff(
  runtime: OtpAuthRuntime,
  refreshToken: string,
  context: RefreshCallContext,
): Promise<StaffRefreshBody> {
  const result = await rotateOrThrow(runtime, refreshToken, 'staff', context);
  const profile = result.profile;
  if (!profile || !profile.staffRole) internal(runtime);
  const body: StaffRefreshBody = {
    accessToken: await sign(runtime, result, profile, 'staff'),
    accessTokenExpiresAt: accessExpiry(runtime),
    absoluteExpiresAt: result.absoluteExpiresAt.toISOString(),
    tokenType: 'Bearer',
    staff: {
      id: result.accountId,
      phone: profile.phone,
      role: profile.staffRole,
      distributorId: profile.distributorId,
      permissions: profile.permissions,
    },
    ...refreshPair(result),
  };
  if (result.status === 'rotated' && !body.refreshToken) internal(runtime, 'dependentRequired');
  assertRefreshShape(runtime, 'StaffRefreshSession', body);
  return body;
}

/** V11-LO-02: unknown and live A4 lookups share a response floor so the drain and writes are not an oracle. */
const A4_RESPONSE_FLOOR_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function logoutShopkeeperRefresh(
  runtime: OtpAuthRuntime,
  refreshToken: string,
  context: RefreshCallContext,
): Promise<{ status: 'ok' }> {
  const started = performance.now();
  try {
    await runtime.store.logoutPresented(
      refreshToken,
      'shopkeeper',
      runtime.clock ?? systemClock,
      context,
    );
  } catch (error) {
    mapRefreshTransport(error);
  }
  const remain = A4_RESPONSE_FLOOR_MS - (performance.now() - started);
  if (remain > 0) await delay(remain);
  return { status: 'ok' };
}

export async function logoutStaffSid(
  runtime: OtpAuthRuntime,
  sid: string,
  context: RefreshCallContext,
): Promise<{ status: 'ok' }> {
  try {
    await runtime.store.logoutSid(sid, 'staff', runtime.clock ?? systemClock, context);
  } catch (error) {
    mapRefreshTransport(error);
  }
  return { status: 'ok' };
}

async function rotateOrThrow(
  runtime: OtpAuthRuntime,
  refreshToken: string,
  typ: 'shopkeeper' | 'staff',
  context: RefreshCallContext,
) {
  let result;
  try {
    result = await runtime.store.rotate(refreshToken, typ, runtime.clock ?? systemClock, context);
  } catch (error) {
    mapRefreshTransport(error);
  }
  if (result.status === 'rejected') {
    if (result.reason === 'lock_timeout') throw unavailable();
    throw refreshUnauthenticated();
  }
  return result;
}

function accessExpiry(runtime: OtpAuthRuntime): string {
  return new Date(
    (runtime.clock ?? systemClock)().getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
}

async function sign(
  runtime: OtpAuthRuntime,
  result: { accountId: string; sid: string },
  profile: RefreshSubjectProfile,
  typ: 'shopkeeper' | 'staff',
): Promise<string> {
  return runtime.jwt.sign({
    sub: result.accountId,
    typ,
    sid: result.sid,
    sv: profile.sessionVersion,
    ...(typ === 'staff' && profile.distributorId ? { did: profile.distributorId } : {}),
    ...(profile.isDemo ? { demo: true as const } : {}),
  });
}

function refreshPair(result: {
  status: string;
  refreshToken?: string;
  refreshExpiresAt?: Date;
}): { refreshToken: string; refreshExpiresAt: string } | Record<string, never> {
  if (result.status === 'grace' || !result.refreshToken || !result.refreshExpiresAt) return {};
  return {
    refreshToken: result.refreshToken,
    refreshExpiresAt: result.refreshExpiresAt.toISOString(),
  };
}

let validators: { shopkeeper: ValidateFunction; staff: ValidateFunction } | undefined;

export function refreshSchemaValidators(): {
  shopkeeper: ValidateFunction;
  staff: ValidateFunction;
} {
  if (validators) return validators;
  const yamlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../openapi/openapi-v1.2.0.yaml',
  );
  const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
    components: { schemas: Record<string, object> };
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat('date-time', true);
  ajv.addFormat('uuid', true);
  ajv.addFormat('email', true);
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }
  const shopkeeper = ajv.getSchema('#/components/schemas/ShopkeeperRefreshSession');
  const staff = ajv.getSchema('#/components/schemas/StaffRefreshSession');
  if (!shopkeeper || !staff) throw new Error('refresh schemas missing');
  validators = { shopkeeper, staff };
  return validators;
}

// Fail at import if the frozen schema file is missing, before a rotation can commit (P20-9).
refreshSchemaValidators();

function assertRefreshShape(
  runtime: OtpAuthRuntime,
  name: 'ShopkeeperRefreshSession' | 'StaffRefreshSession',
  body: unknown,
): void {
  let validator: ValidateFunction;
  try {
    const loaded = refreshSchemaValidators();
    validator = name === 'ShopkeeperRefreshSession' ? loaded.shopkeeper : loaded.staff;
  } catch {
    internal(runtime);
  }
  if (!validator(body)) {
    const keywords = validator.errors?.map((entry) => entry.keyword).join(',') ?? 'invalid';
    internal(runtime, keywords);
  }
  const record = body as { refreshToken?: unknown; refreshExpiresAt?: unknown };
  if ((record.refreshToken === undefined) !== (record.refreshExpiresAt === undefined)) {
    internal(runtime, 'dependentRequired');
  }
}
