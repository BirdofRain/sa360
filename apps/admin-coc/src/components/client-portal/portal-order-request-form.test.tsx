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

function submittedBody(value: Record<string, unknown> | null): Record<string, unknown> {
  assert.ok(value);
  return value;
}

function fillMinimumAgedOrder() {
  selectState("TX");
  fireEvent.change(screen.getByLabelText("Age bucket"), {
    target: { value: "COMMERCE_1_3_MO" },
  });
  fireEvent.click(screen.getByLabelText("Refund or credit any unfilled leads"));
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
  const freshness = screen.getByLabelText("Freshness") as HTMLSelectElement;
  assert.equal(freshness.value, "Aged leads");
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
      "COMMERCE_6_9_MO",
      "COMMERCE_9_12_MO",
      "COMMERCE_12_MO_PLUS",
    ]
  );
  assert.ok(screen.getByText(/If we can't fully fill this age bucket/i));
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
  const body = submittedBody(submitted);
  assert.equal(body.status, undefined);
  assert.equal(body.paymentConfirmationStatus, undefined);
  assert.equal(body.orderKind, undefined);
  assert.equal(body.fulfillmentMode, undefined);
  assert.equal(body.nicheKey, "vet");
  assert.deepEqual(body.states, ["TX"]);
  assert.equal(body.crmPackage, "lead_delivery");
  assert.equal(body.deliveryDestinationLabel, "Valley Vet GHL");
  assert.equal(body.campaignType, "Aged leads");
  assert.equal(body.requestedAgeBucket, "COMMERCE_1_3_MO");
  assert.equal(body.shortfallPolicy, "REFUND_UNFILLED");
  assert.equal(body.readySmsOptIn, false);
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
  const freshness = screen.getByLabelText("Freshness") as HTMLSelectElement;
  assert.equal(freshness.value, "Aged leads");
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

test("live transfer keeps age bucket hidden", () => {
  render(<PortalOrderRequestForm eligible catalogs={catalogs()} />);
  fireEvent.change(screen.getByLabelText("Freshness"), { target: { value: "Live transfer" } });
  assert.equal(screen.queryByLabelText("Age bucket"), null);
  assert.equal(screen.queryByText(/If we can't fully fill this age bucket/i), null);
  assert.equal(screen.queryByText(/Estimated order total/i), null);
  assert.equal(screen.queryByLabelText("Text me when this order is ready"), null);
  const panel = screen.getByTestId("portal-coming-soon");
  assert.match(panel.textContent ?? "", /Live transfers are coming soon/);
  assert.ok(screen.getByLabelText("Let me know when this becomes available"));
  cleanup();
});

test("aged reveals age bucket and requires it before review", () => {
  render(<PortalOrderRequestForm eligible catalogs={catalogs()} />);
  selectState("TX");
  fireEvent.change(screen.getByLabelText("Freshness"), { target: { value: "Aged leads" } });
  assert.ok(screen.getByLabelText("Age bucket"));
  assert.ok(screen.getByText(/If we can't fully fill this age bucket/i));
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Choose an age bucket."));
  assert.ok(screen.getByText("Choose what to do if we cannot fully fill this age bucket."));
  assert.equal(screen.queryByRole("button", { name: "Submit order request" }), null);
  cleanup();
});

test("switching aged to fresh clears age bucket and shortfall", async () => {
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
  fireEvent.change(screen.getByLabelText("Freshness"), { target: { value: "Aged leads" } });
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_3_6_MO" } });
  fireEvent.click(screen.getByLabelText("Refund or credit any unfilled leads"));
  assert.ok(screen.getByText(/Estimated order total: \$400/));
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "50" } });
  assert.ok(screen.getByText(/Estimated order total: \$200/));
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_12_MO_PLUS" } });
  assert.ok(screen.getByText(/Estimated order total: \$50/));
  fireEvent.change(screen.getByLabelText("Freshness"), { target: { value: "Fresh leads" } });
  assert.equal(screen.queryByLabelText("Age bucket"), null);
  assert.equal(screen.queryByText(/If we can't fully fill this age bucket/i), null);
  assert.equal(screen.queryByText(/Estimated order total/i), null);
  assert.match(screen.getByTestId("portal-coming-soon").textContent ?? "", /Fresh lead ordering is coming soon/);
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Check the box to be notified when this becomes available."));
  assert.equal(screen.queryByRole("button", { name: "Submit interest request" }), null);
  fireEvent.click(screen.getByLabelText("Let me know when this becomes available"));
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Interest / Coming soon"));
  assert.ok(screen.getByText("Notify when available"));
  assert.ok(screen.getByText("Yes"));
  assert.equal(screen.queryByText(/Inventory is not reserved/i), null);
  fireEvent.click(screen.getByRole("button", { name: "Submit interest request" }));
  await waitFor(() => {
    assert.ok(submitted);
  });
  const body = submittedBody(submitted);
  assert.equal(body.campaignType, "Fresh leads");
  assert.equal(body.requestedAgeBucket, undefined);
  assert.equal(body.shortfallPolicy, undefined);
  assert.equal(body.readySmsOptIn, undefined);
  assert.match(String(body.notes), /sa360\.availabilityInterest\.v1/);
  assert.match(String(body.notes), /fresh_leads/);
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
  fireEvent.change(screen.getByLabelText("Freshness"), { target: { value: "Aged leads" } });
  fireEvent.change(screen.getByLabelText("Age bucket"), { target: { value: "COMMERCE_9_12_MO" } });
  fireEvent.click(
    screen.getByLabelText(
      /Allow older leads at the applicable lower rate/
    )
  );
  fireEvent.click(screen.getByLabelText("Text me when this order is ready"));
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5552223333" } });
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText("Aged leads"));
  assert.ok(screen.getByText("9–12 Months"));
  assert.ok(screen.getByText("$2 / lead"));
  assert.ok(screen.getByText("$200"));
  assert.ok(screen.getByText(/Allow older leads at the applicable lower rate/));
  assert.ok(screen.getByText(/Yes — 5552223333/));
  assert.ok(screen.getByText(/Inventory is not reserved/));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(submitted);
  });
  const body = submittedBody(submitted);
  assert.equal(body.requestedAgeBucket, "COMMERCE_9_12_MO");
  assert.equal(body.shortfallPolicy, "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT");
  assert.equal(body.readySmsOptIn, true);
  assert.equal(body.readySmsPhoneE164, "+15552223333");
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

test("multi-bucket ordering keeps each quantity and sends one lines payload", async () => {
  let submitted: Record<string, unknown> | null = null;
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={catalogs()}
      multiBucketEnabled
      liveInventoryEnabled
      submitOrder={async (body) => {
        submitted = body;
        return {
          ok: true,
          item: {
            id: "ord_multi",
            orderNumber: "LO-5001",
            status: "submitted",
            paymentConfirmationStatus: "pending_confirmation",
          },
        };
      }}
    />
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "1–3 Months" }));
  fireEvent.change(screen.getByLabelText("1–3 Months quantity"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "3–6 Months" }));
  fireEvent.change(screen.getByLabelText("3–6 Months quantity"), { target: { value: "3" } });
  selectState("TX");
  fireEvent.click(screen.getByLabelText("Refund or credit any unfilled leads"));
  assert.equal(screen.getByTestId("portal-combined-quantity").textContent, "5");
  assert.ok(screen.getAllByText(/Buyer-eligible estimate: Unknown/).length >= 2);
  assert.equal(screen.queryByText(/^Available$/), null);
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.ok(screen.getByText(/1–3 Months · 2 · \$6 \/ lead · \$12/));
  assert.ok(screen.getByText(/3–6 Months · 3 · \$4 \/ lead · \$12/));
  assert.ok(screen.getByText("$24"));
  assert.equal(screen.queryByText("$30"), null);
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => assert.ok(submitted));
  const body = submittedBody(submitted);
  const lines = body.lines as Array<{ commerceAgeBucketKey: string; requestedQuantity: number }>;
  assert.equal(body.leadVolume, 5);
  assert.deepEqual(lines, [
    { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
    { commerceAgeBucketKey: "COMMERCE_3_6_MO", requestedQuantity: 3 },
  ]);
  assert.equal("unitPriceCents" in body, false);
  assert.equal("clientAccountId" in body, false);
  cleanup();
});

