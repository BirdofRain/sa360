import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { CampaignLeadTypeDecision } from "../source-intake/campaign-lead-type.js";
import { leadTypeForShadow } from "./lead-type-for-shadow.js";
import {
  normalizeCatalogNicheKey,
  readIncomingNicheEvidence,
  type IncomingNicheEvidence,
} from "./niche-classification.js";
import {
  resolveClientCampaignShadow,
  type ShadowBindingCandidate,
  type ShadowCampaignConfig,
  type ShadowRoutingContext,
} from "./resolve-client-campaign-shadow.js";
import { extractShadowSourceEvidence } from "./source-evidence.js";

const CLIENT = "client_ray";
const OTHER = "other-client-secret";

function campaign(
  id: string,
  slug: string,
  niche: string,
  displayName = slug
): ShadowCampaignConfig {
  return {
    id,
    clientAccountId: CLIENT,
    slug,
    displayName,
    nicheKey: niche,
    productType: "life_insurance",
    status: "ready",
    revision: 3,
    destination: {
      workflowIdGhl: `wf-${slug}`,
      workflowTriggerMode: "tag_trigger",
      ghlLocationId: "loc_ray",
      spreadsheetId: "sheet_ray",
      worksheetId: niche === "NURSE" ? 2 : 1,
      worksheetTitle: niche === "NURSE" ? "Nurse" : "Vet",
    },
  };
}

function binding(
  bindingId: string,
  campaignId: string,
  kind: ShadowBindingCandidate["identities"][number]["kind"],
  value: string,
  clientAccountId = CLIENT,
  sourceFunnelId: string | null = null
): ShadowBindingCandidate {
  return {
    bindingId,
    clientCampaignId: campaignId,
    clientAccountId,
    sourceFunnelId,
    sourceFunnelOriginClientAccountId: sourceFunnelId ? clientAccountId : null,
    identities: [{ provider: "leadcapture_io", kind, normalizedValue: value }],
  };
}

function routing(
  authority = "confirmed_source_association",
  matchType: string | null = null,
  confirmedSourceFunnelId: string | null = null
): ShadowRoutingContext {
  return {
    clientAccountId: CLIENT,
    routingAuthority: authority,
    matchType,
    matched: true,
    matchedRuleId: authority === "campaign_routing_rule" ? "rule_1" : null,
    confirmedSourceFunnelId,
    confirmedSourceOriginClientAccountId: confirmedSourceFunnelId ? CLIENT : null,
  };
}

function evidence(kind: ShadowBindingCandidate["identities"][number]["kind"], value: string) {
  return [{ provider: "leadcapture_io", kind, normalizedValue: value }];
}

function niche(normalized: string | null, raw = normalized, provenance: IncomingNicheEvidence["trustedProvenance"] = "niche_key"): IncomingNicheEvidence {
  return {
    trustedProvenance: normalized || raw ? provenance : "none",
    trustedRawValue: raw,
    trustedNormalizedKey: normalized,
    unrecognized: Boolean(raw && !normalized),
    untrustedObservations: [],
    ignoredConsumerAnswer: false,
  };
}

const missingNiche: IncomingNicheEvidence = {
  trustedProvenance: "none",
  trustedRawValue: null,
  trustedNormalizedKey: null,
  unrecognized: false,
  untrustedObservations: [],
  ignoredConsumerAnswer: false,
};

function lead(key: "vet_web_form" | "nurse_web_form" | null, status: CampaignLeadTypeDecision["status"] = "resolved"): CampaignLeadTypeDecision {
  return {
    version: 1,
    status,
    leadTypeKey: status === "resolved" || status === "agreement" ? key : null,
    leadTypeLabel: key === "vet_web_form" ? "Vet Web Form" : key === "nurse_web_form" ? "Nurse Web Form" : null,
    binding: { kind: "confirmed_source_association", id: "sf_1", leadTypeKey: key },
    evidence: {
      trustedKey: status === "agreement" ? key : null,
      trustedAdapter: status === "agreement" ? "sa360_campaign_lead_type" : null,
      bindingKey: key,
      bypassedSourceLeadTypeKey: null,
    },
  };
}

