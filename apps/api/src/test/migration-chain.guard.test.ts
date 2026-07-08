import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "../../../..");

test("client ghl option-map migrations are guarded and reconciled", () => {
  const early = readFileSync(
    join(
      repoRoot,
      "prisma/migrations/20260601120000_client_ghl_custom_field_option_map/migration.sql",
    ),
    "utf8",
  );
  const reconcile = readFileSync(
    join(
      repoRoot,
      "prisma/migrations/20260601170000_reconcile_client_ghl_destination_option_map/migration.sql",
    ),
    "utf8",
  );

  for (const sql of [early, reconcile]) {
    assert.match(sql, /DO \$\$/);
    assert.match(sql, /ClientGhlDestination/);
    assert.match(sql, /sa360CustomFieldOptionMapJson/);
    assert.match(sql, /information_schema\.tables/);
    assert.match(sql, /information_schema\.columns/);
  }

  assert.match(early, /20260601161852_add_client_onboarding_models/);
  assert.match(reconcile, /20260601120000/);
});
