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
const DESTINATION_AT = "2026-11-10T12:00:00.000Z";

test("configuration actions do not call operational writers", () => {
  const source = readFileSync(new URL("./team-workspace-ghl-destination.ts", import.meta.url), "utf8");
  assert.equal(source.includes("postAdminGhlDestinationConfiguration"), true);
  assert.equal(source.includes("fetchAdminGhlDestinationConfiguration"), true);
  assert.equal(source.includes("postAdminClientGhlConfig"), false);
  assert.equal(source.includes("patchAdminGhlConnectionLinkClient"), false);
  assert.equal(source.includes("postAdminRoutingRuleGhlConfig"), false);
  assert.equal(source.includes("postAdminActivateOngoingGhl"), false);
  assert.equal(source.includes("activate-ongoing"), false);
  assert.equal(source.includes("test-delivery"), false);
  assert.equal(source.includes("link-client"), false);
  assert.equal(source.includes("/ghl-config"), false);
  assert.equal(source.includes("source-funnels"), false);
  assert.equal(source.includes("company-sheets"), false);
});

test("flags, observers, and a portal cookie do not call the configuration route", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const seen = await withSession("observer", async (actions, calls) => {
    await assert.rejects(
      () => actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody()),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    return calls;
  });
  assert.equal(seen.length, 0);
  const portal = await withSession("portal", async (actions, calls) => {
    await assert.rejects(() => actions.loadTeamWorkspaceGhlConfigurationAction("phase2j_demo"));
    await assert.rejects(() => actions.previewTeamWorkspaceGhlLocationAction("phase2j_demo", "loc_other", true));
    return calls;
  });
  assert.equal(portal.length, 0);
  process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED = "TRUE";
  const disabled = await withSession("admin", async (actions, calls) => {
    const result = await actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody());
    assert.equal(result.code, "FEATURE_DISABLED");
    assert.match(result.message, /turned off/i);
    return calls;
  });
  assert.equal(disabled.length, 0);
  restoreEnv(previous);
});

test("a successful request posts only the configuration route and reloads the same payload", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const seen = await withSession("admin", async (actions, calls) => {
    const loaded = await actions.loadTeamWorkspaceGhlConfigurationAction("phase2j_demo");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.head?.revision, 2);
    assert.equal(loaded.head?.liveDestination, false);
    const saved = await actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody());
    assert.equal(saved.stored, true);
    assert.equal(saved.replayed, false);
    assert.equal(saved.sent?.workflowId, "wf_exact");
    const replay = await actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody());
    assert.equal(replay.replayed, true);
    assert.equal(replay.requestId, REQUEST_ID);
    return calls;
  });
  assert.equal(seen.filter((call) => call.startsWith("POST ")).every((call) => call.includes("/ghl-destination-configuration")), true);
  assert.equal(seen.filter((call) => call.startsWith("POST ")).length, 2);
  assert.equal(seen.some((call) => call.includes("/ghl-config")), false);
  assert.equal(seen.some((call) => call.includes("link-client")), false);
  assert.equal(seen.some((call) => call.includes("activate-ongoing")), false);
  assert.equal(seen.some((call) => call.includes("test-delivery")), false);
  assert.equal(seen.some((call) => call.includes("/probe")), false);
  restoreEnv(previous);
});

test("an uncertain response keeps the payload and a different payload is rejected", async () => {
  const previous = snapshotEnv();
  enableFlags();
  let attempt = 0;
  const seen = await withSession(
    "admin",
    async (actions, calls) => {
      const first = await actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody());
      assert.equal(first.uncertain, true);
      assert.equal(first.retainRequestId, true);
      assert.equal(first.sent?.requestId, REQUEST_ID);
      const second = await actions.saveTeamWorkspaceGhlConfigurationRequestAction(first.sent ? { clientAccountId: "phase2j_demo", ...first.sent } : submitBody());
      assert.equal(second.replayed, true);
      assert.equal(second.stored, true);
      const changed = await actions.saveTeamWorkspaceGhlConfigurationRequestAction({
        ...submitBody(),
        workflowId: "wf_other",
      });
      assert.equal(changed.code, "request_id_reused");
      assert.equal(changed.needsReload, true);
      assert.equal(changed.stored, false);
      assert.match(changed.message, /different payload/i);
      return calls;
    },
    () => {
      attempt += 1;
      return attempt === 1;
    }
  );
  assert.equal(seen.filter((call) => call.startsWith("POST ")).every((call) => call.includes("/ghl-destination-configuration")), true);
  assert.equal(seen.some((call) => call.includes("/ghl-config") || call.includes("link-client") || call.includes("activate-ongoing")), false);
  restoreEnv(previous);
});

