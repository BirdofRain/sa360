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
const REJECT_ID = "33333333-3333-4333-8333-333333333333";

test("the request actions only post the existing request route", () => {
  const source = readFileSync(new URL("./source-campaign-request.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../../lib/admin-api/server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("postAdminSourceCampaignRequest"), true);
  assert.equal(source.includes("sourceCampaignRequestPath"), true);
  assert.equal(server.includes("/source-campaign-requests"), true);
  assert.equal(source.includes('intent: "request"'), true);
  assert.equal(source.includes('intent: "reject"'), true);
  assert.equal(source.includes("source-funnels"), false);
  assert.equal(source.includes("routing/rules"), false);
  assert.equal(source.includes("confirmSource"), false);
  assert.equal(source.includes("ghl"), false);
  assert.equal(source.includes("company-sheets"), false);
  assert.equal(source.includes("deliveryEnabled"), false);
});

test("flags, observers, and portal sessions do not call the request route", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./source-campaign-request.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return json({ ok: false, error: "unexpected" }, 500);
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    await assert.rejects(() => actions.submitSourceCampaignRequestAction(submitInput()));
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    await assert.rejects(() => actions.rejectSourceCampaignRequestAction(rejectInput()), guard.AdminCocForbiddenError);
    assert.equal(calls.length, 0);

    const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    delete process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED;
    const disabled = await actions.submitSourceCampaignRequestAction(submitInput());
    assert.equal(disabled.ok, false);
    assert.equal(disabled.stored, false);
    assert.equal(calls.length, 0);
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "TRUE";
    const almost = await actions.submitSourceCampaignRequestAction(submitInput());
    assert.equal(almost.code, "FEATURE_DISABLED");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("a submission echoes the saved setup and ignores unsaved identifiers", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withAdmin(async (actions, calls) => {
    const result = await actions.submitSourceCampaignRequestAction(
      submitInput({
        providerFunnelId: "typed-in-the-form",
        parentUrlKey: null,
        providerCampaignId: "typed-campaign",
      })
    );
    return { result, calls };
  }, {
    setup: setupItem({
      providerFunnelId: "funnel-1",
      providerCampaignId: "camp-1",
      nextgenFunnelUrl: "https://Go.Example.com/vet/?v=9",
    }),
    head: headBody(0, null),
    post: (body) => successBody(body),
  });
  try {
    assert.equal(seen.result.ok, true);
    assert.equal(seen.result.stored, true);
    assert.equal(seen.result.status, "requested");
    assert.match(seen.result.message, /operational review/);
    assert.equal(/approved|confirmed association/i.test(seen.result.message), false);
    const post = seen.calls.find((call) => call.method === "POST");
    assert.ok(post);
    const body = JSON.parse(post?.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.intent, "request");
    assert.equal(body.requestId, REQUEST_ID);
    assert.equal(body.expectedRevision, 0);
    assert.equal(body.setupRevision, 2);
    assert.equal(body.providerFunnelId, "funnel-1");
    assert.equal(body.parentUrlKey, "go.example.com/vet");
    assert.equal(body.providerCampaignId, "camp-1");
    assert.equal(seen.calls.some((call) => call.url.includes("source-funnels") || call.url.includes("routing/rules")), false);
  } finally {
    restoreEnv(previous);
  }
});

test("an incomplete saved setup and an unconfirmed replacement do not post", async () => {
  const previous = snapshotEnv();
  enableFlags();
  try {
    const incomplete = await withAdmin(async (actions, calls) => {
      const result = await actions.submitSourceCampaignRequestAction(submitInput());
      return { result, calls };
    }, { setup: setupItem({ providerFunnelId: "funnel-1" }), head: headBody(0, null), post: (body) => successBody(body) });
    assert.equal(incomplete.result.code, "setup_incomplete");
    assert.equal(incomplete.calls.some((call) => call.method === "POST"), false);

    const open = await withAdmin(async (actions, calls) => {
      const result = await actions.submitSourceCampaignRequestAction(submitInput({ replaceOpenProposal: false }));
      return { result, calls };
    }, {
      setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
      head: headBody(0, openRequest(0)),
      post: (body) => successBody(body),
    });
    assert.equal(open.result.code, "SUPERSEDE_CONFIRMATION");
    assert.equal(open.result.retainRequestId, true);
    assert.equal(open.calls.some((call) => call.method === "POST"), false);

    const replaced = await withAdmin(async (actions, calls) => {
      const result = await actions.submitSourceCampaignRequestAction(submitInput({ replaceOpenProposal: true }));
      return { result, calls };
    }, {
      setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
      head: headBody(0, openRequest(0)),
      post: (body) => successBody(body, { supersededRequestId: "44444444-4444-4444-8444-444444444444" }),
    });
    assert.equal(replaced.result.ok, true);
    assert.equal(replaced.result.supersededRequestId, "44444444-4444-4444-8444-444444444444");
    assert.equal(replaced.calls.some((call) => call.method === "POST"), true);
  } finally {
    restoreEnv(previous);
  }
});

test("a stale chain posts the original body for replay and a lost response stays uncertain", async () => {
  const previous = snapshotEnv();
  enableFlags();
  try {
    const stale = await withAdmin(async (actions) => actions.submitSourceCampaignRequestAction(submitInput({ expectedRevision: 1 })), {
      setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
      head: headBody(4, null),
      post: () => ({ ok: false, error: "revision_conflict", replayed: false }),
      postStatus: 409,
    });
    assert.equal(stale.result.code, "revision_conflict");
    assert.equal(stale.result.stored, false);
    assert.equal(stale.result.uncertain, false);
    const body = JSON.parse(stale.calls.find((call) => call.method === "POST")?.body ?? "{}") as { expectedRevision?: number };
    assert.equal(body.expectedRevision, 1);

    const lost = await withAdmin(async (actions) => actions.submitSourceCampaignRequestAction(submitInput()), {
      setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
      head: headBody(0, null),
      postThrows: true,
    });
    assert.equal(lost.result.uncertain, true);
    assert.equal(lost.result.retainRequestId, true);
    assert.equal(lost.result.stored, false);
    assert.equal(lost.result.sent?.providerCampaignId, "camp-1");
    assert.equal(lost.result.sent?.expectedRevision, 0);
  } finally {
    restoreEnv(previous);
  }
});

test("a newer rejected attempt leaves the older open proposal writable at the head revision", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const open = {
    requestId: "44444444-4444-4444-8444-444444444444",
    status: "requested",
    revision: 1,
    setupRevision: 2,
    providerFunnelId: "funnel-1",
    parentUrlKey: null,
    providerCampaignId: "camp-1",
    requestedAssociation: true,
    createdAt: "2026-11-10T16:00:00.000Z",
  };
  try {
    const blocked = await withAdmin(
      async (actions) => actions.submitSourceCampaignRequestAction(submitInput({ expectedRevision: 2, replaceOpenProposal: false })),
      { setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }), head: headBody(2, open) }
    );
    assert.equal(blocked.result.code, "SUPERSEDE_CONFIRMATION");
    assert.equal(blocked.calls.some((call) => call.method === "POST"), false);

    const replaced = await withAdmin(
      async (actions) => actions.submitSourceCampaignRequestAction(submitInput({ expectedRevision: 2, replaceOpenProposal: true })),
      {
        setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
        head: headBody(2, open),
        post: (body) => successBody(body),
      }
    );
    const requestBody = JSON.parse(replaced.calls.find((call) => call.method === "POST")?.body ?? "{}") as {
      expectedRevision?: number;
      intent?: string;
      providerFunnelId?: string;
    };
    assert.equal(replaced.result.ok, true);
    assert.equal(requestBody.expectedRevision, 2);
    assert.equal(requestBody.intent, "request");
    assert.equal(requestBody.providerFunnelId, "funnel-1");
    assert.equal(replaced.calls.some((call) => call.url.includes("source-funnels") || call.url.includes("routing/rules")), false);

    const rejected = await withAdmin(async (actions) => actions.rejectSourceCampaignRequestAction(rejectInput()), {
      post: () => ({
        ok: true,
        replayed: false,
        status: "rejected",
        requestId: REJECT_ID,
        associationRequestId: open.requestId,
        clientAccountId: "alex_gross",
        revision: 3,
        setupRevision: 2,
        providerFunnelId: "funnel-1",
        parentUrlKey: null,
        providerCampaignId: "camp-1",
        requestedAssociation: false,
        dispositionReason: "operator_rejected",
        supersededRequestId: null,
        associationApplied: false,
        routingRuleApplied: false,
        deliveryArmed: false,
        confirmedOperationalAssociation: false,
      }),
    });
    const rejectBody = JSON.parse(rejected.calls.find((call) => call.method === "POST")?.body ?? "{}") as {
      expectedRevision?: number;
      intent?: string;
      providerFunnelId?: string;
    };
    assert.equal(rejected.result.ok, true);
    assert.equal(rejectBody.expectedRevision, 2);
    assert.equal(rejectBody.intent, "reject");
    assert.equal(rejectBody.providerFunnelId, undefined);
    assert.equal(rejected.calls.some((call) => call.url.includes("source-funnels") || call.url.includes("routing/rules")), false);

    const impossible = await withAdmin(async (actions) => actions.submitSourceCampaignRequestAction(submitInput({ expectedRevision: 2 })), {
      setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
      head: headBody(2, { ...open, revision: 3 }),
    });
    assert.equal(impossible.result.code, "UNREADABLE_RESULT");
    assert.equal(impossible.calls.some((call) => call.method === "POST"), false);
  } finally {
    restoreEnv(previous);
  }
});

