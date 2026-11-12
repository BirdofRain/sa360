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

test("the guided destination actions do not post configuration or delivery", () => {
  const source = readFileSync(new URL("./team-workspace-ghl-destination.ts", import.meta.url), "utf8");
  assert.equal(source.includes("postAdminClientGhlConfig"), false);
  assert.equal(source.includes("postAdminRoutingRuleGhlConfig"), false);
  assert.equal(source.includes("patchAdminGhlConnectionLinkClient"), false);
  assert.equal(source.includes("activate-ongoing"), false);
  assert.equal(source.includes("test-delivery"), false);
  assert.equal(source.includes("link-client"), false);
  assert.equal(source.includes("applyLalAiBot1"), false);
  assert.equal(source.includes("confirmLocationMismatch"), false);
  assert.equal(source.includes("deliveryMode:"), false);
  assert.equal(source.includes("company-sheets"), false);
  assert.equal(source.includes("source-funnels"), false);
});

test("flags, observers, and an invalid location do not call GoHighLevel", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-ghl-destination.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return json(deliveryBody(), 200);
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    await assert.rejects(() => actions.loadTeamWorkspaceGhlDestinationAction("phase2g_demo"));
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    await assert.rejects(
      () => actions.saveTeamWorkspaceGhlDestinationAction("phase2g_demo"),
      guard.AdminCocForbiddenError
    );
    assert.equal(calls.length, 0);

    delete process.env.SA360_TEAM_WORKSPACE_ENABLED;
    const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    guard.useAdminCocTestSessionCookie(admin ?? undefined);
    const disabled = await actions.readTeamWorkspaceGhlSnapshotAction("phase2g_demo", "loc_saved", true);
    assert.equal(disabled.code, "FEATURE_DISABLED");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

test("reads stay on the delivery summary and location snapshot, and a save writes nothing", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withAdmin(async (actions, calls) => {
    const loaded = await actions.loadTeamWorkspaceGhlDestinationAction("phase2g_demo");
    assert.equal(loaded.ok, true);
    if (!loaded.ok || !loaded.view) return calls;
    assert.equal(loaded.view.configured, true);
    assert.equal(loaded.view.active, false);
    assert.equal(loaded.view.stampFields.find((field) => field.key === "sa360_lead_uid")?.savedId, "field_uid");
    const invalid = await actions.readTeamWorkspaceGhlSnapshotAction("phase2g_demo", "loc_unknown", true);
    assert.equal(invalid.code, "INVALID_LOCATION");
    const snapshot = await actions.readTeamWorkspaceGhlSnapshotAction("phase2g_demo", "loc_saved", false);
    assert.equal(snapshot.ok, true);
    const blocked = await actions.saveTeamWorkspaceGhlDestinationAction("phase2g_demo");
    assert.equal(blocked.code, "WRITE_BLOCKED");
    return calls;
  });
  assert.equal(seen.some((call) => call.includes("/ghl-config")), false);
  assert.equal(seen.some((call) => call.includes("activate-ongoing")), false);
  assert.equal(seen.some((call) => call.includes("test-delivery")), false);
  assert.equal(seen.some((call) => call.includes("link-client")), false);
  assert.equal(seen.some((call) => call.includes("/ghl/locations/loc_unknown")), false);
  assert.equal(seen.some((call) => call.includes("/delivery-config")), true);
  assert.equal(seen.some((call) => call.includes("/ghl/locations/loc_saved/config")), true);
  assert.equal(seen.filter((call) => call.startsWith("POST")).length, 0);
  restoreEnv(previous);
});

test("a live destination is not probed and a failed snapshot read can be retried", async () => {
  const previous = snapshotEnv();
  enableFlags();
  let snapshotCalls = 0;
  const seen = await withAdmin(
    async (actions, calls) => {
      const live = await actions.checkTeamWorkspaceGhlConnectionAction("phase2g_demo", "conn_saved");
      assert.equal(live.code, "LIVE_DESTINATION");
      const failed = await actions.readTeamWorkspaceGhlSnapshotAction("phase2g_demo", "loc_saved", true);
      assert.equal(failed.code, "UNCERTAIN");
      const retried = await actions.readTeamWorkspaceGhlSnapshotAction("phase2g_demo", "loc_saved", true);
      assert.equal(retried.ok, true);
      if (retried.ok && retried.view) assert.equal(retried.view.workflowInSnapshot, true);
      return calls;
    },
    () => {
      snapshotCalls += 1;
      return snapshotCalls === 1;
    },
    { live: true }
  );
  assert.equal(seen.some((call) => call.includes("/probe")), false);
  assert.equal(seen.some((call) => call.includes("refresh=true")), true);
  assert.equal(seen.some((call) => call.startsWith("POST")), false);
  restoreEnv(previous);
});

