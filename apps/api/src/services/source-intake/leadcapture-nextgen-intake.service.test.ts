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
    },
  });
  assert.equal(result.matched, false);
  assert.equal(result.status, "routing_unmatched");
  assert.equal(result.shadowOutboxEnsured, false);
  assert.equal(outboxCalls, 0);
});
