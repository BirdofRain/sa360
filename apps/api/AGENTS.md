# AGENTS.md — `@sa360/api` (Fastify API)

Backend HTTP service: webhook ingestion, source adapters, normalization, routing, and the
admin / client-portal / agent-workspace APIs. Follow the root `AGENTS.md` and the lane
ownership in `docs/development/PARALLEL_AGENT_WORK.md`.

## Architecture

- Entry: `src/server.ts` → `src/app.ts`. Routes live in `src/routes/`, business logic in
  `src/services/`, data access in `src/repositories/`, request/response shapes in `src/schemas/`.
- **Ingestion / sources** (Ingestion lane): `src/routes/webhook*.ts`, `src/routes/sources-*.ts`,
  `src/routes/voice*.ts`, `src/services/source-intake/`, `src/services/routing-*`,
  `src/services/leadcapture-*`, `src/services/synthflow-*`, `src/services/webhook-request-log.service.ts`.
- **Auth** (Auth/Account lane): `src/lib/auth.ts`, `src/lib/admin-auth.ts`,
  `src/lib/client-portal-auth.ts`, `src/lib/workspace-auth.ts`, `src/lib/*-webhook-auth.ts`,
  `src/lib/ghl-oauth*.ts`, and tenant scoping in `src/services/client-portal-tenant.service.ts`.
- Prisma access goes through `src/lib/db.ts`; Redis/queues through `src/lib/redis.ts` and
  `src/services/*queue*.service.ts`. Reuse these — do not construct new clients (root rule 10).

## Testing

- Run: `pnpm --filter @sa360/api test` (Node test runner, `--test-concurrency=1`).
- Prisma-backed tests require the **local** test database. The bootstrap
  (`src/test/set-test-env.ts` + `src/lib/safe-test-database-url.ts`) **deletes any ambient
  `DATABASE_URL`** and only accepts `SA360_TEST_DATABASE_URL` when it is `localhost`/`127.0.0.1`
  and the DB name contains `test`. Remote URLs are rejected by design — never bypass this guard.
- The environment's `.env` already sets `SA360_TEST_DATABASE_URL` and `SA360_TEST_REDIS_URL` to
  the local `sa360_test` DB and local Redis, so `pnpm --filter @sa360/api test` works out of the box.
- Redis test connections are fail-fast by default (`SA360_REDIS_TEST_FAIL_FAST`), so a missing
  Redis surfaces quickly instead of hanging.
- For a fast unit-only check while iterating, run specific files, e.g.
  `node --import tsx/esm --import ./src/test/set-test-env.ts --test "src/lib/auth.test.ts"`.
- Add or update `*.test.ts` next to the code you change; do not weaken or skip failing tests
  (root rule 6).

## Contracts

- HTTP routes, webhook payload shapes, and auth headers (`x-sa360-secret`, `x-sa360-admin-key`,
  `x-sa360-workspace-key`, `x-sa360-client-portal-key`, LeadCapture/LeadConduit keys) are external
  contracts. Do not change them unless the task explicitly says so (root rule 3).
- Delivery/GHL adapters must stay in simulate / non-production modes during tests. Never enable
  live delivery or use real GHL/Meta tokens for tests.

## Prisma

Do not add migrations here unless you are the Auth/Account lane and the task authorizes it.
Coordinate schema needs with that lane instead of editing `prisma/schema.prisma` from this app.
