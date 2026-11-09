import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SECRET = "admin-coc-session-secret-32b";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

test("the guided actions only call the existing client and setup-request writes", () => {
  const source = readFileSync(new URL("./team-workspace-onboarding.ts", import.meta.url), "utf8");
  assert.equal(source.includes("save_draft"), true);
  assert.equal(source.includes("intent: \"submit\""), false);
  assert.equal(source.includes("ghl-destination"), false);
  assert.equal(source.includes("routing/rules"), false);
  assert.equal(source.includes("deliveryEnabled"), false);
  assert.equal(source.includes("campaignDispatch"), false);
  assert.equal(source.includes("portal-invite"), false);
  assert.equal(source.includes("source-funnels"), false);
});

test("an observer cannot create, update, or save, and an admin save stays a draft", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-onboarding.ts");
  const calls: { url: string; method: string; body: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url: String(input), method: init?.method ?? "GET", body });
    const payload = body ? (JSON.parse(body) as { intent?: string }) : {};
    if (payload.intent) {
      return json({
        ok: true,
        replayed: false,
        item: {
          status: "draft",
          revision: 3,
          repairRequired: false,
          missingRequiredFields: ["destinationChoice"],
          data: payload,
          operationalEffects: false,
        },
      });
    }
    return json({
      ok: true,
      item: {
        clientAccountId: "alex_gross",
        clientDisplayName: "Alex Gross",
        status: "onboarding",
        portalLoginEmail: "hidden@example.com",
      },
    });
  }) as typeof fetch;

  try {
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    await assert.rejects(() => actions.createGuidedClientAction({ clientAccountId: "alex_gross", clientDisplayName: "Alex", primaryNicheKeys: [], primaryProductTypes: [] }), guard.AdminCocForbiddenError);
    await assert.rejects(
      () =>
        actions.saveGuidedSetupAction({
          clientAccountId: "alex_gross",
          data: { destinationChoice: "both" },
          requestId: REQUEST_ID,
          expectedRevision: 1,
        }),
      guard.AdminCocForbiddenError
    );
    assert.equal(calls.length, 0);

    const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    const created = await actions.createGuidedClientAction({
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      primaryNicheKeys: ["VET"],
      primaryProductTypes: ["final_expense"],
    });
    assert.equal(created.ok, true);
    assert.equal(JSON.stringify(created).includes("hidden@example.com"), false);
    const createBody = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    assert.equal(calls[0]?.method, "POST");
    assert.equal(createBody.status, "onboarding");
    assert.equal("portalEnabled" in createBody, false);
    assert.equal("deliveryEnabled" in createBody, false);

    const updated = await actions.updateGuidedClientAction({
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      status: "paused",
      primaryNicheKeys: ["VET"],
      primaryProductTypes: [],
    });
    assert.equal(updated.ok, true);
    const updateBody = JSON.parse(calls[1]?.body ?? "{}") as Record<string, unknown>;
    assert.equal(calls[1]?.method, "PATCH");
    assert.equal(updateBody.status, "paused");
    assert.deepEqual(Object.keys(updateBody).sort(), ["clientDisplayName", "primaryNicheKeys", "primaryProductTypes", "status"]);

    const saved = await actions.saveGuidedSetupAction({
      clientAccountId: "alex_gross",
      data: { destinationChoice: "both", clientEmail: "alex@example.com", deliveryEnabled: true } as never,
      requestId: REQUEST_ID,
      expectedRevision: 2,
    });
    assert.equal(saved.ok, true);
    if (saved.ok) assert.equal(saved.replayed, false);
    const setupBody = JSON.parse(calls[2]?.body ?? "{}") as { intent?: string; data?: Record<string, unknown>; expectedRevision?: number };
    assert.equal(calls[2]?.method, "PATCH");
    assert.match(calls[2]?.url ?? "", /\/admin\/v1\/clients\/alex_gross\/setup$/);
    assert.equal(setupBody.intent, "save_draft");
    assert.equal(setupBody.expectedRevision, 2);
    assert.equal(setupBody.data?.destinationChoice, "both");
    assert.equal(setupBody.data?.deliveryEnabled, undefined);

    calls.length = 0;
    globalThis.fetch = (async () =>
      json({ ok: false, code: "STALE_WRITE", error: "This setup changed after it was loaded." }, 409)) as typeof fetch;
    const stale = await actions.saveGuidedSetupAction({
      clientAccountId: "alex_gross",
      data: { clientEmail: "alex@example.com" },
      requestId: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 2,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "STALE_WRITE");

    delete process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED;
    const disabled = await actions.saveGuidedSetupAction({
      clientAccountId: "alex_gross",
      data: {},
      requestId: REQUEST_ID,
      expectedRevision: 0,
    });
    assert.equal(disabled.ok, false);
    if (!disabled.ok) assert.equal(disabled.code, "FEATURE_DISABLED");
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("a turned-off Team Workspace gate does not write, and an observer is still denied", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-onboarding.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return json({ ok: true, item: { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross" } });
  }) as typeof fetch;
  const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
  const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
  try {
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
    await assert.rejects(
      () => actions.createGuidedClientAction({ clientAccountId: "alex_gross", clientDisplayName: "Alex", primaryNicheKeys: [], primaryProductTypes: [] }),
      guard.AdminCocForbiddenError
    );
    await assert.rejects(
      () => actions.updateGuidedClientAction({ clientAccountId: "alex_gross", clientDisplayName: "Alex", status: "onboarding", primaryNicheKeys: [], primaryProductTypes: [] }),
      guard.AdminCocForbiddenError
    );
    await assert.rejects(
      () => actions.saveGuidedSetupAction({ clientAccountId: "alex_gross", data: {}, requestId: REQUEST_ID, expectedRevision: 0 }),
      guard.AdminCocForbiddenError
    );
    assert.equal(calls.length, 0);

    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    for (const value of [undefined, "TRUE", "1", "yes", "false"]) {
      if (value === undefined) delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
      else process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = value;
      const created = await actions.createGuidedClientAction({
        clientAccountId: "alex_gross",
        clientDisplayName: "Alex Gross",
        primaryNicheKeys: [],
        primaryProductTypes: [],
      });
      const updated = await actions.updateGuidedClientAction({
        clientAccountId: "alex_gross",
        clientDisplayName: "Alex Gross",
        status: "onboarding",
        primaryNicheKeys: [],
        primaryProductTypes: [],
      });
      const saved = await actions.saveGuidedSetupAction({
        clientAccountId: "alex_gross",
        data: {},
        requestId: REQUEST_ID,
        expectedRevision: 0,
      });
      assert.equal(created.ok, false, String(value));
      assert.equal(updated.ok, false, String(value));
      assert.equal(saved.ok, false, String(value));
      if (!created.ok) assert.equal(created.code, "FEATURE_DISABLED");
      if (!saved.ok) assert.equal(saved.code, "FEATURE_DISABLED");
      assert.equal(calls.length, 0, String(value));
    }
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("an uncertain create checks the existing client once and does not post again", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-onboarding.ts");
  const calls: { method: string; url: string }[] = [];
  const original = globalThis.fetch;
  let postMode: "transport" | "conflict" | "throw" = "transport";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    calls.push({ method, url });
    if (method === "GET") {
      return json({ ok: false, error: "not found" }, 404);
    }
    if (postMode === "conflict") {
      return json({ ok: false, code: "CONFLICT", error: "That client account ID is already in use. Choose a different ID." }, 409);
    }
    throw new Error("socket closed");
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
    const missed = await actions.createGuidedClientAction({
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      primaryNicheKeys: [],
      primaryProductTypes: [],
    });
    assert.equal(missed.ok, false);
    if (!missed.ok) assert.equal(missed.code, "UNCERTAIN");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.method === "GET").length, 1);

    calls.length = 0;
    postMode = "conflict";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(input) });
      if (method === "GET") {
        return json({ ok: true, item: { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" } });
      }
      return json({ ok: false, code: "CONFLICT", error: "That client account ID is already in use. Choose a different ID." }, 409);
    }) as typeof fetch;
    const adopted = await actions.createGuidedClientAction({
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      primaryNicheKeys: [],
      primaryProductTypes: [],
    });
    assert.equal(adopted.ok, true);
    if (adopted.ok) assert.equal(adopted.clientAccountId, "alex_gross");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);

    calls.length = 0;
    const broken = await actions.createGuidedClientAction({
      clientAccountId: 12,
      clientDisplayName: "Alex Gross",
      primaryNicheKeys: [],
      primaryProductTypes: [],
    } as never);
    assert.equal(broken.ok, false);
    if (!broken.ok) assert.equal(broken.code, "UNCERTAIN");
    assert.equal(calls.length, 0);

    calls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(input) });
      if ((init?.method ?? "GET") === "PATCH" && String(input).endsWith("/setup")) {
        return new Response("", { status: 503, headers: { "content-type": "text/html" } });
      }
      return json({ ok: true, item: { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" } });
    }) as typeof fetch;
    const setup = await actions.saveGuidedSetupAction({
      clientAccountId: "alex_gross",
      data: { destinationChoice: "ghl" },
      requestId: REQUEST_ID,
      expectedRevision: 2,
    });
    assert.equal(setup.ok, false);
    if (!setup.ok) assert.equal(setup.code, "UNCERTAIN");
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);

    calls.length = 0;
    globalThis.fetch = (async () => {
      calls.push({ method: "PATCH", url: "update" });
      throw new Error("socket closed");
    }) as typeof fetch;
    const updated = await actions.updateGuidedClientAction({
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      status: "onboarding",
      primaryNicheKeys: [],
      primaryProductTypes: [],
    });
    assert.equal(updated.ok, false);
    if (!updated.ok) assert.equal(updated.code, "UNCERTAIN");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

function snapshotEnv(): Record<string, string | undefined> {
  return {
    ADMIN_COC_PASSWORD: process.env.ADMIN_COC_PASSWORD,
    ADMIN_COC_SESSION_SECRET: process.env.ADMIN_COC_SESSION_SECRET,
    NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
    SA360_ADMIN_API_KEY: process.env.SA360_ADMIN_API_KEY,
    SA360_NATIVE_CLIENT_SETUP_ENABLED: process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED,
    NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED: process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED,
  };
}

function restoreEnv(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
