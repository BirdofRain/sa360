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

function fillMinimumAgedOrder() {
  selectState("TX");
  fireEvent.change(screen.getByLabelText("Age bucket"), {
    target: { value: "COMMERCE_1_3_MO" },
  });
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
  assert.equal(screen.queryByLabelText("Freshness"), null);
  assert.ok(screen.getByRole("button", { name: "Review request" }));
  const olderLeads = screen.getByLabelText("Allow older leads in my selected states") as HTMLInputElement;
  assert.equal(olderLeads.checked, false);
  const niche = screen.getByLabelText("Lead type") as HTMLSelectElement;
  assert.deepEqual(
    [...niche.options].map((option) => option.text),
    ["Veteran", "Nurse", "Trucker"]
  );
  assert.deepEqual(
    [...niche.options].map((option) => option.value),
    ["vet", "nurse", "trucker"]
  );
  const ageBucket = screen.getByLabelText("Age bucket") as HTMLSelectElement;
  assert.deepEqual(
    [...ageBucket.options].map((option) => option.value).filter(Boolean),
    [
      "COMMERCE_1_3_MO",
      "COMMERCE_3_6_MO",
      "COMMERCE_6_12_MO",
      "COMMERCE_12_MO_PLUS",
    ]
  );
  assert.deepEqual(
    [...ageBucket.options].map((option) => option.text).filter((text) => text !== "Select an age range"),
    ["1–3 months", "3–6 months", "6–12 months", "12+ months"]
  );
  assert.ok(screen.getByText(/Allow older leads in my selected states/));
  assert.equal(screen.queryByText(/If we can't fully fill this age bucket/i), null);
  assert.ok(screen.getByText(/Estimated order total: Price confirmed during review/));
  assert.equal(screen.queryByText("N Veteran"), null);
  assert.equal(screen.queryByText("vet_fex"), null);
  assert.equal(screen.queryByText("nurse_life"), null);
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
  fillMinimumAgedOrder();
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
  assert.equal(submitted?.campaignType, "Aged leads");
  assert.equal(submitted?.requestedAgeBucket, "COMMERCE_1_3_MO");
  assert.equal(submitted?.shortfallPolicy, "REFUND_UNFILLED");
  assert.equal(submitted?.readySmsOptIn, false);
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
  fillMinimumAgedOrder();
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
  fillMinimumAgedOrder();
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
  assert.equal(screen.queryByLabelText("Freshness"), null);
  const niche = screen.getByLabelText("Lead type") as HTMLSelectElement;
  assert.equal(niche.value, "vet");
  assert.ok(screen.getAllByText(/OH · Ohio/).length >= 1);
  assert.ok(screen.getAllByText(/PA · Pennsylvania/).length >= 1);
  const ageBucket = screen.getByLabelText("Age bucket") as HTMLSelectElement;
  assert.equal(ageBucket.value, "COMMERCE_1_3_MO");
  assert.ok(screen.getByText(/Estimated order total: \$1500/));
  assert.ok(screen.getByText("$6 / lead"));
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

test("live-transfer prefill stays an aged order and keeps the age bucket", () => {
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      prefillSearch={{ states: "TX", qty: "40", freshness: "live-transfer", niche: "vet" }}
    />
  );
  assert.equal(screen.queryByLabelText("Freshness"), null);
  assert.equal(screen.queryByTestId("portal-coming-soon"), null);
  assert.ok(screen.getByLabelText("Age bucket"));
  assert.ok(screen.getByText(/Estimated order total/i));
  assert.equal(
    (screen.getByLabelText("Allow older leads in my selected states") as HTMLInputElement).checked,
    false
  );
  cleanup();
});

test("age bucket is required and older-lead consent defaults off", () => {
  render(<PortalOrderRequestForm eligible catalogs={catalogs()} />);
  selectState("TX");
  assert.ok(screen.getByLabelText("Age bucket"));
  assert.equal(
    (screen.getByLabelText("Allow older leads in my selected states") as HTMLInputElement).checked,
    false
  );
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Choose an age range."));
  assert.equal(screen.queryByText("Choose what to do if we cannot fully fill this age bucket."), null);
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  cleanup();
});

test("priced ranges stay aged and 6–12 does not invent one unit price", async () => {
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
            id: "ord_aged",
            orderNumber: "LO-2001",
            status: "submitted",
            paymentConfirmationStatus: "pending_confirmation",
          },
        };
      }}
    />
  );
  selectState("TX");
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_3_6_MO" } });
  assert.ok(screen.getByText(/Estimated order total: \$400/));
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "50" } });
  assert.ok(screen.getByText(/Estimated order total: \$200/));
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_12_MO_PLUS" } });
  assert.ok(screen.getByText(/Estimated order total: \$50/));
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_6_12_MO" } });
  assert.ok(screen.getByText(/Price confirmed during review/));
  assert.ok(screen.getByText(/6–9 month and 9–12 month leads/));
  assert.equal(screen.queryByText("Fresh leads"), null);
  assert.equal(screen.queryByText("Live transfer"), null);
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("6–12 months"));
  assert.ok(screen.getByText("No — discount or refund unfilled leads in this age range"));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(submitted);
  });
  assert.equal(submitted?.campaignType, "Aged leads");
  assert.equal(submitted?.requestedAgeBucket, "COMMERCE_6_12_MO");
  assert.equal(submitted?.shortfallPolicy, "REFUND_UNFILLED");
  assert.equal(String(submitted?.notes).includes("sa360.availabilityInterest"), false);
  cleanup();
});

