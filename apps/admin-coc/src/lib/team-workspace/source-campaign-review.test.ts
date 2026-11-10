import assert from "node:assert/strict";
import test from "node:test";

import { parseSourceCampaignReview, presentSourceCampaignReview, type SourceCampaignReviewView } from "./source-campaign-review.ts";

function view(overrides: Partial<SourceCampaignReviewView> = {}): SourceCampaignReviewView {
  return {
    availability: "ready",
    disposition: "saved_request",
    revision: 4,
    requested: { trafficSourceName: "NextGen page", providerFunnelId: "funnel-1", providerCampaignId: "campaign-1" },
    sourceStatus: "confirmed_for_client",
    campaignStatus: "live_routing_rule",
    sourceAssociated: true,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: true,
    campaignOwnership: "this_client",
    attention: ["This client has a live routing rule, and delivery is not enabled on it."],
    ...overrides,
  };
}

test("a confirmed source and a live rule with delivery off stay distinct from delivery confirmed", () => {
  const presented = presentSourceCampaignReview(view(), "alex_gross");
  assert.match(presented.requested, /funnel-1/);
  assert.match(presented.requested, /campaign-1/);
  assert.match(presented.sourceRegistered, /^Yes/);
  assert.equal(presented.sourceOwnership, "Confirmed for this client.");
  assert.equal(presented.conflicts, "None found.");
  assert.match(presented.liveRouting, /this client/i);
  assert.match(presented.deliveryEnabled, /does not have delivery enabled/);
  assert.match(presented.deliveryConfirmed, /^No/);
  assert.equal(presented.next?.href, "/clients/alex_gross");
});

test("a suggestion, another client's source, and ambiguity are not ownership confirmation", () => {
  const suggestion = presentSourceCampaignReview(view({ sourceStatus: "registered_unconfirmed", sourceAssociated: false, campaignStatus: "no_matching_rule", liveRouting: false, campaignOwnership: "none" }), "alex_gross");
  assert.match(suggestion.sourceOwnership, /Not confirmed/);
  assert.match(suggestion.sourceOwnership, /suggestion/);
  assert.match(suggestion.campaignRule, /No campaign routing rule/);

  const other = presentSourceCampaignReview(
    view({ sourceStatus: "confirmed_for_other_client", sourceAssociated: false, campaignStatus: "incomplete", liveRouting: false, campaignOwnership: "none", requested: { trafficSourceName: null, providerFunnelId: "funnel-1", providerCampaignId: null } }),
    "alex_gross"
  );
  assert.match(other.sourceOwnership, /different client/);
  assert.match(other.conflicts, /another client/);

  const ambiguous = presentSourceCampaignReview(view({ sourceStatus: "ambiguous", sourceAssociated: false, liveRouting: false, campaignStatus: "incomplete", campaignOwnership: "none" }), "alex_gross");
  assert.match(ambiguous.sourceOwnership, /do not agree/);
  assert.match(ambiguous.conflicts, /do not agree/);
});

test("another client's live rule is not delivery enabled for this client", () => {
  const presented = presentSourceCampaignReview(
    view({ sourceAssociated: true, deliveryActivated: false, campaignOwnership: "another_client", liveRouting: true }),
    "alex_gross"
  );
  assert.match(presented.liveRouting, /another client/);
  assert.match(presented.deliveryEnabled, /does not enable delivery for this client/);
  assert.match(presented.deliveryConfirmed, /^No/);
});

test("stale, unreadable, and unavailable results are not presented as verification", () => {
  const stale = presentSourceCampaignReview(view({ disposition: "stale", sourceStatus: null, campaignStatus: null, sourceAssociated: false, liveRouting: false, campaignOwnership: "unknown", attention: ["Nothing was verified."] }), "alex_gross");
  assert.match(stale.sourceOwnership, /not a verification/i);
  assert.match(stale.deliveryEnabled, /not a verification/i);
  assert.equal(stale.next?.href, "/team-workspace/alex_gross?guide=sources");

  const unreadable = presentSourceCampaignReview(
    view({ availability: "unreadable", disposition: "unreadable", sourceStatus: null, campaignStatus: null, sourceAssociated: false, liveRouting: false, deliveryActivated: false, campaignOwnership: "unknown", requested: { trafficSourceName: null, providerFunnelId: null, providerCampaignId: null }, attention: ["Nothing was verified."] }),
    "alex_gross"
  );
  assert.equal(unreadable.next?.href, "/clients/alex_gross/onboarding");
  assert.match(unreadable.sourceRegistered, /not a verification/i);

  const unavailable = presentSourceCampaignReview(view({ availability: "unavailable", disposition: "unavailable", sourceStatus: null, campaignStatus: null, sourceAssociated: false, liveRouting: false, campaignOwnership: "unknown" }), "alex_gross");
  assert.match(unavailable.liveRouting, /not a verification/i);
});

test("a payload that marks another client's delivery as activated is not trusted", () => {
  const parsed = parseSourceCampaignReview({
    ok: true,
    availability: "ready",
    requestDisposition: "saved_request",
    revision: 4,
    requested: { trafficSourceName: null, providerFunnelId: "funnel-1", providerCampaignId: "campaign-1" },
    sourceStatus: "confirmed_for_client",
    campaignStatus: "live_routing_rule",
    sourceAssociated: true,
    deliveryActivated: true,
    deliveryConfirmed: false,
    liveRouting: true,
    campaignOwnership: "another_client",
    attention: ["Leave it unchanged."],
  });
  assert.ok(parsed);
  assert.equal(parsed?.deliveryActivated, false);
  assert.equal(parsed?.deliveryConfirmed, false);
});

test("delivery confirmed true is rejected instead of shown", () => {
  const parsed = parseSourceCampaignReview({
    ok: true,
    availability: "ready",
    requestDisposition: "saved_request",
    revision: 1,
    requested: { trafficSourceName: null, providerFunnelId: "funnel-1", providerCampaignId: null },
    sourceStatus: "confirmed_for_client",
    campaignStatus: "incomplete",
    sourceAssociated: true,
    deliveryActivated: false,
    deliveryConfirmed: true,
    liveRouting: false,
    campaignOwnership: "none",
    attention: [],
  });
  assert.equal(parsed, null);
});

test("unsaved form edits are called out and are not described as the saved request", () => {
  const presented = presentSourceCampaignReview(view(), "alex_gross", { providerFunnelId: "typed-later", providerCampaignId: "campaign-1" });
  assert.match(presented.unsavedNote ?? "", /Unsaved edits/);
  assert.match(presented.requested, /funnel-1/);
  assert.equal(presented.requested.includes("typed-later"), false);
});