test("an ownership conflict is a stored rejection and operator rejection is a different post", async () => {
  const previous = snapshotEnv();
  enableFlags();
  try {
    const owned = await withAdmin(async (actions) => actions.submitSourceCampaignRequestAction(submitInput()), {
      setup: setupItem({ providerFunnelId: "funnel-1", providerCampaignId: "camp-1" }),
      head: headBody(0, null),
      post: () => ({
        ok: false,
        error: "source_owned_by_other_client",
        replayed: true,
        status: "rejected",
        requestId: REQUEST_ID,
        associationRequestId: REQUEST_ID,
        revision: 2,
        associationApplied: false,
        routingRuleApplied: false,
        deliveryArmed: false,
        confirmedOperationalAssociation: false,
      }),
      postStatus: 409,
    });
    assert.equal(owned.result.stored, true);
    assert.equal(owned.result.status, "rejected");
    assert.match(owned.result.message, /not an operator rejection/);
    assert.equal(owned.result.replayed, true);

    const rejected = await withAdmin(async (actions, calls) => {
      const result = await actions.rejectSourceCampaignRequestAction(rejectInput());
      return { result, calls };
    }, {
      post: () => ({
        ok: true,
        replayed: false,
        status: "rejected",
        requestId: REJECT_ID,
        associationRequestId: REQUEST_ID,
        clientAccountId: "alex_gross",
        revision: 3,
        setupRevision: 2,
        providerFunnelId: "funnel-1",
        parentUrlKey: null,
        providerCampaignId: "camp-1",
        requestedAssociation: false,
        dispositionReason: "operator_rejected",
        supersededRequestId: null,
        associationApplied: false,
        routingRuleApplied: false,
        deliveryArmed: false,
        confirmedOperationalAssociation: false,
      }),
    });
    assert.equal(rejected.result.ok, true);
    assert.match(rejected.result.message, /operator/);
    const post = rejected.calls.find((call) => call.method === "POST");
    const body = JSON.parse(post?.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.intent, "reject");
    assert.equal(body.requestId, REJECT_ID);
    assert.equal("providerFunnelId" in body, false);
    assert.equal(rejected.calls.every((call) => call.method === "POST"), true);
  } finally {
    restoreEnv(previous);
  }
});

