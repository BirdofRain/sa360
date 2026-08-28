/**
 * Presentation-only customer journey next-action resolver.
 *
 * Derives a single home-page hero from existing client-safe dimensions:
 * account (`GET /client/v1/account`), order status, `paymentConfirmationStatus`,
 * and the committed-allocation fulfillment object. Does not persist a journey
 * status and does not invent delivery-release or payment state.
 */

import type { PortalAccountProfile } from "./account-profile.ts";
import type {
  PortalOrderStatus,
  PortalOrderView,
  PortalPaymentConfirmationStatus,
} from "./map-client-orders.ts";
import {
  portalFulfillmentPrimarySummary,
  type PortalOrderFulfillment,
} from "./portal-order-fulfillment.ts";

export const PORTAL_JOURNEY_RECENT_ORDER_LIMIT = 5;

export const PORTAL_JOURNEY_KIND = [
  "account_unavailable",
  "account_paused",
  "complete_account",
  "orders_unavailable",
  "place_first_order",
  "payment_pending",
  "order_review",
  "order_needs_setup",
  "order_needs_review",
  "order_approved",
  "order_in_progress",
  "order_finalizing",
  "order_paused",
  "order_complete",
  "order_canceled",
  "order_draft",
] as const;

export type PortalJourneyKind = (typeof PORTAL_JOURNEY_KIND)[number];

export type PortalJourneyCta = {
  href: string;
  label: string;
};

export type PortalJourneyHero = {
  kind: PortalJourneyKind;
  title: string;
  detail: string | null;
  orderId: string | null;
  orderNumber: string | null;
  fulfillmentLabel: string | null;
  cta: PortalJourneyCta | null;
};

export type PortalJourneyLoad<T> = { ok: true; value: T } | { ok: false };

export type PortalJourneyHomeInput = {
  account: PortalJourneyLoad<PortalAccountProfile | null>;
  orders: PortalJourneyLoad<PortalOrderView[]>;
};

export type PortalJourneyHomeModel = {
  hero: PortalJourneyHero;
  primaryOrderId: string | null;
  recentOrders: PortalOrderView[];
  ordersAvailable: boolean;
  accountAvailable: boolean;
};

/** First-match buckets for choosing the primary order among many. */
export const PORTAL_JOURNEY_ORDER_BUCKET = {
  customerActionRequired: 0,
  openInProgress: 1,
  completed: 2,
} as const;

export type PortalJourneyOrderBucket =
  (typeof PORTAL_JOURNEY_ORDER_BUCKET)[keyof typeof PORTAL_JOURNEY_ORDER_BUCKET];

const OPEN_ORDER_STATUSES = new Set<PortalOrderStatus>([
  "draft",
  "submitted",
  "needs_setup",
  "needs_compliance",
  "ready",
  "active",
  "paused",
]);

const TERMINAL_ORDER_STATUSES = new Set<PortalOrderStatus>(["completed", "canceled"]);

export const PORTAL_JOURNEY_COPY = {
  accountUnavailable: {
    title: "We couldn't load your account status.",
    detail: "Try again shortly, or open Account for the latest we have.",
  },
  accountPaused: {
    title: "This account is paused",
    detail: "Contact your SA360 team to continue.",
  },
  completeAccount: {
    title: "Complete your account",
    detail: "Add the required details so we can work with your account.",
    cta: "Continue setup",
  },
  ordersUnavailable: {
    title: "We couldn't load your orders.",
    detail: "Your account is available. Order status will appear when that service responds.",
  },
  placeFirstOrder: {
    title: "Place your first order",
    detail: "Tell us what you need and your SA360 team will review it.",
    cta: "Place order",
  },
  paymentPending: {
    title: "Awaiting payment confirmation",
    detail: "We'll begin fulfillment after payment is confirmed.",
  },
  orderReview: {
    title: "Your order is being reviewed",
    detail: "Your SA360 team will review this order next.",
  },
  orderNeedsSetup: {
    title: "Your order needs a bit more setup",
    detail: "Your SA360 team is finishing the details before work can begin.",
  },
  orderNeedsReview: {
    title: "Your order is under review",
    detail: "A review is required before this order can go live.",
  },
  orderApproved: {
    title: "Approved — ready for fulfillment",
    detail: "Fulfillment starts once your SA360 team begins work.",
  },
  orderInProgress: {
    title: "Your order is in progress",
    detail: null,
    cta: "View order",
  },
  orderFinalizing: {
    title: "We're finalizing your delivery",
    detail: "Your order is being finalized.",
  },
  orderPaused: {
    title: "This order is paused",
    detail: "Contact your SA360 team if you have questions.",
  },
  orderComplete: {
    title: "This order is complete",
    detail: "You can still open the order for history and delivered leads.",
    cta: "View order",
  },
  orderCanceled: {
    title: "This order was canceled",
    detail: "Contact your SA360 team if you have questions.",
  },
  orderDraft: {
    title: "This order is still a draft",
    detail: "Your SA360 team will submit it when it is ready.",
  },
  recentOrdersUnavailable: "We couldn't load your recent orders.",
  recentOrdersEmpty: "No recent orders to show.",
} as const;

