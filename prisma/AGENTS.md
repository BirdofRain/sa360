# AGENTS.md — Prisma schema & migrations

`schema.prisma` and `migrations/` are the **single source of truth** for the database used by
the API and worker. Follow the root `AGENTS.md` and `docs/development/PARALLEL_AGENT_WORK.md`.

## Migration ownership (parallel-work model)

- **Only the Auth/Account lane may create Prisma migrations**, and only when the individual task
  explicitly authorizes it. Ingestion, Portal, and Quality lanes must **not** add migrations —
  if you need a schema change, stop and document it as a dependency (root rule 9).
- Never introduce a second/competing model for data that an existing model already represents
  (root rule 10). Extend the existing model instead.

## Rules for authorized migrations

- Migrations are **append-only and additive**. Never edit, rename, reorder, or delete an already
  committed migration, and never delete `_prisma_migrations` rows. See
  `docs/adr/migration-client-ghl-destination-ordering.md`.
- Prefer non-destructive DDL. Avoid dropping columns/tables or destructive type changes unless
  the task explicitly requires it and a data-preservation plan is documented.
- Validate locally against the provisioned databases only:
  - `pnpm prisma:generate`
  - `pnpm exec prisma migrate deploy` against the local `sa360` / `sa360_test` DBs (127.0.0.1).
  - Re-run `prisma migrate deploy` to confirm it is a clean no-op (idempotent) the second time.
- Regenerate the Prisma client (`pnpm prisma:generate`) and run the API test suite after any
  schema change.

## Never

- Run `prisma migrate dev/deploy`, `prisma db push`, `prisma migrate reset`, or `prisma studio`
  against any **remote or production** database.
- Use production credentials for migration testing (root rule 2).
