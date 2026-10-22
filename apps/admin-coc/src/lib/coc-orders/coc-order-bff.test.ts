import assert from "node:assert/strict";
import module from "node:module";
import { afterEach, test } from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SECRET = "admin-coc-session-secret-32b";
const originalFetch = globalThis.fetch;
const originalEnv = {
  ADMIN_COC_PASSWORD: process.env.ADMIN_COC_PASSWORD,
  ADMIN_COC_SESSION_SECRET: process.env.ADMIN_COC_SESSION_SECRET,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  SA360_ADMIN_API_KEY: process.env.SA360_ADMIN_API_KEY,
  NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
};

function restoreEnv(key: keyof typeof originalEnv) {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  const { useAdminCocTestSessionCookie } = await import("../admin-coc-session-guard.ts");
  useAdminCocTestSessionCookie(undefined);
  restoreEnv("ADMIN_COC_PASSWORD");
  restoreEnv("ADMIN_COC_SESSION_SECRET");
  restoreEnv("ADMIN_API_KEY");
  restoreEnv("SA360_ADMIN_API_KEY");
  restoreEnv("NEXT_PUBLIC_SA360_API_BASE_URL");
  globalThis.fetch = originalFetch;
});

function enableGate() {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.ADMIN_API_KEY = "test-admin-key";
  delete process.env.SA360_ADMIN_API_KEY;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.com";
}

const adminItem = {
  id: "ord_1",
  orderNumber: "LO-1001",
  clientAccountId: "acct_pacific",
  clientDisplayName: "Pacific Solar Co",
  status: "ready",
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

test("COC approve reuses the admin approve route and records no observer call", async () => {
  enableGate();
  const session = await import("../admin-coc-session.ts");
  const { useAdminCocTestSessionCookie } = await import("../admin-coc-session-guard.ts");
  const { ADMIN_COC_ROLE_ADMIN } = await import("../admin-coc-observer-access.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN);
  assert.ok(token);
  useAdminCocTestSessionCookie(token ?? undefined);

  const calls: { url: string; method: string; body: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(JSON.stringify({ ok: true, item: adminItem }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const { POST } = await import("../../app/api/coc/orders/[id]/approve/route.ts");
  const response = await POST(new Request("http://localhost/api/coc/orders/ord_1/approve"), {
    params: Promise.resolve({ id: "ord_1" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; order: { status: string } };
  assert.equal(body.ok, true);
  assert.equal(body.order.status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.url ?? "", /\/admin\/v1\/lead-orders\/ord_1\/approve$/);
});

test("COC confirm-payment and mark-not-required reuse the existing admin operations", async () => {
  enableGate();
  const session = await import("../admin-coc-session.ts");
  const { useAdminCocTestSessionCookie } = await import("../admin-coc-session-guard.ts");
  const { ADMIN_COC_ROLE_ADMIN } = await import("../admin-coc-observer-access.ts");
  useAdminCocTestSessionCookie(
    session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN) ?? undefined
  );
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)} ${typeof init?.body === "string" ? init.body : ""}`);
    return new Response(JSON.stringify({ ok: true, item: adminItem }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const confirm = await import("../../app/api/coc/orders/[id]/confirm-payment/route.ts");
  const mark = await import("../../app/api/coc/orders/[id]/mark-payment-not-required/route.ts");
  const params = { params: Promise.resolve({ id: "ord_1" }) };
  assert.equal(
    (
      await confirm.POST(new Request("http://localhost/api/coc/orders/ord_1/confirm-payment"), params)
    ).status,
    200
  );
  assert.equal(
    (
      await mark.POST(
        new Request("http://localhost/api/coc/orders/ord_1/mark-payment-not-required"),
        params
      )
    ).status,
    200
  );
  assert.match(calls[0] ?? "", /POST .*\/confirm-payment .*Admin C\.O\.C\./);
  assert.match(calls[1] ?? "", /POST .*\/mark-payment-not-required .*Admin C\.O\.C\./);
});

test("anonymous and observer sessions are rejected before the admin API", async () => {
  enableGate();
  const session = await import("../admin-coc-session.ts");
  const { useAdminCocTestSessionCookie } = await import("../admin-coc-session-guard.ts");
  const { ADMIN_COC_ROLE_OBSERVER } = await import("../admin-coc-observer-access.ts");
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  const { POST } = await import("../../app/api/coc/orders/[id]/approve/route.ts");
  const { GET } = await import("../../app/api/coc/orders/route.ts");
  const { PATCH } = await import("../../app/api/coc/orders/[id]/route.ts");

  useAdminCocTestSessionCookie("");
  const anon = await POST(new Request("http://localhost/api/coc/orders/ord_1/approve"), {
    params: Promise.resolve({ id: "ord_1" }),
  });
  assert.equal(anon.status, 401);

  useAdminCocTestSessionCookie(
    session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER) ?? undefined
  );
  const observer = await GET();
  assert.equal(observer.status, 403);
  const activation = await PATCH(
    new Request("http://localhost/api/coc/orders/ord_1", {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    }),
    { params: Promise.resolve({ id: "ord_1" }) }
  );
  assert.equal(activation.status, 403);
  assert.equal(calls.length, 0);
});

test("an admin activation attempt on the COC order route does not call the admin API", async () => {
  enableGate();
  const session = await import("../admin-coc-session.ts");
  const { useAdminCocTestSessionCookie } = await import("../admin-coc-session-guard.ts");
  const { ADMIN_COC_ROLE_ADMIN } = await import("../admin-coc-observer-access.ts");
  useAdminCocTestSessionCookie(
    session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN) ?? undefined
  );
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  const { PATCH } = await import("../../app/api/coc/orders/[id]/route.ts");
  const response = await PATCH(
    new Request("http://localhost/api/coc/orders/ord_1", {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    }),
    { params: Promise.resolve({ id: "ord_1" }) }
  );
  assert.equal(response.status, 409);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, "activation_requires_fulfillment_ops");
  assert.equal(calls.length, 0);
});
