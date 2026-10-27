import assert from "node:assert/strict";
import test from "node:test";

import { captureNextAction } from "../source-intake/facebook-form-association.js";
import {
  assembleClientSourceProof,
  findProductionSheetsDelivery,
  type LoadedSourceProof,
  type ProofEvent,
  type ProofFunnel,
  type ProofGhlReceipt,
  type ProofIntent,
  type ProofJob,
} from "./source-proof.js";

const CLIENT = "onb_fixture_client";
const FUNNEL = "funnel_fixture";
const CUTOFF = new Date("2026-10-26T00:00:00.000Z");
const AFTER = new Date("2026-10-26T01:00:00.000Z");
const BEFORE = new Date("2026-10-25T00:00:00.000Z");

function funnel(overrides: Partial<ProofFunnel> = {}): ProofFunnel {
  return {
    id: FUNNEL,
    provider: "leadcapture_io",
    providerFunnelId: "form-1",
    parentUrlKey: "go.example.com/alex",
    pageSlug: "alex",
    associationStatus: "confirmed",
    originClientAccountId: CLIENT,
    suggestedClientAccountId: null,
    firstSeenAt: null,
    updatedAt: new Date("2026-10-26T14:00:00.000Z"),
    ...overrides,
  };
}

function event(overrides: Partial<ProofEvent> = {}): ProofEvent {
  return {
    id: "evt_fixture",
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    status: "received",
    sourceLeadId: "lead-1",
    sourceRouteKey: null,
    clientAccountIdResolved: CLIENT,
    routingRuleIdResolved: null,
    routingDryRunDecisionId: null,
    receivedAt: new Date("2026-10-26T15:00:00.000Z"),
    rawPayloadJson: {},
    normalizedPayloadJson: {},
    routingResultJson: null,
    enrichmentMetadataJson: null,
    deliveryResultJson: null,
    ...overrides,
  };
}

function loaded(overrides: Partial<LoadedSourceProof> = {}): LoadedSourceProof {
  return {
    clientAccountId: CLIENT,
    cutoff: CUTOFF,
    funnels: [funnel()],
    events: [],
    jobs: [],
    intents: [],
    ghlReceipts: [],
    evidenceTruncated: false,
    ...overrides,
  };
}

test("confirmed LeadCapture source with no events is linked only", () => {
  const proof = assembleClientSourceProof(loaded());
  assert.equal(proof.sources.length, 1);
  const source = proof.sources[0]!;
  assert.equal(source.sourceKind, "leadcapture");
  assert.equal(source.proofs.linked.satisfied, true);
  assert.equal(source.proofs.observed.satisfied, false);
  assert.equal(source.proofs.routingMatched.satisfied, false);
  assert.equal(source.proofs.delivery.satisfied, false);
  assert.equal(source.proofs.routingMatched.looseRuleIgnored, null);
});

test("LeadCapture firstSeenAt is observed and a Meta notification timestamp is not", () => {
  const leadcapture = assembleClientSourceProof(
    loaded({ funnels: [funnel({ firstSeenAt: new Date("2026-10-20T00:00:00.000Z") })] })
  );
  assert.equal(leadcapture.sources[0]!.proofs.observed.satisfied, true);
  assert.equal(leadcapture.sources[0]!.proofs.observed.sourceLeadEventId, null);
  const meta = assembleClientSourceProof(
    loaded({
      funnels: [
        funnel({
          provider: "facebook",
          providerFunnelId: "fbpage:900000000000101:fbform:900000000000201",
          firstSeenAt: new Date("2026-10-20T00:00:00.000Z"),
        }),
      ],
    })
  );
  assert.equal(meta.sources.length, 1);
  assert.equal(meta.sources[0]!.sourceKind, "meta_lead_ads");
  assert.equal(meta.sources[0]!.proofs.observed.satisfied, false);
  assert.equal(meta.sources[0]!.proofs.routingMatched.satisfied, false);
  assert.equal(meta.sources[0]!.proofs.delivery.satisfied, false);
});

