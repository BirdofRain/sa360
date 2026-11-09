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

function workspaceBody(preference: {
  enabled: boolean;
  canEnable: boolean;
  blockedReason: "recipient_not_verified" | null;
  recipientVerified: boolean;
  revision: number;
}) {
  return {
    ok: true,
    contractVersion: "team_workspace_delivery_v1",
    client: { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" },
    setupRequest: { present: false, status: null, revision: 0, destinationChoice: "undecided", operational: false },
    destinations: {
      ghl: { configured: false, deliveryEnabled: false, deliveryMode: null, locationIdPresent: false },
      companySheets: {
        configured: false,
        campaignDispatchEnabled: false,
        campaignDispatchNotBefore: null,
        agedDispatchEnabled: false,
      },
      customWebhook: { present: false, enabled: false, endpointHost: null },
    },
    recentCanonicalDeliveries: [],
    clientNotification: preference,
    notifications: { items: [] },
  };
}

test("observers and signed-out sessions cannot write a notification preference or recipient", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const preference = await import("../../app/actions/delivery-notification-preference.ts");
  const recipient = await import("../../app/actions/delivery-notification-recipient.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  try {
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    assert.ok(observer);
    guard.useAdminCocTestSessionCookie(observer ?? undefined);
    await assert.rejects(
      () =>
        preference.saveDeliveryNotificationPreferenceAction({
          clientAccountId: "alex_gross",
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          enabled: true,
        }),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    await assert.rejects(
      () => recipient.loadDeliveryNotificationRecipient("alex_gross"),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    guard.useAdminCocTestSessionCookie(undefined);
    await assert.rejects(() =>
      recipient.saveDeliveryNotificationRecipientAction({
        clientAccountId: "alex_gross",
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        recipientEmail: "owner@example.com",
      })
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("the preference save sends on or off, then reloads without a mailbox", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const preference = await import("../../app/actions/delivery-notification-preference.ts");
  const calls: { url: string; method: string; body: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (method === "PUT") {
      return json({
        ok: true,
        replayed: false,
        clientAccountId: "alex_gross",
        enabled: true,
        recipientVerified: true,
        enabledAt: "2026-11-09T18:00:00.000Z",
        disabledAt: null,
        revision: 3,
        channel: "email",
      });
    }
    return json(workspaceBody({
      enabled: true,
      canEnable: true,
      blockedReason: null,
      recipientVerified: true,
      revision: 3,
    }));
  }) as typeof fetch;
  try {
    const token = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    assert.ok(token);
    guard.useAdminCocTestSessionCookie(token ?? undefined);
    const requestId = crypto.randomUUID();
    const result = await preference.saveDeliveryNotificationPreferenceAction({
      clientAccountId: "alex_gross",
      requestId,
      expectedRevision: 2,
      enabled: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.preference.enabled, true);
    assert.equal(result.preference.revision, 3);
    assert.equal(result.refreshed, true);
    assert.equal(JSON.stringify(result).includes("@"), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.method, "PUT");
    assert.match(calls[0]?.url ?? "", /\/delivery-notification$/);
    assert.equal(calls[1]?.method, "GET");
    const payload = JSON.parse(calls[0]?.body ?? "{}") as { requestId: string; expectedRevision: number; enabled: boolean };
    assert.equal(payload.requestId, requestId);
    assert.equal(payload.expectedRevision, 2);
    assert.equal(payload.enabled, true);
    assert.equal("recipientEmail" in payload, false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("the recipient save uses the recipient route and reloads the saved address", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const recipient = await import("../../app/actions/delivery-notification-recipient.ts");
  const calls: { url: string; method: string; body: string }[] = [];
  const original = globalThis.fetch;
  const snapshot = {
    ok: true,
    clientAccountId: "alex_gross",
    recipientEmail: "owner@example.com",
    recipientVerified: true,
    recipientEmailVerifiedAt: "2026-11-09T18:00:00.000Z",
    enabled: false,
    enabledAt: null,
    disabledAt: null,
    revision: 1,
    channel: "email",
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" });
    return json({ ...snapshot, replayed: init?.method === "PUT" ? false : undefined });
  }) as typeof fetch;
  try {
    const token = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
    assert.ok(token);
    guard.useAdminCocTestSessionCookie(token ?? undefined);
    const result = await recipient.saveDeliveryNotificationRecipientAction({
      clientAccountId: "alex_gross",
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      recipientEmail: "  Owner@Example.com ",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.recipient.recipientEmail, "owner@example.com");
    assert.equal(result.recipient.enabled, false);
    assert.equal(result.refreshed, true);
    assert.equal(calls[0]?.method, "PUT");
    assert.match(calls[0]?.url ?? "", /\/delivery-notification-recipient$/);
    assert.equal(calls[1]?.method, "GET");
    const payload = JSON.parse(calls[0]?.body ?? "{}") as { recipientEmail: string; expectedRevision: number };
    assert.equal(payload.recipientEmail, "owner@example.com");
    assert.equal(payload.expectedRevision, 0);
    assert.equal(JSON.stringify(payload).includes("portal"), false);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