type Call = { url: string; method: string; body: string | null };
type World = {
  setup?: Record<string, unknown>;
  head?: Record<string, unknown>;
  post?: (body: Record<string, unknown>) => Record<string, unknown>;
  postStatus?: number;
  postThrows?: boolean;
};

async function withAdmin<T>(
  run: (
    actions: typeof import("./source-campaign-request.ts"),
    calls: Call[]
  ) => Promise<T>,
  world: World
): Promise<T & { result: import("./source-campaign-request.ts").SourceCampaignRequestActionResult; calls: Call[] }> {
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./source-campaign-request.ts");
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url: String(input), method, body });
    if (method === "POST" && world.postThrows) throw new Error("socket hang up");
    if (method === "GET" && String(input).endsWith("/setup")) return json(world.setup ?? { ok: false });
    if (method === "GET" && String(input).includes("/source-campaign-requests")) return json(world.head ?? { ok: false });
    if (method === "POST") {
      const posted = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      return json(world.post ? world.post(posted) : { ok: false }, world.postStatus ?? 200);
    }
    return json({ ok: false, error: "unexpected" }, 500);
  }) as typeof fetch;
  const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
  guard.useAdminCocTestSessionCookie(admin ?? undefined);
  try {
    const result = await run(actions, calls);
    if (result && typeof result === "object" && "result" in result && "calls" in result) {
      return result as T & { result: import("./source-campaign-request.ts").SourceCampaignRequestActionResult; calls: Call[] };
    }
    return { result, calls } as T & { result: import("./source-campaign-request.ts").SourceCampaignRequestActionResult; calls: Call[] };
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
}

