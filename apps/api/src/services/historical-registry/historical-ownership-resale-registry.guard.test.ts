import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CLIENT_IDENTITY_REFERENCE_UPDATES } from "../client/client-rekey-references.js";

const repoRoot = join(import.meta.dirname, "../../../../../");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20261019220000_historical_ownership_resale_registry_v1/migration.sql"
);
const schemaPath = join(repoRoot, "prisma/schema.prisma");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) found.push(path);
  }
  return found;
}

test("registry migration is additive and leaves inventory tables alone", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  assert.match(sql, /CREATE TABLE "HistoricalCampaignAlias"/);
  assert.match(sql, /CREATE TABLE "HistoricalCampaignAliasEvent"/);
  assert.match(sql, /CREATE TABLE "HistoricalResaleAuthorization"/);
  assert.match(sql, /CREATE TABLE "HistoricalResaleAuthorizationEvent"/);
  assert.match(sql, /HistoricalResaleAuthorization_one_live_scope_key/);
  assert.match(sql, /historical_campaign_ownership_decision/);
  assert.match(sql, /historical_resale_authorization_decision/);
  assert.match(sql, /historical registry events are append-only/);
  assert.match(sql, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|INDEX|FUNCTION|TRIGGER|TYPE|CONSTRAINT|SCHEMA)\b/i);
  assert.doesNotMatch(sql, /\bINSERT INTO\b/i);
  assert.doesNotMatch(sql, /\bDELETE FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+"/i);
  assert.doesNotMatch(sql, /\bBYTEA\b/i);
  for (const table of [
    "LeadInventoryItem",
    "InventoryLot",
    "LeadAllocation",
    "LeadOrder",
    "LeadOrderLine",
    "SourceLeadEvent",
    "BuyerDeliveredIdentity",
    "LeadInventoryImportBatch",
    "AgedInventorySourceSnapshot",
  ]) {
    assert.equal(sql.includes(`ALTER TABLE "${table}"`), false, table);
    assert.equal(sql.includes(`UPDATE "${table}"`), false, table);
  }

  const inventory = schema.slice(schema.indexOf("model LeadInventoryItem {"));
  const inventoryModel = inventory.slice(0, inventory.indexOf("\nmodel "));
  assert.match(inventoryModel, /originClientAccountId String\?/);
  assert.equal(inventoryModel.includes("originClientAccountId2"), false);
  assert.equal(schema.includes("model HistoricalCampaignAlias {"), true);
  assert.equal(schema.includes("exclusivityMode"), true);
  const resale = schema.slice(schema.indexOf("model HistoricalResaleAuthorization {"));
  const resaleModel = resale.slice(0, resale.indexOf("\nmodel "));
  for (const forbidden of ["exclusivityMode", "acquisitionCostCents", "usedBy", "campaignName"]) {
    assert.equal(resaleModel.includes(forbidden), false, forbidden);
  }
});

test("client rekey does not rewrite historical registry foreign keys", () => {
  const keys = CLIENT_IDENTITY_REFERENCE_UPDATES.map((ref) => ref.key);
  for (const key of keys) {
    assert.equal(key.startsWith("HistoricalCampaignAlias"), false, key);
    assert.equal(key.startsWith("HistoricalResaleAuthorization"), false, key);
  }
});

test("client portal sources do not read registry evidence", () => {
  const files = [
    join(repoRoot, "apps/api/src/routes/client-portal.ts"),
    join(repoRoot, "apps/api/src/services/client-portal-tenant.service.ts"),
    join(repoRoot, "apps/api/src/repositories/client-account.repository.ts"),
    join(repoRoot, "apps/api/src/app.ts"),
    ...walk(join(repoRoot, "apps/admin-coc/src/app/portal")),
    ...walk(join(repoRoot, "apps/admin-coc/src/components/client-portal")),
    ...walk(join(repoRoot, "apps/admin-coc/src/client-portal")),
  ];
  const forbidden = [
    "HistoricalCampaignAlias",
    "HistoricalResaleAuthorization",
    "evidenceReference",
    "verificationDetails",
    "historical_campaign_ownership_decision",
    "historical_resale_authorization_decision",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const term of forbidden) {
      assert.equal(source.includes(term), false, `${file} contains ${term}`);
    }
  }
});