test("a route key alone is not source identity", () => {
  const proof = assembleClientSourceProof(
    loaded({
      events: [event({ sourceRouteKey: "go.example.com/alex", routingResultJson: { routeKey: "go.example.com/alex" } })],
    })
  );
  assert.equal(proof.sources[0]!.proofs.observed.satisfied, false);
  assert.equal(proof.sources[0]!.proofs.observed.sourceLeadEventId, null);
});

test("confirmed association satisfies routing and a loose UTM event does not", () => {
  const proof = assembleClientSourceProof(
    loaded({
      events: [
        event({
          id: "evt_associated",
          status: "routing_matched",
          routingDryRunDecisionId: "decision_associated",
          routingResultJson: {
            matched: true,
            routingAuthority: "confirmed_source_association",
            routingDryRunDecisionId: "decision_associated",
            sourceAssociation: { sourceFunnelId: FUNNEL, matchedBy: "parent_url_key" },
          },
        }),
        event({
          id: "evt_loose",
          status: "routing_matched",
          routingRuleIdResolved: "rule_loose",
          routingResultJson: {
            matched: true,
            routingAuthority: "campaign_routing_rule",
            matchType: "keyword_fallback",
            matchedRuleId: "rule_loose",
            sourceAssociation: { sourceFunnelId: FUNNEL },
          },
        }),
      ],
    })
  );
  const routing = proof.sources[0]!.proofs.routingMatched;
  assert.equal(routing.satisfied, true);
  assert.equal(routing.authority, "confirmed_source_association");
  assert.equal(routing.matchedRuleId, null);
  assert.equal(routing.routingDryRunDecisionId, "decision_associated");
  assert.equal(routing.looseRuleIgnored, "loose_rule_not_source_proof");
});

test("capture-only Meta evidence stays observed and does not become routing or delivery", () => {
  const nextAction = captureNextAction("associated");
  const proof = assembleClientSourceProof(
    loaded({
      funnels: [
        funnel({
          provider: "facebook",
          providerFunnelId: "fbpage:900000000000101:fbform:900000000000201",
          parentUrlKey: null,
          pageSlug: null,
        }),
      ],
      events: [
        event({
          id: "evt_meta",
          sourceProvider: "facebook",
          sourceSystem: "meta_lead_ads",
          enrichmentMetadataJson: {
            captureOnly: true,
            captureSettled: true,
            intakeStage: "capture_only",
            intakeMethod: "meta_lead_ads",
            nextAction,
            association: {
              sourceFunnelId: FUNNEL,
              pageId: "900000000000101",
              formId: "900000000000201",
              outcome: "associated",
            },
            delivery: { thisRequestAttempted: false },
          },
        }),
      ],
    })
  );
  assert.equal(proof.sources.length, 1);
  const source = proof.sources[0]!;
  assert.equal(source.sourceKind, "meta_lead_ads");
  assert.equal(source.proofs.observed.satisfied, true);
  assert.equal(source.proofs.observed.captureOnly, true);
  assert.equal(source.proofs.routingMatched.satisfied, false);
  assert.equal(source.proofs.delivery.satisfied, false);
  assert.equal(source.nextAction, nextAction);
  assert.match(source.nextAction ?? "", /no delivery was attempted/i);
  assert.equal(source.thisRequestAttempted, false);
});

test("canary and campaign-test jobs are not delivery proof", () => {
  const jobs: ProofJob[] = [
    { id: "job_canary", kind: "canary", status: "succeeded", sourceLeadEventId: "evt_associated", clientAccountId: CLIENT },
    {
      id: "job_test",
      kind: "campaign_test",
      status: "succeeded",
      sourceLeadEventId: "evt_associated",
      clientAccountId: CLIENT,
    },
  ];
  const intents: ProofIntent[] = [
    { sourceLeadEventId: "evt_associated", kind: "campaign_lead", createdAt: AFTER, clientAccountId: CLIENT },
  ];
  assert.equal(
    findProductionSheetsDelivery({ jobs, intents, cutoff: CUTOFF, clientAccountId: CLIENT, sourceLeadEventId: "evt_associated" }),
    null
  );
  const proof = assembleClientSourceProof(
    loaded({
      events: [
        event({
          id: "evt_associated",
          status: "routing_matched",
          routingResultJson: {
            routingAuthority: "confirmed_source_association",
            sourceAssociation: { sourceFunnelId: FUNNEL },
          },
        }),
      ],
      jobs,
      intents,
    })
  );
  assert.equal(proof.sources[0]!.proofs.delivery.satisfied, false);
});

