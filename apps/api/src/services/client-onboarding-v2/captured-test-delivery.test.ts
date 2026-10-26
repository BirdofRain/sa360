import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_CANARY_HEADER,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import { COMPANY_SHEETS_INTERNAL_TEST_CLIENT } from "../company-sheets-dispatch/company-sheets-campaign-pilot.js";
import {
  CONFIRM_DELIVER,
  CONFIRM_REPEAT,
  PR228_RECONCILE_DISCREPANCY,
  WARNING_DOWNSTREAM,
  assertCapturedTestIdempotencyKeys,
  classifyExternalHttp,
  isCapturedTestEnabled,
  isProductionIdempotencyKey,
  planCapturedTestDelivery,
  reconcileCapturedTestRun,
  reservedProductionIdempotencyKeys,
  runCapturedTestDelivery,
  type CapturedTestRequest,
  type CapturedTestWorld,
  type ProductionSnapshot,
  type StoredSourceEvent,
} from "./captured-test-delivery.js";
import {
  createFakeGhlLocation,
  createFakeSheetsAppend,
  createFakeSyntheticSheets,
  createMemoryCapturedTestStore,
  fakeOnboardingLeadNote,
} from "./captured-test-delivery.fakes.js";

const CLIENT = "client_a";
const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];

function ids() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

function production(overrides: Partial<ProductionSnapshot> = {}): ProductionSnapshot {
  return {
    sourceLeadEventCount: 2,
    inventoryCount: 5,
    billingRowCount: 1,
    dispatchIntentCount: 3,
    eventStatus: "routing_matched",
    eventDeliveryResult: { receipt: "production-webhook" },
    campaignDispatchEnabled: false,
    agedDispatchEnabled: false,
    ...overrides,
  };
}

function event(overrides: Partial<StoredSourceEvent> = {}): StoredSourceEvent {
  return {
    id: "evt_note_v2",
    clientAccountIdResolved: CLIENT,
    status: "routing_matched",
    sourceRouteKey: "leadcapture_form",
    enrichmentMetadataJson: { recordClass: "campaign_lead" },
    normalizedPayloadJson: {
      contact: {
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.invalid",
        phone_e164: "+15555550100",
        state: "VA",
      },
      routing: {
        source_intake: {
          submitted_at: "2026-10-26T14:00:00.000Z",
          sourceAttributes: { primary_reason: "burial", primary_concern: "cost" },
        },
      },
    },
    receivedAt: "2026-10-26T15:00:00.000Z",
    sourceLeadId: "src_1",
    deliveryResultJson: { receipt: "production-webhook" },
    ...overrides,
  };
}

function world(overrides: Partial<CapturedTestWorld> = {}): CapturedTestWorld {
  const prod = production();
  return {
    clientFound: true,
    event: event(),
    identities: [{ email: "ada@example.invalid", phoneE164: "+15555550100" }],
    sheets: {
      spreadsheetId: "sheet_client",
      spreadsheetTitle: "Client",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 10,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
      },
      canary: {
        worksheetId: 20,
        worksheetTitle: "Canary",
        header: [...COMPANY_SHEETS_CANARY_HEADER],
      },
      campaignRisk: { uncertain: false, appendStartedAtHeld: false, campaignTestUnresolved: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
    },
    ghl: {
      locationId: "loc_prod",
      isolatedLocationId: null,
      workflowId: "wf_timezone",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      notesEnabled: true,
    },
    production: prod,
    ...overrides,
  };
}

const enabledEnv = {
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
} as NodeJS.ProcessEnv;

function delivery(overrides: Partial<CapturedTestRequest> = {}): CapturedTestRequest {
  return {
    requestId: "req_1",
    kind: "captured_event_delivery",
    clientAccountId: CLIENT,
    sourceLeadEventId: "evt_note_v2",
    destinations: ["google_sheets", "ghl_location_api"],
    execute: true,
    confirmation: CONFIRM_DELIVER,
    acknowledgeDownstreamAutomation: true,
    isolation: { mode: "verified_test_identity" },
    noteOverflow: "refuse",
    repeatOfTestRunId: null,
    actorLabel: "operator",
    ...overrides,
  };
}

