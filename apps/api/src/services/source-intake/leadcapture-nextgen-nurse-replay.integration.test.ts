import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import {
  isPurchasableInventoryCommerceLifecycle,
  resolveInventoryCommerceLifecycle,
} from "../ppl-fulfillment/commerce-lifecycle.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");
const T1 = "2026-08-18T14:37:03.545Z";
const T2 = "2026-08-18T15:16:48.000Z";

function loadNurseFixture() {
  return JSON.parse(readFileSync(join(fixtureDir, "leadcaptureio-webhook-sample-nextgen-nurse.json"), "utf8")) as Record<string, unknown>;
}

describe("NextGen Nurse capture_only replay inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db?.$disconnect();
  });

  it("reuses the capture_only event, keeps T1, stores one NURSE inventory item", async () => {
    const original = loadNurseFixture();
    const capture = await processLeadCaptureNextGenLeadCreated({
      rawPayload: original,
      stageOverride: "capture_only",
    });
    createdEventIds.push(capture.sourceEventId);
    assert.equal(capture.duplicate, false);
    assert.equal(capture.status, "received");

    const resend = { ...original, submitted_at: T2 };
    const promoted = await processLeadCaptureNextGenLeadCreated({
      rawPayload: resend,
      stageOverride: "normalize_route_proof",
    });
    createdEventIds.push(promoted.sourceEventId);
    assert.equal(promoted.sourceEventId, capture.sourceEventId);
    assert.equal(promoted.duplicate, true);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: capture.sourceEventId } });
    assert.ok(event);
    const payload = event?.normalizedPayloadJson as {
      state?: { lead_type?: string };
      routing?: { niche_key?: string; source_intake?: { submitted_at?: string; generated_at?: string } };
    } | null;
    assert.equal(payload?.state?.lead_type, "NURSE");
    assert.equal(payload?.routing?.niche_key, "NURSE");
    assert.equal(payload?.routing?.source_intake?.submitted_at, T1);
    assert.equal(payload?.routing?.source_intake?.generated_at, T1);

    const events = await db.sourceLeadEvent.findMany({
      where: { sourceLeadId: String(original.lead_id) },
    });
    assert.equal(events.length, 1);

    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: capture.sourceEventId },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.nicheKey, "nurse");
    assert.equal(items[0]?.generatedAt?.toISOString(), T1);
    assert.ok(items[0]?.status === "pending_review" || items[0]?.status === "available");
    assert.equal(promoted.inventoryTracking?.ok, true);
    if (promoted.inventoryTracking?.ok) {
      assert.equal(promoted.inventoryTracking.generatedAt, T1);
      assert.equal(promoted.inventoryTracking.commerceEligible, false);
      assert.equal(promoted.inventoryTracking.lifecycleKey, "FRESH_HOLD");
      assert.equal(promoted.inventoryTracking.outcome, "created");
    }
    const ageDays = calculateInventoryAgeDays(new Date(T1), new Date("2026-08-18T16:00:00.000Z"));
    assert.equal(resolveInventoryCommerceLifecycle(ageDays), "FRESH_HOLD");
    assert.equal(isPurchasableInventoryCommerceLifecycle("FRESH_HOLD"), false);
    assert.equal(isPurchasableInventoryCommerceLifecycle("SEMI_FRESH_HOLD"), false);
  });

  it("does not invent generatedAt from resend T2 when original submitted_at is missing", async () => {
    const original: Record<string, unknown> = {
      ...loadNurseFixture(),
      lead_id: "7c8d9e10-2a31-4b42-9c53-8d64e75f0a21",
      email: "casey.nurse.nodate@example.test",
      phone: "5550108222",
    };
    delete original.submitted_at;

    const capture = await processLeadCaptureNextGenLeadCreated({
      rawPayload: original,
      stageOverride: "capture_only",
    });
    createdEventIds.push(capture.sourceEventId);

    const resend = { ...original, submitted_at: T2 };
    const promoted = await processLeadCaptureNextGenLeadCreated({
      rawPayload: resend,
      stageOverride: "normalize_route_proof",
    });
    createdEventIds.push(promoted.sourceEventId);
    assert.equal(promoted.sourceEventId, capture.sourceEventId);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: capture.sourceEventId } });
    const payload = event?.normalizedPayloadJson as {
      routing?: { source_intake?: { submitted_at?: string; generated_at?: string } };
    } | null;
    assert.equal(payload?.routing?.source_intake?.submitted_at, undefined);
    assert.equal(payload?.routing?.source_intake?.generated_at, undefined);
    assert.notEqual(payload?.routing?.source_intake?.generated_at, T2);

    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: capture.sourceEventId },
    });
    assert.equal(items.length, 0);
    assert.equal(promoted.inventoryTracking?.ok, true);
    if (promoted.inventoryTracking?.ok) {
      assert.equal(promoted.inventoryTracking.outcome, "generated_at_missing");
      assert.equal(promoted.inventoryTracking.generatedAt, null);
      assert.equal(promoted.inventoryTracking.commerceEligible, false);
    }
  });
});
