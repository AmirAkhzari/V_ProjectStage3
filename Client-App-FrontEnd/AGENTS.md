# Visitor PWA

React + Vite + Tailwind CSS v4 progressive web app for V-Project (ویزیتور).

## Development

Vite runs on `$PORT` (default 8443).

## Structure

- `src/main.tsx` — entry
- `src/App.tsx` — router
- `src/pages/` — route screens
- `src/components/` — layout, UI, catalog
- `src/store/useAppStore.ts` — Zustand session/cart/wallet
- `src/services/` — API contract + mock adapter (`localStorage`)
- `src/data/` — catalog, cities, distributors
- `src/index.css` — Tailwind v4 tokens

## Scripts

- `pnpm dev` / `pnpm build` / `pnpm preview`
- `pnpm typecheck`
- `pnpm test`
- `pnpm format`

## Conventions

- Default-export pages and layout components
- Double quotes for apostrophe strings
- RTL Persian UI, IRANSansXFaNum (Farsi numerals). Apple semantic colors from iOS HIG: grouped backgrounds (`#F2F2F7` / `#000000`), grouped secondary cards (`#FFFFFF` / `#1C1C1E`), label primary/secondary/tertiary, fills, and separators. Accent is label primary (black/white). System red only for destructive and errors.
- Use Tailwind utilities; keep tokens in `src/index.css`
