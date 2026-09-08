import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicMarketingPath,
  isPublicOnboardingPath,
  isPublicUnauthenticatedMarketingPath,
  PUBLIC_MARKETING_LANDING_PATH,
  PUBLIC_REGISTER_PATH,
  PUBLIC_SETUP_PATH,
} from "./marketing-paths.ts";

test("get-started is a public marketing path", () => {
  assert.equal(PUBLIC_MARKETING_LANDING_PATH, "/get-started");
  assert.equal(PUBLIC_REGISTER_PATH, "/get-started/register");
  assert.equal(PUBLIC_SETUP_PATH, "/get-started/setup");
  assert.equal(isPublicMarketingPath("/get-started"), true);
  assert.equal(isPublicMarketingPath("/get-started/"), true);
  assert.equal(isPublicMarketingPath("/get-started/preview"), true);
  assert.equal(isPublicMarketingPath("/get-started/register"), true);
  assert.equal(isPublicMarketingPath("/get-started/setup"), true);
  assert.equal(isPublicUnauthenticatedMarketingPath("/get-started"), true);
  assert.equal(isPublicUnauthenticatedMarketingPath("/get-started/register"), true);
  assert.equal(isPublicUnauthenticatedMarketingPath("/get-started/setup"), false);
  assert.equal(isPublicOnboardingPath("/get-started/setup"), true);
  assert.equal(isPublicOnboardingPath("/get-started/setup/"), true);
  assert.equal(isPublicOnboardingPath("/get-started/register"), false);
});

test("admin and portal routes are not public marketing paths", () => {
  assert.equal(isPublicMarketingPath("/"), false);
  assert.equal(isPublicMarketingPath("/login"), false);
  assert.equal(isPublicMarketingPath("/portal"), false);
  assert.equal(isPublicMarketingPath("/portal/login"), false);
  assert.equal(isPublicMarketingPath("/clients"), false);
});
