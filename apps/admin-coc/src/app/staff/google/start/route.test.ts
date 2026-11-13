import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "./route.ts";

const ENV = {
  SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
  SA360_STAFF_GOOGLE_CLIENT_ID: "staff-test-client.apps.googleusercontent.com",
  SA360_STAFF_GOOGLE_CLIENT_SECRET: "staff-test-client-secret",
  SA360_STAFF_GOOGLE_REDIRECT_URI: "https://portal.lifeagentlaunch.com/staff/google/callback",
  SA360_STAFF_SESSION_SECRET: "staff-session-secret-at-least-32-characters",
  SA360_STAFF_GOOGLE_SERVICE_SECRET: "staff-google-service-secret-32-characters",
};

function withEnv(run: () => Promise<void>): Promise<void> {
  const previous = {
    SA360_STAFF_GOOGLE_SIGNIN_ENABLED: process.env.SA360_STAFF_GOOGLE_SIGNIN_ENABLED,
    SA360_STAFF_GOOGLE_CLIENT_ID: process.env.SA360_STAFF_GOOGLE_CLIENT_ID,
    SA360_STAFF_GOOGLE_CLIENT_SECRET: process.env.SA360_STAFF_GOOGLE_CLIENT_SECRET,
    SA360_STAFF_GOOGLE_REDIRECT_URI: process.env.SA360_STAFF_GOOGLE_REDIRECT_URI,
    SA360_STAFF_SESSION_SECRET: process.env.SA360_STAFF_SESSION_SECRET,
    SA360_STAFF_GOOGLE_SERVICE_SECRET: process.env.SA360_STAFF_GOOGLE_SERVICE_SECRET,
  };
  Object.assign(process.env, ENV);
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("the previous host redirects to the branded start without a state cookie", async () => {
  await withEnv(async () => {
    const response = await GET(
      new NextRequest("https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/start", {
        headers: { host: "sa360-api-staging-coo57.ondigitalocean.app" },
      })
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://portal.lifeagentlaunch.com/staff/google/start");
    assert.equal(response.cookies.getAll().length, 0);
  });
});

test("the branded host starts google oauth and binds the branded callback", async () => {
  await withEnv(async () => {
    const response = await GET(
      new NextRequest("https://portal.lifeagentlaunch.com/staff/google/start", {
        headers: { host: "portal.lifeagentlaunch.com" },
      })
    );
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.origin, "https://accounts.google.com");
    assert.equal(location.searchParams.get("redirect_uri"), ENV.SA360_STAFF_GOOGLE_REDIRECT_URI);
    assert.equal(response.cookies.get("sa360_staff_google_state")?.path, "/staff/google");
  });
});
