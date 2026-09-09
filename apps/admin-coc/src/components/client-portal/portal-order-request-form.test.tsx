import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { buildPortalOrderRequestCatalogs } from "@/lib/client-portal/portal-order-request";

import { PortalOrderRequestForm } from "./portal-order-request-form.tsx";

beforeEach(() => {
  sessionStorage.clear();
});

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

test("onboarding account cannot open a submit-capable form", () => {
  render(
    <PortalOrderRequestForm eligible={false} blockedReason="onboarding" catalogs={catalogs()} />
  );
  assert.ok(screen.getByText("Complete your account before placing an order."));
  const accountLink = screen.getByRole("link", { name: "Complete account" });
  assert.equal(accountLink.getAttribute("href"), "/portal/account");
  assert.equal(screen.queryByRole("button", { name: "Review request" }), null);
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  cleanup();
});

test("paused account cannot submit", () => {
  render(
    <PortalOrderRequestForm eligible={false} blockedReason="paused" catalogs={catalogs()} />
  );
  assert.ok(screen.getByText(/not available to place an order/i));
  assert.equal(screen.queryByRole("link", { name: "Complete account" }), null);
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  cleanup();
});

test("archived account cannot submit", () => {
  render(
    <PortalOrderRequestForm eligible={false} blockedReason="archived" catalogs={catalogs()} />
  );
  assert.ok(screen.getByText(/not available to place an order/i));
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  cleanup();
});

test("account-state API failure fails closed", () => {
  render(
    <PortalOrderRequestForm eligible={false} blockedReason="unknown" catalogs={catalogs()} />
  );
  assert.ok(
    screen.getByText("We could not confirm that your account is ready to place an order.")
  );
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
  assert.ok(screen.getByLabelText("Freshness"));
  assert.ok(screen.getByRole("button", { name: "Review request" }));
  assert.equal(screen.queryByLabelText("CRM"), null);
  assert.equal(screen.queryByText("GHL Starter"), null);
  assert.equal(screen.queryByText("GHL Starter + SA360 AI"), null);
  assert.equal(screen.queryByText("GHL Pro + SA360 routing"), null);
  assert.equal(screen.queryByLabelText("Delivery destination"), null);
  cleanup();
});

test("shows delivery destination only when customer labels are distinct", () => {
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={buildPortalOrderRequestCatalogs({
        primaryNicheKeys: ["vet"],
        locationName: "Austin office",
        displayName: "Dallas office",
      })}
    />
  );
  assert.ok(screen.getByLabelText("Delivery destination"));
  assert.ok(screen.getByRole("option", { name: "Austin office" }));
  assert.ok(screen.getByRole("option", { name: "Dallas office" }));
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
  assert.equal(screen.queryByText("GHL Starter"), null);
  assert.equal(screen.queryByText("GHL Starter + SA360 AI"), null);
  assert.equal(screen.queryByText("GHL Pro + SA360 routing"), null);
  assert.equal(screen.queryByText("CRM"), null);
  assert.ok(screen.getByText("Valley Vet"));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(screen.getByText("Order request received"));
  });
  assert.ok(screen.getAllByText(/Submitted for review/i).length >= 1);
  assert.ok(screen.getByText("What happens next"));
  assert.ok(screen.getByText("Payment pending"));
  assert.ok(screen.getAllByText("LO-1099").length >= 1);
  assert.equal(screen.getByRole("link", { name: "View order" }).getAttribute("href"), "/portal/orders/ord_99");
  assert.equal(screen.getByRole("link", { name: "Go to your account" }).getAttribute("href"), "/portal/account");
  assert.equal(screen.getByRole("link", { name: "Back to orders" }).getAttribute("href"), "/portal/orders");
  assert.equal(screen.queryByText(/buy/i), null);
  assert.equal(screen.queryByText(/purchase/i), null);
  assert.equal(screen.queryByText(/stripe/i), null);
  assert.equal(screen.queryByText(/order confirmed/i), null);
  assert.equal(screen.queryByText("GHL Starter"), null);
  assert.ok(submitted);
  assert.equal(submitted?.status, undefined);
  assert.equal(submitted?.paymentConfirmationStatus, undefined);
  assert.equal(submitted?.orderKind, undefined);
  assert.equal(submitted?.fulfillmentMode, undefined);
  assert.equal(submitted?.nicheKey, "vet");
  assert.deepEqual(submitted?.states, ["TX"]);
  assert.equal(submitted?.crmPackage, "lead_delivery");
  assert.equal(submitted?.deliveryDestinationLabel, "Valley Vet GHL");
  cleanup();
});

test("preview mode shows a not-connected error instead of submitting", async () => {
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      previewUnavailableMessage="Order requests are not connected yet."
    />
  );
  selectState("TX");
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(screen.getByText("Order requests are not connected yet."));
  });
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

test("prefill from public preview fills Veteran, states, quantity, and age bucket", () => {
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      prefillSearch={{
        states: "OH,PA",
        qty: "250",
        freshness: "aged-30-90",
        niche: "vet",
        crmPackage: "GHL Starter",
      }}
    />
  );
  assert.ok(screen.getByText(/Aged Vet Leads preview is filled in/i));
  const quantity = screen.getByLabelText("Quantity") as HTMLInputElement;
  assert.equal(quantity.value, "250");
  const freshness = screen.getByLabelText("Freshness") as HTMLSelectElement;
  assert.equal(freshness.value, "Aged leads");
  const niche = screen.getByLabelText("Lead type") as HTMLSelectElement;
  assert.equal(niche.value, "vet");
  assert.ok(screen.getAllByText(/OH · Ohio/).length >= 1);
  assert.ok(screen.getAllByText(/PA · Pennsylvania/).length >= 1);
  assert.match((screen.getByLabelText("Notes (optional)") as HTMLTextAreaElement).value, /30–90 days/);
  assert.equal(screen.queryByText("GHL Starter"), null);
  assert.equal(screen.queryByLabelText("CRM"), null);
  cleanup();
});

test("manipulated prefill values are dropped and do not skip review", () => {
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      prefillSearch={{
        states: "ZZ",
        qty: "abc",
        freshness: "live-transfer",
        niche: "trucker",
      }}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Choose at least one state."));
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  const niche = screen.getByLabelText("Lead type") as HTMLSelectElement;
  assert.equal(niche.value, "vet");
  cleanup();
});
