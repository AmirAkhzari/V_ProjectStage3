import { SignJWT, decodeJwt, importJWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_TTL_SECONDS, JWT_AUDIENCE, TokenVerificationError } from './jwt.js';
import { EddsaAccessTokenService, exportPrivateJwk, generateEd25519Key } from './eddsa.js';

describe('EddsaAccessTokenService', () => {
  it('AUTH-JW-01: signs EdDSA with kid and a 15 minute exp', async () => {
    const key = await generateEd25519Key('k-current');
    const now = new Date('2026-10-15T12:00:00.000Z');
    const jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k-current',
      keys: [key],
      now: () => now,
    });
    const token = await jwt.sign({
      sub: 'acc-1',
      typ: 'shopkeeper',
      sid: 'sid-1',
    });
    const claims = await jwt.verify(token);
    expect(claims).toEqual({ sub: 'acc-1', typ: 'shopkeeper', sid: 'sid-1' });
    const payload = decodeJwt(token);
    expect(payload.exp! - payload.iat!).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(payload.aud).toBe(JWT_AUDIENCE.shopkeeper);
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64 ?? '', 'base64url').toString()) as {
      alg: string;
      kid: string;
    };
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe('k-current');
  });

  it('AUTH-JW-02: rejects missing kid, non-EdDSA alg, wrong aud, and expired tokens', async () => {
    const key = await generateEd25519Key('k1');
    const now = new Date('2026-10-15T12:00:00.000Z');
    const jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [key],
      now: () => now,
    });

    const noKid = await new SignJWT({ typ: 'staff', sid: 's' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
      .sign(key.privateKey);
    await expect(jwt.verify(noKid)).rejects.toBeInstanceOf(TokenVerificationError);

    const hsSecret = new TextEncoder().encode('0'.repeat(32));
    const hs = await new SignJWT({ typ: 'staff', sid: 's' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
      .sign(hsSecret);
    await expect(jwt.verify(hs)).rejects.toMatchObject({ message: 'alg not allowed' });

    const driver = await jwt.sign({
      sub: 'drv',
      typ: 'driver',
      sid: 'sid-d',
      did: 'dist-1',
    });
    const driverPayload = decodeJwt(driver);
    expect(driverPayload.aud).toBe(JWT_AUDIENCE.driver);
    expect(driverPayload['did']).toBe('dist-1');

    const expiredAt = new Date(now.getTime() + 20 * 60 * 1000);
    const expiredJwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [key],
      now: () => expiredAt,
    });
    await expect(
      expiredJwt.verify(await jwt.sign({ sub: 'a', typ: 'staff', sid: 's' })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('AUTH-JW-03: rotates the signing kid; previous kid still verifies until retired', async () => {
    const k1 = await generateEd25519Key('k1');
    const k2 = await generateEd25519Key('k2');
    const now = new Date('2026-10-15T12:00:00.000Z');
    const before = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [k1, k2],
      now: () => now,
    });
    const oldToken = await before.sign({ sub: 'a', typ: 'staff', sid: 's1' });

    const after = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k2',
      keys: [k1, k2],
      now: () => now,
    });
    const newToken = await after.sign({ sub: 'a', typ: 'staff', sid: 's1' });
    expect(JSON.parse(Buffer.from(newToken.split('.')[0] ?? '', 'base64url').toString()).kid).toBe(
      'k2',
    );
    await expect(after.verify(oldToken)).resolves.toMatchObject({ sid: 's1' });
    await expect(after.verify(newToken)).resolves.toMatchObject({ sid: 's1' });

    const retired = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k2',
      keys: [k2],
      now: () => now,
    });
    await expect(retired.verify(oldToken)).rejects.toMatchObject({ message: 'unknown kid' });

    const jwk = await exportPrivateJwk(k2);
    expect(jwk['kid']).toBe('k2');
    expect(jwk['alg']).toBe('EdDSA');
    await importJWK(jwk, 'EdDSA');
  });
});
