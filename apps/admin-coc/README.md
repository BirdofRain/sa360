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
| `NEXT_PUBLIC_API_BASE_URL` | Required for live data: Fastify API base URL (e.g. `http://localhost:3001`). |
| `SA360_ADMIN_API_KEY` or `ADMIN_API_KEY` | **Server-only.** Forwarded as `x-sa360-admin-key` when this app calls the admin API. Never exposed to the browser. |
| `ADMIN_COC_PASSWORD` | **Server-only.** Single shared password for the temporary login gate. Leave empty/unset to disable the gate (recommended for local dev). |

### Password gate

The admin dashboard is gated by a single shared password defined via `ADMIN_COC_PASSWORD`. On successful login the server action sets a httpOnly `sa360_admin_session` cookie (`sameSite=lax`, `secure` in production, 30-day `max-age`).

- **Local dev:** leave `ADMIN_COC_PASSWORD` empty/unset to bypass the gate so existing flows keep working.
- **Staging/Production:** set a strong value via your deployment secrets. The password is read server-side only; it is never serialized to the browser or to public env vars.
- **Logout:** call the `logoutAction` server action (or clear the `sa360_admin_session` cookie).

This is intentionally minimal and temporary. Replace with Google OAuth / Auth.js when ready.

### Internal launch kanban

`/launch-kanban` is an editable internal project board persisted via the admin API (`/admin/v1/kanban/*`). On first GET, the API idempotently seeds the canonical `sa360_beta_mvp_launch` board from a static seed. After that, the database is the source of truth and the static seed becomes inert.

Drag-and-drop and field edits autosave through server actions (`apps/admin-coc/src/app/actions/launch-kanban.ts`) so the admin API key never reaches the browser.

## Stack notes

- **No** `shadcn/tailwind.css` at runtime: theme tokens live in `src/app/globals.css`; `tailwindcss-animate` supplies menu/sheet motion utilities.
- Default dev server port is **3000**; run on another port if `apps/api` already uses it, e.g. `pnpm dev -- -p 3001`.
