import test from "node:test";
import assert from "node:assert/strict";
import { isRoutingMatchType, ROUTING_MATCH_TYPES } from "../lib/routing-match-type.js";

test("ROUTING_MATCH_TYPES includes campaign_id and keyword_fallback", () => {
  assert.ok(ROUTING_MATCH_TYPES.includes("campaign_id"));
  assert.ok(ROUTING_MATCH_TYPES.includes("keyword_fallback"));
});

test("isRoutingMatchType rejects invalid values", () => {
  assert.equal(isRoutingMatchType("invalid"), false);
  assert.equal(isRoutingMatchType("utm_campaign"), true);
});
