import assert from "node:assert/strict";
import test from "node:test";

import type { PortalAccountProfile } from "./account-profile.ts";
import {
  buildPortalOrderRequestCatalogs,
  createEmptyPortalOrderRequestDraft,
  guardPortalOrderCreateEligibility,
  isPortalAccountEligibleToPlaceOrder,
  mapPortalOrderCreateSuccess,
  parsePortalOrderCreateError,
  portalOrderRequestHasForbiddenFields,
  portalPaymentConfirmationLabel,
  resolvePortalOrderRequestGate,
  sanitizeIncomingPortalOrderCreateBody,
  serializePortalOrderCreateBody,
  validatePortalOrderRequestDraft,
  type PortalOrderRequestDraft,
} from "./portal-order-request.ts";

function account(overrides: Partial<PortalAccountProfile> = {}): PortalAccountProfile {
  return {
    clientDisplayName: "Valley Vet",
    portalDisplayName: "Valley Vet",
    portalLoginEmail: "vet@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["exclusive"],
    status: "active",
    profileComplete: true,
    readyToOrder: true,
    missingFields: [],
    ...overrides,
  };
}

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

test("readyToOrder from the account contract is the eligibility source of truth", () => {
  const ready = resolvePortalOrderRequestGate({
    account: account({ status: "active", readyToOrder: true }),
    fetchOk: true,
  });
  assert.equal(ready.state, "ready");

  const onboarding = resolvePortalOrderRequestGate({
    account: account({ status: "onboarding", readyToOrder: false }),
    fetchOk: true,
  });
  assert.equal(onboarding.state, "blocked");
  if (onboarding.state === "blocked") assert.equal(onboarding.reason, "onboarding");

  const paused = resolvePortalOrderRequestGate({
    account: account({ status: "paused", readyToOrder: false }),
    fetchOk: true,
  });
  assert.equal(paused.state, "blocked");
  if (paused.state === "blocked") assert.equal(paused.reason, "paused");

  const archived = resolvePortalOrderRequestGate({
    account: account({ status: "archived", readyToOrder: false }),
    fetchOk: true,
  });
  assert.equal(archived.state, "blocked");
  if (archived.state === "blocked") assert.equal(archived.reason, "archived");
});

test("account-state API failure fails closed", () => {
  const failed = resolvePortalOrderRequestGate({ account: null, fetchOk: false });
  assert.equal(failed.state, "blocked");
  if (failed.state === "blocked") assert.equal(failed.reason, "unknown");
});

test("browser cannot spoof readyToOrder through a missing account payload", () => {
  const spoofed = resolvePortalOrderRequestGate({
    account: null,
    fetchOk: false,
  });
  assert.equal(spoofed.state, "blocked");
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
    readyToOrder: true,
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
  const blocked = guardPortalOrderCreateEligibility(
    account({ status: "onboarding", readyToOrder: false })
  );
  assert.equal(blocked?.code, "ACCOUNT_NOT_READY_TO_ORDER");
  assert.equal(blocked?.error, "Complete your account before placing an order.");
  assert.equal(guardPortalOrderCreateEligibility(account({ readyToOrder: true })), null);
  assert.equal(guardPortalOrderCreateEligibility(null)?.code, "ACCOUNT_NOT_READY_TO_ORDER");
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