function harness(overrides: { sheets?: ReturnType<typeof createFakeSheetsAppend>; ghl?: ReturnType<typeof createFakeGhlLocation> } = {}) {
  const store = createMemoryCapturedTestStore();
  const sheets = overrides.sheets ?? createFakeSheetsAppend();
  const ghl = overrides.ghl ?? createFakeGhlLocation();
  const snapshot = world();
  const before = structuredClone(snapshot.production);
  const beforeEvent = structuredClone(snapshot.event);
  return {
    store,
    sheets,
    ghl,
    snapshot,
    before,
    beforeEvent,
    deps: {
      env: enabledEnv,
      now: () => "2026-10-26T19:00:00.000Z",
      newId: ids(),
      notes: fakeOnboardingLeadNote(),
      store,
      sheets,
      ghl,
      execution: "injected_fakes" as const,
    },
  };
}

function assertUntouched(box: ReturnType<typeof harness>) {
  assert.deepEqual(box.snapshot.production, box.before);
  assert.deepEqual(box.snapshot.event, box.beforeEvent);
  assert.equal(box.snapshot.production.sourceLeadEventCount, box.before.sourceLeadEventCount);
  assert.equal(box.snapshot.production.inventoryCount, box.before.inventoryCount);
  assert.equal(box.snapshot.production.billingRowCount, box.before.billingRowCount);
  assert.equal(box.snapshot.production.dispatchIntentCount, box.before.dispatchIntentCount);
}

