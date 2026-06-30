import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectDemoFallbackPayload,
  buildDirectDemoPayloadFromDecision,
  describeDirectDemoPayloadSource,
  DIRECT_DEMO_SCHEMA_VERSION,
  directDemoLeadCreatedPayloadJson,
  isDirectDemoLiveDeliveryAllowed,
  validateDirectDemoPayload,
} from "./demo-payload.ts";
import {
  DIRECT_DEMO_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
  DIRECT_DEMO_LOCATION_ID,
} from "./types.ts";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";

function routing(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.routing as Record<string, unknown>;
}

test("fallback demo payload conforms to the current schema", () => {
  const payload = buildDirectDemoFallbackPayload({ nowMs: 12345 });
  assert.equal(payload.schema_version, "1.0");
  assert.equal(payload.client_account_id, "lal_master_vet");
  const state = payload.state as Record<string, unknown>;
  assert.equal(state.lifecycle_stage, "NEW");
  assert.equal(state.lead_status, "NEW");
  assert.equal(state.appointment_status, "NONE");
  assert.equal(state.routing_status, "SOURCE_RECEIVED");
  const event = payload.event as Record<string, unknown>;
  assert.equal(event.event_name_internal, "lead_created");
  assert.equal(event.event_name_meta, "Lead");
  assert.equal(event.send_to_meta, false);
  assert.ok(String(event.event_uuid).length > 0);
  const contact = payload.contact as Record<string, unknown>;
  assert.ok(String(contact.lead_uid).length > 0);
  assert.ok(String(contact.email).includes("@example.test"));
  const r = routing(payload);
  assert.equal(r.destination_client_account_id, DIRECT_DEMO_CLIENT_ACCOUNT_ID);
  assert.equal(r.destination_location_id_ghl, DIRECT_DEMO_LOCATION_ID);
  assert.equal(r.routing_mode, "shadow");
  assert.equal(r.dry_run, true);
  // The fallback is fully valid for local validation.
  assert.equal(validateDirectDemoPayload(payload).ok, true);
});

test("schema_version constant is 1.0 and fallback uses it", () => {
  assert.equal(DIRECT_DEMO_SCHEMA_VERSION, "1.0");
  assert.equal(buildDirectDemoFallbackPayload().schema_version, "1.0");
});

test("directDemoLeadCreatedPayloadJson returns valid fallback JSON", () => {
  const raw = directDemoLeadCreatedPayloadJson();
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(parsed.schema_version, "1.0");
  assert.ok(parsed.attribution);
  assert.equal(describeDirectDemoPayloadSource(parsed), "Custom simulation payload");
});

function decisionFixture(
  overrides: Partial<RoutingDryRunDecisionItem> = {}
): RoutingDryRunDecisionItem {
  return {
    id: "dec_123",
    createdAt: "2026-06-29T00:00:00.000Z",
    sourceEventUuid: "evt_1",
    sourceLeadUid: "google-sheet-google_sheet_import-abc",
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_1",
    matchedRuleSummary: {
      id: "rule_1",
      clientDisplayName: "Nurse Client",
      clientAccountId: "client_nurse",
      nicheKey: "NURSE",
      productType: "Final Expense",
      matchType: "campaign_id",
    },
    destinationClientAccountId: "client_nurse",
    destinationSubaccountIdGhl: "loc_nurse_123",
    reason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: {
      masterClientAccountId: "lal_master_vet",
      campaignId: "cmp_999",
      campaignName: "Nurse FEX",
      sourcePlatform: "google_sheets",
      sourceType: "google_sheet_import",
      formId: "form_nurse",
      nicheKey: "NURSE",
      productType: "Final Expense",
    },
    lifecycleEventsEmitted: ["lead_matched"],
    leadIdentity: null,
    masterClientAccountId: "lal_master_vet",
    deliveryPlanSummary: {
      id: "plan_abc",
      status: "planned",
      deliveryMode: "shadow",
      generatedAt: "2026-06-29T00:00:00.000Z",
    },
    suggestedValidation: {
      suggestedValidationStatus: "matched_legacy",
      suggestedValidationReason: "",
      suggestionConfidence: "high",
    },
    suggestedLegacyPrefill: {
      legacyDeliveredClientAccountId: null,
      legacyDeliveredSubaccountIdGhl: null,
      legacyDeliveryContactIdGhl: null,
      legacyDeliveryStatus: null,
      prefillReason: null,
      prefillConfidence: null,
    },
    deliveryReadiness: null,
    duplicateRisk: null,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    ...overrides,
  };
}

