import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import {
  FulfillmentOpsWorkbench,
  PplScanLimitWarning,
} from "./fulfillment-ops-workbench.tsx";
import type { FulfillmentOpsBootstrap } from "@/lib/fulfillment-ops/types";

const baseBootstrap: FulfillmentOpsBootstrap = {
  safety: {
    simulationOnly: true,
    liveDeliveryEnabled: false,
    liveDeliveryStatus: "LIVE DISABLED",
    inventoryReviewEnabled: false,
    lf2ExecutionEnabled: false,
    lf2GhlCanaryEnabled: false,
    lf2AllowlistsConfigured: false,
    runtimeMode: "test",
    nodeEnv: "test",
    flags: {
      SA360_LEAD_INVENTORY_REVIEW_ENABLED: false,
      SA360_LF2_EXECUTION_ENABLED: false,
      SA360_LF2_GHL_CANARY_ENABLED: false,
    },
    safetyMessage: "Simulation only — no external delivery will occur.",
  },
  inventory: {
    summary: {
      totalItems: 0,
      available: 0,
      reserved: 0,
      committed: 0,
      quarantined: 0,
      expired: 0,
      lotsActive: 0,
    },
    review: {
      featureEnabled: false,
      counts: {
        pendingReview: 0,
        eligibleNow: 0,
        blocked: 0,
        available: 0,
        quarantined: 0,
        rejected: 0,
      },
    },
    nicheDistribution: [],
    stateDistribution: [],
  },
  selectedOrder: null,
  latestEvidence: null,
  orderError: null,
  limitations: [],
};

afterEach(() => {
  cleanup();
});

describe("FulfillmentOpsWorkbench", () => {
  it("renders with no selected order and live-disabled state", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[]}
        clients={[]}
        pricingCatalog={null}
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByText("Fulfillment Operations"));
    assert.ok(screen.getByText("LIVE DISABLED"));
    assert.ok(screen.getByText("SIMULATION ONLY"));
    assert.ok(screen.getByText("No order selected."));
    assert.ok(screen.getByText("Inventory review feature blocked"));
  });

  it("renders inventory summary safely with partial data", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={{
          ...baseBootstrap,
          inventory: {
            ...baseBootstrap.inventory,
            summary: { totalItems: 12, available: 4 },
            review: {
              featureEnabled: true,
              counts: { pendingReview: 3, available: 4, rejected: 1, quarantined: 0 },
            },
            nicheDistribution: [{ nicheKey: "TRUCKER", count: 12 }],
            stateDistribution: [{ state: "TX", count: 5 }],
          },
        }}
        orders={[]}
        clients={[]}
        pricingCatalog={null}
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByText("TRUCKER"));
    assert.ok(screen.getByText("TX"));
    assert.equal(screen.queryByText("Inventory review feature blocked"), null);
  });

  it("shows selected order details without crashing on partial LF2 fields", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={{
          ...baseBootstrap,
          selectedOrder: {
            id: "ord_1",
            orderNumber: "LO-1001",
            clientAccountId: "client_a",
            clientDisplayName: "Demo",
            status: "submitted",
            nicheKey: "VET",
            productType: null,
            states: ["FL"],
            leadVolume: 2,
            requestedQuantity: null,
            proposedQuantity: 0,
            reservedQuantity: 0,
            fulfilledQuantity: 0,
            remainingCapacity: null,
            orderKind: null,
            fulfillmentMode: null,
            activatedAt: null,
            allocationReady: false,
            allocationBlockers: ["order_status_submitted", "order_kind_missing_or_unsupported"],
            createdAt: "2026-07-22T00:00:00.000Z",
            updatedAt: "2026-07-22T00:00:00.000Z",
          },
        }}
        orders={[]}
        clients={[]}
        pricingCatalog={null}
        loadError={null}
        initialOrderId="ord_1"
      />
    );
    assert.ok(screen.getAllByText("LO-1001").length >= 1);
    assert.ok(screen.getByText(/NOT ALLOCATION READY/i));
    assert.ok(screen.getByText(/order_kind_missing_or_unsupported/));
  });

  it("keeps zero live attempts visible in evidence stage copy", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[]}
        clients={[]}
        pricingCatalog={null}
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByText("Live attempts"));
    assert.ok(screen.getAllByText("0").length > 0);
  });

  it("renders load errors without crashing", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[]}
        clients={[]}
        pricingCatalog={null}
        loadError={'Admin API error (500): {"not":"json-friendly"}'}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByText(/Bootstrap partially unavailable/i));
    assert.ok(screen.getByText(/Admin API error \(500\)/));
  });

  it("H: scan-limit warning is distinct from inventory shortfall", () => {
    const { container } = render(
      <PplScanLimitWarning
        failure={{
          ok: false,
          code: "scan_limit_reached",
          reasons: ["candidate_scan_incomplete"],
          requestedQuantity: 100,
          eligibleQuantity: 72,
          selectedQuantity: 0,
          diagnostics: {
            rowsScanned: 5000,
            pagesRead: 20,
            eligibleQuantity: 72,
            selectedQuantity: 0,
            shortfallQuantity: 0,
            scanCeilingHit: true,
            selectionComplete: false,
          },
        }}
      />
    );
    const text = container.textContent ?? "";
    assert.match(text, /safe scan limit/i);
    assert.match(text, /No leads were reserved/i);
    assert.match(text, /Rows scanned:\s*5000/);
    assert.match(text, /Pages read:\s*20/);
    assert.match(text, /Eligible found so far:\s*72/);
    assert.match(text, /SEARCH INCOMPLETE/i);
    assert.match(text, /not an inventory shortage/i);
    assert.doesNotMatch(text, /Shortfall — partial fulfillment/i);
  });
});
