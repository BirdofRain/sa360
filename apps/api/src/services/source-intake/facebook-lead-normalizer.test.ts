import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignRoutingRule } from "@prisma/client";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import {
  buildFacebookLeadUid,
  coerceFacebookLeadFields,
  normalizeFacebookLeadToLifecyclePayload,
  resolveFacebookRouteKey,
  type FacebookLeadFields,
} from "./facebook-lead-normalizer.js";
import {
  extractLeadgenEnvelopes,
  mapMetaLeadToFacebookFields,
} from "./meta-lead-graph.service.js";

const MASTER = "lal_master_vet";
const CAMPAIGN_ID = "120243339037000760";
const NOW = new Date("2026-06-24T12:00:00.000Z");

function baseFields(overrides: Partial<FacebookLeadFields> = {}): FacebookLeadFields {
  return {
    leadgenId: "lead_001",
    pageId: "page_1",
    formId: "form_9",
    campaignId: CAMPAIGN_ID,
    campaignName: "Breanne Kimberling- Vet FEX- 4/30/26",
    adsetId: "adset_2",
    adId: "ad_3",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.test",
    phone: "+1 415 555 0100",
    state: "Texas",
    ...overrides,
  };
}

function rule(
  partial: Partial<CampaignRoutingRule> &
    Pick<CampaignRoutingRule, "id" | "matchType" | "clientAccountId">
): CampaignRoutingRule {
  return {
    masterClientAccountId: MASTER,
    destinationSubaccountIdGhl: "loc_demo",
    clientDisplayName: "SA360 Demo",
    nicheKey: null,
    productType: null,
    sourcePlatform: null,
    sourceType: null,
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: null,
    utmContent: null,
    masterDatasetId: null,
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
    locationName: null,
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
    ...partial,
  };
}

test("normalizer maps Meta fields into lifecycle payload + stable identity", () => {
  const payload = normalizeFacebookLeadToLifecyclePayload(baseFields(), {
    masterClientAccountId: MASTER,
  });
  assert.equal(payload.client_account_id, MASTER);
  assert.equal(payload.contact.lead_uid, buildFacebookLeadUid("lead_001"));
  assert.equal(payload.contact.first_name, "Jane");
  assert.equal(payload.attribution?.campaign_id, CAMPAIGN_ID);
  assert.equal(payload.attribution?.source_platform, "facebook");
  // form_id is surfaced under routing so the existing matcher can read it.
  assert.equal((payload.routing as Record<string, unknown>).form_id, "form_9");
  assert.equal(payload.event.event_name_internal, "lead_created");
  assert.equal(payload.event.send_to_meta, false);
});

test("campaign_id exact rule matches normalized Facebook lead with high confidence", () => {
  const payload = normalizeFacebookLeadToLifecyclePayload(baseFields(), {
    masterClientAccountId: MASTER,
  });
  const input = extractRoutingAttributionFromPayload(payload);
  const result = matchCampaignRoutingRule(
    [
      rule({
        id: "r_campaign",
        matchType: "campaign_id",
        clientAccountId: "sa360_demo",
        campaignId: CAMPAIGN_ID,
        sourcePlatform: "facebook",
      }),
    ],
    input,
    NOW
  );
  assert.equal(result.matched, true);
  assert.equal(result.matchedRuleId, "r_campaign");
  assert.equal(result.destinationClientAccountId, "sa360_demo");
  assert.equal(result.confidence, "high");
});

test("unmatched Facebook lead yields review-required result", () => {
  const payload = normalizeFacebookLeadToLifecyclePayload(
    baseFields({ campaignId: "unknown_campaign", formId: undefined }),
    { masterClientAccountId: MASTER }
  );
  const input = extractRoutingAttributionFromPayload(payload);
  const result = matchCampaignRoutingRule(
    [
      rule({
        id: "r_campaign",
        matchType: "campaign_id",
        clientAccountId: "sa360_demo",
        campaignId: CAMPAIGN_ID,
      }),
    ],
    input,
    NOW
  );
  assert.equal(result.matched, false);
  assert.equal(result.confidence, "none");
  assert.match(result.reason.toLowerCase(), /review/);
});

test("coerceFacebookLeadFields accepts snake_case and synthesizes missing leadgen id", () => {
  const fields = coerceFacebookLeadFields({
    campaign_id: CAMPAIGN_ID,
    first_name: "Sam",
    phone_number: "+14155550100",
  });
  assert.ok(fields);
  assert.equal(fields!.campaignId, CAMPAIGN_ID);
  assert.equal(fields!.firstName, "Sam");
  assert.equal(fields!.phone, "+14155550100");
  assert.match(fields!.leadgenId, /^test_/);
});

test("coerceFacebookLeadFields returns null for non-object bodies", () => {
  assert.equal(coerceFacebookLeadFields(null), null);
  assert.equal(coerceFacebookLeadFields("nope"), null);
  assert.equal(coerceFacebookLeadFields([1, 2]), null);
});

test("extractLeadgenEnvelopes pulls leadgen change values from a webhook notification", () => {
  const envelopes = extractLeadgenEnvelopes({
    object: "page",
    entry: [
      {
        id: "page_77",
        time: 1717000000,
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: "lg_555",
              form_id: "form_9",
              ad_id: "ad_3",
              created_time: 1717000000,
            },
          },
        ],
      },
    ],
  });
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].leadgenId, "lg_555");
  assert.equal(envelopes[0].pageId, "page_77");
  assert.equal(envelopes[0].formId, "form_9");
});

test("mapMetaLeadToFacebookFields flattens field_data + splits full name", () => {
  const fields = mapMetaLeadToFacebookFields(
    {
      id: "lg_555",
      campaign_id: CAMPAIGN_ID,
      form_id: "form_9",
      field_data: [
        { name: "full_name", values: ["Jane Q Doe"] },
        { name: "email", values: ["jane@example.test"] },
        { name: "phone_number", values: ["+14155550100"] },
        { name: "veteran_status", values: ["Disabled Veteran"] },
      ],
    },
    { leadgenId: "lg_555", pageId: "page_77", formId: "form_9" }
  );
  assert.equal(fields.leadgenId, "lg_555");
  assert.equal(fields.firstName, "Jane");
  assert.equal(fields.lastName, "Q Doe");
  assert.equal(fields.email, "jane@example.test");
  assert.equal(fields.phone, "+14155550100");
  assert.equal(fields.custom?.veteran_status, "Disabled Veteran");
  assert.equal(resolveFacebookRouteKey(fields), "form_9");
});
