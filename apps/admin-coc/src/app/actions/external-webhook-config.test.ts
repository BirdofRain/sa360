import assert from "node:assert/strict";
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
const ADMIN_KEY = "server-admin-key-not-for-browser";
const CLIENT = "harbor_benefits";
const REQUEST = "6f1e2d3c-4b5a-4678-89ab-cdef01234567";
const TOKEN = "path-token-harbor";
const HMAC = "hmac-secret-harbor";
const PRINCIPAL = "c123456789012345678901234";

type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };

test("admin can read, a manager can save disabled, and activation stays with the administrator", async () => {
  const previous = snapshotEnv();
  enableBridge();
  const audits: unknown[] = [];
  const bridge = await import("../../lib/team-workspace/external-webhook-bridge.ts");
  bridge.useExternalWebhookBridgeAuditSinkForTests((record) => audits.push(record));
  const seen = await withFetch(async (actions) => {
    const read = await actions.readExternalWebhookDestinationAction(CLIENT);
    assert.equal(read.ok, true);
    if (!read.ok || !read.status) return;
    assert.equal(read.status.hostname, "hooks.example.com");
    assert.equal(read.status.enabled, false);
    assert.equal(read.status.latestAttempt?.httpAccepted, true);
    assert.equal(read.status.latestAttempt?.provesCrmCreation, false);
    assert.equal(JSON.stringify(read).includes(TOKEN), false);
    assert.equal(JSON.stringify(read).includes(ADMIN_KEY), false);

    const guard = await import("../../lib/admin-coc-session-guard.ts");
    const staff = await import("../../lib/staff-admin-coc-access.ts");
    guard.useAdminCocTestSessionCookie(undefined);
    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_manager"],
      staffPrincipalId: PRINCIPAL,
    });
    const saved = await actions.saveExternalWebhookDestinationAction(saveInput());
    assert.equal(saved.ok, true);
    if (!saved.ok || !saved.status) return;
    assert.equal(saved.status.enabled, false);
    assert.equal(saved.replayed, false);
    assert.equal(JSON.stringify(saved).includes(TOKEN), false);
    assert.equal(JSON.stringify(saved).includes(HMAC), false);
    assert.equal(JSON.stringify(saved).includes(ADMIN_KEY), false);

    const replay = await actions.saveExternalWebhookDestinationAction(saveInput());
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.replayed, true);
    const preflight = await actions.preflightExternalWebhookDestinationAction(preflightInput());
    assert.equal(preflight.ok, true);
    if (preflight.ok && preflight.preflight) {
      assert.equal(preflight.preflight.postsLead, false);
      assert.equal(preflight.preflight.canaryImplemented, false);
    }
    assert.equal(JSON.stringify(preflight).includes(TOKEN), false);

    staff.useStaffCapabilitiesTestResult(undefined);
    const session = await import("../../lib/admin-coc-session.ts");
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
    const activated = await actions.activateExternalWebhookDestinationAction({
      clientAccountId: CLIENT,
      requestId: REQUEST,
      expectedRevision: 1,
    });
    assert.equal(activated.ok, true);
    if (activated.ok && activated.status) assert.equal(activated.status.enabled, true);
    const deactivated = await actions.deactivateExternalWebhookDestinationAction({
      clientAccountId: CLIENT,
      requestId: REQUEST,
      expectedRevision: 2,
    });
    assert.equal(deactivated.ok, true);
    if (deactivated.ok && deactivated.status) assert.equal(deactivated.status.enabled, false);
  }, routeResponses());
  const save = seen.find((call) => call.method === "PUT" && call.url.endsWith("/external-webhook"));
  assert.ok(save);
  assert.equal(save?.headers["x-sa360-admin-key"], ADMIN_KEY);
  assert.equal(save?.headers["x-sa360-workspace-key"], undefined);
  assert.equal(save?.headers["x-sa360-admin-role"], undefined);
  assert.equal(save?.headers["x-sa360-client-portal-key"], undefined);
  const saveBody = JSON.parse(save?.body ?? "{}") as { enabled?: boolean; endpointUrl?: string };
  assert.equal(saveBody.enabled, undefined);
  assert.equal(saveBody.endpointUrl?.includes(TOKEN), true);
  const activation = seen.find((call) => call.url.endsWith("/activation"));
  assert.equal(JSON.parse(activation?.body ?? "{}").enabled, true);
  assert.equal(seen.some((call) => call.url.includes("company-sheets")), false);
  assert.equal(seen.some((call) => call.url.includes("ghl-destination")), false);
  assert.equal(JSON.stringify(audits).includes(TOKEN), false);
  assert.equal(JSON.stringify(audits).includes(HMAC), false);
  assert.equal(JSON.stringify(audits).includes(ADMIN_KEY), false);
  bridge.useExternalWebhookBridgeAuditSinkForTests(undefined);
  restoreEnv(previous);
});

