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

async function guard() {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const session = await import("./admin-coc-session.ts");
  const access = await import("./admin-coc-session-guard.ts");
  return { session, access };
}

test("a staff admin grant authorizes BFF and admin API use without an ac1 cookie", async () => {
  const { session, access } = await guard();
  access.useAdminCocTestSessionCookie(undefined);
  access.useStaffAdminCocTestDecision("admin");
  try {
    assert.deepEqual(await access.readAdminCocAccess(), { kind: "admin", source: "staff" });
    assert.equal(await access.readAdminCocSessionRole(), "ADMIN");
    assert.equal(await access.adminCocAdminApiUnauthorized(), null);
    assert.equal(await access.unauthorizedAdminCocBffResponse(new Request("https://admin.example/api/coc/orders")), null);
    assert.equal(await access.observerAdminApiKeyDenied("POST", "/admin/v1/clients"), null);
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    access.useAdminCocTestSessionCookie(observer ?? undefined);
    assert.deepEqual(await access.readAdminCocAccess(), { kind: "admin", source: "staff" });
  } finally {
    access.useStaffAdminCocTestDecision(undefined);
    access.useAdminCocTestSessionCookie(undefined);
  }
});

test("an unprivileged staff session cannot pass admin, BFF, or observer checks", async () => {
  const { session, access } = await guard();
  access.useAdminCocTestSessionCookie("");
  access.useStaffAdminCocTestDecision("limited");
  try {
    assert.deepEqual(await access.readAdminCocAccess(), { kind: "staff_limited" });
    assert.equal(await access.readAdminCocSessionRole(), null);
    const api = await access.adminCocAdminApiUnauthorized();
    assert.equal(api?.status, 401);
    const bff = await access.unauthorizedAdminCocBffResponse(
      new Request("https://admin.example/api/fulfillment-ops/orders", { method: "POST" })
    );
    assert.equal(bff?.status, 403);
    const observer = session.createAdminCocSessionToken(undefined, SECRET, "SA360_OBSERVER");
    access.useAdminCocTestSessionCookie(observer ?? undefined);
    assert.deepEqual(await access.readAdminCocAccess(), { kind: "observer" });
    assert.equal(await access.readAdminCocSessionRole(), "SA360_OBSERVER");
  } finally {
    access.useStaffAdminCocTestDecision(undefined);
    access.useAdminCocTestSessionCookie(undefined);
  }
});

test("the shared-password admin session still authorizes when no staff grant is present", async () => {
  const { session, access } = await guard();
  const token = session.createAdminCocSessionToken(undefined, SECRET, "ADMIN");
  access.useAdminCocTestSessionCookie(token ?? undefined);
  access.useStaffAdminCocTestDecision("limited");
  try {
    assert.deepEqual(await access.readAdminCocAccess(), { kind: "admin", source: "shared_password" });
    assert.equal(await access.unauthorizedAdminCocBffResponse(), null);
    assert.equal(await access.adminCocAdminApiUnauthorized(), null);
  } finally {
    access.useStaffAdminCocTestDecision(undefined);
    access.useAdminCocTestSessionCookie(undefined);
  }
});
