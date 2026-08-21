import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LeadCaptureNextGenIntakeError,
  processLeadCaptureNextGenLeadCreated,
} from "./leadcapture-nextgen-intake.service.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

test("capture_only persists received event without routing", async () => {
  const created: Array<Record<string, unknown>> = [];
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    stageOverride: "capture_only",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [],
      createSourceLeadEventImpl: async (data) => {
        created.push(data as Record<string, unknown>);
        return {
          id: "evt_capture_1",
          status: "received",
          sourceRouteKey: data.sourceRouteKey,
          sourceLeadId: data.sourceLeadId,
          sourceLeadUid: data.sourceLeadUid,
          routingRuleIdResolved: null,
          clientAccountIdResolved: null,
          destinationLocationIdResolved: null,
          routingDryRunDecisionId: null,
        } as never;
      },
    },
  });
  assert.equal(result.status, "received");
  assert.equal(result.matched, false);
  assert.equal(result.intakeStage, "capture_only");
  assert.equal(result.shadowOutboxEnsured, false);
  assert.equal(result.sourceSystem, "leadcapture_io_nextgen");
  assert.equal(created.length, 1);
  assert.equal(created[0].sourceSystem, "leadcapture_io_nextgen");
  assert.equal(created[0].status, "received");
});

test("idempotent replay returns existing event", async () => {
  let created = 0;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    stageOverride: "capture_only",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [{ id: "evt_existing" }] as never,
      findSourceLeadEventByIdImpl: async () =>
        ({
          id: "evt_existing",
          status: "received",
          sourceRouteKey: "LC_VET_FEX_TEST",
          sourceLeadId: "11111111-2222-4333-8444-555555555555",
          sourceLeadUid:
            "leadcaptureio-leadcapture_io_nextgen-11111111-2222-4333-8444-555555555555",
          routingRuleIdResolved: null,
          clientAccountIdResolved: null,
          destinationLocationIdResolved: null,
          routingDryRunDecisionId: null,
        }) as never,
      createSourceLeadEventImpl: async () => {
        created += 1;
        throw new Error("should_not_create");
      },
    },
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.sourceEventId, "evt_existing");
  assert.equal(created, 0);
});

test("rejects invalid nextgen payload", async () => {
  await assert.rejects(
    () =>
      processLeadCaptureNextGenLeadCreated({
        rawPayload: { lead_id: "not-a-uuid", first_name: "x" },
        stageOverride: "capture_only",
      }),
    (err: unknown) =>
      err instanceof LeadCaptureNextGenIntakeError && err.code === "invalid_payload"
  );
});

test("shadow_fulfillment enqueues outbox when matched", async () => {
  let outboxCalls = 0;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    stageOverride: "shadow_fulfillment",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [],
      createSourceLeadEventImpl: async (data) =>
        ({
          id: "evt_shadow_1",
          status: "received",
          sourceRouteKey: data.sourceRouteKey,
          sourceLeadId: data.sourceLeadId,
          sourceLeadUid: data.sourceLeadUid,
          routingRuleIdResolved: null,
          clientAccountIdResolved: null,
          destinationLocationIdResolved: null,
          routingDryRunDecisionId: null,
        }) as never,
      updateSourceLeadEventImpl: async (_id, data) => data as never,
      persistRoutingAndDuplicateImpl: async () => ({
        routing: {
          matched: true,
          matchedRuleId: "rule_1",
          destinationClientAccountId: "client_a",
          destinationLocationIdGhl: "loc_a",
          reason: "campaign_id",
          matchType: "campaign_id",
          routingDryRunDecisionId: "rdr_1",
        },
        duplicateRiskJson: null,
        status: "routing_matched",
        normalizedWithEnrichment: {} as never,
      }),
      findCampaignRoutingRuleByIdImpl: async () =>
        ({
          id: "rule_1",
          deliveryMode: "shadow",
          active: true,
        }) as never,
      ensureFulfillmentOutboxForSourceLeadImpl: async () => {
        outboxCalls += 1;
        return { id: "outbox_1" } as never;
      },
      trackCampaignInventoryImpl: async () =>
        ({
          ok: true,
          outcome: "created",
          inventoryItemId: "inv_shadow_1",
          sourceLeadEventId: "evt_shadow_1",
          sourceLane: "leadcapture_io",
          generatedAt: "2026-01-01T00:00:00.000Z",
          generatedAtSource: "source_intake",
          commerceEligible: false,
          lifecycleKey: "FRESH_HOLD",
          identityMatch: null,
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        }) as never,
    },
  });
  assert.equal(result.matched, true);
  assert.equal(result.shadowOutboxEnsured, true);
  assert.equal(outboxCalls, 1);
});