function submitInput(overrides: Record<string, unknown> = {}) {
  return {
    clientAccountId: "alex_gross",
    requestId: REQUEST_ID,
    expectedRevision: 0,
    setupRevision: 2,
    providerFunnelId: "funnel-1",
    parentUrlKey: null,
    providerCampaignId: "camp-1",
    replaceOpenProposal: false,
    ...overrides,
  };
}

function rejectInput() {
  return { clientAccountId: "alex_gross", requestId: REJECT_ID, expectedRevision: 2, setupRevision: 2 };
}

function setupItem(data: Record<string, unknown>) {
  return {
    ok: true,
    item: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data,
      operationalEffects: false,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: null,
    },
  };
}

function headBody(revision: number, openRequest: Record<string, unknown> | null) {
  return {
    ok: true,
    clientAccountId: "alex_gross",
    revision,
    openRequest,
    associationApplied: false,
    routingRuleApplied: false,
    deliveryArmed: false,
    confirmedOperationalAssociation: false,
  };
}

function openRequest(revision: number) {
  return {
    requestId: "44444444-4444-4444-8444-444444444444",
    status: "requested",
    revision,
    setupRevision: 2,
    providerFunnelId: "funnel-1",
    parentUrlKey: null,
    providerCampaignId: "camp-1",
    requestedAssociation: true,
    createdAt: "2026-11-10T16:00:00.000Z",
  };
}

function successBody(body: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    replayed: false,
    status: "requested",
    requestId: body.requestId,
    associationRequestId: body.requestId,
    clientAccountId: "alex_gross",
    revision: Number(body.expectedRevision) + 1,
    setupRevision: body.setupRevision,
    providerFunnelId: body.providerFunnelId,
    parentUrlKey: body.parentUrlKey,
    providerCampaignId: body.providerCampaignId,
    requestedAssociation: true,
    dispositionReason: null,
    supersededRequestId: null,
    associationApplied: false,
    routingRuleApplied: false,
    deliveryArmed: false,
    confirmedOperationalAssociation: false,
    ...overrides,
  };
}

function enableFlags() {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
  process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";
}

function snapshotEnv() {
  return {
    ADMIN_COC_PASSWORD: process.env.ADMIN_COC_PASSWORD,
    ADMIN_COC_SESSION_SECRET: process.env.ADMIN_COC_SESSION_SECRET,
    NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
    SA360_ADMIN_API_KEY: process.env.SA360_ADMIN_API_KEY,
    NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED: process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED,
    SA360_TEAM_WORKSPACE_ENABLED: process.env.SA360_TEAM_WORKSPACE_ENABLED,
    SA360_NATIVE_CLIENT_SETUP_ENABLED: process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED,
    SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED,
  };
}

function restoreEnv(previous: ReturnType<typeof snapshotEnv>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
