import type { PortalAccountProfile } from "./account-profile.ts";
import type { PortalOrderView } from "./map-client-orders.ts";
import type { PortalOrderFulfillment } from "./portal-order-fulfillment.ts";
import { buildPortalJourneyHome, type PortalJourneyHomeModel } from "./portal-journey.ts";

export const PORTAL_JOURNEY_PREVIEW_SCENARIOS = [
  "onboarding",
  "no_order",
  "payment_pending",
  "submitted_confirmed",
  "approved",
  "active_zero",
  "active_partial",
  "fulfilled",
  "completed",
  "multiple",
  "account_error",
  "orders_error",
] as const;

export type PortalJourneyPreviewScenario =
  (typeof PORTAL_JOURNEY_PREVIEW_SCENARIOS)[number];

function account(overrides: Partial<PortalAccountProfile> = {}): PortalAccountProfile {
  return {
    clientDisplayName: "Northwind",
    portalDisplayName: "Northwind",
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
    status: "active",
    profileComplete: true,
    readyToOrder: true,
    missingFields: [],
    ...overrides,
  };
}

function fulfillment(
  overrides: Partial<PortalOrderFulfillment> = {}
): PortalOrderFulfillment {
  return {
    requestedQuantity: 25,
    fulfilledQuantity: 0,
    remainingQuantity: 25,
    status: "not_started",
    ...overrides,
  };
}

function order(overrides: Partial<PortalOrderView> = {}): PortalOrderView {
  return {
    id: "ord_preview",
    orderNumber: "LO-2418",
    status: "submitted",
    nicheLabel: "vet",
    productLabel: "aged",
    statesLabel: "TX",
    volume: 25,
    campaignType: "aged",
    destination: "GHL",
    fulfillmentSummary: null,
    setupWarnings: [],
    createdAt: "2026-08-20T12:00:00.000Z",
    paymentConfirmationStatus: "pending_confirmation",
    fulfillment: null,
    ...overrides,
  };
}

export function portalJourneyPreviewModel(
  scenario: PortalJourneyPreviewScenario
): PortalJourneyHomeModel {
  switch (scenario) {
    case "onboarding":
      return buildPortalJourneyHome({
        account: {
          ok: true,
          value: account({
            status: "onboarding",
            readyToOrder: false,
            profileComplete: false,
            missingFields: ["primaryNicheKeys"],
          }),
        },
        orders: { ok: true, value: [] },
      });
    case "no_order":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: { ok: true, value: [] },
      });
    case "payment_pending":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: { ok: true, value: [order()] },
      });
    case "submitted_confirmed":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [order({ paymentConfirmationStatus: "confirmed" })],
        },
      });
    case "approved":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [order({ status: "ready", paymentConfirmationStatus: "confirmed" })],
        },
      });
    case "active_zero":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [
            order({
              status: "active",
              paymentConfirmationStatus: "confirmed",
              fulfillment: fulfillment(),
            }),
          ],
        },
      });
    case "active_partial":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [
            order({
              status: "active",
              paymentConfirmationStatus: "confirmed",
              fulfillment: fulfillment({
                fulfilledQuantity: 17,
                remainingQuantity: 8,
                status: "in_progress",
              }),
            }),
          ],
        },
      });
    case "fulfilled":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [
            order({
              status: "active",
              paymentConfirmationStatus: "confirmed",
              fulfillment: fulfillment({
                fulfilledQuantity: 25,
                remainingQuantity: 0,
                status: "fulfilled",
              }),
            }),
          ],
        },
      });
    case "completed":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [
            order({
              status: "completed",
              paymentConfirmationStatus: "confirmed",
              fulfillment: fulfillment({
                fulfilledQuantity: 25,
                remainingQuantity: 0,
                status: "fulfilled",
              }),
            }),
          ],
        },
      });
    case "multiple":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: {
          ok: true,
          value: [
            order({
              id: "ord_new",
              orderNumber: "LO-2500",
              status: "active",
              paymentConfirmationStatus: "confirmed",
              createdAt: "2026-08-22T00:00:00.000Z",
              fulfillment: fulfillment({
                fulfilledQuantity: 17,
                remainingQuantity: 8,
                status: "in_progress",
              }),
            }),
            order({
              id: "ord_old",
              orderNumber: "LO-2400",
              status: "completed",
              paymentConfirmationStatus: "confirmed",
              createdAt: "2026-07-01T00:00:00.000Z",
            }),
          ],
        },
      });
    case "account_error":
      return buildPortalJourneyHome({
        account: { ok: false },
        orders: { ok: true, value: [order()] },
      });
    case "orders_error":
      return buildPortalJourneyHome({
        account: { ok: true, value: account() },
        orders: { ok: false },
      });
  }
}

export function parsePortalJourneyPreviewScenario(
  raw: string | undefined
): PortalJourneyPreviewScenario {
  if (raw && (PORTAL_JOURNEY_PREVIEW_SCENARIOS as readonly string[]).includes(raw)) {
    return raw as PortalJourneyPreviewScenario;
  }
  return "active_partial";
}
