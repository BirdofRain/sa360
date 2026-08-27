import type { PortalLeadView } from "./map-client-leads.ts";
import type { PortalOrderDetailView } from "./map-client-orders.ts";
import { PORTAL_ORDER_FULFILLMENT_PLACEHOLDER } from "./map-client-orders.ts";
import type { PortalOrderFulfillment } from "./portal-order-fulfillment.ts";

export const PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS = [
  "zero",
  "partial",
  "full",
  "over",
  "unavailable",
  "linked",
  "leads_error",
] as const;

export type PortalOrderFulfillmentPreviewScenario =
  (typeof PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS)[number];

function fulfillment(
  requestedQuantity: number,
  fulfilledQuantity: number,
  remainingQuantity: number,
  status: PortalOrderFulfillment["status"]
): PortalOrderFulfillment {
  return { requestedQuantity, fulfilledQuantity, remainingQuantity, status };
}

export function portalOrderDetailFixture(
  overrides: Partial<PortalOrderDetailView> = {}
): PortalOrderDetailView {
  return {
    id: "ord_1001",
    orderNumber: "LO-1001",
    status: "active",
    nicheLabel: "vet",
    productLabel: "exclusive",
    statesLabel: "TX, OK",
    volume: 25,
    campaignType: "aged",
    destination: "GHL location",
    fulfillmentSummary: PORTAL_ORDER_FULFILLMENT_PLACEHOLDER,
    setupWarnings: [],
    createdAt: "2026-08-01T12:00:00.000Z",
    states: ["TX", "OK"],
    deliveryCadence: "weekly",
    crmPackage: "GHL Pro",
    aiVoiceAddon: true,
    requestedStartDate: null,
    destinationType: null,
    notes: null,
    submittedAt: "2026-08-01T13:00:00.000Z",
    approvedAt: null,
    activatedAt: "2026-08-02T09:00:00.000Z",
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    updatedAt: null,
    fulfillmentSummaryIsPlaceholder: true,
    fulfillmentAvailable: false,
    fulfillment: null,
    ...overrides,
  };
}

export function portalOrderLinkedLeadFixture(
  overrides: Partial<PortalLeadView> = {}
): PortalLeadView {
  return {
    id: "lead_alex",
    leadName: "Alex P.",
    phoneMasked: "(•••) •••-1212",
    campaign: "Vet Q2",
    sourceLabel: "meta · form",
    receivedAt: "2026-08-20T10:00:00.000Z",
    deliveryStatus: "delivered",
    deliveryLabel: "Delivered",
    lastEvent: "lead_delivered",
    appointmentStatus: "set",
    ...overrides,
  };
}

export function portalOrderFulfillmentAvailable(
  requested: number,
  fulfilled: number,
  remaining: number,
  status: PortalOrderFulfillment["status"]
): Pick<
  PortalOrderDetailView,
  "fulfillmentAvailable" | "fulfillment" | "fulfillmentSummary" | "fulfillmentSummaryIsPlaceholder"
> {
  return {
    fulfillmentAvailable: true,
    fulfillment: fulfillment(requested, fulfilled, remaining, status),
    fulfillmentSummary: `${fulfilled} of ${requested} delivered`,
    fulfillmentSummaryIsPlaceholder: false,
  };
}

export const PORTAL_ORDER_LINKED_LEAD_FIXTURES: PortalLeadView[] = [
  portalOrderLinkedLeadFixture(),
  portalOrderLinkedLeadFixture({
    id: "lead_jordan",
    leadName: "Jordan K.",
    phoneMasked: "(•••) •••-4400",
    receivedAt: "2026-08-21T15:30:00.000Z",
    appointmentStatus: null,
  }),
];

export function portalOrderFulfillmentPreviewProps(
  scenario: PortalOrderFulfillmentPreviewScenario
): {
  order: PortalOrderDetailView;
  displayName: string;
  linkedLeads: PortalLeadView[];
  linkedLeadsError: string | null;
  linkedLeadsHasMore: boolean;
} {
  const displayName = "Valley Vet";
  switch (scenario) {
    case "zero":
      return {
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 0, 25, "not_started")),
        displayName,
        linkedLeads: [],
        linkedLeadsError: null,
        linkedLeadsHasMore: false,
      };
    case "partial":
      return {
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress")),
        displayName,
        linkedLeads: [],
        linkedLeadsError: null,
        linkedLeadsHasMore: false,
      };
    case "full":
      return {
        order: portalOrderDetailFixture({
          ...portalOrderFulfillmentAvailable(25, 25, 0, "fulfilled"),
          status: "completed",
          completedAt: "2026-08-24T16:00:00.000Z",
        }),
        displayName,
        linkedLeads: [],
        linkedLeadsError: null,
        linkedLeadsHasMore: false,
      };
    case "over":
      return {
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 30, 0, "fulfilled")),
        displayName,
        linkedLeads: [],
        linkedLeadsError: null,
        linkedLeadsHasMore: false,
      };
    case "unavailable":
      return {
        order: portalOrderDetailFixture(),
        displayName,
        linkedLeads: [],
        linkedLeadsError: null,
        linkedLeadsHasMore: false,
      };
    case "linked":
      return {
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress")),
        displayName,
        linkedLeads: PORTAL_ORDER_LINKED_LEAD_FIXTURES,
        linkedLeadsError: null,
        linkedLeadsHasMore: false,
      };
    case "leads_error":
      return {
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress")),
        displayName,
        linkedLeads: [],
        linkedLeadsError: "Order leads could not be loaded.",
        linkedLeadsHasMore: false,
      };
  }
}

export function parsePortalOrderFulfillmentPreviewScenario(
  raw: string | undefined
): PortalOrderFulfillmentPreviewScenario {
  if (
    raw &&
    (PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS as readonly string[]).includes(raw)
  ) {
    return raw as PortalOrderFulfillmentPreviewScenario;
  }
  return "partial";
}
