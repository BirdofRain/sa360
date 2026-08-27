import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

const ANDRU_FUNNEL_ID = "18c28feb-5c3d-4bd0-94d8-1ed33a6fa718";
const ALEX_FUNNEL_ID = "22ac7ad2-97a3-4fce-bd4d-02124b6e4520";
const ANDRU_ROUTE = "LCIO_NG_NURSE_ANDRU_DURANSO";
const JAMES_TORREY_ROUTE = "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX";

function createdInventoryResult(sourceLeadEventId: string) {
  return {
    ok: true as const,
    outcome: "created" as const,
    inventoryItemId: `inv_${sourceLeadEventId}`,
    sourceLeadEventId,
    sourceLane: "leadcapture_io" as const,
    generatedAt: "2026-08-18T14:37:03.545Z",
    generatedAtSource: "source_intake",
    commerceEligible: false,
    inventoryStatus: "pending_review" as const,
    lifecycleKey: "FRESH_HOLD" as const,
    identityMatch: null,
    diagnostics: {
      queryCount: 1,
      queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
      jsonCorpusScan: false as const,
      unboundedFindMany: false as const,
    },
  };
}

function reusedInventoryResult(sourceLeadEventId: string) {
  return {
    ...createdInventoryResult(sourceLeadEventId),
    outcome: "reused_same_event" as const,
    identityMatch: "same_event" as const,
  };
}

async function runInventoryOnly(rawPayload: Record<string, unknown>) {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  let persistCalls = 0;
  let outboxCalls = 0;
  let trackCalls = 0;
  let ghlAdapterCalls = 0;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload,
    stageOverride: "inventory_only",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [],
      createSourceLeadEventImpl: async (data) => {
        created.push(data as Record<string, unknown>);
        return {
          id: "evt_inventory_only",
          status: "received",
          sourceRouteKey: data.sourceRouteKey,
          sourceLeadId: data.sourceLeadId,
          sourceLeadUid: data.sourceLeadUid,
          sourceCampaignId: data.sourceCampaignId,
          sourceCampaignName: data.sourceCampaignName,
          sourceFunnelName: data.sourceFunnelName,
          rawPayloadJson: data.rawPayloadJson,
          enrichmentMetadataJson: data.enrichmentMetadataJson,
        } as never;
      },
      updateSourceLeadEventImpl: async (_id, data) => {
        updates.push(data as Record<string, unknown>);
        return data as never;
      },
      persistRoutingAndDuplicateImpl: async () => {
        persistCalls += 1;
        throw new Error("inventory_only_must_not_persist_routing");
      },
      ensureFulfillmentOutboxForSourceLeadImpl: async () => {
        outboxCalls += 1;
        throw new Error("inventory_only_must_not_enqueue_outbox");
      },
      findCampaignRoutingRuleByIdImpl: async () => {
        ghlAdapterCalls += 1;
        throw new Error("inventory_only_must_not_load_routing_rule");
      },
      trackCampaignInventoryImpl: async (input) => {
        trackCalls += 1;
        assert.equal(input.sourceLane, "leadcapture_io");
        return createdInventoryResult(input.sourceLeadEventId) as never;
      },
    },
  });
  return { result, created, updates, persistCalls, outboxCalls, trackCalls, ghlAdapterCalls };
}

function alexCopiedFromAndruPayload(leadId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    sa360_source_type: "leadcapture_form",
    sa360_route_key: ANDRU_ROUTE,
    campaign_id: ANDRU_ROUTE,
    funnel_id: ALEX_FUNNEL_ID,
    funnel_name: "Life Insurance For Nurses- Alex Feuerstein",
    lead_id: leadId,
    submitted_at: "2026-08-18T14:37:03.545Z",
    first_name: "Alex",
    last_name: "NurseLead",
    email: "alex.nurse.copied@example.test",
    phone: "5550108222",
    state: "NC",
  };
}

