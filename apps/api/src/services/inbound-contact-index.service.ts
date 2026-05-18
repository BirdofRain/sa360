import {
  InboundContactSourceOrigin,
  type InboundContactClientStatus,
  type InboundContactIndex,
} from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import {
  deriveClientStatusFromLifecyclePayload,
  mergeClientStatusPreferStronger,
  resolveClientStatusAfterGhlEvidence,
} from "../lib/inbound-contact-client-status.js";
import {
  logInboundLookupInfo,
  logInboundLookupWarn,
} from "../lib/inbound-lookup-log.js";
import type { GhlContactSearchSummary } from "./ghl-contact-search.service.js";
import {
  findByCompositeKey,
  upsertInboundContactIndex,
} from "../repositories/inbound-contact-index.repository.js";
import { resolveLifecycleContactPhoneDetails } from "../lib/lifecycle-contact-phone.js";
import { enrichLifecyclePayloadForIngest } from "../lib/lifecycle-event-enrich.js";

export {
  findByNormalizedPhone,
  type InboundContactLookupScope,
} from "../repositories/inbound-contact-index.repository.js";

function deriveDisplayName(payload: LifecycleEventSchema): string | undefined {
  const fn = payload.contact.first_name?.trim() ?? "";
  const ln = payload.contact.last_name?.trim() ?? "";
  const joined = [fn, ln].filter(Boolean).join(" ").trim();
  return joined || undefined;
}

function buildInboundContactIndexRecord(
  payload: LifecycleEventSchema,
  phoneE164: string,
  existing: { clientStatus: InboundContactClientStatus | null; sourceOrigin?: InboundContactSourceOrigin } | null
) {
  const subaccountIdGhl = enriched.subaccount_id_ghl?.trim() ?? "";

  const policyStatus =
    payload.state.policy_status === null || payload.state.policy_status === undefined
      ? undefined
      : String(payload.state.policy_status);

  const derived = deriveClientStatusFromLifecyclePayload(payload);
  const clientStatus = mergeClientStatusPreferStronger(existing?.clientStatus ?? null, derived);

  return {
    clientAccountId: payload.client_account_id,
    subaccountIdGhl,
    phoneE164,
    leadUid: payload.contact.lead_uid,
    contactIdGhl: payload.contact.contact_id_ghl ?? undefined,
    firstName: payload.contact.first_name ?? undefined,
    lastName: payload.contact.last_name ?? undefined,
    displayName: deriveDisplayName(payload),
    email: payload.contact.email ?? undefined,
    state: payload.contact.state ?? undefined,
    assignedAgentId: payload.ownership?.assigned_agent_id ?? undefined,
    assignedAgentName: payload.ownership?.assigned_agent_name ?? undefined,
    lifecycleStage: payload.state.lifecycle_stage ?? undefined,
    appointmentStatus: payload.state.appointment_status ?? undefined,
    policyStatus,
    leadType: payload.state.lead_type ?? undefined,
    sourceOrigin: InboundContactSourceOrigin.lifecycle_webhook,
    clientStatus,
    lastSeenAt: new Date(),
  };
}

/**
 * Best-effort upsert for inbound voice lookup from lifecycle webhooks.
 * Callers should catch/log failures so lifecycle ingestion is never blocked by this path.
 */
