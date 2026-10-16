import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

import { createHmac } from "node:crypto";

import { ADMIN_COC_ROLE_ADMIN, ADMIN_COC_ROLE_OBSERVER } from "./admin-coc-observer-access.ts";
import { createAdminCocSessionToken, parseAdminCocSessionToken } from "./admin-coc-session.ts";
import {
  META_REVIEWER_SESSION_COOKIE,
  META_REVIEWER_SESSION_MAX_AGE_SECONDS,
  META_REVIEWER_SIGN_IN_FAILED,
} from "./meta-reviewer-auth.ts";
import {
  createMetaReviewerSessionToken,
  metaReviewerSessionCookieClearOptions,
  metaReviewerSessionCookieOptions,
  parseMetaReviewerSessionToken,
} from "./meta-reviewer-session.ts";
import { verifyMetaReviewerSessionTokenEdge } from "./meta-reviewer-session-edge.ts";
import { metaReviewerLogoutOriginAllowed } from "./meta-reviewer-logout.ts";
import { META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY } from "./meta-reviewer-rate-limit.ts";

const SECRET = "meta-reviewer-session-secret-32";
const ADMIN_SECRET = "admin-coc-session-secret-32b";
const PASSWORD = "reviewer-correct-password";

const ENV_KEYS = [
  "ADMIN_COC_PASSWORD",
  "ADMIN_COC_SESSION_SECRET",
  "SA360_META_REVIEWER_PASSWORD",
  "SA360_META_REVIEWER_SESSION_SECRET",
  "SA360_META_REVIEW_ENABLED",
  "SA360_META_REVIEW_WRITES_ENABLED",
  "SA360_ADMIN_API_KEY",
  "ADMIN_API_KEY",
  "NEXT_PUBLIC_SA360_API_BASE_URL",
  "NODE_ENV",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

let verifierPromise: Promise<string> | undefined;

async function verifier(): Promise<string> {
  verifierPromise ??= import("./meta-reviewer-password.ts").then((mod) =>
    mod.hashMetaReviewerPassword(PASSWORD)
  );
  return verifierPromise;
}

function reviewerEnv(hash: string): void {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = ADMIN_SECRET;
  process.env.SA360_META_REVIEWER_SESSION_SECRET = SECRET;
  process.env.SA360_META_REVIEWER_PASSWORD = hash;
  process.env.SA360_META_REVIEW_ENABLED = "true";
  process.env.SA360_META_REVIEW_WRITES_ENABLED = "true";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://127.0.0.1:9";
  process.env.SA360_ADMIN_API_KEY = "server-side-admin-key";
}

async function withFetchSpy<T>(run: () => Promise<T>): Promise<{ result: T; calls: Request[] }> {
  const calls: Request[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    return new Response(JSON.stringify({ ok: true, items: [], preflight: { enabled: true } }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("scrypt verifier matches portal passwords and rejects plaintext configuration", async () => {
  const { hashMetaReviewerPassword, verifyMetaReviewerPassword } = await import(
    "./meta-reviewer-password.ts"
  );
  const { hashPortalPassword, verifyPortalPassword } = await import(
    "../../../api/src/lib/portal-password.ts"
  );
  const fromApi = await hashPortalPassword(PASSWORD);
  assert.equal(await verifyMetaReviewerPassword(PASSWORD, fromApi), true);
  assert.equal(await verifyMetaReviewerPassword("other-password", fromApi), false);
  const fromCoc = await hashMetaReviewerPassword(PASSWORD);
  assert.equal(await verifyPortalPassword(PASSWORD, fromCoc), true);
  assert.equal(await verifyMetaReviewerPassword(PASSWORD, PASSWORD), false);
  assert.equal(await verifyMetaReviewerPassword("", fromCoc), false);
});

test("reviewer login succeeds, fails closed, and stays generic", async () => {
  const snap = snapshotEnv();
  const hash = await verifier();
  try {
    reviewerEnv(hash);
    const { issueMetaReviewerSessionToken } = await import("./meta-reviewer-login-flow.ts");
    const { metaReviewerLoginAction } = await import("../app/actions/meta-reviewer-login.ts");
    const {
      metaReviewerLoginRateLimited,
      recordMetaReviewerLoginFailure,
      resetMetaReviewerLoginRateLimitForTests,
    } = await import("./meta-reviewer-rate-limit.ts");

    const token = await issueMetaReviewerSessionToken(PASSWORD);
    assert.ok(token);
    assert.equal(parseMetaReviewerSessionToken(token, undefined, SECRET)?.role, "meta_reviewer");
    assert.equal(await verifyMetaReviewerSessionTokenEdge(token), true);
    const second = await issueMetaReviewerSessionToken(PASSWORD);
    assert.notEqual(token, second);

    const wrong = new FormData();
    wrong.set("password", "wrong-password");
    wrong.set("next", "https://evil.example/phish");
    const wrongResult = await metaReviewerLoginAction(undefined, wrong);
    assert.deepEqual(wrongResult, { error: META_REVIEWER_SIGN_IN_FAILED });

    delete process.env.SA360_META_REVIEWER_PASSWORD;
    const missing = await issueMetaReviewerSessionToken(PASSWORD);
    assert.equal(missing, null);
    const missingForm = new FormData();
    missingForm.set("password", PASSWORD);
    const missingResult = await metaReviewerLoginAction(undefined, missingForm);
    assert.deepEqual(missingResult, { error: META_REVIEWER_SIGN_IN_FAILED });

    process.env.SA360_META_REVIEWER_PASSWORD = "plaintext-password";
    assert.equal(await issueMetaReviewerSessionToken("plaintext-password"), null);

    reviewerEnv(hash);
    delete process.env.SA360_META_REVIEW_ENABLED;
    assert.equal(await issueMetaReviewerSessionToken(PASSWORD), null);

    reviewerEnv(hash);
    process.env.SA360_META_REVIEWER_SESSION_SECRET = "too-short";
    assert.equal(await issueMetaReviewerSessionToken(PASSWORD), null);

    reviewerEnv(hash);
    delete process.env.SA360_META_REVIEWER_SESSION_SECRET;
    const fallback = await issueMetaReviewerSessionToken(PASSWORD);
    assert.ok(fallback);
    assert.equal(parseMetaReviewerSessionToken(fallback, undefined, ADMIN_SECRET)?.role, "meta_reviewer");
    assert.equal(parseMetaReviewerSessionToken(fallback, undefined, SECRET), null);

    resetMetaReviewerLoginRateLimitForTests();
    reviewerEnv(hash);
    for (let i = 0; i < 8; i++) recordMetaReviewerLoginFailure(META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY);
    assert.equal(metaReviewerLoginRateLimited(META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY), true);
    const limited = new FormData();
    limited.set("password", PASSWORD);
    const limitedResult = await metaReviewerLoginAction(undefined, limited);
    assert.deepEqual(limitedResult, { error: META_REVIEWER_SIGN_IN_FAILED });
    assert.equal(await issueMetaReviewerSessionToken(PASSWORD) !== null, true);
    resetMetaReviewerLoginRateLimitForTests();
  } finally {
    restoreEnv(snap);
    const rate = await import("./meta-reviewer-rate-limit.ts");
    rate.resetMetaReviewerLoginRateLimitForTests();
  }
});

test("reviewer sessions expire, reject tampering, and do not satisfy admin sessions", async () => {
  const snap = snapshotEnv();
  try {
    process.env.ADMIN_COC_PASSWORD = "operator-password";
    process.env.ADMIN_COC_SESSION_SECRET = ADMIN_SECRET;
    process.env.SA360_META_REVIEWER_SESSION_SECRET = SECRET;
    const issuedAt = 1_700_000_000;
    const token = createMetaReviewerSessionToken(issuedAt, SECRET, "jti-fixed-value-16");
    assert.ok(token);
    assert.ok(parseMetaReviewerSessionToken(token, issuedAt + 10, SECRET));
    assert.equal(
      parseMetaReviewerSessionToken(token, issuedAt + META_REVIEWER_SESSION_MAX_AGE_SECONDS, SECRET),
      null
    );
    assert.equal(await verifyMetaReviewerSessionTokenEdge(token, issuedAt + META_REVIEWER_SESSION_MAX_AGE_SECONDS), false);

    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    assert.equal(parseMetaReviewerSessionToken(tampered, issuedAt + 10, SECRET), null);
    assert.equal(await verifyMetaReviewerSessionTokenEdge(tampered, issuedAt + 10), false);

    const [version, body] = token.split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as { role: string };
    claims.role = "ADMIN";
    const swappedBody = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const swappedSigned = `${version}.${swappedBody}`;
    const swapped = `${swappedSigned}.${createHmac("sha256", SECRET).update(swappedSigned).digest("base64url")}`;
    assert.equal(parseMetaReviewerSessionToken(swapped, issuedAt + 10, SECRET), null);

    const adminToken = createAdminCocSessionToken(undefined, ADMIN_SECRET, ADMIN_COC_ROLE_ADMIN);
    assert.ok(adminToken);
    assert.equal(parseMetaReviewerSessionToken(adminToken, issuedAt + 10, SECRET), null);
    assert.equal(parseMetaReviewerSessionToken(adminToken, issuedAt + 10, ADMIN_SECRET), null);
    assert.equal(parseAdminCocSessionToken(token, issuedAt + 10, ADMIN_SECRET), null);
    assert.equal(parseAdminCocSessionToken(token, issuedAt + 10, SECRET), null);

    const liveReviewer = createMetaReviewerSessionToken(undefined, SECRET, "live-jti-value-016");
    assert.ok(liveReviewer);
    const guard = await import("./admin-coc-session-guard.ts");
    const reviewerGuard = await import("./meta-reviewer-guard.ts");
    guard.useAdminCocTestSessionCookie(liveReviewer!);
    reviewerGuard.useMetaReviewerTestSessionCookie("");
    assert.equal(await guard.readAdminCocSessionRole(), null);
    guard.useAdminCocTestSessionCookie(adminToken!);
    reviewerGuard.useMetaReviewerTestSessionCookie(liveReviewer!);
    assert.equal(await guard.readAdminCocSessionRole(), ADMIN_COC_ROLE_ADMIN);
    assert.equal((await reviewerGuard.readValidMetaReviewerSession())?.role, "meta_reviewer");
    guard.useAdminCocTestSessionCookie("");
    reviewerGuard.useMetaReviewerTestSessionCookie(adminToken!);
    assert.equal(await reviewerGuard.readValidMetaReviewerSession(), null);
  } finally {
    restoreEnv(snap);
    const guard = await import("./admin-coc-session-guard.ts");
    const reviewerGuard = await import("./meta-reviewer-guard.ts");
    guard.useAdminCocTestSessionCookie(undefined);
    reviewerGuard.useMetaReviewerTestSessionCookie(undefined);
  }
});

test("reviewer cookie options are httpOnly, lax, and separate from the admin cookie", () => {
  const snap = snapshotEnv();
  try {
    process.env.NODE_ENV = "production";
    process.env.SA360_META_REVIEWER_SESSION_SECRET = SECRET;
    const token = createMetaReviewerSessionToken(1_700_000_000, SECRET, "jti-fixed-value-16");
    assert.ok(token);
    const options = metaReviewerSessionCookieOptions(token);
    assert.equal(options.name, META_REVIEWER_SESSION_COOKIE);
    assert.notEqual(options.name, "sa360_admin_session");
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.secure, true);
    assert.equal(options.path, "/");
    assert.ok(options.maxAge <= 60 * 60 * 24);
    assert.ok(options.maxAge > 0);
    const clear = metaReviewerSessionCookieClearOptions();
    assert.equal(clear.name, META_REVIEWER_SESSION_COOKIE);
    assert.equal(clear.maxAge, 0);
    assert.equal(clear.httpOnly, true);
    assert.equal(clear.value, "");
  } finally {
    restoreEnv(snap);
  }
});

test("logout accepts only a same-origin POST and clears the reviewer cookie", async () => {
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin"
            ? "https://evil.example"
            : name === "host"
              ? "portal.lifeagentlaunch.com"
              : null,
      },
    }),
    false
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: { get: () => null },
    }),
    false
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin"
            ? "https://portal.lifeagentlaunch.com"
            : name === "x-forwarded-host"
              ? "portal.lifeagentlaunch.com"
              : null,
      },
    }),
    true
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin" ? "http://127.0.0.1:3000" : name === "host" ? "localhost:3000" : null,
      },
    }),
    true
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin" ? "https://evil.example" : name === "host" ? "localhost:3000" : null,
      },
    }),
    false
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin" ? "null" : name === "sec-fetch-site" ? "same-origin" : null,
      },
    }),
    true
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) => (name === "origin" ? "null" : name === "sec-fetch-site" ? "cross-site" : null),
      },
    }),
    false
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin"
            ? "http://portal.lifeagentlaunch.com"
            : name === "host"
              ? "portal.lifeagentlaunch.com"
              : null,
      },
    }),
    false
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin"
            ? "https://evil.example"
            : name === "host"
              ? "portal.lifeagentlaunch.com"
              : name === "x-forwarded-host"
                ? "evil.example, portal.lifeagentlaunch.com"
                : null,
      },
    }),
    false
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin"
            ? "https://portal.lifeagentlaunch.com"
            : name === "host"
              ? "portal.lifeagentlaunch.com"
              : name === "x-forwarded-host"
                ? "evil.example"
                : null,
      },
    }),
    true
  );
  assert.equal(
    metaReviewerLogoutOriginAllowed({
      headers: {
        get: (name) =>
          name === "origin"
            ? "https://evil.example"
            : name === "host"
              ? "portal.lifeagentlaunch.com"
              : name === "x-forwarded-host"
                ? "evil.example"
                : null,
      },
    }),
    false
  );

  const route = await import("../app/meta-review/logout/route.ts");
  const denied = await route.POST({
    url: "https://portal.lifeagentlaunch.com/meta-review/logout",
    headers: {
      get: (name: string) =>
        name === "origin"
          ? "https://evil.example"
          : name === "host"
            ? "portal.lifeagentlaunch.com"
            : null,
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("set-cookie"), null);

  const allowed = await route.POST({
    url: "https://portal.lifeagentlaunch.com/meta-review/logout",
    headers: {
      get: (name: string) =>
        name === "origin"
          ? "https://portal.lifeagentlaunch.com"
          : name === "x-forwarded-host"
            ? "portal.lifeagentlaunch.com"
            : null,
    },
  });
  assert.equal(allowed.status, 303);
  assert.equal(allowed.headers.get("location"), "/meta-review/login");
  const setCookie = allowed.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /sa360_meta_reviewer_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.doesNotMatch(setCookie, /sa360_admin_session/);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");

  const get = await route.GET();
  assert.equal(get.status, 405);
});