test("loose match types do not allocate outbox", async () => {
  let outboxCalls = 0;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    stageOverride: "shadow_fulfillment",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [],
      createSourceLeadEventImpl: async (data) =>
        ({
          id: "evt_loose_1",
          status: "received",
          sourceRouteKey: data.sourceRouteKey,
          sourceLeadId: data.sourceLeadId,
          sourceLeadUid: data.sourceLeadUid,
        }) as never,
      updateSourceLeadEventImpl: async (_id, data) => data as never,
      persistRoutingAndDuplicateImpl: async () => ({
        routing: {
          matched: true,
          matchedRuleId: "rule_kw",
          destinationClientAccountId: "client_a",
          destinationLocationIdGhl: "loc_a",
          reason: "keyword",
          matchType: "keyword_fallback",
          routingDryRunDecisionId: "rdr_kw",
        },
        duplicateRiskJson: null,
        status: "routing_matched",
        normalizedWithEnrichment: {} as never,
      }),
      ensureFulfillmentOutboxForSourceLeadImpl: async () => {
        outboxCalls += 1;
        return { id: "outbox_x" } as never;
      },
      trackCampaignInventoryImpl: async () =>
        ({
          ok: true,
          outcome: "created",
          inventoryItemId: "inv_loose_1",
          sourceLeadEventId: "evt_loose_1",
          sourceLane: "leadcapture_io",
          generatedAt: null,
          generatedAtSource: null,
          commerceEligible: false,
          lifecycleKey: "DATE_MISSING",
          identityMatch: null,
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        }) as never,
    },
  });
  assert.equal(result.matched, false);
  assert.equal(result.status, "routing_unmatched");
  assert.equal(result.shadowOutboxEnsured, false);
  assert.equal(outboxCalls, 0);
});

test("capture_only event later normalized tracks inventory exactly once", async () => {
  let created = 0;
  let tracked = 0;
  const originalRaw = loadFixture("leadcaptureio-webhook-sample-nextgen.json");
  const prior = {
    id: "evt_capture_later",
    status: "received",
    sourceRouteKey: "LC_VET_FEX_TEST",
    sourceLeadId: "11111111-2222-4333-8444-555555555555",
    sourceLeadUid: "leadcaptureio-leadcapture_io_nextgen-11111111-2222-4333-8444-555555555555",
    rawPayloadJson: originalRaw,
    normalizedPayloadJson: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    routingDryRunDecisionId: null,
  };
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    stageOverride: "normalize_route_proof",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [{ id: prior.id }] as never,
      findSourceLeadEventByIdImpl: async () => prior as never,
      createSourceLeadEventImpl: async () => {
        created += 1;
        throw new Error("should_not_create_second_event");
      },
      updateSourceLeadEventImpl: async (_id, data) => data as never,
      persistRoutingAndDuplicateImpl: async () => ({
        routing: {
          matched: false,
          reason: "unmatched",
          matchType: undefined,
        },
        duplicateRiskJson: null,
        status: "routing_unmatched",
        normalizedWithEnrichment: {} as never,
      }),
      trackCampaignInventoryImpl: async () => {
        tracked += 1;
        return {
          ok: true,
          outcome: "created",
          inventoryItemId: "inv_later_1",
          sourceLeadEventId: prior.id,
          sourceLane: "leadcapture_io",
          generatedAt: "2026-01-01T00:00:00.000Z",
          generatedAtSource: "source_intake",
          commerceEligible: false,
          inventoryStatus: "available",
          lifecycleKey: "FRESH_HOLD",
          identityMatch: null,
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        } as never;
      },
    },
  });
  assert.equal(created, 0);
  assert.equal(tracked, 1);
  assert.equal(result.sourceEventId, prior.id);
  assert.equal(result.inventoryTracking?.ok, true);
});