/** @returns true when a row was written; false when skipped (e.g. missing phone). */
export async function upsertFromLifecyclePayload(
  payload: LifecycleEventSchema,
  context?: { eventUuid?: string }
): Promise<boolean> {
  const enriched = enrichLifecyclePayloadForIngest(payload);
  const clientAccountId = enriched.client_account_id;
  const subaccountIdGhl = enriched.subaccount_id_ghl?.trim() ?? "";

  logInboundLookupInfo("inbound_contact_index", {
    component: "inbound_contact_index",
    event: "InboundContactIndex upsert attempted from lifecycle",
    clientAccountId,
    subaccountIdGhl,
    eventUuid: context?.eventUuid,
  });

  const phoneDetails = resolveLifecycleContactPhoneDetails(enriched);
  const phoneE164 = phoneDetails.normalized_e164;
  if (!phoneE164) {
    logInboundLookupWarn("inbound_contact_index", {
      component: "inbound_contact_index",
      event: "InboundContactIndex upsert skipped (phone not normalized to E.164)",
      raw_phone: phoneDetails.raw_input,
      normalized_phone: null,
      reason: phoneDetails.phone_skip_reason ?? "unknown_phone_skip",
      contact_id_ghl: payload.contact.contact_id_ghl,
      lead_uid: payload.contact.lead_uid,
      clientAccountId,
      subaccountIdGhl,
      eventUuid: context?.eventUuid,
      phone_resolution_source: phoneDetails.raw_source,
    });
    return false;
  }


  const existing = await findByCompositeKey(clientAccountId, subaccountIdGhl, phoneE164, {
    clientStatus: true,
    sourceOrigin: true,
  });

  const data = buildInboundContactIndexRecord(enriched, phoneE164, existing);

  const {
    clientAccountId: ca,
    subaccountIdGhl: sub,
    phoneE164: phoneKey,
    sourceOrigin,
    ...updateFields
  } = data;

  const preserveSourceOrigin =
    existing?.sourceOrigin === InboundContactSourceOrigin.merged ||
    existing?.sourceOrigin === InboundContactSourceOrigin.ghl_backfill;

  await upsertInboundContactIndex({
    where: {
      clientAccountId_subaccountIdGhl_phoneE164: {
        clientAccountId: ca,
        subaccountIdGhl: sub,
        phoneE164: phoneKey,
      },
    },
    create: data,
    update: {
      ...updateFields,
      ...(preserveSourceOrigin ? {} : { sourceOrigin }),
      lastSeenAt: new Date(),
    },
  });

  logInboundLookupInfo("inbound_contact_index", {
    component: "inbound_contact_index",
    event: "InboundContactIndex upsert succeeded from lifecycle",
    raw_phone: phoneDetails.raw_input,
    normalized_phone: phoneKey,
    client_account_id: ca,
    subaccount_id_ghl: sub,
    contact_id_ghl: payload.contact.contact_id_ghl,
    clientAccountId: ca,
    subaccountIdGhl: sub,
    caller_phone_e164: phoneKey,
    eventUuid: context?.eventUuid,
  });
  return true;
}

/** Same as `upsertFromLifecyclePayload` (kept for callers that still use the older name). */
export const upsertInboundContactIndexFromLifecycle = upsertFromLifecyclePayload;

// --- GHL fallback cache (local index backfill after phone search) ---

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/** Prefer non-empty GHL value; otherwise keep existing DB value; otherwise undefined (do not force-clear). */
function preferNonEmpty(
  ghlValue: string,
  existing: string | null | undefined
): string | undefined {
  const g = norm(ghlValue);
  if (g) {
    return g;
  }
  const e = norm(existing);
  return e || undefined;
}

function mergeDisplayName(
  g: GhlContactSearchSummary,
  existing: InboundContactIndex | null
): string | undefined {
  if (norm(g.displayName)) {
    return g.displayName.trim();
  }
  const fromG = [norm(g.firstName), norm(g.lastName)].filter(Boolean).join(" ").trim();
  if (fromG) {
    return fromG;
  }
  return existing?.displayName?.trim() || undefined;
}

function mergeSourceOrigin(existing: InboundContactIndex | null): InboundContactSourceOrigin {
  if (!existing) {
    return InboundContactSourceOrigin.ghl_backfill;
  }
  switch (existing.sourceOrigin) {
    case InboundContactSourceOrigin.lifecycle_webhook:
      return InboundContactSourceOrigin.merged;
    case InboundContactSourceOrigin.merged:
      return InboundContactSourceOrigin.merged;
    default:
      return InboundContactSourceOrigin.ghl_backfill;
  }
}

function buildMergedFieldsFromGhl(
  g: GhlContactSearchSummary,
  existing: InboundContactIndex | null
) {
  return {
    firstName: preferNonEmpty(g.firstName, existing?.firstName),
    lastName: preferNonEmpty(g.lastName, existing?.lastName),
    displayName: mergeDisplayName(g, existing),
    contactIdGhl: preferNonEmpty(g.contactIdGhl, existing?.contactIdGhl),
    email: preferNonEmpty(g.email, existing?.email),
    state: preferNonEmpty(g.state, existing?.state),
    assignedAgentName: preferNonEmpty(g.assignedAgentName, existing?.assignedAgentName),
    lifecycleStage: preferNonEmpty(g.lifecycleStage, existing?.lifecycleStage),
    appointmentStatus: preferNonEmpty(g.appointmentStatus, existing?.appointmentStatus),
    policyStatus: preferNonEmpty(g.policyStatus, existing?.policyStatus),
    leadUid: existing?.leadUid ?? undefined,
    assignedAgentId: existing?.assignedAgentId ?? undefined,
    leadType: existing?.leadType ?? undefined,
  };
}

