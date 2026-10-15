# V-Project backend

P0 Foundation skeleton. Node 24, Fastify 5, Zod 4, drizzle-orm, Postgres 16, Redis 7.

## TypeScript pin

TypeScript is pinned to **`~6.0.x`** (`typescript@~6.0.3`).

TS 6.0 is the last JS-based compiler and the supported peer for `typescript-eslint` (`>=4.8.4 <6.1.0`). TS 7 has no compiler API until 7.1, so eslint cannot run on it. Keep 6.0 as the `typescript` package. A later optional path is TS 7 side-by-side as `@typescript/native` for faster `tsc`, re-evaluated at 7.1.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm db:drift
pnpm db:check
```
