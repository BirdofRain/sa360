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

const SECRET = "admin-coc-session-secret-32b";

function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function withFetchSpy<T>(run: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ ok: true, jobId: "meta-leadgen-fetch-1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await run();
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("anonymous callers cannot requeue a Meta Graph fetch or save a Facebook association", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const guard = await import("./admin-coc-session-guard.ts");
  // Empty string = "cookie absent" for the test override (undefined would fall through to next/headers).
  guard.useAdminCocTestSessionCookie("");
  const { requeueMetaLeadgenFetchAction } = await import("../app/actions/source-intake.ts");
  const { associateFacebookFormAction, reevaluateFacebookCaptureAction } = await import(
    "../app/actions/facebook-intake.ts"
  );
  try {
    const { calls } = await withFetchSpy(async () => {
      await assert.rejects(() => requeueMetaLeadgenFetchAction("sle_1"), isNextRedirect);
      await assert.rejects(
        () =>
          associateFacebookFormAction({
            pageId: "900000000000101",
            formId: "900000000000201",
            clientAccountId: "synthetic_client",
          }),
        isNextRedirect
      );
      await assert.rejects(
        () => reevaluateFacebookCaptureAction({ sourceEventId: "sle_1" }),
        isNextRedirect
      );
    });
    assert.equal(calls.length, 0, "no admin API call may be made without a session");
  } finally {
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("observers cannot requeue a Meta Graph fetch", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const session = await import("./admin-coc-session.ts");
  const guard = await import("./admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
  assert.ok(token);
  guard.useAdminCocTestSessionCookie(token);
  const { requeueMetaLeadgenFetchAction } = await import("../app/actions/source-intake.ts");
  try {
    const { calls } = await withFetchSpy(() =>
      assert.rejects(
        () => requeueMetaLeadgenFetchAction("sle_1"),
        (error: unknown) => error instanceof guard.AdminCocForbiddenError
      )
    );
    assert.equal(calls.length, 0);
  } finally {
    guard.useAdminCocTestSessionCookie(undefined);
  }
});
