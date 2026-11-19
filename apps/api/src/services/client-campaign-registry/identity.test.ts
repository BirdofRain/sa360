import assert from "node:assert/strict";
import test from "node:test";

import {
  duplicateIdentityInSet,
  funnelIdentifierConsistent,
  identityKey,
  isCampaignNicheKey,
  isCampaignProductType,
  isLooseRoutingMatch,
  normalizeParentUrlIdentity,
  prepareBinding,
  publicExactOverlap,
} from "./identity.js";

test("catalog niche and product values are exact and display text is not a niche", () => {
  assert.equal(isCampaignNicheKey("VET"), true);
  assert.equal(isCampaignNicheKey("NURSE"), true);
  assert.equal(isCampaignNicheKey("FEX"), true);
  assert.equal(isCampaignNicheKey("vet_fex"), false);
  assert.equal(isCampaignNicheKey("Veteran FEX"), false);
  assert.equal(isCampaignProductType("life_insurance"), true);
  assert.equal(isCampaignProductType("final_expense"), false);
});

test("parent URL identity drops the query and does not treat a label as a URL", () => {
  assert.equal(
    normalizeParentUrlIdentity("https://my.leadcapture.io/p/vet-a?utm_campaign=veteran"),
    "my.leadcapture.io/p/vet-a"
  );
  assert.equal(normalizeParentUrlIdentity("my.leadcapture.io/p/vet-a"), "my.leadcapture.io/p/vet-a");
  assert.equal(normalizeParentUrlIdentity("Veteran FEX Campaign A"), null);
});

test("form id and provider funnel id stay different identities when the text matches", () => {
  const shared = "form-77";
  const form = { provider: "facebook" as const, kind: "form_id" as const, normalizedValue: shared };
  const funnel = { provider: "facebook" as const, kind: "provider_funnel_id" as const, normalizedValue: shared };
  assert.notEqual(identityKey(form), identityKey(funnel));
});

test("a suggested binding keeps incomplete evidence and cannot carry an exact id", () => {
  const suggested = prepareBinding(draft({ requestedStatus: "suggested", evidence: { note: "page A", observedLabel: "Veteran" } }));
  assert.equal(suggested.ok, true);
  if (suggested.ok) {
    assert.deepEqual(suggested.binding.identities, []);
    assert.equal(suggested.binding.evidence.observedLabel, "Veteran");
  }
  const withId = prepareBinding(draft({ requestedStatus: "suggested", formId: "999" }));
  assert.equal(withId.ok, false);
  if (!withId.ok) assert.equal(withId.error, "suggested_with_exact_identifier");
});

test("recorded and approved bindings require a provider and an exact identifier", () => {
  const missing = prepareBinding(draft({ requestedStatus: "recorded" }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "exact_identifier_required");
  const noProvider = prepareBinding(draft({ requestedStatus: "approved", formId: "999" }));
  assert.equal(noProvider.ok, false);
  if (!noProvider.ok) assert.equal(noProvider.error, "provider_identity_missing");
  const ready = prepareBinding(
    draft({ requestedStatus: "approved", provider: "facebook", formId: "999", campaignId: "888" })
  );
  assert.equal(ready.ok, true);
  if (ready.ok) assert.equal(ready.binding.identities.length, 2);
});

test("duplicate exact identifiers in one save are visible before a write", () => {
  const first = prepareBinding(draft({ bindingKey: "one", requestedStatus: "recorded", provider: "facebook", formId: "999" }));
  const second = prepareBinding(
    draft({ bindingKey: "two", requestedStatus: "recorded", provider: "facebook", formId: "999" })
  );
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) assert.equal(duplicateIdentityInSet([first.binding, second.binding]), true);
});

test("another client's overlap does not expose that client's id", () => {
  const conflict = publicExactOverlap({
    kind: "campaign_id",
    ownerClientAccountId: "other-client",
    ownerCampaignId: "cothercampaign000000000000",
    currentClientAccountId: "this-client",
  });
  assert.equal(conflict.scope, "other_client");
  assert.equal("campaignId" in conflict, false);
  assert.equal(JSON.stringify(conflict).includes("other-client"), false);
});

test("UTM and keyword rules are loose matches", () => {
  assert.equal(isLooseRoutingMatch("utm_campaign"), true);
  assert.equal(isLooseRoutingMatch("keyword_fallback"), true);
  assert.equal(isLooseRoutingMatch("form_id_utm_campaign"), false);
  assert.equal(isLooseRoutingMatch("campaign_id"), false);
});

test("approval requires the funnel's stored identifier and a missing value is not a match", () => {
  const supplied = {
    provider: "leadcapture_io" as const,
    kind: "provider_funnel_id" as const,
    normalizedValue: "funnel-supplied",
  };
  assert.equal(
    funnelIdentifierConsistent({
      requestedStatus: "approved",
      identities: [supplied],
      providerFunnelId: null,
      parentUrlKey: "my.leadcapture.io/p/vet-a",
    }),
    false
  );
  assert.equal(
    funnelIdentifierConsistent({
      requestedStatus: "recorded",
      identities: [supplied],
      providerFunnelId: null,
      parentUrlKey: "my.leadcapture.io/p/vet-a",
    }),
    true
  );
  assert.equal(
    funnelIdentifierConsistent({
      requestedStatus: "approved",
      identities: [supplied],
      providerFunnelId: "funnel-stored",
      parentUrlKey: "my.leadcapture.io/p/vet-a",
    }),
    false
  );
  assert.equal(
    funnelIdentifierConsistent({
      requestedStatus: "recorded",
      identities: [{ ...supplied, normalizedValue: "funnel-stored" }],
      providerFunnelId: "funnel-stored",
      parentUrlKey: null,
    }),
    true
  );
  assert.equal(
    funnelIdentifierConsistent({
      requestedStatus: "approved",
      identities: [
        { ...supplied, normalizedValue: "funnel-stored" },
        { provider: "leadcapture_io", kind: "form_id", normalizedValue: "funnel-stored" },
      ],
      providerFunnelId: "funnel-stored",
      parentUrlKey: "https://my.leadcapture.io/p/vet-a?utm_campaign=veteran",
    }),
    true
  );
  assert.equal(
    funnelIdentifierConsistent({
      requestedStatus: "approved",
      identities: [
        {
          provider: "leadcapture_io",
          kind: "parent_url_key",
          normalizedValue: "my.leadcapture.io/p/vet-a",
        },
      ],
      providerFunnelId: null,
      parentUrlKey: "https://my.leadcapture.io/p/vet-a?utm_campaign=veteran",
    }),
    true
  );
});

function draft(overrides: Partial<Parameters<typeof prepareBinding>[0]> = {}): Parameters<typeof prepareBinding>[0] {
  return {
    bindingKey: "source-a",
    requestedStatus: "suggested",
    sourceFunnelId: null,
    campaignRoutingRuleId: null,
    provider: null,
    providerFunnelId: null,
    parentUrlKey: null,
    campaignId: null,
    formId: null,
    adsetId: null,
    adId: null,
    evidence: null,
    ...overrides,
  };
}
