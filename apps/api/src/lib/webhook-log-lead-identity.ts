/** Derived lead identity for admin webhook reporting (from redacted JSON only). */

import {
  isLeadCaptureProviderPayload,
  LeadCaptureNextGenLeadIdError,
  materializeLeadCapturePayload,
  resolveLeadCaptureField,
  splitLeadCaptureFullName,
} from "../services/source-intake/leadcapture-payload-resolver.js";
import { tryNormalizeToVerifiedE164 } from "../services/phone-e164.service.js";

export const UNKNOWN_LEAD = "Unknown lead";

export const LEAD_IDENTITY_ERROR_SUMMARY =
  "Lead identity could not be resolved from the stored webhook payload.";

export type WebhookLeadIdentity = {
  leadName: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
};

export type WebhookLeadIdentityStatus = "ok" | "invalid" | "unknown";

/** Admin list/detail presenter result with row-level identity isolation metadata. */
export type WebhookLeadIdentityResult = WebhookLeadIdentity & {
  leadIdentityStatus: WebhookLeadIdentityStatus;
  leadIdentityErrorCode: string | null;
  leadIdentityErrorSummary: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function trimStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Reads lifecycle-shaped `contact` object from webhook body root. */
export function contactRecordFromPayloadRoot(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root.contact);
}

function pickPhone(contact: Record<string, unknown>): string | null {
  return (
    trimStr(contact.phone_e164) ??
    trimStr(contact.phone) ??
    trimStr(contact.phone_digits) ??
    null
  );
}

function identityFromContact(contact: Record<string, unknown> | null): WebhookLeadIdentity {
  if (!contact) {
    return emptyIdentity();
  }
  const first = trimStr(contact.first_name);
  const last = trimStr(contact.last_name);
  const email = trimStr(contact.email);
  const phone = pickPhone(contact);
  return finalizeIdentity(first, last, email, phone);
}

export function emptyIdentity(): WebhookLeadIdentity {
  return {
    leadName: UNKNOWN_LEAD,
    leadFirstName: null,
    leadLastName: null,
    leadPhone: null,
    leadEmail: null,
  };
}

/** First + last only. Does not invent a name from email, phone, or "Unknown lead". */
export function leadNameFromFirstLast(
  firstName: string | null,
  lastName: string | null
): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

export type WebhookContactPresentation = {
  lead_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
};

function trimResolvable(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return trimStr(v);
}

function extractStateFromRedactedRequest(requestBodyRedacted: unknown): string | null {
  const root = asRecord(requestBodyRedacted);
  if (!root) return null;
  const fromContact = trimStr(asRecord(root.contact)?.state);
  if (fromContact) return fromContact;
  if (isLeadCaptureProviderPayload(root)) {
    return trimResolvable(resolveLeadCaptureField(root, "state"));
  }
  return trimStr(root.state);
}

/**
 * Provider/request contact fields from the already-redacted webhook bodies.
 * Does not read SourceLeadEvent.rawPayloadJson (unredacted PII boundary).
 */
function providerContactFromRedactedBodies(
  requestBodyRedacted: unknown,
  responseBodyRedacted: unknown
): Omit<WebhookContactPresentation, "lead_name"> {
  const identity = resolveWebhookLeadIdentitySafe({
    source: null,
    requestBodyRedacted,
    responseBodyRedacted,
  });
  const root = asRecord(requestBodyRedacted);
  let first_name = identity.leadFirstName;
  let last_name = identity.leadLastName;
  let email = identity.leadEmail;
  let phone = identity.leadPhone;
  let state = extractStateFromRedactedRequest(requestBodyRedacted);

  if (root && isLeadCaptureProviderPayload(root)) {
    first_name = first_name ?? trimResolvable(resolveLeadCaptureField(root, "first_name"));
    last_name = last_name ?? trimResolvable(resolveLeadCaptureField(root, "last_name"));
    email = email ?? trimResolvable(resolveLeadCaptureField(root, "email"));
    phone = phone ?? trimResolvable(resolveLeadCaptureField(root, "phone"));
    state = state ?? trimResolvable(resolveLeadCaptureField(root, "state"));
    if (!first_name && !last_name) {
      const full = trimResolvable(resolveLeadCaptureField(root, "full_name"));
      if (full) {
        const split = splitLeadCaptureFullName(full);
        first_name = trimStr(split.first_name);
        last_name = trimStr(split.last_name);
      }
    }
  } else if (root) {
    first_name = first_name ?? trimStr(root.first_name);
    last_name = last_name ?? trimStr(root.last_name);
    email = email ?? trimStr(root.email);
    phone = phone ?? trimStr(root.phone) ?? trimStr(root.phone_number);
    state = state ?? trimStr(root.state);
  }

  return { first_name, last_name, email, phone, state };
}