function andruPayload(overrides: Record<string, unknown> = {}) {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    sa360_source_type: "leadcapture_form",
    sa360_route_key: ANDRU_ROUTE,
    campaign_id: ANDRU_ROUTE,
    funnel_id: ANDRU_FUNNEL_ID,
    funnel_name: "Life Insurance For Nurses- Andru Duranso",
    lead_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    submitted_at: "2026-08-18T14:37:03.545Z",
    first_name: "Andru",
    last_name: "NurseLead",
    email: "andru.nurse@example.test",
    phone: "5550108333",
    state: "NC",
    ...overrides,
  };
}

test("A. Alex copied from Andru uses Alex funnel identity and nurse_life", async () => {
  const { result, created, persistCalls, outboxCalls, trackCalls, ghlAdapterCalls, updates } =
    await runInventoryOnly(alexCopiedFromAndruPayload());
  assert.equal(result.intakeStage, "inventory_only");
  assert.equal(result.matched, false);
  assert.equal(result.shadowOutboxEnsured, false);
  assert.equal(result.status, "normalized");
  assert.equal(created[0].sourceCampaignId, ALEX_FUNNEL_ID);
  assert.equal(created[0].sourceCampaignName, "Life Insurance For Nurses- Alex Feuerstein");
  assert.notEqual(created[0].sourceCampaignId, ANDRU_ROUTE);
  const enrichment = created[0].enrichmentMetadataJson as Record<string, unknown>;
  assert.equal(enrichment.intakeStage, "inventory_only");
  assert.equal(enrichment.resolvedSourceCampaignId, ALEX_FUNNEL_ID);
  assert.equal(enrichment.resolvedSourceName, "Life Insurance For Nurses- Alex Feuerstein");
  assert.equal(enrichment.resolvedNiche, "nurse_life");
  assert.equal(enrichment.routeKeyReceived, ANDRU_ROUTE);
  assert.equal(enrichment.routeKeyIdentityMismatch, true);
  assert.equal(enrichment.providerFormId, ALEX_FUNNEL_ID);
  const normalized = updates.at(-1)?.normalizedPayloadJson as {
    client_account_id?: string;
    routing?: { niche_key?: string };
  };
  assert.equal(normalized.client_account_id, "leadcapture_io");
  assert.notEqual(normalized.client_account_id, "lal_master_vet");
  assert.equal(normalized.routing?.niche_key, "nurse_life");
  assert.equal(result.inventoryTracking?.ok, true);
  assert.equal(result.inventoryTracking && "sourceLane" in result.inventoryTracking
    ? result.inventoryTracking.sourceLane
    : null, "leadcapture_io");
  assert.equal(trackCalls, 1);
  assert.equal(persistCalls, 0);
  assert.equal(outboxCalls, 0);
  assert.equal(ghlAdapterCalls, 0);
});

test("B. Andru normal payload keeps Andru identity and creates inventory", async () => {
  const { result, created, persistCalls } = await runInventoryOnly(andruPayload());
  assert.equal(created[0].sourceCampaignId, ANDRU_FUNNEL_ID);
  assert.equal(created[0].sourceCampaignName, "Life Insurance For Nurses- Andru Duranso");
  const enrichment = created[0].enrichmentMetadataJson as Record<string, unknown>;
  assert.equal(enrichment.routeKeyIdentityMismatch, false);
  assert.equal(enrichment.resolvedNiche, "nurse_life");
  assert.equal(result.inventoryTracking?.ok, true);
  assert.equal(persistCalls, 0);
  assert.equal(result.matched, false);
});

test("C. unseen duplicated Nurse funnel becomes an inventory source without hardcoded registration", async () => {
  const newFunnelId = "33333333-4444-4555-8666-777777777777";
  const { result, created, persistCalls } = await runInventoryOnly({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    funnel_id: newFunnelId,
    funnel_name: "Life Insurance For Nurses- New Agent",
    lead_id: "44444444-5555-4666-8777-888888888888",
    submitted_at: "2026-08-18T14:37:03.545Z",
    first_name: "New",
    last_name: "Nurse",
    email: "new.nurse@example.test",
    phone: "5550108444",
    state: "TX",
  });
  assert.equal(created[0].sourceCampaignId, newFunnelId);
  assert.equal(created[0].sourceCampaignName, "Life Insurance For Nurses- New Agent");
  const enrichment = created[0].enrichmentMetadataJson as Record<string, unknown>;
  assert.equal(enrichment.resolvedNiche, "nurse_life");
  assert.equal(result.inventoryTracking?.ok, true);
  assert.equal(persistCalls, 0);
});

