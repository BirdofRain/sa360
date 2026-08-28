import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FulfillmentOpsWorkbench } from "./fulfillment-ops-workbench.tsx";
import type { PplPricingCatalog } from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import type { FulfillmentOpsBootstrap, FulfillmentOpsOrder } from "@/lib/fulfillment-ops/types";

const catalog: PplPricingCatalog = {
  pricingVersion: "ppl_aged_beta_2026_08_v1",
  activeAgedBuckets: [
    {
      key: "COMMERCE_9_12_MO",
      label: "9–12 Months",
      minDaysInclusive: 270,
      maxDaysExclusive: 365,
      unitPriceCents: 200,
      status: "active",
    },
  ],
  holdBuckets: [
    { key: "FRESH", label: "Fresh", minDaysInclusive: 0, maxDaysExclusive: 10, status: "HOLD" },
    {
      key: "SEMI_FRESH",
      label: "Semi-Fresh",
      minDaysInclusive: 10,
      maxDaysExclusive: 30,
      status: "HOLD",
    },
  ],
};

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
      SA360_PPL_REPLACEMENT_ENABLED: false,
    },
    safetyMessage: "Simulation only — no external delivery will occur.",
  },
  inventory: {
    summary: { totalItems: 0, available: 0 },
    review: { featureEnabled: false },
    nicheDistribution: [],
    stateDistribution: [],
  },
  selectedOrder: null,
  latestEvidence: null,
  orderError: null,
  limitations: [],
};

