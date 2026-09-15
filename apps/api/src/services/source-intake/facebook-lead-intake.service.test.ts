import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

test("Meta intake source does not reach live GHL delivery", () => {
  assert.doesNotMatch(intakeSource, /enqueueGhl|ghl-live-canary|ghl-delivery-adapter-run|source-lead-delivery/);
  assert.doesNotMatch(persistSource, /enqueueGhl|ghl-live-canary|ghl-delivery-adapter-run|source-lead-delivery/);
  assert.match(persistSource, /No GHL delivery is performed here/);
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

