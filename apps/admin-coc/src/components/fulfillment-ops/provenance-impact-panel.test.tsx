import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ProvenanceImpactPanel } from "./provenance-impact-panel.tsx";
import type { ProvenanceImpactView } from "@/lib/fulfillment-ops/provenance-impact";

const ready: ProvenanceImpactView = {
  productionImpactMeasured: false,
  measurement: {
    readOnlySnapshot: "complete",
    databaseIdentity: {
      source: "postgresql",
      name: "sa360_test",
      serverAddress: "127.0.0.1",
      capturedAt: "2026-10-19T16:00:00.000Z",
    },
    operatorVerifiedProduction: false,
    environmentLabelTrusted: false,
  },
  policyId: "ppl-provenance-eligibility-v1",
  database: {
    name: "sa360_test",
    serverAddress: "127.0.0.1",
    capturedAt: "2026-10-19T16:00:00.000Z",
  },
  structuralGate: {
    availableBeforeGate: 8,
    blockedByGate: 6,
    remainingAfterGate: 2,
    percentBlocked: "75.0000",
  },
  breakdowns: {
    byNiche: [{ key: "trucker", before: 8, blocked: 6, remaining: 2 }],
    byLot: [{ key: "lot_a", before: 8, blocked: 6, remaining: 2 }],
    byItemProvider: [{ key: "facebook", before: 8, blocked: 6, remaining: 2 }],
    byEventProvider: [{ key: "(blank)", before: 8, blocked: 6, remaining: 2 }],
    byEventSystem: [{ key: "csv_import", before: 8, blocked: 6, remaining: 2 }],
  },
  blockedInventoryRecovery: {
    campaignLabelIsRecoveryCandidateOnly: true,
    blocked: 6,
    consistentOriginalLabel: 1,
    missingCampaignLabel: 4,
    conflictingCampaignEvidence: 1,
    furtherAuthorizationRequired: 6,
    byNiche: [
      {
        key: "trucker",
        blocked: 6,
        consistentOriginalLabel: 1,
        missingCampaignLabel: 4,
        conflictingCampaignEvidence: 1,
        furtherAuthorizationRequired: 6,
      },
    ],
    byLot: [
      {
        key: "lot_a",
        blocked: 6,
        consistentOriginalLabel: 1,
        missingCampaignLabel: 4,
        conflictingCampaignEvidence: 1,
        furtherAuthorizationRequired: 6,
      },
    ],
  },
  historicalCampaignLabels: {
    events: 10,
    eventsWithNonemptySourceCampaignName: 8,
    distinctSourceCampaignNameCount: 8,
    recoverableConsistentEvents: 7,
    conflictingEvents: 1,
    missingEvents: 2,
    distinctRecoverableLabelCount: 7,
    distinctConflictingLabelCount: 1,
  },
  reservedAndAllocations: {
    reservedItemsUnresolved: 2,
    openAllocationsUnresolved: 3,
    ordersWithUnresolvedReservedAllocations: 1,
    ordersWithMixedEligibleAndUnresolvedReservedAllocations: 1,
    unresolvedReservedOrderNumbers: ["LO-1"],
    mixedReservedOrderNumbers: ["LO-1"],
  },
  furtherEvidenceRequired: {
    unresolvedInStructuralGate: 6,
    unresolvedReservedItems: 2,
    unresolvedOpenAllocations: 3,
    campaignEventsNotSafelyRecoverable: 3,
    verifiedAcquisitionCannotClearRows: true,
  },
  buyerSpecificEligibilityApplied: false,
};

afterEach(() => {
  cleanup();
});

describe("ProvenanceImpactPanel", () => {
  it("shows no inventory totals while the audit flag is off", () => {
    render(<ProvenanceImpactPanel model={{ state: "disabled" }} />);
    const panel = screen.getByTestId("provenance-impact-panel");
    assert.equal(panel.getAttribute("data-state"), "disabled");
    assert.match(panel.textContent ?? "", /SA360_PROVENANCE_AUDIT_ENABLED=true/);
    assert.match(panel.textContent ?? "", /read-only/);
    assert.equal(screen.queryByText("Available before gate"), null);
    assert.equal(screen.queryByTestId("provenance-impact-before"), null);
  });

  it("does not present an unavailable audit as zero inventory", () => {
    render(<ProvenanceImpactPanel model={{ state: "unavailable" }} />);
    assert.match(screen.getByTestId("provenance-impact-panel").textContent ?? "", /not a zero result/i);
    assert.equal(screen.queryByText("Available before gate"), null);
  });

  it("shows structural counts, recovery coverage, and order numbers", () => {
    render(<ProvenanceImpactPanel model={{ state: "ready", report: ready }} />);
    assert.equal(screen.getByTestId("provenance-impact-before").textContent?.includes("8"), true);
    assert.equal(screen.getByTestId("provenance-impact-blocked").textContent?.includes("6"), true);
    assert.equal(screen.getByTestId("provenance-impact-remaining").textContent?.includes("2"), true);
    assert.match(screen.getByTestId("provenance-impact-percent").textContent ?? "", /75\.0000%/);
    assert.match(screen.getByTestId("provenance-impact-campaign-recovery").textContent ?? "", /Recoverable events: 7/);
    const recovery = screen.getByTestId("provenance-impact-blocked-recovery");
    assert.match(recovery.textContent ?? "", /Consistent original label: 1/);
    assert.match(recovery.textContent ?? "", /Authorization required: 6/);
    assert.match(recovery.textContent ?? "", /not confirmed ownership or resale authorization/);
    assert.equal(screen.getAllByText("LO-1").length, 2);
    const measurement = screen.getByTestId("provenance-impact-measurement");
    assert.equal(measurement.getAttribute("data-snapshot"), "complete");
    assert.equal(measurement.getAttribute("data-operator-verified"), "false");
    assert.match(measurement.textContent ?? "", /Production identity is not verified/);
    assert.match(measurement.textContent ?? "", /does not treat an environment variable as proof/);
    assert.match(measurement.textContent ?? "", /2026-10-19T16:00:00.000Z/);
    fireEvent.click(screen.getByTestId("provenance-verify-production"));
    assert.equal(measurement.getAttribute("data-operator-verified"), "true");
    assert.match(measurement.textContent ?? "", /Operator verified this PostgreSQL identity is production/);
    assert.match(measurement.textContent ?? "", /sa360_test/);
    assert.equal(screen.queryByText(/Secret Client/i), null);
  });
});
