# S-12 P0 test matrix

Catalogue: TEST_CATALOG v1.7 (frozen OpenAPI `ef2a2fff…175a`).  
P0 column `exec` (including `exec (domain)` / `exec (contract)` / `exec (domain/contract)`): **52** rows.

Status:

- **green** — Foundation-level coverage exists in `backend/` (file + `it(...)` name).
- **pending** — needs a domain module or real auth (DL-46); listed, not built in this PR.
- **missing** — Foundation-level gap. After this PR: **0**.

Totals: **green 15 / missing 0 / pending 37**.

## Exec mapping (52)

| ID              | P0                     | Status  | Mapping                                                                                                                                                                                                                                                     |
| --------------- | ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORD-SM-01       | exec                   | pending | ordering state machine; no domain tables/use cases (DL-46 / F-6)                                                                                                                                                                                            |
| ORD-SM-02       | exec                   | pending | ordering illegal transitions; same                                                                                                                                                                                                                          |
| PAY-ORD-01      | exec                   | pending | payment TTL / PSP; payment module = P2                                                                                                                                                                                                                      |
| PAY-ORD-02      | exec                   | pending | payment expire + O3; payment module = P2                                                                                                                                                                                                                    |
| ADM-ORD-01      | exec                   | pending | B9 `ORDER_NOT_PAID`; ordering module                                                                                                                                                                                                                        |
| TXN-OUT-01      | exec                   | green   | `tests/outbox/pg.harness.test.ts` — `rolls back state, audit and outbox on a fault before commit (TXN-OUT-01)` (rollback + clean retry ⇒ one claimable row)                                                                                                 |
| TENANT-01       | exec                   | green   | `tests/rls/harness.test.ts` — `returns 0 rows without tenant context and cannot disable RLS`; `scopes rows with X-Scope-Distributor and hides the other tenant`                                                                                             |
| PAY-VER-01      | exec                   | pending | payment `pending_verification` guards; P2                                                                                                                                                                                                                   |
| PAY-VER-02      | exec                   | pending | hold_final; P2                                                                                                                                                                                                                                              |
| PAY-REF-01      | exec                   | pending | refund ledger; P2                                                                                                                                                                                                                                           |
| PAY-REF-02      | exec                   | pending | late PAID after cancel; P2                                                                                                                                                                                                                                  |
| PAY-REF-03      | exec                   | pending | verify retry / manual_review; P2                                                                                                                                                                                                                            |
| PAY-REF-04      | exec                   | pending | wallet-only refund amount; P2                                                                                                                                                                                                                               |
| PAY-REF-07      | exec                   | pending | `REFUND_EXISTS`; P2                                                                                                                                                                                                                                         |
| PAY-REF-08      | exec                   | pending | ledger UNIQUE fence; P2                                                                                                                                                                                                                                     |
| PAY-REF-09      | exec                   | pending | wallet_topup late success; P2                                                                                                                                                                                                                               |
| PAY-NC-01       | exec                   | pending | non-capture SMS; P2                                                                                                                                                                                                                                         |
| PAY-CB-01       | exec                   | pending | callback amount mismatch; P2                                                                                                                                                                                                                                |
| DEL-MAN-01      | exec (domain)          | pending | `ACTIVE_DELIVERY_EXISTS`; ordering/delivery                                                                                                                                                                                                                 |
| DEL-MAN-02      | exec (domain)          | pending | reason / tenant / perm on B9                                                                                                                                                                                                                                |
| DEL-MAN-03      | exec (domain)          | pending | manual deliver + idempotency                                                                                                                                                                                                                                |
| DEL-MAN-04      | exec (domain)          | pending | rejected delivery ≠ active                                                                                                                                                                                                                                  |
| AUTH-PW-05      | exec                   | green   | `src/platform/logger.test.ts` — `redacts nested password, kyc and card fields`                                                                                                                                                                              |
| AUTH-JW-01      | exec                   | green   | `tests/unit/guards.test.ts` — `rejects unauthenticated calls to empty /v1/admin namespace`                                                                                                                                                                  |
| AUTH-JW-02      | exec                   | green   | `tests/unit/guards.test.ts` — `rejects a driver token on /v1/admin` (`TOKEN_TYPE_MISMATCH`)                                                                                                                                                                 |
| AUTH-JW-04      | exec                   | green   | `tests/unit/guards.test.ts` — `AUTH-JW-04: deny-all verifier rejects a presented bearer token`                                                                                                                                                              |
| AUTH-XSS-02     | exec                   | green   | `tests/unit/health.test.ts` — `does not echo a malformed inbound request id`; `tests/unit/request-id.test.ts` — `rejects inbound ids with whitespace or control characters`                                                                                 |
| AUTH-DM-01      | exec                   | green   | `src/platform/adapters.test.ts` — `hard-fails mock adapters in production`; `wires the composition-root map at startup`                                                                                                                                     |
| PAY-ENV-01      | exec                   | green   | `src/platform/config.test.ts` — `rejects DEMO_* flags in production`; `rejects MOCK_* flags in production`; `rejects *_PROVIDER=mock in production`                                                                                                         |
| PAY-NTF-01      | exec                   | pending | payment/SMS templates (RTL, no URL); notification + P2                                                                                                                                                                                                      |
| DEL-SEC-01      | exec (domain/contract) | pending | manual-delivery security; ordering/delivery                                                                                                                                                                                                                 |
| DEL-SEC-02      | exec (domain/contract) | pending | same                                                                                                                                                                                                                                                        |
| DEL-SEC-04      | exec (domain/contract) | pending | 422 `REASON_REQUIRED`                                                                                                                                                                                                                                       |
| DEL-SEC-05      | exec (domain/contract) | pending | SMS + dispute-rate counters                                                                                                                                                                                                                                 |
| TEN-01          | exec                   | green   | `tests/rls/harness.test.ts` — `opens the request pool as vproject_app with NOBYPASSRLS`; `returns 0 rows without tenant context and cannot disable RLS` (FORCE RLS)                                                                                         |
| TEN-02          | exec                   | green   | `tests/outbox/pg.harness.test.ts` — `does not let vproject_app SELECT outbox payloads`                                                                                                                                                                      |
| TEN-03          | exec                   | green   | `tests/rls/harness.test.ts` — `grants vproject_app nothing on identity and leaves schemas owned by the migrator`                                                                                                                                            |
| TEN-04          | exec                   | green   | `tests/rls/harness.test.ts` — `does not leak tenant GUCs after commit on a pooled connection`                                                                                                                                                               |
| TEN-05          | exec                   | green   | `tests/outbox/pg.harness.test.ts` — `TEN-05: worker claims both tenants without an HTTP scope header`                                                                                                                                                       |
| C11-04          | exec (contract)        | pending | C11 password rules; real auth DL-46                                                                                                                                                                                                                         |
| C11-05          | exec (contract)        | pending | C11 typ/aud + `PASSWORD_CHANGE_REQUIRED`; DL-46                                                                                                                                                                                                             |
| B83-02          | exec (contract)        | pending | B83 unlock not-locked; DL-46                                                                                                                                                                                                                                |
| B83-03          | exec (contract)        | pending | B83 cross-tenant 404; DL-46                                                                                                                                                                                                                                 |
| B83-06          | exec (contract)        | pending | B83 reason validation; DL-46                                                                                                                                                                                                                                |
| DEL-MAN-05      | exec (domain)          | pending | `REASON_TOO_LONG`; ordering                                                                                                                                                                                                                                 |
| AUTH-PW-02-OFF  | exec (contract)        | pending | offline breached list + no HIBP egress; real password hasher DL-46                                                                                                                                                                                          |
| LIM-T-05        | exec (domain)          | pending | shopkeeper unpaid-order lock; ordering/payment                                                                                                                                                                                                              |
| LIM-T-06        | exec                   | pending | checkout rate limits; payment                                                                                                                                                                                                                               |
| LIM-T-07        | exec                   | pending | abuse alerts; payment                                                                                                                                                                                                                                       |
| AUTH-DI-01      | exec (contract)        | pending | `driver_inactive` vs C1/C2; real auth DL-46                                                                                                                                                                                                                 |
| TEN-404-01      | exec                   | green   | `tests/unit/ten-404.test.ts` — `returns identical 404 bodies for unknown ungrouped paths except request id`; `returns identical 401 bodies for unknown grouped paths and never 403` (grouped unknown paths hit the deny-all guard first; no existence leak) |
| ORD-CAN-IDEM-01 | exec (domain/contract) | pending | A33 cancel + refund key; ordering/payment                                                                                                                                                                                                                   |

