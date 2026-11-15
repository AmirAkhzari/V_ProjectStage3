import {
  SignJWT,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type CryptoKey,
  type JWTPayload,
} from 'jose';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ALG,
  JWT_AUDIENCE,
  JWT_CLOCK_SKEW_SECONDS,
  JWT_TYP,
  TokenVerificationError,
  type AccessClaims,
  type AccessTokenVerifier,
  type SubjectType,
} from './jwt.js';

export interface Ed25519KeyPair {
  kid: string;
  publicKey: CryptoKey;
  /** Present only on signing keys. Public JWKS imports omit this. */
  privateKey?: CryptoKey;
}

export interface Ed25519SigningKey extends Ed25519KeyPair {
  privateKey: CryptoKey;
}

export interface EddsaJwtOptions {
  iss: string;
  activeKid: string;
  keys: readonly Ed25519KeyPair[];
  now?: Clock;
  /** When set, every token uses this aud. typ/group check still applies. */
  audience?: string;
}

export interface AccessTokenSigner {
  sign(subject: AccessClaims): Promise<string>;
}

const SUBJECT_TYPES = new Set<SubjectType>(['shopkeeper', 'staff', 'driver']);

function asCryptoKey(value: unknown, message: string): CryptoKey {
  if (typeof globalThis.CryptoKey === 'function' && value instanceof globalThis.CryptoKey) {
    return value;
  }
  throw new TokenVerificationError(message);
}

