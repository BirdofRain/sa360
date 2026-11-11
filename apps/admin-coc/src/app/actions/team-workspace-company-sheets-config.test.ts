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
const OTHER_REQUEST = "22222222-2222-4222-8222-222222222222";
const SHEET = "1a2b3c4d5e6f7g8h";

test("configuration actions do not call operational Company Sheets writers", () => {
  const source = [
    readFileSync(new URL("./team-workspace-company-sheets-config.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../components/team-workspace/company-sheets-config-request-panel.tsx", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(source.includes("postCompanySheetsDestinationConfiguration"), true);
  assert.equal(source.includes("fetchCompanySheetsDestinationConfiguration"), true);
  for (const name of [
    "saveCompanySheetsDestination",
    "deleteCompanySheetsDestination",
    "createCompanySpreadsheet",
    "startCompanyGoogleOAuth",
    "disconnectCompanyGoogle",
    "saveCompanyGoogleFolder",
    "clearCompanyGoogleFolder",
    "unlinkCompanyClientFolder",
    "inspectCompanySheetsTabs",
    "bindCompanySheetsTab",
    "createCompanySheetsTab",
    "probeCompanySheetWrite",
    "sendCompanySheetsCampaignTestRow",
    "activateCompanySheetsDispatch",
    "reviewCompanySheetsColumns",
    "dispatch-activation",
    "process-dispatch",
    "source-funnels",
    "spreadsheetDeliveredAt",
    "test-delivery",
  ]) {
    assert.equal(source.includes(name), false, name);
  }
});

test("flags, an observer, and a portal session do not call the configuration route", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const observer = await withSession("observer", async (actions, calls) => {
    await assert.rejects(
      () => actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody()),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    await assert.rejects(() => actions.loadTeamWorkspaceCompanySheetsConfigurationAction("alex_gross"));
    return calls;
  });
  assert.equal(observer.length, 0);
  const portal = await withSession("portal", async (actions, calls) => {
    await assert.rejects(() => actions.loadTeamWorkspaceCompanySheetsConfigurationAction("alex_gross"));
    await assert.rejects(() => actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody()));
    return calls;
  });
  assert.equal(portal.length, 0);
  process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED = "TRUE";
  const disabled = await withSession("admin", async (actions, calls) => {
    const result = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody());
    assert.equal(result.code, "FEATURE_DISABLED");
    assert.equal(result.stored, false);
    assert.match(result.message, /turned off/i);
    return calls;
  });
  assert.equal(disabled.length, 0);
  restoreEnv(previous);
});

test("the first request posts only the configuration contract and a replay keeps that payload", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withSession("admin", async (actions, calls, _headers, bodies) => {
    const loaded = await actions.loadTeamWorkspaceCompanySheetsConfigurationAction("alex_gross");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.head?.revision, 2);
    assert.equal(loaded.head?.operationalDestination.destinationRevision, 4);
    assert.equal(loaded.head?.operationalDestination.campaignDispatchEnabled, true);
    const saved = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody());
    assert.equal(saved.stored, true);
    assert.equal(saved.replayed, false);
    assert.equal(saved.operationalDestination?.campaignDispatchEnabled, true);
    assert.equal(saved.operationalDestination?.destinationRevision, 4);
    const replay = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody());
    assert.equal(replay.replayed, true);
    assert.equal(replay.requestId, REQUEST_ID);
    assert.match(replay.message, /already stored/i);
    return { calls, bodies };
  });
  const posts = seen.bodies.filter((body) => body.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts.every((body) => body.url.includes("/company-sheets-destination-configuration")), true);
  assert.deepEqual(Object.keys(posts[0]?.json ?? {}).sort(), [
    "expectedDestinationRevision",
    "expectedRevision",
    "requestId",
    "spreadsheetId",
    "worksheetId",
  ]);
  assert.equal(JSON.stringify(posts[0]?.json).includes("spreadsheetTitle"), false);
  assert.equal(JSON.stringify(posts[0]?.json).includes("controlBasis"), false);
  assert.equal(seen.calls.some((call) => call.includes("/google-sheets/destination")), false);
  assert.equal(seen.calls.some((call) => call.includes("dispatch")), false);
  restoreEnv(previous);
});

