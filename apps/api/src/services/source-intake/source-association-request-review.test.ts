import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { CampaignRoutingRule } from "@prisma/client";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import {
  reviewSavedSourceCampaignRequest,
  type KnownCampaignRule,
  type KnownSourceFunnel,
} from "./source-association-request-review.js";

const NOW = new Date("2026-11-09T22:00:00.000Z");

function funnel(partial: Partial<KnownSourceFunnel> & Pick<KnownSourceFunnel, "id">): KnownSourceFunnel {
  return {
    provider: "leadcapture_io",
    providerFunnelId: "form-1",
    parentUrlKey: "my.leadcapture.io/p/veteran",
    pageSlug: "veteran",
    associationStatus: "unassociated",
    originClientAccountId: null,
    suggestedClientAccountId: null,
    ...partial,
  };
}

function rule(partial: Partial<KnownCampaignRule> & Pick<KnownCampaignRule, "id">): KnownCampaignRule {
  return {
    clientAccountId: "client_a",
    campaignId: "camp_1",
    active: true,
    deliveryEnabled: false,
    effectiveStart: null,
    effectiveEnd: null,
    ...partial,
  };
}

function review(partial: Partial<Parameters<typeof reviewSavedSourceCampaignRequest>[0]> = {}) {
  const defaults = {
    clientAccountId: "client_a",
    requestId: "11111111-1111-4111-8111-111111111111",
    requestStatus: "saved" as const,
    loadedRevision: 2,
    currentRevision: 2,
    providerFunnelId: "form-1",
    parentUrlKey: "my.leadcapture.io/p/veteran",
    providerCampaignId: "camp_1",
    funnels: [] as KnownSourceFunnel[],
    rules: [] as KnownCampaignRule[],
    now: NOW,
  };
  return reviewSavedSourceCampaignRequest({ ...defaults, ...partial });
}

test("the review module does not write a source, a routing rule, or a database row", () => {
  const source = readFileSync(new URL("./source-association-request-review.ts", import.meta.url), "utf8");
  assert.equal(source.includes("prisma"), false);
  assert.equal(source.includes("confirmSourceFunnelOrigin"), false);
  assert.equal(source.includes("associateSourceFunnelByPageUrl"), false);
  assert.equal(source.includes("createRoutingRuleAdmin"), false);
  assert.equal(source.includes("createCampaignRoutingRule"), false);
  assert.equal(source.includes("app.post"), false);
  assert.equal(source.includes("app.patch"), false);
});

test("an incomplete identifier and a slug-only request cannot be applied", () => {
  const missing = review({ providerFunnelId: "  ", parentUrlKey: "", providerCampaignId: "" });
  assert.equal(missing.sourceStatus, "incomplete");
  assert.equal(missing.campaignStatus, "incomplete");
  assert.equal(missing.canApply, false);
  assert.equal(missing.sourceAssociated, false);

  const slug = review({ providerFunnelId: null, parentUrlKey: null, pageSlug: "veteran" });
  assert.equal(slug.sourceStatus, "incomplete");
  assert.match(slug.blockers.join(" "), /slug alone is not a source identity/);
});

test("a suggestion is not a verified association and an unregistered source is not created", () => {
  const suggested = review({
    funnels: [funnel({ id: "sf_suggested", associationStatus: "suggested", suggestedClientAccountId: "client_a", originClientAccountId: "client_a" })],
  });
  assert.equal(suggested.sourceStatus, "registered_unconfirmed");
  assert.equal(suggested.sourceAssociated, false);
  assert.equal(suggested.canApply, false);
  assert.equal(suggested.associationWrite, false);

  const missing = review({ funnels: [] });
  assert.equal(missing.sourceStatus, "not_registered");
  assert.equal(missing.matchedSourceFunnelIds.length, 0);
});

