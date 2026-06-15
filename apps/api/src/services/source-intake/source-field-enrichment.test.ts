import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
} from "./source-field-alias.registry.js";
import { extractSourceAttributesFromPayload } from "./source-attribute-extractor.service.js";
import {
  evaluateSourceEnrichment,
  hasDeliverableIdentity,
  parseSourceAttributeFieldMapJson,
  resolveEffectiveSourceAttributeFieldMap,
} from "./source-enrichment.service.js";
import { buildPostDeliveryWorkflowTags } from "../ghl-delivery-adapter/ghl-workflow-trigger-mode.js";
import { buildSourceAttributeStampPlan } from "./source-attribute-stamp.service.js";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";

function baseLifecycle(overrides: Partial<LifecycleEventSchema> = {}): LifecycleEventSchema {
  return {
    schema_version: "MASTER 2.0",
    client_account_id: "lal_master_vet",
    subaccount_id_ghl: "lal_master_vet",
    contact: {
      lead_uid: "lc-test-001",
      first_name: "Jane",
      last_name: "Vet",
      phone: "+15551234567",
      phone_e164: "+15551234567",
    },
    attribution: {
      source_platform: "leadcapture_io",
      source_type: "leadcapture_form",
      utm_campaign: "test",
    },
    state: { lifecycle_stage: "NEW", routing_status: "RECEIVED" },
    event: {
      event_uuid: "evt-1",
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    routing: { niche_key: "VET" },
    ...overrides,
  };
}

test("valid name + phone lead is delivery-eligible despite missing optional survey answers", () => {
  const payload = baseLifecycle();
  const identity = hasDeliverableIdentity(payload);
  assert.equal(identity.ok, true);

  const enrichment = evaluateSourceEnrichment({
    sourceAttributes: {},
    unmappedSourceFieldKeys: [],
    sourceAttributeFieldMap: {
      beneficiary: { ghlFieldKey: "contact.who_is_coverage_for", requirement: "optional" },
    },
    sourceEnrichmentPolicy: {},
    routingMatched: true,
    identityValid: identity.ok,
  });

  assert.equal(enrichment.deliveryEligible, true);
  assert.equal(enrichment.enrichmentStatus, "none");
  assert.ok(enrichment.missingOptionalFields.includes("beneficiary"));
});

test("unknown source field is preserved and does not fail intake extraction", () => {
  const raw = {
    first_name: "Jane",
    phone: "+15551234567",
    lead_id: "L1",
    military_status: "veteran",
    annual_income: "$50k",
  };
  const result = extractSourceAttributesFromPayload(raw, {
    sourceSystem: "leadcapture_io_legacy",
    receivedAt: new Date().toISOString(),
  });
  assert.equal(result.sourceAttributes.military_status, "veteran");
  assert.equal(result.unmappedSourceFieldKeys.includes("annual_income"), true);
  assert.equal(result.unmappedSourceFields[0]?.key, "annual_income");
});

test("renamed field resolves through alias", () => {
  assert.equal(
    resolveCanonicalAttributeKey("best_time_to_review"),
    "best_time_to_call"
  );
  assert.equal(
    resolveCanonicalAttributeKey("please_select_your_desired_coverage_amount"),
    "desired_coverage"
  );
  const raw = { best_time_to_review: "Morning", coverage_amount: "$10k" };
  const extracted = extractSourceAttributesFromPayload(raw, {
    sourceSystem: "leadcapture_io_nextgen",
    receivedAt: new Date().toISOString(),
  });
  assert.equal(extracted.sourceAttributes.best_time_to_call, "Morning");
  assert.equal(extracted.sourceAttributes.desired_coverage, "$10k");
});

test("route-level alias overrides destination alias", () => {
  const routeOverrides = { beneficiary: ["custom_beneficiary_field"] };
  assert.equal(
    resolveCanonicalAttributeKey("custom_beneficiary_field", routeOverrides),
    "beneficiary"
  );
});

test("schema drift comparison detects added and removed fields without blocking", () => {
  const prior = ["desired_coverage", "best_time_to_call"];
  const incoming = ["desired_coverage", "annual_income"];
  const priorNorm = new Set(prior.map(normalizeSourceFieldKey));
  const incomingNorm = incoming.map(normalizeSourceFieldKey);
  const added = incomingNorm.filter((k) => !priorNorm.has(k));
  const removed = [...priorNorm].filter((k) => !new Set(incomingNorm).has(k));
  assert.deepEqual(added, ["annual_income"]);
  assert.deepEqual(removed, ["best_time_to_call"]);
});

test("missing optional mapping produces partial enrichment", () => {
  const enrichment = evaluateSourceEnrichment({
    sourceAttributes: { branch_of_service: "Army" },
    unmappedSourceFieldKeys: ["annual_income"],
    sourceAttributeFieldMap: {
      branch_of_service: { ghlFieldKey: "contact.branch_of_service", requirement: "optional" },
      beneficiary: { ghlFieldKey: "contact.who_is_coverage_for", requirement: "optional" },
    },
    sourceEnrichmentPolicy: {},
    routingMatched: true,
    identityValid: true,
  });
  assert.equal(enrichment.enrichmentStatus, "partial");
  assert.equal(enrichment.deliveryEligible, true);
});

test("missing AI-required field produces limited automation readiness", () => {
  const enrichment = evaluateSourceEnrichment({
    sourceAttributes: { branch_of_service: "Army" },
    unmappedSourceFieldKeys: [],
    sourceAttributeFieldMap: {},
    sourceEnrichmentPolicy: {
      aiContextRequired: ["branch_of_service", "best_time_to_call", "desired_coverage"],
    },
    routingMatched: true,
    identityValid: true,
  });
  assert.equal(enrichment.automationReadiness, "limited");
  assert.ok(enrichment.missingAiContextFields.includes("best_time_to_call"));
  assert.equal(enrichment.deliveryEligible, true);
});

test("route-level mapping overrides destination mapping", () => {
  const dest = {
    sourceAttributeFieldMapJson: {
      age: { ghlFieldKey: "contact.age_dest", requirement: "optional" },
    },
  } as { sourceAttributeFieldMapJson: unknown };
  const rule = {
    sourceAttributeFieldMapJson: {
      age: { ghlFieldKey: "contact.age_route", requirement: "optional" },
    },
  } as { sourceAttributeFieldMapJson: unknown };
  const merged = resolveEffectiveSourceAttributeFieldMap(dest, rule);
  assert.equal(merged.age?.ghlFieldKey, "contact.age_route");
});

test("NEW_LEAD tag constant unchanged; AI_READY only when automation ready", () => {
  const limitedTags = buildPostDeliveryWorkflowTags({
    automationReadiness: "limited",
    enrichmentStatus: "partial",
    hasUnmappedFields: true,
  });
  assert.equal(limitedTags.includes("SA360::TRIGGER::AI_READY"), false);
  assert.equal(limitedTags.includes("SA360::DATA::PARTIAL"), true);
  assert.equal(limitedTags.includes("SA360::DATA::MAPPING_REVIEW"), true);

  const readyTags = buildPostDeliveryWorkflowTags({
    automationReadiness: "ready",
    enrichmentStatus: "complete",
    hasUnmappedFields: false,
  });
  assert.equal(readyTags.includes("SA360::TRIGGER::AI_READY"), true);
});

test("source attribute stamp resolves through discovery without creating fields", () => {
  const plan = buildSourceAttributeStampPlan({
    sourceAttributes: { best_time_to_call: "Morning" },
    fieldMap: {
      best_time_to_call: {
        ghlFieldKey: "contact.vet_survey__best_time_to_call",
        requirement: "optional",
      },
    },
    discoveredFields: [
      {
        id: "field-id-abc",
        name: "Best time to call",
        key: "contact.vet_survey__best_time_to_call",
        fieldKey: "contact.vet_survey__best_time_to_call",
        dataType: "TEXT",
      },
    ],
  });
  assert.deepEqual(plan.mappableKeys, ["best_time_to_call"]);
  assert.equal(plan.idMap.best_time_to_call, "field-id-abc");
  assert.deepEqual(plan.unmappedKeys, []);
});

test("unmapped GHL field key is skipped — no arbitrary field creation", () => {
  const plan = buildSourceAttributeStampPlan({
    sourceAttributes: { age: "55" },
    fieldMap: {
      age: { ghlFieldKey: "contact.nonexistent_field", requirement: "optional" },
    },
    discoveredFields: [],
  });
  assert.deepEqual(plan.mappableKeys, []);
  assert.deepEqual(plan.unmappedKeys, ["age"]);
});

test("parseSourceAttributeFieldMapJson accepts string and object entries", () => {
  const parsed = parseSourceAttributeFieldMapJson({
    age: "contact.age",
    best_time_to_call: {
      ghlFieldKey: "contact.vet_survey__best_time_to_call",
      requirement: "automation_required",
    },
  });
  assert.equal(parsed.age?.ghlFieldKey, "contact.age");
  assert.equal(parsed.best_time_to_call?.requirement, "automation_required");
});

test("invalid identity blocks delivery eligibility", () => {
  const payload = baseLifecycle({
    contact: { lead_uid: "x", phone: "not-a-phone" },
  });
  const identity = hasDeliverableIdentity(payload);
  assert.equal(identity.ok, false);
  const enrichment = evaluateSourceEnrichment({
    sourceAttributes: {},
    unmappedSourceFieldKeys: [],
    sourceAttributeFieldMap: {},
    sourceEnrichmentPolicy: {},
    routingMatched: true,
    identityValid: identity.ok,
  });
  assert.equal(enrichment.deliveryEligible, false);
});

test("routing unmatched blocks delivery eligibility", () => {
  const enrichment = evaluateSourceEnrichment({
    sourceAttributes: { branch_of_service: "Army" },
    unmappedSourceFieldKeys: [],
    sourceAttributeFieldMap: {},
    sourceEnrichmentPolicy: {},
    routingMatched: false,
    identityValid: true,
  });
  assert.equal(enrichment.deliveryEligible, false);
});
