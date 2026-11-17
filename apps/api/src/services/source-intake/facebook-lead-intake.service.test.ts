import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { deliverConfirmedAssociationIfActivated } from "../association-ongoing-delivery.js";
import { ROUTING_AUTHORITY_CAMPAIGN_RULE } from "../routing-source-association.service.js";
import {
  isFacebookLeadCanonicalProcessed,
  isFacebookLeadFullyProcessed,
  processFacebookSourceLead,
  type FacebookLeadReplayRow,
} from "./facebook-lead-intake.service.js";
import { normalizeFacebookLeadToLifecyclePayload } from "./facebook-lead-normalizer.js";

const here = dirname(fileURLToPath(import.meta.url));
const intakeSource = readFileSync(join(here, "facebook-lead-intake.service.ts"), "utf8");
const persistSource = readFileSync(join(here, "source-intake-routing-persist.ts"), "utf8");

test("Meta intake source never calls campaign inventory tracking", () => {
  assert.doesNotMatch(intakeSource, /trackCampaignInventory/);
  assert.doesNotMatch(intakeSource, /leadInventoryItem\.create/);
  assert.match(
    intakeSource,
    /Direct Meta Lead Ads are client-committed campaign leads/
  );
});

test("Meta intake source does not reach live GHL delivery", async () => {
  assert.doesNotMatch(intakeSource, /enqueueGhl|ghl-live-canary|ghl-delivery-adapter-run|source-lead-delivery|executeRecordedGhlDelivery/);
  assert.doesNotMatch(persistSource, /enqueueGhl|ghl-live-canary|ghl-delivery-adapter-run|source-lead-delivery|executeRecordedGhlDelivery/);
  assert.doesNotMatch(intakeSource, /recordCompanySheets|company-sheets-dispatch|trackCampaignInventory|leadInventoryItem\.create|enqueueMetaDispatch/);

  const captureReturn = intakeSource.indexOf("if (!routingEnabled)");
  const persistCall = intakeSource.indexOf("await persistRoutingAndDuplicate(");
  assert.ok(captureReturn > 0 && persistCall > captureReturn);
  const captureOnly = intakeSource.slice(captureReturn, persistCall);
  assert.match(captureOnly, /status: "normalized"/);
  assert.doesNotMatch(captureOnly, /persistRoutingAndDuplicate|deliverConfirmedAssociationIfActivated|executeRecordedGhlDelivery/);

  let liveCalls = 0;
  const blocked = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_meta_campaign_rule",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: ROUTING_AUTHORITY_CAMPAIGN_RULE,
        routingDryRunDecisionId: "dec_meta",
        destinationClientAccountId: "client_should_not_deliver",
        destinationLocationIdGhl: "loc_should_not_deliver",
      },
    },
    {
      loadDestination: async () => {
        throw new Error("live destination must not be loaded for a campaign-rule route");
      },
      runtimeCanExecute: async () => {
        throw new Error("live runtime must not be consulted for a campaign-rule route");
      },
      duplicateBlocks: async () => false,
      findPlan: async () => null,
      createPlan: async () => ({ ok: false, reason: "must_not_create" }),
      findRun: async () => null,
      execute: async () => {
        liveCalls += 1;
        throw new Error("live GHL must not execute");
      },
    }
  );
  assert.equal(liveCalls, 0);
  assert.equal(blocked.outcome, "skipped");
  assert.equal(blocked.reason, "not_association");
  assert.equal(blocked.externalCallExecuted, false);
});

test("Meta intake source does not reach Meta CAPI dispatch", () => {
  assert.doesNotMatch(intakeSource, /enqueueMetaDispatch|metaDispatchAttempt|getMetaDispatchQueue/);
  assert.doesNotMatch(persistSource, /enqueueMetaDispatch|metaDispatchAttempt|getMetaDispatchQueue/);
  const payload = normalizeFacebookLeadToLifecyclePayload(
    {
      leadgenId: "lead_safety_001",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.safety@example.test",
      phone: "+14155550100",
      state: "TX",
      campaignId: "camp_safety",
      formId: "form_safety",
    },
    { masterClientAccountId: "lal_master_vet" }
  );
  assert.equal(payload.event.send_to_meta, false);
});

