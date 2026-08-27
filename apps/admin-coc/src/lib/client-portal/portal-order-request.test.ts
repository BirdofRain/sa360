import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortalOrderRequestCatalogs,
  createEmptyPortalOrderRequestDraft,
  guardPortalOrderCreateEligibility,
  isPortalAccountEligibleToPlaceOrder,
  mapPortalOrderCreateSuccess,
  mapPortalOrderRequestContext,
  parsePortalOrderCreateError,
  portalOrderRequestHasForbiddenFields,
  portalPaymentConfirmationLabel,
  readPortalOrderRequestAccountStatus,
  sanitizeIncomingPortalOrderCreateBody,
  serializePortalOrderCreateBody,
  validatePortalOrderRequestDraft,
  type PortalOrderRequestDraft,
} from "./portal-order-request.ts";

function catalogs(overrides?: Parameters<typeof buildPortalOrderRequestCatalogs>[0]) {
  return buildPortalOrderRequestCatalogs({
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["exclusive"],
    locationName: "Valley Vet GHL",
    displayName: "Valley Vet",
    ...overrides,
  });
}

function validDraft(
  catalog = catalogs(),
  overrides: Partial<PortalOrderRequestDraft> = {}
): PortalOrderRequestDraft {
  return {
    ...createEmptyPortalOrderRequestDraft(catalog),
    states: ["TX", "OK"],
    leadVolume: 150,
    notes: "Need a Monday start",
    ...overrides,
  };
}

test("only an active account is eligible to place an order", () => {
  assert.equal(isPortalAccountEligibleToPlaceOrder("active"), true);
  assert.equal(isPortalAccountEligibleToPlaceOrder("onboarding"), false);
  assert.equal(isPortalAccountEligibleToPlaceOrder("paused"), false);
  assert.equal(isPortalAccountEligibleToPlaceOrder("archived"), false);
  assert.equal(isPortalAccountEligibleToPlaceOrder(null), false);
  assert.equal(isPortalAccountEligibleToPlaceOrder(undefined), false);
});

test("reads account status from existing portal-context shapes", () => {
  assert.equal(readPortalOrderRequestAccountStatus({ status: "active" }), "active");
  assert.equal(
    readPortalOrderRequestAccountStatus({ context: { status: "onboarding" } }),
    "onboarding"
  );
  assert.equal(readPortalOrderRequestAccountStatus({ accountStatus: "paused" }), "paused");
  assert.equal(readPortalOrderRequestAccountStatus({ primaryNicheKeys: ["vet"] }), null);
});

test("unknown account status does not invent a ready-to-order block", () => {
  const mapped = mapPortalOrderRequestContext({
    primaryNicheKeys: ["vet"],
    locationName: "Valley Vet GHL",
    clientDisplayName: "Valley Vet",
  });
  assert.equal(mapped.accountStatus, null);
  assert.equal(mapped.eligible, true);
});

test("known onboarding status is not eligible", () => {
  const mapped = mapPortalOrderRequestContext({
    status: "onboarding",
    primaryNicheKeys: ["vet"],
  });
  assert.equal(mapped.eligible, false);
});

test("serializes a valid customer order request without internal fields", () => {
  const catalog = catalogs();
  const body = serializePortalOrderCreateBody(validDraft(catalog), catalog);
  assert.deepEqual(body, {
    nicheKey: "vet",
    productType: "exclusive",
    states: ["TX", "OK"],
    leadVolume: 150,
    campaignType: "Fresh leads",
    crmPackage: "GHL Starter",
    deliveryDestinationLabel: "Valley Vet GHL",
    notes: "Need a Monday start",
    deliveryDestinationType: "ghl",
  });
  assert.equal(portalOrderRequestHasForbiddenFields(body), false);
  assert.equal("status" in body, false);
  assert.equal("paymentConfirmationStatus" in body, false);
  assert.equal("paymentStatus" in body, false);
  assert.equal("orderKind" in body, false);
  assert.equal("fulfillmentMode" in body, false);
  assert.equal("adminNotes" in body, false);
  assert.equal("routingRuleId" in body, false);
  assert.equal("campaignId" in body, false);
  assert.equal("unitPriceCents" in body, false);
  assert.equal("price" in body, false);
  assert.equal("clientAccountId" in body, false);
});

