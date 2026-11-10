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

import { ADMIN_COC_ROLE_ADMIN, ADMIN_COC_ROLE_OBSERVER, OBSERVER_DOCUMENT_PATHS, isObserverAdminApiGetAllowed, isObserverDocumentPath } from "../admin-coc-observer-access.ts";
import { resolveAdminCocRouteGate } from "../admin-coc-route-gate.ts";
import { deriveObserverNavigation } from "../nav-visibility.ts";
import { teamWorkspaceNavItem, visibleAdminNavItems } from "../nav.ts";
import { resolvePageMeta } from "../page-meta.ts";
import { isTeamWorkspaceEnabled } from "./config.ts";

const SECRET = "admin-coc-session-secret-32b";

function gate(role: "admin" | "observer" | "portal" | "anonymous" | "reviewer", pathname = "/team-workspace") {
  return resolveAdminCocRouteGate({
    pathname,
    host: "admin.example",
    adminPasswordConfigured: true,
    hasAdminSession: role === "admin",
    adminSessionRole: role === "observer" ? ADMIN_COC_ROLE_OBSERVER : role === "admin" ? ADMIN_COC_ROLE_ADMIN : null,
    hasMetaReviewerSession: role === "reviewer",
    hasValidPortalSession: role === "portal" || role === "reviewer",
    clientPortalLiveConfigured: true,
    frontOfficeDevPreview: false,
    portalAccessQuery: false,
    method: "GET",
  });
}

test("the workspace flag is exact true", () => {
  const previous = process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
    assert.equal(isTeamWorkspaceEnabled(), false);
    for (const value of ["TRUE", "1", "yes", "on", "false"]) {
      process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = value;
      assert.equal(isTeamWorkspaceEnabled(), false, value);
    }
    process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = " true ";
    assert.equal(isTeamWorkspaceEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
    else process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = previous;
  }
});