test("D. new Veteran funnel infers vet_fex and creates inventory", async () => {
  const { result, created, updates } = await runInventoryOnly({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    funnel_id: "55555555-6666-4777-8888-999999999999",
    funnel_name: "Life Insurance For Veterans - Example Agent",
    lead_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    submitted_at: "2026-08-18T14:37:03.545Z",
    first_name: "Pat",
    last_name: "Veteran",
    email: "pat.veteran@example.test",
    phone: "5550108555",
    state: "FL",
  });
  assert.equal(created[0].sourceCampaignId, "55555555-6666-4777-8888-999999999999");
  const enrichment = created[0].enrichmentMetadataJson as Record<string, unknown>;
  assert.equal(enrichment.resolvedNiche, "vet_fex");
  const normalized = updates.at(-1)?.normalizedPayloadJson as { routing?: { niche_key?: string } };
  assert.equal(normalized.routing?.niche_key, "vet_fex");
  assert.equal(result.inventoryTracking?.ok, true);
});

test("E. retains unknown-niche source and delegates to inventory tracking without guessing niche", async () => {
  const { result, created, persistCalls, outboxCalls, trackCalls, updates } = await runInventoryOnly({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    funnel_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
    funnel_name: "Matt Test Campaign 123",
    lead_id: "88888888-9999-4aaa-8bbb-cccccccccccc",
    submitted_at: "2026-08-18T14:37:03.545Z",
    first_name: "Matt",
    last_name: "Test",
    email: "matt.test@example.test",
    phone: "5550108666",
    state: "OH",
  });
  assert.equal(result.status, "normalized");
  assert.equal(created.length, 1);
  assert.equal(created[0].sourceCampaignId, "77777777-8888-4999-8aaa-bbbbbbbbbbbb");
  const enrichment = created[0].enrichmentMetadataJson as Record<string, unknown>;
  assert.equal(enrichment.resolvedNiche, null);
  assert.equal(enrichment.nicheResolved, false);
  const normalized = updates.at(-1)?.normalizedPayloadJson as { routing?: { niche_key?: string } };
  assert.equal(normalized.routing?.niche_key, undefined);
  assert.equal(trackCalls, 1);
  assert.equal(persistCalls, 0);
  assert.equal(outboxCalls, 0);
  assert.equal(result.matched, false);
});

test("F. duplicate webhook tracks inventory once and does not create a second event", async () => {
  const raw = alexCopiedFromAndruPayload("99999999-aaaa-4bbb-8ccc-dddddddddddd");
  let created = 0;
  let persistCalls = 0;
  let trackCalls = 0;
  const prior = {
    id: "evt_dup",
    status: "normalized",
    sourceRouteKey: ANDRU_ROUTE,
    sourceLeadId: raw.lead_id,
    sourceLeadUid: `leadcaptureio-leadcapture_io_nextgen-${raw.lead_id}`,
    sourceCampaignId: ALEX_FUNNEL_ID,
    normalizedPayloadJson: { routing: { niche_key: "nurse_life" } },
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    routingDryRunDecisionId: null,
  };
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: raw,
    stageOverride: "inventory_only",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [{ id: prior.id }] as never,
      findSourceLeadEventByIdImpl: async () => prior as never,
      createSourceLeadEventImpl: async () => {
        created += 1;
        throw new Error("should_not_create");
      },
      persistRoutingAndDuplicateImpl: async () => {
        persistCalls += 1;
        throw new Error("should_not_route");
      },
      trackCampaignInventoryImpl: async () => {
        trackCalls += 1;
        return reusedInventoryResult(prior.id) as never;
      },
    },
  });
  assert.equal(created, 0);
  assert.equal(persistCalls, 0);
  assert.equal(trackCalls, 1);
  assert.equal(result.duplicate, true);
  assert.equal(result.sourceEventId, prior.id);
  assert.equal(result.inventoryTracking && "outcome" in result.inventoryTracking
    ? result.inventoryTracking.outcome
    : null, "reused_same_event");
});

