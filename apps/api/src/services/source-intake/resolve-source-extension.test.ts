import assert from "node:assert/strict";
import test from "node:test";

import { buildResolveSourceExtension } from "./resolve-source-extension.js";

test("resolve source snapshot keeps campaign identity and refuses delivery or recapture", () => {
  const snapshot = buildResolveSourceExtension({
    fields: {
      leadgenId: "900000000000301",
      pageId: "900000000000101",
      formId: "900000000000201",
      campaignId: "900000000000401",
      campaignName: "Shared form campaign",
      adsetId: "900000000000501",
      adId: "900000000000601",
      adgroupId: "900000000000701",
      adAccountId: "900000000000801",
      utmSource: "facebook",
      utmCampaign: "shared",
      customFields: { which_branch: "Navy", utm_source: "facebook" },
    },
    association: {
      outcome: "unassociated",
      clientAccountId: null,
      sourceFunnelId: null,
      pageId: "900000000000101",
      formId: "900000000000201",
      explanation: "No confirmed Page and Form owner.",
    },
  });

  assert.equal(snapshot.implemented, false);
  assert.equal(snapshot.pageFormIdentifiesOneClient, false);
  assert.equal(snapshot.associationScope, "page_form");
  assert.equal(snapshot.associationOutcomeAtCapture, "unassociated");
  assert.equal(snapshot.confirmedClientAccountId, null);
  assert.equal(snapshot.deliveryOnLaterMatch, false);
  assert.equal(snapshot.sourceLeadUid, "facebook-meta_lead_ads-900000000000301");
  assert.equal(snapshot.campaignId, "900000000000401");
  assert.equal(snapshot.adAccountId, "900000000000801");
  assert.deepEqual(snapshot.answerFieldNames, ["utm_source", "which_branch"]);
  assert.equal(snapshot.answersRetainedOn, "normalizedPayload.custom_fields");
  assert.equal(snapshot.reevaluate.recapturesLead, false);
  assert.equal(snapshot.reevaluate.startsDelivery, false);
  assert.equal(snapshot.reevaluate.createsClient, false);
  assert.deepEqual(snapshot.reevaluate.appliesTo, ["meta_lead_ads", "zapier_facebook"]);
});