/**
 * Admin COC Lead / Contact presentation: normalized contact is primary;
 * redacted provider/request fields fill gaps only. lead_name is first+last.
 */
export function presentLeadContactFields(input: {
  normalizedContact?: Record<string, unknown> | null;
  requestBodyRedacted: unknown;
  responseBodyRedacted?: unknown;
}): WebhookContactPresentation {
  const normalized = input.normalizedContact ?? null;
  const provider = providerContactFromRedactedBodies(
    input.requestBodyRedacted,
    input.responseBodyRedacted ?? null
  );

  const first_name = trimStr(normalized?.first_name) ?? provider.first_name;
  const last_name = trimStr(normalized?.last_name) ?? provider.last_name;
  const email = trimStr(normalized?.email) ?? provider.email;
  const phone = (normalized ? pickPhone(normalized) : null) ?? provider.phone;
  const state = trimStr(normalized?.state) ?? provider.state;

  return {
    lead_name: leadNameFromFirstLast(first_name, last_name),
    first_name,
    last_name,
    email,
    phone,
    state,
  };
}

export function finalizeIdentity(
  leadFirstName: string | null,
  leadLastName: string | null,
  leadEmail: string | null,
  leadPhone: string | null
): WebhookLeadIdentity {
  const full = leadNameFromFirstLast(leadFirstName, leadLastName) ?? "";
  const leadName =
    full ||
    (leadEmail ? leadEmail.trim() : "") ||
    (leadPhone ? leadPhone.trim() : "") ||
    UNKNOWN_LEAD;
  return {
    leadName,
    leadFirstName,
    leadLastName,
    leadPhone,
    leadEmail,
  };
}

/** Prefer primary (e.g. request body); fill gaps from secondary (response or LifecycleEvent). */
export function mergePreferPrimary(a: WebhookLeadIdentity, b: WebhookLeadIdentity): WebhookLeadIdentity {
  const first = a.leadFirstName ?? b.leadFirstName;
  const last = a.leadLastName ?? b.leadLastName;
  const phone = a.leadPhone ?? b.leadPhone;
  const email = a.leadEmail ?? b.leadEmail;
  return finalizeIdentity(first, last, email, phone);
}

/** Derive from request JSON, then fill from response JSON where missing. */
export function deriveLeadIdentityFromWebhookBodies(
  requestBodyRedacted: unknown,
  responseBodyRedacted: unknown
): WebhookLeadIdentity {
  const reqRoot = asRecord(requestBodyRedacted);
  if (reqRoot && isLeadCaptureProviderPayload(reqRoot)) {
    const effective = materializeLeadCapturePayload(reqRoot);
    const first = trimStr(effective.first_name);
    const last = trimStr(effective.last_name);
    const email = trimStr(effective.email);
    const phoneRaw = trimStr(effective.phone);
    const phoneE164 = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
    const phone = phoneE164?.ok ? phoneE164.e164 : phoneRaw;
    const fromLeadCapture = finalizeIdentity(first, last, email, phone);
    const resContact = contactRecordFromPayloadRoot(responseBodyRedacted);
    const fromRes = identityFromContact(resContact);
    return mergePreferPrimary(fromLeadCapture, fromRes);
  }

  const reqContact = contactRecordFromPayloadRoot(requestBodyRedacted);
  const resContact = contactRecordFromPayloadRoot(responseBodyRedacted);
  const fromReq = identityFromContact(reqContact);
  const fromRes = identityFromContact(resContact);
  return mergePreferPrimary(fromReq, fromRes);
}

/** Full lifecycle event payload (stored on LifecycleEvent.payloadJson). */
export function deriveLeadIdentityFromLifecyclePayloadJson(payloadJson: unknown): WebhookLeadIdentity {
  return identityFromContact(contactRecordFromPayloadRoot(payloadJson));
}

/**
 * Candidate SourceLeadEvent id for a webhook row: the persisted column when present,
 * otherwise the `sourceEventId` echoed in the redacted response body (same as the detail endpoint).
 */
export function sourceEventIdFromWebhookRow(row: {
  sourceLeadEventId?: string | null;
  responseBodyRedacted?: unknown;
}): string | null {
  const direct = trimStr(row.sourceLeadEventId);
  if (direct) return direct;
  const rec = asRecord(row.responseBodyRedacted);
  return trimStr(rec?.sourceEventId);
}

export type WebhookSourceLeadEventLite = {
  normalizedPayloadJson: unknown;
  rawPayloadJson?: unknown;
};

/**
 * Single source of truth for webhook lead identity, shared by the list and detail endpoints.
 * Layers: redacted webhook bodies → LifecycleEvent payload (GHL rows) → SourceLeadEvent
 * normalized contact (LeadCapture.io rows). Body/lifecycle stay primary; source fills gaps,
 * so empty GHL bodies resolve to the normalized source name while real bodies are preserved.
 */
