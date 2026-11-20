import assert from "node:assert/strict";
import test from "node:test";

import { readDeliveryHealthConfig } from "./config.js";
import { scrubDeliveryHealthText } from "./evidence.js";
import {
  monitorFollowUp,
  monitorNoticeAlreadySent,
  monitorNoticeKey,
  type DeliveryHealthHeartbeatSnapshot,
} from "./heartbeat.js";
import { composeDeliveryHealthEmail, composeMonitorHeartbeatEmail, planDeliveryHealthNotice } from "./notify.js";

const NOW = new Date("2026-11-20T18:00:00.000Z");

function prior(overrides: Partial<DeliveryHealthHeartbeatSnapshot> = {}): DeliveryHealthHeartbeatSnapshot {
  return {
    lastStartedAt: new Date(NOW.getTime() - 60_000),
    lastSucceededAt: new Date(NOW.getTime() - 60_000),
    lastFailedAt: null,
    consecutiveFailures: 0,
    lastError: null,
    lastMonitorNotifiedAt: null,
    lastMonitorNotificationKey: null,
    ...overrides,
  };
}

test("monitor and notify flags require the exact string true", () => {
  const off = readDeliveryHealthConfig({});
  assert.equal(off.monitorEnabled, false);
  assert.equal(off.notifyEnabled, false);
  const noisy = readDeliveryHealthConfig({
    SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "TRUE",
    SA360_DELIVERY_HEALTH_NOTIFY_ENABLED: "1",
  });
  assert.equal(noisy.monitorEnabled, false);
  assert.equal(noisy.notifyEnabled, false);
  const on = readDeliveryHealthConfig({
    SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
    SA360_DELIVERY_HEALTH_NOTIFY_ENABLED: "true",
    SA360_DELIVERY_HEALTH_PILOT_CLIENT_IDS: "acct_ray, Ray Rodriguez, acct_ray",
    SA360_DELIVERY_HEALTH_NOTIFY_RECIPIENTS: "Ops@Example.com, not-an-email",
  });
  assert.equal(on.monitorEnabled, true);
  assert.equal(on.notifyEnabled, true);
  assert.deepEqual(on.pilotClientIds, ["acct_ray"]);
  assert.equal(on.pilotIdsRejected, 1);
  assert.deepEqual(on.recipients, ["ops@example.com"]);
  assert.equal(JSON.stringify(on).includes("Ray Rodriguez"), false);
});

test("notice planning dedupes, escalates, reminds, and recovers", () => {
  const base = {
    incidentId: "inc_1",
    severity: "warning" as const,
    now: NOW,
    cooldownMs: 60 * 60 * 1000,
    phase: "open" as const,
    closure: "cleared" as const,
    previous: {
      lastNotifiedAt: null,
      lastNotificationKey: null,
      lastNotificationKind: null,
      lastNotifiedSeverity: null,
      acknowledgedAt: null,
    },
  };
  const opened = planDeliveryHealthNotice(base);
  assert.equal(opened?.kind, "opened");
  assert.equal(opened?.key, "dh:inc_1:opened:warning");
  const again = planDeliveryHealthNotice({
    ...base,
    previous: {
      ...base.previous,
      lastNotifiedAt: new Date(NOW.getTime() - 60_000),
      lastNotificationKey: opened?.key ?? "",
      lastNotificationKind: "opened",
      lastNotifiedSeverity: "warning",
    },
  });
  assert.equal(again, null);
  const escalated = planDeliveryHealthNotice({
    ...base,
    severity: "critical",
    previous: {
      ...base.previous,
      lastNotifiedAt: new Date(NOW.getTime() - 60_000),
      lastNotificationKey: "dh:inc_1:opened:warning",
      lastNotificationKind: "opened",
      lastNotifiedSeverity: "warning",
    },
  });
  assert.equal(escalated?.kind, "escalated");
  const reminded = planDeliveryHealthNotice({
    ...base,
    now: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    previous: {
      ...base.previous,
      lastNotifiedAt: NOW,
      lastNotificationKey: "dh:inc_1:opened:warning",
      lastNotificationKind: "opened",
      lastNotifiedSeverity: "warning",
    },
  });
  assert.equal(reminded?.kind, "reminder");
  const acknowledged = planDeliveryHealthNotice({
    ...base,
    now: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    previous: {
      ...base.previous,
      lastNotifiedAt: NOW,
      lastNotificationKey: "dh:inc_1:opened:warning",
      lastNotificationKind: "opened",
      lastNotifiedSeverity: "warning",
      acknowledgedAt: NOW,
    },
  });
  assert.equal(acknowledged, null);
  const recovered = planDeliveryHealthNotice({
    ...base,
    phase: "resolved",
    previous: {
      ...base.previous,
      lastNotifiedAt: NOW,
      lastNotificationKey: "dh:inc_1:opened:warning",
      lastNotificationKind: "opened",
      lastNotifiedSeverity: "warning",
    },
  });
  assert.equal(recovered?.kind, "recovered");
  const neverSent = planDeliveryHealthNotice({ ...base, phase: "resolved" });
  assert.equal(neverSent, null);
});

