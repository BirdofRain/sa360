import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { parseCampaignShadowView, type CampaignShadowView } from "@/lib/source-intake/campaign-shadow.ts";
import { CampaignShadowPanel } from "./campaign-shadow-panel.tsx";

test.afterEach(() => cleanup());

const banner = "Shadow analysis only — no campaign-specific delivery executed.";

function view(overrides: Partial<NonNullable<CampaignShadowView["decision"]>> = {}): CampaignShadowView {
  return {
    banner,
    evaluation: "stored",
    shadowEnabled: true,
    decision: {
      status: "MATCHED",
      evaluatedAt: "2026-11-20T15:00:00.000Z",
      winningRoutingAuthority: "confirmed_source_association",
      provider: "leadcapture_io",
      sourceEvidence: [{ kind: "provider_funnel_id", normalizedValue: "funnel-a" }],
      clientCampaignId: "camp_a",
      campaignDisplayName: "Veteran FEX East",
      campaignSlug: "vet-life-east",
      campaignRevision: 2,
      configuredNicheKey: "VET",
      configuredProductType: "life_insurance",
      nicheClassificationStatus: "MATCH",
      incomingRaw: "vet_fex",
      incomingNormalized: "VET",
      incomingProvenance: "niche_key",
      untrustedNiche: null,
      reasonCodes: [],
      leadTypeKey: "vet_web_form",
      leadTypeLabel: "Vet Web Form",
      leadTypeStatus: "resolved",
      nicheTag: "SA360::NICHE::VET",
      campaignTag: "SA360::CAMPAIGN::vet-life-east",
      tagsAuthorized: true,
      tagReason: null,
      workflowIdGhl: "wf_vet",
      worksheetTitle: "Vet",
      worksheetId: 1,
      ...overrides,
    },
  };
}

test("the shadow panel shows a matched campaign and withholds nothing the decision authorized", () => {
  render(<CampaignShadowPanel view={view()} />);
  assert.equal(screen.getByTestId("campaign-shadow-banner").textContent, banner);
  assert.match(screen.getByTestId("campaign-shadow-panel").textContent ?? "", /Veteran FEX East/);
  assert.match(screen.getByTestId("campaign-shadow-panel").textContent ?? "", /SA360::NICHE::VET/);
  assert.match(screen.getByTestId("campaign-shadow-panel").textContent ?? "", /Vet Web Form/);
  assert.match(screen.getByTestId("campaign-shadow-panel").textContent ?? "", /wf_vet/);
  assert.equal(screen.getByTestId("campaign-shadow-evaluation").textContent, "Evaluation: stored");
});

test("a conflict shows no authorized campaign tag", () => {
  render(
    <CampaignShadowPanel
      view={view({
        status: "REVIEW_REQUIRED",
        nicheClassificationStatus: "CONFLICT",
        tagsAuthorized: false,
        nicheTag: null,
        campaignTag: null,
        tagReason: "niche_classification_conflict",
        reasonCodes: ["niche_classification_conflict"],
      })}
    />
  );
  const text = screen.getByTestId("campaign-shadow-panel").textContent ?? "";
  assert.match(text, /REVIEW_REQUIRED/);
  assert.match(text, /niche_classification_conflict/);
  assert.equal(text.includes("SA360::NICHE::"), false);
  assert.equal(text.includes("SA360::CAMPAIGN::"), false);
});

test("an event without a stored decision does not invent one", () => {
  render(
    <CampaignShadowPanel
      view={{ banner, evaluation: "not_evaluated", shadowEnabled: false, decision: null }}
    />
  );
  assert.equal(
    screen.getByTestId("campaign-shadow-empty").textContent,
    "No shadow decision is stored for this event."
  );
  assert.equal(screen.getByTestId("campaign-shadow-evaluation").textContent, "Evaluation: not_evaluated");
});

test("the parser keeps a missing incoming niche empty", () => {
  const parsed = parseCampaignShadowView({
    ok: true,
    banner,
    shadowEnabled: false,
    evaluation: "stored",
    decision: {
      status: "MATCHED",
      evaluatedAt: "2026-11-20T15:00:00.000Z",
      winningRoutingAuthority: "campaign_routing_rule",
      provider: "leadcapture_io",
      sourceEvidence: [{ kind: "provider_funnel_id", normalizedValue: "funnel-a" }],
      clientCampaignId: "camp_a",
      campaignDisplayName: "Veteran FEX East",
      campaignSlug: "vet-life-east",
      campaignRevision: 1,
      configuredNicheKey: "VET",
      configuredProductType: "life_insurance",
      nicheClassificationStatus: "MISSING",
      incomingNiche: {
        trustedProvenance: "none",
        trustedRawValue: null,
        trustedNormalizedKey: null,
        untrustedObservations: [],
      },
      reasonCodes: ["incoming_niche_missing"],
      leadTypeDecision: { leadTypeKey: "vet_web_form", leadTypeLabel: "Vet Web Form", status: "resolved" },
      proposedTags: {
        authorized: true,
        nicheTag: "SA360::NICHE::VET",
        campaignTag: "SA360::CAMPAIGN::vet-life-east",
        reason: null,
      },
      destinationSelection: { workflowIdGhl: null, worksheetTitle: null, worksheetId: null },
    },
  });
  assert.equal(parsed?.decision?.incomingNormalized, null);
  assert.equal(parsed?.decision?.incomingRaw, null);
  assert.equal(parsed?.decision?.configuredNicheKey, "VET");
  assert.deepEqual(parsed?.decision?.reasonCodes, ["incoming_niche_missing"]);
});
