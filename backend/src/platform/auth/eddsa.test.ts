import { SignJWT, decodeJwt, importJWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_TTL_SECONDS, JWT_AUDIENCE, TokenVerificationError } from './jwt.js';
import {
  EddsaAccessTokenService,
  exportPrivateJwk,
  exportPublicJwk,
  generateEd25519Key,
  importKeysetFromJwks,
} from './eddsa.js';

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
      sv: 0,
    });
    const claims = await jwt.verify(token, 'shopkeeper');
    expect(claims).toEqual({ sub: 'acc-1', typ: 'shopkeeper', sid: 'sid-1', sv: 0 });
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
    await expect(jwt.verify(noKid, 'staff')).rejects.toBeInstanceOf(TokenVerificationError);

    const hsSecret = new TextEncoder().encode('0'.repeat(32));
    const hs = await new SignJWT({ typ: 'staff', sid: 's' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
      .sign(hsSecret);
    await expect(jwt.verify(hs, 'staff')).rejects.toMatchObject({ message: 'alg not allowed' });

    const driver = await jwt.sign({
      sub: 'drv',
      typ: 'driver',
      sid: 'sid-d',
      sv: 0,
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
      expiredJwt.verify(await jwt.sign({ sub: 'a', typ: 'staff', sid: 's', sv: 0 }), 'staff'),
    ).rejects.toBeInstanceOf(TokenVerificationError);

    const issuedAt = Math.floor(now.getTime() / 1000);
    const noIat = await new SignJWT({ typ: 'staff', sid: 's', sv: 0 })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(key.privateKey);
    await expect(jwt.verify(noIat, 'staff')).rejects.toMatchObject({ message: 'iat required' });

    const longLived = await new SignJWT({ typ: 'staff', sid: 's', sv: 0 })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setIssuedAt(issuedAt - 3600)
      .setNotBefore(issuedAt - 3600)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(key.privateKey);
    await expect(jwt.verify(longLived, 'staff')).rejects.toMatchObject({
      message: 'lifetime exceeded',
    });
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
    const oldToken = await before.sign({ sub: 'a', typ: 'staff', sid: 's1', sv: 0 });

    const after = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k2',
      keys: [k1, k2],
      now: () => now,
    });
    const newToken = await after.sign({ sub: 'a', typ: 'staff', sid: 's1', sv: 0 });
    expect(JSON.parse(Buffer.from(newToken.split('.')[0] ?? '', 'base64url').toString()).kid).toBe(
      'k2',
    );
    await expect(after.verify(oldToken, 'staff')).resolves.toMatchObject({ sid: 's1' });
    await expect(after.verify(newToken, 'staff')).resolves.toMatchObject({ sid: 's1' });

    const retired = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k2',
      keys: [k2],
      now: () => now,
    });
    await expect(retired.verify(oldToken, 'staff')).rejects.toMatchObject({
      message: 'unknown kid',
    });

    const jwk = await exportPrivateJwk(k2);
    expect(jwk['kid']).toBe('k2');
    expect(jwk['alg']).toBe('EdDSA');
    await importJWK(jwk, 'EdDSA');
  });

  it('AUTH-JW-03: JWKS import separates the private sign key from public verify keys', async () => {
    const k1 = await generateEd25519Key('k1');
    const k2 = await generateEd25519Key('k2');
    const now = new Date('2026-10-15T12:00:00.000Z');
    const privateJwks = JSON.stringify({
      keys: [await exportPrivateJwk(k1), await exportPrivateJwk(k2)],
    });
    const imported = await importKeysetFromJwks(privateJwks);
    expect(imported).toHaveLength(2);
    for (const key of imported) {
      expect(key.privateKey).toBeInstanceOf(CryptoKey);
      expect(key.publicKey).toBeInstanceOf(CryptoKey);
      expect(key.privateKey).not.toBe(key.publicKey);
    }

    const publicJwksKeys = await Promise.all(imported.map(exportPublicJwk));
    for (const pub of publicJwksKeys) {
      expect(pub['d']).toBeUndefined();
      expect(pub['kid']).toMatch(/^k[12]$/);
    }
    const verifyOnly = await importKeysetFromJwks(JSON.stringify({ keys: publicJwksKeys }));
    expect(verifyOnly.every((key) => key.privateKey === undefined)).toBe(true);

    const signer = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k2',
      keys: imported,
      now: () => now,
    });
    const token = await signer.sign({ sub: 'a', typ: 'staff', sid: 's1', sv: 0 });
    const verifier = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k2',
      keys: verifyOnly,
      now: () => now,
    });
    await expect(verifier.verify(token, 'staff')).resolves.toMatchObject({ sid: 's1' });
    await expect(verifier.sign({ sub: 'a', typ: 'staff', sid: 's1', sv: 0 })).rejects.toMatchObject(
      {
        message: 'active signing key missing',
      },
    );
  });

  it('AUTH-JW-02 / 9-8: binds aud to the route group, checks header typ, rejects future iat', async () => {
    const key = await generateEd25519Key('k1');
    const now = new Date('2026-10-15T12:00:00.000Z');
    const jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [key],
      now: () => now,
    });
    const driver = await jwt.sign({
      sub: 'drv',
      typ: 'driver',
      sid: 'sid-d',
      sv: 0,
      did: 'dist-1',
    });
    await expect(jwt.verify(driver, 'staff')).rejects.toMatchObject({
      message: 'token verification failed',
    });
    await expect(jwt.verify(driver, 'driver')).resolves.toMatchObject({ typ: 'driver' });

    const issuedAt = Math.floor(now.getTime() / 1000);
    const noTyp = await new SignJWT({ typ: 'staff', sid: 's', sv: 0 })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(key.privateKey);
    await expect(jwt.verify(noTyp, 'staff')).rejects.toMatchObject({
      message: 'typ header required',
    });

    const future = await new SignJWT({ typ: 'staff', sid: 's', sv: 0 })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' })
      .setSubject('acc')
      .setIssuer('vproject')
      .setAudience(JWT_AUDIENCE.staff)
      .setIssuedAt(issuedAt + 120)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(key.privateKey);
    await expect(jwt.verify(future, 'staff')).rejects.toMatchObject({
      message: 'iat in the future',
    });
  });

  it('AUTH-JW-03: boot wiring fails when the active key has no private part', async () => {
    const key = await generateEd25519Key('k1');
    const pub = await exportPublicJwk(key);
    await expect(
      importKeysetFromJwks(JSON.stringify({ keys: [{ ...pub, kty: 'EC' }] })),
    ).rejects.toMatchObject({ message: /kty=OKP/ });

    const { createJwtFromEnv } = await import('./eddsa.js');
    await expect(
      createJwtFromEnv({
        JWT_ISS: 'vproject',
        JWT_EDDSA_ACTIVE_KID: 'k1',
        JWT_EDDSA_JWKS: JSON.stringify({ keys: [pub] }),
      }),
    ).rejects.toMatchObject({ message: /no private part/ });

    const service = await createJwtFromEnv({
      JWT_ISS: 'vproject',
      JWT_EDDSA_ACTIVE_KID: 'k1',
      JWT_EDDSA_JWKS: JSON.stringify({ keys: [await exportPrivateJwk(key)] }),
    });
    const token = await service.sign({ sub: 'a', typ: 'staff', sid: 's1', sv: 1 });
    await expect(service.verify(token, 'staff')).resolves.toMatchObject({ sv: 1 });
  });
});
