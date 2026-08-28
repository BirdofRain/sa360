import assert from "node:assert/strict";
import test from "node:test";

import type { PortalAccountProfile } from "./account-profile.ts";
import { mapClientLeadOrderRow, type PortalOrderView } from "./map-client-orders.ts";
import type { PortalOrderFulfillment } from "./portal-order-fulfillment.ts";
import type { PortalOrderDelivery } from "./portal-order-deliveries.ts";
import {
  attachReleasedDeliveriesToOrder,
  buildPortalJourneyHome,
  comparePortalJourneyOrders,
  listRecentJourneyOrders,
  orderRequiresCustomerAction,
  PORTAL_JOURNEY_COPY,
  PORTAL_JOURNEY_ORDER_BUCKET,
  portalJourneyOrderBucket,
  portalJourneyRecentStatusLabel,
  resolveOrderNextAction,
  resolvePortalJourneyHero,
  selectPrimaryOrder,
} from "./portal-journey.ts";

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

function delivery(overrides: Partial<PortalOrderDelivery> = {}): PortalOrderDelivery {
  return {
    id: "pkg_1",
    orderId: "ord_1",
    filename: "Northwind_LO-2418.csv",
    displayFilename: "Northwind_LO-2418.csv",
    releasedAt: "2026-08-22T15:00:00.000Z",
    leadCount: 25,
    downloadAvailable: true,
    downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_1/download",
    ...overrides,
  };
}

function order(overrides: Partial<PortalOrderView> = {}): PortalOrderView {
  return {
    id: "ord_1",
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

function home(input: {
  account?: PortalAccountProfile | null | false;
  orders?: PortalOrderView[] | false;
}) {
  return buildPortalJourneyHome({
    account:
      input.account === false
        ? { ok: false }
        : { ok: true, value: input.account ?? account() },
    orders: input.orders === false ? { ok: false } : { ok: true, value: input.orders ?? [] },
  });
}

test("incomplete onboarding is the first next action even when orders exist", () => {
  const model = home({
    account: account({
      status: "onboarding",
      readyToOrder: false,
      profileComplete: false,
      missingFields: ["primaryNicheKeys"],
    }),
    orders: [order({ status: "submitted", paymentConfirmationStatus: "pending_confirmation" })],
  });
  assert.equal(model.hero.kind, "complete_account");
  assert.equal(model.hero.title, PORTAL_JOURNEY_COPY.completeAccount.title);
  assert.equal(model.hero.cta?.href, "/portal/account");
  assert.equal(model.hero.cta?.label, "Continue setup");
  assert.equal(model.recentOrders.length, 1);
});

test("ready account with no orders asks the customer to place a first order", () => {
  const model = home({ orders: [] });
  assert.equal(model.hero.kind, "place_first_order");
  assert.equal(model.hero.title, "Place your first order");
  assert.equal(model.hero.cta?.href, "/portal/orders/new");
  assert.equal(model.hero.cta?.label, "Place order");
});

test("submitted + payment pending has no fake payment CTA", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "submitted",
      paymentConfirmationStatus: "pending_confirmation",
      orderNumber: "LO-2418",
    })
  );
  assert.equal(hero.kind, "payment_pending");
  assert.equal(hero.title, "Awaiting payment confirmation");
  assert.equal(hero.orderNumber, "LO-2418");
  assert.equal(hero.detail, "We'll begin fulfillment after payment is confirmed.");
  assert.equal(hero.cta, null);
});

test("submitted + payment confirmed is review, not payment pending", () => {
  const confirmed = resolveOrderNextAction(
    order({ status: "submitted", paymentConfirmationStatus: "confirmed" })
  );
  assert.equal(confirmed.kind, "order_review");
  assert.equal(confirmed.title, "Your order is being reviewed");
  const notRequired = resolveOrderNextAction(
    order({ status: "submitted", paymentConfirmationStatus: "not_required" })
  );
  assert.equal(notRequired.kind, "order_review");
});

test("missing paymentConfirmationStatus is not invented as pending", () => {
  const hero = resolveOrderNextAction(
    order({ status: "submitted", paymentConfirmationStatus: null })
  );
  assert.equal(hero.kind, "order_review");
  assert.notEqual(hero.kind, "payment_pending");
});

test("approved / ready uses customer copy without dumping the enum", () => {
  const hero = resolveOrderNextAction(order({ status: "ready", paymentConfirmationStatus: "confirmed" }));
  assert.equal(hero.kind, "order_approved");
  assert.equal(hero.title, "Approved — ready for fulfillment");
  assert.equal(portalJourneyRecentStatusLabel(order({ status: "ready" })), "Approved");
});

