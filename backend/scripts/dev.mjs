#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://vproject:vproject@127.0.0.1:5432/vproject',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: backendRoot, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

await run('docker', ['compose', 'up', '-d', '--wait']);
await run('pnpm', ['db:migrate']);

const api = spawn('pnpm', ['exec', 'tsx', 'watch', 'src/main.ts'], {
  cwd: backendRoot,
  env,
  stdio: 'inherit',
});

const shutdown = (signal) => {
  api.kill(signal);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

api.on('exit', (code) => {
  process.exit(code ?? 1);
});
