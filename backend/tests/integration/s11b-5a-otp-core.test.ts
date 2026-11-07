import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  refundOtpSend,
  reserveOtpSend,
} from '../../src/modules/identity/application/otpLimiter.js';
import {
  consumeOtpChallenge,
  generateOtpCode,
  putOtpChallenge,
} from '../../src/modules/identity/infra/otp/redisOtpStore.js';
import { createRedis } from '../../src/platform/redis.js';
import { smsRefundable } from '../../src/modules/notification/application/ports.js';
import { TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';

describe('S11b-5a OTP Redis core', () => {
  let redisBox: StartedRedisContainer;
  let redis: ReturnType<typeof createRedis>;

  beforeAll(async () => {
    redisBox = await new RedisContainer('redis:7-alpine').start();
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
  }, 120_000);

  afterAll(async () => {
    await redis?.quit().catch(() => redis?.disconnect());
    await redisBox?.stop();
  });

  beforeEach(async () => {
    const keys = [...(await redis.keys('otp:*')), ...(await redis.keys('login:*'))];
    if (keys.length > 0) await redis.del(...keys);
  });

  it('LIM-OTP-T-01/02/04/05: reserve 1/60s, budget fail-closed, resend invalidates, consume once', async () => {
    const phone = '+989121000001';
    const ip = '203.0.113.10';
    expect(smsRefundable({ status: 'rejected', failureClass: 'receptor' })).toBe(true);
    expect(smsRefundable({ status: 'ops', failureClass: 'ops', reason: 'credit' })).toBe(false);
    const first = await reserveOtpSend(redis, phone, ip, { hour: 5, day: 10 });
    expect(first.status).toBe('reserved');
    expect((await reserveOtpSend(redis, phone, ip, { hour: 5, day: 10 })).status).toBe('blocked');
    await refundOtpSend(redis, phone, ip);
    const code1 = generateOtpCode();
    await putOtpChallenge(redis, { pepper: TEST_OTP_HMAC_KEY, purpose: 'app', phone, code: code1 });
    const code2 = generateOtpCode() === code1 ? '000001' : generateOtpCode();
    await putOtpChallenge(redis, { pepper: TEST_OTP_HMAC_KEY, purpose: 'app', phone, code: code2 });
    expect(
      await consumeOtpChallenge(redis, {
        pepper: TEST_OTP_HMAC_KEY,
        purpose: 'app',
        phone,
        code: code1,
      }),
    ).toBe('invalid');
    expect(
      await consumeOtpChallenge(redis, {
        pepper: TEST_OTP_HMAC_KEY,
        purpose: 'app',
        phone,
        code: code2,
      }),
    ).toBe('ok');
    expect(
      await consumeOtpChallenge(redis, {
        pepper: TEST_OTP_HMAC_KEY,
        purpose: 'app',
        phone,
        code: code2,
      }),
    ).toBe('invalid');
    expect(
      (await reserveOtpSend(redis, '+989121000002', '203.0.113.11', { hour: 0, day: 10 })).status,
    ).toBe('blocked');
  });

  it('LIM-OTP-T-03: fifth mismatch locks', async () => {
    const phone = '+989121000003';
    await putOtpChallenge(redis, {
      pepper: TEST_OTP_HMAC_KEY,
      purpose: 'staff',
      phone,
      code: '424242',
    });
    let last: string = 'ok';
    for (let i = 0; i < 5; i += 1) {
      last = await consumeOtpChallenge(redis, {
        pepper: TEST_OTP_HMAC_KEY,
        purpose: 'staff',
        phone,
        code: '000000',
      });
    }
    expect(last).toBe('locked');
  });
});