test("selected routing decision payload builder includes destination + routing fields", () => {
  const payload = buildDirectDemoPayloadFromDecision(decisionFixture(), { nowMs: 999 });
  assert.equal(payload.schema_version, "1.0");
  assert.equal(payload.client_account_id, "lal_master_vet");
  const r = routing(payload);
  assert.equal(r.master_client_account_id, "lal_master_vet");
  assert.equal(r.destination_client_account_id, "client_nurse");
  assert.equal(r.destination_location_id_ghl, "loc_nurse_123");
  assert.equal(r.target_client_account_id, "client_nurse");
  assert.equal(r.target_subaccount_id_ghl, "loc_nurse_123");
  assert.equal(r.niche_key, "NURSE");
  assert.equal(r.product_type, "Final Expense");
  assert.equal(r.form_id, "form_nurse");
  assert.equal(r.routing_dry_run_decision_id, "dec_123");
  assert.equal(r.delivery_plan_id, "plan_abc");
  const attribution = payload.attribution as Record<string, unknown>;
  assert.equal(attribution.campaign_id, "cmp_999");
  assert.equal(attribution.source_platform, "google_sheets");
  assert.equal(describeDirectDemoPayloadSource(payload), "Selected routing decision");
  assert.equal(validateDirectDemoPayload(payload).ok, true);
});

test("live canary guard requires matched routing decision and plan references", () => {
  const fallback = buildDirectDemoFallbackPayload();
  const fallbackGuard = isDirectDemoLiveDeliveryAllowed(fallback);
  assert.equal(fallbackGuard.allowed, false);
  assert.equal(
    fallbackGuard.reason,
    "Live canary requires a matched routing decision and delivery plan."
  );

  const routePlanPayload = buildDirectDemoPayloadFromDecision(decisionFixture());
  const guard = isDirectDemoLiveDeliveryAllowed(routePlanPayload);
  assert.equal(guard.allowed, true);

  // Explicit live routing mode is rejected even for the demo destination.
  const liveModePayload = buildDirectDemoPayloadFromDecision(decisionFixture());
  (liveModePayload.routing as Record<string, unknown>).routing_mode = "live";
  assert.equal(isDirectDemoLiveDeliveryAllowed(liveModePayload).allowed, false);
});

test("validateDirectDemoPayload rejects stale / invalid payloads", () => {
  // Wrong schema_version
  const stale = buildDirectDemoFallbackPayload();
  stale.schema_version = "1";
  let v = validateDirectDemoPayload(stale);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("schema_version")));

  // Missing event_uuid
  const noEvent = buildDirectDemoFallbackPayload();
  (noEvent.event as Record<string, unknown>).event_uuid = "";
  v = validateDirectDemoPayload(noEvent);
  assert.ok(v.errors.some((e) => e.includes("event_uuid")));

  // Missing lead_uid
  const noLead = buildDirectDemoFallbackPayload();
  (noLead.contact as Record<string, unknown>).lead_uid = "";
  v = validateDirectDemoPayload(noLead);
  assert.ok(v.errors.some((e) => e.includes("lead_uid")));

  // Missing destination
  const noDest = buildDirectDemoFallbackPayload();
  (noDest.routing as Record<string, unknown>).destination_client_account_id = "";
  (noDest.routing as Record<string, unknown>).destination_location_id_ghl = "";
  v = validateDirectDemoPayload(noDest);
  assert.ok(v.errors.some((e) => e.includes("destination_client_account_id")));
  assert.ok(v.errors.some((e) => e.includes("destination_location_id_ghl")));

  // Noncanonical lifecycle_stage
  const badStage = buildDirectDemoFallbackPayload();
  (badStage.state as Record<string, unknown>).lifecycle_stage = "LEAD_CREATED";
  v = validateDirectDemoPayload(badStage);
  assert.ok(v.errors.some((e) => e.includes("lifecycle_stage")));

  // Missing campaign/source
  const noCampaign = buildDirectDemoFallbackPayload();
  (noCampaign.attribution as Record<string, unknown>).campaign_id = "";
  (noCampaign.attribution as Record<string, unknown>).source_platform = "";
  v = validateDirectDemoPayload(noCampaign);
  assert.ok(v.errors.some((e) => e.includes("campaign_id")));
  assert.ok(v.errors.some((e) => e.includes("source_platform")));
});

test("live confirmation constant unchanged", () => {
  assert.equal(DIRECT_DEMO_LIVE_CONFIRMATION_TEXT, "DELIVER ONE LEAD");
});
