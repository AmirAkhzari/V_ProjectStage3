import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import {
  capPasswordBytes,
  DUMMY_ARGON2ID_HASH,
  normalizeUsername,
  PASSWORD_MAX_BYTES,
} from '../../src/modules/identity/domain/loginPolicy.js';
import { isRetryableLockError } from '../../src/modules/identity/infra/session/lockOrder.js';

const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../../openapi/openapi-v1.2.0.yaml');

describe('S11b-4a login policy / G6 / F13-1', () => {
  it('normalises usernames: trim, NFKC, lower, cap 64', () => {
    expect(normalizeUsername('  AbC  ')).toBe('abc');
    expect(normalizeUsername('ﬁle')).toBe('file');
    expect(normalizeUsername('x'.repeat(80))).toHaveLength(64);
  });

  it('9-3: caps the password in bytes before NFKC', () => {
    const raw = 'é'.repeat(80);
    expect(Buffer.from(raw, 'utf8').length).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(Buffer.from(capPasswordBytes(raw), 'utf8').length).toBeLessThanOrEqual(
      PASSWORD_MAX_BYTES,
    );
  });

  it('9-10: dummy argon2id verify runs and rejects', async () => {
    const hasher = new Argon2idPasswordHasher();
    expect(DUMMY_ARGON2ID_HASH.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(DUMMY_ARGON2ID_HASH, 'any-password')).toBe(false);
  });

  it('F13-1: 55P03 and 40P01 are retryable lock errors', () => {
    expect(isRetryableLockError({ code: '55P03', message: 'lock timeout' })).toBe(true);
    expect(isRetryableLockError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
    expect(isRetryableLockError({ code: '23505', message: 'unique' })).toBe(false);
  });

  it('G6: DriverAuthSession / DriverRefreshSession validate against frozen yaml', () => {
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
    const login = ajv.getSchema('#/components/schemas/DriverAuthSession');
    const refresh = ajv.getSchema('#/components/schemas/DriverRefreshSession');
    if (!login || !refresh) throw new Error('missing schemas');
    const driver = {
      id: '11111111-1111-1111-1111-111111111111',
      username: 'driver1',
      distributorId: '22222222-2222-2222-2222-222222222222',
    };
    const pair = {
      refreshToken: 'a'.repeat(43),
      refreshExpiresAt: '2026-11-01T02:00:00.000Z',
    };
    const core = {
      accessToken: 'hdr.payload.sig',
      accessTokenExpiresAt: '2026-11-01T01:15:00.000Z',
      absoluteExpiresAt: '2026-11-01T11:00:00.000Z',
      tokenType: 'Bearer',
      mustChangePassword: false,
      driver,
    };
    expect(login({ ...core, ...pair })).toBe(true);
    expect(refresh({ ...core, ...pair })).toBe(true);
    expect(refresh(core)).toBe(true);
    expect(refresh({ ...core, refreshToken: pair.refreshToken })).toBe(false);
  });
});