const pricedOrder: FulfillmentOpsOrder = {
  id: "ord_priced",
  orderNumber: "LO-1048",
  clientAccountId: "client_demo",
  clientDisplayName: "Smart Agent 360 Demo",
  status: "active",
  nicheKey: "VET",
  productType: null,
  states: ["NC"],
  leadVolume: 1,
  requestedQuantity: 1,
  proposedQuantity: 1,
  reservedQuantity: 1,
  fulfilledQuantity: 0,
  remainingCapacity: 0,
  orderKind: "pay_per_lead",
  fulfillmentMode: "pooled_matching",
  activatedAt: "2026-08-17T00:00:00.000Z",
  allocationReady: true,
  allocationBlockers: [],
  pricing: {
    commerceAgeBucketKey: "COMMERCE_9_12_MO",
    pricingVersion: "ppl_aged_beta_2026_08_v1",
    unitPriceCents: 200,
    lineTotalCents: 200,
    requestedQuantity: 1,
    label: "9–12 Months",
  },
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

describe("Phase 3 operator UX", () => {
  it("shows server catalog prices and HOLD buckets that are not selectable", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[]}
        clients={[{ id: "client_demo", label: "Smart Agent 360 Demo" }]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByText("Fresh — HOLD"));
    assert.ok(screen.getByText("Semi-Fresh — HOLD"));
    const select = screen.getByTestId("commerce-bucket-select") as HTMLSelectElement;
    const values = [...select.options].map((option) => option.value);
    assert.ok(values.includes("COMMERCE_9_12_MO"));
    assert.ok(!values.includes("FRESH"));
    assert.ok(!values.includes("SEMI_FRESH"));
    assert.ok(screen.getByText(/\$2\/lead/));
  });

  it("blocks priced order creation when the catalog is unavailable", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[]}
        clients={[{ id: "client_demo", label: "Demo" }]}
        pricingCatalog={null}
        pricingError="catalog_down"
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByText("Pricing unavailable"));
    const create = screen.getByRole("button", { name: "Create Client Lead Order" });
    assert.equal((create as HTMLButtonElement).disabled, true);
  });

  it("shows Stage 2c client/order/niche/state/bucket/price/qty context", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={{ ...baseBootstrap, selectedOrder: pricedOrder }}
        orders={[pricedOrder]}
        clients={[{ id: "client_demo", label: "Smart Agent 360 Demo" }]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId="ord_priced"
      />
    );
    const context = screen.getByTestId("ppl-export-context");
    assert.match(context.textContent ?? "", /Smart Agent 360 Demo/);
    assert.match(context.textContent ?? "", /LO-1048/);
    assert.match(context.textContent ?? "", /VET/);
    assert.match(context.textContent ?? "", /NC/);
    assert.match(context.textContent ?? "", /9–12 Months/);
    assert.match(context.textContent ?? "", /\$2\/lead/);
  });

  it("hides Stage 2d and collapses legacy stages 3–6 for priced PPL beta", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={{ ...baseBootstrap, selectedOrder: pricedOrder }}
        orders={[pricedOrder]}
        clients={[]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId="ord_priced"
      />
    );
    assert.ok(screen.getAllByText("Replacement fulfillment — Beta restricted").length >= 1);
    assert.equal(screen.queryByText("Stage 2d — Duplicate-Only Replacement"), null);
    assert.ok(screen.getByText("Legacy / Simulation Operations"));
    assert.ok(screen.getByText(/Not used for priced PPL CSV fulfillment/));
    assert.equal(screen.queryByText("Stage 3 — Eligibility Preview"), null);
  });

  it("retains legacy stages 3–6 for unpriced simulation orders", () => {
    const legacy: FulfillmentOpsOrder = { ...pricedOrder, pricing: null, orderNumber: "LO-1" };
    render(
      <FulfillmentOpsWorkbench
        bootstrap={{ ...baseBootstrap, selectedOrder: legacy }}
        orders={[legacy]}
        clients={[]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId="ord_priced"
      />
    );
    assert.ok(screen.getByText("Stage 3 — Eligibility Preview"));
    assert.ok(screen.getByText("Stage 2d — Duplicate-Only Replacement"));
  });

  it("opens the delivery modal on first click without writing, cancel writes nothing, confirm sends token", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.includes("mark-spreadsheet-delivered")) {
        return new Response(
          JSON.stringify({
            ok: true,
            exportId: "exp_1",
            orderId: "ord_priced",
            clientAccountId: "client_demo",
            contentSha256: "abc123def456",
            allocationIds: ["alloc_1"],
            identityCount: 1,
            evidenceNote: "MANUAL SPREADSHEET DELIVERY RECORDED",
            deliveredAt: "2026-08-17T15:00:00.000Z",
            deliveredBy: null,
            idempotentReplay: false,
            externalWriteOccurred: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }) as typeof fetch;

    const exportCommit = {
      ok: true as const,
      exportId: "exp_1",
      orderId: "ord_priced",
      clientAccountId: "client_demo",
      orderNumber: "LO-1048",
      rowCount: 1,
      allocationIds: ["alloc_1"],
      fieldSchemaVersion: "buyer_csv_v2",
      contentSha256: "abc123def456",
      filename: "Smart-Agent-360-Demo_LO-1048_VET_NC_9-12mo_1-lead.csv",
      idempotentReplay: false,
    };

    render(
      <FulfillmentOpsWorkbench
        bootstrap={{ ...baseBootstrap, selectedOrder: pricedOrder }}
        orders={[pricedOrder]}
        clients={[]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId="ord_priced"
        initialExportCommit={exportCommit}
      />
    );

    const download = screen.getByText("Download CSV");
    assert.equal(download.getAttribute("download"), exportCommit.filename);
    assert.ok(screen.getByText("Spreadsheet ready for review"));
    assert.ok(screen.getByRole("button", { name: "Approve & Release" }));
    fireEvent.click(download);
    assert.equal(calls.filter((row) => row.url.includes("mark-spreadsheet-delivered")).length, 0);

    fireEvent.click(screen.getByTestId("mark-spreadsheet-delivered"));
    assert.ok(screen.getByTestId("mark-delivered-dialog"));
    assert.equal(calls.filter((row) => row.url.includes("mark-spreadsheet-delivered")).length, 0);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    assert.equal(screen.queryByTestId("mark-delivered-dialog"), null);
    assert.equal(calls.filter((row) => row.url.includes("mark-spreadsheet-delivered")).length, 0);

    fireEvent.click(screen.getByTestId("mark-spreadsheet-delivered"));
    fireEvent.click(screen.getByTestId("confirm-delivery-button"));
    await waitFor(() => {
      assert.ok(screen.getByTestId("spreadsheet-delivered-success"));
    });
    const deliveryCalls = calls.filter((row) => row.url.includes("mark-spreadsheet-delivered"));
    assert.equal(deliveryCalls.length, 1);
    assert.equal(
      (deliveryCalls[0]?.body as { confirmationPhrase?: string }).confirmationPhrase,
      "MARK SPREADSHEET DELIVERED"
    );
    assert.ok(screen.getByText("Released"));
    assert.equal(screen.queryByText("Spreadsheet ready for review"), null);
    assert.ok(screen.getByText("MANUAL SPREADSHEET DELIVERY RECORDED"));
    assert.ok(screen.getByText("Identities recorded"));

    globalThis.fetch = originalFetch;
  });
});