test("cross-client confirmation is reported and not reassigned", () => {
  const other = review({
    funnels: [funnel({ id: "sf_b", associationStatus: "confirmed", originClientAccountId: "client_b" })],
  });
  assert.equal(other.sourceStatus, "confirmed_for_other_client");
  assert.equal(other.originClientAccountId, "client_b");
  assert.equal(other.sourceAssociated, false);
  assert.match(other.blockers.join(" "), /another client/);

  const split = review({
    funnels: [
      funnel({ id: "sf_a", associationStatus: "confirmed", originClientAccountId: "client_a" }),
      funnel({ id: "sf_b", provider: "facebook", providerFunnelId: "form-1", parentUrlKey: null, associationStatus: "confirmed", originClientAccountId: "client_b" }),
    ],
  });
  assert.equal(split.sourceStatus, "ambiguous");
  assert.equal(split.sourceAssociated, false);

  const splitIdentity = review({
    funnels: [
      funnel({ id: "sf_form", parentUrlKey: "other.example/form", associationStatus: "confirmed", originClientAccountId: "client_a" }),
      funnel({ id: "sf_url", providerFunnelId: "other-form", associationStatus: "confirmed", originClientAccountId: "client_a" }),
    ],
  });
  assert.equal(splitIdentity.sourceStatus, "ambiguous");
  assert.equal(splitIdentity.sourceAssociated, false);
});

test("a confirmed source for this client is associated and is not delivery", () => {
  const result = review({
    funnels: [funnel({ id: "sf_a", associationStatus: "confirmed", originClientAccountId: "client_a" })],
    rules: [rule({ id: "rule_live", active: true, deliveryEnabled: false })],
  });
  assert.equal(result.sourceStatus, "confirmed_for_client");
  assert.equal(result.sourceAssociated, true);
  assert.equal(result.campaignStatus, "live_routing_rule");
  assert.equal(result.deliveryActivated, false);
  assert.equal(result.routingRuleWrite, false);
  assert.match(result.blockers.join(" "), /Source associated and delivery activated are different/);
});

test("an active rule with delivery off stays live routing, and an inactive rule is not a mapping write", () => {
  const live = review({ rules: [rule({ id: "rule_live", deliveryEnabled: false })] });
  assert.equal(live.campaignStatus, "live_routing_rule");
  assert.equal(live.deliveryActivated, false);

  const armed = review({ rules: [rule({ id: "rule_armed", deliveryEnabled: true })] });
  assert.equal(armed.deliveryActivated, true);
  assert.match(armed.blockers.join(" "), /not a receipt of a GoHighLevel or Company Sheets delivery/);

  const inactive = review({ rules: [rule({ id: "rule_off", active: false, deliveryEnabled: true })] });
  assert.equal(inactive.campaignStatus, "inactive_rule_only");
  assert.equal(inactive.deliveryActivated, false);
  assert.match(inactive.blockers.join(" "), /does not create or activate/);

  const expired = review({
    rules: [rule({ id: "rule_old", effectiveEnd: new Date("2026-01-01T00:00:00.000Z"), deliveryEnabled: true })],
  });
  assert.equal(expired.campaignStatus, "inactive_rule_only");
  assert.equal(expired.deliveryActivated, false);
});

