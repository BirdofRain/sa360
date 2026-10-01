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

import { ADMIN_COC_ROLE_OBSERVER } from "./admin-coc-observer-access.ts";
import { resolveAdminCocRouteGate } from "./admin-coc-route-gate.ts";

const SECRET = "admin-coc-session-secret-32b";

test("observers cannot open Facebook intake or save an association", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const gate = resolveAdminCocRouteGate({
    host: "admin.example",
    marketingHostsEnv: "preview.example",
    adminPasswordConfigured: true,
    hasAdminSession: false,
    adminSessionRole: ADMIN_COC_ROLE_OBSERVER,
    hasValidPortalSession: false,
    clientPortalLiveConfigured: true,
    frontOfficeDevPreview: false,
    portalAccessQuery: false,
    pathname: "/facebook-intake",
    method: "GET",
  });
  assert.equal(gate.kind, "forbidden");

  const session = await import("./admin-coc-session.ts");
  const guard = await import("./admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
  assert.ok(token);
  guard.useAdminCocTestSessionCookie(token);
  const { associateFacebookFormAction } = await import("../app/actions/facebook-intake.ts");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        associateFacebookFormAction({
          pageId: "900000000000101",
          formId: "900000000000201",
          clientAccountId: "synthetic_client",
        }),
      (error: unknown) => error instanceof guard.AdminCocForbiddenError
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    guard.useAdminCocTestSessionCookie(undefined);
  }
});
