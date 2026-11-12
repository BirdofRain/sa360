import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

import { signStaffAssertion, verifyStaffAssertion } from "@sa360/shared/staff-assertion";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SESSION_SECRET = "admin-coc-session-secret-32b";
const ASSERTION_SECRET = "admin-coc-onboarding-actor-secret-32";
const PRINCIPAL = "c123456789012345678901234";
const SETUP = "/admin/v1/clients/alex_gross/setup";

test("named staff onboarding writes carry a server assertion and shared admin does not", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SESSION_SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.SA360_STAFF_ASSERTION_SECRET = ASSERTION_SECRET;
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const staff = await import("../staff-admin-coc-access.ts");
  const api = await import("./server.ts");
  const calls: Array<{ url: string; method: string; headers: Headers; body: string | null }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(JSON.stringify({ ok: true, item: { revision: 1 } }), { status: 200 });
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("workspace");
    const manager = await api.adminRequestJson("PATCH", SETUP, { setupOwner: "Browser Name", intent: "save_draft" });
    assert.equal(manager.ok, true);
    const managerCall = calls[0];
    assert.ok(managerCall);
    const assertion = managerCall.headers.get("x-sa360-staff-assertion");
    assert.ok(assertion);
    const verified = verifyStaffAssertion(assertion, { secret: ASSERTION_SECRET });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.claims.sub, PRINCIPAL);
    assert.equal(managerCall.headers.get("x-sa360-admin-actor"), null);
    assert.equal(managerCall.body?.includes("Browser Name"), true);
    assert.equal(managerCall.body?.includes("\"actor\""), false);

    guard.useStaffAdminCocTestDecision("admin");
    await api.adminRequestJson("POST", "/admin/v1/clients/alex_gross/source-campaign-requests", { intent: "request" });
    const adminCall = calls[1];
    assert.ok(adminCall);
    const adminAssertion = verifyStaffAssertion(adminCall.headers.get("x-sa360-staff-assertion") ?? "", {
      secret: ASSERTION_SECRET,
    });
    assert.equal(adminAssertion.ok, true);
    if (adminAssertion.ok) assert.equal(adminAssertion.claims.sub, PRINCIPAL);

    const adminCookie = session.createAdminCocSessionToken(undefined, SESSION_SECRET, "ADMIN");
    guard.useStaffAdminCocTestDecision(undefined);
    guard.useAdminCocTestSessionCookie(adminCookie ?? undefined);
    await api.adminRequestJson("POST", "/admin/v1/clients/alex_gross/ghl-destination-configuration", {});
    assert.equal(calls[2]?.headers.get("x-sa360-staff-assertion"), null);

    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("workspace");
    await api.adminRequestJson("GET", SETUP);
    assert.equal(calls[3]?.headers.get("x-sa360-staff-assertion"), null);

    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_operations"],
      staffPrincipalId: PRINCIPAL,
    });
    calls.length = 0;
    const operations = await api.adminRequestJson("POST", "/admin/v1/clients/alex_gross/company-sheets-destination-configuration", {});
    assert.equal(operations.ok, false);
    if (!operations.ok) assert.equal(operations.status, 403);
    assert.equal(calls.length, 0);

    const observer = session.createAdminCocSessionToken(undefined, SESSION_SECRET, "SA360_OBSERVER");
    staff.useStaffCapabilitiesTestResult(undefined);
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    const observerWrite = await api.adminRequestJson("PATCH", SETUP, {});
    assert.equal(observerWrite.ok, false);
    if (!observerWrite.ok) assert.equal(observerWrite.status, 403);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useStaffAdminCocTestDecision(undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("a named staff write fails closed when the assertion cannot be minted", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SESSION_SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  delete process.env.SA360_STAFF_ASSERTION_SECRET;
  const guard = await import("../admin-coc-session-guard.ts");
  const api = await import("./server.ts");
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("workspace");
    const result = await api.adminRequestJson("PATCH", SETUP, { intent: "save_draft" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
    guard.useStaffAdminCocTestDecision(undefined);
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("a browser assertion header cannot replace the server-minted token", async () => {
  const actor = await import("./onboarding-actor.ts");
  const browser = signStaffAssertion({
    staffPrincipalId: "cabcdefghijklmnopqrstuvwx",
    secret: ASSERTION_SECRET,
  }).token;
  const minted = actor.mintNamedStaffOnboardingHeader(PRINCIPAL, {
    SA360_STAFF_ASSERTION_SECRET: ASSERTION_SECRET,
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const headers = actor.applyNamedStaffAssertionHeader(
    {
      "X-Sa360-Staff-Assertion": browser,
      Accept: "application/json",
    },
    minted
  );
  assert.equal(headers[minted.name], minted.value);
  assert.equal(Object.keys(headers).some((name) => name !== minted.name && name.toLowerCase() === minted.name), false);
  const verified = verifyStaffAssertion(headers[minted.name] ?? "", { secret: ASSERTION_SECRET });
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.claims.sub, PRINCIPAL);
});

function snapshotEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function restoreEnv(previous: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in previous)) delete process.env[key];
  }
  Object.assign(process.env, previous);
}
