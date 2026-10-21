import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const liveRow = {
  id: "ord_live",
  orderNumber: "LO-9001",
  clientAccountId: "acct_1",
  clientDisplayName: "Northwind",
  status: "submitted",
  nicheKey: "Solar",
  states: ["TX"],
  leadVolume: 25,
  campaignType: "Aged leads",
  crmPackage: "GHL",
  aiVoiceAddon: false,
  deliveryDestinationLabel: "GHL",
  createdAt: "2026-10-21T12:00:00.000Z",
  submittedAt: "2026-10-21T12:00:00.000Z",
  paymentConfirmationStatus: "pending_confirmation",
};

test("COC order load maps live rows and never substitutes preview orders", async () => {
  const { loadCocLeadOrders } = await import("./load-coc-lead-orders.ts");
  const loaded = await loadCocLeadOrders(
    async () => ({
      items: [liveRow, { id: 1 }, null],
      nextCursor: null,
      error: null,
    }),
    () => true
  );
  assert.equal(loaded.configured, true);
  assert.equal(loaded.error, null);
  assert.equal(loaded.orders.length, 1);
  assert.equal(loaded.orders[0]?.orderNumber, "LO-9001");
  assert.equal(loaded.orders[0]?.clientName, "Northwind");
  assert.equal(loaded.orders.some((order) => order.id.startsWith("ORD-")), false);
});

test("COC order load returns an empty list and the API error", async () => {
  const { loadCocLeadOrders } = await import("./load-coc-lead-orders.ts");
  const loaded = await loadCocLeadOrders(
    async () => ({
      items: [],
      nextCursor: null,
      error: "Admin API error (503): unavailable",
    }),
    () => true
  );
  assert.deepEqual(loaded.orders, []);
  assert.match(loaded.error ?? "", /unavailable/);
  assert.equal(loaded.configured, true);
});

test("COC order load stops when the admin API is not configured", async () => {
  const { loadCocLeadOrders } = await import("./load-coc-lead-orders.ts");
  let called = false;
  const loaded = await loadCocLeadOrders(
    async () => {
      called = true;
      return { items: [liveRow], nextCursor: null, error: null };
    },
    () => false
  );
  assert.equal(called, false);
  assert.deepEqual(loaded.orders, []);
  assert.equal(loaded.configured, false);
  assert.match(loaded.error ?? "", /not configured/i);
});

test("COC order load follows the existing cursor and reports truncation", async () => {
  const { loadCocLeadOrders } = await import("./load-coc-lead-orders.ts");
  const cursors: Array<string | undefined> = [];
  const loaded = await loadCocLeadOrders(async (params) => {
    cursors.push(params?.cursor);
    if (!params?.cursor) {
      return { items: [{ ...liveRow, id: "ord_page_1" }], nextCursor: "cursor-1", error: null };
    }
    return {
      items: [{ ...liveRow, id: "ord_page_2", orderNumber: "LO-9002" }],
      nextCursor: "cursor-1",
      error: null,
    };
  }, () => true);
  assert.deepEqual(cursors, [undefined, "cursor-1"]);
  assert.equal(loaded.truncated, true);
  assert.equal(loaded.orders.length, 2);
});