test("reviewer login rate limit ignores client-supplied forwarded addresses", async () => {
  const { metaReviewerLoginRateKey, metaReviewerLoginRateLimited, recordMetaReviewerLoginFailure, resetMetaReviewerLoginRateLimitForTests } =
    await import("./meta-reviewer-rate-limit.ts");
  resetMetaReviewerLoginRateLimitForTests();
  try {
    const spoofed = (forwardedFor: string) =>
      metaReviewerLoginRateKey({
        get: (name) =>
          name === "x-forwarded-for" ? forwardedFor : name === "x-real-ip" ? "198.51.100.9" : null,
      });
    assert.equal(spoofed("203.0.113.8"), META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY);
    assert.equal(spoofed("203.0.113.9"), META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY);
    const platform = metaReviewerLoginRateKey({
      get: (name) =>
        name === "do-connecting-ip"
          ? "203.0.113.10"
          : name === "x-forwarded-for"
            ? "198.51.100.4"
            : null,
    });
    assert.equal(platform, "203.0.113.10");
    assert.equal(
      metaReviewerLoginRateKey({
        get: (name) => (name === "do-connecting-ip" ? "203.0.113.10, 198.51.100.4" : null),
      }),
      META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY
    );
    assert.equal(
      metaReviewerLoginRateKey({
        get: (name) => (name === "do-connecting-ip" ? "not-an-ip" : null),
      }),
      META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY
    );

    for (let i = 0; i < 8; i++) recordMetaReviewerLoginFailure(platform);
    assert.equal(metaReviewerLoginRateLimited(platform), true);
    assert.equal(metaReviewerLoginRateLimited("203.0.113.11"), false);
    for (let i = 0; i < 24; i++) recordMetaReviewerLoginFailure(`203.0.113.${i}`);
    assert.equal(metaReviewerLoginRateLimited("203.0.113.200"), true);
  } finally {
    resetMetaReviewerLoginRateLimitForTests();
  }
});

