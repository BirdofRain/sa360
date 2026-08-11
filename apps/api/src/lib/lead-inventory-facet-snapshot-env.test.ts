import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getLeadInventoryFacetSnapshotMaxAgeMinutes,
  getLeadInventoryFacetSnapshotRebuildIntervalMinutes,
  getLeadInventoryFacetSnapshotStaleWarnMinutes,
  isLeadInventoryFacetSnapshotReadEnabled,
  isLeadInventoryFacetSnapshotRebuildEnabled,
  isLeadInventoryFacetSnapshotShadowEnabled,
} from "./lead-inventory-facet-snapshot-env.js";

const KEYS = [
  "SA360_LEAD_INVENTORY_FACET_SNAPSHOT_READ_ENABLED",
  "SA360_LEAD_INVENTORY_FACET_SNAPSHOT_SHADOW_ENABLED",
  "SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_ENABLED",
  "SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_INTERVAL_MINUTES",
  "SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES",
  "SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES",
] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of KEYS) {
    previous.set(key, process.env[key]);
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("snapshot feature flags default off", () => {
  withEnv({}, () => {
    assert.equal(isLeadInventoryFacetSnapshotReadEnabled(), false);
    assert.equal(isLeadInventoryFacetSnapshotShadowEnabled(), false);
    assert.equal(isLeadInventoryFacetSnapshotRebuildEnabled(), false);
  });
});

test("snapshot feature flags accept truthy forms", () => {
  withEnv(
    {
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_READ_ENABLED: "true",
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_SHADOW_ENABLED: "1",
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_ENABLED: "ON",
    },
    () => {
      assert.equal(isLeadInventoryFacetSnapshotReadEnabled(), true);
      assert.equal(isLeadInventoryFacetSnapshotShadowEnabled(), true);
      assert.equal(isLeadInventoryFacetSnapshotRebuildEnabled(), true);
    }
  );
});

test("snapshot interval and freshness bounds use safe defaults", () => {
  withEnv({}, () => {
    assert.equal(getLeadInventoryFacetSnapshotRebuildIntervalMinutes(), 15);
    assert.equal(getLeadInventoryFacetSnapshotMaxAgeMinutes(), 30);
    assert.equal(getLeadInventoryFacetSnapshotStaleWarnMinutes(), 15);
  });

  withEnv(
    {
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_INTERVAL_MINUTES: "2",
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES: "99999",
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES: "abc",
    },
    () => {
      assert.equal(getLeadInventoryFacetSnapshotRebuildIntervalMinutes(), 15);
      assert.equal(getLeadInventoryFacetSnapshotMaxAgeMinutes(), 30);
      assert.equal(getLeadInventoryFacetSnapshotStaleWarnMinutes(), 15);
    }
  );

  withEnv(
    {
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_INTERVAL_MINUTES: "60",
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES: "90",
      SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES: "45",
    },
    () => {
      assert.equal(getLeadInventoryFacetSnapshotRebuildIntervalMinutes(), 60);
      assert.equal(getLeadInventoryFacetSnapshotMaxAgeMinutes(), 90);
      assert.equal(getLeadInventoryFacetSnapshotStaleWarnMinutes(), 45);
    }
  );
});
