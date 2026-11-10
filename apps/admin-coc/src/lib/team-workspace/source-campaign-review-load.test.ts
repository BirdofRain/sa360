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

import { ADMIN_COC_ROLE_ADMIN } from "../admin-coc-observer-access.ts";

const SECRET = "admin-coc-session-secret-32b";

function setupDocument(revision: number, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    item: {
      status: "draft",
      revision,
      repairRequired: false,
      missingRequiredFields: [],
      data: { providerFunnelId: "funnel-north", providerCampaignId: "campaign-north", trafficSourceName: "North page" },
      submittedAt: null,
      reviewedAt: null,
      updatedAt: null,
      operationalEffects: false,
      ...overrides,
    },
  };
}

function verifiedReview(revision: number, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    availability: "ready",
    requestDisposition: "saved_request",
    revision,
    requested: { trafficSourceName: "North page", providerFunnelId: "funnel-north", providerCampaignId: "campaign-north" },
    sourceStatus: "confirmed_for_client",
    campaignStatus: "live_routing_rule",
    sourceAssociated: true,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: true,
    campaignOwnership: "this_client",
    attention: ["This client has a live routing rule, and delivery is not enabled on it."],
    ...overrides,
  };
}

function workspaceBody() {
  return {
    ok: true,
    contractVersion: "team_workspace_delivery_v1",
    client: { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" },
    setupRequest: { present: true, status: "draft", revision: 4, destinationChoice: "undecided", operational: false },
    destinations: {
      ghl: { configured: false, deliveryEnabled: false, deliveryMode: null, locationIdPresent: false },
      companySheets: { configured: false, campaignDispatchEnabled: false, campaignDispatchNotBefore: null, agedDispatchEnabled: false },
      customWebhook: { present: false, enabled: false, endpointHost: null },
    },
    recentCanonicalDeliveries: [],
    clientNotification: { enabled: false, canEnable: false, blockedReason: "recipient_not_verified", recipientVerified: false, revision: 0 },
    notifications: { items: [] },
  };
}

async function loadWith(
  handlers: {
    setup?: () => unknown;
    setupStatus?: number;
    review?: (url: string) => unknown;
    request?: () => unknown;
    requestStatus?: number;
  },
  options: { nativeSetup?: boolean; requestEnabled?: boolean; workspaceReady?: boolean } = {}
) {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED = "true";
  if (options.nativeSetup === false) delete process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED;
  else process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
  if (options.requestEnabled) {
    process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";
  } else {
    delete process.env.SA360_TEAM_WORKSPACE_ENABLED;
    delete process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED;
  }
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const load = await import("./load.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/admin/v1/clients")) {
      return json({ ok: true, count: 1, items: [{ clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding", portalEnabled: false, primaryNicheKeys: [], primaryProductTypes: [], hasGhlDestination: false, destinationSubaccountIdGhl: null, updatedAt: "2026-11-06T16:00:00.000Z" }] });
    }
    if (url.endsWith("/admin/v1/clients/alex_gross")) {
      return json({ ok: true, item: { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding", routingRules: [] } });
    }
    if (url.endsWith("/admin/v1/clients/alex_gross/setup")) {
      return json(handlers.setup ? handlers.setup() : setupDocument(4), handlers.setupStatus ?? 200);
    }
    if (url.includes("/source-campaign-review")) return json(handlers.review ? handlers.review(url) : verifiedReview(4));
    if (url.includes("/source-campaign-requests")) {
      const body = handlers.request ? handlers.request() : { ok: false, error: "source_campaign_request_disabled" };
      const status = handlers.requestStatus ?? (handlers.request ? 200 : 404);
      return json(body, status);
    }
    if (url.includes("/onboarding")) return json({ error: "onboarding_read_disabled" }, 404);
    if (url.includes("/team-workspace/")) {
      return options.workspaceReady ? json(workspaceBody()) : json({ error: "team_workspace_disabled" }, 404);
    }
    return json({ error: "request_failed" }, 500);
  }) as typeof fetch;
  try {
    const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN);
    assert.ok(token);
    guard.useAdminCocTestSessionCookie(token ?? undefined);
    const detail = await load.loadTeamWorkspaceClient("alex_gross");
    return { detail, calls };
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
    delete process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED;
    delete process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED;
    delete process.env.SA360_TEAM_WORKSPACE_ENABLED;
    delete process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED;
  }
}

function reviewOf(detail: Awaited<ReturnType<typeof loadWith>>["detail"]) {
  assert.equal(detail.kind, "ready");
  if (detail.kind !== "ready") throw new Error("expected a ready workspace");
  return detail.guide?.sourceCampaignReview;
}

test("the review is requested with the setup revision after that document is loaded", async () => {
  const { detail, calls } = await loadWith({});
  const setupAt = calls.findIndex((url) => url.endsWith("/admin/v1/clients/alex_gross/setup"));
  const reviewAt = calls.findIndex((url) => url.includes("/source-campaign-review"));
  assert.ok(setupAt >= 0);
  assert.ok(reviewAt > setupAt);
  assert.match(calls[reviewAt] ?? "", /expectedRevision=4$/);
  const review = reviewOf(detail);
  assert.equal(review?.availability, "ready");
  assert.equal(review?.revision, 4);
  assert.equal(review?.sourceAssociated, true);
  assert.equal(review?.deliveryActivated, false);
});

test("a setup revision that changes before the review returns is not shown as verified", async () => {
  const { detail, calls } = await loadWith({
    review: () => verifiedReview(5),
  });
  assert.match(calls.find((url) => url.includes("/source-campaign-review")) ?? "", /expectedRevision=4$/);
  const review = reviewOf(detail);
  assert.equal(review?.availability, "unavailable");
  assert.equal(review?.sourceAssociated, false);
  assert.equal(review?.sourceStatus, null);
  assert.equal(review?.liveRouting, false);
  assert.match(review?.attention.join(" ") ?? "", /Nothing was verified/);
});

test("an unreadable setup is not sent to the review", async () => {
  const { detail, calls } = await loadWith({
    setup: () => setupDocument(4, { repairRequired: true }),
    review: () => verifiedReview(4),
  });
  assert.equal(calls.some((url) => url.includes("/source-campaign-review")), false);
  const review = reviewOf(detail);
  assert.equal(review?.availability, "unavailable");
  assert.equal(review?.sourceAssociated, false);
  assert.equal(review?.deliveryActivated, false);
});

test("an unavailable setup is not shown as a verification", async () => {
  const { detail, calls } = await loadWith({
    setup: () => ({ error: "request_failed" }),
    setupStatus: 500,
    review: () => verifiedReview(4),
  });
  assert.equal(calls.some((url) => url.includes("/source-campaign-review")), false);
  const review = reviewOf(detail);
  assert.equal(review?.sourceAssociated, false);
  assert.equal(review?.availability, "unavailable");
});

test("no saved setup still asks for revision 0 and does not claim an association", async () => {
  const { detail, calls } = await loadWith({
    setup: () => setupDocument(0, { data: {} }),
    review: () => ({
      ok: true,
      availability: "ready",
      requestDisposition: "incomplete",
      revision: 0,
      requested: { trafficSourceName: null, providerFunnelId: null, providerCampaignId: null },
      sourceStatus: "incomplete",
      campaignStatus: "incomplete",
      sourceAssociated: false,
      deliveryActivated: false,
      deliveryConfirmed: false,
      liveRouting: false,
      campaignOwnership: "none",
      attention: ["No setup request is saved yet. Nothing was verified."],
    }),
  });
  assert.match(calls.find((url) => url.includes("/source-campaign-review")) ?? "", /expectedRevision=0$/);
  const review = reviewOf(detail);
  assert.equal(review?.disposition, "incomplete");
  assert.equal(review?.sourceAssociated, false);
  assert.equal(review?.sourceStatus, "incomplete");
});

test("another client's source and live rule stay visible when the revision matches", async () => {
  const { detail } = await loadWith({
    review: () =>
      verifiedReview(4, {
        sourceStatus: "confirmed_for_other_client",
        sourceAssociated: false,
        campaignOwnership: "another_client",
        liveRouting: true,
        deliveryActivated: false,
        attention: ["A matching source is confirmed for a different client. This check does not move it."],
      }),
  });
  const review = reviewOf(detail);
  assert.equal(review?.sourceStatus, "confirmed_for_other_client");
  assert.equal(review?.sourceAssociated, false);
  assert.equal(review?.campaignOwnership, "another_client");
  assert.equal(review?.liveRouting, true);
  assert.equal(review?.deliveryActivated, false);
});

test("native setup turned off does not display a verified review", async () => {
  const { detail, calls } = await loadWith(
    {
      review: (url) => {
        assert.equal(url.includes("expectedRevision"), false);
        return verifiedReview(4);
      },
    },
    { nativeSetup: false }
  );
  const reviewUrl = calls.find((url) => url.includes("/source-campaign-review")) ?? "";
  assert.equal(reviewUrl.includes("expectedRevision"), false);
  const review = reviewOf(detail);
  assert.equal(review?.availability, "unavailable");
  assert.equal(review?.sourceAssociated, false);
  assert.match(review?.attention.join(" ") ?? "", /native client setup is turned off/);
});

test("a disabled request flag does not call the request route", async () => {
  const { detail, calls } = await loadWith({});
  assert.equal(calls.some((url) => url.includes("/source-campaign-requests")), false);
  assert.equal(detail.kind, "ready");
  if (detail.kind !== "ready") return;
  assert.equal(detail.guide?.sourceCampaignRequest?.availability, "disabled");
});

test("the request head is loaded with GET and kept as a proposal", async () => {
  const { detail, calls } = await loadWith(
    {
      request: () => ({
        ok: true,
        clientAccountId: "alex_gross",
        revision: 4,
        openRequest: {
          requestId: "11111111-1111-4111-8111-111111111111",
          status: "requested",
          revision: 4,
          setupRevision: 4,
          providerFunnelId: "funnel-north",
          parentUrlKey: null,
          providerCampaignId: "campaign-north",
          requestedAssociation: true,
          createdAt: "2026-11-10T16:04:00.000Z",
        },
        associationApplied: false,
        routingRuleApplied: false,
        deliveryArmed: false,
        confirmedOperationalAssociation: false,
      }),
    },
    { requestEnabled: true, workspaceReady: true }
  );
  const requestCalls = calls.filter((url) => url.includes("/source-campaign-requests"));
  assert.equal(requestCalls.length, 1);
  assert.equal(detail.kind, "ready");
  if (detail.kind !== "ready") return;
  const head = detail.guide?.sourceCampaignRequest;
  assert.equal(head?.availability, "ready", JSON.stringify(head));
  if (head?.availability !== "ready") return;
  assert.equal(head.revision, 4);
  assert.equal(head.openRequest?.status, "requested");
  assert.equal(head.openRequest?.providerCampaignId, "campaign-north");
  assert.equal(head.openRequest?.setupRevision, 4);
});

test("the team workspace API flag blocks the request read", async () => {
  const { calls, detail } = await loadWith({ request: () => ({ ok: true }) }, { requestEnabled: true, workspaceReady: false });
  assert.equal(calls.some((url) => url.includes("/source-campaign-requests")), false);
  assert.equal(detail.kind, "ready");
  if (detail.kind !== "ready") return;
  assert.equal(detail.guide?.sourceCampaignRequest?.availability, "disabled");
  if (detail.guide?.sourceCampaignRequest?.availability === "disabled") {
    assert.equal(detail.guide.sourceCampaignRequest.reason, "workspace_api");
  }
});

test("a request payload that claims an operational write is not shown", async () => {
  const { detail } = await loadWith(
    {
      request: () => ({
        ok: true,
        clientAccountId: "alex_gross",
        revision: 1,
        openRequest: null,
        associationApplied: true,
        routingRuleApplied: false,
        deliveryArmed: false,
        confirmedOperationalAssociation: false,
      }),
    },
    { requestEnabled: true, workspaceReady: true }
  );
  assert.equal(detail.kind, "ready");
  if (detail.kind !== "ready") return;
  assert.equal(detail.guide?.sourceCampaignRequest?.availability, "error");
  if (detail.guide?.sourceCampaignRequest?.availability === "error") {
    assert.match(detail.guide.sourceCampaignRequest.message, /could not be read/);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