## Foundation extras (not catalogue `exec` IDs; required by S-12 brief)

| Area              | Status | Mapping                                                                                                                                                                            |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health / ready    | green  | `tests/unit/health.test.ts` (`GET /health` status-only, liveness 200 when down, `/ready` 503 `SERVICE_UNAVAILABLE` + `Retry-After`); `tests/integration/health.containers.test.ts` |
| Config            | green  | `src/platform/config.test.ts` (per-process URLs, prod TLS, no migrator URL)                                                                                                        |
| Errors            | green  | `tests/unit/errors.test.ts` (404/405 → `NOT_FOUND`, other 4xx → `VALIDATION_FAILED`, never `INTERNAL`); `tests/contract/error-codes.test.ts`                                       |
| Contract sha      | green  | `tests/contract/frozen-openapi.test.ts` — `matches the DECISION_LOG pinned sha256`                                                                                                 |
| Idempotency store | green  | `tests/outbox/pg.harness.test.ts` — `stores idempotency keys for the same scope/subject/key` (HTTP Idempotency-Key on mutating routes is pending until those routes exist)         |
| Inbox once        | green  | `tests/outbox/pg.harness.test.ts` — `applies an inbox effect once`; `src/platform/events/inbox.test.ts`                                                                            |

## AppSec C-1 list

