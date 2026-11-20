import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  interpretCampaignCommand,
  parseCampaignDetail,
  parseCampaignList,
  validateBindingDrafts,
  validateCreateDraft,
  type BindingDraftInput,
} from "./client-campaign-manager.ts";

const CLIENT = "client_123";
const VET_A = "c111111111111111111111111";
const VET_B = "c222222222222222222222222";
const NURSE = "c333333333333333333333333";
const REQUEST = "11111111-1111-4111-8111-111111111111";

test("two VET campaigns and one NURSE campaign stay distinct", () => {
  const campaigns = parseCampaignList(
    envelope([
      summary(VET_A, "vet-life", "VET", "Vet life"),
      summary(VET_B, "vet-life-west", "VET", "Vet life"),
      summary(NURSE, "nurse-health", "NURSE", "Nurse health"),
    ]),
    CLIENT
  );
  assert.ok(campaigns);
  assert.deepEqual(
    campaigns?.map((campaign) => campaign.id),
    [VET_A, VET_B, NURSE]
  );
  assert.equal(campaigns?.filter((campaign) => campaign.nicheKey === "VET").length, 2);
  assert.equal(campaigns?.[0]?.displayName, campaigns?.[1]?.displayName);
  assert.notEqual(campaigns?.[0]?.slug, campaigns?.[1]?.slug);
});

test("an inventory key is not accepted as a campaign id", () => {
  const listed = parseCampaignList(envelope([summary("source:facebook:form-1", "vet-life", "VET", "Vet life")]), CLIENT);
  assert.equal(listed, null);
  const detail = parseCampaignDetail(detailBody(summary("rule:utm:veteran", "vet-life", "VET", "Vet life")), CLIENT, "rule:utm:veteran");
  assert.equal(detail, null);
});

test("a response that claims an operational effect is not a saved campaign", () => {
  const body = envelope([summary(VET_A, "vet-life", "VET", "Vet life")]);
  body.operationalReady = true;
  assert.equal(parseCampaignList(body, CLIENT), null);
  const created = successBody(summary(VET_A, "vet-life", "VET", "Vet life"));
  created.sourceConfirmed = true;
  assert.equal(interpretCampaignCommand(created), null);
});

test("review required is a recorded command and does not count as a saved binding", () => {
  const result = interpretCampaignCommand({
    ...flags(),
    ok: false,
    statusCode: 409,
    replayed: false,
    error: "review_required",
    outcome: "REVIEW_REQUIRED",
    requestId: REQUEST,
    clientAccountId: CLIENT,
    campaignId: VET_A,
    revision: 2,
    conflicts: [
      {
        code: "exact_identifier_overlap",
        scope: "same_client",
        identifierKind: "form_id",
        bindingKey: "facebook-form",
        campaignId: VET_B,
        clientAccountId: "hidden-client",
      },
    ],
  });
  assert.ok(result);
  assert.equal(result?.stored, false);
  assert.equal(result?.recordedCommand, true);
  assert.equal(result?.retainRequestId, false);
  assert.match(result?.message ?? "", /not changed/);
  assert.equal(result?.conflicts[0]?.campaignId, VET_B);
  assert.equal(JSON.stringify(result?.conflicts).includes("hidden-client"), false);
});

test("unstored conflicts keep the request id except when that id was already used", () => {
  const inconsistent = interpretCampaignCommand({ ...flags(), ok: false, error: "identifier_inconsistent", replayed: false });
  assert.equal(inconsistent?.stored, false);
  assert.equal(inconsistent?.retainRequestId, true);
  const revision = interpretCampaignCommand({ ...flags(), ok: false, error: "revision_conflict", replayed: false });
  assert.equal(revision?.retainRequestId, true);
  const reused = interpretCampaignCommand({ ...flags(), ok: false, error: "request_id_conflict", replayed: false });
  assert.equal(reused?.stored, false);
  assert.equal(reused?.retainRequestId, false);
  const disabled = interpretCampaignCommand({ ...flags(), ok: false, error: "feature_disabled", replayed: false });
  assert.equal(disabled?.code, "client_campaign_registry_disabled");
  assert.equal(disabled?.stored, false);
});

