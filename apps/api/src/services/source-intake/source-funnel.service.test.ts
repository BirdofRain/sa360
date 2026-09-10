import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyClientNameSuggestion,
  confirmedOriginClientAccountId,
  isTrustworthyNextGenFunnelIdentity,
  observeNextGenSourceFunnel,
} from "./source-funnel.service.js";
import type { NextGenSourceIdentity } from "./leadcapture-nextgen-source-identity.js";

function identity(partial: Partial<NextGenSourceIdentity>): NextGenSourceIdentity {
  return {
    sourceCampaignId: partial.sourceCampaignId ?? "route",
    sourceCampaignName: partial.sourceCampaignName ?? null,
    sourceFunnelName: partial.sourceFunnelName ?? null,
    stableSourceId: partial.stableSourceId ?? null,
    stableSourceIdKind: partial.stableSourceIdKind ?? "route_key",
    routeKey: partial.routeKey ?? "LCIO_NG_NURSE_ANDRU_DURANSO",
    routeKeyIdentityMismatch: partial.routeKeyIdentityMismatch ?? false,
  };
}

test("trustworthy identity requires immutable funnel/form/campaign UUID, not a route key", () => {
  assert.equal(
    isTrustworthyNextGenFunnelIdentity(
      identity({ stableSourceId: "funnel-1", stableSourceIdKind: "funnel_id" })
    ),
    true
  );
  assert.equal(
    isTrustworthyNextGenFunnelIdentity(
      identity({ stableSourceId: "form-1", stableSourceIdKind: "form_id" })
    ),
    true
  );
  assert.equal(
    isTrustworthyNextGenFunnelIdentity(
      identity({ stableSourceId: "sa360-form", stableSourceIdKind: "sa360_form_id" })
    ),
    true
  );
  assert.equal(
    isTrustworthyNextGenFunnelIdentity(
      identity({
        stableSourceId: "11111111-2222-4333-8444-555555555555",
        stableSourceIdKind: "campaign_id",
      })
    ),
    true
  );
  assert.equal(
    isTrustworthyNextGenFunnelIdentity(
      identity({ stableSourceId: null, stableSourceIdKind: "route_key" })
    ),
    false
  );
});

test("exactly one client match suggests; zero or many stay unassociated", () => {
  assert.deepEqual(classifyClientNameSuggestion([{ clientAccountId: "only" }]), {
    associationStatus: "suggested",
    suggestedClientAccountId: "only",
    matchCount: 1,
  });
  assert.deepEqual(classifyClientNameSuggestion([]), {
    associationStatus: "unassociated",
    suggestedClientAccountId: null,
    matchCount: 0,
  });
  assert.deepEqual(
    classifyClientNameSuggestion([{ clientAccountId: "a" }, { clientAccountId: "b" }]),
    {
      associationStatus: "unassociated",
      suggestedClientAccountId: null,
      matchCount: 2,
    }
  );
});

test("only confirmed association yields an origin stamp", () => {
  assert.equal(
    confirmedOriginClientAccountId({
      associationStatus: "suggested",
      originClientAccountId: "should_not_stamp",
    }),
    null
  );
  assert.equal(
    confirmedOriginClientAccountId({
      associationStatus: "confirmed",
      originClientAccountId: "client_origin",
    }),
    "client_origin"
  );
  assert.equal(
    confirmedOriginClientAccountId({
      associationStatus: "confirmed",
      originClientAccountId: null,
    }),
    null
  );
});

test("observe does not fabricate a SourceFunnel when only a route key is present", async () => {
  const result = await observeNextGenSourceFunnel({
    identity: identity({ stableSourceId: null, stableSourceIdKind: "route_key" }),
  });
  assert.equal(result.observed, false);
  assert.equal(result.sourceFunnel, null);
  assert.equal(result.skippedReason, "missing_immutable_funnel_id");
});
