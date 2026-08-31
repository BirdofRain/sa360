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
      key: "COMMERCE_1_3_MO",
      label: "1–3 Months",
      minDaysInclusive: 30,
      maxDaysExclusive: 90,
      unitPriceCents: 4500,
      status: "active",
    },
    {
      key: "COMMERCE_3_6_MO",
      label: "3–6 Months",
      minDaysInclusive: 90,
      maxDaysExclusive: 180,
      unitPriceCents: 4200,
      status: "active",
    },
    {
      key: "COMMERCE_6_9_MO",
      label: "6–9 Months",
      minDaysInclusive: 180,
      maxDaysExclusive: 270,
      unitPriceCents: 3800,
      status: "active",
    },
    {
      key: "COMMERCE_9_12_MO",
      label: "9–12 Months",
      minDaysInclusive: 270,
      maxDaysExclusive: 365,
      unitPriceCents: 200,
      status: "active",
    },
    {
      key: "COMMERCE_12_MO_PLUS",
      label: "12+ Months",
      minDaysInclusive: 365,
      maxDaysExclusive: null,
      unitPriceCents: 1800,
      status: "active",
    },
  ],
  holdBuckets: [
    { key: "FRESH", label: "Fresh", minDaysInclusive: 0, maxDaysExclusive: 10, status: "HOLD" },
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
    invalidStateReviewCount: 0,
  },
  selectedOrder: null,
  latestEvidence: null,
  orderError: null,
  limitations: [],
};

