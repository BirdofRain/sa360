# AGENTS.md — `@sa360/admin-coc` (Next.js: Admin C.O.C. + customer portal)

One Next.js app hosting two surfaces:

- **Admin C.O.C.** — internal operator UI (`src/app/(dashboard)`, `/action-center`,
  `/agent-workspace`, `/source-intake`, `/webhooks`, `/routing-dry-run`, `/integrations`, etc.).
- **Customer-facing portal** — `src/app/portal/**` with UI in `src/components/client-portal/**`
  and adapters in `src/client-portal/`. Auth gate/session in `src/middleware.ts`.

Follow the root `AGENTS.md` and the lane ownership in `docs/development/PARALLEL_AGENT_WORK.md`.
The **Portal lane** owns `portal` UX/components/adapters; the **Quality lane** owns Admin C.O.C.
robustness. Coordinate before editing across those boundaries (root rule 9).

## Architecture & conventions

- Server-only secrets must **never** use the `NEXT_PUBLIC_` prefix (Next.js exposes those to the
  browser). Read env access carefully before adding a variable.
- The frontend talks to `@sa360/api` via `NEXT_PUBLIC_SA360_API_BASE_URL` and server-side proxy
  routes under `src/app/api/**`. Do **not** invent backend write behavior when no API exists —
  document the missing endpoint as a dependency instead (Portal lane rule).
- Reuse existing components, adapters, and the design-system primitives (`class-variance-authority`,
  `tailwind-merge`, `@base-ui/react`, `lucide-react`). Do not fork a parallel component for an
  existing one (root rule 10).
- Portal work must cover responsive layouts and explicit loading / error / empty states.

## Testing

- Tests: `pnpm --filter @sa360/admin-coc test` (Node test runner + `@happy-dom` +
  `@testing-library/react`; files `src/**/*.test.ts` / `*.test.tsx`).
- Lint: `pnpm --filter @sa360/admin-coc lint`. Build: `pnpm --filter @sa360/admin-coc build`.
- For non-trivial UI changes, run the dev server (`pnpm dev:admin-coc`) and verify the affected
  page(s) manually in addition to component tests. Add/adjust tests next to changed components;
  never skip or weaken failing tests (root rule 6).

## Boundaries

- Do **not** modify `prisma/schema.prisma` or add migrations from this app.
- Do **not** redesign the auth architecture (session/cookie/tenant model) — that is the
  Auth/Account lane. Consume the existing portal auth + tenant scoping instead.
