import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  luaSafeInt,
  otpLimitKeys,
  refundOtpBudgetOnly,
  refundOtpSend,
  reserveOtpSend,
  type OtpBudgetLimits,
} from '../../src/modules/identity/application/otpLimiter.js';
import {
  consumeOtpChallenge,
  deleteOtpChallengeIfIssuance,
  generateOtpCode,
  newOtpIssuanceId,
  otpPhoneHash,
  putOtpChallenge,
} from '../../src/modules/identity/infra/otp/redisOtpStore.js';
import { createRedis } from '../../src/platform/redis.js';
import { startRedis, type StartedTestRedis } from '../helpers/containers.js';
import { smsRefundable } from '../../src/modules/notification/application/ports.js';
import { TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';

const pepper = TEST_OTP_HMAC_KEY;
const skip = { hour: 0, day: 0, skipBudget: true };

describe('S11b-5a OTP Redis core', () => {
  let redisBox: StartedTestRedis;
  let redis: ReturnType<typeof createRedis>;

  beforeAll(async () => {
    redisBox = await startRedis();
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

  it('LIM-OTP-T-01/02/05: reserve 1/60s, budget fail-closed, resend invalidates, consume once', async () => {
    const phone = '+989121000001';
    const ip = '203.0.113.10';
    expect(smsRefundable({ status: 'rejected', failureClass: 'receptor' })).toBe(true);
    expect(smsRefundable({ status: 'ops', failureClass: 'ops', reason: 'credit' })).toBe(false);
    const first = await reserveOtpSend(redis, phone, ip, pepper, { hour: 5, day: 10 });
    expect(first.status).toBe('reserved');
    expect((await reserveOtpSend(redis, phone, ip, pepper, { hour: 5, day: 10 })).status).toBe(
      'blocked',
    );
    if (first.status === 'reserved') {
      await refundOtpSend(redis, phone, ip, pepper, first.token);
    }
    const code1 = generateOtpCode();
    await putOtpChallenge(redis, {
      pepper,
      purpose: 'app',
      phone,
      code: code1,
      issuanceId: newOtpIssuanceId(),
    });
    const code2 = generateOtpCode() === code1 ? '000001' : generateOtpCode();
    await putOtpChallenge(redis, {
      pepper,
      purpose: 'app',
      phone,
      code: code2,
      issuanceId: newOtpIssuanceId(),
    });
    expect(
      (await consumeOtpChallenge(redis, { pepper, purpose: 'app', phone, code: code1 })).status,
    ).toBe('invalid');
    expect(
      (await consumeOtpChallenge(redis, { pepper, purpose: 'app', phone, code: code2 })).status,
    ).toBe('ok');
    expect(
      (await consumeOtpChallenge(redis, { pepper, purpose: 'app', phone, code: code2 })).status,
    ).toBe('invalid');
    expect(
      (await reserveOtpSend(redis, '+989121000002', '203.0.113.11', pepper, { hour: 0, day: 10 }))
        .status,
    ).toBe('blocked');
  });

  it('LIM-OTP-T-03: fifth mismatch locks', async () => {
    const phone = '+989121000003';
    await putOtpChallenge(redis, {
      pepper,
      purpose: 'staff',
      phone,
      code: '424242',
      issuanceId: newOtpIssuanceId(),
    });
    let last = 'ok';
    for (let i = 0; i < 5; i += 1) {
      last = (await consumeOtpChallenge(redis, { pepper, purpose: 'staff', phone, code: '000000' }))
        .status;
    }
    expect(last).toBe('locked');
  });

  it('N17-3: miss also increments vfail', async () => {
    const phone = '+989121000011';
    const hash = otpPhoneHash(phone, pepper);
    expect(
      (await consumeOtpChallenge(redis, { pepper, purpose: 'app', phone, code: '000000' })).status,
    ).toBe('invalid');
    expect(await redis.get(`otp:vfail:${hash}`)).toBe('1');
  });

  it('LIM-OTP-T-04: verify-fail 10/hour pre-check does not consume', async () => {
    const phone = '+989121000004';
    const hash = otpPhoneHash(phone, pepper);
    await redis.set(`otp:vfail:${hash}`, '10', 'EX', 3600);
    await putOtpChallenge(redis, {
      pepper,
      purpose: 'app',
      phone,
      code: '111111',
      issuanceId: newOtpIssuanceId(),
    });
    const limited = await consumeOtpChallenge(redis, {
      pepper,
      purpose: 'app',
      phone,
      code: '111111',
    });
    expect(limited.status).toBe('limited');
    await redis.del(`otp:vfail:${hash}`);
    expect(
      (await consumeOtpChallenge(redis, { pepper, purpose: 'app', phone, code: '111111' })).status,
    ).toBe('ok');
  });

  it('R15-2: refund is token-bound and does not clear a newer cooldown', async () => {
    const phone = '+989121000005';
    const ip = '203.0.113.15';
    const first = await reserveOtpSend(redis, phone, ip, pepper, skip);
    expect(first.status).toBe('reserved');
    if (first.status !== 'reserved') return;
    await redis.del(`otp:lim:p60:${otpPhoneHash(phone, pepper)}`);
    const second = await reserveOtpSend(redis, phone, ip, pepper, skip);
    expect(second.status).toBe('reserved');
    if (second.status !== 'reserved') return;
    await refundOtpSend(redis, phone, ip, pepper, first.token);
    expect((await reserveOtpSend(redis, phone, ip, pepper, skip)).status).toBe('blocked');
    expect(await refundOtpSend(redis, phone, ip, pepper, first.token)).toBe(0);
  });

  it('R15-2: double refund, wrong IP, and expired window are no-ops', async () => {
    const phone = '+989121000009';
    const ip = '203.0.113.19';
    const first = await reserveOtpSend(redis, phone, ip, pepper, skip);
    expect(first.status).toBe('reserved');
    if (first.status !== 'reserved') return;
    expect(await refundOtpSend(redis, phone, '198.51.100.9', pepper, first.token)).toBe(0);
    expect(await refundOtpSend(redis, phone, ip, pepper, first.token)).toBe(1);
    expect(await refundOtpSend(redis, phone, ip, pepper, first.token)).toBe(0);

    const rolled = await reserveOtpSend(redis, phone, ip, pepper, skip);
    expect(rolled.status).toBe('reserved');
    if (rolled.status !== 'reserved') return;
    const keys = otpLimitKeys(phone, ip, pepper, rolled.token);
    await redis.del(keys.phoneHour, keys.phoneDay, keys.ipHour, keys.phone60);
    const next = await reserveOtpSend(redis, phone, ip, pepper, skip);
    expect(next.status).toBe('reserved');
    expect(await redis.get(keys.phoneHour)).toBe('1');
    expect(await refundOtpSend(redis, phone, ip, pepper, rolled.token)).toBe(1);
    expect(await redis.get(keys.phoneHour)).toBe('1');
  });

  it('R15-4: late delete does not remove a newer issuance', async () => {
    const phone = '+989121000006';
    const oldId = newOtpIssuanceId();
    const newId = newOtpIssuanceId();
    await putOtpChallenge(redis, {
      pepper,
      purpose: 'app',
      phone,
      code: '111111',
      issuanceId: oldId,
    });
    await putOtpChallenge(redis, {
      pepper,
      purpose: 'app',
      phone,
      code: '222222',
      issuanceId: newId,
    });
    expect(
      await deleteOtpChallengeIfIssuance(redis, {
        pepper,
        purpose: 'app',
        phone,
        issuanceId: oldId,
      }),
    ).toBe(false);
    expect(
      (await consumeOtpChallenge(redis, { pepper, purpose: 'app', phone, code: '222222' })).status,
    ).toBe('ok');
  });

  it('N19-1: budget-only refund leaves phone/IP counters', async () => {
    const phone = '+989121000011';
    const ip = '203.0.113.21';
    const budget = { hour: 100, day: 100 };
    const first = await reserveOtpSend(redis, phone, ip, pepper, budget);
    expect(first.status).toBe('reserved');
    if (first.status !== 'reserved') return;
    const keys = otpLimitKeys(phone, ip, pepper, first.token);
    expect(await redis.get(keys.budgetHour)).toBe('1');
    expect(await redis.get(keys.phoneHour)).toBe('1');
    expect(await redis.exists(keys.phone60)).toBe(1);
    expect(await refundOtpBudgetOnly(redis, phone, ip, pepper, first.token)).toBe(1);
    expect(await redis.get(keys.budgetHour)).toBeNull();
    expect(await redis.get(keys.phoneHour)).toBe('1');
    expect(await redis.exists(keys.phone60)).toBe(1);
    expect((await reserveOtpSend(redis, phone, ip, pepper, budget)).status).toBe('blocked');
  });

  it('N17-2: skipBudget is not blocked; luaSafeInt rejects undefined', async () => {
    const phone = '+989121000007';
    const ip = '203.0.113.17';
    expect((await reserveOtpSend(redis, phone, ip, pepper, skip)).status).toBe('reserved');
    expect(() => luaSafeInt(undefined, 'SMS_BUDGET_HOUR')).toThrow(/SMS_BUDGET_HOUR/);
    expect(() => luaSafeInt(Number.NaN, 'SMS_BUDGET_DAY')).toThrow(/SMS_BUDGET_DAY/);
  });

  it('R15-3: NaN/Infinity/undefined/0 budgets block and do not increment', async () => {
    const phone = '+989121000010';
    const ip = '203.0.113.20';
    const bad: OtpBudgetLimits[] = [
      { hour: Number.NaN, day: 10 },
      { hour: Number.POSITIVE_INFINITY, day: 10 },
      { hour: undefined as unknown as number, day: 10 },
      { hour: 0, day: 10 },
    ];
    for (const budget of bad) {
      const result = await reserveOtpSend(redis, phone, ip, pepper, budget);
      expect(result.status).toBe('blocked');
      if (result.status === 'blocked') expect(result.reason).toBe('budget');
    }
    expect(await redis.keys('otp:*')).toEqual([]);
  });

  it('N17-4: limiter keys use peppered otpPhoneHash', async () => {
    const phone = '+989121000008';
    const ip = '203.0.113.18';
    await reserveOtpSend(redis, phone, ip, pepper, skip);
    const hashed = otpPhoneHash(phone, pepper);
    expect(await redis.exists(`otp:lim:p60:${hashed}`)).toBe(1);
    const keys = await redis.keys('otp:lim:p60:*');
    expect(keys.some((key) => key.includes(phone))).toBe(false);
  });
});
