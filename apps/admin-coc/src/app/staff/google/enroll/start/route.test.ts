import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { createStaffEnrollmentSecret } from "@sa360/shared/staff-enrollment";

import { GET, POST } from "./route.js";

const SECRET = createStaffEnrollmentSecret();
const KEYS = [
  "SA360_STAFF_ENROLLMENT_ENABLED",
  "SA360_STAFF_GOOGLE_CLIENT_ID",
  "SA360_STAFF_GOOGLE_CLIENT_SECRET",
  "SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI",
  "SA360_STAFF_SESSION_SECRET",
  "SA360_STAFF_GOOGLE_SERVICE_SECRET",
  "SA360_API_INTERNAL_URL",
] as const;

function configure(apiOrigin?: string) {
  const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.SA360_STAFF_ENROLLMENT_ENABLED = "true";
  process.env.SA360_STAFF_GOOGLE_CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
  process.env.SA360_STAFF_GOOGLE_CLIENT_SECRET = "staff-client-secret-value";
  process.env.SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI = "https://admin.example/staff/google/enroll/callback";
  process.env.SA360_STAFF_SESSION_SECRET = "staff-session-secret-at-least-32-characters";
  process.env.SA360_STAFF_GOOGLE_SERVICE_SECRET = "staff-google-service-secret-32-characters";
  if (apiOrigin) process.env.SA360_API_INTERNAL_URL = apiOrigin;
  else delete process.env.SA360_API_INTERNAL_URL;
  return () => {
    for (const key of KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function formRequest(input: { origin?: string | null; headers?: Record<string, string>; body?: string | Uint8Array; url?: string }) {
  const presented: Record<string, string> = { ...(input.headers ?? {}) };
  if (!("content-type" in presented)) presented["content-type"] = "application/x-www-form-urlencoded";
  if (input.origin !== undefined && input.origin !== null) presented.origin = input.origin;
  const safe = new Headers();
  if (presented["content-type"]) safe.set("content-type", presented["content-type"]);
  const request = new NextRequest(input.url ?? "https://admin.example/staff/google/enroll/start", {
    method: "POST",
    headers: safe,
    body: input.body ?? `enrollment=${SECRET}`,
  });
  // Fetch forbids a test from setting Origin, Host, and Content-Length. The
  // route still reads those headers, so the test presents the values a browser
  // or the platform would send.
  const headers = new Proxy(request.headers, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return (name: string) => {
          const key = name.toLowerCase();
          if (Object.prototype.hasOwnProperty.call(presented, key)) return presented[key] ?? null;
          return target.get(name);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(request, {
    get(target, prop, receiver) {
      if (prop === "headers") return headers;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as NextRequest;
}

test("a query-string invitation is rejected and is not copied into the response", async () => {
  const response = await GET(new NextRequest(`https://admin.example/staff/google/enroll/start?enrollment=${SECRET}`));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await response.text()).includes(SECRET), false);
});

test("enrollment stays unavailable when the feature is not configured", async () => {
  const response = await POST(
    formRequest({
      origin: "https://evil.example",
      headers: { "sec-fetch-site": "cross-site", "content-length": "999999" },
    })
  );
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes(SECRET), false);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("the enrollment form does not accept the secret from the query string", async () => {
  const restore = configure();
  try {
    const form = await GET(new NextRequest("https://admin.example/staff/google/enroll/start"));
    assert.equal(form.status, 200);
    assert.equal(form.headers.get("cache-control"), "no-store");
    assert.equal(form.headers.get("referrer-policy"), "no-referrer");
    const html = await form.text();
    assert.equal(html.includes("method=\"post\""), true);
    assert.equal(html.includes(SECRET), false);
    const posted = await POST(
      formRequest({
        url: `https://admin.example/staff/google/enroll/start?enrollment=${SECRET}`,
        origin: "https://admin.example",
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      })
    );
    assert.equal(posted.status, 404);
    assert.equal((await posted.text()).includes(SECRET), false);
    assert.equal(posted.headers.get("set-cookie"), null);
  } finally {
    restore();
  }
});

test("a same-origin enrollment form redirects to Google without exposing the secret", async () => {
  const restore = configure("http://127.0.0.1:9");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.equal(url.includes(SECRET), false);
    assert.equal(url.endsWith("/internal/staff/enrollment/preview"), true);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const posted = await POST(
      formRequest({
        headers: {
          origin: "null",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      })
    );
    assert.equal(posted.status, 303);
    const location = posted.headers.get("location") ?? "";
    assert.equal(location.startsWith("https://accounts.google.com/"), true);
    assert.equal(location.includes(SECRET), false);
    const cookie = posted.headers.get("set-cookie") ?? "";
    assert.equal(cookie.includes("sa360_staff_google_enroll="), true);
    assert.equal(cookie.includes(SECRET), false);
    assert.equal(posted.headers.get("cache-control"), "no-store");
    assert.equal(posted.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await posted.text()).includes(SECRET), false);
    const matchedOrigin = await POST(
      formRequest({
        origin: "https://admin.example",
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      })
    );
    assert.equal(matchedOrigin.status, 303);
    assert.equal((matchedOrigin.headers.get("location") ?? "").includes(SECRET), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("cross-origin, malformed, and oversized enrollment posts are rejected", async () => {
  const restore = configure();
  try {
    const cases: Array<{ label: string; request: NextRequest; status: number }> = [
      { label: "missing origin", request: formRequest({}), status: 403 },
      { label: "cross origin", request: formRequest({ origin: "https://evil.example" }), status: 403 },
      {
        label: "forwarded host does not replace a public host",
        request: formRequest({
          origin: "https://evil.example",
          headers: { host: "admin.example", "x-forwarded-host": "evil.example" },
        }),
        status: 403,
      },
      {
        label: "literal null origin without fetch metadata",
        request: formRequest({ origin: null, headers: { origin: "null" } }),
        status: 403,
      },
      {
        label: "cross-site fetch metadata",
        request: formRequest({ origin: "https://admin.example", headers: { "sec-fetch-site": "cross-site" } }),
        status: 403,
      },
      {
        label: "non-navigation mode",
        request: formRequest({
          origin: "https://admin.example",
          headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
        }),
        status: 403,
      },
      {
        label: "multipart",
        request: formRequest({ origin: "https://admin.example", headers: { "content-type": "multipart/form-data; boundary=x" } }),
        status: 403,
      },
      {
        label: "json",
        request: formRequest({ origin: "https://admin.example", headers: { "content-type": "application/json" } }),
        status: 403,
      },
      {
        label: "missing content type",
        request: formRequest({ origin: "https://admin.example", headers: { "content-type": "" } }),
        status: 403,
      },
      {
        label: "declared oversized body",
        request: formRequest({ origin: "https://admin.example", headers: { "content-length": "4096" } }),
        status: 403,
      },
      {
        label: "undeclared oversized body",
        request: formRequest({ origin: "https://admin.example", body: `enrollment=${"a".repeat(200)}` }),
        status: 403,
      },
      {
        label: "duplicate field",
        request: formRequest({ origin: "https://admin.example", body: `enrollment=${SECRET}&enrollment=${SECRET}` }),
        status: 404,
      },
      {
        label: "unexpected field",
        request: formRequest({ origin: "https://admin.example", body: `enrollment=${SECRET}&next=/admin` }),
        status: 404,
      },
      {
        label: "malformed secret",
        request: formRequest({ origin: "https://admin.example", body: "enrollment=not-a-secret" }),
        status: 404,
      },
      {
        label: "trailing ampersand",
        request: formRequest({ origin: "https://admin.example", body: `enrollment=${SECRET}&` }),
        status: 404,
      },
      {
        label: "leading ampersand",
        request: formRequest({ origin: "https://admin.example", body: `&enrollment=${SECRET}` }),
        status: 404,
      },
      {
        label: "repeated empty segments",
        request: formRequest({ origin: "https://admin.example", body: `&&enrollment=${SECRET}&&` }),
        status: 404,
      },
    ];
    for (const item of cases) {
      const response = await POST(item.request);
      const body = await response.text();
      assert.equal(response.status, item.status, item.label);
      assert.equal(body.includes(SECRET), false, item.label);
      assert.equal(response.headers.get("location"), null, item.label);
      assert.equal(response.headers.get("set-cookie"), null, item.label);
      assert.equal(response.headers.get("cache-control"), "no-store", item.label);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer", item.label);
    }
  } finally {
    restore();
  }
});

test("invalid UTF-8 and empty form segments never start enrollment", async () => {
  const restore = configure("http://127.0.0.1:9");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const invalidUtf8 = new Uint8Array(SECRET.length + "enrollment=".length);
    invalidUtf8.set(new TextEncoder().encode(`enrollment=${SECRET}`));
    invalidUtf8[invalidUtf8.length - 1] = 0xff;
    const rejected: Array<{ label: string; body: string | Uint8Array; status: number }> = [
      { label: "invalid utf-8", body: invalidUtf8, status: 403 },
      { label: "trailing ampersand", body: `enrollment=${SECRET}&`, status: 404 },
      { label: "leading ampersand", body: `&enrollment=${SECRET}`, status: 404 },
      { label: "repeated empty segments", body: `enrollment=${SECRET}&&`, status: 404 },
    ];
    for (const item of rejected) {
      const response = await POST(
        formRequest({
          origin: "https://admin.example",
          headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
          body: item.body,
        })
      );
      const text = await response.text();
      assert.equal(response.status, item.status, item.label);
      assert.equal(text === "Forbidden" || text === "Not Found", true, item.label);
      assert.equal(text.includes(SECRET), false, item.label);
      assert.equal(response.headers.get("location"), null, item.label);
      assert.equal(calls, 0, item.label);
    }
    const accepted = await POST(
      formRequest({
        origin: "https://admin.example",
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
        body: `enrollment=${SECRET}`,
      })
    );
    assert.equal(accepted.status, 303);
    assert.equal((accepted.headers.get("location") ?? "").startsWith("https://accounts.google.com/"), true);
    assert.equal((accepted.headers.get("location") ?? "").includes(SECRET), false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