test("stale revision, stale destination, expired snapshot, duplicates, unresolved ids, and live destinations stay unstored", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const cases = [
    ["revision_conflict", /request chain changed/i],
    ["destination_stale", /operational destination changed/i],
    ["snapshot_expired", /older than 24 hours/i],
    ["snapshot_future", /ahead of the server/i],
    ["snapshot_missing", /no snapshot/i],
    ["duplicate_field_mapping", /more than once/i],
    ["field_id_unverified", /not substituted/i],
    ["workflow_not_in_snapshot", /workflow name was not used/i],
    ["live_destination", /live destination was not changed/i],
    ["forbidden", /portal access and observer access/i],
  ] as const;
  for (const [code, pattern] of cases) {
    const seen = await withSession(
      "admin",
      async (actions, calls) => {
        const result = await actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody());
        assert.equal(result.stored, false);
        assert.equal(result.code, code);
        assert.match(result.message, pattern);
        if (code === "revision_conflict" || code === "destination_stale") assert.equal(result.needsReload, true);
        assert.equal(result.retainRequestId, false);
        return calls;
      },
      () => false,
      { failure: code }
    );
    assert.equal(seen.filter((call) => call.startsWith("POST ")).every((call) => call.includes("/ghl-destination-configuration")), true);
    assert.equal(seen.some((call) => call.includes("/ghl-config") || call.includes("link-client") || call.includes("activate-ongoing")), false);
  }
  restoreEnv(previous);
});

test("a disconnected location and a wrong-location snapshot are not used", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const disconnected = await withSession(
    "admin",
    async (actions, calls) => {
      const result = await actions.previewTeamWorkspaceGhlLocationAction("phase2j_demo", "loc_saved", true);
      assert.equal(result.code, "location_not_linked");
      assert.match(result.message ?? "", /HTTP 401/);
      assert.match(result.message ?? "", /does not link a client/i);
      assert.equal(result.preview, null);
      return calls;
    },
    () => false,
    { disconnected: true }
  );
  assert.equal(disconnected.some((call) => call.includes("/ghl/locations/")), false);
  const mismatched = await withSession(
    "admin",
    async (actions, calls) => {
      const result = await actions.previewTeamWorkspaceGhlLocationAction("phase2j_demo", "loc_other", false);
      assert.equal(result.code, "SNAPSHOT_LOCATION");
      assert.equal(result.preview, null);
      return calls;
    },
    () => false,
    { wrongLocation: true }
  );
  assert.equal(mismatched.some((call) => call.includes("/ghl/locations/loc_other/config")), true);
  assert.equal(mismatched.some((call) => call.startsWith("POST ")), false);
  restoreEnv(previous);
});

