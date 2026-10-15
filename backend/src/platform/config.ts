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

function postgresRequiresTls(url: string): boolean {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase();
  if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') return true;
  const ssl = parsed.searchParams.get('ssl')?.toLowerCase();
  return ssl === 'true' || ssl === '1';
}

function redisRequiresTls(url: string): boolean {
  return new URL(url).protocol === 'rediss:';
}

function productionEnvFlagIssues(env: NodeJS.ProcessEnv): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
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

const postgresUrlKeys = [
  'DATABASE_URL_APP',
  'DATABASE_URL_WORKER',
  'DATABASE_URL_IDENTITY',
  'MIGRATION_DATABASE_URL',
] as const;

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL_APP: postgresUrl,
    DATABASE_URL_WORKER: postgresUrl,
    DATABASE_URL_IDENTITY: postgresUrl,
    MIGRATION_DATABASE_URL: postgresUrl.optional(),
    REDIS_URL: redisUrl,
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(50).max(10_000).default(1000),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    OUTBOX_LAG_THRESHOLD_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
    READY_RETRY_AFTER_SECONDS: z.coerce.number().int().min(1).max(60).default(5),
    OPENAPI_DOCS_ENABLED: booleanString,
  })
  .superRefine((value, ctx) => {
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
    for (const key of postgresUrlKeys) {
      const url = value[key];
      if (!url) {
        if (key === 'MIGRATION_DATABASE_URL') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'production MIGRATION_DATABASE_URL is required',
          });
        }
        continue;
      }
      if (!postgresRequiresTls(url)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `production ${key} must require TLS (sslmode=require|verify-ca|verify-full)`,
        });
      }
    }
    if (!redisRequiresTls(value.REDIS_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'production REDIS_URL must use rediss://',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  const extra =
    env['NODE_ENV'] === 'production' ? productionEnvFlagIssues(env) : ([] as ConfigIssue[]);
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

/** Loads config or prints field-level errors and exits the process with code 1. */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