test("a location without credentials is explained without saving", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withAdmin(
    async (actions, calls) => {
      const result = await actions.readTeamWorkspaceGhlSnapshotAction("phase2g_demo", "loc_saved", false);
      assert.equal(result.ok, false);
      assert.equal(result.code, "READ_FAILED");
      assert.match(result.message, /no connected GoHighLevel credentials/i);
      assert.equal(result.message.includes("NOT_CONNECTED"), false);
      return calls;
    },
    () => false,
    { notConnected: true }
  );
  assert.equal(seen.some((call) => call.startsWith("POST")), false);
  restoreEnv(previous);
});

test("an uncertain credential check does not claim the destination changed", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withAdmin(
    async (actions) => {
      const result = await actions.checkTeamWorkspaceGhlConnectionAction("phase2g_demo", "conn_saved");
      assert.equal(result.ok, false);
      assert.equal(result.code, "UNCERTAIN");
      assert.match(result.message, /could not be confirmed/i);
      assert.equal(result.message.includes("Admin API"), false);
      return result.view?.updatedAt ?? null;
    },
    () => false,
    { probeThrows: true, live: false }
  );
  assert.equal(seen, "2026-11-10T12:00:00.000Z");
  restoreEnv(previous);
});

test("a manager can read saved field ids, and a portal session cannot", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-ghl-destination.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return json({
      ...deliveryBody(),
      clientAccountId: "harbor_benefits",
      ghlDestination: {
        ...deliveryBody().ghlDestination,
        destinationSubaccountIdGhl: "loc_harbor_local",
        destinationWorkflowIdGhl: "wf_harbor_saved",
        deliveryEnabled: false,
        deliveryMode: "shadow",
        sourceAttributeFieldMapJson: {},
        sa360CustomFieldIdMapJson: {
          desired_coverage: "harbor_keep_coverage",
          branch_of_service: "harbor_keep_branch",
          primary_reason: "harbor_keep_reason",
        },
      },
    });
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("workspace");
    const loaded = await actions.loadTeamWorkspaceGhlDestinationAction("harbor_benefits");
    assert.equal(loaded.ok, true);
    if (!loaded.ok || !loaded.view) return;
    assert.equal(loaded.view.deliveryEnabled, false);
    assert.equal(loaded.view.fields.find((field) => field.key === "desired_coverage")?.savedId, "harbor_keep_coverage");
    assert.equal(loaded.view.fields.find((field) => field.key === "branch_of_service")?.savedId, "harbor_keep_branch");
    assert.equal(loaded.view.fields.find((field) => field.key === "primary_reason")?.savedId, "harbor_keep_reason");
    assert.equal(loaded.view.fields.every((field) => field.status === "unverified"), true);
    await assert.rejects(() => actions.saveTeamWorkspaceGhlDestinationAction("harbor_benefits"));
    assert.equal(calls.some((call) => call.startsWith("POST")), false);
    assert.equal(calls.some((call) => call.includes("/ghl-config")), false);
    assert.equal(calls.some((call) => call.includes("/delivery-config")), true);

    guard.useStaffAdminCocTestDecision(undefined);
    guard.useAdminCocTestSessionCookie("portal-session");
    const beforePortal = calls.length;
    await assert.rejects(() => actions.loadTeamWorkspaceGhlDestinationAction("harbor_benefits"));
    assert.equal(calls.length, beforePortal);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision(undefined);
    restoreEnv(previous);
  }
});

test("operations can read saved ids, and a failed discovery does not verify them", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const staff = await import("../../lib/staff-admin-coc-access.ts");
  const actions = await import("./team-workspace-ghl-destination.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/ghl/locations/")) return json({ ok: false, error: "discovery unavailable" }, 503);
    return json({
      ...deliveryBody(),
      clientAccountId: "harbor_benefits",
      ghlDestination: {
        ...deliveryBody().ghlDestination,
        destinationSubaccountIdGhl: "loc_harbor_local",
        destinationWorkflowIdGhl: "wf_harbor_saved",
        deliveryEnabled: false,
        deliveryMode: "shadow",
        sourceAttributeFieldMapJson: {},
        sa360CustomFieldIdMapJson: {
          desired_coverage: "harbor_keep_coverage",
          branch_of_service: "harbor_keep_branch",
          primary_reason: "harbor_keep_reason",
        },
      },
      connection: {
        ...deliveryBody().connection,
        locationId: "loc_harbor_local",
      },
    });
  }) as typeof fetch;
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_operations"],
      staffPrincipalId: "c123456789012345678901234",
    });
    const loaded = await actions.loadTeamWorkspaceGhlDestinationAction("harbor_benefits");
    assert.equal(loaded.ok, true);
    assert.ok(loaded.view);
    if (!loaded.view) return;
    assert.equal(loaded.view.fields.find((field) => field.key === "desired_coverage")?.savedId, "harbor_keep_coverage");
    assert.equal(loaded.view.verified, false);
    assert.equal(loaded.view.fields.every((field) => field.status === "unverified"), true);
    const failed = await actions.readTeamWorkspaceGhlSnapshotAction("harbor_benefits", "loc_harbor_local", false);
    assert.equal(failed.ok, false);
    assert.ok(failed.view);
    if (!failed.view) return;
    assert.equal(failed.view.verified, false);
    assert.equal(failed.view.fields.find((field) => field.key === "branch_of_service")?.savedId, "harbor_keep_branch");
    assert.equal(failed.view.fields.find((field) => field.key === "primary_reason")?.savedId, "harbor_keep_reason");
    assert.equal(failed.view.fields.some((field) => field.status === "verified"), false);
    assert.equal(failed.view.deliveryEnabled, false);
    assert.equal(calls.some((call) => call.startsWith("POST")), false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
    restoreEnv(previous);
  }
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

