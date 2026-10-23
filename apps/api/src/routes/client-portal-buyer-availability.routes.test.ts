import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_US_STATE_CODES, type CommerceAgeBucketKey } from "@sa360/shared";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { clientPortalRoutes } from "./client-portal.js";
import type { BuyerInventoryAvailabilityResult } from "../services/ppl-fulfillment/buyer-inventory-availability.service.js";

const PREFIX = "/client/v1";
const PRICED_KEYS = [
  "COMMERCE_1_3_MO",
  "COMMERCE_3_6_MO",
  "COMMERCE_6_9_MO",
  "COMMERCE_9_12_MO",
  "COMMERCE_12_MO_PLUS",
] as const satisfies readonly CommerceAgeBucketKey[];

function portalPrisma(portalEnabled = true) {
  const row = {
    clientAccountId: "buyer-a",
    clientDisplayName: "Buyer A",
    portalEnabled,
    portalDisplayName: null,
    portalLoginEmail: "buyer@example.test",
    portalPasswordHash: null,
    portalPasswordSetAt: null,
    portalSessionEpoch: 0,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: null,
  };
  const base = createEmptyPrismaMock();
  return {
    ...base,
    clientAccount: {
      findUnique: async ({ where }: { where: { clientAccountId?: string } }) =>
        where.clientAccountId === "buyer-a" ? row : null,
      findFirst: async () => row,
    },
  };
}

async function buildApp(
  lookup: (input: {
    clientAccountId: string;
    nicheKey: string;
    states: readonly string[];
    commerceAgeBucketKeys?: readonly string[];
  }) => Promise<BuyerInventoryAvailabilityResult>
) {
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: portalPrisma() as never },
    lookupBuyerInventoryAvailabilityImpl: lookup as never,
  });
  return app;
}

function readyReport(key: CommerceAgeBucketKey): BuyerInventoryAvailabilityResult {
  return {
    ok: true,
    policyVersion: "buyer-inventory-availability-v1",
    readOnly: true,
    effects: {
      orderCreated: false,
      reservationCreated: false,
      deliveryRecorded: false,
      csvGenerated: false,
      sourceDataMutated: false,
    },
    evaluatedAt: "2026-10-22T18:00:00.000Z",
    snapshot: {
      isolation: "repeatable_read",
      consistent: true,
      readOnly: true,
      scope: "transaction_start",
    },
    buyer: { clientAccountId: "buyer-a", clientDisplayName: "Buyer A" },
    nicheKey: "trucker",
    states: [...CANONICAL_US_STATE_CODES],
    requestedCommerceAgeBucketKeys: [key],
    allAgedTiers: false,
    queryCompleteness: "complete",
    eligibleCountSemantics: "exact",
    eligibleTotal: 2,
    ageTiers: [],
    eligibleByState: [
      { state: "TX", eligible: 2, countSemantics: "exact" },
      { state: "FL", eligible: 0, countSemantics: "exact" },
    ],
    structuralCohort: {
      countSemantics: "exact",
      rows: 2,
      availableActiveLot: 2,
      reserved: 0,
      committed: 0,
      commerceExcluded: 0,
      openAllocationOnAvailable: 0,
      stampedSameOrigin: 0,
      stampedOtherOrigin: 2,
      unstampedSelectable: 0,
      unstampedNotReconcilable: 0,
    },
    exclusionReasons: {} as never,
    provenance: {
      stampedConfirmed: 2,
      reconciledFromSourceFunnel: 0,
      unresolvedOrigin: 0,
      unresolvedReasons: {},
      unstampedNotClassified: 0,
      coverageNote: "test",
    },
    scan: {
      rowsClassified: 2,
      pagesRead: 1,
      selectableRowsExact: 2,
      rowsUnclassified: 0,
      classificationCeiling: 100000,
      ceilingHit: false,
      selectionScanCeiling: 5000,
      usesSelectionRowCap: false,
    },
    summary: "Exact buyer-eligible count is 2.",
  };
}

