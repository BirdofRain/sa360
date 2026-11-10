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

test("the discovery action does not call operational Company Sheets writers", () => {
  const source = readFileSync(new URL("./team-workspace-company-sheets.ts", import.meta.url), "utf8");
  assert.equal(source.includes('intent: "inspect"'), true);
  for (const name of [
    "startCompanyGoogleOAuth",
    "disconnectCompanyGoogle",
    "saveCompanyGoogleFolder",
    "clearCompanyGoogleFolder",
    "createCompanySpreadsheet",
    "saveCompanySheetsDestination",
    "deleteCompanySheetsDestination",
    "testCompanySpreadsheetAccess",
    "inspectCompanySheetsTabs",
    "bindCompanySheetsTab",
    "unlinkCompanyClientFolder",
    "probeCompanySheetWrite",
    "sendCompanySheetsCampaignTestRow",
    'intent: "create"',
    'intent: "link"',
    "dispatch-activation",
    "deliveries",
    "process-dispatch",
  ]) {
    assert.equal(source.includes(name), false, name);
  }
});

test("disabled flags, an observer, and a portal session do not call Google or the admin API", async () => {
  const previous = snapshotEnv();
  enableFlags();
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "TRUE";
  const disabled = await withSession("admin", async (actions, calls) => {
    const result = await actions.loadTeamWorkspaceCompanySheetsAction("alex_gross");
    assert.equal(result.code, "FEATURE_DISABLED");
    assert.match(result.message ?? "", /turned off/i);
    return calls;
  });
  assert.equal(disabled.length, 0);
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const observer = await withSession("observer", async (actions, calls) => {
    await assert.rejects(
      () => actions.inspectTeamWorkspaceCompanySheetsStorageAction("alex_gross"),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    return calls;
  });
  assert.equal(observer.length, 0);
  const portal = await withSession("portal", async (actions, calls) => {
    await assert.rejects(() => actions.readTeamWorkspaceCompanySheetsWorksheetsAction("alex_gross", "sheet-1"));
    return calls;
  });
  assert.equal(portal.length, 0);
  restoreEnv(previous);
});

test("loading discovery reads stored rows and does not call Google file endpoints", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const calls = await withSession("admin", async (actions, seen) => {
    const result = await actions.loadTeamWorkspaceCompanySheetsAction("alex_gross");
    assert.equal(result.ok, true);
    assert.equal(result.snapshot?.destination?.spreadsheetId, "sheet-1");
    assert.equal(result.snapshot?.dispatch?.campaignDispatchEnabled, true);
    assert.equal(result.snapshot?.storage, null);
    assert.equal(result.snapshot?.worksheetRead, null);
    return seen;
  });
  const urls = calls.map(urlOf);
  assert.equal(urls.some((url) => url.endsWith("/integrations/google/company")), true);
  assert.equal(urls.some((url) => url.endsWith("/google-sheets/destination")), true);
  assert.equal(urls.some((url) => url.endsWith("/google-sheets/tabs")), true);
  assert.equal(urls.some((url) => url.endsWith("/google-sheets/dispatch")), true);
  assert.equal(urls.some((url) => url.endsWith("/google-sheets/column-mapping")), true);
  assert.equal(urls.some((url) => url.includes("/folder")), false);
  assert.equal(urls.some((url) => url.endsWith("/google-sheets/resolve")), false);
  assert.equal(urls.some((url) => url.includes("/create")), false);
  restoreEnv(previous);
});

test("storage inspection is explicit and a spreadsheet outside the approved drive is rejected", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withSession("admin", async (actions, calls) => {
    const storage = await actions.inspectTeamWorkspaceCompanySheetsStorageAction("alex_gross");
    assert.equal(storage.snapshot?.storage?.folder?.folderId, "folder-1");
    assert.equal(storage.snapshot?.storage?.spreadsheets[0]?.spreadsheetId, "sheet-1");
    const outside = await actions.readTeamWorkspaceCompanySheetsWorksheetsAction("alex_gross", "sheet-out");
    assert.equal(outside.ok, false);
    assert.equal(outside.read?.code, "unapproved_shared_drive");
    assert.match(outside.message ?? "", /not the approved company drive/);
    const unavailable = await actions.readTeamWorkspaceCompanySheetsWorksheetsAction("alex_gross", "sheet-down");
    assert.equal(unavailable.code, "retryable");
    assert.match(unavailable.message ?? "", /Google is unavailable/);
    assert.equal(unavailable.uncertain, false);
    return calls;
  }, { mode: "storage" });
  const joined = seen.join("\n");
  assert.match(joined, /POST .*\/google-sheets\/folder /);
  assert.match(joined, /"intent":"inspect"/);
  assert.equal(joined.includes('"intent":"create"'), false);
  assert.equal(joined.includes('"intent":"link"'), false);
  assert.equal(joined.includes("/google-sheets/create"), false);
  assert.equal(joined.includes("/tabs/inspect"), false);
  assert.equal(joined.includes("/write-probe"), false);
  assert.equal(joined.includes("/dispatch-activation"), false);
  assert.equal(joined.includes("/campaign-test"), false);
  restoreEnv(previous);
});

