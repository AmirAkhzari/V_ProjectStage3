# S-12 / S11b-0 + S11b-1 P0 test matrix

Catalogue: **TEST_CATALOG v1.12** (v1.10 labels: `exec` / `exec-auth` / `deferred:P2|P3`; frozen OpenAPI v1.0.0 `ef2a2fff…175a`, v1.1.0 `a62e4465…d0b1`).  
S-14 gate = **17 exec** + **91 exec-auth**. S11b-0 covers the **17 exec** Foundation rows. S11b-1 adds identity/tenancy/customers tables + RLS harness (**TENANT-01-S11B**, **TEN-02-S11B**). S11b-2 adds argon2id, the offline breached-password list, jose EdDSA JWT + rotation, and the refresh-token store.

Status:

- **green** — coverage exists (file + `it(...)`, or the AUTH-XSS-02 SCA CI step).
- **partial** — a Foundation slice exists; the ID is not fully met. After this slice: **0** among the 17 exec rows.
- **pending** — later S-11b slice (`exec-auth`) or an epic (`deferred:P2|P3`).
- **missing** — Foundation-level gap. After this slice: **0**.

Totals (**17 exec**): **green 17 / partial 0 / missing 0**.  
**exec-auth** this slice: **green 15** (TENANT-01-S11B, TEN-02-S11B + S11b-2 13) / **pending 76**. Domain `deferred:P2|P3` rows are epic merge gates (DL-48 approved), not S-14.

## Exec mapping (17)