function withPortalEnv(flag: string | undefined, run: () => Promise<void>) {
  const prevKey = process.env.CLIENT_PORTAL_API_KEY;
  const prevFlag = process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  if (flag === undefined) delete process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
  else process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = flag;
  return run().finally(() => {
    if (prevKey === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
    else process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = prevFlag;
  });
}

test("portal buyer availability stays disabled until the lookup flag is on", async () => {
  await withPortalEnv(undefined, async () => {
    let calls = 0;
    const app = await buildApp(async () => {
      calls += 1;
      return readyReport("COMMERCE_6_9_MO");
    });
    const res = await app.inject({
      method: "POST",
      url: `${PREFIX}/buyer-inventory-availability`,
      headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
      payload: {
        clientAccountId: "buyer-a",
        nicheKey: "trucker",
        commerceAgeBucketKey: "COMMERCE_6_9_MO",
        states: [...CANONICAL_US_STATE_CODES],
      },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "buyer_inventory_availability_disabled");
    assert.equal(calls, 0);
    await app.close();
  });
});

test("portal buyer availability queries each priced range directly and rejects 6–12", async () => {
  await withPortalEnv("true", async () => {
    const seen: Array<{ clientAccountId: string; states: readonly string[]; buckets: unknown }> = [];
    const app = await buildApp(async (input) => {
      seen.push({
        clientAccountId: input.clientAccountId,
        states: input.states,
        buckets: input.commerceAgeBucketKeys,
      });
      const key = input.commerceAgeBucketKeys?.[0];
      if (key !== "COMMERCE_1_3_MO" && key !== "COMMERCE_3_6_MO" && key !== "COMMERCE_6_9_MO" && key !== "COMMERCE_9_12_MO" && key !== "COMMERCE_12_MO_PLUS") {
        throw new Error(`unexpected bucket ${String(key)}`);
      }
      return readyReport(key);
    });
    const partial = await app.inject({
      method: "POST",
      url: `${PREFIX}/buyer-inventory-availability`,
      headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
      payload: {
        clientAccountId: "buyer-a",
        nicheKey: "trucker",
        commerceAgeBucketKey: "COMMERCE_6_9_MO",
        states: ["TX"],
      },
    });
    assert.equal(partial.statusCode, 400);
    assert.equal(partial.json().error, "invalid_states");
    assert.equal(seen.length, 0);

    const legacy = await app.inject({
      method: "POST",
      url: `${PREFIX}/buyer-inventory-availability`,
      headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
      payload: {
        clientAccountId: "buyer-a",
        nicheKey: "trucker",
        commerceAgeBucketKey: "COMMERCE_6_12_MO",
        states: [...CANONICAL_US_STATE_CODES],
      },
    });
    assert.equal(legacy.statusCode, 400);
    assert.equal(legacy.json().error, "invalid_age_buckets");
    assert.equal(seen.length, 0);

    for (const key of PRICED_KEYS) {
      const res = await app.inject({
        method: "POST",
        url: `${PREFIX}/buyer-inventory-availability`,
        headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
        payload: {
          clientAccountId: "buyer-a",
          nicheKey: "trucker",
          commerceAgeBucketKey: key,
          states: [...CANONICAL_US_STATE_CODES],
        },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.clientAccountId, "buyer-a");
      assert.equal(body.commerceAgeBucketKey, key);
      assert.equal(body.effects.reservationCreated, false);
      assert.equal(body.eligibleByState[0].eligible, 2);
    }
    assert.deepEqual(
      seen.map((row) => row.buckets),
      PRICED_KEYS.map((key) => [key])
    );
    assert.equal(seen.every((row) => row.clientAccountId === "buyer-a"), true);
    assert.equal(
      seen.every((row) => row.states.length === CANONICAL_US_STATE_CODES.length),
      true
    );
    await app.close();
  });
});
