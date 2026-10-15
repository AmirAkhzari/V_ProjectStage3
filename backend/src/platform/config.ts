import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .default(false);

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .describe('postgres://user:password@host:5432/db');

const redisUrl = z.url({ protocol: /^rediss?$/ }).describe('redis://host:6379');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(50).max(10_000).default(1000),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  OPENAPI_DOCS_ENABLED: booleanString,
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
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
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