test("G. same contact across two funnel IDs still invokes canonical inventory tracking twice", async () => {
  const contact = {
    first_name: "Shared",
    last_name: "Contact",
    email: "shared.contact@example.test",
    phone: "5550108777",
    state: "NC",
    submitted_at: "2026-08-18T14:37:03.545Z",
  };
  const first = await runInventoryOnly({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    funnel_id: ANDRU_FUNNEL_ID,
    funnel_name: "Life Insurance For Nurses- Andru Duranso",
    lead_id: "aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ...contact,
  });
  const second = await runInventoryOnly({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    funnel_id: ALEX_FUNNEL_ID,
    funnel_name: "Life Insurance For Nurses- Alex Feuerstein",
    lead_id: "aaaa2222-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ...contact,
  });
  assert.notEqual(first.created[0].sourceLeadId, second.created[0].sourceLeadId);
  assert.notEqual(first.created[0].sourceCampaignId, second.created[0].sourceCampaignId);
  assert.equal(first.trackCalls, 1);
  assert.equal(second.trackCalls, 1);
});

test("H. capture_only still persists the event only and does not create inventory", async () => {
  let tracked = 0;
  let persistCalls = 0;
  const result = await processLeadCaptureNextGenLeadCreated({
    rawPayload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    stageOverride: "capture_only",
    deps: {
      findCorrelatedSourceLeadEventsImpl: async () => [],
      createSourceLeadEventImpl: async (data) =>
        ({
          id: "evt_capture_reg",
          status: "received",
          sourceRouteKey: data.sourceRouteKey,
          sourceLeadId: data.sourceLeadId,
          sourceLeadUid: data.sourceLeadUid,
        }) as never,
      persistRoutingAndDuplicateImpl: async () => {
        persistCalls += 1;
        throw new Error("should_not_route");
      },
      trackCampaignInventoryImpl: async () => {
        tracked += 1;
        throw new Error("should_not_track");
      },
    },
  });
  assert.equal(result.intakeStage, "capture_only");
  assert.equal(result.status, "received");
  assert.equal(tracked, 0);
  assert.equal(persistCalls, 0);
  assert.equal(result.inventoryTracking, undefined);
});

test("I. legacy James Torrey route identity remains route-key based", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-route-vet.json");
  assert.equal(raw.sa360_route_key, JAMES_TORREY_ROUTE);
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.client_account_id, "leadcapture_io");
  assert.equal(normalized.attribution?.campaign_id, JAMES_TORREY_ROUTE);
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal(normalized.state.lead_type, "VET");
});

test("J. inventory_only stays on leadcapture_io and never uses lal_master_vet", async () => {
  const { result, created, updates } = await runInventoryOnly(andruPayload());
  assert.equal(created[0].sourceProvider, "leadcapture_io");
  assert.equal(created[0].sourceSystem, "leadcapture_io_nextgen");
  const normalized = updates.at(-1)?.normalizedPayloadJson as {
    client_account_id?: string;
    subaccount_id_ghl?: string;
  };
  assert.equal(normalized.client_account_id, "leadcapture_io");
  assert.equal(normalized.subaccount_id_ghl, "leadcapture_io");
  assert.doesNotMatch(JSON.stringify(created[0]), /lal_master_vet/);
  assert.doesNotMatch(JSON.stringify(updates), /lal_master_vet/);
  assert.equal(
    result.inventoryTracking && "sourceLane" in result.inventoryTracking
      ? result.inventoryTracking.sourceLane
      : null,
    "leadcapture_io"
  );
});
