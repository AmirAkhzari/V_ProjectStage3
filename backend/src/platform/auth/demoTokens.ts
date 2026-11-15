import { decodeProtectedHeader } from 'jose';
import { TokenVerificationError, type AccessClaims, type SubjectType } from './jwt.js';
import {
  createJwtFromEnv,
  EddsaAccessTokenService,
  exportPublicJwk,
  importKeysetFromJwks,
  readJwtEnv,
  type AccessTokenSigner,
} from './eddsa.js';
import { DEMO_AUD, DEMO_ISS, demoLoginEnabled } from './demoLogin.js';
import type { Clock } from '../lib/clock.js';

/**
 * Prod verifier never holds the demo key. Demo verification runs only when the
 * demo kid, issuer, and audience all match, and only while demo login is enabled.
 */
export class DemoAwareTokens implements AccessTokenSigner {
  constructor(
    private readonly prod: EddsaAccessTokenService,
    private readonly demo: EddsaAccessTokenService | null,
    private readonly demoKid: string | null,
  ) {}

  async sign(subject: AccessClaims): Promise<string> {
    if (subject.demo === true) {
      if (!this.demo) throw new TokenVerificationError('demo signing unavailable');
      return this.demo.sign(subject);
    }
    return this.prod.sign(subject);
  }

  async verify(token: string, expectedGroup: SubjectType): Promise<AccessClaims> {
    const kid = peekKid(token);
    if (this.demo && this.demoKid && kid === this.demoKid) {
      return this.demo.verify(token, expectedGroup);
    }
    return this.prod.verify(token, expectedGroup);
  }
}

export async function createAccessTokensFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  now?: Clock,
): Promise<DemoAwareTokens> {
  const prod = await createJwtFromEnv(env, now);
  if (!demoLoginEnabled(env['NODE_ENV'] ?? '', env['DEMO_LOGIN_ENABLED'])) {
    return new DemoAwareTokens(prod, null, null);
  }
  const kid = env['DEMO_JWT_EDDSA_KID'];
  const jwks = env['DEMO_JWT_EDDSA_JWKS'];
  if (!kid || !jwks) throw new TokenVerificationError('demo signing key is not configured');
  let demoKeys;
  try {
    demoKeys = await importKeysetFromJwks(jwks);
  } catch {
    throw new TokenVerificationError('demo signing key is invalid');
  }
  const active = demoKeys.find((key) => key.kid === kid);
  if (!active?.privateKey) throw new TokenVerificationError('demo signing key has no private part');
  const { jwks: prodJwks } = readJwtEnv(env);
  const prodKeys = await importKeysetFromJwks(prodJwks);
  if (prodKeys.some((key) => key.kid === kid)) {
    throw new TokenVerificationError('demo signing kid collides with the production keyset');
  }
  const prodX = new Set(
    (await Promise.all(prodKeys.map((key) => exportPublicJwk(key)))).map((jwk) => jwk['x']),
  );
  const demoX = (await exportPublicJwk(active))['x'];
  if (prodX.has(demoX)) {
    throw new TokenVerificationError('demo signing key must not be a production key');
  }
  const demo = new EddsaAccessTokenService({
    iss: DEMO_ISS,
    activeKid: kid,
    keys: demoKeys,
    audience: DEMO_AUD,
    ...(now ? { now } : {}),
  });
  return new DemoAwareTokens(prod, demo, kid);
}

function peekKid(token: string): string | undefined {
  try {
    const kid = decodeProtectedHeader(token).kid;
    return typeof kid === 'string' ? kid : undefined;
  } catch {
    return undefined;
  }
}
