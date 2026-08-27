import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { buildPortalOrderRequestCatalogs } from "@/lib/client-portal/portal-order-request";

import { PortalOrderRequestForm } from "./portal-order-request-form.tsx";

function catalogs() {
  return buildPortalOrderRequestCatalogs({
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["exclusive"],
    locationName: "Valley Vet GHL",
    displayName: "Valley Vet",
  });
}

function selectState(code: string) {
  const labels = screen.getAllByText(new RegExp(`^${code} ·`));
  fireEvent.click(labels[0]!);
}

test("inactive account cannot submit and links to account", () => {
  render(<PortalOrderRequestForm eligible={false} catalogs={catalogs()} />);
  assert.ok(screen.getByText("Complete your account before placing an order."));
  const accountLink = screen.getByRole("link", { name: "Go to account" });
  assert.equal(accountLink.getAttribute("href"), "/portal/account");
  assert.equal(screen.queryByRole("button", { name: "Review request" }), null);
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  cleanup();
});

test("active account can reach the configure form", () => {
  render(<PortalOrderRequestForm eligible catalogs={catalogs()} />);
  assert.ok(screen.getByText("Configure request"));
  assert.ok(screen.getByLabelText("Lead type"));
  assert.ok(screen.getByLabelText("Quantity"));
  assert.ok(screen.getByLabelText("States"));
  assert.ok(screen.getByRole("button", { name: "Review request" }));
  cleanup();
});

test("validation failure stays on the form", () => {
  render(<PortalOrderRequestForm eligible catalogs={catalogs()} />);
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Choose at least one state."));
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  assert.ok(screen.getByRole("button", { name: "Review request" }));
  cleanup();
});

test("successful submitted + payment pending UX", async () => {
  let submitted: Record<string, unknown> | null = null;
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      submitOrder={async (body) => {
        submitted = body;
        return {
          ok: true,
          item: {
            id: "ord_99",
            orderNumber: "LO-1099",
            status: "submitted",
            paymentConfirmationStatus: "pending_confirmation",
          },
        };
      }}
    />
  );
  selectState("TX");
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Lead type"));
  assert.ok(screen.getByText("Veteran"));
  assert.ok(screen.getByText("Quantity"));
  assert.ok(screen.getByText("TX · Texas"));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(screen.getByText("Order request received"));
  });
  assert.ok(
    screen.getByText("We will confirm payment and approve your order before fulfillment begins.")
  );
  assert.ok(screen.getByText("Awaiting payment confirmation"));
  assert.equal(screen.getByRole("link", { name: "View order" }).getAttribute("href"), "/portal/orders/ord_99");
  assert.equal(screen.getByRole("link", { name: "Back to orders" }).getAttribute("href"), "/portal/orders");
  assert.equal(screen.queryByText(/buy/i), null);
  assert.equal(screen.queryByText(/purchase/i), null);
  assert.equal(screen.queryByText(/stripe/i), null);
  assert.equal(screen.queryByText(/order confirmed/i), null);
  assert.ok(submitted);
  assert.equal(submitted?.status, undefined);
  assert.equal(submitted?.paymentConfirmationStatus, undefined);
  assert.equal(submitted?.orderKind, undefined);
  assert.equal(submitted?.fulfillmentMode, undefined);
  assert.equal(submitted?.nicheKey, "vet");
  assert.deepEqual(submitted?.states, ["TX"]);
  cleanup();
});

test("API failure stays on review with an error", async () => {
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      submitOrder={async () => ({ ok: false, error: "Service unavailable" })}
    />
  );
  selectState("TX");
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(screen.getByRole("alert"));
  });
  assert.ok(screen.getByText("Service unavailable"));
  assert.ok(screen.getByRole("button", { name: "Submit order request" }));
  cleanup();
});
