import test from "node:test";
import assert from "node:assert/strict";

import { presentSourceLeadRouting } from "./source-lead-routing.present.js";

test("presents a confirmed source association as matched without a routing rule", () => {
  assert.deepEqual(
    presentSourceLeadRouting({
      routingResultJson: {
        matched: true,
        routingAuthority: "confirmed_source_association",
      },
      clientAccountIdResolved: "jean_perez",
      routingRuleIdResolved: null,
    }),
    {
      matched: true,
      routingAuthority: "confirmed_source_association",
    }
  );
});

test("presents a campaign rule match", () => {
  assert.deepEqual(
    presentSourceLeadRouting({
      routingResultJson: {
        matched: true,
        routingAuthority: "campaign_routing_rule",
      },
      clientAccountIdResolved: "client_a",
      routingRuleIdResolved: "rule_a",
    }),
    {
      matched: true,
      routingAuthority: "campaign_routing_rule",
    }
  );
});

test("presents an explicit routing miss as unmatched", () => {
  assert.equal(
    presentSourceLeadRouting({
      routingResultJson: { matched: false },
      clientAccountIdResolved: null,
      routingRuleIdResolved: null,
    }).matched,
    false
  );
});

test("preserves the historical rule and destination fallback", () => {
  assert.equal(
    presentSourceLeadRouting({
      routingResultJson: null,
      clientAccountIdResolved: "legacy_client",
      routingRuleIdResolved: "legacy_rule",
    }).matched,
    true
  );
});

test("does not present an explicit match without a persisted destination", () => {
  assert.equal(
    presentSourceLeadRouting({
      routingResultJson: { matched: true },
      clientAccountIdResolved: null,
      routingRuleIdResolved: null,
    }).matched,
    false
  );
});
