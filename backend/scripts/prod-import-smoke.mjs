/**
 * Production image smoke: dist must import with devDependencies pruned.
 * Fails if compiled src still names ajv or yaml, then imports the built app.
 */
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
process.stdout.write('prod dist import ok\n');