function makeOrder(overrides: Partial<FulfillmentOpsOrder> = {}): FulfillmentOpsOrder {
  return {
    id: "ord_50",
    orderNumber: "LO-2050",
    clientAccountId: "client_valley",
    clientDisplayName: "Valley Vet",
    status: "active",
    nicheKey: "VET",
    productType: null,
    states: ["NC"],
    leadVolume: 50,
    requestedQuantity: 50,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    remainingCapacity: 3,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    activatedAt: "2026-08-31T00:00:00.000Z",
    allocationReady: true,
    allocationBlockers: [],
    pricing: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

const pricedOrder = makeOrder({
  id: "ord_priced",
  orderNumber: "LO-1048",
  clientAccountId: "client_demo",
  clientDisplayName: "Smart Agent 360 Demo",
  leadVolume: 1,
  requestedQuantity: 1,
  remainingCapacity: 0,
  pricing: {
    commerceAgeBucketKey: "COMMERCE_9_12_MO",
    pricingVersion: "ppl_aged_beta_2026_08_v1",
    unitPriceCents: 200,
    lineTotalCents: 200,
    requestedQuantity: 1,
    label: "9–12 Months",
  },
});

type FetchCall = { url: string; body: unknown };

function mockFetch(): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.includes("/selection/preview") || url.includes("/selection/commit")) {
      return new Response(
        JSON.stringify({
          ok: true,
          orderId: "ord_50",
          requestedQuantity: (body as { requestedQuantity?: number })?.requestedQuantity ?? 0,
          selectedQuantity: (body as { requestedQuantity?: number })?.requestedQuantity ?? 0,
          eligibleQuantity: (body as { requestedQuantity?: number })?.requestedQuantity ?? 0,
          shortfallQuantity: 0,
          selectedItemIds: [],
          commerceAgeBucketKeys:
            (body as { commerceAgeBucketKeys?: string[] })?.commerceAgeBucketKeys ?? [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/activate")) {
      return new Response(
        JSON.stringify({
          ok: true,
          order: makeOrder({ status: "active", remainingCapacity: 0 }),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("latest-evidence")) {
      return new Response(JSON.stringify({ evidence: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("replacements")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function renderWorkbench(input: {
  order?: FulfillmentOpsOrder | null;
  orders?: FulfillmentOpsOrder[];
  initialOrderId?: string | null;
  bootstrapOrder?: FulfillmentOpsOrder | null;
}) {
  const order = input.order === undefined ? makeOrder() : input.order;
  const orders = input.orders ?? (order ? [order] : []);
  const selected = input.bootstrapOrder === undefined ? order : input.bootstrapOrder;
  return render(
    <FulfillmentOpsWorkbench
      bootstrap={{ ...baseBootstrap, selectedOrder: selected }}
      orders={orders}
      clients={[{ id: "client_valley", label: "Valley Vet" }]}
      pricingCatalog={catalog}
      loadError={null}
      initialOrderId={input.initialOrderId ?? selected?.id ?? null}
    />
  );
}

function selectionCalls(calls: FetchCall[]) {
  return calls.filter(
    (row) => row.url.includes("/selection/preview") || row.url.includes("/selection/commit")
  );
}

afterEach(() => {
  cleanup();
});

describe("Fulfillment Ops existing-order guardrails", () => {
  it("1: unpriced existing 50-order shows quantity 50 and preview sends requestedQuantity 50", async () => {
    const fetchMock = mockFetch();
    try {
      renderWorkbench({ order: makeOrder({ remainingCapacity: 3 }) });
      const qty = screen.getByTestId("stage-2b-quantity") as HTMLInputElement;
      assert.equal(qty.value, "50");
      fireEvent.change(screen.getByTestId("stage-2b-commerce-bucket-select"), {
        target: { value: "COMMERCE_3_6_MO" },
      });
      fireEvent.click(screen.getByTestId("stage-2b-preview"));
      await waitFor(() => {
        assert.equal(selectionCalls(fetchMock.calls).length, 1);
      });
      const preview = selectionCalls(fetchMock.calls)[0];
      assert.ok(preview.url.includes("/selection/preview"));
      assert.equal((preview.body as { requestedQuantity: number }).requestedQuantity, 50);
      assert.deepEqual((preview.body as { commerceAgeBucketKeys: string[] }).commerceAgeBucketKeys, [
        "COMMERCE_3_6_MO",
      ]);
    } finally {
      fetchMock.restore();
    }
  });

  it("2: bootstrap through ?orderId= initializes quantity from the existing order", () => {
    renderWorkbench({
      order: makeOrder({ id: "ord_boot", requestedQuantity: 50, leadVolume: 50 }),
      bootstrapOrder: null,
      initialOrderId: "ord_boot",
      orders: [makeOrder({ id: "ord_boot", requestedQuantity: 50, leadVolume: 50 })],
    });
    assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "50");
    assert.match(screen.getByTestId("stage-2b-order-context").textContent ?? "", /LO-2050/);
    assert.match(screen.getByTestId("stage-2b-order-context").textContent ?? "", /Valley Vet/);
  });

  it("2b: selecting another existing order resyncs Stage 2b quantity", async () => {
    const one = makeOrder({
      id: "ord_1",
      orderNumber: "LO-2001",
      requestedQuantity: 1,
      leadVolume: 1,
    });
    const fifty = makeOrder({
      id: "ord_50",
      orderNumber: "LO-2050",
      requestedQuantity: 50,
      leadVolume: 50,
    });
    const fetchMock = mockFetch();
    try {
      renderWorkbench({ order: one, orders: [one, fifty] });
      assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "1");
      fireEvent.change(screen.getByTestId("fulfillment-ops-order-select"), {
        target: { value: "ord_50" },
      });
      await waitFor(() => {
        assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "50");
      });
      assert.match(screen.getByTestId("stage-2b-order-context").textContent ?? "", /LO-2050/);
    } finally {
      fetchMock.restore();
    }
  });

  it("3: refresh after Activate keeps the authoritative quantity", async () => {
    const ready = makeOrder({
      status: "ready",
      activatedAt: null,
      allocationReady: false,
      remainingCapacity: 50,
    });
    const fetchMock = mockFetch();
    try {
      renderWorkbench({ order: ready });
      assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "50");
      fireEvent.click(screen.getByRole("button", { name: "Activate order" }));
      await waitFor(() => {
        assert.ok(fetchMock.calls.some((row) => row.url.includes("/activate")));
      });
      await waitFor(() => {
        assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "50");
      });
    } finally {
      fetchMock.restore();
    }
  });

  it("4: existing quantity-1 order keeps quantity 1", () => {
    renderWorkbench({
      order: makeOrder({
        id: "ord_1",
        orderNumber: "LO-2001",
        leadVolume: 1,
        requestedQuantity: 1,
        remainingCapacity: 1,
      }),
    });
    assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "1");
  });

  it("5: operator cannot silently edit 50 down to 1", async () => {
    const fetchMock = mockFetch();
    try {
      renderWorkbench({});
      const qty = screen.getByTestId("stage-2b-quantity") as HTMLInputElement;
      assert.equal(qty.value, "50");
      assert.equal(qty.readOnly, true);
      assert.equal(qty.disabled, true);
      fireEvent.change(qty, { target: { value: "1" } });
      assert.equal((screen.getByTestId("stage-2b-quantity") as HTMLInputElement).value, "50");
      fireEvent.change(screen.getByTestId("stage-2b-commerce-bucket-select"), {
        target: { value: "COMMERCE_3_6_MO" },
      });
      fireEvent.click(screen.getByTestId("stage-2b-preview"));
      await waitFor(() => {
        assert.equal(selectionCalls(fetchMock.calls).length, 1);
      });
      assert.equal(
        (selectionCalls(fetchMock.calls)[0].body as { requestedQuantity: number }).requestedQuantity,
        50
      );
    } finally {
      fetchMock.restore();
    }
  });

  it("6: unpriced existing order with no bucket selected disables Preview/Commit and does not POST", () => {
    const fetchMock = mockFetch();
    try {
      renderWorkbench({});
      const bucket = screen.getByTestId("stage-2b-commerce-bucket-select") as HTMLSelectElement;
      assert.equal(bucket.value, "");
      assert.ok(screen.getByRole("option", { name: "Select age bucket…" }));
      assert.equal(bucket.value.includes("COMMERCE_1_3_MO"), false);
      assert.equal((screen.getByTestId("stage-2b-preview") as HTMLButtonElement).disabled, true);
      assert.equal((screen.getByTestId("stage-2b-commit") as HTMLButtonElement).disabled, true);
      fireEvent.click(screen.getByTestId("stage-2b-preview"));
      fireEvent.click(screen.getByTestId("stage-2b-commit"));
      assert.equal(selectionCalls(fetchMock.calls).length, 0);
    } finally {
      fetchMock.restore();
    }
  });

  it("7: selecting COMMERCE_3_6_MO sends only that bucket", async () => {
    const fetchMock = mockFetch();
    try {
      renderWorkbench({});
      fireEvent.change(screen.getByTestId("stage-2b-commerce-bucket-select"), {
        target: { value: "COMMERCE_3_6_MO" },
      });
      fireEvent.click(screen.getByTestId("stage-2b-commit"));
      await waitFor(() => {
        assert.equal(selectionCalls(fetchMock.calls).length, 1);
      });
      const commit = selectionCalls(fetchMock.calls)[0];
      assert.ok(commit.url.includes("/selection/commit"));
      assert.deepEqual((commit.body as { commerceAgeBucketKeys: string[] }).commerceAgeBucketKeys, [
        "COMMERCE_3_6_MO",
      ]);
      assert.equal((commit.body as { requestedQuantity: number }).requestedQuantity, 50);
    } finally {
      fetchMock.restore();
    }
  });

  it("8: priced order locks bucket and keeps priced quantity authoritative", async () => {
    const fetchMock = mockFetch();
    try {
      renderWorkbench({
        order: makeOrder({
          ...pricedOrder,
          leadVolume: 99,
          requestedQuantity: 1,
          remainingCapacity: 0,
        }),
      });
      const qty = screen.getByTestId("stage-2b-quantity") as HTMLInputElement;
      assert.equal(qty.value, "1");
      const bucket = screen.getByTestId("stage-2b-commerce-bucket-select") as HTMLSelectElement;
      assert.equal(bucket.value, "COMMERCE_9_12_MO");
      assert.equal(bucket.disabled, true);
      fireEvent.change(bucket, { target: { value: "COMMERCE_3_6_MO" } });
      assert.equal(
        (screen.getByTestId("stage-2b-commerce-bucket-select") as HTMLSelectElement).value,
        "COMMERCE_9_12_MO"
      );
      fireEvent.click(screen.getByTestId("stage-2b-preview"));
      await waitFor(() => {
        assert.equal(selectionCalls(fetchMock.calls).length, 1);
      });
      const preview = selectionCalls(fetchMock.calls)[0];
      assert.deepEqual((preview.body as { commerceAgeBucketKeys: string[] }).commerceAgeBucketKeys, [
        "COMMERCE_9_12_MO",
      ]);
      assert.equal((preview.body as { requestedQuantity: number }).requestedQuantity, 1);
    } finally {
      fetchMock.restore();
    }
  });

  it("9: existing-order context de-emphasizes the create-order form", () => {
    renderWorkbench({});
    assert.ok(screen.getByTestId("create-different-order"));
    assert.equal(screen.queryByRole("button", { name: "Create Client Lead Order" }), null);
    assert.equal(screen.queryByTestId("create-client-lead-order"), null);
    assert.match(screen.getByTestId("selected-order-context").textContent ?? "", /Valley Vet/);
  });

  it("10: with no selected order the create-order path remains available", () => {
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[]}
        clients={[{ id: "client_valley", label: "Valley Vet" }]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByRole("button", { name: "Create Client Lead Order" }));
    assert.ok(screen.getByTestId("create-client-lead-order"));
    assert.equal(screen.queryByTestId("create-different-order"), null);
  });

  it("11: two same-niche orders for different clients are visually distinct", () => {
    const valley = makeOrder({
      id: "ord_a",
      orderNumber: "LO-2001",
      clientDisplayName: "Valley Vet",
      nicheKey: "VET",
    });
    const metro = makeOrder({
      id: "ord_b",
      orderNumber: "LO-2002",
      clientDisplayName: "Metro Vet",
      nicheKey: "VET",
    });
    const unnamed = makeOrder({
      id: "ord_c",
      orderNumber: "LO-2003",
      clientDisplayName: null,
      nicheKey: "VET",
    });
    render(
      <FulfillmentOpsWorkbench
        bootstrap={baseBootstrap}
        orders={[valley, metro, unnamed]}
        clients={[]}
        pricingCatalog={catalog}
        loadError={null}
        initialOrderId={null}
      />
    );
    assert.ok(screen.getByRole("option", { name: "LO-2001 — Valley Vet — VET — active" }));
    assert.ok(screen.getByRole("option", { name: "LO-2002 — Metro Vet — VET — active" }));
    assert.ok(screen.getByRole("option", { name: "LO-2003 — Unnamed client — VET — active" }));
  });

  it("12: submitted orders are not auto-activated and cannot skip into selection", () => {
    const fetchMock = mockFetch();
    try {
      const submitted = makeOrder({
        status: "submitted",
        activatedAt: null,
        allocationReady: false,
        allocationBlockers: ["order_status_submitted"],
      });
      renderWorkbench({ order: submitted });
      assert.ok(screen.getByRole("button", { name: "Activate order" }));
      assert.ok(screen.getByText(/NOT ALLOCATION READY/i));
      assert.ok(screen.getByText(/order_status_submitted/));
      assert.equal((screen.getByTestId("stage-2b-preview") as HTMLButtonElement).disabled, true);
      assert.equal((screen.getByTestId("stage-2b-commit") as HTMLButtonElement).disabled, true);
      assert.equal(selectionCalls(fetchMock.calls).length, 0);
      assert.ok(!fetchMock.calls.some((row) => row.url.includes("/activate")));
    } finally {
      fetchMock.restore();
    }
  });
});
