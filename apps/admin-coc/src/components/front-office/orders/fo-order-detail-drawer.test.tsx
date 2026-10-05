import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

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