test("active with zero fulfilled shows in-progress and authoritative 0 of N", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "active",
      paymentConfirmationStatus: "confirmed",
      fulfillment: fulfillment({ fulfilledQuantity: 0, remainingQuantity: 25, status: "not_started" }),
    })
  );
  assert.equal(hero.kind, "order_in_progress");
  assert.equal(hero.title, "Your order is in progress");
  assert.equal(hero.fulfillmentLabel, "0 of 25 delivered");
  assert.equal(hero.cta?.href, "/portal/orders/ord_1");
  assert.equal(hero.cta?.label, "View order");
});

test("active partial fulfillment shows N of M and a view-order CTA", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "active",
      paymentConfirmationStatus: "confirmed",
      fulfillment: fulfillment({
        fulfilledQuantity: 17,
        remainingQuantity: 8,
        status: "in_progress",
      }),
    })
  );
  assert.equal(hero.kind, "order_in_progress");
  assert.equal(hero.fulfillmentLabel, "17 of 25 delivered");
  assert.equal(hero.cta?.label, "View order");
});

test("fulfilled with a successful empty release lookup stays finalizing, never Ready", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "active",
      paymentConfirmationStatus: "confirmed",
      fulfillment: fulfillment({
        fulfilledQuantity: 25,
        remainingQuantity: 0,
        status: "fulfilled",
      }),
      releasedDeliveries: [],
      releasedDeliveriesFailed: false,
    })
  );
  assert.equal(hero.kind, "order_finalizing");
  assert.equal(hero.title, "We're finalizing your delivery");
  assert.equal(hero.detail, "Your order is being finalized.");
  assert.notEqual(hero.kind, "order_ready");
  assert.equal(portalJourneyRecentStatusLabel(
    order({
      status: "active",
      fulfillment: fulfillment({ status: "fulfilled", fulfilledQuantity: 25, remainingQuantity: 0 }),
      releasedDeliveries: [],
    })
  ), "Finalizing delivery");
});

test("one released delivery becomes Your order is ready with a download CTA", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "active",
      paymentConfirmationStatus: "confirmed",
      fulfillment: fulfillment({
        fulfilledQuantity: 25,
        remainingQuantity: 0,
        status: "fulfilled",
      }),
      releasedDeliveries: [delivery()],
    })
  );
  assert.equal(hero.kind, "order_ready");
  assert.equal(hero.title, "Your order is ready");
  assert.equal(hero.detail, "Your spreadsheet is ready to download.");
  assert.equal(hero.cta?.label, "Download spreadsheet");
  assert.equal(hero.cta?.href, "/api/client-portal/orders/ord_1/exports/pkg_1/download");
  assert.equal(
    portalJourneyRecentStatusLabel(order({ releasedDeliveries: [delivery()] })),
    "Delivery ready"
  );
});

test("multiple released deliveries send the customer to order detail", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "active",
      paymentConfirmationStatus: "confirmed",
      releasedDeliveries: [
        delivery({ id: "pkg_1" }),
        delivery({
          id: "pkg_2",
          downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_2/download",
        }),
      ],
    })
  );
  assert.equal(hero.kind, "order_ready");
  assert.equal(hero.cta?.label, "View deliveries");
  assert.equal(hero.cta?.href, "/portal/orders/ord_1");
});

test("generated or unmapped export rows never become Ready", () => {
  const attached = attachReleasedDeliveriesToOrder(
    order({
      status: "active",
      fulfillment: fulfillment({
        fulfilledQuantity: 25,
        remainingQuantity: 0,
        status: "fulfilled",
      }),
    }),
    {
      ok: true,
      items: [
        { id: "pkg_hidden", filename: "secret.csv", downloadAvailable: false },
        { id: "pkg_other", orderId: "ord_other", filename: "x.csv", releasedAt: "2026-08-20T15:00:00.000Z", leadCount: 1, downloadAvailable: true },
      ],
    }
  );
  const hero = resolveOrderNextAction(attached);
  assert.equal(hero.kind, "order_finalizing");
  assert.notEqual(hero.kind, "order_ready");
  assert.equal(portalJourneyRecentStatusLabel(attached), "Finalizing delivery");
});

test("completed is a truthful terminal state, not invented release copy", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "completed",
      paymentConfirmationStatus: "confirmed",
      fulfillment: fulfillment({
        fulfilledQuantity: 25,
        remainingQuantity: 0,
        status: "fulfilled",
      }),
    })
  );
  assert.equal(hero.kind, "order_complete");
  assert.equal(hero.title, "This order is complete");
});

test("active without a fulfillment object does not invent a delivered count", () => {
  const hero = resolveOrderNextAction(
    order({
      status: "active",
      paymentConfirmationStatus: "confirmed",
      fulfillment: null,
      volume: 25,
    })
  );
  assert.equal(hero.kind, "order_in_progress");
  assert.equal(hero.fulfillmentLabel, null);
});

