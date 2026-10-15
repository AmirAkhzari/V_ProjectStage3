#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MODULES = [
  'identity',
  'tenancy',
  'customers',
  'catalog',
  'ordering',
  'delivery',
  'payment',
  'membership',
  'marketing',
  'notification',
  'reporting',
];

const REQUIRED_FILES = [
  'api.ts',
  'events.ts',
  'module.ts',
  'http/app.routes.ts',
  'http/admin.routes.ts',
  'http/driver.routes.ts',
  'infra/db/schema.ts',
];

const REQUIRED_DIRS = ['domain', 'application', 'infra', 'http'];

const errors = [];

async function exists(path, kind) {
  try {
    const info = await stat(path);
    return kind === 'dir' ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

for (const name of MODULES) {
  const base = join(ROOT, 'src/modules', name);
  if (!(await exists(base, 'dir'))) {
    errors.push(`missing module directory: src/modules/${name}`);
    continue;
  }
  for (const dir of REQUIRED_DIRS) {
    if (!(await exists(join(base, dir), 'dir'))) {
      errors.push(`src/modules/${name}/${dir}/ is missing`);
    }
  }
  for (const file of REQUIRED_FILES) {
    if (!(await exists(join(base, file), 'file'))) {
      errors.push(`src/modules/${name}/${file} is missing`);
    }
  }
}

const extra = await readdir(join(ROOT, 'src/modules'));
for (const name of extra) {
  if (name === 'register.ts') continue;
  if (!MODULES.includes(name)) errors.push(`unexpected module directory: src/modules/${name}`);
}

if (!(await exists(join(ROOT, 'src/platform'), 'dir'))) {
  errors.push('src/platform/ is missing (shared kernel; 11 modules + platform = 12)');
}

if (errors.length > 0) {
  process.stderr.write(
    `module structure check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`module structure ok (11 modules + platform = 12)\n`);
