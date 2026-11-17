/**
 * Production image smoke: dist must import with devDependencies pruned.
 * Fails if compiled src still names ajv or yaml, then imports the built app,
 * loads the embedded breached-password list (no .txt next to dist), and boots
 * dist/src/main.js far enough to prove the list loads before any DB/Redis await.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const distSrc = join(root, 'dist/src');
const forbidden = /from ['"](?:ajv|yaml)(?:\/|['"])/;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

const offenders = walk(distSrc).filter((file) => forbidden.test(readFileSync(file, 'utf8')));
if (offenders.length > 0) {
  process.stderr.write(`devDependency import in dist:\n${offenders.join('\n')}\n`);
  process.exit(1);
}

process.env.NODE_ENV = 'production';
delete process.env.DEMO_LOGIN_ENABLED;
await import(pathToFileURL(join(distSrc, 'app.js')).href);

// P6-8: the list body is embedded, so this must work with no .txt beside dist.
const { loadBreachedPasswordList, BREACHED_LIST_SHA256 } = await import(
  pathToFileURL(join(distSrc, 'modules/identity/infra/crypto/breachedPasswords.js')).href
);
const list = loadBreachedPasswordList();
if (list.sha256 !== BREACHED_LIST_SHA256 || !list.has('password123')) {
  process.stderr.write(`dist breached-password list is wrong: ${list.sha256}\n`);
  process.exit(1);
}
process.stdout.write('prod dist import ok\n');

// Boot the real entrypoint with production-shaped fixture env and stop as soon as the
// offline list boot line appears (no Postgres/Redis required).
const config = await import(pathToFileURL(join(distSrc, 'platform/config.js')).href);
const fixtureEnv = {
  NODE_ENV: 'production',
  DEPLOY_ENV: 'production',
  LOG_LEVEL: 'info',
  DATABASE_URL_APP: 'postgres://vproject_app:vproject@db.example.ir:5432/vproject?sslmode=require',
  DATABASE_URL_IDENTITY:
    'postgres://vproject_identity:vproject@db.example.ir:5432/vproject?sslmode=require',
  REDIS_URL: 'rediss://cache.example.ir:6379',
  OPENAPI_DOCS_ENABLED: 'false',
  TRUST_PROXY_HOPS: '1',
  AUDIT_HASH_KEY: config.PROD_FIXTURE_AUDIT_HASH_KEY,
  OTP_HMAC_KEY: config.PROD_FIXTURE_OTP_HMAC_KEY,
  SMS_PROVIDER: 'kavenegar',
  SMS_LIVE_SEND: 'true',
  SMS_BUDGET_HOUR: '100',
  SMS_BUDGET_DAY: '1000',
  KAVENEGAR_API_KEY: config.PROD_LIVE_FIXTURE_KAVENEGAR_API_KEY,
  KAVENEGAR_TEMPLATE: config.PROD_FIXTURE_KAVENEGAR_TEMPLATE,
};

const MARKER = 'offline breached-password list loaded';
const child = spawn(process.execPath, [join(distSrc, 'main.js')], {
  cwd: root,
  env: { ...process.env, ...fixtureEnv },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let sawMarker = false;
const onChunk = (chunk) => {
  output += chunk.toString();
  if (sawMarker || !output.includes(MARKER)) return;
  sawMarker = true;
  child.kill('SIGTERM');
};
child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);

const TIMEOUT_MS = 60_000;
const timer = setTimeout(() => {
  child.kill('SIGKILL');
}, TIMEOUT_MS);
const onceExit = new Promise((resolve) =>
  child.once('exit', (code, signal) => resolve({ code, signal })),
);

const { code, signal } = await onceExit;
clearTimeout(timer);

if (!sawMarker) {
  const failedEarly = /breached-password|ENOENT|MODULE_NOT_FOUND/i.test(output);
  process.stderr.write(
    `main.js never logged "${MARKER}" (exit code=${code} signal=${signal}` +
      `${failedEarly ? ', missing-file/list error' : ''}):\n${output}\n`,
  );
  process.exit(1);
}
process.stdout.write('prod main.js breached-password boot ok\n');
