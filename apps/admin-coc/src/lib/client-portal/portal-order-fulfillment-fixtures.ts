import type { PortalLeadView } from "./map-client-leads.ts";
import type { PortalOrderDetailView } from "./map-client-orders.ts";
import { PORTAL_ORDER_FULFILLMENT_PLACEHOLDER } from "./map-client-orders.ts";
import type { PortalOrderDelivery } from "./portal-order-deliveries.ts";
import type { PortalOrderFulfillment } from "./portal-order-fulfillment.ts";

export const PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS = [
  "zero",
  "partial",
  "full",
  "over",
  "unavailable",
  "linked",
  "leads_error",
  "released",
  "released_multiple",
  "completed_unreleased",
  "submitted_payment",
  "completed_released",
  "finalizing",
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
    paymentConfirmationStatus: "confirmed",
    states: ["TX", "OK"],
    deliveryCadence: "weekly",
    crmPackage: "GHL Pro",
    aiVoiceAddon: true,
    requestedStartDate: null,
    destinationType: "ghl",
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

function previewDelivery(overrides: Partial<PortalOrderDelivery> = {}): PortalOrderDelivery {
  return {
    id: "pkg_a",
    orderId: "ord_1001",
    filename: "Valley-Vet_LO-1001_VET_TX-OK_3-6mo_10-leads.csv",
    displayFilename: "Valley-Vet_LO-1001_VET_TX-OK_3-6mo_10-leads.csv",
    releasedAt: "2026-08-20T15:00:00.000Z",
    leadCount: 10,
    downloadAvailable: true,
    downloadHref: "/api/client-portal/orders/ord_1001/exports/pkg_a/download",
    ...overrides,
  };
}

export function portalOrderFulfillmentPreviewProps(
  scenario: PortalOrderFulfillmentPreviewScenario
): {
  order: PortalOrderDetailView;
  displayName: string;
  linkedLeads: PortalLeadView[];
  linkedLeadsError: string | null;
  linkedLeadsHasMore: boolean;
  deliveries: PortalOrderDelivery[];
  deliveriesError: string | null;
} {
  const displayName = "Valley Vet";
  const base = {
    displayName,
    linkedLeads: [] as PortalLeadView[],
    linkedLeadsError: null as string | null,
    linkedLeadsHasMore: false,
    deliveries: [] as PortalOrderDelivery[],
    deliveriesError: null as string | null,
  };
  switch (scenario) {
    case "zero":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 0, 25, "not_started")),
      };
    case "partial":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress")),
      };
    case "full":
      return {
        ...base,
        order: portalOrderDetailFixture({
          ...portalOrderFulfillmentAvailable(25, 25, 0, "fulfilled"),
          status: "completed",
          completedAt: "2026-08-24T16:00:00.000Z",
        }),
      };
    case "over":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 30, 0, "fulfilled")),
      };
    case "unavailable":
      return {
        ...base,
        order: portalOrderDetailFixture(),
      };
    case "linked":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress")),
        linkedLeads: PORTAL_ORDER_LINKED_LEAD_FIXTURES,
      };
    case "leads_error":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress")),
        linkedLeadsError: "Order leads could not be loaded.",
      };
    case "released":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 10, 15, "in_progress")),
        deliveries: [previewDelivery()],
      };
    case "released_multiple":
      return {
        ...base,
        order: portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 15, 10, "in_progress")),
        deliveries: [
          previewDelivery(),
          previewDelivery({
            id: "pkg_b",
            filename: "Valley-Vet_LO-1001_VET_TX-OK_3-6mo_5-leads.csv",
            displayFilename: "Valley-Vet_LO-1001_VET_TX-OK_3-6mo_5-leads.csv",
            releasedAt: "2026-08-21T15:00:00.000Z",
            leadCount: 5,
            downloadHref: "/api/client-portal/orders/ord_1001/exports/pkg_b/download",
          }),
        ],
      };
    case "completed_unreleased":
      return {
        ...base,
        order: portalOrderDetailFixture({
          ...portalOrderFulfillmentAvailable(25, 0, 25, "not_started"),
          status: "completed",
          paymentConfirmationStatus: "confirmed",
          completedAt: "2026-08-24T16:00:00.000Z",
          destination: "GHL location",
          destinationType: "ghl",
          crmPackage: "GHL Pro",
          aiVoiceAddon: true,
          setupWarnings: ["GHL destination is not connected"],
        }),
      };
    case "submitted_payment":
      return {
        ...base,
        order: portalOrderDetailFixture({
          status: "submitted",
          paymentConfirmationStatus: "pending_confirmation",
          fulfillmentAvailable: false,
          fulfillment: null,
          fulfillmentSummaryIsPlaceholder: true,
          activatedAt: null,
        }),
      };
    case "completed_released":
      return {
        ...base,
        order: portalOrderDetailFixture({
          ...portalOrderFulfillmentAvailable(25, 25, 0, "fulfilled"),
          status: "completed",
          paymentConfirmationStatus: "confirmed",
          completedAt: "2026-08-24T16:00:00.000Z",
        }),
        deliveries: [previewDelivery({ leadCount: 25 })],
      };
    case "finalizing":
      return {
        ...base,
        order: portalOrderDetailFixture({
          ...portalOrderFulfillmentAvailable(25, 25, 0, "fulfilled"),
          status: "completed",
          paymentConfirmationStatus: "confirmed",
          completedAt: "2026-08-24T16:00:00.000Z",
        }),
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

export function portalOrdersListPreviewOrders() {
  const submitted = portalOrderFulfillmentPreviewProps("submitted_payment").order;
  const active = portalOrderFulfillmentPreviewProps("partial").order;
  const completedEmpty = portalOrderFulfillmentPreviewProps("completed_unreleased").order;
  const completedReady = portalOrderFulfillmentPreviewProps("completed_released").order;
  return [
    { ...submitted, id: "ord_submitted", orderNumber: "LO-1101" },
    { ...active, id: "ord_active", orderNumber: "LO-1102" },
    { ...completedEmpty, id: "ord_completed_empty", orderNumber: "LO-1103" },
    { ...completedReady, id: "ord_completed_ready", orderNumber: "LO-1104" },
  ];
}
