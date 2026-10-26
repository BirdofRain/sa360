# Company Sheets setup grants

Preparation only. Merging or deploying this migration is a separate approval. It does not issue a password, edit an App Platform spec, or change Boundary A.

## Privileges

| Table | Privileges | Production use |
| --- | --- | --- |
| `CompanySheetsClientFolder` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | Claim, create, upsert, update, and delete an unconfirmed first claim. Unlink updates the row and keeps `folderId`. |
| `CompanySheetsFolderEvent` | `SELECT`, `INSERT` | Append-only history, including unlink. No update or delete. |
| `CompanySheetsSpreadsheetLink` | `SELECT`, `INSERT`, `UPDATE` | Insert the current link and mark the prior current link `previous` or insert an `inferred` prior link. No delete. |

The worker does not query these tables. Deletes of `ClientAccount` cascade to the three tables as the table owner, so `sa360_app` does not need `DELETE` on the event or link tables for that cascade.

Not granted: `TRUNCATE`, `REFERENCES`, `TRIGGER`, `ALL`, grants to `PUBLIC`, ownership changes, default-privilege changes, and role or membership changes. The pinned Boundary A SQL is unchanged.

## Order

Production already has `sa360_app`. The migration grants these privileges when that role is present.

On loopback, `prisma migrate deploy` can run before the role exists. The migration is recorded and grants nothing. A later `CREATE ROLE sa360_app` does not fill that gap. Boundary A cannot be replayed after these tables exist: its relation inventory refuses the extra relations, and its checksum-pinned grant list does not name them. Re-run this migration file as the table owner after the role exists:

`prisma/migrations/20261026200000_company_sheets_setup_grants/migration.sql`

A non-loopback session without `sa360_app` fails instead of recording a skipped grant. The decision uses `inet_server_addr()`, the address where the database accepted the session. A client-side tunnel does not make a managed server look local. Production already has `sa360_app`, so this migration grants on that database.