test("a lost response keeps the payload and a different current request does not prove it was absent", async () => {
  const previous = snapshotEnv();
  enableFlags();
  let attempt = 0;
  const seen = await withSession(
    "admin",
    async (actions, calls) => {
      const first = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody());
      assert.equal(first.uncertain, true);
      assert.equal(first.retainRequestId, true);
      assert.equal(first.stored, false);
      assert.equal(first.sent?.requestId, REQUEST_ID);
      const second = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(
        first.sent ? { clientAccountId: "alex_gross", ...first.sent } : submitBody()
      );
      assert.equal(second.replayed, true);
      assert.equal(second.stored, true);
      const changed = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction({
        ...submitBody(),
        worksheetId: 202,
      });
      assert.equal(changed.code, "request_id_reused");
      assert.equal(changed.needsReload, true);
      assert.equal(changed.stored, false);
      assert.match(changed.message, /different details/i);
      const loaded = await actions.loadTeamWorkspaceCompanySheetsConfigurationAction("alex_gross");
      assert.equal(loaded.head?.configuration?.requestId, OTHER_REQUEST);
      assert.notEqual(loaded.head?.configuration?.requestId, REQUEST_ID);
      return calls;
    },
    () => {
      attempt += 1;
      return attempt === 1;
    },
    { currentRequestId: OTHER_REQUEST }
  );
  assert.equal(seen.filter((call) => call.startsWith("POST ")).every((call) => call.includes("/company-sheets-destination-configuration")), true);
  assert.equal(seen.some((call) => call.includes("/google-sheets/destination")), false);
  restoreEnv(previous);
});

test("stale revisions, ownership, worksheets, and Google errors stay unstored", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const cases = [
    ["revision_conflict", /request changed/i, true],
    ["destination_stale", /operational destination changed/i, true],
    ["request_id_reused", /different details/i, true],
    ["not_company_controlled", /not company-controlled/i, false],
    ["spreadsheet_bound_to_other_client", /another client/i, false],
    ["worksheet_unavailable", /not on this spreadsheet/i, false],
    ["worksheet_not_grid", /not a grid tab/i, false],
    ["google_not_connected", /does not connect Google/i, false],
    ["destination_disabled", /setup is turned off/i, false],
    ["approved_parent_unconfigured", /Approved company storage/i, false],
    ["access_denied", /denied permission/i, false],
    ["forbidden", /Portal access and observer access/i, false],
  ] as const;
  for (const [code, pattern, reload] of cases) {
    const seen = await withSession(
      "admin",
      async (actions, calls) => {
        const result = await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody());
        assert.equal(result.stored, false);
        assert.equal(result.code, code);
        assert.match(result.message, pattern);
        assert.equal(result.needsReload, reload);
        assert.equal(result.retainRequestId, false);
        assert.equal(result.operationalDestination, null);
        return calls;
      },
      () => false,
      { failure: code }
    );
    assert.equal(seen.some((call) => call.includes("/google-sheets/destination")), false);
  }
  const uncertain = await withSession(
    "admin",
    async (actions) => actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody()),
    () => false,
    { failure: "retryable", status: 503 }
  );
  assert.equal(uncertain.uncertain, true);
  assert.equal(uncertain.retainRequestId, true);
  assert.equal(uncertain.stored, false);
  restoreEnv(previous);
});

test("the configuration post does not send portal or workspace credentials", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const headers = await withSession("admin", async (actions, _calls, seenHeaders) => {
    await actions.saveTeamWorkspaceCompanySheetsConfigurationRequestAction(submitBody());
    return seenHeaders;
  });
  const joined = headers.join("\n").toLowerCase();
  assert.match(joined, /x-sa360-admin-key/);
  assert.equal(joined.includes("x-sa360-client-portal-key"), false);
  assert.equal(joined.includes("x-sa360-workspace-key"), false);
  assert.equal(joined.includes("x-sa360-client-portal-assertion"), false);
  restoreEnv(previous);
});

function submitBody() {
  return {
    clientAccountId: "alex_gross",
    requestId: REQUEST_ID,
    expectedRevision: 2,
    expectedDestinationRevision: 4,
    spreadsheetId: SHEET,
    worksheetId: 101,
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
  process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED = "true";
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
    SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED: process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED,
  };
}