function decide(input: {
  campaignId?: string;
  nicheKey?: string;
  slug?: string;
  value?: string;
  kind?: ShadowBindingCandidate["identities"][number]["kind"];
  bindings?: ShadowBindingCandidate[];
  campaigns?: ShadowCampaignConfig[];
  incoming?: IncomingNicheEvidence;
  routing?: ShadowRoutingContext;
  leadType?: CampaignLeadTypeDecision | null;
  loose?: boolean;
}) {
  const id = input.campaignId ?? "camp_a";
  const slug = input.slug ?? "vet-life-east";
  const nicheKey = input.nicheKey ?? "VET";
  const kind = input.kind ?? "provider_funnel_id";
  const value = input.value ?? "funnel-a";
  return resolveClientCampaignShadow({
    routing: input.routing ?? routing(),
    provider: "leadcapture_io",
    evidence: evidence(kind, value),
    looseEvidenceIgnored: input.loose ?? false,
    hadExactValuesWithoutProvider: false,
    bindings: input.bindings ?? [binding("bind_a", id, kind, value)],
    campaigns: input.campaigns ?? [campaign(id, slug, nicheKey, "Veteran FEX East")],
    incomingNiche: input.incoming ?? niche("VET"),
    leadTypeDecision: input.leadType === undefined ? lead("vet_web_form") : input.leadType,
  });
}

test("two VET campaigns and one NURSE campaign resolve by exact source", () => {
  const campaigns = [
    campaign("camp_a", "vet-life-east", "VET", "Veteran FEX East"),
    campaign("camp_b", "vet-life-west", "VET", "Veteran FEX East"),
    campaign("camp_n", "nurse-life", "NURSE", "Nurse Life"),
  ];
  const bindings = [
    binding("bind_a", "camp_a", "provider_funnel_id", "funnel-a"),
    binding("bind_b", "camp_b", "provider_funnel_id", "funnel-b"),
    binding("bind_n", "camp_n", "provider_funnel_id", "funnel-n"),
  ];
  const east = decide({ value: "funnel-a", bindings, campaigns, campaignId: "camp_a" });
  const west = decide({
    value: "funnel-b",
    bindings,
    campaigns,
    campaignId: "camp_b",
    slug: "vet-life-west",
    incoming: niche("VET"),
  });
  const nurse = decide({
    value: "funnel-n",
    bindings,
    campaigns,
    campaignId: "camp_n",
    slug: "nurse-life",
    nicheKey: "NURSE",
    incoming: niche("NURSE"),
    leadType: lead("nurse_web_form"),
  });
  assert.equal(east.status, "MATCHED");
  assert.equal(east.clientCampaignId, "camp_a");
  assert.equal(west.status, "MATCHED");
  assert.equal(west.clientCampaignId, "camp_b");
  assert.notEqual(east.clientCampaignId, west.clientCampaignId);
  assert.equal(east.campaignDisplayName, west.campaignDisplayName);
  assert.equal(east.configuredNicheKey, "VET");
  assert.equal(nurse.status, "MATCHED");
  assert.equal(nurse.clientCampaignId, "camp_n");
  assert.equal(nurse.configuredNicheKey, "NURSE");
  assert.equal(nurse.leadTypeDecision?.leadTypeKey, "nurse_web_form");
  assert.notEqual(nurse.leadTypeDecision?.leadTypeKey, nurse.configuredNicheKey);
});

test("two exact sources for one campaign resolve to that campaign", () => {
  const bindings = [
    binding("bind_a", "camp_a", "provider_funnel_id", "funnel-a"),
    binding("bind_a2", "camp_a", "provider_funnel_id", "funnel-a2"),
  ];
  const first = decide({ value: "funnel-a", bindings });
  const second = decide({ value: "funnel-a2", bindings });
  assert.equal(first.clientCampaignId, "camp_a");
  assert.equal(second.clientCampaignId, "camp_a");
  assert.deepEqual(second.matchedBindingIds, ["bind_a2"]);
});