test("released delivery is the only current order-level customer action", () => {
  const statuses: PortalOrderView["status"][] = [
    "draft",
    "submitted",
    "needs_setup",
    "needs_compliance",
    "ready",
    "active",
    "paused",
    "completed",
    "canceled",
  ];
  for (const status of statuses) {
    assert.equal(orderRequiresCustomerAction(order({ status, releasedDeliveries: [] })), false);
  }
  assert.equal(
    orderRequiresCustomerAction(order({ status: "completed", releasedDeliveries: [delivery()] })),
    true
  );
});

test("delivery lookup failure does not fabricate ready or finalizing", () => {
  const failed = order({
    status: "active",
    paymentConfirmationStatus: "confirmed",
    fulfillment: fulfillment({
      fulfilledQuantity: 25,
      remainingQuantity: 0,
      status: "fulfilled",
    }),
    releasedDeliveriesFailed: true,
  });
  const hero = resolveOrderNextAction(failed);
  assert.equal(hero.kind, "order_in_progress");
  assert.notEqual(hero.kind, "order_ready");
  assert.notEqual(hero.kind, "order_finalizing");
  assert.equal(portalJourneyRecentStatusLabel(failed), "In progress");

  const attached = attachReleasedDeliveriesToOrder(failed, { ok: false });
  assert.equal(attached.releasedDeliveriesFailed, true);
  assert.equal(resolveOrderNextAction(attached).kind, "order_in_progress");
});

test("released delivery beats newer in-progress and later-incomplete onboarding", () => {
  const olderReleased = order({
    id: "ord_released",
    orderNumber: "LO-1000",
    status: "completed",
    paymentConfirmationStatus: "confirmed",
    createdAt: "2026-07-01T00:00:00.000Z",
    releasedDeliveries: [delivery({ orderId: "ord_released" })],
  });
  const newerOpen = order({
    id: "ord_new_open",
    orderNumber: "LO-1004",
    status: "active",
    paymentConfirmationStatus: "confirmed",
    createdAt: "2026-08-20T00:00:00.000Z",
    releasedDeliveries: [],
  });
  assert.equal(portalJourneyOrderBucket(olderReleased), PORTAL_JOURNEY_ORDER_BUCKET.customerActionRequired);
  assert.equal(selectPrimaryOrder([newerOpen, olderReleased])?.id, "ord_released");

  const model = home({
    account: account({ status: "onboarding", readyToOrder: false }),
    orders: [newerOpen, olderReleased],
  });
  assert.equal(model.hero.kind, "order_ready");
  assert.equal(model.hero.orderId, "ord_released");
  assert.equal(model.hero.title, "Your order is ready");
});

