import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { listSourceLeadEvents } from "./source-lead-event.repository.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const prefix = `live-failure-list-${Date.now()}-`;

describe("live delivery failure list", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    const live = Array.from({ length: 201 }, (_, index) => ({
      sourceProvider: "leadcapture_io" as const,
      sourceSystem: "leadcapture_io_nextgen" as const,
      sourceType: "webhook" as const,
      sourceLeadUid: `${prefix}live-${String(index).padStart(3, "0")}`,
      status: "delivery_failed" as const,
      rawPayloadJson: { marker: prefix },
      deliveryResultJson: { mode: "live_canary", externalCallExecuted: true },
      receivedAt: new Date(Date.UTC(2026, 10, 12, 12, 0, 0, index)),
    }));
    await db.sourceLeadEvent.createMany({
      data: [
        ...live,
        {
          sourceProvider: "leadcapture_io",
          sourceSystem: "leadcapture_io_nextgen",
          sourceType: "webhook",
          sourceLeadUid: `${prefix}simulate`,
          status: "delivery_failed",
          bulkImportId: null,
          rawPayloadJson: { marker: prefix },
          deliveryResultJson: { mode: "simulate", externalCallExecuted: false },
          receivedAt: new Date("2026-11-12T18:00:00.000Z"),
        },
        {
          sourceProvider: "leadcapture_io",
          sourceSystem: "leadcapture_io_nextgen",
          sourceType: "webhook",
          sourceLeadUid: `${prefix}missing`,
          status: "delivery_failed",
          rawPayloadJson: { marker: prefix },
          deliveryResultJson: undefined,
          receivedAt: new Date("2026-11-12T18:01:00.000Z"),
        },
        {
          sourceProvider: "leadcapture_io",
          sourceSystem: "leadcapture_io_nextgen",
          sourceType: "webhook",
          sourceLeadUid: `${prefix}delivered`,
          status: "delivered",
          rawPayloadJson: { marker: prefix },
          deliveryResultJson: { mode: "live_canary", externalCallExecuted: true },
          receivedAt: new Date("2026-11-12T18:02:00.000Z"),
        },
      ],
    });
  });

  after(async () => {
    if (!db) return;
    await db.sourceLeadEvent.deleteMany({ where: { sourceLeadUid: { startsWith: prefix } } });
    await db.$disconnect();
  });

  it("pages every proven live failure and leaves simulate-only rows out", async () => {
    const first = await listSourceLeadEvents(
      { liveExternalFailure: true, limit: 200 },
      db
    );
    assert.equal(first.items.length, 200);
    assert.ok(first.nextCursor);
    assert.equal(
      first.items.some((row) => row.sourceLeadUid === `${prefix}simulate`),
      false
    );
    assert.equal(
      first.items.some((row) => row.sourceLeadUid === `${prefix}missing`),
      false
    );
    assert.equal(
      first.items.some((row) => row.sourceLeadUid === `${prefix}delivered`),
      false
    );

    const second = await listSourceLeadEvents(
      { liveExternalFailure: true, limit: 200, cursor: first.nextCursor ?? undefined },
      db
    );
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    const seen = new Set(
      [...first.items, ...second.items].map((row) => row.sourceLeadUid)
    );
    assert.equal(seen.size, 201);
    assert.equal(seen.has(`${prefix}simulate`), false);
    assert.equal(seen.has(`${prefix}missing`), false);
    for (let index = 0; index < 201; index += 1) {
      assert.equal(seen.has(`${prefix}live-${String(index).padStart(3, "0")}`), true);
    }
  });
});