test("flags enable only on the exact string true", () => {
  assert.equal(isCapturedTestEnabled({}), false);
  assert.equal(isCapturedTestEnabled({ SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "TRUE" }), false);
  assert.equal(isCapturedTestEnabled({ SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true" }), true);
});

test("idempotency guard rejects production prefixes and accepts onboarding-test note keys", () => {
  const reserved = reservedProductionIdempotencyKeys(CLIENT, "evt_note_v2");
  assert.equal(isProductionIdempotencyKey("lead:client:evt", reserved), true);
  assert.equal(isProductionIdempotencyKey("campaign:client:evt", reserved), true);
  assert.equal(isProductionIdempotencyKey("ghl-webhook:client:evt", reserved), true);
  assert.equal(isProductionIdempotencyKey("ghl-note:client:evt", reserved), true);
  const testKey = "onboarding-test:00000000-0000-4000-8000-000000000001:ghl-note:1";
  assert.equal(isProductionIdempotencyKey(testKey, reserved), false);
  assert.deepEqual(assertCapturedTestIdempotencyKeys([testKey], reserved), { ok: true });
  assert.equal(assertCapturedTestIdempotencyKeys(["lead:client:evt"], reserved).ok, false);
});

test("classifyExternalHttp treats timeout and 5xx as uncertain and 4xx as failed", () => {
  assert.equal(classifyExternalHttp({ status: null, timedOut: true }), "uncertain");
  assert.equal(classifyExternalHttp({ status: null, threw: true }), "uncertain");
  assert.equal(classifyExternalHttp({ status: null }), "uncertain");
  assert.equal(classifyExternalHttp({ status: 500 }), "uncertain");
  assert.equal(classifyExternalHttp({ status: 408 }), "uncertain");
  assert.equal(classifyExternalHttp({ status: 422 }), "failed");
  assert.equal(classifyExternalHttp({ status: 200 }), "succeeded");
});

test("same client replay sends nothing", async () => {
  const box = harness();
  const result = await runCapturedTestDelivery(
    {
      requestId: "replay_1",
      kind: "captured_event_replay",
      clientAccountId: CLIENT,
      sourceLeadEventId: "evt_note_v2",
      destinations: ["google_sheets", "ghl_location_api"],
      execute: false,
    },
    box.snapshot,
    box.deps
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.status, "previewed");
  assert.deepEqual(result.externalCalls, { providerWebhook: false, sheets: false, ghl: false });
  assert.equal(box.sheets.calls.length, 0);
  assert.equal(box.ghl.calls.length, 0);
  assert.equal(result.run.attempts.every((attempt) => attempt.externalCallExecuted === false), true);
  assertUntouched(box);
});

test("wrong client and unresolved event are refused before any adapter call", async () => {
  const wrong = harness();
  const wrongEvent = event({ clientAccountIdResolved: "client_b" });
  const wrongWorld = world({ event: wrongEvent, production: wrong.snapshot.production });
  const mismatch = await runCapturedTestDelivery(delivery(), wrongWorld, wrong.deps);
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.error, "tenant_mismatch");
  assert.equal(mismatch.statusCode, 403);
  assert.equal(wrong.sheets.calls.length, 0);
  assert.equal(wrong.ghl.calls.length, 0);

  const unresolved = harness();
  const unresolvedWorld = world({
    event: event({ clientAccountIdResolved: null }),
    production: unresolved.snapshot.production,
  });
  const owned = await runCapturedTestDelivery(delivery(), unresolvedWorld, unresolved.deps);
  assert.equal(owned.ok, false);
  if (owned.ok) return;
  assert.equal(owned.error, "event_not_client_owned");
  assert.equal(owned.statusCode, 409);
  assert.equal(unresolved.sheets.calls.length, 0);
});

test("internal pilot proof is refused for every client except the internal test client", async () => {
  const box = harness();
  const pilotWorld = world({
    event: event({
      sourceRouteKey: "company_sheets_internal_pilot",
      enrichmentMetadataJson: { recordClass: "company_sheets_internal_pilot" },
    }),
    production: box.snapshot.production,
  });
  const refused = await runCapturedTestDelivery(delivery(), pilotWorld, box.deps);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error, "internal_pilot_not_client_proof");
  assert.equal(box.ghl.calls.length, 0);

  const internal = harness();
  const allowed = await planCapturedTestDelivery(
    {
      requestId: "pilot_replay",
      kind: "captured_event_replay",
      clientAccountId: COMPANY_SHEETS_INTERNAL_TEST_CLIENT,
      sourceLeadEventId: "evt_note_v2",
      destinations: ["google_sheets"],
      execute: false,
    },
    world({
      event: event({
        clientAccountIdResolved: COMPANY_SHEETS_INTERNAL_TEST_CLIENT,
        enrichmentMetadataJson: { recordClass: "company_sheets_internal_pilot" },
      }),
    }),
    { ...internal.deps, testRunId: "00000000-0000-4000-8000-000000000099", now: "2026-10-26T19:00:00.000Z", priors: [] }
  );
  assert.equal(allowed.ok, true);
});

test("verified test identity mismatch is refused and a match keeps the historical event id", async () => {
  const box = harness();
  const missing = await runCapturedTestDelivery(
    delivery(),
    world({ identities: [{ email: "other@example.invalid", phoneE164: null }], production: box.snapshot.production }),
    box.deps
  );
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error, "verified_test_identity_mismatch");
  assert.equal(missing.statusCode, 403);
  assert.equal(box.sheets.calls.length, 0);

  const sent = await runCapturedTestDelivery(delivery({ requestId: "req_match" }), box.snapshot, box.deps);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(box.sheets.calls[0]?.sourceLeadEventId, "evt_note_v2");
  assert.equal(box.sheets.calls[0]?.deliveryRowId.startsWith("onboarding-test:"), true);
  assert.equal(box.sheets.calls[0]?.values.includes("evt_note_v2"), true);
  assert.equal(box.sheets.calls[0]?.values.includes(box.sheets.calls[0].deliveryRowId), true);
  assert.equal(box.sheets.calls[0]?.values.some((cell) => cell.startsWith("lead:")), false);
  assert.equal(box.ghl.calls[0]?.step === "contact" && box.ghl.calls[0].request.sa360DeliveryClass, "onboarding_captured_test");
  assert.equal(sent.sourceDeliverySatisfied, false);
  assert.equal(sent.downstreamExecuted, false);
  for (const key of sent.plan.idempotencyKeys) {
    assert.equal(key.startsWith(`onboarding-test:${sent.run.id}:`), true);
    assert.equal(key.startsWith("lead:"), false);
    assert.equal(key.startsWith("campaign:"), false);
    assert.equal(key.startsWith("ghl-webhook:"), false);
    assert.equal(key.startsWith("ghl-note:"), false);
  }
  assertUntouched(box);
});