test("multiple-order priority: customer action required first, then newest open, then latest completed", () => {
  const olderCompleted = order({
    id: "ord_old_done",
    orderNumber: "LO-1001",
    status: "completed",
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  const newerCompleted = order({
    id: "ord_new_done",
    orderNumber: "LO-1002",
    status: "completed",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  const olderOpen = order({
    id: "ord_old_open",
    orderNumber: "LO-1003",
    status: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: "2026-08-10T00:00:00.000Z",
  });
  const newerOpen = order({
    id: "ord_new_open",
    orderNumber: "LO-1004",
    status: "active",
    paymentConfirmationStatus: "confirmed",
    createdAt: "2026-08-20T00:00:00.000Z",
  });

  assert.equal(portalJourneyOrderBucket(olderOpen), PORTAL_JOURNEY_ORDER_BUCKET.openInProgress);
  assert.equal(portalJourneyOrderBucket(newerCompleted), PORTAL_JOURNEY_ORDER_BUCKET.completed);

  assert.equal(selectPrimaryOrder([olderCompleted, newerCompleted])?.id, "ord_new_done");
  assert.equal(selectPrimaryOrder([olderCompleted, newerOpen, olderOpen])?.id, "ord_new_open");
  assert.equal(
    selectPrimaryOrder([newerOpen, olderOpen], {
      requiresCustomerAction: (row) => row.id === "ord_old_open",
    })?.id,
    "ord_old_open"
  );
  assert.ok(comparePortalJourneyOrders(olderOpen, newerCompleted) < 0);

  const model = home({
    orders: [olderCompleted, newerCompleted, olderOpen, newerOpen],
  });
  assert.equal(model.hero.orderId, "ord_new_open");
  assert.equal(model.recentOrders.length, 4);
  assert.deepEqual(
    model.recentOrders.map((row) => row.id),
    ["ord_new_open", "ord_old_open", "ord_new_done", "ord_old_done"]
  );
});

test("account API failure does not fabricate onboarding or no-orders copy", () => {
  const failed = home({ account: false, orders: false });
  assert.equal(failed.hero.kind, "account_unavailable");
  assert.equal(failed.hero.title, "We couldn't load your account status.");
  assert.notEqual(failed.hero.kind, "complete_account");
  assert.notEqual(failed.hero.kind, "place_first_order");

  const accountFailedOrdersOk = home({
    account: false,
    orders: [order({ status: "active", paymentConfirmationStatus: "confirmed" })],
  });
  assert.equal(accountFailedOrdersOk.hero.kind, "account_unavailable");
  assert.equal(accountFailedOrdersOk.recentOrders.length, 1);
});

test("orders API failure is not silently converted into no orders yet", () => {
  const model = home({ orders: false });
  assert.equal(model.hero.kind, "orders_unavailable");
  assert.equal(model.hero.title, "We couldn't load your orders.");
  assert.equal(model.ordersAvailable, false);
  assert.equal(model.recentOrders.length, 0);
  assert.notEqual(model.hero.kind, "place_first_order");
  assert.notEqual(model.hero.title, "Place your first order");
});

test("paused account is not treated as complete-account or place-order", () => {
  const model = home({
    account: account({ status: "paused", readyToOrder: false }),
    orders: [],
  });
  assert.equal(model.hero.kind, "account_paused");
  assert.notEqual(model.hero.kind, "place_first_order");
});

test("list mapper keeps payment only when the client API sent a known value", () => {
  const pending = mapClientLeadOrderRow({
    id: "ord_1",
    orderNumber: "LO-2418",
    status: "submitted",
    nicheKey: "vet",
    leadVolume: 25,
    campaignType: "aged",
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: "2026-08-20T12:00:00.000Z",
  });
  assert.equal(pending?.paymentConfirmationStatus, "pending_confirmation");

  const missing = mapClientLeadOrderRow({
    id: "ord_2",
    orderNumber: "LO-2419",
    status: "submitted",
    nicheKey: "vet",
    leadVolume: 25,
    campaignType: "aged",
    createdAt: "2026-08-20T12:00:00.000Z",
  });
  assert.equal(missing?.paymentConfirmationStatus, null);
});

test("list mapper exposes fulfillment only from the committed-allocation object", () => {
  const mapped = mapClientLeadOrderRow({
    id: "ord_1",
    orderNumber: "LO-2418",
    status: "active",
    nicheKey: "vet",
    leadVolume: 99,
    campaignType: "aged",
    paymentConfirmationStatus: "confirmed",
    fulfillmentAvailable: true,
    fulfillment: {
      requestedQuantity: 25,
      fulfilledQuantity: 17,
      remainingQuantity: 8,
      status: "in_progress",
    },
    createdAt: "2026-08-20T12:00:00.000Z",
  });
  assert.deepEqual(mapped?.fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 17,
    remainingQuantity: 8,
    status: "in_progress",
  });
});

test("recent-order labels avoid internal ready/active/PPL terms", () => {
  assert.equal(portalJourneyRecentStatusLabel(order({ status: "ready" })), "Approved");
  assert.equal(portalJourneyRecentStatusLabel(order({ status: "active" })), "In progress");
  assert.equal(
    portalJourneyRecentStatusLabel(
      order({
        status: "active",
        fulfillment: fulfillment({ status: "fulfilled", fulfilledQuantity: 25, remainingQuantity: 0 }),
        releasedDeliveries: [],
      })
    ),
    "Finalizing delivery"
  );
  assert.equal(
    portalJourneyRecentStatusLabel(order({ status: "completed", releasedDeliveries: [delivery()] })),
    "Delivery ready"
  );
  for (const label of ["Approved", "In progress", "Finalizing delivery", "Awaiting payment", "Delivery ready"]) {
    assert.doesNotMatch(label, /\bactive\b/i);
    assert.doesNotMatch(label, /\bPPL\b/);
    assert.doesNotMatch(label, /\bLF2\b/);
    assert.doesNotMatch(label, /LeadAllocation/);
  }
});

test("recent orders stay visible and are capped", () => {
  const orders = Array.from({ length: 7 }, (_, index) =>
    order({
      id: `ord_${index}`,
      orderNumber: `LO-${2400 + index}`,
      createdAt: `2026-08-0${index + 1}T00:00:00.000Z`,
    })
  );
  const recent = listRecentJourneyOrders(orders);
  assert.equal(recent.length, 5);
  assert.equal(recent[0]?.id, "ord_6");
});

test("resolvePortalJourneyHero uses the same account-then-order priority as the home model", () => {
  const hero = resolvePortalJourneyHero({
    account: { ok: true, value: account() },
    orders: {
      ok: true,
      value: [
        order({
          status: "submitted",
          paymentConfirmationStatus: "pending_confirmation",
          orderNumber: "LO-2418",
        }),
      ],
    },
  });
  assert.equal(hero.kind, "payment_pending");
  assert.equal(hero.orderNumber, "LO-2418");
});