/**
 * After a successful GHL phone match, upsert `InboundContactIndex` so future lookups hit SA360 first.
 *
 * Merge / upsert rules:
 * - Unique key: (`clientAccountId`, `subaccountIdGhl`, `phoneE164`) — caller supplies the same scope used for local lookup.
 * - String fields from GHL: if GHL sends a non-empty value, it wins; if GHL is empty, keep the existing non-empty DB value (never overwrite rich local data with blanks).
 * - `leadUid`, `leadType`, `assignedAgentId`: not present on GHL summary — preserved from an existing row only; omitted on update when absent.
 * - `sourceOrigin`: create from pure GHL → `ghl_backfill`; if an existing row was `lifecycle_webhook` → `merged`; if already `merged` → `merged`; if existing was only `ghl_backfill` → `ghl_backfill`.
 * - `clientStatus`: see `inbound-contact-client-status.ts` — GHL promotes to `EXISTING_CLIENT` only on strong
 *   `policyStatus` evidence; otherwise preserves the existing status (no downgrade). New rows default to `LEAD`.
 * - `lastSeenAt`: always set to `new Date()` on every successful GHL cache upsert.
 */
export async function upsertFromGhlFallback(params: {
  clientAccountId: string;
  subaccountIdGhl: string;
  phoneE164: string;
  contact: GhlContactSearchSummary;
}): Promise<void> {
  const { clientAccountId, subaccountIdGhl, phoneE164, contact: g } = params;

  const where = {
    clientAccountId_subaccountIdGhl_phoneE164: {
      clientAccountId,
      subaccountIdGhl,
      phoneE164,
    },
  };

  const existing = await findByCompositeKey(clientAccountId, subaccountIdGhl, phoneE164);
  const merged = buildMergedFieldsFromGhl(g, existing);
  const sourceOrigin = mergeSourceOrigin(existing);
  const clientStatus = resolveClientStatusAfterGhlEvidence(existing?.clientStatus ?? null, g);
  const lastSeenAt = new Date();

  await upsertInboundContactIndex({
    where,
    create: {
      clientAccountId,
      subaccountIdGhl,
      phoneE164,
      leadUid: merged.leadUid,
      contactIdGhl: merged.contactIdGhl ?? g.contactIdGhl,
      firstName: merged.firstName,
      lastName: merged.lastName,
      displayName: merged.displayName,
      email: merged.email,
      state: merged.state,
      assignedAgentId: merged.assignedAgentId,
      assignedAgentName: merged.assignedAgentName,
      lifecycleStage: merged.lifecycleStage,
      appointmentStatus: merged.appointmentStatus,
      policyStatus: merged.policyStatus,
      leadType: merged.leadType,
      sourceOrigin,
      clientStatus,
      lastSeenAt,
    },
    update: {
      lastSeenAt,
      sourceOrigin,
      clientStatus,
      ...(merged.firstName !== undefined ? { firstName: merged.firstName } : {}),
      ...(merged.lastName !== undefined ? { lastName: merged.lastName } : {}),
      ...(merged.displayName !== undefined ? { displayName: merged.displayName } : {}),
      ...(merged.contactIdGhl !== undefined ? { contactIdGhl: merged.contactIdGhl } : {}),
      ...(merged.email !== undefined ? { email: merged.email } : {}),
      ...(merged.state !== undefined ? { state: merged.state } : {}),
      ...(merged.assignedAgentName !== undefined
        ? { assignedAgentName: merged.assignedAgentName }
        : {}),
      ...(merged.lifecycleStage !== undefined ? { lifecycleStage: merged.lifecycleStage } : {}),
      ...(merged.appointmentStatus !== undefined
        ? { appointmentStatus: merged.appointmentStatus }
        : {}),
      ...(merged.policyStatus !== undefined ? { policyStatus: merged.policyStatus } : {}),
    },
  });
}

/**
 * Best-effort cache after GHL match. Logs and swallows errors so Synthflow response is unchanged.
 */
export async function tryUpsertFromGhlFallback(params: {
  clientAccountId: string;
  subaccountIdGhl: string;
  phoneE164: string;
  contact: GhlContactSearchSummary;
}): Promise<void> {
  logInboundLookupInfo("inbound_contact_index", {
    component: "inbound_contact_index",
    event: "local cache upsert from GHL attempted",
    clientAccountId: params.clientAccountId,
    subaccountIdGhl: params.subaccountIdGhl,
    caller_phone_e164: params.phoneE164,
  });
  try {
    await upsertFromGhlFallback(params);
    logInboundLookupInfo("inbound_contact_index", {
      component: "inbound_contact_index",
      event: "local cache upsert from GHL succeeded",
      clientAccountId: params.clientAccountId,
      subaccountIdGhl: params.subaccountIdGhl,
      caller_phone_e164: params.phoneE164,
    });
  } catch (err) {
    logInboundLookupWarn("inbound_contact_index", {
      component: "inbound_contact_index",
      event: "local cache upsert from GHL failed",
      clientAccountId: params.clientAccountId,
      subaccountIdGhl: params.subaccountIdGhl,
      caller_phone_e164: params.phoneE164,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