test("reviewer can run read-only Meta review calls and cannot mutate or read customer data", async () => {
  const snap = snapshotEnv();
  const hash = await verifier();
  try {
    reviewerEnv(hash);
    const session = await import("./meta-reviewer-session.ts");
    const guard = await import("./admin-coc-session-guard.ts");
    const reviewerGuard = await import("./meta-reviewer-guard.ts");
    const token = session.createMetaReviewerSessionToken(undefined, SECRET);
    assert.ok(token);
    guard.useAdminCocTestSessionCookie("");
    reviewerGuard.useMetaReviewerTestSessionCookie(token!);

    const actions = await import("../app/actions/meta-review.ts");
    const server = await import("./admin-api/meta-review-server.ts");
    const adminApi = await import("./admin-api/server.ts");
    const clients = await import("../app/actions/clients.ts");

    const reads = await withFetchSpy(async () => {
      const pages = await actions.loadMetaReviewPagesAction();
      const permissions = await actions.loadMetaReviewPermissionsAction();
      const subscription = await actions.loadMetaReviewSubscriptionAction("10001");
      const posts = await actions.loadMetaReviewPostsAction("10001");
      const insights = await actions.loadMetaReviewInsightsAction({
        adAccountId: "act_20001",
        since: "2026-10-01",
        until: "2026-10-07",
      });
      const preflight = await server.fetchMetaReviewPreflight();
      return { pages, permissions, subscription, posts, insights, preflight };
    });
    assert.equal(reads.calls.length, 6);
    assert.equal(reads.result.pages.ok, true);
    for (const request of reads.calls) {
      assert.equal(request.headers.get("x-sa360-admin-key"), "server-side-admin-key");
      assert.equal(request.url.includes("server-side-admin-key"), false);
    }
    assert.equal(JSON.stringify(reads.result).includes("server-side-admin-key"), false);

    const write = await withFetchSpy(async () => {
      await assert.rejects(
        () =>
          actions.subscribeMetaReviewLeadgenAction({
            pageId: "10001",
            confirmed: true,
            confirmationText: "SUBSCRIBE LEADGEN",
          }),
        (error: unknown) => error instanceof guard.AdminCocForbiddenError
      );
      const proxied = await server.postMetaReviewLeadgenSubscription({
        pageId: "10001",
        confirmed: true,
        confirmationText: "SUBSCRIBE LEADGEN",
      });
      assert.equal(proxied.ok, false);
      const customer = await adminApi.adminRequestJson("GET", "/admin/v1/clients");
      assert.equal(customer.ok, false);
      if (!customer.ok) assert.equal(customer.status, 401);
      await assert.rejects(
        () => clients.fetchClientDeletionImpactAction("client-1"),
        isNextRedirect
      );
      const traversal = await server.fetchMetaReviewPosts("../admin");
      assert.equal(traversal.ok, false);
    });
    assert.equal(write.calls.length, 0);

    const adminToken = createAdminCocSessionToken(undefined, ADMIN_SECRET, ADMIN_COC_ROLE_ADMIN);
    assert.ok(adminToken);
    guard.useAdminCocTestSessionCookie(adminToken!);
    reviewerGuard.useMetaReviewerTestSessionCookie(token!);
    const adminRead = await withFetchSpy(() => actions.loadMetaReviewPagesAction());
    assert.equal(adminRead.calls.length, 1);
    assert.equal(adminRead.result.ok, true);
    const adminWrite = await withFetchSpy(() =>
      actions.subscribeMetaReviewLeadgenAction({
        pageId: "10001",
        confirmed: true,
        confirmationText: "SUBSCRIBE LEADGEN",
      })
    );
    assert.equal(adminWrite.calls.length, 1);
    assert.equal(adminWrite.result.ok, true);

    guard.useAdminCocTestSessionCookie(
      createAdminCocSessionToken(undefined, ADMIN_SECRET, ADMIN_COC_ROLE_OBSERVER)!
    );
    reviewerGuard.useMetaReviewerTestSessionCookie("");
    const observer = await withFetchSpy(async () => {
      await assert.rejects(
        () => actions.loadMetaReviewPagesAction(),
        (error: unknown) => error instanceof guard.AdminCocForbiddenError
      );
    });
    assert.equal(observer.calls.length, 0);
  } finally {
    restoreEnv(snap);
    const guard = await import("./admin-coc-session-guard.ts");
    const reviewerGuard = await import("./meta-reviewer-guard.ts");
    guard.useAdminCocTestSessionCookie(undefined);
    reviewerGuard.useMetaReviewerTestSessionCookie(undefined);
  }
});

