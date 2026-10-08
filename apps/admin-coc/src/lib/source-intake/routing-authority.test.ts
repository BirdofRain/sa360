import test from "node:test";
import assert from "node:assert/strict";

import { routingAuthorityLabel } from "./routing-authority.js";

test("labels confirmed source association routing", () => {
  assert.equal(
    routingAuthorityLabel("confirmed_source_association"),
    "Confirmed source association"
  );
});

test("labels campaign rule routing", () => {
  assert.equal(routingAuthorityLabel("campaign_routing_rule"), "Campaign routing rule");
});

test("preserves an unknown routing authority for diagnostics", () => {
  assert.equal(routingAuthorityLabel("future_authority"), "future_authority");
  assert.equal(routingAuthorityLabel(null), "—");
});