test("the configuration post does not send portal or workspace credentials", async () => {
  const previous = snapshotEnv();
  enableFlags();
  const headers = await withSession("admin", async (actions, _calls, seenHeaders) => {
    await actions.saveTeamWorkspaceGhlConfigurationRequestAction(submitBody());
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
    clientAccountId: "phase2j_demo",
    requestId: REQUEST_ID,
    expectedRevision: 2,
    expectedDestinationUpdatedAt: DESTINATION_AT,
    locationId: "loc_other",
    workflowId: "wf_exact",
    fieldMappings: [
      { key: "desired_coverage", fieldId: "field_coverage" },
      { key: "branch_of_service", fieldId: "field_branch" },
      { key: "primary_reason", fieldId: "field_reason" },
    ],
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
  process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED = "true";
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
    SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED,
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
    actions: typeof import("./team-workspace-ghl-destination.ts"),
    calls: string[],
    headers: string[]
  ) => Promise<T>,
  failFirstSave: () => boolean = () => false,
  options: { failure?: string; disconnected?: boolean; wrongLocation?: boolean } = {}
): Promise<T> {
  const session = await import("../../lib/admin-coc-session.ts");
  const guard = await import("../../lib/admin-coc-session-guard.ts");
  const actions = await import("./team-workspace-ghl-destination.ts");
  const calls: string[] = [];
  const headers: string[] = [];
  const stored = new Map<string, string>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    headers.push(JSON.stringify(init?.headers ?? {}));
    if (url.includes("/ghl-destination-configuration") && method === "POST") {
      const serialized = String(init?.body ?? "");
      const posted = JSON.parse(serialized) as { requestId: string; workflowId: string };
      if (failFirstSave()) {
        stored.set(posted.requestId, serialized);
        throw new Error("socket hang up");
      }
      if (options.failure) {
        return json({
          ok: false,
          error: options.failure,
          replayed: false,
          requestId: REQUEST_ID,
          revision: null,
          destinationUpdated: false,
          deliveryArmed: false,
          enrollmentPerformed: false,
          routingChanged: false,
          liveDestinationChanged: false,
        }, options.failure === "forbidden" ? 403 : 409);
      }
      const body = posted;
      const previousBody = stored.get(body.requestId);
      if (previousBody && previousBody !== serialized) {
        return json({
          ok: false,
          error: "request_id_reused",
          replayed: false,
          requestId: body.requestId,
          revision: null,
          destinationUpdated: false,
          deliveryArmed: false,
          enrollmentPerformed: false,
          routingChanged: false,
          liveDestinationChanged: false,
        }, 409);
      }
      const replayed = Boolean(previousBody);
      stored.set(body.requestId, serialized);
      return json({
        ok: true,
        requestId: body.requestId,
        revision: 3,
        replayed,
        status: "stored",
        locationId: "loc_other",
        workflowId: body.workflowId,
        fieldMappings: submitBody().fieldMappings,
        snapshotFetchedAt: DESTINATION_AT,
        destinationUpdated: false,
        deliveryArmed: false,
        enrollmentPerformed: false,
        routingChanged: false,
        liveDestinationChanged: false,
      });
    }
    if (url.includes("/ghl-destination-configuration")) {
      return json({
        ok: true,
        clientAccountId: "phase2j_demo",
        revision: 2,
        destinationUpdatedAt: DESTINATION_AT,
        liveDestination: false,
        configuration: null,
        destinationUpdated: false,
        deliveryArmed: false,
        enrollmentPerformed: false,
        routingChanged: false,
        liveDestinationChanged: false,
      });
    }
    if (url.includes("/ghl/locations/")) {
      return json({
        ...snapshotBody(),
        location: { id: options.wrongLocation ? "loc_saved" : "loc_other", name: "Other location", companyId: null, timezone: null },
      });
    }
    if (url.includes("/ghl/connections")) {
      return json({
        ok: true,
        count: 1,
        items: [connection(options.disconnected ? "error" : "connected")],
      });
    }
    if (url.includes("/delivery-config")) return json(deliveryBody());
    return json({ ok: false, error: "unexpected" }, 404);
  }) as typeof fetch;
  if (kind === "admin") {
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
  } else if (kind === "observer") {
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER") ?? undefined);
  } else {
    guard.useAdminCocTestSessionCookie("portal-session");
  }
  try {
    return await work(actions, calls, headers);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
}

function deliveryBody() {
  return {
    ok: true,
    clientAccountId: "phase2j_demo",
    clientDisplayName: "Phase 2J",
    locationId: "loc_saved",
    locationName: "Saved location",
    connection: connection("connected"),
    ghlDestination: {
      destinationSubaccountIdGhl: "loc_saved",
      locationName: "Saved location",
      ghlConnectionStatus: "connected",
      destinationWorkflowIdGhl: "wf_saved",
      workflowTriggerMode: "tag_trigger",
      deliveryMode: "shadow",
      deliveryEnabled: false,
      clientCutoverApproved: false,
      internalApprovalStatus: "not_reviewed",
      updatedAt: DESTINATION_AT,
      sourceAttributeFieldMapJson: {},
      sa360CustomFieldIdMapJson: {},
    },
    destinationReadiness: null,
    locationMismatch: false,
    issueCodes: [],
    discoverySummary: null,
  };
}

function connection(status: string) {
  return {
    id: "conn_other",
    clientAccountId: "phase2j_demo",
    locationId: status === "connected" ? "loc_other" : "loc_saved",
    locationName: status === "connected" ? "Other location" : "Saved location",
    connectionStatus: status,
    lastError: status === "connected" ? null : "HTTP 401",
  };
}

function snapshotBody() {
  return {
    ok: true,
    pipelines: [],
    workflows: [{ id: "wf_exact", name: "Exact workflow", status: null, type: null }],
    users: [],
    customFields: [
      { id: "field_coverage", name: "Desired Coverage", key: null, fieldKey: "contact.desired_coverage", dataType: "TEXT" },
    ],
    tags: [],
    fetchedAt: DESTINATION_AT,
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