function restoreEnv(previous: ReturnType<typeof snapshotEnv>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withSession<T>(
  kind: "admin" | "observer" | "portal",
  work: (
    actions: typeof import("./team-workspace-company-sheets-config.ts"),
    calls: string[],
    headers: string[],
    bodies: Array<{ method: string; url: string; json: Record<string, unknown> | null }>
  ) => Promise<T>,
  failFirstSave: () => boolean = () => false,
  options: { failure?: string; status?: number; currentRequestId?: string } = {}
): Promise<T> {
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-company-sheets-config.ts");
  const calls: string[] = [];
  const headers: string[] = [];
  const bodies: Array<{ method: string; url: string; json: Record<string, unknown> | null }> = [];
  const stored = new Map<string, string>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    headers.push(JSON.stringify(init?.headers ?? {}));
    const serialized = typeof init?.body === "string" ? init.body : null;
    const json = serialized ? (JSON.parse(serialized) as Record<string, unknown>) : null;
    bodies.push({ method, url, json });
    if (url.includes("/company-sheets-destination-configuration") && method === "POST" && json) {
      if (failFirstSave()) {
        stored.set(String(json.requestId), serialized ?? "");
        throw new Error("socket hang up");
      }
      if (options.failure) {
        return jsonResponse(
          {
            ok: false,
            error: options.failure,
            replayed: false,
            requestId: json.requestId,
            revision: null,
            ...flags(),
          },
          options.status ?? (options.failure === "forbidden" ? 403 : 409)
        );
      }
      const previousBody = stored.get(String(json.requestId));
      if (previousBody && previousBody !== serialized) {
        return jsonResponse({ ok: false, error: "request_id_reused", replayed: false, requestId: json.requestId, revision: null, ...flags() }, 409);
      }
      const replayed = Boolean(previousBody);
      stored.set(String(json.requestId), serialized ?? "");
      return jsonResponse({
        ok: true,
        status: "stored",
        replayed,
        requestId: json.requestId,
        revision: 3,
        spreadsheetId: json.spreadsheetId,
        worksheetId: json.worksheetId,
        spreadsheetTitle: "Alex leads",
        worksheetTitle: "Campaign Leads",
        controlBasis: "approved_shared_drive",
        controlCheckedAt: "2026-11-10T15:00:00.000Z",
        expectedDestinationRevision: json.expectedDestinationRevision,
        operationalDestination: {
          exists: true,
          destinationRevision: 4,
          campaignDispatchEnabled: true,
          agedDispatchEnabled: false,
        },
        ...flags(),
      });
    }
    if (url.includes("/company-sheets-destination-configuration")) {
      return jsonResponse({
        ok: true,
        clientAccountId: "alex_gross",
        revision: options.currentRequestId ? 3 : 2,
        operationalDestination: {
          exists: true,
          destinationRevision: 4,
          campaignDispatchEnabled: true,
          agedDispatchEnabled: false,
        },
        configuration: options.currentRequestId
          ? {
              requestId: options.currentRequestId,
              revision: 3,
              spreadsheetId: SHEET,
              worksheetId: 202,
              spreadsheetTitle: "Alex leads",
              worksheetTitle: "Notes",
              controlBasis: "approved_shared_drive",
              controlCheckedAt: "2026-11-10T16:00:00.000Z",
              expectedDestinationRevision: 4,
              createdAt: "2026-11-10T16:00:00.000Z",
            }
          : null,
        ...flags(),
      });
    }
    return jsonResponse({ ok: false, error: "unexpected" }, 404);
  }) as typeof fetch;
  if (kind === "admin") {
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
  } else if (kind === "observer") {
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER") ?? undefined);
  } else {
    guard.useAdminCocTestSessionCookie("portal-session");
  }
  try {
    return await work(actions, calls, headers, bodies);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
}

function flags() {
  return {
    operationalWrite: false,
    destinationUpdated: false,
    dispatchChanged: false,
    driveChanged: false,
    tabContractChanged: false,
    columnMapPublished: false,
    deliveryArmed: false,
    routingChanged: false,
    fulfillmentChanged: false,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