test("a planned production key is refused before the sheets or GHL fakes are called", async () => {
  const box = harness();
  const result = await runCapturedTestDelivery(delivery(), box.snapshot, {
    ...box.deps,
    keyOverride: ["lead:client_a:evt_note_v2"],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "production_idempotency_guard");
  assert.equal(result.statusCode, 409);
  assert.equal(box.sheets.calls.length, 0);
  assert.equal(box.ghl.calls.length, 0);
});

test("isolated GHL is refused without an isolated location, including a copied production location", async () => {
  const box = harness();
  const refused = await runCapturedTestDelivery(
    delivery({ isolation: { mode: "isolated_destination" }, destinations: ["ghl_location_api"] }),
    world({
      ghl: { ...world().ghl!, isolatedLocationId: "loc_prod" },
      production: box.snapshot.production,
    }),
    box.deps
  );
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error, "ghl_isolation_unavailable");
  assert.equal(box.ghl.calls.length, 0);

  const distinct = await runCapturedTestDelivery(
    delivery({ requestId: "req_iso", isolation: { mode: "isolated_destination" }, destinations: ["ghl_location_api"] }),
    world({
      ghl: { ...world().ghl!, isolatedLocationId: "loc_other" },
      production: box.snapshot.production,
    }),
    box.deps
  );
  assert.equal(distinct.ok, false);
  if (distinct.ok) return;
  assert.equal(distinct.error, "ghl_isolation_unavailable");
  assert.equal(box.ghl.calls.length, 0);
});

test("isolated sheets append only on the Canary worksheet", async () => {
  const box = harness();
  const unapproved = await runCapturedTestDelivery(
    delivery({ isolation: { mode: "isolated_destination" }, destinations: ["google_sheets"] }),
    box.snapshot,
    box.deps
  );
  assert.equal(unapproved.ok, false);
  if (unapproved.ok) return;
  assert.equal(unapproved.error, "worksheet_blocked");
  assert.equal(box.sheets.calls.length, 0);

  const approvedWorld = world({ production: box.snapshot.production });
  approvedWorld.sheets!.canaryApproved = true;
  const sent = await runCapturedTestDelivery(
    delivery({
      requestId: "req_canary",
      isolation: { mode: "isolated_destination" },
      destinations: ["google_sheets"],
    }),
    approvedWorld,
    box.deps
  );
  assert.equal(sent.ok, true);
  assert.equal(box.sheets.calls.length, 1);
  assert.equal(box.sheets.calls[0]?.worksheetTitle, "Canary");
  assert.equal(box.sheets.calls[0]?.worksheetRole, "canary");
  assert.equal(box.sheets.calls[0]?.worksheetId, 20);
  assert.equal(box.ghl.calls.length, 0);
});