export function resolveWebhookLeadIdentity(input: {
  source: string | null | undefined;
  requestBodyRedacted: unknown;
  responseBodyRedacted: unknown;
  lifecyclePayloadJson?: unknown;
  sourceEvent?: WebhookSourceLeadEventLite | null;
}): WebhookLeadIdentity {
  let identity = deriveLeadIdentityFromWebhookBodies(
    input.requestBodyRedacted,
    input.responseBodyRedacted
  );
  if (input.lifecyclePayloadJson != null) {
    identity = mergePreferPrimary(
      identity,
      deriveLeadIdentityFromLifecyclePayloadJson(input.lifecyclePayloadJson)
    );
  }
  if (input.source === "leadcapture_io" && input.sourceEvent) {
    identity = mergePreferPrimary(
      identity,
      deriveLeadIdentityFromSourceLeadEvent(
        input.sourceEvent.normalizedPayloadJson,
        input.sourceEvent.rawPayloadJson
      )
    );
  }
  return identity;
}

/**
 * Recover display identity without calling materializeLeadCapturePayload.
 * Used when NextGen lead_id validation fails on a historical redacted body.
 */
function recoverIdentityWithoutMaterialize(input: {
  source: string | null | undefined;
  requestBodyRedacted: unknown;
  responseBodyRedacted: unknown;
  lifecyclePayloadJson?: unknown;
  sourceEvent?: WebhookSourceLeadEventLite | null;
}): WebhookLeadIdentity {
  let identity = emptyIdentity();
  const reqRoot = asRecord(input.requestBodyRedacted);
  if (reqRoot) {
    const first = trimStr(reqRoot.first_name);
    const last = trimStr(reqRoot.last_name);
    const email = trimStr(reqRoot.email);
    const phone = trimStr(reqRoot.phone) ?? trimStr(reqRoot.phone_number);
    identity = mergePreferPrimary(identity, finalizeIdentity(first, last, email, phone));
  }
  identity = mergePreferPrimary(
    identity,
    identityFromContact(contactRecordFromPayloadRoot(input.responseBodyRedacted))
  );
  if (input.lifecyclePayloadJson != null) {
    identity = mergePreferPrimary(
      identity,
      deriveLeadIdentityFromLifecyclePayloadJson(input.lifecyclePayloadJson)
    );
  }
  if (input.source === "leadcapture_io" && input.sourceEvent) {
    identity = mergePreferPrimary(
      identity,
      deriveLeadIdentityFromSourceLeadEvent(
        input.sourceEvent.normalizedPayloadJson,
        input.sourceEvent.rawPayloadJson
      )
    );
  }
  return identity;
}

/**
 * Admin webhook list/detail identity resolution with row-level isolation.
 * A malformed historical NextGen lead_id must never fail the entire list.
 */
export function resolveWebhookLeadIdentitySafe(input: {
  source: string | null | undefined;
  requestBodyRedacted: unknown;
  responseBodyRedacted: unknown;
  lifecyclePayloadJson?: unknown;
  sourceEvent?: WebhookSourceLeadEventLite | null;
}): WebhookLeadIdentityResult {
  try {
    const identity = resolveWebhookLeadIdentity(input);
    return {
      ...identity,
      leadIdentityStatus: "ok",
      leadIdentityErrorCode: null,
      leadIdentityErrorSummary: null,
    };
  } catch (err) {
    if (err instanceof LeadCaptureNextGenLeadIdError) {
      const recovered = recoverIdentityWithoutMaterialize(input);
      return {
        ...recovered,
        leadIdentityStatus: "invalid",
        leadIdentityErrorCode: err.code,
        leadIdentityErrorSummary: LEAD_IDENTITY_ERROR_SUMMARY,
      };
    }
    throw err;
  }
}

/**
 * Derive identity from a SourceLeadEvent (LeadCapture.io intake) — the same normalized
 * contact the detail drawer uses. Fallback order: normalized contact first+last → raw
 * payload `name` → contact.email → contact.phone/phone_e164 → "Unknown lead".
 */
export function deriveLeadIdentityFromSourceLeadEvent(
  normalizedPayloadJson: unknown,
  rawPayloadJson?: unknown
): WebhookLeadIdentity {
  const normalized = asRecord(normalizedPayloadJson);
  const contact = asRecord(normalized?.contact);
  let first = trimStr(contact?.first_name);
  let last = trimStr(contact?.last_name);
  const email = trimStr(contact?.email);
  const phone = contact ? pickPhone(contact) : null;

  if (!first && !last) {
    const raw = asRecord(rawPayloadJson);
    const rawName = trimStr(raw?.name);
    if (rawName) {
      const split = splitLeadCaptureFullName(rawName);
      first = trimStr(split.first_name);
      last = trimStr(split.last_name);
    }
  }

  return finalizeIdentity(first, last, email, phone);
}