test("Client A's request does not inherit Client B's delivery-enabled campaign rule", () => {
  const result = review({
    clientAccountId: "client_a",
    funnels: [funnel({ id: "sf_a", associationStatus: "confirmed", originClientAccountId: "client_a" })],
    rules: [rule({ id: "rule_b", clientAccountId: "client_b", campaignId: "camp_1", active: true, deliveryEnabled: true })],
  });
  assert.equal(result.sourceStatus, "confirmed_for_client");
  assert.equal(result.sourceAssociated, true);
  assert.equal(result.campaignStatus, "live_routing_rule");
  assert.equal(result.deliveryActivated, false);
  assert.equal(result.matchedRuleIds.includes("rule_b"), true);
  assert.match(result.blockers.join(" "), /live routing rule for another client/);
  assert.match(result.blockers.join(" "), /not proof of a GoHighLevel or Company Sheets delivery for this client/);
  assert.match(result.blockers.join(" "), /Source associated and delivery activated are different/);
  assert.equal(result.associationWrite, false);
  assert.equal(result.routingRuleWrite, false);

  const sharedCampaign = review({
    rules: [
      rule({ id: "rule_a", clientAccountId: "client_a", deliveryEnabled: false }),
      rule({ id: "rule_b", clientAccountId: "client_b", deliveryEnabled: true }),
    ],
  });
  assert.equal(sharedCampaign.deliveryActivated, false);
  assert.equal(sharedCampaign.campaignStatus, "live_routing_rule");
  assert.match(sharedCampaign.blockers.join(" "), /live routing rule for another client/);
  assert.match(sharedCampaign.blockers.join(" "), /live routing rule for this client/);
});

test("a stale snapshot, a rejected request, and a duplicate request id are not applied", () => {
  const stale = review({
    currentRevision: 3,
    funnels: [funnel({ id: "sf_a", associationStatus: "confirmed", originClientAccountId: "client_a" })],
  });
  assert.equal(stale.requestDisposition, "stale");
  assert.equal(stale.snapshotCurrent, false);
  assert.equal(stale.sourceAssociated, false);
  assert.equal(stale.canApply, false);

  const rejected = review({ requestStatus: "rejected" });
  assert.equal(rejected.requestDisposition, "rejected");
  assert.match(rejected.blockers.join(" "), /rejected/);

  const duplicate = review({ seenRequestIds: ["11111111-1111-4111-8111-111111111111"] });
  assert.equal(duplicate.requestDisposition, "duplicate_request");
  assert.equal(duplicate.sourceAssociated, false);
});

test("reviewing a request does not change an existing routing decision", () => {
  const routingRule = {
    id: "r_campaign",
    masterClientAccountId: "master_1",
    clientAccountId: "client_a",
    destinationSubaccountIdGhl: "loc_dest",
    clientDisplayName: "Agent",
    nicheKey: null,
    productType: null,
    sourcePlatform: null,
    sourceType: null,
    campaignId: "camp_1",
    campaignName: null,
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: null,
    utmContent: null,
    masterDatasetId: null,
    matchType: "campaign_id",
    keywordPattern: null,
    priority: 100,
    active: true,
    effectiveStart: null,
    effectiveEnd: null,
    destinationWorkflowIdGhl: null,
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    backupSheetEnabled: false,
    backupSheetId: null,
    defaultAssignedUserIdGhl: null,
    deliveryEnabled: false,
    shadowDeliveryEnabled: true,
    ghlConnectionStatus: null,
    snapshotInstalled: false,
    requiredFieldsInstalled: false,
    deliveryMode: "shadow",
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    lastReadinessCheckAt: null,
    readinessStatus: "not_ready",
    readinessWarnings: null,
    sourceAttributeFieldMapJson: {},
    sourceFieldAliasOverridesJson: {},
    opportunityCreationEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  } as CampaignRoutingRule;
  const before = matchCampaignRoutingRule([routingRule], { masterClientAccountId: "master_1", campaignId: "camp_1" }, NOW);
  const result = review({
    rules: [{ id: routingRule.id, clientAccountId: routingRule.clientAccountId, campaignId: routingRule.campaignId, active: routingRule.active, deliveryEnabled: routingRule.deliveryEnabled }],
  });
  const after = matchCampaignRoutingRule([routingRule], { masterClientAccountId: "master_1", campaignId: "camp_1" }, NOW);
  assert.equal(before.matched, true);
  assert.equal(before.destinationClientAccountId, "client_a");
  assert.deepEqual(after, before);
  assert.equal(result.routingRuleWrite, false);
  assert.equal(result.campaignStatus, "live_routing_rule");
  assert.equal(routingRule.active, true);
  assert.equal(routingRule.deliveryEnabled, false);
});
