import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../../../");
const migrationsDir = join(repoRoot, "prisma/migrations");
const UNIQUE_MIGRATION = "20260924120000_google_sheets_destination_unique_v1";
const UNIQUE_INDEX = "DeliveryTarget_clientAccount_googleSheets_key";
const files = [
  join(here, "google-sheets-http-client.ts"),
  join(here, "google-sheets-destination.service.ts"),
  join(here, "../../lib/google-sheets-env.ts"),
  join(here, "../../lib/google-spreadsheet-ref.ts"),
  join(here, "../../routes/integrations-google.ts"),
  join(here, "../google-oauth/google-access-token.service.ts"),
  join(here, "../google-oauth/google-oauth-http-client.ts"),
];

test("AB/AQ/Y. Phase 1C sources never call Drive, append rows, or enqueue worker jobs", () => {
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/https:\/\/drive\.googleapis\.com/.test(source), false, file);
    assert.equal(source.includes("/auth/drive"), false, file);
    assert.equal(source.includes("values:append"), false, file);
    assert.equal(source.includes("spreadsheets.values"), false, file);
    assert.equal(source.includes("bullmq"), false, file);
    assert.equal(/deliverLive\s*\(/.test(source), false, file);
  }
});

test("one-Sheets-destination partial unique index is additive and must not be dropped", () => {
  const sql = readFileSync(join(migrationsDir, UNIQUE_MIGRATION, "migration.sql"), "utf8");
  assert.match(sql, new RegExp(`CREATE UNIQUE INDEX "${UNIQUE_INDEX}"`));
  assert.match(sql, /ON "DeliveryTarget"\("clientAccountId"\)/);
  assert.match(sql, /WHERE "adapterKey" = 'google_sheets\.v1'/);

  // Additive only: no column, table, enum, or data change.
  const ddl = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(ddl, /ALTER TABLE/);
  assert.doesNotMatch(ddl, /DROP/);
  assert.doesNotMatch(ddl, /DELETE/);
  assert.doesNotMatch(ddl, /UPDATE/);
  assert.doesNotMatch(ddl, /CREATE TABLE/);

  const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
  const modelStart = schema.indexOf("model DeliveryTarget");
  const modelEnd = schema.indexOf("\nmodel ", modelStart + 1);
  const model = schema.slice(modelStart, modelEnd === -1 ? undefined : modelEnd);
  assert.equal(model.includes("@@unique([clientAccountId])"), false);

  const later = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > UNIQUE_MIGRATION)
    .map((entry) => entry.name);
  for (const name of later) {
    const laterSql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    assert.equal(
      laterSql.includes("DROP INDEX") && laterSql.includes(UNIQUE_INDEX),
      false,
      `${name} must not drop ${UNIQUE_INDEX}`
    );
  }
});

test("HIGH #1. createdBySa360 is never read from request input", () => {
  const service = readFileSync(join(here, "google-sheets-destination.service.ts"), "utf8");
  const route = readFileSync(join(here, "../../routes/integrations-google.ts"), "utf8");
  // No save path may read provenance, `enabled`, or `isRequired` off the request.
  assert.equal(/input\.createdBySa360/.test(service), false);
  assert.equal(/body\.createdBySa360/.test(route), false);
  assert.equal(/body\.enabled/.test(route), false);
  assert.equal(/body\.isRequired/.test(route), false);
});
