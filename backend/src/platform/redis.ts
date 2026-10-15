import { Redis } from 'ioredis';

export function createRedis(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  // Connection errors are reported through the health check instead of crashing the process.
  client.on('error', () => {});
  return client;
}