test("a post-cutoff lead job counts and a pre-cutoff job does not", () => {
  const eventRow = event({
    id: "evt_associated",
    status: "routing_matched",
    routingResultJson: {
      routingAuthority: "confirmed_source_association",
      sourceAssociation: { sourceFunnelId: FUNNEL },
    },
  });
  const early = assembleClientSourceProof(
    loaded({
      events: [eventRow],
      jobs: [{ id: "job_early", kind: "lead", status: "succeeded", sourceLeadEventId: "evt_associated", clientAccountId: CLIENT }],
      intents: [{ sourceLeadEventId: "evt_associated", kind: "campaign_lead", createdAt: BEFORE, clientAccountId: CLIENT }],
    })
  );
  assert.equal(early.sources[0]!.proofs.delivery.satisfied, false);
  const later = assembleClientSourceProof(
    loaded({
      events: [eventRow],
      jobs: [{ id: "job_later", kind: "lead", status: "succeeded", sourceLeadEventId: "evt_associated", clientAccountId: CLIENT }],
      intents: [{ sourceLeadEventId: "evt_associated", kind: "campaign_lead", createdAt: AFTER, clientAccountId: CLIENT }],
    })
  );
  assert.equal(later.sources[0]!.proofs.delivery.satisfied, true);
  assert.equal(later.sources[0]!.proofs.delivery.sheetsJobId, "job_later");
});

test("location API receipt counts and a canary or webhook 2xx mode does not", () => {
  const eventRow = event({
    id: "evt_associated",
    status: "routing_matched",
    routingDryRunDecisionId: "decision_1",
    routingResultJson: {
      routingAuthority: "confirmed_source_association",
      routingDryRunDecisionId: "decision_1",
      sourceAssociation: { sourceFunnelId: FUNNEL },
    },
  });
  const receipts: ProofGhlReceipt[] = [
    {
      id: "ghl_canary",
      mode: "live_canary",
      status: "succeeded",
      startedAt: AFTER,
      routingDryRunDecisionId: "decision_1",
      destinationClientAccountId: CLIENT,
    },
    {
      id: "ghl_webhook",
      mode: "ghl_inbound_webhook",
      status: "succeeded",
      startedAt: AFTER,
      routingDryRunDecisionId: "decision_1",
      destinationClientAccountId: CLIENT,
    },
  ];
  const ignored = assembleClientSourceProof(loaded({ events: [eventRow], ghlReceipts: receipts }));
  assert.equal(ignored.sources[0]!.proofs.delivery.satisfied, false);
  const produced = assembleClientSourceProof(
    loaded({
      events: [eventRow],
      ghlReceipts: [
        {
          id: "ghl_location",
          mode: "location_api",
          status: "succeeded",
          startedAt: AFTER,
          routingDryRunDecisionId: "decision_1",
          destinationClientAccountId: CLIENT,
        },
      ],
    })
  );
  assert.equal(produced.sources[0]!.proofs.delivery.ghlReceiptId, "ghl_location");
  assert.equal(produced.sources[0]!.proofs.delivery.satisfied, true);
});

test("internal pilot and synthetic rows are not client source proof", () => {
  const proof = assembleClientSourceProof(
    loaded({
      events: [
        event({
          id: "evt_pilot",
          status: "routing_matched",
          clientAccountIdResolved: CLIENT,
          enrichmentMetadataJson: { internalPilot: true },
          routingResultJson: {
            routingAuthority: "operator_selected_destination",
            sourceAssociation: { sourceFunnelId: FUNNEL },
          },
        }),
      ],
    })
  );
  assert.equal(proof.sources[0]!.proofs.observed.satisfied, false);
  assert.equal(proof.sources[0]!.proofs.routingMatched.satisfied, false);
  assert.equal(proof.sources[0]!.proofs.delivery.satisfied, false);
});
