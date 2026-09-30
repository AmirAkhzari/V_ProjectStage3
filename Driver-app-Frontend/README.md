# ویزیتور — راننده (Driver PWA)

The V-Project driver app: see today's route, hand off to a map app, deliver, submit the customer's delivery code, and wait for the distributor admin to confirm.

```bash
pnpm install
pnpm dev        # http://localhost:8445 (mock API by default)
pnpm test       # vitest
pnpm typecheck
pnpm build
```

**Demo (mock mode):** tap «ورود آزمایشی» (`ali.rezaei` / `driver123`). «راهنمای نسخه نمایشی» on the login screen lists the demo delivery codes; in production only the customer has them. `hamid.nouri` shows the inactive-account error.

**Env:** `VITE_API_MODE=mock|http`, `VITE_API_BASE_URL` (see `.env.example`). The `http` endpoints are specified in `docs/DRIVER_DESIGN_PROPOSAL.md` §18 and are not implemented in `../backend` yet.

Design, state model, API/DB requirements, open questions, and acceptance criteria: [`docs/DRIVER_DESIGN_PROPOSAL.md`](docs/DRIVER_DESIGN_PROPOSAL.md). Screens: [`docs/preview/`](docs/preview/).
