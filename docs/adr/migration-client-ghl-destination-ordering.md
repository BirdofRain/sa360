# ADR: Repair ClientGhlDestination Fresh-Database Migration Ordering

## Status

Accepted — local disposable validation complete before production deploy.

## Context

Migration `20260601120000_client_ghl_custom_field_option_map` was timestamped before
`20260601161852_add_client_onboarding_models`, but its SQL alters
`ClientGhlDestination`, which is only created in the later migration.

### Original defect SQL

`20260601120000_client_ghl_custom_field_option_map`:

```sql
ALTER TABLE "ClientGhlDestination"
ADD COLUMN "sa360CustomFieldOptionMapJson" JSONB NOT NULL DEFAULT '{}';
```

`20260601161852_add_client_onboarding_models` creates `ClientGhlDestination` and its
primary key, unique index on `clientAccountId`, and foreign key to `ClientAccount`.

### Impact

- **Fresh databases:** `prisma migrate deploy` failed at `20260601120000` with
  `relation "ClientGhlDestination" does not exist`.
- **Existing shared databases:** Both migrations were already recorded in
  `_prisma_migrations` because they were applied incrementally when the table
  already existed. Schema and data are correct today.
- **Fulfillment shadow core (`20260708180000`):** Unrelated; it was blocked only
  because the full fresh chain could not complete.

## Decision

Use **Option D** — guarded historical migration plus additive reconciliation:

1. **Modify** `20260601120000_client_ghl_custom_field_option_map` to add the column
   only when `ClientGhlDestination` exists and the column is missing.
2. **Add** `20260601170000_reconcile_client_ghl_destination_option_map` immediately
   after onboarding table creation to ensure the column exists on fresh installs.

Both steps use idempotent PostgreSQL `DO` blocks. No tables, indexes, or foreign
keys are removed.

## Why this is safe

| Scenario | Behavior |
|---|---|
| Fresh empty database | `20260601120000` skips; `20260601161852` creates table; `20260601170000` adds column |
| Existing database (column present) | `20260601170000` is pending once; runs as no-op |
| Existing database (column missing) | Either guarded step adds column; reconciliation is still safe |

Later migrations (`20260609120000`, `20260610120000`, `20260612120000`,
`20260615120000`) only require `ClientGhlDestination` to exist; they do not
depend on the option-map column being created specifically by `20260601120000`.

## Checksum implications

Prisma stores a SHA-256 checksum of each applied migration file in
`_prisma_migrations`. Editing `20260601120000` changes its on-disk checksum
from `279b5fe53406406f74e6f941f76dcad4c0b65b5c651cdab7e19b82e7c6d34899` to
`a297ca00afa58178f43adf7738f60fd87afe1394985dfa8eb098db99d210e233`.

Disposable validation with the old checksum deliberately stored in
`_prisma_migrations` showed that `prisma migrate deploy` and
`prisma migrate status` still succeed with **no pending migrations** (Prisma
6.19.2 deploy path does not block on checksum drift for already-applied rows).

If a future Prisma version or `migrate dev` workflow surfaces drift, reconcile
with a one-time checksum update (not a falsified applied state):

```sql
UPDATE "_prisma_migrations"
SET checksum = 'a297ca00afa58178f43adf7738f60fd87afe1394985dfa8eb098db99d210e233'
WHERE migration_name = '20260601120000_client_ghl_custom_field_option_map';
```

`20260601170000_reconcile_client_ghl_destination_option_map` is a **new**
migration with no prior checksum entry.

## Validation before production

On disposable local PostgreSQL only (`127.0.0.1`):

1. Fresh `prisma migrate deploy` on an empty database — all migrations apply.
2. Upgrade database at pre-repair state with representative `ClientGhlDestination`
   and option-map data — deploy adds reconciliation only; data preserved.
3. Second `prisma migrate deploy` — no pending migrations, no duplicate DDL.
4. Schema equivalence between fresh and upgrade paths for `ClientGhlDestination`
   and `sa360CustomFieldOptionMapJson`.

Use `scripts/validate-migration-chain.ps1` for repeatable local checks.

## Non-goals

- No changes to fulfillment shadow-core migration or matcher logic.
- No `prisma db push`, no shared-database resets, no `_prisma_migrations` deletions.
- No live fulfillment, reservation, or delivery execution.