const T1 = "2026-08-18T14:37:03.545Z";
const T2 = "2026-08-18T15:16:48.000Z";

function intakeOf(normalized: Record<string, unknown> | null) {
  const routing = normalized?.routing as Record<string, unknown> | undefined;
  return routing?.source_intake as Record<string, unknown> | undefined;
}

function unmatchedPersist() {
  return {
    routing: {
      matched: false,
      reason: "unmatched",
      matchType: undefined,
    },
    duplicateRiskJson: null,
    status: "routing_unmatched" as const,
    normalizedWithEnrichment: {} as never,
  };
}

test("capture_only replay keeps original T1 and does not use resend T2", async () => {
  const original = loadFixture("leadcaptureio-webhook-sample-nextgen-nurse.json");
  const resend = { ...original, submitted_at: T2 };
  const prior = {
    id: "evt_nurse_t1",
    status: "received",
    sourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
    sourceLeadId: original.lead_id,
    sourceLeadUid: `leadcaptureio-leadcapture_io_nextgen-${original.lead_id}`,
    rawPayloadJson: original,
    normalizedPayloadJson: null,
    enrichmentMetadataJson: { captureOnly: true },
  };
  let seenNormalized: Record<string, unknown> | null = null;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: resend,
    stageOverride: "normalize_route_proof",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [{ id: prior.id }] as never,
      findSourceLeadEventByIdImpl: async () => prior as never,
      createSourceLeadEventImpl: async () => {
        throw new Error("should_not_create_second_event");
      },
      updateSourceLeadEventImpl: async (_id, data) => data as never,
      persistRoutingAndDuplicateImpl: async (_id, normalized) => {
        seenNormalized = normalized as unknown as Record<string, unknown>;
        return unmatchedPersist();
      },
      trackCampaignInventoryImpl: async () =>
        ({
          ok: true,
          outcome: "created",
          inventoryItemId: "inv_nurse_1",
          sourceLeadEventId: prior.id,
          sourceLane: "leadcapture_io",
          generatedAt: T1,
          generatedAtSource: "source_intake",
          commerceEligible: false,
          inventoryStatus: "pending_review",
          lifecycleKey: "FRESH_HOLD",
          identityMatch: null,
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        }) as never,
    },
  });
  const intake = intakeOf(seenNormalized);
  assert.equal(result.sourceEventId, prior.id);
  assert.equal(result.duplicate, true);
  assert.equal(intake?.submitted_at, T1);
  assert.equal(intake?.generated_at, T1);
  assert.notEqual(intake?.submitted_at, T2);
  const seenState = seenNormalized?.["state"] as { lead_type?: string } | undefined;
  const seenRouting = seenNormalized?.["routing"] as { niche_key?: string } | undefined;
  assert.equal(seenState?.lead_type, "NURSE");
  assert.equal(seenRouting?.niche_key, "NURSE");
});

test("capture_only missing submitted_at does not invent generatedAt from resend T2", async () => {
  const original = {
    ...loadFixture("leadcaptureio-webhook-sample-nextgen-nurse.json"),
  };
  delete original.submitted_at;
  const resend = { ...original, submitted_at: T2 };
  const prior = {
    id: "evt_nurse_nodate",
    status: "received",
    sourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
    sourceLeadId: original.lead_id,
    sourceLeadUid: `leadcaptureio-leadcapture_io_nextgen-${original.lead_id}`,
    rawPayloadJson: original,
    normalizedPayloadJson: null,
  };
  let seenNormalized: Record<string, unknown> | null = null;
  await processLeadCaptureNextGenLeadCreated({
    rawPayload: resend,
    stageOverride: "normalize_route_proof",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [{ id: prior.id }] as never,
      findSourceLeadEventByIdImpl: async () => prior as never,
      createSourceLeadEventImpl: async () => {
        throw new Error("should_not_create_second_event");
      },
      updateSourceLeadEventImpl: async (_id, data) => data as never,
      persistRoutingAndDuplicateImpl: async (_id, normalized) => {
        seenNormalized = normalized as unknown as Record<string, unknown>;
        return unmatchedPersist();
      },
      trackCampaignInventoryImpl: async () =>
        ({
          ok: true,
          outcome: "generated_at_missing",
          inventoryItemId: null,
          sourceLeadEventId: prior.id,
          sourceLane: "leadcapture_io",
          generatedAt: null,
          generatedAtSource: null,
          commerceEligible: false,
          inventoryStatus: null,
          lifecycleKey: "DATE_MISSING",
          identityMatch: null,
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        }) as never,
    },
  });
  const intake = intakeOf(seenNormalized);
  assert.equal(intake?.submitted_at, undefined);
  assert.equal(intake?.generated_at, undefined);
});

