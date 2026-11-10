import assert from "node:assert/strict";
import test from "node:test";

import {
  disabledSourceCampaignRequest,
  draftMatchesSavedSetup,
  echoSavedSourceCampaignIdentity,
  parseSourceCampaignRequestHead,
  parseStoredSourceCampaignRequest,
  presentSourceCampaignRequestProgress,
  readUnstoredRequestError,
  sourceCampaignRequestBlockedReason,
  storedRequestMessage,
  unstoredRequestMessage,
} from "./source-campaign-request.ts";
import { isSourceCampaignRequestEnabled } from "./source-campaign-request-env.ts";
import type { SourceCampaignReviewView } from "./source-campaign-review.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function boundary() {
  return {
    associationApplied: false,
    routingRuleApplied: false,
    deliveryArmed: false,
    confirmedOperationalAssociation: false,
  };
}

function review(revision: number, overrides: Partial<SourceCampaignReviewView> = {}): SourceCampaignReviewView {
  return {
    availability: "ready",
    disposition: "saved_request",
    revision,
    requested: { trafficSourceName: "North", providerFunnelId: "funnel-1", providerCampaignId: "camp-1" },
    sourceStatus: "registered_unconfirmed",
    campaignStatus: "no_matching_rule",
    sourceAssociated: false,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: false,
    campaignOwnership: "none",
    attention: [],
    ...overrides,
  };
}

test("the request flag accepts only exact true", () => {
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "true" }), true);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: " true " }), true);
  for (const value of [undefined, "", "TRUE", "1", "yes", "on", "false"]) {
    assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: value }), false, String(value));
  }
});

