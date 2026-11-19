# Visitor Admin Panel (ویزیتور — پنل ادمین)

Admin dashboard for V-Project. This folder is the **admin** front end; the **client/retailer PWA** lives in the sibling folder `../FrontEnd` and the **driver PWA** in `../Driver-FrontEnd` (spec: `../Driver-FrontEnd/docs/DRIVER_DESIGN_PROPOSAL.md`). Driver/delivery types in `src/types/index.ts` mirror the driver app's; an order becomes `delivered` for driver-bound orders only via delivery confirmation.

## Project memory

- Full design proposal, routes, data layer, project tree and phased build order: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). Read it before structural changes and keep its phase table updated.
- Figma Make design prompt (tokens, screens, sample data): [`docs/FIGMA_MAKE_PROMPT.md`](docs/FIGMA_MAKE_PROMPT.md).
- Client app reference: `../FrontEnd` (live: https://visitor-pwa-three.vercel.app, demo phone `09143662051`, OTP `12345`).

## Key decisions

- Roles: **SuperAdmin** (platform) + **DistributorAdmin** (scoped to its own شرکت پخش via `session.distributorId`).
- Stack: Vite + React 19 + TypeScript + Tailwind v4 + shadcn (radix-nova, `rtl: true`) + Zustand (session/UI) + TanStack Query (server state) + react-router v7. Standalone folder, no monorepo.
- Data: `src/services/api.ts` (`AdminApi`) with a localStorage mock (`visitor-admin:db:v1`) seeded from copies of the client's `catalog.ts` / `account.ts`; `VITE_API_MODE=mock|http`.
- `src/types/index.ts` is a superset of `../FrontEnd/src/types/index.ts` — keep them in sync.
- Backend contract parity: every backend change (response shape, status codes, scope rules, new query params) must be checked against this app in the same slice — `AdminApi` in `src/services/api.ts`, the `httpApi` adapter and `mockApi` all have to match it. `httpApi.getDistributors` already accepts both the old bare array and B24's `{ items, hasMore, nextAfter }`; `all=1` is sent only for a platform-scoped super admin, without the `X-Scope-Distributor` header. B33 keeps the same shape: `getRetailersPage` sends `limit`/`after` and pages in `RetailersPage` with a cursor stack; unpaged callers use `getRetailers`, which reads the first (500-row) page and still tolerates a bare array.

## Conventions (shared with client)

- RTL Persian UI, IRANSansXFaNum with Farsi numerals. Apple HIG semantic colors: grouped backgrounds (`#F2F2F7` / `#000000`), cards (`#FFFFFF` / `#1C1C1E`), label primary/secondary/tertiary, fills, separators. Accent is label primary (black/white). System red only for destructive and errors.
- Default-export pages and layout components; `@/` alias; Tailwind utilities with tokens in `src/index.css`.
- Desktop-first layout (right-side shadcn Sidebar), responsive down to tablet.
- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test` / `pnpm format` (Prettier + tailwind plugin; `.prettierrc`). Don't use oxfmt 0.2.x here — it strips `;` separators inside inline object types and produces invalid TS.
