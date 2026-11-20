/**
 * Internal delivery-health notices. Recipients come from configuration.
 * The body lists ids and machine codes. sendTransactionalEmail is the only sender.
 */

import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import {
  scrubDeliveryHealthText,
  type DeliveryHealthSubject,
} from "./evidence.js";
import type { DeliveryHealthSeverity } from "./rules.js";

export type DeliveryHealthNoticeKind = "opened" | "escalated" | "reminder" | "recovered";

export type DeliveryHealthNoticeState = {
  lastNotifiedAt: Date | null;
  lastNotificationKey: string | null;
  lastNotificationKind: string | null;
  lastNotifiedSeverity: string | null;
  acknowledgedAt: Date | null;
};

export type DeliveryHealthNoticePlan = {
  kind: DeliveryHealthNoticeKind;
  key: string;
};

export function planDeliveryHealthNotice(input: {
  incidentId: string;
  severity: DeliveryHealthSeverity;
  now: Date;
  cooldownMs: number;
  phase: "open" | "resolved";
  closure: "cleared" | "suppressed";
  previous: DeliveryHealthNoticeState;
}): DeliveryHealthNoticePlan | null {
  const previous = input.previous;
  const pending = previous.lastNotificationKey && !previous.lastNotifiedAt ? previous.lastNotificationKey : null;

  if (input.phase === "resolved") {
    if (previous.lastNotificationKind === "recovered" && previous.lastNotifiedAt) return null;
    if (!previous.lastNotifiedAt && !pending) return null;
    const key = pending?.includes(":recovered") ? pending : `dh:${input.incidentId}:recovered`;
    return { kind: "recovered", key };
  }

  const desired = desiredOpenNotice(input);
  if (!desired) return null;
  if (previous.lastNotifiedAt && previous.lastNotificationKey === desired.key) return null;
  if (
    pending &&
    (desired.kind === "opened" || desired.kind === "reminder") &&
    pending.startsWith(`dh:${input.incidentId}:${desired.kind}`)
  ) {
    return { kind: desired.kind, key: pending };
  }
  return desired;
}

function desiredOpenNotice(input: {
  incidentId: string;
  severity: DeliveryHealthSeverity;
  now: Date;
  cooldownMs: number;
  previous: DeliveryHealthNoticeState;
}): DeliveryHealthNoticePlan | null {
  const { previous, severity, incidentId, now, cooldownMs } = input;
  if (!previous.lastNotifiedAt) {
    if (previous.acknowledgedAt) return null;
    return { kind: "opened", key: `dh:${incidentId}:opened:${severity}` };
  }
  if (previous.lastNotifiedSeverity === "warning" && severity === "critical") {
    return { kind: "escalated", key: `dh:${incidentId}:escalated:critical` };
  }
  if (previous.acknowledgedAt) return null;
  const cooldown = Math.max(1, cooldownMs);
  if (now.getTime() - previous.lastNotifiedAt.getTime() >= cooldown) {
    const bucket = Math.floor(now.getTime() / cooldown);
    return { kind: "reminder", key: `dh:${incidentId}:reminder:${severity}:${bucket}` };
  }
  return null;
}

export function composeDeliveryHealthEmail(input: {
  kind: DeliveryHealthNoticeKind;
  severity: DeliveryHealthSeverity;
  failureClass: string;
  clientAccountId: string;
  affectedCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  closure: "cleared" | "suppressed" | null;
  subjects: readonly DeliveryHealthSubject[];
}): { subject: string; text: string } {
  const failureClass = input.failureClass.replace(/[^a-z0-9_]/g, "") || "delivery_health";
  const subject = scrubDeliveryHealthText(
    `SA360 delivery health ${input.kind}: ${input.severity} ${failureClass}`
  );
  const lines = [
    "SA360 delivery health",
    `Notice: ${input.kind}`,
    `Severity: ${input.severity}`,
    `Failure class: ${failureClass}`,
    `Client account: ${input.clientAccountId}`,
    `Affected count: ${input.affectedCount}`,
    `First seen: ${input.firstSeenAt.toISOString()}`,
    `Last seen: ${input.lastSeenAt.toISOString()}`,
  ];
  if (input.closure === "cleared") {
    lines.push("The monitored condition is no longer present. Delivery rows were left unchanged.");
  }
  if (input.closure === "suppressed") {
    lines.push(
      "This client is paused or campaign Sheets dispatch is disabled. The incident is closed. Delivery rows were left unchanged."
    );
  }
  lines.push("Subjects:");
  const listed = input.subjects.slice(0, 10);
  if (listed.length === 0) lines.push("- none");
  for (const subject of listed) {
    lines.push(
      [
        subject.sourceLeadEventId ? `sourceLeadEventId=${subject.sourceLeadEventId}` : null,
        subject.dispatchIntentId ? `dispatchIntentId=${subject.dispatchIntentId}` : null,
        subject.jobId ? `jobId=${subject.jobId}` : null,
        subject.jobStatus ? `jobStatus=${subject.jobStatus}` : null,
        subject.code ? `code=${subject.code}` : null,
        subject.routingDryRunDecisionId ? `routingDryRunDecisionId=${subject.routingDryRunDecisionId}` : null,
        subject.webhookRequestLogId ? `webhookRequestLogId=${subject.webhookRequestLogId}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
  lines.push("This notice lists internal ids and machine codes.");
  lines.push("A Sheets receipt is a completed delivery job with written rows.");
  lines.push("The monitor does not call Google and does not retry an append.");
  return { subject, text: scrubDeliveryHealthText(lines.join("\n")) };
}

export function composeMonitorHeartbeatEmail(input: {
  reason: "scanner_failed" | "heartbeat_stale" | "recovered";
  consecutiveFailures: number;
  detail: string | null;
}): { subject: string; text: string } {
  const subject = `SA360 delivery health monitor ${input.reason}`;
  const lines = [
    "SA360 delivery health monitor",
    `Reason: ${input.reason}`,
    `Consecutive failures: ${input.consecutiveFailures}`,
    `Detail: ${scrubDeliveryHealthText(input.detail ?? "none")}`,
    "This notice is about the scanner heartbeat.",
    "The monitor does not call Google and does not retry an append.",
  ];
  return { subject: scrubDeliveryHealthText(subject), text: scrubDeliveryHealthText(lines.join("\n")) };
}

export function deliveryHealthMail(input: {
  to: string[];
  subject: string;
  text: string;
  idempotencyKey: string;
}): SendTransactionalEmailInput {
  return {
    to: input.to,
    subject: input.subject,
    text: input.text,
    idempotencyKey: input.idempotencyKey,
  };
}
