# S-12 / S11b-0 + S11b-1 P0 test matrix

Catalogue: **TEST_CATALOG v1.11** (v1.10 labels: `exec` / `exec-auth` / `deferred:P2|P3`; frozen OpenAPI `ef2a2fff…175a`).  
S-14 gate = **17 exec** + **91 exec-auth**. S11b-0 covers the **17 exec** Foundation rows. S11b-1 adds identity/tenancy/customers tables + RLS harness (**TENANT-01-S11B**, **TEN-02-S11B**).

Status:

- **green** — coverage exists (file + `it(...)`, or the AUTH-XSS-02 SCA CI step).
- **partial** — a Foundation slice exists; the ID is not fully met. After this slice: **0** among the 17 exec rows.
- **pending** — later S-11b slice (`exec-auth`) or an epic (`deferred:P2|P3`).
- **missing** — Foundation-level gap. After this slice: **0**.

Totals (**17 exec**): **green 17 / partial 0 / missing 0**.  
**exec-auth** this slice: **green 2** (TENANT-01-S11B, TEN-02-S11B) / **pending 89**. Domain `deferred:P2|P3` rows are epic merge gates (DL-48 approved), not S-14.

## Exec mapping (17)

| ID            | P0                                              | Status | Owner    | Mapping                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TXN-OUT-01    | exec (harness; O10/D6 re-run at P2/P3)          | green  | platform | `tests/outbox/pg.harness.test.ts` — rollback of state/audit/outbox on fault; clean retry ⇒ one claimable row                                                                                                       |
| TENANT-01     | exec                                            | green  | platform | `tests/rls/harness.test.ts` — `TENANT-01: scopes rows to the tenant and hides the other tenant`; unset GUC ⇒ 0 rows; FORCE RLS cannot be disabled. Writes are TENANT-W-01                                          |
| AUTH-PW-05    | exec                                            | green  | identity | `src/platform/logger.test.ts` — `redacts nested password, kyc and card fields`                                                                                                                                     |
| AUTH-JW-04    | exec                                            | green  | identity | `tests/unit/guards.test.ts` — `AUTH-JW-04: rejects client-supplied identity fields`. Real-token re-run is AUTH-JW-04-RA (exec-auth)                                                                                |
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
| PUB-ROUTES-01 | exec                                            | green  | platform | `tests/contract/public-routes.test.ts` — `PUB-ROUTES-01: matches the contract public operations exactly`                                                                                                           |
| ROLE-GUARD-01 | exec                                            | green  | platform | `src/platform/db/runtimeRole.test.ts` — `ROLE-GUARD-01 inspectRuntimeDbRole`; `tests/rls/harness.test.ts` — `ROLE-GUARD-01: refuses to start as a superuser or the migrator` and identity pool `vproject_identity` |

## Foundation extras (not among the 17 exec IDs)

| ID / area           | Status | Mapping                                                                                     |
| ------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Health / ready      | green  | `tests/unit/health.test.ts`; `tests/integration/health.containers.test.ts`                  |
| Errors              | green  | `tests/unit/errors.test.ts`; `tests/contract/error-codes.test.ts`                           |
| Contract sha        | green  | `tests/contract/frozen-openapi.test.ts`                                                     |
| Idempotency / inbox | green  | `tests/outbox/pg.harness.test.ts`                                                           |
| N-2 outbox SELECT   | green  | `tests/outbox/pg.harness.test.ts` — `N-2: does not let vproject_app SELECT outbox payloads` |

## exec-auth this slice (2 green / 89 pending)

| ID             | Status | Mapping                                                                                                                |
| -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| TENANT-01-S11B | green  | `tests/rls/harness.test.ts` — per-table read/write on distributors, shopkeepers, driver_credentials, staff_memberships |
| TEN-02-S11B    | green  | `tests/rls/harness.test.ts` — `TEN-02-S11B: S-11b tables have ENABLE+FORCE RLS and a policy`                           |

Still pending (later slices; **no endpoints / no v1.1.0** in S11b-1): AUTH-PW-01..04, AUTH-PW-02-OFF, AUTH-LG-01..05, AUTH-RT-01..05, AUTH-RV-01, AUTH-LO-01, AUTH-JW-01..03, C11-01..05, B83-01..06, AUTH-C11-01..07, AUTH-B83-01..06, LIM-T-01..04, SESS-01..07, AUTH-AV-01..05, AUTH-DI-01, TEN-404-01, TEN-05-PLAT, SCOPE-SA-01, AUTH-DM-01-RA, AUTH-PW-05-RA, AUTH-JW-04-RA, AUTH-LG-02-PR, LIM-OTP-T-01..08, plus §N V11-* (need v1.1.0 freeze; S11b-4..6 forbidden until then).

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
| AUTH-LG/RV/AV, C11/B83  | pending  | exec-auth, S11b-3..4                                  |
| PAY-SEC-* / DEL-SEC-*   | deferred | P2/P3                                                 |

**C-1 overall: pending** until exec-auth is green. Gate stays closed. S11b-0 finishes the Foundation exec set.