test("a permission denial does not continue into a Google read", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const calls = await withSession("admin", async (actions, seen) => {
    const result = await actions.loadTeamWorkspaceCompanySheetsAction("alex_gross");
    assert.equal(result.code, "forbidden");
    assert.match(result.message ?? "", /permission/i);
    return seen;
  }, { mode: "forbidden" });
  assert.equal(calls.length, 4);
  assert.equal(calls.some((call) => call.includes("/folder")), false);
  restoreEnv(previous);
});

function enableFlags() {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
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
  };
}

function restoreEnv(previous: ReturnType<typeof snapshotEnv>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function urlOf(call: string): string {
  return call.split(" ")[1] ?? "";
}

async function withSession<T>(
  kind: "admin" | "observer" | "portal",
  work: (actions: typeof import("./team-workspace-company-sheets.ts"), calls: string[]) => Promise<T>,
  options: { mode?: "saved" | "storage" | "forbidden" } = {}
): Promise<T> {
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-company-sheets.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url} ${init?.body ?? ""}`);
    if (options.mode === "forbidden") return json({ ok: false, error: "forbidden" }, 403);
    if (url.endsWith("/google-sheets/resolve")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { spreadsheet?: string };
      if (body.spreadsheet === "sheet-down") return json({ ok: false, error: "retryable" }, 503);
      if (body.spreadsheet === "sheet-out") return json({ ok: false, error: "unapproved_shared_drive" }, 409);
      return json({
        ok: true,
        spreadsheet: {
          spreadsheetId: "sheet-1",
          title: "Alex leads",
          worksheets: [{ sheetId: 101, title: "Campaign Leads", sheetType: "GRID" }],
          controlBasis: "approved_shared_drive",
        },
      });
    }
    if (url.endsWith("/google-sheets/folder/resolve")) {
      return json({ ok: true, folder: { folderId: "folder-1", title: "Alex Gross", driveId: "drive-1", basis: "approved_shared_drive" } });
    }
    if (url.endsWith("/google-sheets/folder")) {
      return json({ ok: true, outcome: "select", created: false, linked: false, driveDeleted: false, folder: null, folders: [] });
    }
    if (url.includes("/folder/spreadsheets")) {
      return json({
        ok: true,
        folder: { folderId: "folder-1", title: "Alex Gross", url: "https://drive.google.com/drive/folders/folder-1" },
        spreadsheets: [{ spreadsheetId: "sheet-1", title: "Alex leads", url: "https://docs.google.com/spreadsheets/d/sheet-1" }],
        nextPageToken: null,
        skipped: 0,
        links: [],
        folderEvents: [{ folderId: "folder-1", folderTitle: "Alex Gross", action: "linked", createdAt: "2026-11-01T00:00:00.000Z" }],
        currentDestination: null,
      });
    }
    if (url.endsWith("/google-sheets/column-mapping")) {
      return json({ ok: true, readiness: "ready", schemaVersion: "company_sheets_campaign_v3", boundSchemaVersion: "company_sheets_campaign_v3", customMapping: false });
    }
    if (url.endsWith("/google-sheets/dispatch")) {
      return json({ ok: true, configured: true, dispatchFlagEnabled: false, campaignDispatchEnabled: true, agedDispatchEnabled: false });
    }
    if (url.endsWith("/google-sheets/tabs")) {
      return json({ ok: true, destinationRevision: 4, contracts: [{ role: "campaign", setupState: "bound", setupReason: null, worksheetId: 101, worksheetTitle: "Campaign Leads", schemaVersion: "company_sheets_campaign_v3", boundAt: null, inspectedAt: null }] });
    }
    if (url.endsWith("/google-sheets/destination")) {
      return json({
        ok: true,
        destination: {
          configured: true,
          spreadsheetId: "sheet-1",
          spreadsheetTitle: "Alex leads",
          worksheetId: 101,
          worksheetTitle: "Campaign Leads",
          controlBasis: "approved_shared_drive",
          accessStatus: "readable",
          destinationRevision: 4,
        },
      });
    }
    if (url.endsWith("/integrations/google/company")) {
      return json({
        ok: true,
        connection: {
          configured: true,
          status: "connected",
          connected: true,
          reconnectRequired: false,
          googleEmail: "sheets@lifeagentlaunch.com",
          googleDisplayName: "Life Agent Launch",
          missingScopes: [],
          destinationFolder: { folderId: "parent-1", title: "Approved", verifiedAt: "2026-11-01T00:00:00.000Z" },
          oauthAvailable: true,
          sheetsSetupAvailable: true,
          liveDeliveryEnabled: false,
        },
      });
    }
    return json({ ok: false, error: "unexpected" }, 404);
  }) as typeof fetch;
  if (kind === "admin") guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
  else if (kind === "observer") guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER") ?? undefined);
  else guard.useAdminCocTestSessionCookie("portal-session");
  try {
    return await work(actions, calls);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