test("no approved exact binding is unresolved and a loose UTM match cannot identify a campaign", () => {
  const none = decide({ bindings: [], value: "funnel-missing" });
  assert.equal(none.status, "UNRESOLVED");
  assert.equal(none.clientCampaignId, null);
  assert.deepEqual(none.reasonCodes, ["no_approved_exact_binding"]);
  assert.equal(none.proposedTags.authorized, false);

  const loose = resolveClientCampaignShadow({
    routing: routing("campaign_routing_rule", "utm_campaign"),
    provider: "leadcapture_io",
    evidence: [],
    looseEvidenceIgnored: true,
    hadExactValuesWithoutProvider: false,
    bindings: [binding("bind_a", "camp_a", "provider_funnel_id", "funnel-a")],
    campaigns: [campaign("camp_a", "vet-life-east", "VET")],
    incomingNiche: niche("VET"),
    leadTypeDecision: lead("vet_web_form"),
  });
  assert.equal(loose.status, "UNRESOLVED");
  assert.deepEqual(loose.reasonCodes, ["loose_evidence_only"]);
  assert.equal(loose.clientCampaignId, null);
  assert.equal(loose.proposedTags.authorized, false);

  const exactDespiteLooseRule = decide({
    routing: routing("campaign_routing_rule", "utm_campaign"),
    loose: true,
  });
  assert.equal(exactDespiteLooseRule.status, "MATCHED");
  assert.equal(exactDespiteLooseRule.winningRoutingAuthority, "campaign_routing_rule");
});

test("several eligible campaigns and a cross-client identifier are review required", () => {
  const sameStringDifferentKind = decide({
    bindings: [
      binding("bind_a", "camp_a", "provider_funnel_id", "funnel-a"),
      binding("bind_b", "camp_b", "form_id", "funnel-a"),
    ],
    campaigns: [
      campaign("camp_a", "vet-life-east", "VET", "Veteran FEX East"),
      campaign("camp_b", "vet-life-west", "VET", "Veteran FEX East"),
    ],
  });
  const split = resolveClientCampaignShadow({
    routing: routing(),
    provider: "leadcapture_io",
    evidence: [
      { provider: "leadcapture_io", kind: "provider_funnel_id", normalizedValue: "funnel-a" },
      { provider: "leadcapture_io", kind: "form_id", normalizedValue: "funnel-a" },
    ],
    looseEvidenceIgnored: false,
    hadExactValuesWithoutProvider: false,
    bindings: [
      binding("bind_a", "camp_a", "provider_funnel_id", "funnel-a"),
      binding("bind_b", "camp_b", "form_id", "funnel-a"),
    ],
    campaigns: [
      campaign("camp_a", "vet-life-east", "VET"),
      campaign("camp_b", "vet-life-west", "VET"),
    ],
    incomingNiche: niche("VET"),
    leadTypeDecision: lead("vet_web_form"),
  });
  assert.equal(split.status, "REVIEW_REQUIRED");
  assert.equal(split.clientCampaignId, null);
  assert.deepEqual(split.reviewCandidateCampaignIds, ["camp_a", "camp_b"]);
  assert.equal(split.proposedTags.authorized, false);
  assert.equal(sameStringDifferentKind.status, "MATCHED");
  assert.equal(sameStringDifferentKind.clientCampaignId, "camp_a");

  const cross = resolveClientCampaignShadow({
    routing: routing(),
    provider: "leadcapture_io",
    evidence: evidence("provider_funnel_id", "funnel-a"),
    looseEvidenceIgnored: false,
    hadExactValuesWithoutProvider: false,
    bindings: [binding("bind_other", "other-campaign-secret", "provider_funnel_id", "funnel-a", OTHER)],
    campaigns: [],
    incomingNiche: niche("VET"),
    leadTypeDecision: null,
  });
  assert.equal(cross.status, "REVIEW_REQUIRED");
  assert.deepEqual(cross.reasonCodes, ["cross_client_identity_conflict"]);
  assert.equal(cross.clientCampaignId, null);
  assert.deepEqual(cross.reviewCandidateCampaignIds, []);
  assert.deepEqual(cross.matchedBindingIds, []);
  const serialized = JSON.stringify(cross);
  assert.equal(serialized.includes(OTHER), false);
  assert.equal(serialized.includes("other-campaign-secret"), false);
  assert.equal(serialized.includes("bind_other"), false);
});

