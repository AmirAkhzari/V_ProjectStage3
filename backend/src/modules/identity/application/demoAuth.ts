import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { AppError } from '../../../platform/http/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../../platform/auth/jwt.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import { systemClock } from '../../../platform/lib/clock.js';
import { permissionsForRole } from '../domain/permissions.js';
import { DEMO_SHOPKEEPER_PHONE, DEMO_STAFF_PHONE } from '../domain/demoAccounts.js';
import { maskIranMobile } from '../domain/otpPolicy.js';
import { PgSessionStore } from '../infra/session/pgSessionStore.js';
import {
  rememberOrAbort,
  type OtpAuthRuntime,
  type ShopkeeperSessionView,
  type StaffSessionView,
} from './otpAuth.js';

const unavailable = () =>
  new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', { retryAfter: 2 });

/** Non-empty body is 422 before any demo write. */
export function assertEmptyDemoBody(body: unknown): void {
  if (body == null) return;
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return;
  throw new AppError('VALIDATION_FAILED', 422, 'Request validation failed');
}

export async function loginDemoShopkeeper(
  runtime: OtpAuthRuntime,
  ip: string,
): Promise<ShopkeeperSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  const accountId = await requireDemoShopkeeper(runtime);
  const sid = randomUUID();
  const now = (runtime.clock ?? systemClock)();
  let issued;
  try {
    issued = await runtime.store.issue(
      {
        accountId,
        sid,
        familyId: randomUUID(),
        typ: 'shopkeeper',
        requireActive: true,
        beforeCommit: (client) =>
          writeDemoAudit(client, {
            accountId,
            actorType: 'shopkeeper',
            distributorId: null,
            sid,
            ip,
            phone: DEMO_SHOPKEEPER_PHONE,
            now,
          }),
      },
      runtime.clock ?? systemClock,
    );
  } catch {
    throw unavailable();
  }
  await rememberOrAbort(runtime, sid);
  const snap = await new PgSessionStore(runtime.identityPool).lookup(sid);
  if (!snap) throw unavailable();
  const body: ShopkeeperSessionView = {
    accessToken: await runtime.jwt.sign({
      sub: accountId,
      typ: 'shopkeeper',
      sid,
      sv: snap.sessionVersion,
      demo: true,
    }),
    accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: issued.absoluteExpiresAt.toISOString(),
    tokenType: 'Bearer',
    user: { id: accountId, phone: DEMO_SHOPKEEPER_PHONE, isNewAccount: false },
  };
  assertSessionShape(runtime, 'shopkeeper', body);
  return body;
}

export async function loginDemoStaff(
  runtime: OtpAuthRuntime,
  ip: string,
): Promise<StaffSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  const staff = await requireDemoStaff(runtime);
  const sid = randomUUID();
  const now = (runtime.clock ?? systemClock)();
  let issued;
  try {
    issued = await runtime.store.issue(
      {
        accountId: staff.id,
        sid,
        familyId: randomUUID(),
        typ: 'staff',
        requireActive: true,
        expectedStaffRole: 'distributor_admin',
        expectedDistributorId: staff.distributorId,
        distributorId: staff.distributorId,
        beforeCommit: (client) =>
          writeDemoAudit(client, {
            accountId: staff.id,
            actorType: 'staff',
            distributorId: staff.distributorId,
            sid,
            ip,
            phone: DEMO_STAFF_PHONE,
            now,
          }),
      },
      runtime.clock ?? systemClock,
    );
  } catch {
    throw unavailable();
  }
  await rememberOrAbort(runtime, sid);
  const snap = await new PgSessionStore(runtime.identityPool).lookup(sid);
  if (!snap) throw unavailable();
  const permissions = [...permissionsForRole('distributor_admin', staff.permissions)];
  const body: StaffSessionView = {
    accessToken: await runtime.jwt.sign({
      sub: staff.id,
      typ: 'staff',
      sid,
      sv: snap.sessionVersion,
      did: staff.distributorId,
      demo: true,
    }),
    accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: issued.absoluteExpiresAt.toISOString(),
    tokenType: 'Bearer',
    staff: {
      id: staff.id,
      phone: DEMO_STAFF_PHONE,
      role: 'distributor_admin',
      distributorId: staff.distributorId,
      permissions,
    },
  };
  assertSessionShape(runtime, 'staff', body);
  return body;
}

async function requireDemoShopkeeper(runtime: OtpAuthRuntime): Promise<string> {
  const row = await lookupDemo(runtime, DEMO_SHOPKEEPER_PHONE, 'shopkeeper');
  return row.account_id;
}

async function requireDemoStaff(
  runtime: OtpAuthRuntime,
): Promise<{ id: string; distributorId: string; permissions: string[] }> {
  const row = await lookupDemo(runtime, DEMO_STAFF_PHONE, 'staff');
  if (!row.distributor_id) throw unavailable();
  return {
    id: row.account_id,
    distributorId: row.distributor_id,
    permissions: row.permissions ?? [],
  };
}

async function lookupDemo(
  runtime: OtpAuthRuntime,
  phone: string,
  typ: 'shopkeeper' | 'staff',
): Promise<{ account_id: string; distributor_id: string | null; permissions: string[] | null }> {
  let found;
  try {
    found = await runtime.identityPool.query<{
      account_id: string;
      distributor_id: string | null;
      permissions: string[] | null;
    }>(`SELECT account_id, distributor_id, permissions FROM identity.lookup_demo_account($1, $2)`, [
      phone,
      typ,
    ]);
  } catch {
    throw unavailable();
  }
  const row = found.rows[0];
  if (found.rows.length !== 1 || !row) throw unavailable();
  return row;
}

async function writeDemoAudit(
  db: { query: (queryText: string, values?: unknown[]) => Promise<unknown> },
  input: {
    accountId: string;
    actorType: 'shopkeeper' | 'staff';
    distributorId: string | null;
    sid: string;
    ip: string;
    phone: string;
    now: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO platform.audit_log (
       id, at, actor_type, actor_id, actor_name, distributor_id,
       action, entity, entity_id, data, ip
     ) VALUES ($1, $2, $3, $4, $3, $5, 'login_success', 'account', $6, $7, $8)`,
    [
      randomUUID(),
      input.now,
      input.actorType,
      input.accountId,
      input.distributorId,
      input.sid,
      JSON.stringify({ phoneMasked: maskIranMobile(input.phone), demo: true }),
      input.ip,
    ],
  );
}

let validators: { shopkeeper: ValidateFunction; staff: ValidateFunction } | undefined;

function sessionValidators(): { shopkeeper: ValidateFunction; staff: ValidateFunction } {
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
  const shopkeeper = ajv.getSchema('#/components/schemas/ShopkeeperSession');
  const staff = ajv.getSchema('#/components/schemas/StaffSession');
  if (!shopkeeper || !staff) throw new Error('demo session schemas missing');
  validators = { shopkeeper, staff };
  return validators;
}

sessionValidators();

function assertSessionShape(
  runtime: OtpAuthRuntime,
  kind: 'shopkeeper' | 'staff',
  body: unknown,
): void {
  if (sessionValidators()[kind](body)) return;
  runtime.log.error({ alert: 'demo_response_shape' }, 'demo response rejected by schema');
  throw new AppError('INTERNAL', 500, 'Internal server error');
}
