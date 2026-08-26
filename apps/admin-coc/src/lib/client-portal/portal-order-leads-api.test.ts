import assert from "node:assert/strict";
import test from "node:test";

import {
  clientLeadOrderLeadsPath,
  parseClientLeadOrderLeadsPayload,
  PORTAL_ORDER_LINKED_LEADS_PAGE_SIZE,
} from "./portal-order-leads-api.ts";

test("order-linked leads path uses the session tenant and first-page limit", () => {
  const path = clientLeadOrderLeadsPath({
    id: "ord_1001",
    clientAccountId: "acct_session",
  });
  assert.equal(
    path,
    `/client/v1/lead-orders/ord_1001/leads?clientAccountId=acct_session&limit=${PORTAL_ORDER_LINKED_LEADS_PAGE_SIZE}`
  );
  assert.equal(path.includes("acct_other"), false);
});

test("order-linked leads path encodes the order id and optional cursor", () => {
  const path = clientLeadOrderLeadsPath({
    id: "ord 1001",
    clientAccountId: "acct_session",
    cursor: "cur_2",
  });
  assert.match(path, /lead-orders\/ord%201001\/leads/);
  assert.match(path, /cursor=cur_2/);
});

test("parses a customer-safe leads payload and nextCursor", () => {
  const parsed = parseClientLeadOrderLeadsPayload({
    ok: true,
    items: [{ id: "lead_1", phoneMasked: "(•••) •••-1212" }],
    nextCursor: "cur_next",
    allocationId: "alloc_secret",
  });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.nextCursor, "cur_next");
});

test("treats a malformed payload as an empty first page", () => {
  assert.deepEqual(parseClientLeadOrderLeadsPayload(null), { items: [], nextCursor: null });
  assert.deepEqual(parseClientLeadOrderLeadsPayload({ items: "nope" }), {
    items: [],
    nextCursor: null,
  });
});