C-1 (S-12): TENANT-01, TEN-01..05, AUTH-LG-02/03, AUTH-RV-01, AUTH-AV-01..05, C11/B83 contract tests, PAY-SEC-01..05, PAY-REF-SEC-01, PAY-DL28-01, DEL-SEC-01..04. Real-auth tests stay pending until DL-46.

| ID             | Status  | Reason                                                                                   |
| -------------- | ------- | ---------------------------------------------------------------------------------------- |
| TENANT-01      | green   | RLS harness: 0 rows without GUC; cross-tenant hide; `SET row_security=off` cannot bypass |
| TEN-01         | green   | `vproject_app` + NOBYPASSRLS + FORCE RLS                                                 |
| TEN-02         | green   | app has no SELECT on `outbox_events.payload`                                             |
| TEN-03         | green   | app has no `identity` USAGE / table grants                                               |
| TEN-04         | green   | SET LOCAL GUCs do not leak after commit                                                  |
| TEN-05         | green   | worker is `vproject_worker` / NOBYPASSRLS; claims both tenants; no HTTP scope GUC        |
| AUTH-LG-02     | pending | real login lockout; DL-46                                                                |
| AUTH-LG-03     | pending | distributed login attempts; DL-46                                                        |
| AUTH-RV-01     | pending | session revoke / PG fallback; DL-46                                                      |
| AUTH-AV-01     | pending | Redis/PG session availability; DL-46                                                     |
| AUTH-AV-02     | pending | same                                                                                     |
| AUTH-AV-03     | pending | same                                                                                     |
| AUTH-AV-04     | pending | same                                                                                     |
| AUTH-AV-05     | pending | same                                                                                     |
| C11 contract   | pending | identity password-change endpoint; DL-46                                                 |
| B83 contract   | pending | driver unlock endpoint; DL-46                                                            |
| PAY-SEC-01     | pending | payment module = P2                                                                      |
| PAY-SEC-02     | pending | P2                                                                                       |
| PAY-SEC-03     | pending | P2                                                                                       |
| PAY-SEC-04     | pending | P2                                                                                       |
| PAY-SEC-05     | pending | P2                                                                                       |
| PAY-REF-SEC-01 | pending | P2                                                                                       |
| PAY-DL28-01    | pending | P2 / DL-28 runtime                                                                       |
| DEL-SEC-01     | pending | delivery/ordering domain                                                                 |
| DEL-SEC-02     | pending | domain                                                                                   |
| DEL-SEC-03     | pending | catalogue already `pending` (delivery = P3)                                              |
| DEL-SEC-04     | pending | domain                                                                                   |

**C-1 overall: pending.** Foundation tenant/RLS rows are green. Remaining C-1 IDs need real auth (DL-46) or payment/delivery modules. This does not open the Gate.
