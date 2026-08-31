import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FulfillmentOpsWorkbench } from "./fulfillment-ops-workbench.tsx";
import type { PplCustomerNotification } from "@/lib/fulfillment-ops/client-api";
import { RELEASE_NOTIFY_COPY } from "@/lib/fulfillment-ops/release-notification";
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

const deliveryBase = {
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
};

afterEach(() => {
  cleanup();
});

function renderWorkbench() {
  return render(
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
}

function mockDeliveryResponse(
  body: Record<string, unknown>,
  status = 200
): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body: parsed });
    if (url.includes("mark-spreadsheet-delivered")) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as typeof fetch;
  return { calls };
}

async function confirmRelease() {
  fireEvent.click(screen.getByTestId("mark-spreadsheet-delivered"));
  fireEvent.click(screen.getByTestId("confirm-delivery-button"));
  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("spreadsheet-delivered-success") ||
        screen.queryByText("Delivery recording failed")
    );
  });
}

function notifyNode() {
  return screen.getByTestId("customer-release-notify-status");
}

describe("Approve & Release customer notification outcome", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sent: Released + Customer email sent", async () => {
    mockDeliveryResponse({
      ...deliveryBase,
      customerNotification: { status: "sent" } satisfies PplCustomerNotification,
    });
    renderWorkbench();
    await confirmRelease();
    assert.ok(screen.getByTestId("spreadsheet-delivered-success"));
    assert.ok(screen.getAllByText("Released").length >= 1);
    assert.ok(screen.getByText("This spreadsheet is customer-accessible."));
    assert.equal(notifyNode().getAttribute("data-kind"), "sent");
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.sent));
    assert.equal(screen.queryByText(RELEASE_NOTIFY_COPY.notifyManually), null);
    assert.equal(screen.queryByText(RELEASE_NOTIFY_COPY.failed), null);
  });

  it("failed: Released + Customer email was not sent + Notify customer manually", async () => {
    const unsafe = "Resend 403 invalid_api_key id=re_secret_token";
    mockDeliveryResponse({
      ...deliveryBase,
      customerNotification: { status: "failed", reason: unsafe },
    });
    renderWorkbench();
    await confirmRelease();
    assert.ok(screen.getByTestId("spreadsheet-delivered-success"));
    assert.ok(screen.getAllByText("Released").length >= 1);
    assert.ok(screen.getByText("This spreadsheet is customer-accessible."));
    assert.equal(notifyNode().getAttribute("data-kind"), "failed");
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.failed));
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.notifyManually));
    assert.equal(screen.queryByText("Customer email sent"), null);
    assert.equal(notifyNode().textContent?.includes(unsafe), false);
    assert.equal(notifyNode().textContent?.includes("Resend"), false);
    assert.equal(notifyNode().textContent?.includes("re_secret_token"), false);
  });

  it("in_progress: Released + pending", async () => {
    mockDeliveryResponse({
      ...deliveryBase,
      customerNotification: { status: "in_progress" },
    });
    renderWorkbench();
    await confirmRelease();
    assert.ok(screen.getAllByText("Released").length >= 1);
    assert.equal(notifyNode().getAttribute("data-kind"), "pending");
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.pending));
    assert.match(notifyNode().textContent ?? "", /pending/i);
    assert.equal(screen.queryByText("Customer email sent"), null);
    assert.equal(screen.queryByText(RELEASE_NOTIFY_COPY.failed), null);
  });

  it("skipped: Released + No automated notification", async () => {
    mockDeliveryResponse({
      ...deliveryBase,
      customerNotification: {
        status: "skipped",
        reason: "missing_portal_login_email",
      },
    });
    renderWorkbench();
    await confirmRelease();
    assert.ok(screen.getAllByText("Released").length >= 1);
    assert.equal(notifyNode().getAttribute("data-kind"), "skipped");
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.skipped));
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.notifyManually));
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.skipReasons.missing_portal_login_email));
    assert.equal(screen.queryByText("Customer email sent"), null);
  });

  it("no_intent: never claims sent", async () => {
    mockDeliveryResponse({
      ...deliveryBase,
      customerNotification: {
        status: "no_intent",
        reason: "legacy_no_notification_intent",
      },
    });
    renderWorkbench();
    await confirmRelease();
    assert.ok(screen.getAllByText("Released").length >= 1);
    assert.equal(notifyNode().getAttribute("data-kind"), "no_intent");
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.noIntent));
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.noIntentExplanation));
    assert.ok(screen.getByText(RELEASE_NOTIFY_COPY.notifyManually));
    assert.equal(screen.queryByText("Customer email sent"), null);
    assert.equal(notifyNode().textContent?.includes("legacy_no_notification_intent"), false);
  });

  it("missing notification: Released still succeeds with no false sent state", async () => {
    mockDeliveryResponse({ ...deliveryBase });
    renderWorkbench();
    await confirmRelease();
    assert.ok(screen.getByTestId("spreadsheet-delivered-success"));
    assert.ok(screen.getAllByText("Released").length >= 1);
    assert.ok(screen.getByText("This spreadsheet is customer-accessible."));
    assert.equal(notifyNode().getAttribute("data-kind"), "unknown");
    assert.equal(screen.queryByText("Customer email sent"), null);
    assert.equal(screen.queryByText(RELEASE_NOTIFY_COPY.failed), null);
  });

  it("preserves confirm phrase, cancel, and release failure behavior", async () => {
    const { calls } = mockDeliveryResponse(
      { ok: false, error: "confirmation_phrase_invalid" },
      400
    );
    renderWorkbench();

    fireEvent.click(screen.getByTestId("mark-spreadsheet-delivered"));
    assert.ok(screen.getByTestId("mark-delivered-dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    assert.equal(screen.queryByTestId("mark-delivered-dialog"), null);
    assert.equal(calls.length, 0);

    fireEvent.click(screen.getByTestId("mark-spreadsheet-delivered"));
    fireEvent.click(screen.getByTestId("confirm-delivery-button"));
    await waitFor(() => {
      assert.ok(screen.getByText("Delivery recording failed"));
    });
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0]?.body as { confirmationPhrase?: string }).confirmationPhrase,
      "MARK SPREADSHEET DELIVERED"
    );
    assert.equal(screen.queryByTestId("spreadsheet-delivered-success"), null);
    assert.ok(screen.getByText("Spreadsheet ready for review"));
    assert.equal(screen.queryByText("Customer email sent"), null);
    assert.ok(screen.getByTestId("mark-spreadsheet-delivered"));
  });
});
