import assert from "node:assert/strict";
import test from "node:test";

import type { LeadProofOverviewSummary } from "../../repositories/lead-proof.repository.js";
import { presentLeadFulfillmentOverview } from "./lead-proof-overview.present.js";

const emptySummary = (): LeadProofOverviewSummary => ({
  totalLeads: 3,
  proofStatusCounts: {
    UNREVIEWED: 1,
    PROOF_ATTACHED: 1,
    PROOF_MISSING: 1,
    NEEDS_REVIEW: 0,
    REJECTED: 0,
  },
  verificationStatusCounts: {
    UNCHECKED: 2,
    PASSED: 1,
    FAILED: 0,
    NEEDS_REVIEW: 0,
  },
  recentIntake: [
    {
      leadUid: "LF-001",
      sourceLane: "meta_lead_ads",
      sourcePlatform: "facebook",
      state: "TX",
      niche: "Solar",
      proofStatus: "PROOF_ATTACHED",
      verificationStatus: "PASSED",
      artifactSummary: null,
      createdAt: new Date("2026-06-30T12:00:00.000Z"),
    },
  ],
  recentActivity: [
    {
      id: "proof-1",
      leadUid: "LF-001",
      proofStatus: "PROOF_ATTACHED",
      verificationStatus: "PASSED",
      createdAt: new Date("2026-06-30T12:00:00.000Z"),
      updatedAt: new Date("2026-06-30T12:05:00.000Z"),
    },
  ],
});

test("presentLeadFulfillmentOverview maps proof vault summary into overview DTO", () => {
  const dto = presentLeadFulfillmentOverview(emptySummary());
  assert.equal(dto.dataSource, "lead_proof_vault");
  assert.equal(dto.kpis.find((k) => k.key === "leadsReceived")?.value, 3);
  assert.equal(dto.proofSummary.find((p) => p.key === "passed")?.count, 1);
  assert.equal(dto.recentIntake[0]?.proofStatus, "attached");
  assert.equal(dto.recentIntake[0]?.verificationStatus, "passed");
  assert.equal(dto.activity[0]?.kind, "lead_verified");
  assert.ok(dto.dataLimitations.length > 0);
});

test("presentLeadFulfillmentOverview keeps inventory and delivery KPIs as placeholders", () => {
  const dto = presentLeadFulfillmentOverview(emptySummary());
  assert.equal(dto.kpis.find((k) => k.key === "availableInventory")?.value, 0);
  assert.equal(dto.kpis.find((k) => k.key === "deliveredLeads")?.value, 0);
  assert.match(
    dto.kpis.find((k) => k.key === "availableInventory")?.hint ?? "",
    /not implemented/i
  );
});

test("presentLeadFulfillmentOverview labels leadconduit_facebook lane for admin display", () => {
  const summary = emptySummary();
  summary.recentIntake = [
    {
      leadUid: "LF-LCFB-001",
      sourceLane: "leadconduit_facebook",
      sourcePlatform: "facebook",
      state: "FL",
      niche: "VET",
      proofStatus: "NEEDS_REVIEW",
      verificationStatus: "UNCHECKED",
      artifactSummary: {
        totalArtifacts: 1,
        providers: ["trustedform"],
        hasConsentCertificate: true,
        hasCryptographicIntegrity: false,
      },
      createdAt: new Date("2026-07-08T13:00:00.000Z"),
    },
  ];
  const dto = presentLeadFulfillmentOverview(summary);
  assert.equal(dto.recentIntake[0]?.sourceLane, "LeadConduit Facebook");
});
