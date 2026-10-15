import { Redis } from 'ioredis';

export interface RedisLog {
  error(bindings: Record<string, unknown>, message: string): void;
}

export function createRedis(redisUrl: string, log?: RedisLog): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  client.on('error', (err: Error & { code?: string }) => {
    log?.error({ code: err.code }, 'redis client error');
  });
  return client;
}
