import assert from "node:assert/strict";
import test from "node:test";

import { PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR } from "./portal-order-leads-api.ts";
import { portalOrderLinkedLeadsState } from "./portal-order-linked-leads-state.ts";

test("maps a successful first page of order-linked leads", () => {
  const state = portalOrderLinkedLeadsState({
    items: [
      {
        id: "lead_1",
        leadName: "Alex P.",
        phoneMasked: "(•••) •••-1212",
        phoneE164: "+1555121212",
        email: "alex@example.com",
        deliveryStatus: "delivered",
        receivedAt: "2026-08-20T10:00:00.000Z",
        allocationId: "alloc_secret",
        contactIdGhl: "ghl_secret",
      },
    ],
    error: null,
    nextCursor: null,
  });
  assert.equal(state.error, null);
  assert.equal(state.hasMore, false);
  assert.equal(state.leads[0]?.id, "lead_1");
  assert.equal(state.leads[0]?.phoneMasked, "(•••) •••-1212");
  assert.equal(Object.hasOwn(state.leads[0] ?? {}, "phoneE164"), false);
  assert.equal(Object.hasOwn(state.leads[0] ?? {}, "email"), false);
  assert.equal(Object.hasOwn(state.leads[0] ?? {}, "allocationId"), false);
  assert.equal(Object.hasOwn(state.leads[0] ?? {}, "contactIdGhl"), false);
});

test("keeps an independent load error and does not invent leads", () => {
  const state = portalOrderLinkedLeadsState({
    items: [{ id: "lead_should_not_show" }],
    error: "502 upstream",
    nextCursor: "cur_2",
  });
  assert.equal(state.error, PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR);
  assert.deepEqual(state.leads, []);
  assert.equal(state.hasMore, false);
});

test("flags first-page-only when the backend returns nextCursor", () => {
  const state = portalOrderLinkedLeadsState({
    items: [{ id: "lead_1", deliveryStatus: "delivered" }],
    error: null,
    nextCursor: "cur_2",
  });
  assert.equal(state.hasMore, true);
  assert.equal(state.error, null);
});