test("a live campaign tab and an uncertain worksheet are refused", async () => {
  const live = harness();
  const liveWorld = world({ production: live.snapshot.production });
  liveWorld.sheets!.campaignDispatchEnabled = true;
  const refused = await runCapturedTestDelivery(delivery(), liveWorld, live.deps);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error, "live_tab_test_refused");
  assert.equal(live.sheets.calls.length, 0);

  const blocked = harness();
  const blockedWorld = world({ production: blocked.snapshot.production });
  blockedWorld.sheets!.campaignRisk = { uncertain: true, appendStartedAtHeld: true, campaignTestUnresolved: false };
  const held = await runCapturedTestDelivery(delivery(), blockedWorld, blocked.deps);
  assert.equal(held.ok, false);
  if (held.ok) return;
  assert.equal(held.error, "worksheet_blocked");
  assert.equal(blocked.sheets.calls.length, 0);
  assert.equal(blockedWorld.sheets!.campaignRisk.appendStartedAtHeld, true);
});

test("GHL acknowledgement is required and the downstream warning is present when the send is allowed", async () => {
  const box = harness();
  const missing = await runCapturedTestDelivery(delivery({ acknowledgeDownstreamAutomation: false }), box.snapshot, box.deps);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error, "downstream_automation_not_acknowledged");
  assert.equal(missing.statusCode, 422);
  assert.equal(box.ghl.calls.length, 0);

  const sent = await runCapturedTestDelivery(delivery({ requestId: "req_ack" }), box.snapshot, box.deps);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.run.warningCodes.includes(WARNING_DOWNSTREAM), true);
  const workflow = box.ghl.calls.find((call) => call.step === "workflow");
  assert.ok(workflow && workflow.step === "workflow");
  assert.equal(workflow.request.triggerMode, "direct_api");
  assert.equal(sent.run.attempts.find((attempt) => attempt.id.endsWith("ghl-workflow"))?.downstreamExecuted, false);
  assert.equal(sent.run.attempts.find((attempt) => attempt.id.endsWith("ghl-workflow"))?.doesNotProve.includes("downstream_executed"), true);
});

test("sheets and GHL attempts stay separate when GHL fails", async () => {
  const ghl = createFakeGhlLocation({ contact: { status: "failed", httpStatus: 422, error: "rejected" } });
  const box = harness({ ghl });
  const result = await runCapturedTestDelivery(delivery(), box.snapshot, box.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.status, "failed");
  const sheetsAttempt = result.run.attempts.find((attempt) => attempt.destination === "google_sheets");
  const contact = result.run.attempts.find((attempt) => attempt.idempotencyKey.endsWith(":ghl-contact"));
  assert.equal(sheetsAttempt?.status, "succeeded");
  assert.equal(contact?.status, "failed");
  assert.equal(box.ghl.calls.some((call) => call.step === "note"), false);
  assert.equal(box.ghl.calls.some((call) => call.step === "workflow"), false);
  assert.equal(result.sourceDeliverySatisfied, false);
  assertUntouched(box);
});

test("an uncertain sheets append is not repeated, including after reconcile of an absent row", async () => {
  const sheets = createFakeSheetsAppend({ status: "uncertain", reason: "timeout" });
  const box = harness({ sheets });
  const first = await runCapturedTestDelivery(delivery({ destinations: ["google_sheets"] }), box.snapshot, box.deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.run.status, "uncertain");
  assert.equal(box.ghl.calls.length, 0);
  assert.equal(box.sheets.calls.length, 1);

  const second = await runCapturedTestDelivery(
    delivery({ requestId: "req_2", destinations: ["google_sheets"] }),
    box.snapshot,
    box.deps
  );
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error, "repeat_blocked_uncertain");
  assert.equal(second.discrepancy, PR228_RECONCILE_DISCREPANCY);
  assert.equal(box.sheets.calls.length, 1);

  const reconciled = reconcileCapturedTestRun(box.store, {
    clientAccountId: CLIENT,
    testRunId: first.run.id,
    requestId: "recon_1",
    actorLabel: "operator",
    observation: "I looked at the tab and the row was not there",
    inspectedAbsentRow: true,
    now: "2026-10-26T20:00:00.000Z",
  });
  assert.equal(reconciled.ok, true);
  if (!reconciled.ok) return;
  assert.equal(reconciled.resendAuthorized, false);
  assert.equal(reconciled.appendStartedAtCleared, false);
  assert.equal(reconciled.locksCleared, false);
  assert.equal(reconciled.run.status, "uncertain");
  assert.match(reconciled.discrepancy, /absent/);

  const third = await runCapturedTestDelivery(
    delivery({
      requestId: "req_3",
      destinations: ["google_sheets"],
      confirmation: CONFIRM_REPEAT,
      repeatOfTestRunId: first.run.id,
    }),
    box.snapshot,
    box.deps
  );
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.equal(third.error, "repeat_blocked_uncertain");
  assert.equal(box.sheets.calls.length, 1);
  assert.equal(box.store.runs.every((run) => run.appendStartedAtCleared === false && run.locksCleared === false), true);
});

