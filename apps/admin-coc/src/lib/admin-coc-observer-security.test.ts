import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

import {
  canonicalSecurityPath,
  isObserverAdminApiGetAllowed,
  isObserverBffReadAllowed,
  isObserverDocumentPath,
  OBSERVER_DOCUMENT_PATHS,
} from "./admin-coc-observer-access.ts";
import { ADMIN_COC_ROLE_OBSERVER } from "./admin-coc-observer-access.ts";
import {
  projectObserverSourceLeadDetail,
  projectObserverWebhookDetail,
} from "./admin-coc-observer-projection.ts";
import type { AdminWebhookDetail } from "./admin-api/types.ts";
import type { SourceLeadDetail } from "./source-intake/types.ts";

const SECRET = "admin-coc-session-secret-32b";

async function observerSession(): Promise<{
  token: string;
  useAdminCocTestSessionCookie: (value: string | undefined) => void;
  ADMIN_COC_FORBIDDEN: string;
  AdminCocForbiddenError: new () => Error;
  observerAdminApiKeyDenied: (
    method: string,
    path: string
  ) => Promise<{ status: number } | null>;
  unauthorizedAdminCocBffResponse: (request?: Request) => Promise<Response | null>;
  withAdminCocBff: <A extends unknown[]>(
    handler: (...args: A) => Promise<Response>
  ) => (...args: A) => Promise<Response>;
}> {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const session = await import("./admin-coc-session.ts");
  const guard = await import("./admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
  assert.ok(token);
  return { token, ...guard };
}

test("exact document paths reject unknown children and traversal", () => {
  for (const path of OBSERVER_DOCUMENT_PATHS) {
    assert.equal(isObserverDocumentPath(path), true);
  }
  assert.equal(isObserverDocumentPath("/webhooks/new"), false);
  assert.equal(isObserverDocumentPath("/source-intake/imports"), false);
  assert.equal(isObserverDocumentPath("/clients"), false);
  assert.equal(isObserverDocumentPath("/webhooks/../clients"), false);
  assert.equal(isObserverDocumentPath("/webhooks/%2e%2e/clients"), false);
  assert.equal(canonicalSecurityPath("/admin/v1/coc/../clients"), null);
  assert.equal(canonicalSecurityPath("/admin/v1/coc/%2e%2e/clients"), null);
});

test("admin API allowlist is exact and rejects traversal and unknown GETs", () => {
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/webhook-requests"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/automation-dashboard/summary"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/webhook-requests/wh_1"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/source-leads/lead_1"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/lead-inventory/review/actions/req-9"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/../clients"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/%2e%2e/clients"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/%2e%2e%2fclients"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/not-a-real-endpoint"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/automation-dashboard/future"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/source-leads/lead_1/reject"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/source-leads/../clients"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/routing/dry-run-decisions/d1/duplicate-risk-review"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/webhook-requests/has.dot"), false);
  assert.equal(isObserverBffReadAllowed("GET", "/api/lead-inventory/review/actions/../commit"), false);
  assert.equal(isObserverBffReadAllowed("GET", "/api/future-diagnostic"), false);
});