test("claim failure catch never falls back to unguarded createSourceLeadEvent", () => {
  const marker = "facebook_intake.claim_failed";
  const idx = intakeSource.indexOf(marker);
  assert.ok(idx > 0, "claim_failed log marker must exist");
  const after = intakeSource.slice(idx, idx + 900);
  assert.doesNotMatch(after, /createSourceLeadEvent\s*\(/);
  assert.match(after, /findReplay\(leadgenId\)|findFacebookLeadReplayEvent/);
  assert.match(after, /throw err/);
});

function processedReplayRow(leadgenId: string): FacebookLeadReplayRow {
  return {
    id: "evt_existing_1",
    status: "routing_matched",
    sourceRouteKey: "form_claim_fail",
    sourceLeadId: leadgenId,
    sourceLeadUid: `facebook-meta_lead_ads-${leadgenId}`,
    normalizedAt: new Date("2026-09-14T00:00:00.000Z"),
    routedAt: new Date("2026-09-14T00:00:01.000Z"),
    routingDryRunDecisionId: "dec_existing",
    routingRuleIdResolved: "rule_1",
    clientAccountIdResolved: "acct_1",
    destinationLocationIdResolved: "loc_1",
    errorSummary: null,
  };
}

test("transient claim failure recovers existing canonical row instead of creating another", async () => {
  const leadgenId = "lead_claim_fail_recover";
  const existing = processedReplayRow(leadgenId);
  let findCalls = 0;
  const result = await processFacebookSourceLead({
    fields: {
      leadgenId,
      formId: "form_claim_fail",
      firstName: "Claim",
      lastName: "Recover",
      email: "claim.recover@example.test",
      phone: "+14155550100",
    },
    rawPayloadJson: { leadgenId },
    masterClientAccountId: "lal_master_vet",
    routingEnabled: false,
    deps: {
      claimCanonicalIdentityImpl: async () => {
        throw new Error("advisory_lock_timeout");
      },
      findReplayImpl: async () => {
        findCalls += 1;
        return findCalls === 1 ? null : existing;
      },
    },
  });
  assert.equal(result.replayed, true);
  assert.equal(result.sourceEventId, existing.id);
  assert.equal(result.status, "routing_matched");
  assert.equal(findCalls, 2);
});

test("transient claim failure with no existing row fails closed (no unguarded create)", async () => {
  const leadgenId = "lead_claim_fail_none";
  await assert.rejects(
    () =>
      processFacebookSourceLead({
        fields: {
          leadgenId,
          formId: "form_claim_fail",
          firstName: "Claim",
          lastName: "FailClosed",
          email: "claim.failclosed@example.test",
          phone: "+14155550100",
        },
        rawPayloadJson: { leadgenId },
        masterClientAccountId: "lal_master_vet",
        routingEnabled: false,
        deps: {
          claimCanonicalIdentityImpl: async () => {
            throw new Error("tx_connection_lost");
          },
          findReplayImpl: async () => null,
        },
      }),
    /tx_connection_lost/
  );
});

test("isFacebookLeadFullyProcessed treats a settled Zapier capture as complete", () => {
  const settled = {
    status: "normalized" as const,
    normalizedAt: new Date(),
    routingDryRunDecisionId: null,
    routedAt: null,
    enrichmentMetadataJson: {
      intakeMethod: "zapier_facebook",
      captureOnly: true,
      captureSettled: true,
    },
  };
  assert.equal(isFacebookLeadFullyProcessed(settled, true), true);
  assert.equal(
    isFacebookLeadFullyProcessed(
      { ...settled, enrichmentMetadataJson: { intakeMethod: "zapier_facebook", captureOnly: true } },
      true
    ),
    false
  );
  assert.equal(
    isFacebookLeadFullyProcessed(
      {
        ...settled,
        enrichmentMetadataJson: {
          captureOnly: true,
          captureSettled: true,
          originalIntakeMethod: "meta_lead_ads",
        },
      },
      true
    ),
    true
  );
});

test("isFacebookLeadFullyProcessed treats normalized as incomplete when routing is enabled", () => {
  assert.equal(
    isFacebookLeadFullyProcessed(
      { status: "normalized", normalizedAt: new Date(), routingDryRunDecisionId: null, routedAt: null },
      true
    ),
    false
  );
  assert.equal(
    isFacebookLeadFullyProcessed(
      { status: "normalized", normalizedAt: new Date(), routingDryRunDecisionId: null, routedAt: null },
      false
    ),
    true
  );
  assert.equal(
    isFacebookLeadFullyProcessed(
      { status: "needs_review", normalizedAt: new Date(), routingDryRunDecisionId: null, routedAt: null },
      true
    ),
    true
  );
});

test("isFacebookLeadCanonicalProcessed treats received as in-flight and routing_matched as processed", () => {
  assert.equal(
    isFacebookLeadCanonicalProcessed({ status: "received", normalizedAt: null }),
    false
  );
  assert.equal(
    isFacebookLeadCanonicalProcessed({ status: "routing_matched", normalizedAt: null }),
    true
  );
  assert.equal(
    isFacebookLeadCanonicalProcessed({ status: "received", normalizedAt: new Date() }),
    true
  );
});