test("incoming sanitize drops status, payment, and internal fields", () => {
  const body = sanitizeIncomingPortalOrderCreateBody({
    nicheKey: "HVAC",
    states: ["NM", "AZ"],
    leadVolume: 150,
    campaignType: "Live transfer",
    crmPackage: "GHL Pro",
    deliveryDestinationLabel: "Desert HVAC",
    notes: "Need fast start",
    status: "active",
    paymentConfirmationStatus: "confirmed",
    orderKind: "ppl",
    fulfillmentMode: "lf2",
    adminNotes: "internal",
    routingRuleId: "rr_1",
    unitPriceCents: 4500,
    clientAccountId: "acct_other",
  });
  assert.ok(body);
  assert.deepEqual(body, {
    nicheKey: "HVAC",
    states: ["NM", "AZ"],
    leadVolume: 150,
    campaignType: "Live transfer",
    crmPackage: "GHL Pro",
    deliveryDestinationLabel: "Desert HVAC",
    notes: "Need fast start",
  });
  assert.equal(portalOrderRequestHasForbiddenFields(body), false);
});

test("rejects invalid quantity, states, and unconstrained values", () => {
  const catalog = catalogs();
  const errors = validatePortalOrderRequestDraft(
    validDraft(catalog, {
      nicheKey: "not-a-catalog-value",
      states: ["TX", "ZZ"],
      leadVolume: 0,
      campaignType: "Buy now",
      notes: "x".repeat(2001),
    }),
    catalog
  );
  assert.equal(errors.nicheKey, "Choose a lead type.");
  assert.equal(errors.states, "States must be valid US state codes.");
  assert.equal(errors.leadVolume, "Enter a quantity between 1 and 1,000,000.");
  assert.equal(errors.campaignType, "Choose a freshness option.");
  assert.equal(errors.notes, "Notes must be 2,000 characters or fewer.");
});

test("uses customer-safe payment confirmation copy", () => {
  assert.equal(
    portalPaymentConfirmationLabel("pending_confirmation"),
    "Awaiting payment confirmation"
  );
  assert.equal(portalPaymentConfirmationLabel("confirmed"), "Payment confirmed");
  assert.equal(portalPaymentConfirmationLabel("not_required"), "No payment due");
  assert.equal(portalPaymentConfirmationLabel("stripe_processing"), null);
});

test("eligibility guard blocks onboarding accounts with customer-safe copy", () => {
  const blocked = guardPortalOrderCreateEligibility({ status: "onboarding" });
  assert.equal(blocked?.code, "ACCOUNT_NOT_READY");
  assert.equal(blocked?.error, "Complete your account before placing an order.");
  assert.equal(guardPortalOrderCreateEligibility({ status: "active" }), null);
});

test("parses API error JSON without exposing internals", () => {
  assert.equal(
    parsePortalOrderCreateError(JSON.stringify({ ok: false, error: "Invalid body" })),
    "Invalid body"
  );
  assert.equal(
    parsePortalOrderCreateError("<html>nope</html>"),
    "We could not submit your order request. Try again shortly."
  );
});

test("maps a successful client create response", () => {
  const mapped = mapPortalOrderCreateSuccess({
    ok: true,
    item: {
      id: "ord_1",
      orderNumber: "LO-1044",
      status: "submitted",
      paymentConfirmationStatus: "pending_confirmation",
      paymentConfirmedBy: "admin@sa360",
    },
  });
  assert.deepEqual(mapped, {
    id: "ord_1",
    orderNumber: "LO-1044",
    status: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
  });
});
