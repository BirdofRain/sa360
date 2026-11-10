import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { createStaffEnrollmentSecret } from "@sa360/shared/staff-enrollment";

import { GET, POST } from "./route.js";

const SECRET = createStaffEnrollmentSecret();

test("a query-string invitation is rejected and is not copied into the response", async () => {
  const response = await GET(new NextRequest(`https://admin.example/staff/google/enroll/start?enrollment=${SECRET}`));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.text()).includes(SECRET), false);
});

test("the enrollment form does not accept the secret from the query string", async () => {
  const keys = [
    "SA360_STAFF_ENROLLMENT_ENABLED",
    "SA360_STAFF_GOOGLE_CLIENT_ID",
    "SA360_STAFF_GOOGLE_CLIENT_SECRET",
    "SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI",
    "SA360_STAFF_SESSION_SECRET",
    "SA360_STAFF_GOOGLE_SERVICE_SECRET",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SA360_STAFF_ENROLLMENT_ENABLED = "true";
  process.env.SA360_STAFF_GOOGLE_CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
  process.env.SA360_STAFF_GOOGLE_CLIENT_SECRET = "staff-client-secret-value";
  process.env.SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI = "https://admin.example/staff/google/enroll/callback";
  process.env.SA360_STAFF_SESSION_SECRET = "staff-session-secret-at-least-32-characters";
  process.env.SA360_STAFF_GOOGLE_SERVICE_SECRET = "staff-google-service-secret-32-characters";
  try {
    const form = await GET(new NextRequest("https://admin.example/staff/google/enroll/start"));
    assert.equal(form.status, 200);
    const html = await form.text();
    assert.equal(html.includes("method=\"post\""), true);
    assert.equal(html.includes(SECRET), false);
    const posted = await POST(
      new NextRequest("https://admin.example/staff/google/enroll/start?enrollment=" + SECRET, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ enrollment: SECRET }),
      })
    );
    assert.equal(posted.status, 404);
    assert.equal((await posted.text()).includes(SECRET), false);
    assert.equal(posted.headers.get("set-cookie"), null);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