async function withAdmin<T>(
  work: (
    actions: typeof import("./team-workspace-ghl-destination.ts"),
    calls: string[]
  ) => Promise<T>,
  failSnapshot: () => boolean = () => false,
  options: { probeThrows?: boolean; live?: boolean; notConnected?: boolean } = {}
): Promise<T> {
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-ghl-destination.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url.includes("/probe")) {
      if (options.probeThrows) throw new Error("socket hang up");
      return json({ ok: true, connection: connectionBody() });
    }
    if (url.includes("/ghl/locations/") && options.notConnected) {
      return json({ ok: false, error: "No connected GHL OAuth location for this locationId.", code: "NOT_CONNECTED" }, 400);
    }
    if (url.includes("/ghl/locations/") && failSnapshot()) throw new Error("socket hang up");
    if (url.includes("/ghl/locations/")) return json(snapshotBody());
    if (url.includes("/ghl/connections")) return json({ ok: true, count: 1, items: [connectionBody()] });
    if (url.includes("/delivery-config")) return json(deliveryBody(options.live === true));
    return json({ ok: false, error: "unexpected" }, 404);
  }) as typeof fetch;
  const admin = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
  guard.useAdminCocTestSessionCookie(admin ?? undefined);
  try {
    return await work(actions, calls);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
}

function deliveryBody(live = false) {
  return {
    ok: true,
    clientAccountId: "phase2g_demo",
    clientDisplayName: "Phase 2G",
    locationId: "loc_saved",
    locationName: "Saved location",
    connection: connectionBody(),
    ghlDestination: {
      destinationSubaccountIdGhl: "loc_saved",
      locationName: "Saved location",
      ghlConnectionStatus: "connected",
      destinationWorkflowIdGhl: "wf_saved",
      workflowTriggerMode: "tag_trigger",
      deliveryMode: live ? "live" : "shadow",
      deliveryEnabled: live,
      clientCutoverApproved: live,
      internalApprovalStatus: live ? "approved" : "not_reviewed",
      updatedAt: "2026-11-10T12:00:00.000Z",
      sourceAttributeFieldMapJson: {
        desired_coverage: "field_coverage",
        branch_of_service: "field_branch",
        primary_reason: "field_reason",
      },
      sa360CustomFieldIdMapJson: { sa360_lead_uid: "field_uid" },
    },
    destinationReadiness: null,
    locationMismatch: false,
    issueCodes: [],
    discoverySummary: null,
  };
}

function connectionBody() {
  return {
    id: "conn_saved",
    clientAccountId: "phase2g_demo",
    locationId: "loc_saved",
    locationName: "Saved location",
    connectionStatus: "connected",
    lastError: null,
  };
}

function snapshotBody() {
  return {
    ok: true,
    location: { id: "loc_saved", name: "Saved location", companyId: null, timezone: null },
    pipelines: [],
    workflows: [{ id: "wf_saved", name: "Webform workflow", status: null, type: null }],
    users: [],
    customFields: [
      { id: "field_coverage", name: "Desired Coverage", key: null, fieldKey: "contact.desired_coverage", dataType: "TEXT" },
      { id: "field_branch", name: "Branch of Service", key: null, fieldKey: "contact.branch_of_service", dataType: "TEXT" },
      { id: "field_reason", name: "Primary Reason", key: null, fieldKey: "contact.primary_reason", dataType: "TEXT" },
      { id: "field_uid", name: "SA360 Lead UID", key: null, fieldKey: "contact.sa360_lead_uid", dataType: "TEXT" },
    ],
    tags: [],
    fetchedAt: "2026-11-10T12:00:00.000Z",
    fromCache: true,
    warnings: [],
    errors: [],
    requiredFields: { requiredFieldsInstalled: false, missingRequiredFields: [], foundRequiredFields: [] },
    sa360FieldMapping: {
      discoveredMap: {},
      coreRequiredMapped: [],
      coreRequiredMissing: [],
      optionalMapped: [],
      optionalMissing: [],
      coreRequiredComplete: false,
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