test("reviewer surfaces do not disclose operator login or embed the admin API key", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const login = fs.readFileSync(path.join(root, "app/meta-review/login/page.tsx"), "utf8");
  const form = fs.readFileSync(
    path.join(root, "components/meta-review/meta-reviewer-login-form.tsx"),
    "utf8"
  );
  const shell = fs.readFileSync(
    path.join(root, "components/meta-review/meta-reviewer-shell.tsx"),
    "utf8"
  );
  assert.match(login, /Meta App Review Access/);
  assert.match(login, /Restricted read-only access for Meta App Review/);
  assert.doesNotMatch(login, /Central Operating Center|clients|feature flags/);
  assert.doesNotMatch(login, /href=/);
  assert.doesNotMatch(form, /NEXT_PUBLIC_|SA360_META_REVIEWER_PASSWORD|ADMIN_COC_PASSWORD/);
  assert.match(form, /Sign In/);
  assert.match(shell, /Sign Out/);
  assert.match(shell, /action="\/meta-review\/logout"/);
  assert.doesNotMatch(shell, /href=/);

  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx")
      ) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("executeAuthorizedAdminApiRequest")) {
          hits.push(path.relative(srcRoot, full).split(path.sep).join("/"));
        }
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(hits.sort(), [
    "admin-api/meta-review-server.ts",
    "admin-api/server.ts",
  ]);

  const layout = fs.readFileSync(path.join(root, "app/(dashboard)/layout.tsx"), "utf8");
  const reviewerReturn = layout.slice(layout.indexOf("if (reviewer)"), layout.indexOf("<DashboardChrome"));
  assert.match(reviewerReturn, /Forbidden/);
  assert.equal(reviewerReturn.includes("{children}"), false);
  assert.doesNotMatch(reviewerReturn, /MetaReviewerShell/);
  assert.equal(fs.existsSync(path.join(root, "app/meta-review/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(root, "app/(dashboard)/meta-review/page.tsx")), false);
  const workspace = fs.readFileSync(path.join(root, "app/meta-review/page.tsx"), "utf8");
  assert.match(workspace, /resolveMetaReviewAudience/);
  assert.match(workspace, /MetaReviewerShell/);
  assert.match(workspace, /audience === "admin" \? subscribeMetaReviewLeadgenAction : undefined/);
});
