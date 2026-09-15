import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../../../");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationsDir = join(repoRoot, "prisma/migrations");
const foundationMigration = join(
  migrationsDir,
  "20260915180000_google_account_connection_foundation/migration.sql"
);

const PARTIAL_INDEX = "GoogleAccountConnection_googleUserId_active_key";

test("Google partial unique index is SQL-only and must not be dropped by later migrations", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const modelStart = schema.indexOf("model GoogleAccountConnection");
  assert.ok(modelStart >= 0);
  const modelEnd = schema.indexOf("\nmodel ", modelStart + 1);
  const model = schema.slice(modelStart, modelEnd === -1 ? undefined : modelEnd);
  assert.equal(model.includes("@@unique([googleUserId])"), false);
  assert.match(model, /@default\(disconnected\)/);

  const sql = readFileSync(foundationMigration, "utf8");
  const ddl = sql.replace(/--.*$/gm, "");
  assert.match(sql, /CREATE UNIQUE INDEX "GoogleAccountConnection_googleUserId_active_key"/);
  assert.match(sql, /WHERE "googleUserId" IS NOT NULL/);
  assert.match(sql, /'connected',[\s\n]*'reconnect_required',[\s\n]*'error'/);
  assert.match(sql, /DEFAULT 'disconnected'/);
  assert.doesNotMatch(ddl, /ALTER TABLE "ClientAccount"/);
  assert.doesNotMatch(ddl, /GhlLocationConnection/);
  assert.doesNotMatch(ddl, /DeliveryTarget/);
  assert.doesNotMatch(ddl, /LeadInventoryItem/);
  assert.doesNotMatch(ddl, /SourceLeadEvent/);
  assert.doesNotMatch(ddl, /backupSheet/);

  const later = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > "20260915180000_google_account_connection_foundation")
    .map((entry) => entry.name);
  for (const name of later) {
    const laterSql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    assert.equal(
      laterSql.includes(`DROP INDEX`) && laterSql.includes(PARTIAL_INDEX),
      false,
      `${name} must not drop ${PARTIAL_INDEX}`
    );
  }
});