test("an in-flight run blocks a concurrent delivery before a second append", async () => {
  const sheets = createFakeSheetsAppend({ status: "defer" });
  const box = harness({ sheets });
  const first = runCapturedTestDelivery(delivery({ destinations: ["google_sheets"] }), box.snapshot, box.deps);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await runCapturedTestDelivery(
    delivery({ requestId: "req_race", destinations: ["google_sheets"] }),
    box.snapshot,
    box.deps
  );
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error, "repeat_blocked_in_flight");
  assert.equal(box.sheets.calls.length, 1);
  sheets.release();
  const finished = await first;
  assert.equal(finished.ok, true);
  assert.equal(box.sheets.calls.length, 1);
});

test("the same request id does not send twice, and a terminal run repeats only with a new id and new keys", async () => {
  const box = harness();
  const first = await runCapturedTestDelivery(delivery({ destinations: ["google_sheets"] }), box.snapshot, box.deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = await runCapturedTestDelivery(delivery({ destinations: ["google_sheets"] }), box.snapshot, box.deps);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.duplicateRequest, true);
  assert.deepEqual(again.externalCallsThisRequest, { providerWebhook: false, sheets: false, ghl: false });
  assert.equal(box.sheets.calls.length, 1);

  const withoutPhrase = await runCapturedTestDelivery(
    delivery({ requestId: "req_again", destinations: ["google_sheets"] }),
    box.snapshot,
    box.deps
  );
  assert.equal(withoutPhrase.ok, false);
  if (withoutPhrase.ok) return;
  assert.equal(withoutPhrase.error, "repeat_of_required");
  assert.equal(box.sheets.calls.length, 1);

  const repeated = await runCapturedTestDelivery(
    delivery({
      requestId: "req_repeat",
      destinations: ["google_sheets"],
      confirmation: CONFIRM_REPEAT,
      repeatOfTestRunId: first.run.id,
    }),
    box.snapshot,
    box.deps
  );
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.notEqual(repeated.run.id, first.run.id);
  assert.equal(box.sheets.calls.length, 2);
  assert.notEqual(box.sheets.calls[0]?.idempotencyKey, box.sheets.calls[1]?.idempotencyKey);
  assert.equal(box.sheets.calls[1]?.idempotencyKey.startsWith(`onboarding-test:${repeated.run.id}:`), true);
  assertUntouched(box);
});

test("unknown GHL contact outcome does not post a note or workflow and is not retried", async () => {
  const ghl = createFakeGhlLocation({ contact: { status: "throw" } });
  const box = harness({ ghl });
  const first = await runCapturedTestDelivery(delivery({ destinations: ["ghl_location_api"] }), box.snapshot, box.deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.run.status, "uncertain");
  assert.equal(box.ghl.calls.filter((call) => call.step === "contact").length, 1);
  assert.equal(box.ghl.calls.some((call) => call.step === "note" || call.step === "workflow"), false);

  const second = await runCapturedTestDelivery(
    delivery({ requestId: "req_ghl_2", destinations: ["ghl_location_api"] }),
    box.snapshot,
    box.deps
  );
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error, "repeat_blocked_uncertain");
  assert.equal(box.ghl.calls.length, 1);
});

