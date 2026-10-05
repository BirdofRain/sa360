import assert from "node:assert/strict";
import test from "node:test";

import type { PortalAccountProfile } from "./account-profile.ts";
import {
  applyPortalFreshnessChange,
  buildPortalOrderRequestCatalogs,
  createEmptyPortalOrderRequestDraft,
  guardPortalOrderCreateEligibility,
  isPortalAccountEligibleToPlaceOrder,
  mapPortalOrderCreateSuccess,
  parsePortalOrderCreateError,
  portalCustomerCrmPackageLabel,
  portalCustomerDestinationLabel,
  portalOrderEstimateCopy,
  portalOrderRequestHasForbiddenFields,
  portalPaymentConfirmationLabel,
  portalPaymentConfirmationTone,
  resolvePortalOrderRequestGate,
  sanitizeIncomingPortalOrderCreateBody,
  serializePortalOrderCreateBody,
  shouldShowPortalOrderCrmPackageStep,
  shouldShowPortalOrderDestinationStep,
  validatePortalOrderRequestDraft,
  visiblePortalOrderDestinations,
  type PortalOrderRequestDraft,
} from "./portal-order-request.ts";
import {
  parseAvailabilityInterestFromNotes,
  stripAvailabilityInterestFromNotes,
} from "@sa360/shared";

import { PORTAL_AGED_OPTIONS_MARKER, parsePortalAgedOrderOptionsFromNotes } from "./portal-aged-order-options.ts";

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
  const body = serializePortalOrderCreateBody(
    validDraft(catalog, {
      crmPackage: "GHL Starter",
      requestedAgeBucket: "COMMERCE_3_6_MO",
      shortfallPolicy: "REFUND_UNFILLED",
    }),
    catalog
  );
  assert.equal(body.nicheKey, "vet");
  assert.equal(body.productType, "exclusive");
  assert.deepEqual(body.states, ["TX", "OK"]);
  assert.equal(body.leadVolume, 150);
  assert.equal(body.campaignType, "Aged leads");
  assert.equal(body.crmPackage, "lead_delivery");
  assert.equal(body.deliveryDestinationLabel, "Valley Vet GHL");
  assert.match(String(body.notes), /Need a Monday start/);
  assert.equal(body.deliveryDestinationType, "ghl");
  assert.equal(body.readySmsOptIn, false);
  assert.equal(body.requestedAgeBucket, "COMMERCE_3_6_MO");
  assert.equal(body.shortfallPolicy, "REFUND_UNFILLED");
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
    nicheKey: "vet_fex",
    states: ["NM", "AZ"],
    leadVolume: 150,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro",
    deliveryDestinationLabel: "Valley Vet",
    notes: "Need fast start",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    shortfallPolicy: "REFUND_UNFILLED",
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
  assert.equal(body?.nicheKey, "vet");
  assert.deepEqual(body?.states, ["NM", "AZ"]);
  assert.equal(body?.leadVolume, 150);
  assert.equal(body?.campaignType, "Aged leads");
  assert.equal(body?.crmPackage, "lead_delivery");
  assert.equal(body?.deliveryDestinationLabel, "Valley Vet");
  assert.match(String(body?.notes), /Need fast start/);
  const aged = parsePortalAgedOrderOptionsFromNotes(String(body?.notes));
  assert.equal(aged.requestedAgeBucket, "COMMERCE_1_3_MO");
  assert.equal(aged.shortfallPolicy, "REFUND_UNFILLED");
  assert.equal("status" in (body ?? {}), false);
  assert.equal("orderKind" in (body ?? {}), false);
  assert.equal("unitPriceCents" in (body ?? {}), false);
  assert.equal(portalOrderRequestHasForbiddenFields(body!), false);
});

