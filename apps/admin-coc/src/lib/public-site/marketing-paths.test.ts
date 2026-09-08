import assert from "node:assert/strict";
import test from "node:test";

import { isPublicMarketingPath, PUBLIC_MARKETING_LANDING_PATH } from "./marketing-paths.ts";

test("get-started is a public marketing path", () => {
  assert.equal(PUBLIC_MARKETING_LANDING_PATH, "/get-started");
  assert.equal(isPublicMarketingPath("/get-started"), true);
  assert.equal(isPublicMarketingPath("/get-started/"), true);
  assert.equal(isPublicMarketingPath("/get-started/preview"), true);
});

test("admin and portal routes are not public marketing paths", () => {
  assert.equal(isPublicMarketingPath("/"), false);
  assert.equal(isPublicMarketingPath("/login"), false);
  assert.equal(isPublicMarketingPath("/portal"), false);
  assert.equal(isPublicMarketingPath("/portal/login"), false);
  assert.equal(isPublicMarketingPath("/clients"), false);
});
