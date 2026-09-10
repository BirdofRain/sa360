import assert from "node:assert/strict";
import test from "node:test";

import { isOriginClientBuyerIneligible } from "./origin-client-exclusion.js";

test("confirmed origin client is ineligible to buy its own aged lead", () => {
  assert.equal(isOriginClientBuyerIneligible("client_madison", "client_madison"), true);
});

test("unrelated buyer remains eligible", () => {
  assert.equal(isOriginClientBuyerIneligible("client_madison", "client_other"), false);
});

test("null or blank origin remains eligible", () => {
  assert.equal(isOriginClientBuyerIneligible(null, "client_madison"), false);
  assert.equal(isOriginClientBuyerIneligible(undefined, "client_madison"), false);
  assert.equal(isOriginClientBuyerIneligible("  ", "client_madison"), false);
  assert.equal(isOriginClientBuyerIneligible("client_madison", "  "), false);
});
