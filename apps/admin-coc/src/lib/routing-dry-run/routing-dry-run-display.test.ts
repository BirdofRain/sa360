import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecisionItem } from "./types";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";
import {
  confidenceBadgeClass,
  destinationClientLabel,
  displayLeadEmail,
  displayLeadLabel,
  displayLeadPhone,
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

test("displayLeadLabel falls back to attributionSnapshot lead identity", () => {
  const label = displayLeadLabel(
    row({
      leadIdentity: null,
      attributionSnapshot: {
        leadIdentity: {
          leadName: "Sam Tester",
          firstName: "Sam",
          lastName: "Tester",
          phone: "+15550100111",
          email: "sam.canary.tester.003@example.test",
        },
      },
    })
  );
  assert.equal(label, "Sam Tester");
});

test("displayLeadPhone and displayLeadEmail fall back to attributionSnapshot", () => {
  const sample = row({
    leadIdentity: null,
    attributionSnapshot: {
      leadIdentity: {
        firstName: "Sam",
        lastName: "Tester",
        phone: "+15550100111",
        email: "sam.canary.tester.003@example.test",
      },
    },
  });
  assert.equal(displayLeadPhone(sample), "+15550100111");
  assert.equal(displayLeadEmail(sample), "sam.canary.tester.003@example.test");
});

test("display lead fields can fall back from attributionSnapshot raw payload", () => {
  const sample = row({
    leadIdentity: null,
    attributionSnapshot: {
      raw: {
        client_name: "Raw Identity Name",
        phone: "+15550100113",
        email: "raw.identity@example.test",
      },
    },
  });
  assert.equal(displayLeadLabel(sample), "Raw Identity Name");
  assert.equal(displayLeadPhone(sample), "+15550100113");
  assert.equal(displayLeadEmail(sample), "raw.identity@example.test");
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
