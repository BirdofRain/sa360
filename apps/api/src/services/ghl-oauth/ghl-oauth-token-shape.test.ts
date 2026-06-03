import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGhlOAuthTokenResponseSafeShape,
  inferGhlOAuthTokenLevel,
} from "./ghl-oauth-token-shape.js";

test("buildGhlOAuthTokenResponseSafeShape exposes presence flags only", () => {
  const shape = buildGhlOAuthTokenResponseSafeShape({
    userType: "Company",
    companyId: "co_1",
    locationId: null,
    userId: "user_1",
    scopes: ["contacts.readonly"],
    appId: "app_1",
    tokenType: "Bearer",
    expiresIn: 3600,
  });
  assert.equal(shape.userType, "Company");
  assert.equal(shape.companyIdPresent, true);
  assert.equal(shape.locationIdPresent, false);
  assert.equal(shape.userIdPresent, true);
  assert.equal(shape.scopePresent, true);
  assert.equal(shape.tokenTypePresent, true);
  assert.equal(shape.expiresInPresent, true);
  assert.equal(shape.appIdPresent, true);
  assert.equal(inferGhlOAuthTokenLevel(shape), "company_or_agency");
});

test("inferGhlOAuthTokenLevel detects location token", () => {
  const shape = buildGhlOAuthTokenResponseSafeShape({
    userType: "Location",
    companyId: "co_1",
    locationId: "loc_1",
    userId: null,
    scopes: [],
    appId: null,
    tokenType: null,
    expiresIn: null,
  });
  assert.equal(inferGhlOAuthTokenLevel(shape), "location");
});
