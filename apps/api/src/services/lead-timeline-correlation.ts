import type { WebhookRequestLog } from "@prisma/client";
import {
  contactRecordFromPayloadRoot,
  deriveLeadIdentityFromLifecyclePayloadJson,
  deriveLeadIdentityFromWebhookBodies,
  type WebhookLeadIdentity,
} from "../lib/webhook-log-lead-identity.js";
import { tryNormalizeToVerifiedE164 } from "./phone-e164.service.js";
import type { LeadCorrelationKeys, LeadTimelineMilestone, LeadTimelineQuery } from "./lead-timeline.types.js";
import { LEAD_TIMELINE_MILESTONES } from "./lead-timeline.types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function trimStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function normalizePhoneInput(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const result = tryNormalizeToVerifiedE164(raw);
  return result.ok ? result.e164 : undefined;
}

export function extractKeysFromLifecyclePayload(payload: unknown): Partial<LeadCorrelationKeys> {
  const root = asRecord(payload);
  if (!root) return {};
  const contact = contactRecordFromPayloadRoot(payload);
  const identity = deriveLeadIdentityFromLifecyclePayloadJson(payload);
  const phone =
    normalizePhoneInput(identity.leadPhone ?? undefined) ??
    normalizePhoneInput(trimStr(contact?.phone_e164)) ??
    normalizePhoneInput(trimStr(contact?.phone));

  return {
    clientAccountId: trimStr(root.client_account_id),
    subaccountIdGhl: trimStr(root.subaccount_id_ghl),
    leadUid: trimStr(contact?.lead_uid),
    contactIdGhl: trimStr(contact?.contact_id_ghl),
    phoneE164: phone,
    email: trimStr(contact?.email) ?? identity.leadEmail ?? undefined,
  };
}

/** LeadCapture source lead uid prefix. This is not a GoHighLevel contact id. */
export const LEADCAPTURE_SYNTHETIC_LEAD_UID_PREFIX = "leadcaptureio-";

/**
 * True when a value is a LeadCapture source lead uid (`leadcaptureio-...`).
 * Equality with lead_uid is not enough: a real GHL contact id can be queried
 * with the same string as lead_uid and must still match contactIdGhl.
 */
export function isSyntheticLeadCaptureContactId(contactIdGhl: string | undefined): boolean {
  const contact = contactIdGhl?.trim();
  return Boolean(contact?.startsWith(LEADCAPTURE_SYNTHETIC_LEAD_UID_PREFIX));
}

/**
 * Keep the source lead uid, and drop a synthetic contact id so timeline queries
 * do not search GoHighLevel contact columns for it.
 * Phone and email are unchanged and must stay client-scoped by the caller.
 */
export function normalizeLeadCaptureTimelineKeys<T extends { leadUid?: string; contactIdGhl?: string }>(
  keys: T
): T {
  const contact = keys.contactIdGhl?.trim() || undefined;
  const lead = keys.leadUid?.trim() || undefined;
  if (!isSyntheticLeadCaptureContactId(contact)) {
    return { ...keys, leadUid: lead, contactIdGhl: contact };
  }
  return {
    ...keys,
    leadUid: lead || contact,
    contactIdGhl: undefined,
  };
}

export type LeadTimelineWebhookLookup =
  | { contactIdGhl: string }
  | { normalizedLeadUid: string }
  | { eventUuid: { in: string[] } }
  | { id: string };

/**
 * Webhook rows for a client timeline.
 * LeadCapture intake stores the source uid on normalizedLeadUid and leaves
 * contactIdGhl null. Matching that uid against contactIdGhl hides the webhook.
 * Phone and email are intentionally absent so another client's same-person
 * submission cannot join this lookup.
 */
export function leadTimelineWebhookLookups(input: {
  keys: {
    leadUid?: string;
    contactIdGhl?: string;
    phoneE164?: string;
    email?: string;
  };
  eventUuids: string[];
  anchorWebhookLogId?: string | null;
}): LeadTimelineWebhookLookup[] {
  const keys = normalizeLeadCaptureTimelineKeys(input.keys);
  const lookups: LeadTimelineWebhookLookup[] = [];
  if (keys.contactIdGhl) lookups.push({ contactIdGhl: keys.contactIdGhl });
  if (keys.leadUid) lookups.push({ normalizedLeadUid: keys.leadUid });
  if (input.eventUuids.length > 0) lookups.push({ eventUuid: { in: input.eventUuids } });
  const anchorId = input.anchorWebhookLogId?.trim();
  if (anchorId) lookups.push({ id: anchorId });
  return lookups;
}

function leadCaptureCorrelationIds(
  row: WebhookRequestLog,
  response: Record<string, unknown> | null
): { leadUid?: string; contactIdGhl?: string } {
  return normalizeLeadCaptureTimelineKeys({
    leadUid: row.normalizedLeadUid?.trim() || trimStr(response?.normalizedLeadUid),
    contactIdGhl: row.contactIdGhl?.trim(),
  });
}

