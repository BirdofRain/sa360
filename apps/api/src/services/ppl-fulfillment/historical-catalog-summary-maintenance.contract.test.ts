/**
 * Static contract for the Gate 12 maintenance candidate.
 * These files must stay out of prisma/migrations. Nothing in application
 * code calls them. Fault-injection switches stay out of the candidate SQL.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { candidateDir, repoRoot } from "./historical-catalog-summary-maintenance.harness.js";

const functionsSql = readFileSync(join(candidateDir, "functions.sql"), "utf8");
const triggersSql = readFileSync(join(candidateDir, "triggers.sql"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe("historical catalog summary maintenance contract", () => {
  it("keeps functions and triggers in separate inert files", () => {
    assert.equal(/^CREATE TRIGGER/m.test(functionsSql), false);
    assert.equal(/^CREATE FUNCTION/m.test(triggersSql), false);
    assert.equal(/^CREATE PROCEDURE/m.test(triggersSql), false);
    const triggerNames = [...triggersSql.matchAll(/^CREATE TRIGGER (\S+)/gm)].map((match) => match[1]);
    assert.deepEqual(triggerNames, [
      "historical_catalog_summary_item_apply",
      "historical_catalog_summary_event_apply",
      "historical_catalog_summary_lot_invalidate",
    ]);
    for (const statement of triggersSql.split(/^CREATE TRIGGER /m).slice(1)) {
      const body = statement.split(";")[0];
      assert.equal(/ON\s+historical_catalog_projection\b/.test(body), false);
      assert.equal(/ON\s+"historical_catalog_projection"/.test(body), false);
    }
  });

  it("has no fault-injection switch in the release candidate", () => {
    for (const sql of [functionsSql, triggersSql]) {
      assert.equal(sql.includes("sa360.summary_fail"), false);
      assert.equal(sql.includes("sa360.summary_attempts"), false);
      assert.equal(sql.includes("current_setting('sa360"), false);
      assert.equal(sql.includes("g12."), false);
    }
  });

  it("does not write inventory or projection rows from summary functions", () => {
    for (const line of functionsSql.split("\n")) {
      assert.equal(/^\s*UPDATE\s+"LeadInventoryItem"\b/.test(line), false, line);
      assert.equal(/^\s*UPDATE\s+"SourceLeadEvent"\b/.test(line), false, line);
      assert.equal(/^\s*UPDATE\s+"InventoryLot"\b/.test(line), false, line);
      assert.equal(/^\s*UPDATE\s+historical_catalog_projection\b/.test(line), false, line);
      assert.equal(/^\s*INSERT\s+INTO\s+historical_catalog_projection\b/.test(line), false, line);
      assert.equal(/^\s*DELETE\s+FROM\s+historical_catalog_projection\b/.test(line), false, line);
    }
    const lotStart = functionsSql.indexOf("CREATE FUNCTION historical_catalog_summary_lot_trg");
    const lotEnd = functionsSql.indexOf("CREATE FUNCTION historical_catalog_summary_backfill_chunk");
    const lot = functionsSql.slice(lotStart, lotEnd);
    assert.equal(lot.includes("apply_items"), false);
    assert.equal(lot.includes("historical_catalog_projection"), false);
    assert.match(lot, /historical_catalog_summary_mark_unready\('lot_key_rename', false\)/);
  });

  it("is not an executable migration and is not called by application code", () => {
    const migrationRoot = join(repoRoot, "prisma/migrations");
    for (const path of walk(migrationRoot)) {
      if (!path.endsWith(".sql")) continue;
      const sql = readFileSync(path, "utf8");
      assert.equal(sql.includes("historical_catalog_summary_apply"), false, path);
      assert.equal(sql.includes("historical_catalog_summary_item_trg"), false, path);
      assert.equal(sql.includes("historical_catalog_summary_authorize"), false, path);
      assert.equal(sql.includes("historical_catalog_summary_backfill"), false, path);
    }
    const roots = [join(repoRoot, "apps"), join(repoRoot, "packages")];
    for (const root of roots) {
      for (const path of walk(root)) {
        if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
        if (path.endsWith(".test.ts")) continue;
        if (path.endsWith("historical-catalog-summary-maintenance.harness.ts")) continue;
        const source = readFileSync(path, "utf8");
        assert.equal(source.includes("historical_catalog_summary_apply"), false, path);
        assert.equal(source.includes("historical_catalog_summary_authorize"), false, path);
        assert.equal(source.includes("historical-catalog-summary-maintenance-v1"), false, path);
      }
    }
  });
});
