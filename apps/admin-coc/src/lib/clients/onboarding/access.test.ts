import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

import { ADMIN_COC_ROLE_ADMIN, ADMIN_COC_ROLE_OBSERVER } from "../../admin-coc-observer-access.ts";
import { resolveAdminCocRouteGate } from "../../admin-coc-route-gate.ts";

const SECRET = "admin-coc-session-secret-32b";
const PAGE = "/clients/alex_gross/onboarding";

function gate(role: "admin" | "observer" | "portal" | "anonymous") {
  return resolveAdminCocRouteGate({
    pathname: PAGE,
    host: "admin.example",
    adminPasswordConfigured: true,
    hasAdminSession: role === "admin",
    adminSessionRole: role === "observer" ? ADMIN_COC_ROLE_OBSERVER : role === "admin" ? ADMIN_COC_ROLE_ADMIN : null,
    hasValidPortalSession: role === "portal",
    clientPortalLiveConfigured: true,
    frontOfficeDevPreview: false,
    portalAccessQuery: false,
    method: "GET",
  });
}

test("observers and portal users cannot open Setup & Delivery", () => {
  assert.equal(gate("admin").kind, "allow");
  assert.equal(gate("observer").kind, "forbidden");
  assert.equal(gate("portal").kind, "redirect");
  assert.equal(gate("anonymous").kind, "redirect");
});

test("onboarding actions reject an observer before any admin API call", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const session = await import("../../admin-coc-session.ts");
  const guard = await import("../../admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
  assert.ok(token);
  guard.useAdminCocTestSessionCookie(token);
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const actions = await import("../../../app/actions/client-onboarding-v2.ts");
    await assert.rejects(
      () => actions.searchOnboardingDriveAction("alex_gross", { scope: "approved_parent", query: "Alex" }),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    await assert.rejects(
      () => actions.previewOnboardingStoredLeadAction("alex_gross", { sourceLeadEventId: "evt_alex", destinations: ["google_sheets"] }),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("server actions do not call activation, captured delivery, or the admin key from the browser", () => {
  const files = [
    new URL("../../../app/actions/client-onboarding-v2.ts", import.meta.url),
    new URL("../../admin-api/client-onboarding-v2.ts", import.meta.url),
    new URL("../../../components/clients/onboarding/setup-delivery-workspace.tsx", import.meta.url),
    new URL("../../../components/clients/onboarding/test-console.tsx", import.meta.url),
    new URL("../../../components/clients/onboarding/activation-panel.tsx", import.meta.url),
    new URL("../../../components/clients/onboarding/integration-cards.tsx", import.meta.url),
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(source.includes("expectedRevision: 0"), false);
  assert.equal(source.includes("/onboarding/activate"), false);
  assert.equal(source.includes("captured_event_delivery"), false);
  assert.equal(source.includes("dispatch-activation"), false);
  assert.equal(source.includes("ADMIN_API_KEY"), false);
  assert.equal(source.includes("x-sa360-admin-key"), false);
  assert.equal(source.includes("NEXT_PUBLIC_"), false);
});

test("an admin replay posts the captured-event replay contract and not a delivery kind", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.ADMIN_API_KEY = "test-admin-key";
  delete process.env.SA360_ADMIN_API_KEY;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  const session = await import("../../admin-coc-session.ts");
  const guard = await import("../../admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN);
  assert.ok(token);
  guard.useAdminCocTestSessionCookie(token ?? undefined);
  const calls: { url: string; body: string; header: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      header: headers.get("x-sa360-admin-key"),
    });
    return new Response(
      JSON.stringify({
        ok: true,
        testRunId: "run_1",
        status: "previewed",
        kind: "captured_event_replay",
        persisted: true,
        warningCodes: [],
        attempts: [],
        preview: { sheet: null, noteBodySha256: null, noteContract: null },
        externalCalls: { providerWebhook: false, sheets: false, ghl: false },
        sourceDeliverySatisfied: false,
        downstreamExecuted: false,
        resendAuthorized: false,
        appendStartedAtCleared: false,
        locksCleared: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const actions = await import("../../../app/actions/client-onboarding-v2.ts");
    const result = await actions.previewOnboardingStoredLeadAction("alex_gross", {
      sourceLeadEventId: "evt_alex",
      destinations: ["google_sheets", "ghl_location_api"],
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.header, "test-admin-key");
    assert.match(calls[0]?.url ?? "", /\/onboarding\/test-runs$/);
    const body = JSON.parse(calls[0]?.body ?? "{}") as { kind?: string; execute?: boolean };
    assert.equal(body.kind, "captured_event_replay");
    assert.equal(body.execute, false);
    assert.equal(JSON.stringify(result).includes("test-admin-key"), false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("an active client destination is not replaced from this workspace", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.ADMIN_API_KEY = "test-admin-key";
  delete process.env.SA360_ADMIN_API_KEY;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  const session = await import("../../admin-coc-session.ts");
  const guard = await import("../../admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN);
  assert.ok(token);
  guard.useAdminCocTestSessionCookie(token ?? undefined);
  const calls: { method: string; url: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(input) });
    return new Response(
      JSON.stringify({
        ok: true,
        configured: true,
        dispatchFlagEnabled: true,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: null,
        agedDispatchEnabled: false,
        agedDispatchNotBefore: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const actions = await import("../../../app/actions/client-onboarding-v2.ts");
    const saved = await actions.saveOnboardingSheetsDestinationAction("existing_client", {
      spreadsheetId: "sheet_other",
      worksheetId: 4,
    });
    const bound = await actions.bindOnboardingCampaignWorksheetAction("existing_client", { worksheetId: 4 });
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.error, "active_destination_unchanged");
    assert.equal(bound.ok, false);
    if (!bound.ok) assert.equal(bound.error, "active_destination_unchanged");
    assert.equal(calls.every((call) => call.method === "GET" && call.url.includes("/google-sheets/dispatch")), true);
    assert.equal(calls.some((call) => call.method === "PUT" || call.method === "POST"), false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});
