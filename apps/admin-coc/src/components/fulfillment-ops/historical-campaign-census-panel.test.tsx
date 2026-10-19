import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { HistoricalCampaignCensusPanel } from "./historical-campaign-census-panel.tsx";
import type { HistoricalCensusView, HistoricalOrderView } from "@/lib/fulfillment-ops/historical-campaign-census";

const measurement = {
  readOnlySnapshot: "complete" as const,
  databaseIdentity: {
    source: "postgresql" as const,
    name: "sa360_test",
    serverAddress: "127.0.0.1",
    capturedAt: "2026-10-19T16:00:00.000Z",
  },
  operatorVerifiedProduction: false as const,
  environmentLabelTrusted: false as const,
};

const group = {
  inventoryRows: 2,
  distinctOriginalLabels: 1,
  unresolvedOriginRows: 2,
  stampedOriginRows: 0,
  consistentOriginalLabelRows: 2,
  missingAttributionRows: 0,
  conflictingAttributionRows: 0,
  reservedRows: 0,
};

const census: HistoricalCensusView = {
  policyId: "historical-campaign-census-v1",
  provenancePolicyId: "ppl-provenance-eligibility-v1",
  recoveryPolicyId: "historical-campaign-recovery-v1",
  ownershipStampApplied: false,
  resaleAuthorizationApplied: false,
  clientNameMatchUsed: false,
  julySourceCampaignNamePreserved: true,
  labelTextOmitted: true,
  buyerSpecificEligibilityApplied: false,
  measurement,
  population: {
    inventoryRows: 2,
    unresolvedOriginRows: 2,
    stampedOriginRows: 0,
    consistentOriginalLabelRows: 2,
    missingAttributionRows: 0,
    conflictingAttributionRows: 0,
    rowsWithOriginalLabel: 2,
    rowsMissingOriginalLabel: 0,
    distinctOriginalLabels: 1,
  },
  labelPopulations: {
    oneRow: 0,
    twoToTenRows: 1,
    elevenToOneHundredRows: 0,
    oneHundredOneToOneThousandRows: 0,
    overOneThousandRows: 0,
    largestLabelInventoryRows: 2,
  },
  byNiche: [{ ...group, nicheKey: "vet" }],
  byLot: [{ ...group, lotKey: "lot_vet" }],
  byNicheAndLot: [{ ...group, nicheKey: "vet", lotKey: "lot_vet" }],
  byImportRequest: [{ ...group, importRequest: "aged-bulk-vet" }],
  byAgreement: [{ ...group, agreement: "july_column_agrees" }],
  byInventoryStatus: [{ ...group, status: "available" }],
  openAllocations: { rows: 0, byStatus: [] },
  stampedOriginClients: [],
};

const order: HistoricalOrderView = {
  policyId: "historical-campaign-census-v1",
  provenancePolicyId: "ppl-provenance-eligibility-v1",
  recoveryPolicyId: "historical-campaign-recovery-v1",
  orderNumber: "LO-1053",
  orderStatus: "active",
  buyerClientAccountId: "buyer_1",
  resaleAuthorizationPersisted: false,
  ownershipStampApplied: false,
  contactOmitted: true,
  measurement,
  allocations: {
    rows: 1,
    reservedRows: 1,
    buyerMismatchRows: 0,
    missingInventoryRows: 0,
    originEqualsBuyerRows: 0,
    originOtherClientRows: 0,
    originUnstampedRows: 1,
    byStatus: [{ status: "reserved", allocations: 1 }],
    byProvenance: [{ provenance: "unresolved_origin", allocations: 1 }],
    byLot: [
      {
        lotKey: "lot_vet",
        allocations: 1,
        unresolvedOrigin: 1,
        originEqualsBuyer: 0,
        originOtherClient: 0,
        originUnstamped: 1,
      },
    ],
  },
  reservedRevisedPolicy: {
    wouldBlockUnresolvedOrigin: 1,
    wouldBlockSameOrigin: 0,
    wouldBlockUntilResaleAuthorization: 0,
    outsideHistoricalGate: 0,
    wouldBlockMissingInventory: 0,
  },
  delivery: {
    packages: 0,
    spreadsheetDeliveredPackages: 0,
    notifyByStatus: [],
    instructionsByStatus: [],
  },
  replacementsByStatus: [],
};

afterEach(() => {
  cleanup();
});

describe("HistoricalCampaignCensusPanel", () => {
  it("keeps idle and unavailable states free of inventory totals", () => {
    const { rerender } = render(
      <HistoricalCampaignCensusPanel
        census={{ state: "idle" }}
        order={{ state: "idle" }}
        orderId={null}
        censusRequested={false}
        requestedOrderNumber={null}
      />
    );
    assert.equal(screen.getByTestId("historical-census-panel").getAttribute("data-state"), "idle");
    assert.equal(screen.queryByTestId("historical-census-rows"), null);
    assert.equal(screen.queryByTestId("historical-order-reserved"), null);
    assert.equal((screen.getByTestId("historical-order-input") as HTMLInputElement).value, "LO-1053");
    assert.match(screen.getByTestId("historical-association-contract").textContent ?? "", /not implemented/i);
    assert.match(screen.getByTestId("historical-association-contract").textContent ?? "", /ownership-previews/);
    assert.match(screen.getByTestId("historical-association-contract").textContent ?? "", /resale\/confirmations/);

    rerender(
      <HistoricalCampaignCensusPanel
        census={{ state: "unavailable" }}
        order={{ state: "not_found", orderNumber: "LO-1053" }}
        orderId={null}
        censusRequested
        requestedOrderNumber="LO-1053"
      />
    );
    assert.match(screen.getByTestId("historical-census-panel").textContent ?? "", /not a zero result/i);
    assert.match(screen.getByTestId("historical-order-panel").textContent ?? "", /not a zero result/i);
    assert.equal(screen.queryByTestId("historical-census-rows"), null);
    assert.equal(screen.queryByTestId("historical-order-reserved"), null);
  });

  it("renders reconciled counts without campaign label text", () => {
    render(
      <HistoricalCampaignCensusPanel
        census={{ state: "ready", report: census }}
        order={{ state: "ready", report: order }}
        orderId={null}
        censusRequested
        requestedOrderNumber="LO-1053"
      />
    );
    assert.equal(screen.getByTestId("historical-census-rows").textContent?.includes("2"), true);
    assert.equal(screen.getByTestId("historical-order-buyer").textContent, "buyer_1");
    assert.match(screen.getByTestId("historical-order-policy").textContent ?? "", /Would block, unresolved origin: 1/);
    assert.equal(screen.queryByText("Secret Label"), null);
  });
});