function paymentOf(order: PortalOrderView): PortalPaymentConfirmationStatus | null {
  return order.paymentConfirmationStatus ?? null;
}

function fulfillmentOf(order: PortalOrderView): PortalOrderFulfillment | null {
  return order.fulfillment ?? null;
}

function hero(partial: PortalJourneyHero): PortalJourneyHero {
  return partial;
}

function withOrder(
  order: PortalOrderView,
  kind: PortalJourneyKind,
  copy: { title: string; detail: string | null },
  cta: PortalJourneyCta | null = null,
  fulfillmentLabel: string | null = null
): PortalJourneyHero {
  return hero({
    kind,
    title: copy.title,
    detail: copy.detail,
    orderId: order.id,
    orderNumber: order.orderNumber,
    fulfillmentLabel,
    cta,
  });
}

function viewOrderCta(order: PortalOrderView): PortalJourneyCta {
  return {
    href: `/portal/orders/${encodeURIComponent(order.id)}`,
    label: PORTAL_JOURNEY_COPY.orderInProgress.cta,
  };
}

export function orderRequiresCustomerAction(order: PortalOrderView): boolean {
  void order;
  // No order-level customer action exists on the current client-safe contract:
  // payment has no customer CTA, and delivery release/download is not exposed.
  return false;
}

export function isPortalJourneyOpenOrder(status: PortalOrderStatus): boolean {
  return OPEN_ORDER_STATUSES.has(status);
}

export function isPortalJourneyTerminalOrder(status: PortalOrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.has(status);
}

export function portalJourneyOrderBucket(
  order: PortalOrderView,
  requiresCustomerAction: (order: PortalOrderView) => boolean = orderRequiresCustomerAction
): PortalJourneyOrderBucket {
  if (requiresCustomerAction(order)) {
    return PORTAL_JOURNEY_ORDER_BUCKET.customerActionRequired;
  }
  if (isPortalJourneyOpenOrder(order.status)) {
    return PORTAL_JOURNEY_ORDER_BUCKET.openInProgress;
  }
  return PORTAL_JOURNEY_ORDER_BUCKET.completed;
}

export function portalJourneyOrderRecencyMs(order: PortalOrderView): number {
  const created = Date.parse(order.createdAt);
  if (Number.isFinite(created)) return created;
  return 0;
}

export type SelectPrimaryOrderOptions = {
  /** Test hook / future release-download hook. Default: orderRequiresCustomerAction. */
  requiresCustomerAction?: (order: PortalOrderView) => boolean;
};

/**
 * Primary-order algorithm (documented in tests):
 * 1. Customer action required
 * 2. Newest open / in-progress order
 * 3. Latest completed / canceled order
 * Tie-break: recency desc, then id desc.
 */
export function comparePortalJourneyOrders(
  a: PortalOrderView,
  b: PortalOrderView,
  options: SelectPrimaryOrderOptions = {}
): number {
  const requiresCustomerAction = options.requiresCustomerAction ?? orderRequiresCustomerAction;
  const bucketDiff =
    portalJourneyOrderBucket(a, requiresCustomerAction) -
    portalJourneyOrderBucket(b, requiresCustomerAction);
  if (bucketDiff !== 0) return bucketDiff;
  const recency = portalJourneyOrderRecencyMs(b) - portalJourneyOrderRecencyMs(a);
  if (recency !== 0) return recency;
  return b.id.localeCompare(a.id);
}

export function selectPrimaryOrder(
  orders: PortalOrderView[],
  options: SelectPrimaryOrderOptions = {}
): PortalOrderView | null {
  if (orders.length === 0) return null;
  const ranked = [...orders].sort((a, b) => comparePortalJourneyOrders(a, b, options));
  return ranked[0] ?? null;
}

export function portalJourneyFulfillmentLabel(order: PortalOrderView): string | null {
  const fulfillment = fulfillmentOf(order);
  if (!fulfillment) return null;
  return portalFulfillmentPrimarySummary(fulfillment);
}

export function portalJourneyRecentStatusLabel(order: PortalOrderView): string {
  const payment = paymentOf(order);
  const fulfillment = fulfillmentOf(order);
  switch (order.status) {
    case "draft":
      return "Draft";
    case "submitted":
      return payment === "pending_confirmation" ? "Awaiting payment" : "In review";
    case "needs_setup":
      return "Needs setup";
    case "needs_compliance":
      return "Needs review";
    case "ready":
      return "Approved";
    case "active":
      return fulfillment?.status === "fulfilled" ? "Finalizing delivery" : "In progress";
    case "paused":
      return "Paused";
    case "completed":
      return "Complete";
    case "canceled":
      return "Canceled";
  }
}

