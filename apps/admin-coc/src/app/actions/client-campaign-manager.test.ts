import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

import { verifyStaffAssertion } from "@sa360/shared/staff-assertion";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SECRET = "admin-coc-session-secret-32b";
const ASSERTION_SECRET = "admin-coc-campaign-manager-secret-32";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT = "client_123";
const CAMPAIGN = "c111111111111111111111111";
const PRINCIPAL = "c123456789012345678901234";

test("observers, portal sessions, and a closed registry do not call the campaign API", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./client-campaign-manager.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return json({ ok: false }, 500);
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision(undefined);
    await assert.rejects(() => actions.createClientCampaignAction(createInput()));
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    await assert.rejects(() => actions.updateClientCampaignAction(updateInput()), guard.AdminCocForbiddenError);
    assert.equal(calls.length, 0);

    const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    delete process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED;
    const disabled = await actions.createClientCampaignAction(createInput());
    assert.equal(disabled.stored, false);
    assert.equal(disabled.code, "client_campaign_registry_disabled");
    assert.match(disabled.message, /Nothing was saved/);
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";
    delete process.env.NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED;
    const interfaceOff = await actions.saveClientCampaignBindingsAction(bindingInput());
    assert.equal(interfaceOff.stored, false);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision(undefined);
    restoreEnv(previous);
  }
});

test("workspace readers and operations staff cannot mutate campaigns", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const staff = await import("../../lib/staff-admin-coc-access.ts");
  const actions = await import("./client-campaign-manager.ts");
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return json(savedBody(), 200);
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_operations"],
      staffPrincipalId: PRINCIPAL,
    });
    await assert.rejects(() => actions.saveClientCampaignDestinationAction(destinationInput()), guard.AdminCocForbiddenError);
    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace"],
      staffPrincipalId: PRINCIPAL,
    });
    await assert.rejects(() => actions.createClientCampaignAction(createInput()), guard.AdminCocForbiddenError);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
    restoreEnv(previous);
  }
});

test("a named staff write carries an assertion and does not fall back to admin", async () => {
  const previous = snapshotEnv();
  enableFlags();
  process.env.SA360_STAFF_ASSERTION_SECRET = ASSERTION_SECRET;
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./client-campaign-manager.ts");
  const calls: Array<{ method: string; url: string; headers: Headers; body: Record<string, unknown> | null }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    return json(savedBody(), 200);
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("workspace");
    const saved = await actions.updateClientCampaignAction(updateInput());
    assert.equal(saved.stored, true);
    assert.equal(saved.revision, 2);
    const call = calls[0];
    assert.equal(call?.method, "POST");
    assert.match(call?.url ?? "", /\/campaigns\/c111111111111111111111111$/);
    assert.equal(call?.body?.intent, "update");
    assert.equal(call?.body?.expectedRevision, 4);
    assert.equal(call?.body?.requestId, REQUEST_ID);
    const verified = verifyStaffAssertion(call?.headers.get("x-sa360-staff-assertion") ?? "", { secret: ASSERTION_SECRET });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.claims.sub, PRINCIPAL);

    delete process.env.SA360_STAFF_ASSERTION_SECRET;
    const blocked = await actions.updateClientCampaignAction(updateInput());
    assert.equal(blocked.stored, false);
    assert.equal(blocked.ok, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
    guard.useStaffAdminCocTestDecision(undefined);
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("a failed save is not reported as stored and an identical retry keeps the request", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./client-campaign-manager.ts");
  const bodies: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
    return json({ ok: false, error: "revision_conflict", replayed: false, ...flags() }, 409);
  }) as typeof fetch;
  try {
    const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    const first = await actions.updateClientCampaignAction(updateInput());
    const second = await actions.updateClientCampaignAction(updateInput());
    assert.equal(first.stored, false);
    assert.equal(first.uncertain, false);
    assert.equal(first.retainRequestId, true);
    assert.equal(first.code, "revision_conflict");
    assert.equal(second.retainRequestId, true);
    assert.equal((bodies[0] as { requestId?: string }).requestId, REQUEST_ID);
    assert.equal((bodies[1] as { requestId?: string }).requestId, REQUEST_ID);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("network uncertainty does not mark a campaign saved", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./client-campaign-manager.ts");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => json({ ok: true }, 503)) as typeof fetch;
  try {
    const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    const result = await actions.createClientCampaignAction(createInput());
    assert.equal(result.ok, false);
    assert.equal(result.stored, false);
    assert.equal(result.uncertain, true);
    assert.equal(result.retainRequestId, true);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

function enableFlags(): void {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED = "true";
  process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";
}

function createInput() {
  return {
    clientAccountId: CLIENT,
    requestId: REQUEST_ID,
    slug: "vet-life",
    displayName: "Vet life",
    nicheKey: "VET",
    productType: "life_insurance",
  };
}

function updateInput() {
  return {
    clientAccountId: CLIENT,
    campaignId: CAMPAIGN,
    requestId: REQUEST_ID,
    expectedRevision: 4,
    displayName: "Vet life west",
    nicheKey: "VET",
    productType: "life_insurance",
    status: "review",
  };
}

function bindingInput() {
  return {
    clientAccountId: CLIENT,
    campaignId: CAMPAIGN,
    requestId: REQUEST_ID,
    expectedRevision: 1,
    bindings: [],
  };
}

function destinationInput() {
  return {
    clientAccountId: CLIENT,
    campaignId: CAMPAIGN,
    requestId: REQUEST_ID,
    expectedRevision: 1,
    workflowIdGhl: "wf-1",
    workflowTriggerMode: "none" as const,
    ghlLocationId: null,
    spreadsheetId: null,
    worksheetId: 3,
    worksheetTitle: "Leads",
  };
}

function savedBody() {
  return {
    ...flags(),
    ok: true,
    statusCode: 200,
    replayed: false,
    requestId: REQUEST_ID,
    clientAccountId: CLIENT,
    campaignId: CAMPAIGN,
    revision: 2,
    campaign: {
      id: CAMPAIGN,
      clientAccountId: CLIENT,
      slug: "vet-life",
      displayName: "Vet life west",
      nicheKey: "VET",
      productType: "life_insurance",
      status: "review",
      revision: 2,
      configurationStatusEffect: "none",
      operationalReady: false,
      inventoryKeyUsed: false,
      createdAt: "2026-11-19T00:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
    },
  };
}

function flags() {
  return {
    routingRuleApplied: false,
    sourceConfirmed: false,
    deliveryArmed: false,
    externalCall: false,
    inventoryKeyUsed: false,
    operationalReady: false,
    originConfirmed: false,
    changedClientDefaultWorkflow: false,
    tabContractChanged: false,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function snapshotEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function restoreEnv(previous: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in previous)) delete process.env[key];
  }
  Object.assign(process.env, previous);
}
