import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { buildClientInventoryStateAvailability } from "./lead-inventory-client-state-availability.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

/**
 * Proves the live SQL aggregate path (not a stub) produces bucketed,
 * client-safe state labels for the portal map read model.
 */
describe("client state availability integration", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const nicheKey = "vet_state_availability_probe";
  const lotKey = "state-availability-probe-lot";
  const DAY_MS = 86_400_000;

  const seeds = [
    // 6 available WY items → "Available" (>= 5)
    ...Array.from({ length: 6 }, (_, i) => ({ idx: i, state: "WY", available: true })),
    // 2 available VT items → "Limited" (< 5)
    ...Array.from({ length: 2 }, (_, i) => ({ idx: 10 + i, state: "VT", available: true })),
    // 1 ME item that is reserved → must not count as available
    { idx: 20, state: "ME", available: false },
  ];

  const itemId = (idx: number) => `inv-state-avail-probe-${idx}`;
  const eventId = (idx: number) => `evt-state-avail-probe-${idx}`;
  const leadUid = (idx: number) => `lead-state-avail-probe-${idx}`;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });

    const lot = await db.inventoryLot.upsert({
      where: { lotKey },
      create: {
        lotKey,
        displayName: "State availability probe lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        nicheKey,
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: "supplier_state_avail_probe",
        status: "active",
        activatedAt: new Date(),
      },
      update: { status: "active", nicheKey },
    });

    for (const seed of seeds) {
      const payload = {
        contact: {
          first_name: "Map",
          last_name: `Probe${seed.idx}`,
          phone_e164: `+1555420${String(seed.idx).padStart(4, "0")}`,
          email: `state.avail.probe.${seed.idx}@example.test`,
          state: seed.state,
        },
      };
      await db.sourceLeadEvent.upsert({
        where: { id: eventId(seed.idx) },
        create: {
          id: eventId(seed.idx),
          sourceProvider: "manual_import",
          sourceSystem: "leadcapture_io_legacy",
          sourceType: "manual_entry",
          sourceLeadId: `state-avail-src-${seed.idx}`,
          sourceLeadUid: leadUid(seed.idx),
          status: "approved",
          rawPayloadJson: payload,
          normalizedPayloadJson: payload,
          receivedAt: new Date(Date.now() - 120 * DAY_MS),
          normalizedAt: new Date(),
          approvedAt: new Date(),
        },
        update: { status: "approved", sourceLeadUid: leadUid(seed.idx) },
      });
      await db.leadVerificationResult.upsert({
        where: { leadUid: leadUid(seed.idx) },
        create: {
          leadUid: leadUid(seed.idx),
          verificationStatus: "PASSED",
          duplicateStatus: "UNIQUE",
          checkedAt: new Date(),
        },
        update: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
      });
      await db.leadAllocation.deleteMany({ where: { leadInventoryItemId: itemId(seed.idx) } });
      await db.leadInventoryItem.upsert({
        where: { id: itemId(seed.idx) },
        create: {
          id: itemId(seed.idx),
          inventoryLotId: lot.id,
          sourceLeadEventId: eventId(seed.idx),
          generatedAt: new Date(Date.now() - 120 * DAY_MS),
          normalizedState: seed.state,
          nicheKey,
          sourceProvider: "manual_import",
          sourceLane: "aged_csv_beta",
          inventoryClass: "aged",
          exclusivityMode: "exclusive",
          status: seed.available ? "available" : "reserved",
          availableAt: new Date(),
        },
        update: {
          status: seed.available ? "available" : "reserved",
          inventoryLotId: lot.id,
          normalizedState: seed.state,
          nicheKey,
          commerceExcludedAt: null,
          quarantineReason: null,
          withdrawnAt: null,
          expiredAt: null,
          fulfillmentCount: 0,
        },
      });
    }
  });

  after(async () => {
    if (!db) return;
    await db.leadInventoryItem.deleteMany({ where: { nicheKey } });
    await db.leadVerificationResult.deleteMany({
      where: { leadUid: { in: seeds.map((seed) => leadUid(seed.idx)) } },
    });
    await db.sourceLeadEvent.deleteMany({
      where: { id: { in: seeds.map((seed) => eventId(seed.idx)) } },
    });
    await db.inventoryLot.deleteMany({ where: { lotKey } });
    await db.$disconnect();
  });

  it("buckets live supply per state without exposing counts", async () => {
    const model = await buildClientInventoryStateAvailability(
      { clientAccountId: "client_state_avail_probe", nicheKey },
      db
    );

    assert.equal(model.dataStatus, "live");
    assert.equal(model.advisory, true);
    assert.equal(model.states.length, 51);

    const label = (code: string) =>
      model.states.find((row) => row.stateCode === code)?.availabilityLabel;
    assert.equal(label("WY"), "Available");
    assert.equal(label("VT"), "Limited");
    assert.equal(label("ME"), "Currently unavailable");
    assert.equal(label("TX"), "Currently unavailable");

    const serialized = JSON.stringify(model);
    assert.equal(serialized.includes("\"available\":"), false);
    assert.equal(serialized.includes("\"total\":"), false);
    assert.equal(serialized.includes("inv-state-avail-probe"), false);
  });

  it("a non-matching niche yields an all-unavailable live map", async () => {
    const model = await buildClientInventoryStateAvailability(
      { clientAccountId: "client_state_avail_probe", nicheKey: `${nicheKey}_none` },
      db
    );
    assert.equal(model.dataStatus, "live");
    assert.equal(model.summary["Currently unavailable"], 51);
    assert.equal(model.summary.Available, 0);
  });
});
