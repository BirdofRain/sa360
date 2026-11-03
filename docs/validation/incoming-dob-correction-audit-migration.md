# IncomingDobCorrectionAudit migration handoff

Owner: **Auth/Account**. Ingestion does not add files under `prisma/migrations`
or edit `prisma/schema.prisma` for this table. See `prisma/AGENTS.md` and
`docs/development/PARALLEL_AGENT_WORK.md`.

This document is the schema contract for historical DOB correction apply and
rollback (`apps/api/src/services/source-intake/incoming-field-dob-correction.ts`).
The DDL below is not a migration, and copying it into production by hand is
not authorized. Pull request #267 is **not** production-executable until
Auth/Account ships this table through the normal append-only migration path
and a future apply confirms schema compatibility.

The prospective intake change does not depend on this table. Do not block
that pull request on this migration.

## Why a new table

These existing audit models cannot store this before/after correction:

- `LeadVerificationApprovalAuditEvent`
- `LeadProofReviewAuditEvent`
- `LeadCaptureTrustSyncAuditEvent`
- `Lf2CheckpointAAuditEvent`
- `ClientOnboardingSetupAuditEvent`
- `DeliveryRuntimeModeAuditEvent`
- `ClientOnboardingV2AuditEvent`

The writer uses raw SQL. It does not require a Prisma model to run. Add a
model anyway so `schema.prisma` stays the source of truth, with column names
and types that match this contract. Do not rename columns. The writer quotes
mixed-case names.

## DDL

```sql
CREATE TABLE "IncomingDobCorrectionAudit" (
  id TEXT PRIMARY KEY,
  "version" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "previousUpdatedAt" TIMESTAMP(3) NOT NULL,
  "newUpdatedAt" TIMESTAMP(3) NOT NULL,
  "alreadyDelivered" BOOLEAN NOT NULL,
  "beforeJson" JSONB NOT NULL,
  "afterJson" JSONB NOT NULL,
  "externalDestinations" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncomingDobCorrectionAudit_action_check"
    CHECK ("action" IN ('apply', 'rollback'))
);

CREATE INDEX "IncomingDobCorrectionAudit_eventId_createdAt_idx"
  ON "IncomingDobCorrectionAudit" ("eventId", "createdAt");
```

`beforeJson` and `afterJson` store only the canonical DOB/age state:
`date_of_birth`, `date_of_birth_provenance`, `consumer_age`,
`consumer_age_provenance`, `consumer_age_reference_date`,
`consumer_age_reference_rule`, `consumer_age_conflict`, and
`source_attribute_date_of_birth`. They do not store contact values or the
raw payload.

## Compatibility gate

`to_regclass('public."IncomingDobCorrectionAudit"')` is only the missing-table
check. Apply and rollback also require every item below. A name-only table
returns `audit_relation_incompatible` and writes nothing.

| Requirement | Expected |
| --- | --- |
| Columns `id`, `version`, `action`, `operator`, `eventId`, `externalDestinations` | `text`, not null |
| Columns `previousUpdatedAt`, `newUpdatedAt`, `createdAt` | `timestamp without time zone`, not null |
| Column `alreadyDelivered` | `boolean`, not null |
| Columns `beforeJson`, `afterJson` | `jsonb`, not null |
| Primary key | `pg_constraint.contype = 'p'` |
| Index | `pg_indexes.indexdef` includes `"eventId"` and `"createdAt"` |
| Action check | a check constraint whose definition includes both `'apply'` and `'rollback'` |

The same check runs again inside the write transaction. A mismatch throws
and rolls the payload update back with the audit insert.

Apply inserts one audit row in that same transaction. Rollback reads those
rows, restores the audited canonical fields, and inserts its own audit row
in the same transaction. A later edit of the canonical values is left in
place. JSONL export after commit is optional and is not the source of
rollback.

## Local validation for the owning lane

Run only against `127.0.0.1` databases `sa360` and `sa360_test`:

- `pnpm prisma:generate`
- `pnpm exec prisma migrate deploy` against those local databases
- `pnpm exec prisma migrate deploy` a second time and confirm it is a no-op

Do not run `prisma migrate deploy`, `prisma migrate dev`, `prisma db push`,
or `prisma studio` against a remote database. Do not create this table in
production outside the migration.
