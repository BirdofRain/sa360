import assert from "node:assert/strict";
import module from "node:module";
import { afterEach, describe, it } from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const originalFetch = globalThis.fetch;
const originalEnv = {
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
};

function enableAdminApi() {
  process.env.ADMIN_API_KEY = "test-admin-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.com";
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv.ADMIN_API_KEY !== undefined) process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
  else delete process.env.ADMIN_API_KEY;
  if (originalEnv.NEXT_PUBLIC_SA360_API_BASE_URL !== undefined) {
    process.env.NEXT_PUBLIC_SA360_API_BASE_URL = originalEnv.NEXT_PUBLIC_SA360_API_BASE_URL;
  } else {
    delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  }
});

const adminItem = {
  id: "ord_1",
  orderNumber: "LO-1001",
  clientAccountId: "acct_pacific",
  clientDisplayName: "Pacific Solar Co",
  status: "submitted",
  nicheKey: "Solar",
  states: ["AZ"],
  leadVolume: 100,
  campaignType: "Aged leads",
  crmPackage: "GHL Pro",
  aiVoiceAddon: false,
  deliveryDestinationLabel: "GHL",
  createdAt: "2026-08-27T12:00:00.000Z",
  submittedAt: "2026-08-27T12:00:00.000Z",
  paymentConfirmationStatus: "confirmed",
};

describe("lead-order review admin helpers", () => {
  it("POSTs confirm-payment to the PR #90 admin contract", async () => {
    enableAdminApi();
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ ok: true, item: adminItem }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { confirmLeadOrderPaymentAdmin } = await import("./lead-order-review-actions.ts");
    const result = await confirmLeadOrderPaymentAdmin("ord_1", "Operator");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.order.paymentConfirmationStatus, "confirmed");
      assert.equal(result.order.orderNumber, "LO-1001");
    }
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.url ?? "", /\/admin\/v1\/lead-orders\/ord_1\/confirm-payment$/);
  });

  it("preserves 409 payment_confirmation_required from approve", async () => {
    enableAdminApi();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "payment_confirmation_required",
          reasons: ["payment_confirmation_required"],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    const { approveLeadOrderAdmin } = await import("./lead-order-review-actions.ts");
    const result = await approveLeadOrderAdmin("ord_1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.code, "payment_confirmation_required");
      assert.deepEqual(result.reasons, ["payment_confirmation_required"]);
    }
  });

  it("marks payment not required on the dedicated admin route", async () => {
    enableAdminApi();
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          ok: true,
          item: { ...adminItem, paymentConfirmationStatus: "not_required" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const { markLeadOrderPaymentNotRequiredAdmin } = await import(
      "./lead-order-review-actions.ts"
    );
    const result = await markLeadOrderPaymentNotRequiredAdmin("ord_1", "Operator");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.order.paymentConfirmationStatus, "not_required");
    assert.match(calls[0] ?? "", /mark-payment-not-required$/);
  });
});