export function resolveOrderNextAction(order: PortalOrderView): PortalJourneyHero {
  const payment = paymentOf(order);
  const fulfillment = fulfillmentOf(order);
  const countLabel = portalJourneyFulfillmentLabel(order);

  switch (order.status) {
    case "draft":
      return withOrder(order, "order_draft", PORTAL_JOURNEY_COPY.orderDraft);
    case "submitted":
      if (payment === "pending_confirmation") {
        return withOrder(order, "payment_pending", PORTAL_JOURNEY_COPY.paymentPending);
      }
      return withOrder(order, "order_review", PORTAL_JOURNEY_COPY.orderReview);
    case "needs_setup":
      return withOrder(order, "order_needs_setup", PORTAL_JOURNEY_COPY.orderNeedsSetup);
    case "needs_compliance":
      return withOrder(order, "order_needs_review", PORTAL_JOURNEY_COPY.orderNeedsReview);
    case "ready":
      return withOrder(order, "order_approved", PORTAL_JOURNEY_COPY.orderApproved);
    case "paused":
      return withOrder(order, "order_paused", PORTAL_JOURNEY_COPY.orderPaused);
    case "active":
      if (fulfillment?.status === "fulfilled") {
        return withOrder(
          order,
          "order_finalizing",
          PORTAL_JOURNEY_COPY.orderFinalizing,
          viewOrderCta(order)
        );
      }
      return withOrder(
        order,
        "order_in_progress",
        {
          title: PORTAL_JOURNEY_COPY.orderInProgress.title,
          detail: PORTAL_JOURNEY_COPY.orderInProgress.detail,
        },
        viewOrderCta(order),
        countLabel
      );
    case "completed":
      return withOrder(
        order,
        "order_complete",
        PORTAL_JOURNEY_COPY.orderComplete,
        viewOrderCta(order)
      );
    case "canceled":
      return withOrder(order, "order_canceled", PORTAL_JOURNEY_COPY.orderCanceled);
  }
}

export function resolvePortalJourneyHero(input: PortalJourneyHomeInput): PortalJourneyHero {
  if (!input.account.ok || !input.account.value) {
    return hero({
      kind: "account_unavailable",
      title: PORTAL_JOURNEY_COPY.accountUnavailable.title,
      detail: PORTAL_JOURNEY_COPY.accountUnavailable.detail,
      orderId: null,
      orderNumber: null,
      fulfillmentLabel: null,
      cta: { href: "/portal/account", label: "View account" },
    });
  }

  const account = input.account.value;
  if (account.status === "paused" || account.status === "archived") {
    return hero({
      kind: "account_paused",
      title: PORTAL_JOURNEY_COPY.accountPaused.title,
      detail: PORTAL_JOURNEY_COPY.accountPaused.detail,
      orderId: null,
      orderNumber: null,
      fulfillmentLabel: null,
      cta: { href: "/portal/account", label: "View account" },
    });
  }

  if (!account.readyToOrder) {
    return hero({
      kind: "complete_account",
      title: PORTAL_JOURNEY_COPY.completeAccount.title,
      detail: PORTAL_JOURNEY_COPY.completeAccount.detail,
      orderId: null,
      orderNumber: null,
      fulfillmentLabel: null,
      cta: { href: "/portal/account", label: PORTAL_JOURNEY_COPY.completeAccount.cta },
    });
  }

  if (!input.orders.ok) {
    return hero({
      kind: "orders_unavailable",
      title: PORTAL_JOURNEY_COPY.ordersUnavailable.title,
      detail: PORTAL_JOURNEY_COPY.ordersUnavailable.detail,
      orderId: null,
      orderNumber: null,
      fulfillmentLabel: null,
      cta: null,
    });
  }

  if (input.orders.value.length === 0) {
    return hero({
      kind: "place_first_order",
      title: PORTAL_JOURNEY_COPY.placeFirstOrder.title,
      detail: PORTAL_JOURNEY_COPY.placeFirstOrder.detail,
      orderId: null,
      orderNumber: null,
      fulfillmentLabel: null,
      cta: { href: "/portal/orders/new", label: PORTAL_JOURNEY_COPY.placeFirstOrder.cta },
    });
  }

  const primary = selectPrimaryOrder(input.orders.value);
  if (!primary) {
    return hero({
      kind: "orders_unavailable",
      title: PORTAL_JOURNEY_COPY.ordersUnavailable.title,
      detail: PORTAL_JOURNEY_COPY.ordersUnavailable.detail,
      orderId: null,
      orderNumber: null,
      fulfillmentLabel: null,
      cta: null,
    });
  }
  return resolveOrderNextAction(primary);
}

export function listRecentJourneyOrders(orders: PortalOrderView[]): PortalOrderView[] {
  return [...orders]
    .sort((a, b) => {
      const recency = portalJourneyOrderRecencyMs(b) - portalJourneyOrderRecencyMs(a);
      if (recency !== 0) return recency;
      return b.id.localeCompare(a.id);
    })
    .slice(0, PORTAL_JOURNEY_RECENT_ORDER_LIMIT);
}

export function buildPortalJourneyHome(input: PortalJourneyHomeInput): PortalJourneyHomeModel {
  const hero = resolvePortalJourneyHero(input);
  const ordersAvailable = input.orders.ok;
  const recentOrders = ordersAvailable ? listRecentJourneyOrders(input.orders.value) : [];
  return {
    hero,
    primaryOrderId: hero.orderId,
    recentOrders,
    ordersAvailable,
    accountAvailable: input.account.ok && input.account.value != null,
  };
}
