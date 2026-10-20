import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  HistoricalOwnershipWorkbench,
  OwnershipPreviewReadout,
} from "./historical-ownership-workbench.tsx";
import type { PreviewView } from "@/lib/fulfillment-ops/historical-ownership-preview";

const preview: PreviewView = {
  verificationStatus: "UNVERIFIED",
  stampApplied: false,
  resaleAuthorizationApplied: false,
  registryRowsWritten: false,
  inventoryRowsWritten: false,
  scopeMode: "campaigns",
  scopeKey: "lot_vet",
  unlabeledRowsInSelectedScopes: 4,
  lo1053ReservedAllocations: 16,
  proposals: [
    {
      normalizedLabel: "Reserved Vet",
      originClientAccountId: "client_a",
      lotKey: "lot_vet",
      importRequest: "import_vet",
      inventoryRows: 16,
      availableRows: 0,
      reservedRows: 16,
      missingLabelRows: 1,
      alreadyStampedToSameClient: 0,
      alreadyStampedToOtherClient: 2,
      conflictingLabelRows: 1,
      ambiguous: true,
      conflict: "existing_other_origin",
      scopeConflict: "registry_disagreement",
      duplicateProposal: false,
      verificationStatus: "UNVERIFIED",
      persistedDecision: "not_eligible",
      persistedReason: "no_coverage",
      persistedOriginClientAccountId: null,
      hypotheticalDecision: "not_eligible",
      hypotheticalReason: "existing_other_origin",
      hypotheticalOriginClientAccountId: null,
      hypotheticalRejection: "existing_other_origin",
      rowsThatWouldExcludeProposedClientAsBuyer: 14,
      rowsAlreadyStampedToProposedClient: 0,
      reservedOrCommittedAllocationsToProposedClient: 16,
      lo1053ReservedAllocations: 16,
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe("HistoricalOwnershipWorkbench", () => {
  it("renders filters, an unverified preview, and no confirm control", () => {
    render(<HistoricalOwnershipWorkbench clients={[{ id: "client_a", label: "Client A" }]} />);
    assert.ok(screen.getByTestId("ownership-lot-filter"));
    assert.ok(screen.getByTestId("ownership-import-filter"));
    assert.ok(screen.getByTestId("ownership-niche-filter"));
    assert.ok(screen.getByTestId("ownership-label-filter"));
    assert.ok(screen.getByTestId("ownership-client-select"));
    assert.ok(screen.getByRole("button", { name: "Search campaigns" }));
    assert.ok(screen.getByRole("button", { name: "Preview ownership" }));
    assert.equal(screen.queryByRole("button", { name: /confirm ownership/i }), null);
    assert.match(screen.getByTestId("ownership-confirm-absent").textContent ?? "", /not available/i);
    assert.equal(screen.getByTestId("ownership-workbench-unverified").getAttribute("data-status"), null);
    assert.match(screen.getByTestId("ownership-workbench-unverified").textContent ?? "", /UNVERIFIED/);
  });

  it("shows conflict and LO-1053 warnings on a preview readout", () => {
    render(<OwnershipPreviewReadout preview={preview} />);
    assert.equal(screen.getByTestId("ownership-verification-status").getAttribute("data-status"), "UNVERIFIED");
    assert.match(screen.getByTestId("lo-1053-warning").textContent ?? "", /16 reserved allocations/);
    assert.match(screen.getByTestId("lo-1053-warning").textContent ?? "", /does not release/);
    assert.match(screen.getByText("Reserved Vet").parentElement?.textContent ?? "", /existing_other_origin/);
    assert.match(document.body.textContent ?? "", /no_coverage/);
    assert.match(document.body.textContent ?? "", /existing_other_origin/);
    assert.equal(screen.queryByRole("button", { name: /confirm/i }), null);
  });

  it("searches through the operator route and renders the July label", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          state: "ready",
          catalog: {
            page: 1,
            pageSize: 25,
            totalCampaigns: 1,
            missingLabelRows: 4,
            conflictingLabelRows: 0,
            campaigns: [
              {
                displayLabel: "July Vet",
                normalizedLabel: "July Vet",
                lotKey: "lot_vet",
                importRequest: "import_vet",
                nicheKey: "vet",
                inventoryRows: 8,
                availableRows: 8,
                reservedRows: 0,
                conflictingAttributionRows: 0,
                stampedOriginRows: 0,
                distinctOriginCount: 0,
                originConflict: false,
                whitespaceVariantCount: 1,
                lotAliasStatus: "absent",
                importAliasStatus: "absent",
                lotConfirmedOriginClientAccountId: null,
                importConfirmedOriginClientAccountId: null,
                persistedDecision: "not_eligible",
                persistedReason: "no_coverage",
                persistedOriginClientAccountId: null,
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      render(<HistoricalOwnershipWorkbench clients={[]} />);
      fireEvent.change(screen.getByTestId("ownership-lot-filter"), { target: { value: "lot_vet" } });
      fireEvent.click(screen.getByRole("button", { name: "Search campaigns" }));
      assert.equal((await screen.findAllByText("July Vet")).length, 2);
      assert.match(document.body.textContent ?? "", /Missing July labels/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
