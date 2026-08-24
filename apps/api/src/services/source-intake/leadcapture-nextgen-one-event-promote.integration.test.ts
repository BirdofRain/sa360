import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { parseDatabaseTarget } from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import {
  NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION,
  NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM,
  NEXTGEN_ONE_EVENT_PROMOTE_STAGE,
  promoteOneLeadCaptureNextGenSourceEvent,
} from "./leadcapture-nextgen-one-event-promote.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");

function loadNurseFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(fixtureDir, "leadcaptureio-webhook-sample-nextgen-nurse.json"), "utf8")
  ) as Record<string, unknown>;
}

function uniqueNursePayload(): Record<string, unknown> {
  const leadId = randomUUID();
  return {
    ...loadNurseFixture(),
    lead_id: leadId,
    email: `promote.${leadId}@example.test`,
    phone: `55501${String(Math.floor(10000 + Math.random() * 89999))}`,
  };
}

describe("NextGen one-event promote integration", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const previousStage = process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = "capture_only";
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (previousStage === undefined) delete process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
    else process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = previousStage;
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db?.$disconnect();
  });

  it("promotes one capture-only event on the local test DB and refuses the second run", async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const dbIdentity = parseDatabaseTarget(url);
    const payload = uniqueNursePayload();

    const captured = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload,
      stageOverride: "capture_only",
    });
    createdEventIds.push(captured.sourceEventId);
    assert.equal(captured.status, "received");

    const args = {
      sourceEventId: captured.sourceEventId,
      stage: NEXTGEN_ONE_EVENT_PROMOTE_STAGE,
      expectedSourceSystem: NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM,
      expectedRoute: String(payload.sa360_route_key),
      expectedLeadId: String(payload.lead_id),
      expectedDbHost: dbIdentity.host,
      operator: "test-operator",
      confirm: NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION,
      databaseUrl: url,
    };

    const promoted = await promoteOneLeadCaptureNextGenSourceEvent(args, { prisma: db });
    createdEventIds.push(promoted.after?.sourceEventId ?? captured.sourceEventId);

    assert.equal(promoted.outcome, "PROMOTED");
    assert.equal(promoted.after?.sourceEventId, captured.sourceEventId);
    assert.equal(promoted.after?.normalizedPayloadPresent, true);
    assert.equal(promoted.after?.associatedInventoryCount, 1);
    assert.equal(promoted.after?.sourceIdentityInventoryCount, 1);
    assert.equal(promoted.after?.siblingSourceEventCount, 1);
    assert.equal(promoted.after?.fulfillmentOutboxCount, 0);
    assert.equal(promoted.after?.allocationCount, 0);
    assert.equal(promoted.processor?.intakeStage, NEXTGEN_ONE_EVENT_PROMOTE_STAGE);
    assert.equal(promoted.processor?.shadowOutboxEnsured, false);
    assert.equal(promoted.processor?.inventoryTrackingOutcome, "created");
    assert.equal(promoted.inventory?.nicheKey, "nurse");
    assert.equal(promoted.inventory?.lifecycleKey, "FRESH_HOLD");
    assert.equal(promoted.inventory?.commerceEligible, false);

    const second = await promoteOneLeadCaptureNextGenSourceEvent(args, { prisma: db });
    assert.equal(second.outcome, "REFUSED");
    assert.equal(second.reasonCode, "REFUSED_ALREADY_PROMOTED");
    assert.equal(second.writesAttempted, false);
  });

  it("serializes two concurrent Prisma clients onto one promotion", async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const dbIdentity = parseDatabaseTarget(url);
    const payload = uniqueNursePayload();

    const captured = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload,
      stageOverride: "capture_only",
    });
    createdEventIds.push(captured.sourceEventId);

    const args = {
      sourceEventId: captured.sourceEventId,
      stage: NEXTGEN_ONE_EVENT_PROMOTE_STAGE,
      expectedSourceSystem: NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM,
      expectedRoute: String(payload.sa360_route_key),
      expectedLeadId: String(payload.lead_id),
      expectedDbHost: dbIdentity.host,
      operator: "test-operator",
      confirm: NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION,
      databaseUrl: url,
    };

    const dbA = new PrismaClient({ datasources: { db: { url } } });
    const dbB = new PrismaClient({ datasources: { db: { url } } });
    try {
      const [first, second] = await Promise.all([
        promoteOneLeadCaptureNextGenSourceEvent(args, { prisma: dbA }),
        promoteOneLeadCaptureNextGenSourceEvent(args, { prisma: dbB }),
      ]);
      createdEventIds.push(first.after?.sourceEventId ?? captured.sourceEventId);
      createdEventIds.push(second.after?.sourceEventId ?? captured.sourceEventId);

      const outcomes = [first.outcome, second.outcome].sort();
      assert.deepEqual(outcomes, ["PROMOTED", "REFUSED"]);
      const promoted = first.outcome === "PROMOTED" ? first : second;
      const refused = first.outcome === "REFUSED" ? first : second;
      assert.equal(refused.reasonCode, "REFUSED_ALREADY_PROMOTED");
      assert.equal(refused.writesAttempted, false);
      assert.equal(promoted.after?.associatedInventoryCount, 1);
      assert.equal(promoted.after?.siblingSourceEventCount, 1);

      const events = await db.sourceLeadEvent.findMany({
        where: { sourceLeadId: String(payload.lead_id) },
      });
      assert.equal(events.length, 1);
      const items = await db.leadInventoryItem.findMany({
        where: { sourceLeadEventId: captured.sourceEventId },
      });
      assert.equal(items.length, 1);

      assert.ok(await dbA.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } }));
      assert.ok(await dbB.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } }));
    } finally {
      await dbA.$disconnect();
      await dbB.$disconnect();
    }
  });
});