test("a binding that names a different confirmed funnel is not chosen", () => {
  const result = resolveClientCampaignShadow({
    routing: routing("confirmed_source_association", null, "funnel_row_a"),
    provider: "leadcapture_io",
    evidence: evidence("provider_funnel_id", "funnel-a"),
    looseEvidenceIgnored: false,
    hadExactValuesWithoutProvider: false,
    bindings: [binding("bind_a", "camp_a", "provider_funnel_id", "funnel-a", CLIENT, "funnel_row_b")],
    campaigns: [campaign("camp_a", "vet-life-east", "VET")],
    incomingNiche: niche("VET"),
    leadTypeDecision: lead("vet_web_form"),
  });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.reasonCodes, ["confirmed_source_contradiction"]);
  assert.equal(result.clientCampaignId, null);
  assert.equal(result.proposedTags.authorized, false);
});

test("niche agreement, alias, missing evidence, and explicit conflict", () => {
  assert.equal(normalizeCatalogNicheKey("vet_fex"), "VET");
  assert.equal(normalizeCatalogNicheKey("nurse_life"), "NURSE");
  assert.equal(normalizeCatalogNicheKey("mortgage_protection"), "MTG");
  assert.equal(normalizeCatalogNicheKey("FEX"), "FEX");
  assert.equal(normalizeCatalogNicheKey("vet_fex") === "FEX", false);
  assert.equal(normalizeCatalogNicheKey("final_expense"), null);

  const agreed = decide({
    incoming: readIncomingNicheEvidence({ rawPayload: { niche_key: "vet_fex" }, normalizedPayload: {} }),
  });
  assert.equal(agreed.nicheClassificationStatus, "MATCH");
  assert.equal(agreed.status, "MATCHED");
  assert.equal(agreed.proposedTags.nicheTag, "SA360::NICHE::VET");
  assert.equal(agreed.proposedTags.campaignTag, "SA360::CAMPAIGN::vet-life-east");
  assert.equal(agreed.destinationSelection?.workflowLiveVerified, false);
  assert.equal(agreed.destinationSelection?.deliveryExecuted, false);
  assert.equal(agreed.deliveryExecuted, false);

  const nurseConflict = decide({
    nicheKey: "NURSE",
    slug: "nurse-life",
    incoming: readIncomingNicheEvidence({ rawPayload: { niche_key: "VET" }, normalizedPayload: {} }),
    leadType: lead("nurse_web_form"),
  });
  assert.equal(nurseConflict.status, "REVIEW_REQUIRED");
  assert.equal(nurseConflict.nicheClassificationStatus, "CONFLICT");
  assert.equal(nurseConflict.clientCampaignId, "camp_a");
  assert.equal(nurseConflict.proposedTags.authorized, false);
  assert.equal(nurseConflict.proposedTags.nicheTag, null);

  const missing = decide({ incoming: missingNiche });
  assert.equal(missing.status, "MATCHED");
  assert.equal(missing.nicheClassificationStatus, "MISSING");
  assert.equal(missing.incomingNiche.trustedRawValue, null);
  assert.deepEqual(missing.reasonCodes, ["incoming_niche_missing"]);
  assert.equal(missing.proposedTags.nicheTag, "SA360::NICHE::VET");

  const named = decide({
    nicheKey: "NURSE",
    slug: "nurse-life",
    incoming: readIncomingNicheEvidence({
      rawPayload: { funnel_name: "Life Insurance for Veterans" },
      normalizedPayload: {},
    }),
    leadType: lead("nurse_web_form"),
  });
  assert.equal(named.status, "MATCHED");
  assert.equal(named.configuredNicheKey, "NURSE");
  assert.equal(named.nicheClassificationStatus, "MISSING");
  assert.equal(named.incomingNiche.trustedNormalizedKey, null);
  assert.equal(named.incomingNiche.untrustedObservations[0]?.normalizedKey, "VET");
  assert.equal(named.proposedTags.nicheTag, "SA360::NICHE::NURSE");
});

