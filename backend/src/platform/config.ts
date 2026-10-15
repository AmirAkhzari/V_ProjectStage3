import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .default(false);

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .describe('postgres://user:password@host:5432/db');

const redisUrl = z.url({ protocol: /^rediss?$/ }).describe('redis://host:6379');

const FORBIDDEN_PROD_LOG_LEVELS = new Set(['debug', 'trace']);

export function postgresRequiresTls(url: string): boolean {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase();
  if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') return true;
  const ssl = parsed.searchParams.get('ssl')?.toLowerCase();
  return ssl === 'true' || ssl === '1';
}

function redisRequiresTls(url: string): boolean {
  return new URL(url).protocol === 'rediss:';
}

function productionEnvFlagIssues(env: NodeJS.ProcessEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === '' || value === 'false') continue;
    if (key.startsWith('DEMO_')) {
      issues.push({ field: key, message: 'DEMO_* flags are forbidden in production' });
    }
    if (key.startsWith('MOCK_')) {
      issues.push({ field: key, message: 'MOCK_* flags are forbidden in production' });
    }
    if (key.endsWith('_PROVIDER') && value === 'mock') {
      issues.push({ field: key, message: 'mock providers are forbidden in production' });
    }
  }
  return issues;
}

/** Credentials this process must not hold in production (AppSec N-1). */
const API_FORBIDDEN_URLS = [
  'MIGRATION_DATABASE_URL',
  'DATABASE_URL_WORKER',
  'DATABASE_URL',
] as const;

const WORKER_FORBIDDEN_URLS = [
  'MIGRATION_DATABASE_URL',
  'DATABASE_URL_APP',
  'DATABASE_URL_IDENTITY',
  'DATABASE_URL',
] as const;

function presentEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key];
  return value !== undefined && value !== '';
}

function forbiddenUrlIssues(env: NodeJS.ProcessEnv, keys: readonly string[]): ConfigIssue[] {
  if (env['NODE_ENV'] !== 'production') return [];
  return keys
    .filter((key) => presentEnv(env, key))
    .map((key) => ({
      field: key,
      message: `${key} must not be set on this process in production`,
    }));
}

const processShared = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  REDIS_URL: redisUrl,
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(50).max(10_000).default(1000),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  OUTBOX_LAG_THRESHOLD_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
  READY_RETRY_AFTER_SECONDS: z.coerce.number().int().min(1).max(60).default(5),
  OPENAPI_DOCS_ENABLED: booleanString,
};

function applyProductionShared(
  value: { NODE_ENV: string; OPENAPI_DOCS_ENABLED: boolean; LOG_LEVEL: string; REDIS_URL: string },
  ctx: z.RefinementCtx,
): void {
  if (value.NODE_ENV !== 'production') return;
  if (value.OPENAPI_DOCS_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPENAPI_DOCS_ENABLED'],
      message: 'OpenAPI docs must be disabled in production',
    });
  }
  if (FORBIDDEN_PROD_LOG_LEVELS.has(value.LOG_LEVEL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['LOG_LEVEL'],
      message: 'debug/trace log levels are forbidden in production',
    });
  }
  if (!redisRequiresTls(value.REDIS_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['REDIS_URL'],
      message: 'production REDIS_URL must use rediss://',
    });
  }
}

function requireTls(ctx: z.RefinementCtx, path: string, url: string): void {
  if (!postgresRequiresTls(url)) {
    ctx.addIssue({
      code: 'custom',
      path: [path],
      message: `production ${path} must require TLS (sslmode=require|verify-ca|verify-full)`,
    });
  }
}

export const apiConfigSchema = z
  .object({
    ...processShared,
    DATABASE_URL_APP: postgresUrl,
    DATABASE_URL_IDENTITY: postgresUrl,
  })
  .superRefine((value, ctx) => {
    applyProductionShared(value, ctx);
    if (value.NODE_ENV === 'production') {
      requireTls(ctx, 'DATABASE_URL_APP', value.DATABASE_URL_APP);
      requireTls(ctx, 'DATABASE_URL_IDENTITY', value.DATABASE_URL_IDENTITY);
    }
  });

export const workerConfigSchema = z
  .object({
    ...processShared,
    DATABASE_URL_WORKER: postgresUrl,
  })
  .superRefine((value, ctx) => {
    applyProductionShared(value, ctx);
    if (value.NODE_ENV === 'production') {
      requireTls(ctx, 'DATABASE_URL_WORKER', value.DATABASE_URL_WORKER);
    }
  });

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
/** HTTP process config. Worker has `WorkerConfig`. */
export type Config = ApiConfig;

export interface ConfigIssue {
  field: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.field}: ${i.message}`).join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv, extra: ConfigIssue[]): T {
  const result = schema.safeParse(env);
  if (!result.success || extra.length > 0) {
    const schemaIssues = result.success
      ? []
      : result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        }));
    throw new ConfigError([...schemaIssues, ...extra]);
  }
  return result.data;
}

function productionExtras(env: NodeJS.ProcessEnv, forbiddenKeys: readonly string[]): ConfigIssue[] {
  if (env['NODE_ENV'] !== 'production') return [];
  return [...productionEnvFlagIssues(env), ...forbiddenUrlIssues(env, forbiddenKeys)];
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parseOrThrow(apiConfigSchema, env, productionExtras(env, API_FORBIDDEN_URLS));
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parseOrThrow(workerConfigSchema, env, productionExtras(env, WORKER_FORBIDDEN_URLS));
}

/** API config. Prefer `loadApiConfig` / `loadWorkerConfig` at process entrypoints. */
export const loadConfig = loadApiConfig;

export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return loadOrExit(() => loadApiConfig(env));
}

export function loadWorkerConfigOrExit(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return loadOrExit(() => loadWorkerConfig(env));
}

function loadOrExit<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
