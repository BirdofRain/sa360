# AGENTS.md — `@sa360/worker` (BullMQ worker)

Background job processor (Meta dispatch, bulk import delivery, facet snapshot rebuild). Follow
the root `AGENTS.md` and `docs/development/PARALLEL_AGENT_WORK.md`.

## Architecture

- Entry: `src/worker.ts`. Job processors consume BullMQ queues backed by Redis (ioredis).
- Shares the Prisma schema and `@sa360/shared` with the API. Queue names and job payloads are a
  contract shared with `apps/api` producers — keep producer and consumer in sync and do not
  fork a second queue definition (root rule 10).

## Testing

- Run: `pnpm --filter @sa360/worker test` (Node test runner). These tests are unit-level and do
  not require Postgres or Redis to be running.
- Add `*.test.ts` beside changed processors. Do not skip or weaken failing tests (root rule 6).
- If you change a job payload or queue name, update the corresponding producer in `apps/api`
  and its tests, and note the cross-cutting change as a dependency (root rule 9) if the producer
  is owned by another lane.

## Contracts & safety

- Retryable vs terminal error semantics (which failures BullMQ retries) are behavioral contracts
  — preserve them unless the task explicitly changes them.
- Never point the worker at production Redis/Postgres or enable live external delivery for tests.
