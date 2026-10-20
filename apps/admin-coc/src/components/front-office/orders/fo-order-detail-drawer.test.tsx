import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { LeadOrder } from "@/lib/front-office/types";

import { FoOrderDetailDrawer } from "./fo-order-detail-drawer";
import { FoOrderList } from "./fo-order-list";

afterEach(() => {
  cleanup();
});

function pendingOrder(): LeadOrder {
  return {
    id: "ord_pending",
    orderNumber: "LO-1044",
    clientName: "Pacific Solar Co",
    clientAccountId: "acct_pacific",
    niche: "Solar",
    productType: "Aged exclusive",
    states: ["AZ", "NV"],
    state: "AZ, NV",
    volume: 400,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro + SA360 routing",
    aiVoiceAddon: true,
    deliveryDestination: "GHL subaccount · Phoenix Solar",
    status: "submitted",
    adminStatus: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: "2026-08-27T15:10:00.000Z",
    submittedAt: "2026-08-27T15:10:00.000Z",
  };
}

describe("FoOrderDetailDrawer review", () => {
  it("shows the fields Alex needs to validate a pending order", () => {
    render(
      <FoOrderDetailDrawer
        order={pendingOrder()}
        open
        onOpenChange={() => undefined}
        isAdmin
      />
    );
    const fields = screen.getByTestId("fo-order-review-fields");
    assert.match(fields.textContent ?? "", /Pacific Solar Co/);
    assert.match(fields.textContent ?? "", /LO-1044/);
    assert.match(fields.textContent ?? "", /Solar · Aged exclusive/);
    assert.match(fields.textContent ?? "", /400/);
    assert.match(fields.textContent ?? "", /AZ, NV/);
    assert.match(fields.textContent ?? "", /Payment pending/);
    assert.match(fields.textContent ?? "", /Submitted/);
    assert.ok(screen.getByTestId("fo-review-action-confirm-and-approve"));
    assert.ok(screen.getByTestId("fo-review-action-confirm-payment"));
    assert.ok(screen.getByTestId("fo-review-action-mark-payment-not-required"));
    assert.equal(screen.queryByRole("button", { name: /^Activate$/i }), null);
    assert.equal(screen.queryByText("active"), null);
  });

  it("shows Active in the status select instead of a stale Submitted default", () => {
    render(
      <FoOrderDetailDrawer
        order={{
          ...pendingOrder(),
          status: "active",
          adminStatus: "active",
          paymentConfirmationStatus: "not_required",
          pricedPpl: {
            commerceAgeBucketKey: "COMMERCE_6_9_MO",
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            unitPriceCents: 300,
            lineTotalCents: 900,
            requestedQuantity: 3,
            label: "6–9 Months",
          },
          agedCommerce: {
            requestedAgeBucket: "COMMERCE_6_9_MO",
            shortfallPolicy: "REFUND_UNFILLED",
            label: "6–9 Months",
          },
        }}
        open
        onOpenChange={() => undefined}
        isAdmin
      />
    );
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    assert.equal(select.value, "active");
    assert.equal(select.disabled, true);
    assert.ok(screen.getByRole("option", { name: "Active" }));
    assert.ok(screen.getByTestId("fo-status-select-note"));
    const fields = screen.getByTestId("fo-order-review-fields");
    assert.match(fields.textContent ?? "", /6–9 Months/);
    assert.match(fields.textContent ?? "", /\$3/);
    assert.match(fields.textContent ?? "", /\$9/);
  });

  it("tells the team an approved older bucket is a new listed-price order", () => {
    render(
      <FoOrderDetailDrawer
        order={{
          ...pendingOrder(),
          pricedPpl: null,
          shortfallPolicy: "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
          orderTotalCents: 2000,
          lines: [
            {
              lineId: "line-young",
              label: "1–3 Months",
              requestedQuantity: 2,
              unitPriceCents: 600,
              lineTotalCents: 1200,
            },
            {
              lineId: "line-older",
              label: "3–6 Months",
              requestedQuantity: 2,
              unitPriceCents: 400,
              lineTotalCents: 800,
            },
          ],
        }}
        open
        onOpenChange={() => undefined}
        isAdmin
      />
    );
    const fields = screen.getByTestId("fo-order-review-fields");
    assert.match(fields.textContent ?? "", /new order at that bucket's listed price/);
    assert.match(fields.textContent ?? "", /This order keeps its bucket and price/);
    assert.equal((fields.textContent ?? "").includes("applicable lower rate"), false);
  });

  it("Completed status select is read-only and Save notes omits status", async () => {
    const patches: unknown[] = [];
    const requestImpl = (async (_url: string, init?: RequestInit) => {
      patches.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(JSON.stringify({ ok: true, order: { id: "ord_pending" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    render(
      <FoOrderDetailDrawer
        order={{
          ...pendingOrder(),
          status: "completed",
          adminStatus: "completed",
        }}
        open
        onOpenChange={() => undefined}
        isAdmin
        requestImpl={requestImpl}
      />
    );
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    assert.equal(select.disabled, true);
    fireEvent.submit(screen.getByRole("button", { name: "Save notes" }).closest("form")!);
    await Promise.resolve();
    assert.equal(patches.length, 1);
    assert.equal(Object.hasOwn(patches[0] as object, "status"), false);
  });

  it("Save notes on an Active order does not PATCH status", async () => {
    const patches: unknown[] = [];
    const requestImpl = (async (_url: string, init?: RequestInit) => {
      patches.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(JSON.stringify({ ok: true, order: { id: "ord_pending" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    render(
      <FoOrderDetailDrawer
        order={{
          ...pendingOrder(),
          status: "active",
          adminStatus: "active",
        }}
        open
        onOpenChange={() => undefined}
        isAdmin
        requestImpl={requestImpl}
      />
    );
    fireEvent.submit(screen.getByRole("button", { name: "Save notes" }).closest("form")!);
    await Promise.resolve();
    assert.equal(patches.length, 1);
    assert.equal(Object.hasOwn(patches[0] as object, "status"), false);
  });

  it("uses a wrapping admin layout for review actions", () => {
    render(
      <FoOrderDetailDrawer
        order={pendingOrder()}
        open
        onOpenChange={() => undefined}
        isAdmin
      />
    );
    const actions = screen.getByTestId("fo-order-review-actions");
    const buttonRow = actions.querySelector(".sm\\:flex-row");
    assert.ok(buttonRow);
    assert.match(buttonRow?.className ?? "", /flex-col/);
    assert.ok(screen.getByTestId("fo-review-action-confirm-and-approve"));
    assert.ok(screen.getByTestId("fo-review-action-confirm-payment"));
  });

  it("shows coming-soon interest and hides aged approval", () => {
    const interest = {
      ...pendingOrder(),
      niche: "Veteran",
      campaignType: "Fresh leads",
      availabilityInterest: {
        requestedOffering: "fresh_leads" as const,
        notifyWhenAvailable: true as const,
      },
    };
    render(
      <FoOrderDetailDrawer order={interest} open onOpenChange={() => undefined} isAdmin />
    );
    const banner = screen.getByTestId("fo-order-interest-banner");
    assert.match(banner.textContent ?? "", /Fresh Leads · Interest/);
    assert.match(banner.textContent ?? "", /Notify when available: Yes/);
    assert.match(banner.textContent ?? "", /Interest \/ Coming soon/);
    assert.equal(screen.queryByTestId("fo-review-action-confirm-and-approve"), null);
    assert.equal(banner.textContent?.includes("sa360.availabilityInterest"), false);
  });
});

describe("FoOrderList interest", () => {
  it("badges a coming-soon request and leaves aged orders in review", () => {
    render(
      <FoOrderList
        orders={[
          pendingOrder(),
          {
            ...pendingOrder(),
            id: "ord_interest",
            orderNumber: "LO-2001",
            niche: "Nurse",
            campaignType: "Live transfer",
            availabilityInterest: {
              requestedOffering: "live_transfer",
              notifyWhenAvailable: true,
            },
          },
        ]}
      />
    );
    assert.ok(screen.getByText("Live Transfer · Interest"));
    assert.ok(screen.getByText("Interest / Coming soon"));
    assert.ok(screen.getByText("Submitted / Payment pending"));
  });
});