test("all four flags stay off until each one is exact", () => {
  const keys = [
    "NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED",
    "SA360_TEAM_WORKSPACE_ENABLED",
    "SA360_NATIVE_CLIENT_SETUP_ENABLED",
    "SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(sourceCampaignRequestBlockedReason(), "team_workspace");
    process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
    assert.equal(sourceCampaignRequestBlockedReason(), "team_workspace_server");
    process.env.SA360_TEAM_WORKSPACE_ENABLED = "TRUE";
    assert.equal(sourceCampaignRequestBlockedReason(), "team_workspace_server");
    process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
    process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "false";
    assert.equal(sourceCampaignRequestBlockedReason(), "native_setup");
    process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "yes";
    assert.equal(sourceCampaignRequestBlockedReason(), "request_flag");
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";
    assert.equal(sourceCampaignRequestBlockedReason(), null);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("saved identifiers are echoed from the setup document, including a page URL", () => {
  const echoed = echoSavedSourceCampaignIdentity({
    providerFunnelId: "funnel-1",
    providerCampaignId: " camp-1 ",
    nextgenFunnelUrl: "https://Go.Example.com/vet/?v=9#form",
  });
  assert.deepEqual(echoed, {
    providerFunnelId: "funnel-1",
    parentUrlKey: "go.example.com/vet",
    providerCampaignId: "camp-1",
    complete: true,
  });
  const fromFunnelUrl = echoSavedSourceCampaignIdentity({
    providerFunnelId: "https://pages.example.com/offer/",
    providerCampaignId: "camp-1",
  });
  assert.equal(fromFunnelUrl?.providerFunnelId, null);
  assert.equal(fromFunnelUrl?.parentUrlKey, "pages.example.com/offer");
  assert.equal(echoSavedSourceCampaignIdentity({ providerFunnelId: "funnel-1" })?.complete, false);
  assert.equal(
    draftMatchesSavedSetup({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }, { providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
    true
  );
  assert.equal(
    draftMatchesSavedSetup({ providerFunnelId: "edited", providerCampaignId: "camp-1" }, { providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
    false
  );
});

test("the head read keeps the open proposal and drops an operational payload", () => {
  const open = {
    requestId: REQUEST_ID,
    status: "requested",
    revision: 4,
    setupRevision: 2,
    providerFunnelId: "funnel-1",
    parentUrlKey: "go.example.com/vet",
    providerCampaignId: "camp-1",
    requestedAssociation: true,
    createdAt: "2026-11-10T16:00:00.000Z",
  };
  const parsed = parseSourceCampaignRequestHead({
    ok: true,
    clientAccountId: "alex_gross",
    revision: 4,
    openRequest: open,
    ...boundary(),
  });
  assert.equal(parsed?.availability, "ready");
  if (parsed?.availability === "ready") {
    assert.equal(parsed.revision, 4);
    assert.equal(parsed.openRequest?.revision, 4);
    assert.equal(parsed.openRequest?.status, "requested");
    assert.equal(parsed.openRequest?.setupRevision, 2);
  }
  assert.equal(
    parseSourceCampaignRequestHead({ ok: true, clientAccountId: "alex_gross", revision: 4, openRequest: null, ...boundary(), associationApplied: true }),
    null
  );
  assert.equal(parseSourceCampaignRequestHead({ ok: true, clientAccountId: "alex_gross", revision: 4, openRequest: { ...open, status: "approved" }, ...boundary() }), null);
  assert.equal(parseSourceCampaignRequestHead({ ok: true, clientAccountId: "alex_gross", revision: 4, openRequest: { ...open, providerCampaignId: "  " }, ...boundary() }), null);
});

test("an older open proposal stays readable after a newer ownership rejection", () => {
  const open = {
    requestId: REQUEST_ID,
    status: "requested",
    revision: 1,
    setupRevision: 2,
    providerFunnelId: "funnel-1",
    parentUrlKey: null,
    providerCampaignId: "camp-1",
    requestedAssociation: true,
    createdAt: "2026-11-10T16:00:00.000Z",
  };
  const parsed = parseSourceCampaignRequestHead({
    ok: true,
    clientAccountId: "alex_gross",
    revision: 2,
    openRequest: open,
    ...boundary(),
  });
  assert.equal(parsed?.availability, "ready");
  if (parsed?.availability !== "ready" || !parsed.openRequest) return;
  assert.equal(parsed.revision, 2);
  assert.equal(parsed.openRequest.revision, 1);
  assert.equal(parsed.openRequest.setupRevision, 2);
  assert.equal(parsed.openRequest.providerFunnelId, "funnel-1");
  assert.equal(parsed.openRequest.providerCampaignId, "camp-1");
  assert.equal(parsed.openRequest.createdAt, "2026-11-10T16:00:00.000Z");
  const steps = presentSourceCampaignRequestProgress({
    setupReadable: true,
    setupRevision: 2,
    draftMatchesSaved: true,
    echo: echoSavedSourceCampaignIdentity({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
    review: review(2),
    request: parsed,
  });
  assert.equal(steps.find((step) => step.id === "request_submitted")?.state, "complete");
  assert.match(steps.find((step) => step.id === "request_submitted")?.detail ?? "", /revision 1/);
  assert.equal(steps.find((step) => step.id === "awaiting_review")?.state, "current");
  assert.equal(
    parseSourceCampaignRequestHead({
      ok: true,
      clientAccountId: "alex_gross",
      revision: 2,
      openRequest: { ...open, revision: 3 },
      ...boundary(),
    }),
    null
  );
});

test("a stored rejection is separate from an unstored conflict", () => {
  const stored = parseStoredSourceCampaignRequest({
    ok: false,
    error: "source_owned_by_other_client",
    replayed: false,
    status: "rejected",
    requestId: REQUEST_ID,
    associationRequestId: REQUEST_ID,
    revision: 3,
    ...boundary(),
  });
  assert.equal(stored?.ok, false);
  assert.equal(stored?.status, "rejected");
  assert.match(storedRequestMessage(stored!), /not an operator rejection/);
  assert.equal(readUnstoredRequestError({ ok: false, error: "revision_conflict", replayed: false }), "revision_conflict");
  assert.match(unstoredRequestMessage("setup_stale"), /Nothing new was stored/);
  assert.match(unstoredRequestMessage("revision_conflict"), /request chain changed/i);
  const success = parseStoredSourceCampaignRequest({
    ok: true,
    replayed: true,
    status: "requested",
    requestId: REQUEST_ID,
    associationRequestId: REQUEST_ID,
    revision: 5,
    setupRevision: 2,
    providerFunnelId: "funnel-1",
    parentUrlKey: null,
    providerCampaignId: "camp-1",
    requestedAssociation: true,
    dispositionReason: null,
    supersededRequestId: OTHER_ID,
    ...boundary(),
  });
  assert.equal(success?.replayed, true);
  assert.equal(success?.supersededRequestId, OTHER_ID);
  assert.match(storedRequestMessage(success!), /previous open proposal was replaced/);
  assert.match(storedRequestMessage(success!), /operational review/);
});

test("progress follows saved evidence and does not treat a proposal as acceptance", () => {
  const echo = echoSavedSourceCampaignIdentity({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1", nextgenFunnelUrl: "https://go.example.com/vet" });
  const request = parseSourceCampaignRequestHead({
    ok: true,
    clientAccountId: "alex_gross",
    revision: 4,
    openRequest: {
      requestId: REQUEST_ID,
      status: "requested",
      revision: 4,
      setupRevision: 2,
      providerFunnelId: "funnel-1",
      parentUrlKey: "go.example.com/vet",
      providerCampaignId: "camp-1",
      requestedAssociation: true,
      createdAt: "2026-11-10T16:00:00.000Z",
    },
    ...boundary(),
  });
  assert.ok(request);
  const steps = presentSourceCampaignRequestProgress({
    setupReadable: true,
    setupRevision: 2,
    draftMatchesSaved: true,
    echo,
    review: review(2),
    request: request!,
  });
  assert.deepEqual(
    steps.map((step) => [step.id, step.state]),
    [
      ["draft_saved", "complete"],
      ["source_reviewed", "complete"],
      ["request_submitted", "complete"],
      ["awaiting_review", "current"],
    ]
  );
  assert.equal(steps.some((step) => /approved|confirmed association/i.test(step.detail)), false);
  const incomplete = presentSourceCampaignRequestProgress({
    setupReadable: true,
    setupRevision: 0,
    draftMatchesSaved: true,
    echo: echoSavedSourceCampaignIdentity({ providerFunnelId: "", providerCampaignId: "" }),
    review: review(0),
    request: parseSourceCampaignRequestHead({
      ok: true,
      clientAccountId: "alex_gross",
      revision: 0,
      openRequest: null,
      ...boundary(),
    })!,
  });
  assert.deepEqual(
    incomplete.map((step) => step.state),
    ["current", "waiting", "waiting", "waiting"]
  );
  assert.match(incomplete[0]?.detail ?? "", /missing a funnel id/);
  assert.match(incomplete[1]?.detail ?? "", /source check ran/);

  const dirty = presentSourceCampaignRequestProgress({
    setupReadable: true,
    setupRevision: 2,
    draftMatchesSaved: false,
    echo,
    review: review(2),
    request: request!,
  });
  assert.equal(dirty[0]?.state, "current");
  assert.match(dirty[0]?.detail ?? "", /Save the onboarding draft/);
  assert.equal(dirty[2]?.state, "waiting");

  const disabled = presentSourceCampaignRequestProgress({
    setupReadable: false,
    setupRevision: null,
    draftMatchesSaved: false,
    echo: null,
    review: null,
    request: disabledSourceCampaignRequest("request_flag"),
  });
  assert.equal(disabled[2]?.state, "waiting");
  assert.match(disabled[2]?.detail ?? "", /turned off/);
});
