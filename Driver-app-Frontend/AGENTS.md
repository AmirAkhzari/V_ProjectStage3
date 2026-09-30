# Visitor Driver App (ویزیتور — راننده)

Mobile-first PWA for distributor drivers: today's assigned stops → external map hand-off → deliver → enter the customer's delivery code → wait for admin confirmation. Siblings: client PWA `../FrontEnd`, admin panel `../admin-FrontEnd`.

## Project memory

- Design + product spec, conflicts, API/DB requirements, open questions, acceptance criteria: [`docs/DRIVER_DESIGN_PROPOSAL.md`](docs/DRIVER_DESIGN_PROPOSAL.md). Read it before structural changes.
- Screenshots of every screen: `docs/preview/`.
- Governance/intent: `../V-Project-AI-Workspace` (priority-0 flow). This app implements the 2026-09-27 driver brief, which conflicts with the flow's "Tap Delivered" edge (C-7), pending owner approval.

## Key rules

- **The driver never marks an order delivered.** A valid code moves the delivery to `awaiting_confirmation`; only a distributor admin's confirmation makes the order `delivered`.
- The backend is the source of truth for code validity, lockout, assignment and permissions. The UI only renders `verification.canSubmitCode` / `blockedReason` and never sees codes.
- Order status (existing admin pipeline) ≠ delivery status ≠ presentation task state (`src/lib/deliveryStatus.ts`).
- Delivery/driver types mirror `../admin-FrontEnd/src/types/index.ts`; keep them in sync.

## Stack and conventions

- Vite + React 19 + TypeScript (strict) + Tailwind v4 + TanStack Query (server state, polling) + Zustand (session, theme) + react-router v7 + vite-plugin-pwa. Port 8445.
- `src/services/api.ts` (`DriverApi`) → `mockApi.ts` (localStorage `visitor-driver:db:v1`, plays the backend) or `httpApi.ts` (spec'd endpoints); `VITE_API_MODE=mock|http` (default mock).
- RTL Persian, IRANSansXFaNum, Apple HIG tokens copied from the client (`src/index.css`); monochrome accent, red only for errors/destructive; status = icon + label.
- Driver copy uses the Persian comma "،" as separator, never "·" (reads as Persian zero next to digits).
- Touch targets ≥ 44px, primary actions 54–56px at the bottom; numeric keyboard for codes.
- Default-export pages; `@/` alias; comments only for non-obvious constraints.
- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test` / `pnpm format` (Prettier, same config as admin).
