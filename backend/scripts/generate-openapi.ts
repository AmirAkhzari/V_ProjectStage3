import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

const root = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(root, '..');
const FROZEN_YAML = resolve(backendRoot, 'openapi/openapi-v1.0.0.yaml');
const SKELETON_JSON = resolve(backendRoot, 'openapi/from-code.skeleton.json');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');

if (args.has('--out')) {
  process.stderr.write(
    'Refusing --out: generators must not overwrite the frozen contract (openapi-v1.0.0.yaml).\n',
  );
  process.exit(1);
}

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://vproject:vproject@127.0.0.1:5432/vproject',
  REDIS_URL: 'redis://127.0.0.1:6379',
  OPENAPI_DOCS_ENABLED: 'true',
});

const app = await buildApp({
  config,
  healthChecks: [
    { name: 'postgres', check: () => Promise.resolve() },
    { name: 'redis', check: () => Promise.resolve() },
  ],
});

await app.ready();
const spec = app.swagger();
await app.close();

const serialized = `${JSON.stringify(spec, null, 2)}\n`;

if (SKELETON_JSON === FROZEN_YAML) {
  process.stderr.write('internal error: skeleton path collides with frozen yaml\n');
  process.exit(1);
}

if (checkOnly) {
  process.stdout.write(
    `code-generated OpenAPI has ${Object.keys(spec.paths ?? {}).length} path(s); frozen yaml left untouched\n`,
  );
  process.exit(0);
}

await writeFile(SKELETON_JSON, serialized);
process.stdout.write(`wrote ${SKELETON_JSON} (frozen yaml not modified)\n`);
