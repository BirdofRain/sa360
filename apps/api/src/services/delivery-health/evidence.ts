/**
 * Incident evidence is internal ids and machine codes.
 * Lead payloads, contact fields, and secrets are not copied.
 */

const MACHINE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

export type DeliveryHealthSubject = {
  sourceLeadEventId: string | null;
  dispatchIntentId: string | null;
  jobId: string | null;
  jobStatus: string | null;
  code: string | null;
  routingDryRunDecisionId: string | null;
  webhookRequestLogId: string | null;
};

export function machineCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.trim().split(":")[0]?.trim().toLowerCase() ?? "";
  return MACHINE_CODE.test(head) ? head : null;
}

export function internalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  if (trimmed.includes("@") || /\s/.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeDeliveryHealthSubject(subject: DeliveryHealthSubject): DeliveryHealthSubject {
  return {
    sourceLeadEventId: internalId(subject.sourceLeadEventId),
    dispatchIntentId: internalId(subject.dispatchIntentId),
    jobId: internalId(subject.jobId),
    jobStatus: machineCode(subject.jobStatus),
    code: machineCode(subject.code),
    routingDryRunDecisionId: internalId(subject.routingDryRunDecisionId),
    webhookRequestLogId: internalId(subject.webhookRequestLogId),
  };
}

export function scrubDeliveryHealthText(value: string, max = 4000): string {
  const limit = Number.isFinite(max) && max > 0 ? Math.trunc(max) : 4000;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\+\d{10,15}\b/g, "[redacted]")
    .replace(/\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/g, "[redacted]")
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[redacted]")
    .replace(/\b\d{10}\b/g, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|api[_-]?key)\b\s*[:=]?\s*\S+/gi, "[redacted]")
    .slice(0, limit);
}

export function deliveryHealthEvidenceDocument(
  subjects: readonly DeliveryHealthSubject[],
  affectedCount: number
): { affectedCount: number; subjects: DeliveryHealthSubject[] } {
  // Every subject id is stored. The email lists a sample. Dropping ids here
  // would let a lead outside the lookback recover without being rechecked.
  const subjectsOut = subjects
    .map(sanitizeDeliveryHealthSubject)
    .sort((a, b) => subjectSortKey(a).localeCompare(subjectSortKey(b)));
  return { affectedCount, subjects: subjectsOut };
}

function subjectSortKey(subject: DeliveryHealthSubject): string {
  return [
    subject.sourceLeadEventId ?? "",
    subject.jobId ?? "",
    subject.routingDryRunDecisionId ?? "",
    subject.webhookRequestLogId ?? "",
    subject.code ?? "",
  ].join("|");
}
