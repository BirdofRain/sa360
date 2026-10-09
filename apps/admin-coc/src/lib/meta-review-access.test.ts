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

const SECRET = "meta-review-session-secret-32b";

function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function withFetchSpy<T>(run: () => Promise<T>): Promise<{ result: T; calls: number }> {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("anonymous callers cannot execute Meta review reads or writes", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const guard = await import("./admin-coc-session-guard.ts");
  guard.useAdminCocTestSessionCookie("");
  const actions = await import("../app/actions/meta-review.ts");
  try {
    const { calls } = await withFetchSpy(async () => {
      await assert.rejects(() => actions.loadMetaReviewPagesAction(), isNextRedirect);
      await assert.rejects(
        () =>
          actions.subscribeMetaReviewLeadgenAction({
            pageId: "10001",
            confirmed: true,
            confirmationText: "SUBSCRIBE LEADGEN",
          }),
        isNextRedirect
      );
    });
    assert.equal(calls, 0);
  } finally {
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("read-only observers cannot execute Meta review reads or writes", async () => {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  const session = await import("./admin-coc-session.ts");
  const guard = await import("./admin-coc-session-guard.ts");
  const token = session.createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
  assert.ok(token);
  guard.useAdminCocTestSessionCookie(token);
  const actions = await import("../app/actions/meta-review.ts");
  try {
    const { calls } = await withFetchSpy(async () => {
      await assert.rejects(
        () => actions.loadMetaReviewPermissionsAction(),
        (error: unknown) => error instanceof guard.AdminCocForbiddenError
      );
      await assert.rejects(
        () =>
          actions.subscribeMetaReviewLeadgenAction({
            pageId: "10001",
            confirmed: true,
            confirmationText: "SUBSCRIBE LEADGEN",
          }),
        (error: unknown) => error instanceof guard.AdminCocForbiddenError
      );
    });
    assert.equal(calls, 0);
  } finally {
    guard.useAdminCocTestSessionCookie(undefined);
  }
});

test("Admin C.O.C. Meta review route flag defaults disabled", async () => {
  const previous = process.env.SA360_META_REVIEW_ENABLED;
  const { isMetaReviewEnabled } = await import("./meta-review/config.ts");
  try {
    delete process.env.SA360_META_REVIEW_ENABLED;
    assert.equal(isMetaReviewEnabled(), false);
    process.env.SA360_META_REVIEW_ENABLED = "true";
    assert.equal(isMetaReviewEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.SA360_META_REVIEW_ENABLED;
    else process.env.SA360_META_REVIEW_ENABLED = previous;
  }
});