test("incoming sanitize stamps lead_delivery even when crmPackage is omitted", () => {
  const body = sanitizeIncomingPortalOrderCreateBody({
    nicheKey: "vet",
    states: ["TX"],
    leadVolume: 50,
    campaignType: "Aged leads",
    deliveryDestinationLabel: "Valley Vet",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    shortfallPolicy: "REFUND_UNFILLED",
  });
  assert.ok(body);
  assert.equal(body?.crmPackage, "lead_delivery");
  assert.equal(body?.nicheKey, "vet");
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
    "Payment pending"
  );
  assert.equal(portalPaymentConfirmationLabel("confirmed"), "Payment confirmed");
  assert.equal(portalPaymentConfirmationLabel("not_required"), "No payment due");
  assert.equal(portalPaymentConfirmationLabel("stripe_processing"), null);
  assert.equal(portalPaymentConfirmationTone("pending_confirmation"), "warn");
  assert.equal(portalPaymentConfirmationTone("confirmed"), "good");
  assert.equal(portalPaymentConfirmationTone("not_required"), "neutral");
  assert.equal(portalPaymentConfirmationTone("stripe_processing"), null);
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

test("CRM package SKUs stay hidden; portal create stamps lead_delivery instead of GHL Starter", () => {
  const catalog = catalogs();
  assert.deepEqual(
    catalog.crmPackages.map((option) => option.value),
    ["GHL Starter", "GHL Starter + SA360 AI", "GHL Pro + SA360 routing"]
  );
  assert.equal(shouldShowPortalOrderCrmPackageStep(), false);
  assert.equal(portalCustomerCrmPackageLabel("GHL Starter"), null);
  assert.equal(portalCustomerCrmPackageLabel("GHL Starter + SA360 AI"), null);
  assert.equal(portalCustomerCrmPackageLabel("GHL Pro + SA360 routing"), null);
  assert.equal(createEmptyPortalOrderRequestDraft(catalog).crmPackage, "lead_delivery");
});

test("GHL destination labels collapse to a customer-safe account target", () => {
  const catalog = catalogs();
  assert.equal(portalCustomerDestinationLabel("Valley Vet GHL"), "Valley Vet");
  assert.equal(portalCustomerDestinationLabel("Account CRM"), "Your account");
  assert.deepEqual(
    visiblePortalOrderDestinations(catalog).map((option) => option.label),
    ["Valley Vet"]
  );
  assert.equal(shouldShowPortalOrderDestinationStep(catalog), false);
  assert.equal(createEmptyPortalOrderRequestDraft(catalog).deliveryDestinationLabel, "Valley Vet GHL");

  const distinct = catalogs({ locationName: "Austin office", displayName: "Dallas office" });
  assert.equal(shouldShowPortalOrderDestinationStep(distinct), true);
  assert.deepEqual(
    visiblePortalOrderDestinations(distinct).map((option) => option.label),
    ["Austin office", "Dallas office"]
  );
});

test("aged draft requires a canonical bucket and shortfall policy", () => {
  const catalog = catalogs();
  const errors = validatePortalOrderRequestDraft(
    validDraft(catalog, { campaignType: "Aged leads" }),
    catalog
  );
  assert.equal(errors.requestedAgeBucket, "Choose an age bucket.");
  assert.equal(
    errors.shortfallPolicy,
    "Choose what to do if we cannot fully fill this age bucket."
  );
});

test("freshness change off aged clears bucket and shortfall", () => {
  const catalog = catalogs();
  const aged = validDraft(catalog, {
    campaignType: "Aged leads",
    requestedAgeBucket: "COMMERCE_3_6_MO",
    shortfallPolicy: "REFUND_UNFILLED",
    readySmsOptIn: true,
    readySmsPhone: "5551234567",
  });
  const fresh = applyPortalFreshnessChange(aged, "Fresh leads");
  assert.equal(fresh.requestedAgeBucket, null);
  assert.equal(fresh.shortfallPolicy, null);
  assert.equal(fresh.readySmsOptIn, false);
  assert.equal(fresh.readySmsPhone, "");
  assert.equal(fresh.notifyWhenAvailable, false);
  const live = applyPortalFreshnessChange(aged, "Live transfer");
  assert.equal(live.requestedAgeBucket, null);
  assert.equal(live.shortfallPolicy, null);
  assert.equal(live.notifyWhenAvailable, false);
});

test("estimate uses canonical PPL aged prices and pending copy otherwise", () => {
  const catalog = catalogs();
  const pendingFresh = portalOrderEstimateCopy(validDraft(catalog, { campaignType: "Fresh leads" }));
  assert.equal(pendingFresh.pending, true);
  assert.equal(pendingFresh.totalLabel, "Price confirmed during review");
  assert.equal(pendingFresh.rateLabel, null);

  const pendingLive = portalOrderEstimateCopy(
    validDraft(catalog, { campaignType: "Live transfer" })
  );
  assert.equal(pendingLive.totalLabel, "Price confirmed during review");

  const pendingAged = portalOrderEstimateCopy(
    validDraft(catalog, { campaignType: "Aged leads", requestedAgeBucket: null })
  );
  assert.equal(pendingAged.totalLabel, "Price confirmed during review");

  const priced = portalOrderEstimateCopy(
    validDraft(catalog, {
      campaignType: "Aged leads",
      requestedAgeBucket: "COMMERCE_3_6_MO",
      leadVolume: 150,
    })
  );
  assert.equal(priced.pending, false);
  assert.equal(priced.rateLabel, "$4 / lead");
  assert.equal(priced.totalLabel, "$600");

  const bucketChange = portalOrderEstimateCopy(
    validDraft(catalog, {
      campaignType: "Aged leads",
      requestedAgeBucket: "COMMERCE_12_MO_PLUS",
      leadVolume: 150,
    })
  );
  assert.equal(bucketChange.rateLabel, "$1 / lead");
  assert.equal(bucketChange.totalLabel, "$150");
});

test("serializes aged options into notes and dedicated fields", () => {
  const catalog = catalogs();
  const body = serializePortalOrderCreateBody(
    validDraft(catalog, {
      campaignType: "Aged leads",
      requestedAgeBucket: "COMMERCE_6_9_MO",
      shortfallPolicy: "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
      readySmsOptIn: true,
      readySmsPhone: "(555) 987-6543",
    }),
    catalog
  );
  assert.equal(body.requestedAgeBucket, "COMMERCE_6_9_MO");
  assert.equal(body.shortfallPolicy, "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT");
  assert.equal(body.readySmsOptIn, true);
  assert.equal(body.readySmsPhoneE164, "+15559876543");
  assert.match(String(body.notes), new RegExp(PORTAL_AGED_OPTIONS_MARKER));
  const parsed = parsePortalAgedOrderOptionsFromNotes(String(body.notes));
  assert.equal(parsed.requestedAgeBucket, "COMMERCE_6_9_MO");
  assert.equal(parsed.shortfallPolicy, "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT");
  assert.equal(parsed.readySmsOptIn, true);
  assert.equal(parsed.readySmsPhoneE164, "+15559876543");
});

test("fresh serialize omits age bucket and shortfall", () => {
  const catalog = catalogs();
  const blocked = validDraft(catalog, { campaignType: "Fresh leads", notifyWhenAvailable: false });
  assert.throws(() => serializePortalOrderCreateBody(blocked, catalog), /not valid/);
  const body = serializePortalOrderCreateBody(
    { ...blocked, notifyWhenAvailable: true },
    catalog
  );
  assert.equal(body.campaignType, "Fresh leads");
  assert.equal("requestedAgeBucket" in body, false);
  assert.equal("shortfallPolicy" in body, false);
  assert.equal("readySmsOptIn" in body, false);
  assert.equal("readySmsPhoneE164" in body, false);
  assert.match(String(body.notes), /Need a Monday start/);
  assert.match(String(body.notes), /sa360\.availabilityInterest\.v1/);
  assert.equal(stripAvailabilityInterestFromNotes(String(body.notes)), "Need a Monday start");
  assert.equal(parseAvailabilityInterestFromNotes(String(body.notes))?.requestedOffering, "fresh_leads");
});

test("sanitize rejects invalid shortfall enum and missing aged fields", () => {
  const base = {
    nicheKey: "vet",
    states: ["TX"],
    leadVolume: 50,
    campaignType: "Aged leads",
    deliveryDestinationLabel: "Valley Vet",
    requestedAgeBucket: "COMMERCE_3_6_MO",
  };
  assert.equal(
    sanitizeIncomingPortalOrderCreateBody({
      ...base,
      shortfallPolicy: "ALLOW_NEWER",
    }),
    null
  );
  assert.equal(sanitizeIncomingPortalOrderCreateBody(base), null);
  assert.equal(
    sanitizeIncomingPortalOrderCreateBody({
      ...base,
      shortfallPolicy: "REFUND_UNFILLED",
      requestedAgeBucket: "aged-30-90",
    }),
    null
  );
});

test("sanitize persists normalized SMS opt-in and stays backward compatible", () => {
  assert.equal(
    sanitizeIncomingPortalOrderCreateBody({
      nicheKey: "vet",
      states: ["TX"],
      leadVolume: 50,
      campaignType: "Fresh leads",
      deliveryDestinationLabel: "Valley Vet",
      notes: "Need a Monday start",
    }),
    null
  );

  const fresh = sanitizeIncomingPortalOrderCreateBody({
    nicheKey: "nurse_life",
    states: ["TX"],
    leadVolume: 50,
    campaignType: "Fresh leads",
    deliveryDestinationLabel: "Valley Vet",
    notes: "Need a Monday start",
    notifyWhenAvailable: true,
  });
  assert.ok(fresh);
  assert.equal(fresh?.nicheKey, "nurse");
  assert.match(String(fresh?.notes), /Need a Monday start/);
  assert.equal(stripAvailabilityInterestFromNotes(String(fresh?.notes)), "Need a Monday start");
  assert.equal(
    parseAvailabilityInterestFromNotes(String(fresh?.notes))?.requestedOffering,
    "fresh_leads"
  );
  assert.equal("requestedAgeBucket" in (fresh ?? {}), false);
  assert.equal("readySmsPhoneE164" in (fresh ?? {}), false);

  assert.equal(
    sanitizeIncomingPortalOrderCreateBody({
      nicheKey: "vet",
      states: ["TX"],
      leadVolume: 50,
      campaignType: "Live transfer",
      deliveryDestinationLabel: "Valley Vet",
      readySmsOptIn: true,
      readySmsPhoneE164: "5551112222",
    }),
    null
  );

  const live = sanitizeIncomingPortalOrderCreateBody({
    nicheKey: "trucker_life",
    states: ["TX"],
    leadVolume: 50,
    campaignType: "Live transfer",
    deliveryDestinationLabel: "Valley Vet",
    notifyWhenAvailable: true,
    notes: "Call after 4",
  });
  assert.ok(live);
  assert.equal(live?.nicheKey, "trucker");
  assert.equal("readySmsPhoneE164" in (live ?? {}), false);
  assert.equal(stripAvailabilityInterestFromNotes(String(live?.notes)), "Call after 4");
  assert.equal(
    parseAvailabilityInterestFromNotes(String(live?.notes))?.requestedOffering,
    "live_transfer"
  );

  assert.equal(
    sanitizeIncomingPortalOrderCreateBody({
      nicheKey: "vet",
      states: ["TX"],
      leadVolume: 50,
      campaignType: "Fresh leads",
      deliveryDestinationLabel: "Valley Vet",
      readySmsOptIn: true,
    }),
    null
  );

  assert.equal(
    sanitizeIncomingPortalOrderCreateBody({
      nicheKey: "unspecified",
      states: ["TX"],
      leadVolume: 50,
      campaignType: "Aged leads",
      deliveryDestinationLabel: "Valley Vet",
      requestedAgeBucket: "COMMERCE_1_3_MO",
      shortfallPolicy: "REFUND_UNFILLED",
    }),
    null
  );

  const fromNotes = sanitizeIncomingPortalOrderCreateBody({
    nicheKey: "vet",
    states: ["TX"],
    leadVolume: 50,
    campaignType: "Aged leads",
    deliveryDestinationLabel: "Valley Vet",
    notes: `${PORTAL_AGED_OPTIONS_MARKER} ${JSON.stringify({
      requestedAgeBucket: "COMMERCE_1_3_MO",
      shortfallPolicy: "REFUND_UNFILLED",
      readySmsOptIn: false,
      readySmsPhoneE164: null,
    })}`,
  });
  assert.ok(fromNotes);
  const parsed = parsePortalAgedOrderOptionsFromNotes(String(fromNotes?.notes ?? ""));
  assert.equal(parsed.requestedAgeBucket, "COMMERCE_1_3_MO");
  assert.equal(parsed.shortfallPolicy, "REFUND_UNFILLED");
});

test("buyer lead types are exactly Veteran, Nurse, and Trucker", () => {
  const catalog = buildPortalOrderRequestCatalogs({
    primaryNicheKeys: [
      "vet",
      "vet_fex",
      "n_vet",
      "N Veteran",
      "nurse",
      "nurse_life",
      "NURSE",
      "trucker",
      "trucker_life",
      "TRUCKER",
      "unspecified",
      "mortgage_protection",
      "health_insurance",
    ],
  });
  assert.deepEqual(
    catalog.nicheKeys.map((option) => option.value),
    ["vet", "nurse", "trucker"]
  );
  assert.deepEqual(
    catalog.nicheKeys.map((option) => option.label),
    ["Veteran", "Nurse", "Trucker"]
  );
  const labels = new Set(catalog.nicheKeys.map((option) => option.label));
  assert.equal(labels.size, catalog.nicheKeys.length);
  for (const option of catalog.nicheKeys) {
    assert.equal(option.label.includes("_"), false);
    assert.notEqual(option.label, "N Veteran");
    assert.equal(option.value.includes("_"), false);
  }
});

test("new order drafts default to aged leads", () => {
  const draft = createEmptyPortalOrderRequestDraft(catalogs());
  assert.equal(draft.campaignType, "Aged leads");
  assert.equal(draft.notifyWhenAvailable, false);
  assert.equal(draft.requestedAgeBucket, null);
});
