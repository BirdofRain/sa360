# SA360 — Central Operating Center (`@sa360/admin-coc`)

Private **Next.js 15** admin dashboard for webhook visibility, Synthflow inbound reporting, review queues, clients, and feature flags. UI uses **Tailwind CSS** and **shadcn/ui** (Base UI primitives).

Design intent: [`docs/figma/sa360-coc-design-brief.md`](../../docs/figma/sa360-coc-design-brief.md). Static visual reference (do not run as an app): [`docs/figma/generated-reference/internal-admin-dashboard`](../../docs/figma/generated-reference/internal-admin-dashboard).

## Scripts (from repo root)

```bash
pnpm dev:admin-coc
pnpm build:admin-coc
```

Or from this directory: `pnpm dev` / `pnpm build`.

## Environment

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SA360_ENV` | Optional: `staging` or `production` for the header badge (defaults to development styling). |
| `NEXT_PUBLIC_API_BASE_URL` | Optional: Fastify API base URL when admin REST routes are available. |

## Stack notes

- **No** `shadcn/tailwind.css` at runtime: theme tokens live in `src/app/globals.css`; `tailwindcss-animate` supplies menu/sheet motion utilities.
- Default dev server port is **3000**; run on another port if `apps/api` already uses it, e.g. `pnpm dev -- -p 3001`.
