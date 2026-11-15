import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { DemoAwareTokens, createAccessTokensFromEnv } from '../../src/platform/auth/demoTokens.js';
import {
  EddsaAccessTokenService,
  exportPrivateJwk,
  generateEd25519Key,
  type Ed25519SigningKey,
} from '../../src/platform/auth/eddsa.js';
import { DEMO_AUD, DEMO_ISS } from '../../src/platform/auth/demoLogin.js';
import { JWT_ALG, JWT_TYP, TokenVerificationError } from '../../src/platform/auth/jwt.js';

describe('demo access tokens', () => {
  it('accepts only the demo kid, issuer, and audience together', async () => {
    const prodKey = await generateEd25519Key('k-prod');
    const demoKey = await generateEd25519Key('k-demo');
    const prod = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k-prod',
      keys: [prodKey],
    });
    const demo = new EddsaAccessTokenService({
      iss: DEMO_ISS,
      activeKid: 'k-demo',
      keys: [demoKey],
      audience: DEMO_AUD,
    });
    const tokens = new DemoAwareTokens(prod, demo, 'k-demo');
    const demoToken = await tokens.sign({
      sub: '00000000-0000-4000-8000-000000000001',
      typ: 'shopkeeper',
      sid: '00000000-0000-4000-8000-000000000002',
      sv: 0,
      demo: true,
    });
    await expect(tokens.verify(demoToken, 'shopkeeper')).resolves.toMatchObject({
      typ: 'shopkeeper',
    });
    await expect(tokens.verify(demoToken, 'staff')).rejects.toBeInstanceOf(TokenVerificationError);
    const off = new DemoAwareTokens(prod, null, null);
    await expect(off.verify(demoToken, 'shopkeeper')).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
    const pairs = [
      { key: demoKey, kid: 'k-demo', iss: 'vproject', aud: DEMO_AUD },
      { key: demoKey, kid: 'k-demo', iss: DEMO_ISS, aud: 'app' },
      { key: prodKey, kid: 'k-prod', iss: DEMO_ISS, aud: 'app' },
      { key: prodKey, kid: 'k-prod', iss: 'vproject', aud: DEMO_AUD },
    ];
    for (const pair of pairs) {
      const token = await signRaw(pair.key.privateKey, pair);
      await expect(tokens.verify(token, 'shopkeeper')).rejects.toBeInstanceOf(
        TokenVerificationError,
      );
    }
  });

  it('fails boot on a colliding kid or a copied production key', async () => {
    const prodKey = await generateEd25519Key('k-prod');
    const prodJwks = JSON.stringify({ keys: [await exportPrivateJwk(prodKey)] });
    const env = {
      NODE_ENV: 'test',
      DEMO_LOGIN_ENABLED: 'true',
      JWT_ISS: 'vproject',
      JWT_EDDSA_ACTIVE_KID: 'k-prod',
      JWT_EDDSA_JWKS: prodJwks,
    };
    await expect(
      createAccessTokensFromEnv({
        ...env,
        DEMO_JWT_EDDSA_KID: 'k-prod',
        DEMO_JWT_EDDSA_JWKS: prodJwks,
      }),
    ).rejects.toThrow(/collides/);
    const copied = { ...(await exportPrivateJwk(prodKey)), kid: 'k-demo' };
    await expect(
      createAccessTokensFromEnv({
        ...env,
        DEMO_JWT_EDDSA_KID: 'k-demo',
        DEMO_JWT_EDDSA_JWKS: JSON.stringify({ keys: [copied] }),
      }),
    ).rejects.toThrow(/must not be a production key/);
    await expect(createAccessTokensFromEnv(env)).rejects.toThrow(/not configured/);
    const off = await createAccessTokensFromEnv({ ...env, DEMO_LOGIN_ENABLED: 'TRUE' });
    await expect(
      off.sign({
        sub: '00000000-0000-4000-8000-000000000001',
        typ: 'shopkeeper',
        sid: '00000000-0000-4000-8000-000000000002',
        sv: 0,
      }),
    ).resolves.toEqual(expect.any(String));
  });
});

function signRaw(
  key: Ed25519SigningKey['privateKey'],
  input: { kid: string; iss: string; aud: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: 'shopkeeper', sid: '00000000-0000-4000-8000-000000000002', sv: 0 })
    .setProtectedHeader({ alg: JWT_ALG, kid: input.kid, typ: JWT_TYP })
    .setSubject('00000000-0000-4000-8000-000000000001')
    .setIssuer(input.iss)
    .setAudience(input.aud)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 900)
    .sign(key);
}