test("submit refreshes buyer availability and keeps quantities when a bucket estimate changes", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes("buyer-availability")) return new Response("{}", { status: 404 });
    calls += 1;
    return new Response(
      JSON.stringify({
        evaluatedAt: "2026-10-19T15:00:00.000Z",
        criteria: { nicheKey: "vet", states: ["TX"] },
        buckets: [
          {
            commerceAgeBucketKey: "COMMERCE_1_3_MO",
            eligible: calls === 1 ? 4 : 1,
            display: "estimate",
          },
          { commerceAgeBucketKey: "COMMERCE_3_6_MO", eligible: 2, display: "at_least" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  let submitted: Record<string, unknown> | null = null;
  render(
    <PortalOrderRequestForm
      eligible
      catalogs={buildPortalOrderRequestCatalogs({
        primaryNicheKeys: ["vet"],
        primaryProductTypes: [],
        locationName: "Valley Vet GHL",
        displayName: "Valley Vet",
      })}
      multiBucketEnabled
      liveInventoryEnabled
      submitOrder={async (body) => {
        submitted = body;
        return {
          ok: true,
          item: {
            id: "ord_multi",
            orderNumber: "LO-5001",
            status: "submitted",
            paymentConfirmationStatus: "pending_confirmation",
          },
        };
      }}
    />
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "1–3 Months" }));
  fireEvent.change(screen.getByLabelText("1–3 Months quantity"), { target: { value: "2" } });
  selectState("TX");
  fireEvent.click(screen.getByLabelText("Refund or credit any unfilled leads"));
  await waitFor(() => {
    assert.ok(screen.getAllByText(/Buyer-eligible estimate: About 4/).length >= 1);
  });
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit order request" }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Availability changed for 1–3 Months/));
  });
  assert.equal(submitted, null);
  assert.equal((screen.getByLabelText("1–3 Months quantity") as HTMLInputElement).value, "2");
  assert.equal(screen.queryByText(/^0$/), null);
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
  fireEvent.click(screen.getByLabelText("Refund or credit any unfilled leads"));
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

