# IncomingDobCorrectionAudit migration handoff

## Status

Auth/Account shipped this table on master as
`prisma/migrations/20261103184500_incoming_dob_correction_audit`. This branch
includes that migration through the refresh onto
`f04906e6aa4793f594071d44460998bf5b861c16`. The sections below are the
original assignment. Do not open a second migration for the same table. Do
not run the correction from this refresh. The #275 deploy reported 99
migrations and none pending, so production likely already has the table.
This read-only pass did not re-check that production schema. A later apply
would not refuse for a missing relation.

## Who implements this

This file is the assignment. It is not a completed migration.

The ingestion agent on `cursor/dob-historical-correction-156d`
(`bc-5f58275d-0ed1-4cc3-a2d3-0b9c8ac7156d`, pull request #267) read
`prisma/AGENTS.md`, `apps/api/AGENTS.md`, and
`docs/development/PARALLEL_AGENT_WORK.md`. Those instructions allow only an
Auth/Account agent to add `prisma/schema.prisma` and `prisma/migrations`,
and only when that agent's own task authorizes the migration. This agent is
the ingestion workstream, so it did not add those files and it did not create
the production table.

No cloud agent currently running in this environment is on the Auth/Account
lane. The last agent whose task was an authorized shared-database migration
is **AGENT D: ONBOARDING V2 SHARED DATABASE MIGRATION**:

- Agent: https://cursor.com/agents/bc-6b5afeb6-3d0a-4343-9e6e-9c60b7c2e071
- Branch it already uses: `cursor/onboarding-v2-migration-e071`
- Migration it shipped: `prisma/migrations/20261026233000_client_onboarding_v2_persistence`
- Status when this handoff was written: idle

That agent has not been given this task. Do not resume it on its old branch.
Start a new Auth/Account agent with the prompt in the next section. Until
that agent opens the isolated pull request, this table has no implementer
other than the instructions below.

Pull request #267 stays unmerged. Its commits, including
`cbf35198`, `df9de862`, and `bc2283e2`, are branch-only commits on top of
`master` at `fcb1324df0e8bfea03f6af068cc50152f254f32f`. They are not commits
on `master`.

## Prompt for the Auth/Account agent

Create an isolated branch `cursor/incoming-dob-correction-audit-156d` from
current `master`. Add only the Prisma model and one append-only migration
described in this file. Do not edit source-intake correction code, do not
merge pull request #267, do not run the correction, and do not create
`IncomingDobCorrectionAudit` by hand in production. Production receives the
table only when this migration is merged and the normal `sa360-migrate`
deploy applies it.

Local validation, against `127.0.0.1` databases `sa360` and `sa360_test` only:

- `pnpm prisma:generate`
- `pnpm exec prisma migrate deploy`
- `pnpm exec prisma migrate deploy` a second time and confirm it applies nothing
- From the rebased #267 branch, run the correction tests. A compatible table
  must allow the same-transaction apply and rollback. A name-only table must
  still return `audit_relation_incompatible` and write nothing.

Do not run `prisma migrate deploy`, `prisma migrate dev`, `prisma db push`,
or `prisma studio` against a remote database.

## Files to add

Append this model to `prisma/schema.prisma`. Do not rename columns. The
writer quotes these mixed-case names. Prisma does not emit the action check
from the model, so the migration SQL below must add that constraint itself.
A generated table that lacks the check is `audit_relation_incompatible`.

```prisma
/// Historical DOB correction audit. The writer inserts one row in the same
/// transaction as the payload change. Column names match the raw SQL contract.
model IncomingDobCorrectionAudit {
  id                   String   @id
  version              String
  action               String
  operator             String
  eventId              String
  previousUpdatedAt    DateTime
  newUpdatedAt         DateTime
  alreadyDelivered     Boolean
  beforeJson           Json
  afterJson            Json
  externalDestinations String
  createdAt            DateTime @default(now())

  @@index([eventId, createdAt])
}
```

Create `prisma/migrations/20261103184500_incoming_dob_correction_audit/migration.sql`
with the DDL in the next section. Use a later timestamp if `master` already
contains a migration at or after `20261103184500`. Do not edit an existing
migration directory.

This document is the schema contract for historical DOB correction apply and
rollback (`apps/api/src/services/source-intake/incoming-field-dob-correction.ts`).
The DDL below is the migration body. Copying it into production outside
`prisma migrate` is not authorized. Pull request #267 is not
production-executable until that migration is on `master` and a future apply
confirms schema compatibility.

The released intake change on `master` (`fcb1324`) does not depend on this
table. Do not block that release on this migration.

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
