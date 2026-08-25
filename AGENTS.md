# AGENTS.md — SA360 project-wide agent instructions

This repository is developed by multiple Cursor Cloud Agents working **in parallel**, each on
its own branch, each producing a reviewable PR. These instructions apply to every agent in
every directory. Nested `AGENTS.md` files add area-specific guidance and take precedence in
their subtree.

Read `docs/development/PARALLEL_AGENT_WORK.md` before starting: it defines the workstream lanes
(Ingestion, Portal, Auth/Account, Quality), what each lane owns, and the merge policy.

## Mandatory rules

1. **Never deploy or modify production infrastructure** (DigitalOcean App Platform, DNS,
   managed Postgres/Redis, marketplace apps, etc.) unless the individual task explicitly
   authorizes it.
2. **Never use production-write credentials for tests.** Tests run only against the local
   `127.0.0.1` Postgres/Redis provisioned by the environment. API Prisma tests read
   `SA360_TEST_DATABASE_URL` (localhost, DB name containing `test`) — never a remote URL.
3. **Preserve existing external API contracts** (HTTP routes, request/response shapes, webhook
   payloads, auth headers, DB column semantics) unless the task explicitly changes a contract.
4. **Prefer targeted changes over broad refactors.** Touch the smallest surface that solves the
   task. Do not reformat, rename, or restructure unrelated code.
5. **Run the relevant tests and builds before completing work** (see command reference below).
   A change with a failing test is still better than no evidence — report the failure honestly.
6. **Never hide, skip, delete, or weaken a failing test merely to make a task pass.** Fix the
   root cause. `it.skip`, deleting assertions, loosening matchers, or `--test-only` filtering to
   dodge failures are all prohibited.
7. **Every agent works on its own branch and finishes with a reviewable PR/commit.** Do not
   leave the branch; do not force-push or amend shared history; commit each logical change
   separately.
8. **Report at the end of every task:**
   - root cause or design rationale
   - files changed
   - tests run
   - test/build results
   - migrations, if any
   - risks
   - follow-up dependencies
9. **If a task requires editing another parallel workstream's owned area, STOP that portion**
   and document the dependency (see `docs/development/PARALLEL_AGENT_WORK.md`) rather than
   expanding scope into another lane.
10. **Do not introduce a second implementation of an existing source of truth.** Reuse the
    existing service, repository, schema, adapter, or util. If the current source of truth is
    inadequate, document the gap instead of forking a parallel implementation.

## Repository shape

- **Package manager:** pnpm `10.32.1` (pinned via `packageManager`; use Corepack). Node `22.x`.
- **Monorepo:** pnpm workspaces + Turborepo. Members: `apps/*`, `packages/*`.
  - `apps/api` — Fastify HTTP API (webhooks, ingestion, routing, admin + client + workspace APIs).
  - `apps/worker` — BullMQ background worker (Meta dispatch, bulk import, facet rebuild).
  - `apps/admin-coc` — Next.js app: internal Admin C.O.C. **and** the customer-facing portal (`/portal`).
  - `packages/shared` — shared TypeScript library; build it before the apps type-check.
- **Database:** PostgreSQL via Prisma (`prisma/schema.prisma`, `prisma/migrations`). Single
  schema is the source of truth for all apps.
- **Queues/cache:** Redis via BullMQ/ioredis.

## Environment & commands

The Cloud environment (`.cursor/environment.json`) provisions everything automatically:

- **Install** (`scripts/cloud-agent-install.sh`): installs local Postgres + Redis, runs
  `pnpm install --frozen-lockfile`, `pnpm prisma:generate`, builds `@sa360/shared`, and writes a
  localhost-only `.env`.
- **Start** (`scripts/cloud-agent-start.sh`): starts local Postgres + Redis, ensures the `sa360`
  and `sa360_test` databases exist, and applies migrations to those **local** databases only.

Application dev servers are **task-specific** — start them only when your task needs them:

| Action | Command |
| --- | --- |
| Install dependencies | `pnpm install --frozen-lockfile` |
| Generate Prisma client | `pnpm prisma:generate` |
| Build everything | `pnpm build` |
| Build one app | `pnpm build:api` / `pnpm build:worker` / `pnpm build:admin-coc` |
| API tests | `pnpm --filter @sa360/api test` (needs local Postgres + Redis; see `apps/api/AGENTS.md`) |
| Worker tests | `pnpm --filter @sa360/worker test` |
| Admin/portal tests | `pnpm --filter @sa360/admin-coc test` |
| Admin/portal lint | `pnpm --filter @sa360/admin-coc lint` |
| API dev server | `pnpm dev:api` |
| Worker dev | `pnpm dev:worker` |
| Admin/portal dev | `pnpm dev:admin-coc` |

## Prisma / migration policy

- The Prisma schema is a shared source of truth. Only the **Auth/Account lane** may create
  migrations under the parallel-work model; every other lane must avoid schema/migration
  changes unless the individual task explicitly authorizes them. See `prisma/AGENTS.md`.
- Never run `prisma migrate deploy`, `prisma migrate dev`, `prisma db push`, or `prisma studio`
  against a remote/production database. Migrations run only against the local `127.0.0.1`
  databases.

## Secrets

Building and running the representative test suites requires **no secrets** — only the local
Postgres/Redis provisioned by the environment. Do not add real GHL/Synthflow/Meta/Logtail or any
production credentials to run tests; use the code's simulate/dev modes and safe test values.