test("aged review shows estimate, shortfall, and ready-text preference", async () => {
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
            id: "ord_aged2",
            orderNumber: "LO-2002",
            status: "submitted",
            paymentConfirmationStatus: "pending_confirmation",
          },
        };
      }}
    />
  );
  selectState("FL");
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_12_MO_PLUS" } });
  fireEvent.click(screen.getByLabelText("Allow older leads in my selected states"));
  fireEvent.click(screen.getByLabelText("Text me when this order is ready"));
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5552223333" } });
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.equal(screen.queryByText("Freshness"), null);
  assert.ok(screen.getByText("12+ months"));
  assert.ok(screen.getByText("$1 / lead"));
  assert.ok(screen.getByText("$100"));
  assert.ok(screen.getByText("Yes — allow older leads in the selected states"));
  assert.ok(screen.getByText(/Yes — 5552223333/));
  assert.ok(screen.getByText(/Inventory is not reserved/));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(submitted);
  });
  assert.equal(submitted?.requestedAgeBucket, "COMMERCE_12_MO_PLUS");
  assert.equal(submitted?.campaignType, "Aged leads");
  assert.equal(submitted?.shortfallPolicy, "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT");
  assert.equal(submitted?.readySmsOptIn, true);
  assert.equal(submitted?.readySmsPhoneE164, "+15552223333");
  cleanup();
});

test("SMS opt-in requires a valid phone; unchecked does not", () => {
  render(<PortalOrderRequestForm eligible catalogs={catalogs()} />);
  fillMinimumAgedOrder();
  fireEvent.click(screen.getByLabelText("Text me when this order is ready"));
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Enter a valid mobile number."));
  fireEvent.click(screen.getByLabelText("Text me when this order is ready"));
  assert.equal(screen.queryByLabelText("Mobile number"), null);
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByRole("button", { name: "Submit order request" }));
  cleanup();
});

test("feature-enabled map updates the existing order draft and leaves submission payload unchanged", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        evaluatedAt: "2026-10-09T14:00:00.000Z",
        stale: false,
        mappingSupported: true,
        mappingNote: "Mapped source bands.",
        criteria: {
          nicheKey: "vet",
          productType: "exclusive",
          requestedAgeBucket: "COMMERCE_1_3_MO",
          requestedQuantity: 100,
        },
        states: [{ state: "TX", availability: "Available" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  let submitted: Record<string, unknown> | null = null;
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      inventoryMapEnabled
      submitOrder={async (body) => {
        submitted = body;
        return {
          ok: true,
          item: {
            id: "ord_map",
            orderNumber: "LO-MAP",
            status: "submitted",
            paymentConfirmationStatus: "pending_confirmation",
          },
        };
      }}
    />
  );
  assert.ok(await screen.findByTestId("portal-order-inventory-map"));
  fireEvent.change(screen.getByLabelText("Age bucket"), {
    target: { value: "COMMERCE_1_3_MO" },
  });
  await screen.findByText("Mapped source bands.");
  fireEvent.click(screen.getByTestId("portal-map-state-TX"));
  assert.equal(
    (screen.getByLabelText("Allow older leads in my selected states") as HTMLInputElement).checked,
    false
  );
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("TX · Texas"));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => assert.ok(submitted));
  const submittedBody = submitted as Record<string, unknown> | null;
  assert.deepEqual(submittedBody?.states, ["TX"]);
  assert.equal(submittedBody?.requestedAgeBucket, "COMMERCE_1_3_MO");
  assert.equal(submittedBody?.shortfallPolicy, "REFUND_UNFILLED");
  assert.equal("reservation" in (submittedBody ?? {}), false);
  assert.equal("availability" in (submittedBody ?? {}), false);
});