test("a suggested request cannot carry an exact identifier", () => {
  const rejected = validateBindingDrafts([draft({ requestedStatus: "suggested", formId: "form-1" })]);
  assert.equal(rejected.ok, false);
  const recorded = validateBindingDrafts([draft({ requestedStatus: "recorded", provider: "facebook", formId: "form-1" })]);
  assert.equal(recorded.ok, true);
  if (recorded.ok) assert.equal(recorded.bindings[0]?.formId, "form-1");
  const missing = validateBindingDrafts([draft({ requestedStatus: "approved", provider: "facebook" })]);
  assert.equal(missing.ok, false);
});

test("create always starts at revision zero and does not accept a display name as the id", () => {
  const created = validateCreateDraft({
    clientAccountId: CLIENT,
    requestId: REQUEST,
    slug: "vet-life",
    displayName: "Vet life",
    nicheKey: "VET",
    productType: "life_insurance",
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.body.expectedRevision, 0);
    assert.equal(created.body.intent, "create");
    assert.equal("id" in created.body, false);
  }
});

test("campaign manager files do not perform operational writes", () => {
  const source = [
    readFileSync(new URL("./client-campaign-manager.ts", import.meta.url), "utf8"),
    readFileSync(new URL("./client-campaign-manager-load.ts", import.meta.url), "utf8"),
    readFileSync(new URL("./client-campaign-manager-env.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../app/actions/client-campaign-manager.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../components/team-workspace/campaign-manager.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../app/(dashboard)/team-workspace/[clientAccountId]/page.tsx", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(source.includes("confirmSource"), false);
  assert.equal(source.includes("routing/rules"), false);
  assert.equal(source.includes("googleapis"), false);
  assert.equal(source.includes("leadconnectorhq"), false);
  assert.equal(source.includes("prisma"), false);
  assert.equal(source.includes("SA360_ADMIN_API_KEY"), false);
  assert.equal(source.includes("x-sa360-admin-key"), false);
  assert.equal(source.includes("inventoryKey:"), false);
  assert.equal(source.includes("SourceLeadEvent"), false);
  assert.match(source, /isClientCampaignManagerEnabled\(\) \? await loadClientCampaignManager/);
  assert.match(source, /GuidedOnboarding/);
});

function draft(overrides: Partial<BindingDraftInput>): BindingDraftInput {
  return {
    bindingKey: "facebook-form",
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

function summary(id: string, slug: string, nicheKey: string, displayName: string) {
  return {
    id,
    clientAccountId: CLIENT,
    slug,
    displayName,
    nicheKey,
    productType: "life_insurance",
    status: "draft",
    revision: 1,
    bindingCount: 0,
    destinationSaved: false,
    configurationStatusEffect: "none",
    operationalReady: false,
    inventoryKeyUsed: false,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  };
}

function flags() {
  return {
    routingRuleApplied: false,
    sourceConfirmed: false,
    deliveryArmed: false,
    externalCall: false,
    inventoryKeyUsed: false,
    operationalReady: false,
    originConfirmed: false,
    changedClientDefaultWorkflow: false,
    tabContractChanged: false,
  };
}

function envelope(campaigns: unknown[]) {
  return { ok: true, statusCode: 200, clientAccountId: CLIENT, campaigns, ...flags() };
}

function detailBody(campaign: unknown) {
  return { ok: true, statusCode: 200, campaign, bindings: [], destination: null, ...flags() };
}

function successBody(campaign: ReturnType<typeof summary>) {
  return {
    ...flags(),
    ok: true,
    statusCode: 200,
    replayed: false,
    requestId: REQUEST,
    clientAccountId: CLIENT,
    campaignId: campaign.id,
    revision: campaign.revision,
    campaign,
    bindings: [],
    destination: null,
  };
}
