import { createHash } from "node:crypto";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import type { GoogleSheetLeadPayload } from "../../schemas/google-sheet-lead.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";

export const GOOGLE_SHEET_LEAD_PROVIDER = "google_sheets" as const;
export const GOOGLE_SHEET_LEAD_SOURCE_SYSTEM = "google_sheet_import" as const;

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Stable lead UID for a sheet row when the connector did not provide one. */
export function buildGoogleSheetLeadUid(payload: GoogleSheetLeadPayload): string {
  const explicit = trimOrUndefined(payload.contact?.lead_uid);
  if (explicit) return explicit;

  const rehearsal = payload.rehearsal ?? {};
  const rowKey =
    trimOrUndefined(rehearsal.source_sheet_id) ??
    trimOrUndefined(rehearsal.source_sheet_name) ??
    "sheet";
  const rowNumber =
    typeof rehearsal.source_row_number === "number"
      ? String(rehearsal.source_row_number)
      : undefined;

  const identitySeed =
    trimOrUndefined(payload.contact?.email) ??
    trimOrUndefined(payload.contact?.phone_e164) ??
    trimOrUndefined(payload.contact?.phone) ??
    trimOrUndefined(payload.contact?.phone_digits);

  const seed = rowNumber
    ? `${rowKey}:${rowNumber}`
    : identitySeed
      ? `${rowKey}:${identitySeed}`
      : `${rowKey}:${JSON.stringify(payload.contact ?? {})}`;

  const digest = createHash("sha1").update(seed).digest("hex").slice(0, 16);
  return `google-sheet-${GOOGLE_SHEET_LEAD_SOURCE_SYSTEM}-${digest}`;
}

/** Stable, deterministic event UUID so retried sheet rows dedupe on the lifecycle ledger. */
export function buildGoogleSheetEventUuid(
  payload: GoogleSheetLeadPayload,
  leadUid: string
): string {
  const explicit = trimOrUndefined(payload.event?.event_uuid);
  if (explicit) return explicit;
  return `GSHEET-${leadUid}`;
}

/** Route key used for source-event grouping and C.O.C. display. */
export function resolveGoogleSheetRouteKey(payload: GoogleSheetLeadPayload): string {
  const routing = (payload.routing ?? {}) as Record<string, unknown>;
  const rehearsal = payload.rehearsal ?? {};
  return (
    trimOrUndefined(payload.attribution?.campaign_id) ??
    trimOrUndefined(routing.form_id) ??
    trimOrUndefined(payload.attribution?.utm_campaign) ??
    trimOrUndefined(rehearsal.source_sheet_name) ??
    trimOrUndefined(rehearsal.source_sheet_id) ??
    "google_sheet_rehearsal"
  );
}

function pickAttribution(
  attribution: GoogleSheetLeadPayload["attribution"]
): LifecycleEventSchema["attribution"] {
  const a = attribution ?? {};
  return {
    source_platform: trimOrUndefined(a.source_platform) ?? GOOGLE_SHEET_LEAD_PROVIDER,
    source_type: trimOrUndefined(a.source_type) ?? "google_sheet_import",
    campaign_id: trimOrUndefined(a.campaign_id),
    campaign_name: trimOrUndefined(a.campaign_name),
    adset_id: trimOrUndefined(a.adset_id),
    adset_name: trimOrUndefined(a.adset_name),
    ad_id: trimOrUndefined(a.ad_id),
    ad_name: trimOrUndefined(a.ad_name),
    fbclid: trimOrUndefined(a.fbclid),
    fbc: trimOrUndefined(a.fbc),
    fbp: trimOrUndefined(a.fbp),
    utm_source: trimOrUndefined(a.utm_source),
    utm_medium: trimOrUndefined(a.utm_medium),
    utm_campaign: trimOrUndefined(a.utm_campaign),
    utm_content: trimOrUndefined(a.utm_content),
    utm_term: trimOrUndefined(a.utm_term),
    meta_pixel_id: trimOrUndefined(a.meta_pixel_id),
    meta_dataset_id: trimOrUndefined(a.meta_dataset_id),
  };
}