export function extractKeysFromWebhookLog(row: WebhookRequestLog): Partial<LeadCorrelationKeys> {
  if (row.source === "leadcapture_io") {
    const response = asRecord(row.responseBodyRedacted);
    const request = asRecord(row.requestBodyRedacted);
    const answers = request ? asRecord(request.answers) : null;
    const identity = deriveLeadIdentityFromWebhookBodies(
      row.requestBodyRedacted,
      row.responseBodyRedacted
    );
    const phone =
      normalizePhoneInput(identity.leadPhone ?? undefined) ??
      normalizePhoneInput(trimStr(answers?.phone)) ??
      normalizePhoneInput(trimStr(request?.phone));
    const ids = leadCaptureCorrelationIds(row, response);

    return {
      clientAccountId:
        row.clientAccountId ??
        trimStr(response?.destinationClientAccountId) ??
        trimStr(request?.client_account_id),
      subaccountIdGhl:
        row.subaccountIdGhl ??
        trimStr(response?.destinationLocationIdGhl) ??
        trimStr(request?.subaccount_id_ghl),
      leadUid: ids.leadUid,
      contactIdGhl: ids.contactIdGhl,
      phoneE164: phone,
      email: identity.leadEmail ?? trimStr(answers?.email) ?? trimStr(request?.email),
    };
  }

  const fromBody = extractKeysFromLifecyclePayload(row.requestBodyRedacted);
  const identity = deriveLeadIdentityFromWebhookBodies(
    row.requestBodyRedacted,
    row.responseBodyRedacted
  );
  const phone = normalizePhoneInput(identity.leadPhone ?? undefined) ?? fromBody.phoneE164;

  return {
    clientAccountId: row.clientAccountId ?? fromBody.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl ?? fromBody.subaccountIdGhl,
    leadUid: fromBody.leadUid,
    contactIdGhl: row.contactIdGhl ?? fromBody.contactIdGhl,
    phoneE164: phone,
    email: identity.leadEmail ?? fromBody.email,
  };
}

/** Merge correlation keys; later values fill gaps only. */
export function mergeCorrelationKeys(
  ...partials: Array<Partial<LeadCorrelationKeys> | undefined>
): Partial<LeadCorrelationKeys> {
  const out: Partial<LeadCorrelationKeys> = {};
  for (const p of partials) {
    if (!p) continue;
    if (p.clientAccountId) out.clientAccountId = p.clientAccountId;
    if (p.subaccountIdGhl) out.subaccountIdGhl = p.subaccountIdGhl;
    if (p.leadUid) out.leadUid = p.leadUid;
    if (p.contactIdGhl) out.contactIdGhl = p.contactIdGhl;
    if (p.phoneE164) out.phoneE164 = p.phoneE164;
    if (p.email) out.email = p.email;
  }
  return out;
}

export function correlationKeysFromQuery(query: LeadTimelineQuery): Partial<LeadCorrelationKeys> {
  return mergeCorrelationKeys({
    clientAccountId: query.clientAccountId?.trim(),
    subaccountIdGhl: query.subaccountIdGhl?.trim(),
    leadUid: query.leadUid?.trim(),
    contactIdGhl: query.contactIdGhl?.trim(),
    phoneE164: normalizePhoneInput(query.phoneE164?.trim()),
    email: query.email?.trim(),
  });
}

export function hasCorrelationMatchKey(keys: Partial<LeadCorrelationKeys>): boolean {
  return Boolean(keys.leadUid || keys.contactIdGhl || keys.phoneE164 || keys.email);
}

export function requireResolvedCorrelationKeys(
  keys: Partial<LeadCorrelationKeys>
): LeadCorrelationKeys | null {
  if (!keys.clientAccountId?.trim()) return null;
  if (!hasCorrelationMatchKey(keys)) return null;
  return {
    clientAccountId: keys.clientAccountId.trim(),
    subaccountIdGhl: keys.subaccountIdGhl,
    leadUid: keys.leadUid,
    contactIdGhl: keys.contactIdGhl,
    phoneE164: keys.phoneE164,
    email: keys.email,
  };
}

export function webhookValidity(processingStatus: string): "valid" | "invalid" {
  const s = processingStatus.trim().toLowerCase();
  if (s === "unauthorized" || s === "validation_failed") return "invalid";
  return "valid";
}

export function computeMissingMilestones(
  seen: Set<string>
): LeadTimelineMilestone[] {
  return LEAD_TIMELINE_MILESTONES.filter((m) => !seen.has(m));
}

export function collectMilestonesFromTimeline(
  timeline: Array<{ eventNameInternal: string | null }>
): Set<string> {
  const seen = new Set<string>();
  for (const row of timeline) {
    const name = row.eventNameInternal?.trim().toLowerCase();
    if (name) seen.add(name);
  }
  return seen;
}

export function identityFromParts(
  keys: LeadCorrelationKeys,
  indexDisplayName: string | null | undefined,
  fallbackIdentity: WebhookLeadIdentity
): {
  leadUid: string | null;
  contactIdGhl: string | null;
  displayName: string | null;
  phoneE164: string | null;
  email: string | null;
  clientAccountId: string;
  subaccountIdGhl: string | null;
} {
  return {
    leadUid: keys.leadUid ?? null,
    contactIdGhl: keys.contactIdGhl ?? null,
    displayName:
      indexDisplayName?.trim() ||
      (fallbackIdentity.leadName !== "Unknown lead" ? fallbackIdentity.leadName : null),
    phoneE164: keys.phoneE164 ?? fallbackIdentity.leadPhone,
    email: keys.email ?? fallbackIdentity.leadEmail,
    clientAccountId: keys.clientAccountId,
    subaccountIdGhl: keys.subaccountIdGhl ?? null,
  };
}

export function stateFromLifecyclePayload(payload: unknown): {
  lifecycleStage?: string;
  appointmentStatus?: string;
  agentDisposition?: string;
  policyStatus?: string;
  aiStatus?: string;
  routingStatus?: string;
} {
  const root = asRecord(payload);
  const state = asRecord(root?.state);
  if (!state) return {};
  return {
    lifecycleStage: trimStr(state.lifecycle_stage),
    appointmentStatus: trimStr(state.appointment_status),
    agentDisposition: trimStr(state.agent_disposition),
    policyStatus: trimStr(state.policy_status),
    aiStatus: trimStr(state.ai_status),
    routingStatus: trimStr(state.routing_status),
  };
}
