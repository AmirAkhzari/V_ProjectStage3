import type { Redis } from 'ioredis';
import { AppError } from '../http/errors.js';

export const AUTH_ISSUANCE_RETRY_AFTER_SECONDS = 5;

/**
 * AUTH-AV-01 / SESS-05: new logins, OTP send/verify and C11 fail closed when Redis is down.
 * HTTP wrappers are S11b-4/5; this gate is the control they must call.
 */
export async function assertRedisForAuthIssuance(redis: Redis): Promise<void> {
  try {
    if (redis.status === 'wait' || redis.status === 'close' || redis.status === 'end') {
      await redis.connect();
    }
    const reply = await redis.ping();
    if (reply !== 'PONG') throw new Error('redis ping failed');
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
      retryAfter: AUTH_ISSUANCE_RETRY_AFTER_SECONDS,
    });
  }
}