test("workspace, operations, observer, portal, anonymous, and limited sessions cannot write", async () => {
  const previous = snapshotEnv();
  enableBridge();
  const seen = await withFetch(async (actions) => {
    const guard = await import("../../lib/admin-coc-session-guard.ts");
    const staff = await import("../../lib/staff-admin-coc-access.ts");
    const session = await import("../../lib/admin-coc-session.ts");
    guard.useAdminCocTestSessionCookie(undefined);

    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace"],
      staffPrincipalId: PRINCIPAL,
    });
    const read = await actions.readExternalWebhookDestinationAction(CLIENT);
    assert.equal(read.ok, true);
    await assert.rejects(() => actions.saveExternalWebhookDestinationAction(saveInput()), (error: unknown) => {
      assert.equal((error as { name?: string }).name, "AdminCocForbiddenError");
      return true;
    });
    await assert.rejects(() => actions.preflightExternalWebhookDestinationAction(preflightInput()));

    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_operations"],
      staffPrincipalId: PRINCIPAL,
    });
    await assert.rejects(() => actions.saveExternalWebhookDestinationAction(saveInput()));
    await assert.rejects(() => actions.activateExternalWebhookDestinationAction({
      clientAccountId: CLIENT,
      requestId: REQUEST,
      expectedRevision: 1,
    }));

    staff.useStaffCapabilitiesTestResult(undefined);
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER") ?? undefined);
    await assert.rejects(() => actions.saveExternalWebhookDestinationAction(saveInput()));
    await assert.rejects(() => actions.readExternalWebhookDestinationAction(CLIENT));

    guard.useAdminCocTestSessionCookie("portal-session");
    await assert.rejects(() => actions.readExternalWebhookDestinationAction(CLIENT));

    guard.useAdminCocTestSessionCookie(undefined);
    staff.useStaffCapabilitiesTestResult({ access: "anonymous", permissions: [], staffPrincipalId: null });
    await assert.rejects(() => actions.readExternalWebhookDestinationAction(CLIENT));
    staff.useStaffCapabilitiesTestResult({ access: "limited", permissions: [], staffPrincipalId: PRINCIPAL });
    await assert.rejects(() => actions.saveExternalWebhookDestinationAction(saveInput()));
  }, routeResponses());
  assert.equal(seen.some((call) => call.method === "PUT"), false);
  assert.equal(seen.some((call) => call.method === "POST"), false);
  restoreEnv(previous);
});

test("a stale revision, a primary CRM conflict, and a bad client do not echo secrets", async () => {
  const previous = snapshotEnv();
  enableBridge();
  const seen = await withFetch(async (actions) => {
    const stale = await actions.saveExternalWebhookDestinationAction({ ...saveInput(), expectedRevision: 4 });
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.code, "revision_conflict");
      assert.equal(stale.needsReload, true);
    }
    const conflict = await actions.activateExternalWebhookDestinationAction({
      clientAccountId: CLIENT,
      requestId: REQUEST,
      expectedRevision: 1,
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) {
      assert.equal(conflict.code, "primary_crm_conflict");
      assert.equal(conflict.message.includes(TOKEN), false);
    }
    const wrong = await actions.readExternalWebhookDestinationAction("../metrics");
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.code, "INVALID_CLIENT");
    const mismatch = await actions.readExternalWebhookDestinationAction("other_client");
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "client_mismatch");
    const spoofed = await actions.saveExternalWebhookDestinationAction({
      ...saveInput(),
      ...({ headers: { "x-sa360-admin-key": "spoofed", "x-sa360-admin-role": "SA360_OBSERVER" } } as object),
    } as ReturnType<typeof saveInput>);
    assert.equal(spoofed.ok, true);
    assert.equal(JSON.stringify(spoofed).includes("spoofed"), false);
  }, (call) => {
    if (call.url.endsWith("/other_client/external-webhook")) {
      return json({ ...statusBody(), clientAccountId: "harbor_benefits" }, 200);
    }
    if (call.method === "PUT" && call.url.endsWith("/activation")) {
      return json({ ok: false, error: "primary_crm_conflict", endpointUrl: `https://hooks.example.com/${TOKEN}` }, 409);
    }
    if (call.method === "PUT" && call.body?.includes("\"expectedRevision\":4")) {
      return json({ ok: false, error: "revision_conflict", signingSecret: HMAC }, 409);
    }
    return routeResponses()(call);
  });
  assert.equal(seen.some((call) => call.url.includes("/../")), false);
  assert.equal(seen.find((call) => call.method === "PUT")?.headers["x-sa360-admin-key"], ADMIN_KEY);
  assert.equal(seen.some((call) => call.url.includes("ghl") || call.url.includes("sheets")), false);
  restoreEnv(previous);
});