test("consumer answers cannot authorize Lead Type and a stored decision is copied", () => {
  const stored = lead("vet_web_form", "resolved");
  const copied = leadTypeForShadow({
    routingResult: { campaignLeadType: stored },
    rawPayload: { answers: { sa360_campaign_lead_type: "Nurse Web Form" }, niche_key: "NURSE" },
    normalizedPayload: {},
    matched: true,
    routingAuthority: "confirmed_source_association",
    sourceAssociation: { id: "sf_1", leadTypeKey: "nurse_web_form" },
  });
  assert.equal(copied.leadTypeKey, "vet_web_form");
  assert.equal(copied.leadTypeLabel, "Vet Web Form");

  const consumer = leadTypeForShadow({
    routingResult: {},
    rawPayload: { answers: { sa360_campaign_lead_type: "Nurse Web Form", niche_key: "NURSE" } },
    normalizedPayload: {},
    matched: true,
    routingAuthority: "confirmed_source_association",
    sourceAssociation: { id: "sf_1", leadTypeKey: "vet_web_form" },
  });
  assert.equal(consumer.leadTypeKey, "vet_web_form");
  assert.equal(consumer.status, "resolved");
  assert.equal(consumer.evidence.trustedKey, null);

  const trustedConflict = leadTypeForShadow({
    routingResult: {},
    rawPayload: { sa360_campaign_lead_type: "nurse_web_form" },
    normalizedPayload: {},
    matched: true,
    routingAuthority: "confirmed_source_association",
    sourceAssociation: { id: "sf_1", leadTypeKey: "vet_web_form" },
  });
  assert.equal(trustedConflict.status, "conflict");
  assert.equal(trustedConflict.leadTypeKey, null);
});

test("source evidence uses exact provider identifiers and ignores UTM text", () => {
  const extracted = extractShadowSourceEvidence({
    provider: "leadcapture_io",
    matchType: "utm_campaign",
    rawPayload: {
      utm_campaign: "veteran-fex-east",
      funnel_name: "Veteran FEX East",
      answers: { campaign_id: "not-an-identifier" },
      parent_url: "https://My.LeadCapture.io/p/vet-a?utm_campaign=veteran",
    },
    normalizedPayload: {
      attribution: { utm_campaign: "veteran-fex-east", campaign_id: "route-key-only" },
      routing: { source_intake: { funnel_id: "funnel-a", form_id: "funnel-a" } },
    },
    routingResult: {},
  });
  assert.equal(extracted.looseEvidenceIgnored, true);
  assert.deepEqual(
    extracted.identifiers.map((item) => `${item.kind}:${item.normalizedValue}`),
    [
      "provider_funnel_id:funnel-a",
      "parent_url_key:my.leadcapture.io/p/vet-a",
      "campaign_id:route-key-only",
      "form_id:funnel-a",
    ]
  );
  assert.equal(extracted.identifiers.some((item) => item.normalizedValue.includes("veteran")), false);
});

test("shadow code does not call delivery writers and live tag builders stay untouched", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiSrc = path.resolve(here, "../..");
  const shadowFiles = [
    "niche-classification.ts",
    "source-evidence.ts",
    "lead-type-for-shadow.ts",
    "resolve-client-campaign-shadow.ts",
    "observe-client-campaign-shadow.ts",
    "present-client-campaign-shadow.ts",
  ];
  for (const name of shadowFiles) {
    const source = readFileSync(path.join(here, name), "utf8");
    for (const forbidden of [
      "fetch(",
      "googleapis",
      "leadconnectorhq",
      "confirmSourceFunnelOrigin",
      "reassignSourceFunnelOrigin",
      "createRoutingRuleAdmin",
      "createCampaignRoutingRule",
    ]) {
      assert.equal(source.includes(forbidden), false, `${name} ${forbidden}`);
    }
  }
  for (const relative of [
    "services/routing-matcher.service.ts",
    "services/routing-dry-run.service.ts",
    "services/ghl-delivery-adapter/ghl-delivery-request-builders.ts",
    "services/lead-delivery-plan.service.ts",
    "services/company-sheets-dispatch/company-sheets-dispatch.service.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("client-campaign-shadow"), false, relative);
    assert.equal(source.includes("SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED"), false, relative);
  }
  const migration = readFileSync(
    path.resolve(here, "../../../../../prisma/migrations/20261120180000_client_campaign_shadow_decision/migration.sql"),
    "utf8"
  );
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.equal(migration.includes('UPDATE "SourceLeadEvent"'), false);
  assert.equal(migration.includes('UPDATE "SourceFunnel"'), false);
  assert.equal(migration.includes('UPDATE "CampaignRoutingRule"'), false);
  assert.equal(/^GRANT ALL/m.test(migration), false);
  assert.equal(/GRANT SELECT, INSERT, UPDATE/.test(migration), false);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE/);
});
