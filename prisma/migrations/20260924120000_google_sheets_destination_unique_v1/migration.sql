-- Google Sheets Phase 1C: at most one google_sheets.v1 DeliveryTarget per ClientAccount.
--
-- Additive index only. No column, table, enum, or data change.
--
-- Prisma cannot express a filtered unique index, so this is raw SQL and the
-- schema carries a doc comment instead of @@unique. Do NOT replace it with
-- @@unique([clientAccountId]) — that would forbid a client from holding a GHL
-- target and a Sheets target at the same time. If `prisma migrate diff` or
-- `migrate dev` proposes DROP INDEX for this name, reject the drop.
--
-- No code path created google_sheets.v1 DeliveryTarget rows before Phase 1C,
-- so no pre-existing duplicates are expected. If a database somehow holds two,
-- this CREATE fails loudly rather than silently deleting customer configuration.

CREATE UNIQUE INDEX "DeliveryTarget_clientAccount_googleSheets_key"
  ON "DeliveryTarget"("clientAccountId")
  WHERE "adapterKey" = 'google_sheets.v1';