| ID            | P0                                              | Status | Owner    | Mapping                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TXN-OUT-01    | exec (harness; O10/D6 re-run at P2/P3)          | green  | platform | `tests/outbox/pg.harness.test.ts` — rollback of state/audit/outbox on fault; clean retry ⇒ one claimable row                                                                                                       |
| TENANT-01     | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TENANT-01: scopes rows to the tenant and hides the other tenant`; unset GUC ⇒ 0 rows; FORCE RLS cannot be disabled. Writes are TENANT-W-01                                          |
| AUTH-PW-05    | exec                                            | green  | identity | `src/platform/logger.test.ts` — `redacts nested password, kyc and card fields`                                                                                                                                     |
| AUTH-JW-04    | exec                                            | green  | identity | `tests/unit/guards.test.ts` — `AUTH-JW-04` rejects `shopkeeperId` / `driverId` / `distributorId` in body and query. Real-token re-run is AUTH-JW-04-RA (exec-auth)                                                 |
| AUTH-XSS-02   | exec                                            | green  | platform | SCA: CI `AUTH-XSS-02 production dependency audit` (`pnpm audit --prod --audit-level=high`) + `tests/unit/auth-xss-audit.test.ts`                                                                                   |
| AUTH-DM-01    | exec                                            | green  | platform | `tests/unit/auth-dm-01.test.ts` — A5/B5 404 `NOT_FOUND` in production, identical to unknown. Prod-mode re-run with flag is AUTH-DM-01-RA (exec-auth)                                                               |
| PAY-ENV-01    | exec (startup guard; mock-complete deferred:P2) | green  | platform | `src/platform/config.test.ts` — `DEMO_*` / `MOCK_*` / `*_PROVIDER=mock` rejected in production                                                                                                                     |
| TEN-01        | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TEN-01: grants vproject_app nothing on identity and leaves schemas owned by the migrator`; role flags / NOBYPASSRLS. Ownership is TEN-01-OWN                                        |
| TEN-02        | exec                                            | green  | platform | Same evidence as TEN-02-GATE (FORCE RLS registry). Outbox SELECT is N-2, not this ID                                                                                                                               |
| TEN-03        | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TEN-03: does not leak tenant GUCs after commit on a pooled connection`                                                                                                              |
| TEN-04        | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TEN-04: unset distributor GUC yields 0 rows, not an error, and cannot disable RLS`. Payment `distributor_id IS NULL` deferred:P2                                                    |
| TEN-05        | exec (role part only)                           | green  | platform | `tests/outbox/pg.harness.test.ts` — `worker role / outbox claim (infra): claims both tenants without an HTTP scope header`. `is_platform` = TEN-05-PLAT (exec-auth). Aggregate-derivation deferred:P2              |
| TENANT-W-01   | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TENANT-W-01: cross-tenant UPDATE and DELETE affect 0 rows`; `TENANT-W-01: INSERT for another tenant fails WITH CHECK`                                                               |
| TEN-02-GATE   | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TEN-02-GATE: tenant-schema tables have FORCE RLS, a policy, and are listed in the harness` (fail-closed)                                                                            |
| TEN-01-OWN    | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TEN-01-OWN: vproject_app and vproject_worker own no tables`                                                                                                                         |
| PUB-ROUTES-01 | exec                                            | green  | platform | `tests/contract/public-routes.test.ts` — `PUB-ROUTES-01: matches the contract public operations exactly` (frozen v1.1.0)                                                                                           |
| ROLE-GUARD-01 | exec                                            | green  | platform | `src/platform/db/runtimeRole.test.ts` — `ROLE-GUARD-01 inspectRuntimeDbRole`; `tests/rls/harness.test.ts` — `ROLE-GUARD-01: refuses to start as a superuser or the migrator` and identity pool `vproject_identity` |

## Foundation extras (not among the 17 exec IDs)

| ID / area           | Status | Mapping                                                                                     |
| ------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Health / ready      | green  | `tests/unit/health.test.ts`; `tests/integration/health.containers.test.ts`                  |
| Errors              | green  | `tests/unit/errors.test.ts`; `tests/contract/error-codes.test.ts`                           |
| Contract sha        | green  | `tests/contract/frozen-openapi.test.ts`                                                     |
| Idempotency / inbox | green  | `tests/outbox/pg.harness.test.ts`                                                           |
| N-2 outbox SELECT   | green  | `tests/outbox/pg.harness.test.ts` — `N-2: does not let vproject_app SELECT outbox payloads` |

## exec-auth (91) — owner and slice (R-5)

This slice: **green 15** / **pending 76**. No endpoints in S11b-2.

Carry to **S11b-6** (not this stack): J-1 — do not register A5/B5 in production; S3 `{provider}` vs Fastify `:provider` matcher + test.

| Slice     | Owner    | Status  | IDs (count)                                                                                                                                                         |
| --------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S11b-1    | platform | green   | TENANT-01-S11B, TEN-02-S11B (2) — harness per-table read/write + ENABLE+FORCE RLS                                                                                   |
| S11b-2    | identity | green   | AUTH-PW-01, AUTH-PW-02, AUTH-PW-03, AUTH-PW-04, AUTH-PW-02-OFF, AUTH-JW-01, AUTH-JW-02, AUTH-JW-03, AUTH-RT-01, AUTH-RT-02, AUTH-RT-03, AUTH-RT-04, AUTH-RT-05 (13) |
| S11b-3    | identity | pending | SESS-01..07, AUTH-AV-01..05, AUTH-RV-01, AUTH-DI-01, TEN-05-PLAT, SCOPE-SA-01, AUTH-JW-04-RA (17)                                                                   |
| S11b-4    | identity | pending | AUTH-LG-01..05, C11-01..05, B83-01..06, AUTH-C11-01..07, AUTH-B83-01..06, LIM-T-01..04, AUTH-LO-01, AUTH-PW-05-RA, AUTH-LG-02-PR (36)                               |
| S11b-5    | identity | pending | LIM-OTP-T-01, LIM-OTP-T-02, LIM-OTP-T-03, LIM-OTP-T-04, LIM-OTP-T-05, LIM-OTP-T-06, LIM-OTP-T-07, LIM-OTP-T-08 (8)                                                  |
| S11b-6    | platform | pending | TEN-404-01, AUTH-DM-01-RA (2)                                                                                                                                       |
| S11b-4..6 | identity | pending | V11-* §N of TEST_CATALOG v1.12 (13; need v1.1.0 freeze)                                                                                                             |

**91** = 2+13+17+36+8+2+13.

### S11b-2 exec-auth mapping (13)

| ID             | Status | Mapping                                                                                                                                                        |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-PW-01     | green  | `src/modules/identity/infra/crypto/argon2Hasher.test.ts` — argon2id m=19456,t=2,p=1; seed `PLACEHOLDER_PASSWORD_HASH` and non-`$argon2id$` hashes never verify |
| AUTH-PW-02     | green  | `src/modules/identity/domain/passwordPolicy.test.ts` — NFKC, length 8–128                                                                                      |
| AUTH-PW-02-OFF | green  | same file + `tests/integration/s11b-2-crypto.test.ts` — offline list + SHA-256 artifact; `PASSWORD_BREACHED`; fetch/HIBP never called; version logged at boot  |
| AUTH-PW-03     | green  | `passwordPolicy.test.ts` — CSPRNG ≥12 chars, 72h, `must_change_password`                                                                                       |
| AUTH-PW-04     | green  | `passwordPolicy.test.ts` — only C11 `/v1/driver/auth/password` while `must_change_password`                                                                    |
| AUTH-JW-01     | green  | `src/platform/auth/eddsa.test.ts` — EdDSA, `kid` required, 15 min `exp`                                                                                        |
| AUTH-JW-02     | green  | same — alg allowlist (reject HS256 / missing kid), aud/typ/exp                                                                                                 |
| AUTH-JW-03     | green  | same — rotate signing `kid`; previous kid verifies until retired; JWKS from keyset                                                                             |
| AUTH-RT-01     | green  | `src/modules/identity/infra/crypto/memoryRefreshStore.test.ts` — opaque ≥256-bit CSPRNG, single-use rotate                                                     |
| AUTH-RT-02     | green  | same — 20 s grace returns a fresh rotation; reuse after grace revokes the family (UPDATE, no DELETE)                                                           |
| AUTH-RT-03     | green  | same — shopkeeper 30d/90d, staff 7d+12h idle, driver 10h absolute                                                                                              |
| AUTH-RT-04     | green  | same — RT bound to route-group `typ`                                                                                                                           |
| AUTH-RT-05     | green  | same + `tests/integration/s11b-2-crypto.test.ts` — store hashes only; `successor` is a hash; PG persist                                                        |

## deferred:P2\|P3 (DL-48 approved) — not this slice

ORD-SM-01/02, PAY-ORD-01/02, ADM-ORD-01, PAY-VER/REF/NC/CB, PAY-NTF-01, DEL-MAN-01..05, DEL-SEC-01/02/04, DEL-SEC-05 (P2 SMS + P3 counters), LIM-T-05..07, ORD-CAN-IDEM-01.

## AppSec C-1 (Foundation slice)

| ID                      | Status   | Reason                                                |
| ----------------------- | -------- | ----------------------------------------------------- |
| TENANT-01 + TENANT-W-01 | green    | DB read + write on `rls_probe`                        |
| TEN-01 + TEN-01-OWN     | green    | identity grants; app/worker own no tables             |
| TEN-02 + TEN-02-GATE    | green    | FORCE RLS registry                                    |
| TEN-03                  | green    | no GUC leak                                           |
| TEN-04                  | green    | unset ⇒ 0 rows                                        |
| TEN-05                  | green    | worker role part; is_platform = TEN-05-PLAT exec-auth |
| AUTH-LG/RV/AV, C11/B83  | pending  | exec-auth; owner identity; slices S11b-3..4           |
| PAY-SEC-* / DEL-SEC-*   | deferred | P2/P3                                                 |

**C-1 overall: pending** until exec-auth is green. Gate stays closed. S11b-0 finishes the Foundation exec set.