test("alert text keeps ids and drops contact values and secrets", () => {
  const email = composeDeliveryHealthEmail({
    kind: "opened",
    severity: "critical",
    failureClass: "uncertain_append",
    clientAccountId: "acct_ray",
    affectedCount: 1,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    closure: null,
    subjects: [
      {
        sourceLeadEventId: "lead_1",
        dispatchIntentId: "intent_1",
        jobId: "job_1",
        jobStatus: "uncertain",
        code: "append_outcome_unknown",
        routingDryRunDecisionId: null,
        webhookRequestLogId: null,
      },
    ],
  });
  assert.match(email.text, /acct_ray/);
  assert.match(email.text, /lead_1/);
  assert.match(email.text, /does not call Google/);
  assert.equal(email.text.includes("lead@example.com"), false);
  const poisoned = scrubDeliveryHealthText("Bearer secret-token lead@example.com 555-010-0199");
  assert.equal(poisoned.includes("secret-token"), false);
  assert.equal(poisoned.includes("lead@example.com"), false);
  const monitor = composeMonitorHeartbeatEmail({
    reason: "scanner_failed",
    consecutiveFailures: 1,
    detail: poisoned,
  });
  assert.equal(monitor.text.includes("secret-token"), false);
  assert.equal(monitor.text.includes("lead@"), false);
});

test("a stale heartbeat is independent of a fresh success", () => {
  assert.equal(monitorFollowUp({ prior: null, now: NOW, staleMs: 300_000, succeeded: true }), null);
  assert.equal(
    monitorFollowUp({ prior: prior(), now: NOW, staleMs: 300_000, succeeded: true }),
    null
  );
  assert.equal(
    monitorFollowUp({
      prior: prior({ lastSucceededAt: new Date(NOW.getTime() - 600_000), lastStartedAt: new Date(NOW.getTime() - 600_000) }),
      now: NOW,
      staleMs: 300_000,
      succeeded: true,
    }),
    "heartbeat_stale"
  );
  const failed = prior({
    consecutiveFailures: 2,
    lastFailedAt: new Date(NOW.getTime() - 30_000),
    lastMonitorNotifiedAt: new Date(NOW.getTime() - 30_000),
    lastMonitorNotificationKey: "dh-monitor:scanner_failed:1",
  });
  assert.equal(monitorFollowUp({ prior: failed, now: NOW, staleMs: 300_000, succeeded: true }), "recovered");
  assert.equal(monitorFollowUp({ prior: failed, now: NOW, staleMs: 300_000, succeeded: false }), "scanner_failed");
  const key = monitorNoticeKey({ reason: "scanner_failed", now: NOW, cooldownMs: 3_600_000, prior: failed });
  assert.equal(monitorNoticeKey({ reason: "scanner_failed", now: NOW, cooldownMs: 3_600_000, prior: failed }), key);
  const timestampOnly = prior({
    consecutiveFailures: 2,
    lastMonitorNotifiedAt: new Date(NOW.getTime() - 30_000),
    lastMonitorNotificationKey: "dh-monitor:scanner_failed:1",
  });
  assert.equal(monitorNoticeAlreadySent(timestampOnly, "dh-monitor:scanner_failed:2"), false);
  assert.equal(monitorNoticeAlreadySent(timestampOnly, "dh-monitor:scanner_failed:1"), true);
  assert.equal(
    monitorFollowUp({
      prior: prior({
        consecutiveFailures: 0,
        lastFailedAt: new Date(NOW.getTime() - 60_000),
        lastMonitorNotifiedAt: new Date(NOW.getTime() - 60_000),
        lastMonitorNotificationKey: "dh-monitor:scanner_failed:1",
      }),
      now: NOW,
      staleMs: 300_000,
      succeeded: true,
    }),
    "recovered"
  );
  assert.equal(
    monitorFollowUp({
      prior: prior({
        consecutiveFailures: 0,
        lastMonitorNotifiedAt: NOW,
        lastMonitorNotificationKey: "dh-monitor:recovered:2026-11-20T17:59:00.000Z",
      }),
      now: NOW,
      staleMs: 300_000,
      succeeded: true,
    }),
    null
  );
});