test("the bridge flag blocks every operation before a customer call", async () => {
  const previous = snapshotEnv();
  enableBridge();
  delete process.env.SA360_EXTERNAL_WEBHOOK_CONFIG_BRIDGE_ENABLED;
  const seen = await withFetch(async (actions) => {
    const read = await actions.readExternalWebhookDestinationAction(CLIENT);
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.code, "FEATURE_DISABLED");
    const saved = await actions.saveExternalWebhookDestinationAction(saveInput());
    assert.equal(saved.ok, false);
    const activated = await actions.activateExternalWebhookDestinationAction({
      clientAccountId: CLIENT,
      requestId: REQUEST,
      expectedRevision: 1,
    });
    assert.equal(activated.ok, false);
  }, () => json(statusBody(), 200));
  assert.equal(seen.length, 0);
  restoreEnv(previous);
});

function saveInput() {
  return {
    clientAccountId: CLIENT,
    requestId: REQUEST,
    expectedRevision: 0,
    kind: "external_https" as const,
    authMode: "hmac_sha256" as const,
    endpointUrl: `https://hooks.example.com/${TOKEN}`,
    signingSecret: HMAC,
  };
}

function preflightInput() {
  return {
    clientAccountId: CLIENT,
    expectedRevision: 0,
    kind: "ghl_inbound" as const,
    authMode: "none" as const,
    endpointUrl: `https://hooks.example.com/${TOKEN}`,
  };
}

function statusBody(enabled = false, revision = 1) {
  return {
    ok: true,
    clientAccountId: CLIENT,
    present: true,
    kind: "external_https",
    authMode: "hmac_sha256",
    hostname: "hooks.example.com",
    enabled,
    revision,
    configurationValid: true,
    primaryCrmConflict: false,
    endpointUrl: `https://hooks.example.com/${TOKEN}`,
    signingSecret: HMAC,
    latestAttempt: {
      state: "attempted",
      outcome: "http_accepted",
      httpStatus: 204,
      httpAccepted: true,
      provesCrmCreation: true,
    },
  };
}

function routeResponses(): (call: Call) => Response {
  let saves = 0;
  return (call) => {
    if (call.method === "POST" && call.url.endsWith("/preflight")) {
      return json({
        ok: true,
        postsLead: false,
        hostname: "hooks.example.com",
        endpointValid: true,
        endpointCode: null,
        authValid: true,
        authCode: null,
        credentialsReady: true,
        primaryCrmConflict: false,
        currentRevision: 0,
        revisionMatches: true,
        canary: { implemented: false, consumerLeadData: false, postsLead: false },
        endpointUrl: `https://hooks.example.com/${TOKEN}`,
      });
    }
    if (call.method === "PUT" && call.url.endsWith("/activation")) {
      const enabled = call.body?.includes("\"enabled\":true") === true;
      return json({ ...statusBody(enabled, enabled ? 2 : 3), replayed: false });
    }
    if (call.method === "PUT") {
      saves += 1;
      return json({ ...statusBody(false, 1), replayed: saves > 1 });
    }
    return json(statusBody(false, 1));
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function enableBridge() {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_EXTERNAL_WEBHOOK_CONFIG_BRIDGE_ENABLED = "true";
}

function snapshotEnv() {
  return {
    ADMIN_COC_PASSWORD: process.env.ADMIN_COC_PASSWORD,
    ADMIN_COC_SESSION_SECRET: process.env.ADMIN_COC_SESSION_SECRET,
    NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
    SA360_ADMIN_API_KEY: process.env.SA360_ADMIN_API_KEY,
    SA360_EXTERNAL_WEBHOOK_CONFIG_BRIDGE_ENABLED: process.env.SA360_EXTERNAL_WEBHOOK_CONFIG_BRIDGE_ENABLED,
  };
}

function restoreEnv(previous: ReturnType<typeof snapshotEnv>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withFetch<T>(
  work: (actions: typeof import("./external-webhook-config.ts")) => Promise<T>,
  respond: (call: Call) => Response
): Promise<Call[]> {
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const staff = await import("../../lib/staff-admin-coc-access.ts");
  const actions = await import("./external-webhook-config.ts");
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
    await work(actions);
    return calls;
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision(undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
  }
}