test("first-time normalize_route_proof uses the original request submitted_at", async () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-nextgen-nurse.json");
  let seenNormalized: Record<string, unknown> | null = null;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: raw,
    stageOverride: "normalize_route_proof",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [],
      createSourceLeadEventImpl: async (data) =>
        ({
          id: "evt_first_nurse",
          status: "received",
          sourceRouteKey: data.sourceRouteKey,
          sourceLeadId: data.sourceLeadId,
          sourceLeadUid: data.sourceLeadUid,
          rawPayloadJson: data.rawPayloadJson,
        }) as never,
      updateSourceLeadEventImpl: async (_id, data) => data as never,
      persistRoutingAndDuplicateImpl: async (_id, normalized) => {
        seenNormalized = normalized as unknown as Record<string, unknown>;
        return unmatchedPersist();
      },
      trackCampaignInventoryImpl: async () =>
        ({
          ok: true,
          outcome: "created",
          inventoryItemId: "inv_first_nurse",
          sourceLeadEventId: "evt_first_nurse",
          sourceLane: "leadcapture_io",
          generatedAt: T1,
          generatedAtSource: "source_intake",
          commerceEligible: false,
          inventoryStatus: "pending_review",
          lifecycleKey: "FRESH_HOLD",
          identityMatch: null,
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        }) as never,
    },
  });
  const intake = intakeOf(seenNormalized);
  assert.equal(result.duplicate, false);
  assert.equal(intake?.submitted_at, T1);
  assert.equal(intake?.generated_at, T1);
});

test("already-normalized replay does not normalize a second time", async () => {
  let persistCalls = 0;
  let created = 0;
  const prior = {
    id: "evt_already",
    status: "routing_unmatched",
    sourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
    sourceLeadId: "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11",
    sourceLeadUid: "leadcaptureio-leadcapture_io_nextgen-9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11",
    normalizedPayloadJson: { routing: { niche_key: "NURSE" } },
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    routingDryRunDecisionId: null,
  };
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen-nurse.json"),
    stageOverride: "normalize_route_proof",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [{ id: prior.id }] as never,
      findSourceLeadEventByIdImpl: async () => prior as never,
      createSourceLeadEventImpl: async () => {
        created += 1;
        throw new Error("should_not_create");
      },
      persistRoutingAndDuplicateImpl: async () => {
        persistCalls += 1;
        return unmatchedPersist();
      },
      trackCampaignInventoryImpl: async () =>
        ({
          ok: true,
          outcome: "reused_same_event",
          inventoryItemId: "inv_already",
          sourceLeadEventId: prior.id,
          sourceLane: "leadcapture_io",
          generatedAt: T1,
          generatedAtSource: "source_intake",
          commerceEligible: false,
          inventoryStatus: "pending_review",
          lifecycleKey: "FRESH_HOLD",
          identityMatch: "same_event",
          diagnostics: {
            queryCount: 1,
            queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
            jsonCorpusScan: false,
            unboundedFindMany: false,
          },
        }) as never,
    },
  });
  assert.equal(created, 0);
  assert.equal(persistCalls, 0);
  assert.equal(result.duplicate, true);
  assert.equal(result.sourceEventId, prior.id);
});
