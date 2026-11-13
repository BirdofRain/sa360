import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_FAILURE_SCOPE,
  deliveryFailureRefreshedLabel,
  EASTERN_TIME_ZONE,
  easternCalendarDate,
  formatEasternTimestamp,
  LEADS_RECEIVED_TODAY_GAP,
} from "./activity-snapshot.ts";

test("Eastern calendar day changes at local midnight in winter and summer", () => {
  assert.equal(EASTERN_TIME_ZONE, "America/New_York");

  assert.equal(easternCalendarDate(new Date("2026-01-15T04:59:59.999Z")), "2026-01-14");
  assert.equal(easternCalendarDate(new Date("2026-01-15T05:00:00.000Z")), "2026-01-15");
  const winterLate = formatEasternTimestamp(new Date("2026-01-15T04:59:59.999Z"));
  const winterMidnight = formatEasternTimestamp(new Date("2026-01-15T05:00:00.000Z"));
  assert.match(winterLate, /Jan 14, 2026, 11:59 PM EST/);
  assert.match(winterMidnight, /Jan 15, 2026, 12:00 AM EST/);

  assert.equal(easternCalendarDate(new Date("2026-07-15T03:59:59.999Z")), "2026-07-14");
  assert.equal(easternCalendarDate(new Date("2026-07-15T04:00:00.000Z")), "2026-07-15");
  const summerLate = formatEasternTimestamp(new Date("2026-07-15T03:59:59.999Z"));
  const summerMidnight = formatEasternTimestamp(new Date("2026-07-15T04:00:00.000Z"));
  assert.match(summerLate, /Jul 14, 2026, 11:59 PM EDT/);
  assert.match(summerMidnight, /Jul 15, 2026, 12:00 AM EDT/);
});

test("leads received today stays unsupported because no Eastern day read exists", () => {
  assert.equal(LEADS_RECEIVED_TODAY_GAP.supported, false);
  assert.equal(LEADS_RECEIVED_TODAY_GAP.timeZone, "America/New_York");
  assert.match(LEADS_RECEIVED_TODAY_GAP.summary, /omitted/);
  assert.match(LEADS_RECEIVED_TODAY_GAP.summary, /America\/New_York/);
  assert.match(LEADS_RECEIVED_TODAY_GAP.summary, /GHL lifecycle/);
  const gaps = LEADS_RECEIVED_TODAY_GAP.gaps.join("\n");
  assert.match(gaps, /receivedFrom/);
  assert.match(gaps, /duplicate_blocked/);
  assert.match(gaps, /receivedAt/);
  assert.match(gaps, /testLead/);
  assert.match(gaps, /ClientOnboardingTestRun/);
  assert.match(gaps, /summary-metrics/);
  assert.match(gaps, /UTC midnight/);
  assert.equal(easternCalendarDate(new Date("2026-11-12T04:59:59.999Z")), "2026-11-11");
  assert.equal(easternCalendarDate(new Date("2026-11-12T05:00:00.000Z")), "2026-11-12");
});

test("delivery failure scope is the current delivery_failed queue", () => {
  assert.equal(DELIVERY_FAILURE_SCOPE.status, "delivery_failed");
  assert.equal(DELIVERY_FAILURE_SCOPE.queue, "/source-intake?status=delivery_failed&liveFailure=true");
  const excluded = DELIVERY_FAILURE_SCOPE.excluded.join("\n");
  assert.match(excluded, /externalCallExecuted false/);
  assert.match(excluded, /routing_matched/);
  assert.match(excluded, /delivered/);
  assert.match(excluded, /skipped/);
  assert.match(excluded, /not_wired/);
  assert.match(excluded, /duplicate_blocked/);
  assert.match(DELIVERY_FAILURE_SCOPE.included, /requeue/);
});

test("refresh label uses the Eastern timestamp of a successful read", () => {
  assert.equal(
    deliveryFailureRefreshedLabel("2026-01-15T05:00:00.000Z"),
    "Refreshed Jan 15, 2026, 12:00 AM EST"
  );
  assert.equal(deliveryFailureRefreshedLabel("not-a-time"), "Refreshed time unavailable");
});
