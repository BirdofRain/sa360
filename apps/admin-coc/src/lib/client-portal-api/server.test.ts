import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_PORTAL_KEY_HEADER,
  getClientPortalApiKey,
  isClientPortalApiConfigured,
} from "./keys.ts";

test("getClientPortalApiKey is server-only env", () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-key-test";
  assert.equal(getClientPortalApiKey(), "portal-key-test");
  assert.notEqual(CLIENT_PORTAL_KEY_HEADER, "x-sa360-admin-key");
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("isClientPortalApiConfigured false without API base URL", () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevL = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.CLIENT_PORTAL_API_KEY = "key";
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  assert.equal(isClientPortalApiConfigured(), false);
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  if (prevL !== undefined) process.env.NEXT_PUBLIC_API_BASE_URL = prevL;
});