test("admin can open the workspace and every other session is denied", () => {
  assert.equal(gate("admin").kind, "allow");
  assert.equal(gate("admin", "/team-workspace/alex_gross").kind, "allow");
  assert.equal(gate("admin", "/clients/alex_gross/notification-recipient").kind, "allow");
  assert.equal(gate("observer").kind, "forbidden");
  assert.equal(gate("observer", "/team-workspace/alex_gross").kind, "forbidden");
  assert.equal(gate("observer", "/clients/alex_gross/notification-recipient").kind, "forbidden");
  assert.equal(gate("anonymous").kind, "redirect");
  assert.equal(gate("portal").kind, "redirect");
  assert.equal(gate("portal", "/clients/alex_gross/notification-recipient").kind, "redirect");
  assert.equal(gate("reviewer").kind, "forbidden");
  assert.equal(gate("reviewer", "/clients/alex_gross/notification-recipient").kind, "forbidden");
  assert.equal(isObserverDocumentPath("/team-workspace"), false);
  assert.equal(isObserverDocumentPath("/team-workspace/alex_gross"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/team-workspace/clients/alex_gross"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/team-workspace/clients/alex_gross/source-campaign-review"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/clients/alex_gross/source-campaign-requests"), false);
  assert.equal(
    isObserverAdminApiGetAllowed("/admin/v1/clients/alex_gross/delivery-notification-recipient"),
    false
  );
  assert.equal((OBSERVER_DOCUMENT_PATHS as readonly string[]).includes("/team-workspace"), false);
  assert.equal((OBSERVER_DOCUMENT_PATHS as readonly string[]).includes("/team"), false);
});

test("the nav item is flag gated and stays off the observer list", () => {
  const hidden = visibleAdminNavItems({ bulkImports: true, supportTickets: true });
  assert.equal(hidden.some((item) => item.href === "/team-workspace"), false);
  const shown = visibleAdminNavItems({ bulkImports: true, supportTickets: true, teamWorkspace: true });
  assert.equal(shown.some((item) => item.href === teamWorkspaceNavItem.href), true);
  assert.equal(deriveObserverNavigation(shown).some((item) => item.href === "/team-workspace"), false);
  assert.equal(resolvePageMeta("/team-workspace").title, "Team Workspace");
  assert.equal(resolvePageMeta("/team-workspace/alex_gross").title, "Team Workspace");
  assert.equal(resolvePageMeta("/clients/alex_gross/notification-recipient").title, "Notification recipient");
});

test("workspace files do not collect a recipient, send mail, or arm delivery", () => {
  const files = [
    new URL("./load.ts", import.meta.url),
    new URL("./present.ts", import.meta.url),
    new URL("./ticket-context.ts", import.meta.url),
    new URL("../../components/team-workspace/workspace-board.tsx", import.meta.url),
    new URL("../../app/(dashboard)/team-workspace/page.tsx", import.meta.url),
    new URL("../../app/(dashboard)/team-workspace/[clientAccountId]/page.tsx", import.meta.url),
    new URL("../../components/team-workspace/notification-choice.tsx", import.meta.url),
    new URL("../../components/team-workspace/guided-onboarding.tsx", import.meta.url),
    new URL("../../app/actions/delivery-notification-preference.ts", import.meta.url),
    new URL("../../app/actions/team-workspace-onboarding.ts", import.meta.url),
    new URL("./onboarding-guide.ts", import.meta.url),
    new URL("./source-campaign-review.ts", import.meta.url),
    new URL("../../components/team-workspace/source-campaign-review-panel.tsx", import.meta.url),
    new URL("./source-campaign-request.ts", import.meta.url),
    new URL("./source-campaign-request-env.ts", import.meta.url),
    new URL("../../components/team-workspace/source-campaign-request-panel.tsx", import.meta.url),
    new URL("../../app/actions/source-campaign-request.ts", import.meta.url),
    new URL("./ghl-destination.ts", import.meta.url),
    new URL("./ghl-destination-config-request.ts", import.meta.url),
    new URL("./ghl-destination-config-request-env.ts", import.meta.url),
    new URL("../../components/team-workspace/ghl-destination-guide.tsx", import.meta.url),
    new URL("../../components/team-workspace/ghl-destination-config-request-panel.tsx", import.meta.url),
    new URL("../../app/actions/team-workspace-ghl-destination.ts", import.meta.url),
    new URL("./company-sheets-discovery.ts", import.meta.url),
    new URL("../../components/team-workspace/company-sheets-discovery-guide.tsx", import.meta.url),
    new URL("../../app/actions/team-workspace-company-sheets.ts", import.meta.url),
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(source.includes("/team\""), false);
  assert.equal(source.includes("app.post"), false);
  assert.equal(source.includes("method: \"POST\""), false);
  assert.equal(source.includes("method: \"PATCH\""), false);
  assert.equal(source.includes("custom-webhook"), false);
  assert.equal(source.includes("SA360_ADMIN_API_KEY"), false);
  assert.equal(source.includes("x-sa360-admin-key"), false);
  assert.equal(source.includes("OBSERVER_DOCUMENT_PATHS"), false);
  assert.equal(source.includes("prisma"), false);
  assert.equal(source.includes("SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED"), false);
  assert.equal(source.includes("recipientEmail"), false);
  assert.equal(source.includes("Email the team"), false);
});

test("an observer and a signed-out session do not call the admin API", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const load = await import("./load.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const observer = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
    assert.ok(observer);
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    await assert.rejects(
      () => load.loadTeamWorkspaceIndex(),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    await assert.rejects(
      () => load.loadTeamWorkspaceClient("alex_gross"),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );

    guard.useAdminCocTestSessionCookie(undefined);
    await assert.rejects(() => load.loadTeamWorkspaceIndex());
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
  }
});

test("an admin read uses GET only", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const load = await import("./load.ts");
  const calls: { url: string; method: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/admin/v1/clients")) {
      return json({
        ok: true,
        count: 1,
        items: [
          {
            clientAccountId: "alex_gross",
            clientDisplayName: "Alex Gross",
            status: "onboarding",
            portalEnabled: false,
            primaryNicheKeys: [],
            primaryProductTypes: [],
            hasGhlDestination: false,
            destinationSubaccountIdGhl: null,
            updatedAt: "2026-11-06T16:00:00.000Z",
          },
        ],
      });
    }
    if (url.endsWith("/admin/v1/clients/alex_gross")) {
      return json({
        ok: true,
        item: {
          clientAccountId: "alex_gross",
          clientDisplayName: "Alex Gross",
          status: "onboarding",
          routingRules: [],
        },
      });
    }
    if (url.includes("/onboarding")) {
      return json({ error: "onboarding_read_disabled" }, 404);
    }
    if (url.includes("/team-workspace/")) {
      return json({ error: "team_workspace_disabled" }, 404);
    }
    return json({ error: "request_failed" }, 500);
  }) as typeof fetch;

  try {
    const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN);
    assert.ok(token);
    guard.useAdminCocTestSessionCookie(token ?? undefined);
    const index = await load.loadTeamWorkspaceIndex();
    assert.equal(index.kind, "ready");
    if (index.kind === "ready") assert.equal(index.clients[0]?.clientAccountId, "alex_gross");

    const detail = await load.loadTeamWorkspaceClient("alex_gross");
    assert.equal(detail.kind, "ready");
    if (detail.kind === "ready") {
      assert.equal(detail.view.steps.find((step) => step.id === "delivery_destination")?.status, "unavailable");
      assert.equal(detail.view.steps.find((step) => step.id === "setup_verification")?.status, "unavailable");
    }
    assert.ok(calls.length > 0);
    assert.equal(calls.some((call) => call.url.includes("/source-campaign-review")), true);
    assert.equal(calls.every((call) => call.method === "GET"), true);
    assert.equal(calls.some((call) => call.method !== "GET"), false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