test("an uncertain first note part is not followed by another part or by workflow enrollment", async () => {
  const ghl = createFakeGhlLocation({
    notes: [{ status: "uncertain", reason: "unknown_post", httpStatus: null }],
  });
  const box = harness({ ghl });
  const result = await runCapturedTestDelivery(delivery({ destinations: ["ghl_location_api"], noteOverflow: "split_continuation" }), box.snapshot, {
    ...box.deps,
    notes: fakeOnboardingLeadNote("split"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.status, "uncertain");
  const notes = box.ghl.calls.filter((call) => call.step === "note");
  assert.equal(notes.length, 1);
  assert.equal(box.ghl.calls.some((call) => call.step === "workflow"), false);
});

test("distinct source events with the same phone keep separate test identities", async () => {
  const ghl = createFakeGhlLocation({ sharedContactId: "contact_shared" });
  const box = harness({ ghl });
  const first = await runCapturedTestDelivery(delivery({ destinations: ["ghl_location_api"] }), box.snapshot, box.deps);
  assert.equal(first.ok, true);
  const secondEvent = event({ id: "evt_other", sourceLeadId: "src_2" });
  const secondWorld = world({ event: secondEvent, production: box.snapshot.production });
  const second = await runCapturedTestDelivery(
    delivery({ requestId: "req_other", sourceLeadEventId: "evt_other", destinations: ["ghl_location_api"] }),
    secondWorld,
    box.deps
  );
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  const contacts = box.ghl.calls.filter((call) => call.step === "contact");
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0]?.step === "contact" && contacts[0].request.sourceLeadEventId, "evt_note_v2");
  assert.equal(contacts[1]?.step === "contact" && contacts[1].request.sourceLeadEventId, "evt_other");
  assert.equal(contacts[0]?.step === "contact" && contacts[0].request.phone, contacts[1]?.step === "contact" ? contacts[1].request.phone : "");
  assert.notEqual(
    contacts[0]?.step === "contact" ? contacts[0].request.idempotencyKey : "",
    contacts[1]?.step === "contact" ? contacts[1].request.idempotencyKey : ""
  );
  const notes = box.ghl.calls.filter((call) => call.step === "note");
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0]?.step === "note" ? notes[0].request.idempotencyKey : "", notes[1]?.step === "note" ? notes[1].request.idempotencyKey : "");
  assert.equal(box.snapshot.production.sourceLeadEventCount, 2);
  assert.equal(secondWorld.production.sourceLeadEventCount, 2);
});