export async function generateEd25519Key(kid: string): Promise<Ed25519SigningKey> {
  const pair = await generateKeyPair(JWT_ALG, { extractable: true });
  return { kid, publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function exportPrivateJwk(key: Ed25519KeyPair): Promise<Record<string, unknown>> {
  if (!key.privateKey) throw new TokenVerificationError('cannot export a public-only key');
  const jwk = await exportJWK(key.privateKey);
  return { ...jwk, kid: key.kid, alg: JWT_ALG, crv: 'Ed25519', use: 'sig' };
}

export async function exportPublicJwk(key: Ed25519KeyPair): Promise<Record<string, unknown>> {
  const jwk = await exportJWK(key.publicKey);
  const { d: _private, ...pub } = jwk as Record<string, unknown>;
  return { ...pub, kid: key.kid, alg: JWT_ALG, crv: 'Ed25519', use: 'sig' };
}

export async function importKeysetFromJwks(jwksJson: string): Promise<Ed25519KeyPair[]> {
  const parsed = JSON.parse(jwksJson) as { keys?: unknown };
  if (!Array.isArray(parsed.keys)) {
    throw new TokenVerificationError('JWT_EDDSA_JWKS must be a JWKS object');
  }
  const keys: Ed25519KeyPair[] = [];
  for (const entry of parsed.keys) {
    if (typeof entry !== 'object' || entry === null || !('kid' in entry)) {
      throw new TokenVerificationError('JWKS key missing kid');
    }
    const raw = entry as Record<string, unknown>;
    const kid = raw['kid'];
    if (typeof kid !== 'string' || kid.length === 0) {
      throw new TokenVerificationError('JWKS kid must be a non-empty string');
    }
    if (raw['kty'] !== 'OKP' || raw['crv'] !== 'Ed25519' || raw['use'] !== 'sig') {
      throw new TokenVerificationError('JWKS key must have kty=OKP crv=Ed25519 use=sig');
    }
    const { d, ...publicFields } = raw;
    const publicKey = asCryptoKey(
      await importJWK(publicFields as never, JWT_ALG),
      'JWKS public key import failed',
    );
    if (typeof d === 'string' && d.length > 0) {
      keys.push({
        kid,
        publicKey,
        privateKey: asCryptoKey(
          await importJWK(raw as never, JWT_ALG),
          'JWKS private key import failed',
        ),
      });
    } else {
      keys.push({ kid, publicKey });
    }
  }
  return keys;
}

/** Keys come from the secret manager / env only (AUTH-JW-03). */
export function readJwtEnv(env: NodeJS.ProcessEnv = process.env): {
  iss: string;
  activeKid: string;
  jwks: string;
} {
  const iss = env['JWT_ISS'];
  const activeKid = env['JWT_EDDSA_ACTIVE_KID'];
  const jwks = env['JWT_EDDSA_JWKS'];
  if (!iss || !activeKid || !jwks) {
    throw new TokenVerificationError(
      'JWT_ISS, JWT_EDDSA_ACTIVE_KID and JWT_EDDSA_JWKS are required',
    );
  }
  return { iss, activeKid, jwks };
}

/** Fail-at-boot when the active kid has no private part. */
export async function createJwtFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  now?: Clock,
): Promise<EddsaAccessTokenService> {
  const { iss, activeKid, jwks } = readJwtEnv(env);
  const keys = await importKeysetFromJwks(jwks);
  const active = keys.find((key) => key.kid === activeKid);
  if (!active?.privateKey) {
    throw new TokenVerificationError(`active kid ${activeKid} has no private part`);
  }
  return new EddsaAccessTokenService({
    iss,
    activeKid,
    keys,
    ...(now ? { now } : {}),
  });
}

export class EddsaAccessTokenService implements AccessTokenVerifier, AccessTokenSigner {
  private readonly keys: Map<string, Ed25519KeyPair>;
  private readonly now: Clock;

  constructor(private readonly options: EddsaJwtOptions) {
    this.keys = new Map(options.keys.map((key) => [key.kid, key]));
    this.now = options.now ?? systemClock;
    if (!this.keys.has(options.activeKid)) {
      throw new TokenVerificationError(`active kid ${options.activeKid} is not in the keyset`);
    }
  }

  async sign(subject: AccessClaims): Promise<string> {
    const key = this.keys.get(this.options.activeKid);
    if (!key?.privateKey) throw new TokenVerificationError('active signing key missing');
    if (subject.typ === 'driver' && (subject.did === undefined || subject.did.length === 0)) {
      throw new TokenVerificationError('driver tokens require did');
    }
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const payload: Record<string, string | number> = {
      typ: subject.typ,
      sid: subject.sid,
      sv: subject.sv,
    };
    if (subject.did !== undefined) payload['did'] = subject.did;
    return new SignJWT(payload)
      .setProtectedHeader({ alg: JWT_ALG, kid: key.kid, typ: JWT_TYP })
      .setSubject(subject.sub)
      .setIssuer(this.options.iss)
      .setAudience(this.options.audience ?? JWT_AUDIENCE[subject.typ])
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(key.privateKey);
  }

  async verify(token: string, expectedGroup: SubjectType): Promise<AccessClaims> {
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new TokenVerificationError('malformed token');
    }
    if (header.alg !== JWT_ALG) {
      throw new TokenVerificationError('alg not allowed');
    }
    if (header.typ !== JWT_TYP) {
      throw new TokenVerificationError('typ header required');
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) {
      throw new TokenVerificationError('kid required');
    }
    const key = this.keys.get(header.kid);
    if (!key) throw new TokenVerificationError('unknown kid');

    const expectedAud = this.options.audience ?? JWT_AUDIENCE[expectedGroup];
    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, key.publicKey, {
        algorithms: [JWT_ALG],
        issuer: this.options.iss,
        audience: expectedAud,
        clockTolerance: JWT_CLOCK_SKEW_SECONDS,
        currentDate: this.now(),
      });
      payload = verified.payload;
    } catch {
      throw new TokenVerificationError('token verification failed');
    }

    const typ = payload['typ'];
    const sid = payload['sid'];
    const sub = payload.sub;
    if (typeof typ !== 'string' || !SUBJECT_TYPES.has(typ as SubjectType)) {
      throw new TokenVerificationError('typ invalid');
    }
    const subjectTyp = typ as SubjectType;
    if (subjectTyp !== expectedGroup) {
      throw new TokenVerificationError('typ/group mismatch');
    }
    if (payload.aud !== expectedAud) {
      throw new TokenVerificationError('aud mismatch');
    }
    if (typeof payload.iat !== 'number') {
      throw new TokenVerificationError('iat required');
    }
    const nowSec = Math.floor(this.now().getTime() / 1000);
    if (payload.iat > nowSec + JWT_CLOCK_SKEW_SECONDS) {
      throw new TokenVerificationError('iat in the future');
    }
    if (
      typeof sid !== 'string' ||
      sid.length === 0 ||
      typeof sub !== 'string' ||
      sub.length === 0
    ) {
      throw new TokenVerificationError('sub/sid required');
    }
    if (payload.exp === undefined || payload.nbf === undefined) {
      throw new TokenVerificationError('exp/nbf required');
    }
    if (payload.exp - payload.iat > ACCESS_TOKEN_TTL_SECONDS) {
      throw new TokenVerificationError('lifetime exceeded');
    }
    const sv = payload['sv'];
    if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 0) {
      throw new TokenVerificationError('sv required');
    }

    const did = payload['did'];
    if (subjectTyp === 'driver') {
      if (typeof did !== 'string' || did.length === 0) {
        throw new TokenVerificationError('driver did required');
      }
      return { sub, typ: subjectTyp, sid, sv, did };
    }
    if (typeof did === 'string' && did.length > 0) {
      return { sub, typ: subjectTyp, sid, sv, did };
    }
    return { sub, typ: subjectTyp, sid, sv };
  }
}
