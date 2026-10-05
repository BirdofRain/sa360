import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { CANONICAL_US_STATE_CODES } from "@sa360/shared";

import { createEmptyPrismaMock } from "../../test/empty-prisma-mock.js";
import { DEFAULT_AGE_BANDS_V1 } from "./lead-inventory.constants.js";
import { adaptPortalNicheKeyForInventoryFilter } from "./client-state-availability-niche.adapter.js";
import {
  buildClientInventoryStateAvailability,
  projectClientStateAvailability,
  type ClientStateAvailabilityDeps,
} from "./lead-inventory-client-state-availability.service.js";

type AggregateArgs = Parameters<NonNullable<ClientStateAvailabilityDeps["aggregateImpl"]>>;

function stubAggregate(
  rows: Array<{ state: string; available: number }>,
  onCall?: (args: AggregateArgs) => void
): NonNullable<ClientStateAvailabilityDeps["aggregateImpl"]> {
  return async (...args) => {
    onCall?.(args);
    return {
      rows: rows.map((row) => ({
        state: row.state,
        age_band_key: "AGED_91_180",
        total: BigInt(row.available),
        available: BigInt(row.available),
        reserved: 0n,
        blocked: 0n,
      })),
      queryCount: 1,
    };
  };
}

const listAgeBandsImpl = async () => DEFAULT_AGE_BANDS_V1;
const db = createEmptyPrismaMock() as PrismaClient;

test("projection buckets per-state supply and emits every canonical state", () => {
  const { states, summary } = projectClientStateAvailability([
    { state: "TX", available: 7n },
    { state: "TX", available: 5 },
    { state: "NC", available: 3n },
    { state: "ZZ", available: 99n },
    { state: "", available: 4n },
  ]);

  assert.equal(states.length, CANONICAL_US_STATE_CODES.length);
  const byCode = new Map(states.map((row) => [row.stateCode, row.availabilityLabel]));
  assert.equal(byCode.get("TX"), "Available");
  assert.equal(byCode.get("NC"), "Limited");
  assert.equal(byCode.get("WY"), "Currently unavailable");
  assert.equal(byCode.has("ZZ" as never), false);
  assert.deepEqual(summary, {
    Available: 1,
    Limited: 1,
    "Currently unavailable": CANONICAL_US_STATE_CODES.length - 2,
  });
});

test("live read model is advisory, bucketed, and leaks no counts, ids, or prices", async () => {
  let seenArgs: AggregateArgs | null = null;
  const model = await buildClientInventoryStateAvailability(
    { clientAccountId: "acct_a", nicheKey: " vet ", productType: "exclusive" },
    db,
    {
      listAgeBandsImpl,
      aggregateImpl: stubAggregate(
        [
          { state: "TX", available: 40 },
          { state: "FL", available: 2 },
        ],
        (args) => {
          seenArgs = args;
        }
      ),
      now: () => new Date("2026-10-05T12:00:00.000Z"),
    }
  );

  assert.equal(model.dataStatus, "live");
  assert.equal(model.advisory, true);
  assert.equal(model.catalogScope, "global_lal_inventory");
  assert.equal(model.evaluatedAt, "2026-10-05T12:00:00.000Z");
  assert.deepEqual(model.filters, { nicheKey: "vet", productType: "exclusive" });
  assert.equal(model.states.length, CANONICAL_US_STATE_CODES.length);

  const tx = model.states.find((row) => row.stateCode === "TX");
  const fl = model.states.find((row) => row.stateCode === "FL");
  assert.equal(tx?.availabilityLabel, "Available");
  assert.equal(fl?.availabilityLabel, "Limited");

  const serialized = JSON.stringify(model);
  for (const forbidden of [
    "\"available\":",
    "\"total\":",
    "\"reserved\":",
    "\"blocked\":",
    "unitPriceCents",
    "internalValueCents",
    "acquisitionCostCents",
    "inventoryItemId",
    "sourceLeadEventId",
    "exactCellDemand",
    "40",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `payload leaked ${forbidden}`);
  }

  assert.ok(seenArgs);
  const [, filters, ageBands, evaluatedAt] = seenArgs as unknown as AggregateArgs;
  assert.deepEqual(filters, { nicheKey: "vet", productType: "exclusive", status: "available" });
  assert.equal(ageBands, DEFAULT_AGE_BANDS_V1);
  assert.equal(evaluatedAt.toISOString(), "2026-10-05T12:00:00.000Z");
});

test("omitted niche and product type leave the aggregate unfiltered", async () => {
  let seenFilters: unknown = null;
  const model = await buildClientInventoryStateAvailability({ clientAccountId: "acct_a" }, db, {
    listAgeBandsImpl,
    aggregateImpl: stubAggregate([], (args) => {
      seenFilters = args[1];
    }),
  });
  assert.deepEqual(seenFilters, { nicheKey: undefined, productType: undefined, status: "available" });
  assert.deepEqual(model.filters, { nicheKey: null, productType: null });
  assert.equal(model.summary["Currently unavailable"], CANONICAL_US_STATE_CODES.length);
});

test("aggregate failure degrades to unavailable without synthesizing zero states", async () => {
  const model = await buildClientInventoryStateAvailability(
    { clientAccountId: "acct_a", nicheKey: "vet" },
    db,
    {
      listAgeBandsImpl,
      aggregateImpl: async () => {
        throw new Error("boom");
      },
    }
  );
  assert.equal(model.dataStatus, "unavailable");
  assert.deepEqual(model.states, []);
  assert.deepEqual(model.summary, { Available: 0, Limited: 0, "Currently unavailable": 0 });
  assert.equal(model.advisory, true);
});

test("aggregate timeout degrades to unavailable", async () => {
  const model = await buildClientInventoryStateAvailability(
    { clientAccountId: "acct_a" },
    db,
    {
      listAgeBandsImpl,
      timeoutMs: 5,
      aggregateImpl: (_db, _filters, _bands, _at, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve({ rows: [], queryCount: 0 }), {
            once: true,
          });
        }),
    }
  );
  assert.equal(model.dataStatus, "unavailable");
  assert.deepEqual(model.states, []);
});

test("temporary niche adapter is a trimmed pass-through (no alias normalization here)", () => {
  assert.equal(adaptPortalNicheKeyForInventoryFilter(undefined), undefined);
  assert.equal(adaptPortalNicheKeyForInventoryFilter("   "), undefined);
  assert.equal(adaptPortalNicheKeyForInventoryFilter(" vet_fex "), "vet_fex");
  assert.equal(adaptPortalNicheKeyForInventoryFilter("VET"), "VET");
});