test("note refusal and a missing test-run line do not call GHL", async () => {
  const tooLong = harness();
  const refused = await runCapturedTestDelivery(delivery({ destinations: ["ghl_location_api"] }), tooLong.snapshot, {
    ...tooLong.deps,
    notes: fakeOnboardingLeadNote("too_long"),
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error, "note_too_long");
  assert.equal(refused.posted, false);
  assert.equal(tooLong.ghl.calls.length, 0);
  assert.equal(tooLong.sheets.calls.length, 0);

  const missingLine = harness();
  const blocked = await runCapturedTestDelivery(delivery({ destinations: ["ghl_location_api"] }), missingLine.snapshot, {
    ...missingLine.deps,
    notes: fakeOnboardingLeadNote("omit_test_line"),
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.error, "note_builder_pending_agent_b");
  assert.equal(missingLine.ghl.calls.length, 0);
});

test("synthetic sheets delegates once and does not retry an unresolved append", async () => {
  const synthetic = createFakeSyntheticSheets();
  const store = createMemoryCapturedTestStore();
  const sent = await runCapturedTestDelivery(
    {
      requestId: "syn_1",
      kind: "synthetic_delivery",
      clientAccountId: CLIENT,
      destinations: ["google_sheets"],
      execute: true,
    },
    world(),
    {
      env: enabledEnv,
      now: () => "2026-10-26T19:00:00.000Z",
      newId: ids(),
      store,
      syntheticSheets: synthetic,
      execution: "injected_fakes",
    }
  );
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(synthetic.calls.length, 1);
  assert.equal(sent.run.attempts[0]?.doesNotProve.includes("inventory"), true);
  assert.equal(sent.sourceDeliverySatisfied, false);

  const blockedWorld = world();
  blockedWorld.sheets!.campaignRisk.campaignTestUnresolved = true;
  const blocked = await runCapturedTestDelivery(
    {
      requestId: "syn_2",
      kind: "synthetic_delivery",
      clientAccountId: CLIENT,
      destinations: ["google_sheets"],
      execute: true,
    },
    blockedWorld,
    {
      env: enabledEnv,
      now: () => "2026-10-26T19:00:00.000Z",
      newId: ids(),
      store,
      syntheticSheets: synthetic,
      execution: "injected_fakes",
    }
  );
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.error, "worksheet_blocked");
  assert.equal(synthetic.calls.length, 1);
});

test("GHL synthetic stays disabled even if the reserved flag is set", async () => {
  const ghl = createFakeGhlLocation();
  const off = await runCapturedTestDelivery(
    {
      requestId: "syn_ghl",
      kind: "synthetic_delivery",
      clientAccountId: CLIENT,
      destinations: ["ghl_location_api"],
      execute: true,
    },
    world(),
    { env: enabledEnv, execution: "injected_fakes", ghl, newId: ids(), now: () => "2026-10-26T19:00:00.000Z" }
  );
  assert.equal(off.ok, false);
  if (off.ok) return;
  assert.equal(off.error, "ghl_synthetic_disabled");
  assert.equal(ghl.calls.length, 0);

  const on = await runCapturedTestDelivery(
    {
      requestId: "syn_ghl_on",
      kind: "synthetic_delivery",
      clientAccountId: CLIENT,
      destinations: ["ghl_location_api"],
      execute: true,
    },
    world(),
    {
      env: { ...enabledEnv, SA360_CLIENT_ONBOARDING_GHL_SYNTHETIC_ENABLED: "true" },
      execution: "injected_fakes",
      ghl,
      newId: ids(),
      now: () => "2026-10-26T19:00:00.000Z",
    }
  );
  assert.equal(on.ok, false);
  if (on.ok) return;
  assert.equal(on.error, "ghl_synthetic_disabled");
  assert.equal(ghl.calls.length, 0);
});

test("default execution stays disabled and the captured-test flag is not turned on by this module", async () => {
  const box = harness();
  const result = await runCapturedTestDelivery(delivery(), box.snapshot, {
    ...box.deps,
    execution: "disabled_pending_review",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "execution_pending_review");
  assert.equal(box.sheets.calls.length, 0);
  assert.equal(box.ghl.calls.length, 0);
  assert.equal(result.idempotencyKeys?.every((key) => key.startsWith("onboarding-test:")), true);
  const source = readFileSync(new URL("./captured-test-delivery.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../routes/admin-client-onboarding-v2-test.ts", import.meta.url), "utf8");
  const combined = `${source}\n${route}`;
  assert.equal(combined.includes("SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED = \"true\""), false);
  assert.equal(combined.includes("SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED\"] = \"true\""), false);
  assert.equal(combined.includes("recordCompanySheetsCampaignIntent"), false);
  assert.equal(combined.includes("releaseCompanySheetsDeliveryHold"), false);
  assert.equal(combined.includes("appendStartedAt: null"), false);
  assert.equal(combined.includes("deliverGhlInboundWebhookFromIntake("), false);
  assert.equal(combined.includes("sourceLeadEvent.create"), false);
  assert.equal(combined.includes("ghl-live-transport"), false);
  assert.equal(combined.includes("source-intake-routing-persist"), false);
  assert.equal(source.includes("prisma."), false);
});