test("observer source-lead and webhook projections drop customer payloads", () => {
  const detail = projectObserverSourceLeadDetail({
    id: "lead_1",
    receivedAt: "2026-01-01T00:00:00.000Z",
    sourceProvider: "web",
    sourceSystem: "forms",
    sourceType: "form",
    sourceRouteKey: "route",
    sourceLeadId: "ext-1",
    leadName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+15551212",
    status: "received",
    matched: true,
    matchedRuleId: "rule_1",
    destinationClientAccountId: "client_1",
    destinationLocationIdGhl: "loc_1",
    errorSummary: null,
    sourceCampaignId: "camp",
    sourceCampaignName: "Camp",
    sourceFunnelName: null,
    sourceLeadUid: "uid",
    rawPayloadJson: { email: "ada@example.com", authorization: "Bearer secret" },
    normalizedPayloadJson: { phone: "+15551212" },
    routingResultJson: { matched: true, email: "ada@example.com", errorCode: "none" },
    duplicateRiskJson: { status: "clear", candidateMatches: [{ phone: "+1555" }] },
    deliveryResultJson: { status: "created", inventoryCreated: true, responseBody: { secret: "x" } },
    enrichmentMetadataJson: { raw: true },
    enrichmentPreview: null,
    routingDryRunDecisionId: null,
    normalizedAt: null,
    routedAt: null,
    approvedAt: null,
    deliveredAt: null,
    approvedBy: null,
  } satisfies SourceLeadDetail);

  assert.equal(detail.email, null);
  assert.equal(detail.phone, null);
  assert.equal(detail.leadName, null);
  assert.equal(detail.rawPayloadJson, null);
  assert.equal(detail.normalizedPayloadJson, null);
  assert.equal(detail.enrichmentMetadataJson, null);
  assert.deepEqual(detail.routingResultJson, { matched: true, errorCode: "none" });
  assert.deepEqual(detail.duplicateRiskJson, { status: "clear" });
  assert.deepEqual(detail.deliveryResultJson, { status: "created", inventoryCreated: true });

  const webhook = projectObserverWebhookDetail({
    id: "wh_1",
    requestId: "req",
    source: "ghl",
    route: "/hook",
    receivedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    durationMs: 1,
    processingStatus: "ok",
    httpStatus: 200,
    clientAccountId: "c1",
    subaccountIdGhl: null,
    contactIdGhl: null,
    eventUuid: null,
    eventNameInternal: null,
    errorCode: "E1",
    errorSummary: null,
    leadEmail: "ada@example.com",
    leadPhone: "+1555",
    requestBodyRedacted: { authorization: "Bearer secret" },
    responseBodyRedacted: { email: "ada@example.com" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    debug: {
      summary: {
        event: null,
        validity: "valid",
        status: "ok",
        http: "200",
        time: "t",
        durationMs: "1",
        source: "ghl",
        route: "/hook",
      },
      topLine: {
        request_id: "req",
        time: "t",
        event: null,
        lead: "Ada",
        client: "c1",
        subaccount: null,
        validity: "valid",
        status: "ok",
        http: "200",
        ms: "1",
        route: "/hook",
      },
      identity: { email: "ada@example.com", event: "ok" },
      lifecycleEvent: {},
      state: {},
      attribution: {},
      appointment: {},
      policy: {},
      routingOwnership: {},
      errors: null,
      requestBodyRedacted: { token: "secret" },
      responseBodyRedacted: { phone: "+1555" },
      meta: {},
    },
  } as AdminWebhookDetail);
  assert.equal(webhook.leadEmail, null);
  assert.equal(webhook.requestBodyRedacted, null);
  assert.equal(webhook.debug.requestBodyRedacted, null);
  assert.equal(webhook.debug.topLine.lead, null);
  assert.equal("email" in webhook.debug.identity, false);
});

test("forbidden BFF handlers reject an observer session before upstream fetch", async () => {
  const {
    token,
    useAdminCocTestSessionCookie,
    ADMIN_COC_FORBIDDEN,
    observerAdminApiKeyDenied,
    unauthorizedAdminCocBffResponse,
    withAdminCocBff,
  } = await observerSession();
  const { GET: fulfillmentOrdersGet } = await import(
    "../app/api/fulfillment-ops/orders/route.ts"
  );
  const { POST: actionDashboardPost } = await import(
    "../app/api/action-dashboard/actions/route.ts"
  );
  useAdminCocTestSessionCookie(token);
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("nope", { status: 500 });
  }) as typeof fetch;
  try {
    const orders = await fulfillmentOrdersGet();
    assert.equal(orders.status, 403);
    const body = (await orders.json()) as { error: string };
    assert.equal(body.error, ADMIN_COC_FORBIDDEN);

    const dashboard = await actionDashboardPost(
      new Request("http://localhost/api/action-dashboard/actions", {
        method: "POST",
        body: "{}",
      })
    );
    assert.equal(dashboard.status, 403);
    assert.equal(calls.length, 0);

    const wrapped = withAdminCocBff(async () => Response.json({ ok: true }));
    const wrappedRes = await wrapped();
    assert.equal(wrappedRes.status, 403);

    const denied = await observerAdminApiKeyDenied("GET", "/admin/v1/coc/../clients");
    assert.equal(denied?.status, 403);
    const direct = await unauthorizedAdminCocBffResponse(
      new Request("http://localhost/api/fulfillment-ops/orders")
    );
    assert.equal(direct?.status, 403);
  } finally {
    globalThis.fetch = original;
    useAdminCocTestSessionCookie(undefined);
  }
});

test("observer mutation server action throws before using the admin API key", async () => {
  const { token, useAdminCocTestSessionCookie, AdminCocForbiddenError } = await observerSession();
  const { setDeliveryRuntimeModeAction } = await import("../app/actions/delivery-runtime-mode.ts");
  useAdminCocTestSessionCookie(token);
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        setDeliveryRuntimeModeAction({
          mode: "simulate",
          operatorConfirmationText: "nope",
        }),
      (error: unknown) => error instanceof AdminCocForbiddenError
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    useAdminCocTestSessionCookie(undefined);
  }
});
