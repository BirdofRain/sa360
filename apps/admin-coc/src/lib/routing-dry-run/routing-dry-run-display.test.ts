import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecisionItem } from "./types";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";
import {
  confidenceBadgeClass,
  destinationClientLabel,
  displayLeadLabel,
  matchBadgeClass,
  matchStatusLabel,
} from "./routing-dry-run-display.ts";

function row(partial: Partial<RoutingDryRunDecisionItem>): RoutingDryRunDecisionItem {
  return routingDryRunDecisionFixture(partial);
}

test("matchStatusLabel for matched and review decisions", () => {
  assert.equal(matchStatusLabel(row({ matched: true })), "Matched");
  assert.equal(matchStatusLabel(row({ matched: false })), "Review required");
});

test("confidenceBadgeClass uses green for high matched confidence", () => {
  assert.ok(confidenceBadgeClass("high", true).includes("emerald"));
  assert.ok(confidenceBadgeClass("none", false).includes("amber"));
});

test("matchBadgeClass distinguishes matched vs unmatched", () => {
  assert.ok(matchBadgeClass(true).includes("emerald"));
  assert.ok(matchBadgeClass(false).includes("amber"));
});

test("displayLeadLabel prefers identity display name", () => {
  const label = displayLeadLabel(
    row({
      leadIdentity: {
        contactIdGhl: "ct_1",
        firstName: "Alex",
        lastName: "Rivera",
        displayName: "Alex Rivera",
        phoneE164: null,
        email: null,
      },
    })
  );
  assert.equal(label, "Alex Rivera");
});

test("destinationClientLabel prefers matched rule display name", () => {
  assert.equal(
    destinationClientLabel(
      row({
        matchedRuleSummary: {
          id: "r1",
          clientDisplayName: "Agent A",
          clientAccountId: "client_a",
          nicheKey: null,
          productType: null,
          matchType: "campaign_id",
        },
      })
    ),
    "Agent A"
  );
});