function pickState(
  state: GoogleSheetLeadPayload["state"]
): LifecycleEventSchema["state"] {
  const s = state ?? {};
  const policyStatus =
    s.policy_status === null || s.policy_status === undefined
      ? undefined
      : trimOrUndefined(s.policy_status);
  return {
    lead_type: trimOrUndefined(s.lead_type),
    lifecycle_stage: trimOrUndefined(s.lifecycle_stage) ?? "NEW",
    lead_status: trimOrUndefined(s.lead_status),
    appointment_status: trimOrUndefined(s.appointment_status),
    agent_disposition: trimOrUndefined(s.agent_disposition),
    policy_status: policyStatus,
    ai_status: trimOrUndefined(s.ai_status),
    routing_status: trimOrUndefined(s.routing_status) ?? "RECEIVED",
    dead_lead_flag: typeof s.dead_lead_flag === "boolean" ? s.dead_lead_flag : undefined,
  };
}

function deriveNames(contact: GoogleSheetLeadPayload["contact"]): {
  firstName?: string;
  lastName?: string;
} {
  const first = trimOrUndefined(contact?.first_name);
  const last = trimOrUndefined(contact?.last_name);
  if (first || last) return { firstName: first, lastName: last };
  const full = trimOrUndefined(contact?.full_name);
  if (!full) return {};
  const parts = full.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

/**
 * Normalize a Google Sheet cutover-rehearsal envelope into the strict SA360 lifecycle
 * payload consumed by the routing matcher / dry-run pipeline. Only lifecycle-allowed
 * keys are emitted (the strict schema rejects unknown top-level keys); rehearsal and raw
 * context are preserved separately on the SourceLeadEvent by the intake service.
 */
export function normalizeGoogleSheetLeadToLifecyclePayload(
  payload: GoogleSheetLeadPayload
): LifecycleEventSchema {
  const contact = payload.contact ?? {};
  const leadUid = buildGoogleSheetLeadUid(payload);
  const eventUuid = buildGoogleSheetEventUuid(payload, leadUid);
  const routeKey = resolveGoogleSheetRouteKey(payload);

  const phoneRaw =
    trimOrUndefined(contact.phone_e164) ?? trimOrUndefined(contact.phone) ?? "";
  const phoneResult = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
  const phoneE164 = phoneResult?.ok
    ? phoneResult.e164
    : trimOrUndefined(contact.phone_e164);

  const { firstName, lastName } = deriveNames(contact);

  const ownership = payload.ownership ?? {};
  const routing = (payload.routing ?? {}) as Record<string, unknown>;

  return {
    schema_version: payload.schema_version,
    client_account_id: payload.client_account_id,
    subaccount_id_ghl: trimOrUndefined(payload.subaccount_id_ghl),
    contact: {
      lead_uid: leadUid,
      contact_id_ghl: trimOrUndefined(contact.contact_id_ghl),
      first_name: firstName,
      last_name: lastName,
      email: trimOrUndefined(contact.email),
      phone: trimOrUndefined(contact.phone) ?? (phoneRaw || undefined),
      phone_e164: phoneE164,
      phone_digits: trimOrUndefined(contact.phone_digits),
      city: trimOrUndefined(contact.city),
      state: trimOrUndefined(contact.state),
      zip: trimOrUndefined(contact.zip),
      country: trimOrUndefined(contact.country),
      date_of_birth: trimOrUndefined(contact.date_of_birth),
    },
    attribution: pickAttribution(payload.attribution),
    state: pickState(payload.state),
    event: {
      event_uuid: eventUuid,
      // This endpoint represents a lead-created signal; force the routing-eligible event.
      event_name_internal: "lead_created",
      event_name_meta: trimOrUndefined(payload.event?.event_name_meta) ?? "Lead",
      event_time_unix:
        typeof payload.event?.event_time_unix === "number"
          ? payload.event.event_time_unix
          : undefined,
      // Cutover rehearsal never fans out to Meta.
      send_to_meta: false,
    },
    ownership: {
      assigned_agent_id: trimOrUndefined(ownership.assigned_agent_id),
      assigned_agent_name: trimOrUndefined(ownership.assigned_agent_name),
      updated_by: trimOrUndefined(ownership.updated_by) ?? "google_sheet_rehearsal",
    },
    routing: {
      ...routing,
      form_id: trimOrUndefined(routing.form_id),
      campaign_key: routeKey,
      source_intake: {
        provider: GOOGLE_SHEET_LEAD_PROVIDER,
        source_system: GOOGLE_SHEET_LEAD_SOURCE_SYSTEM,
        source_type: "google_sheet_import",
        source_route_key: routeKey,
        lead_id: leadUid,
      },
    },
  };
}
