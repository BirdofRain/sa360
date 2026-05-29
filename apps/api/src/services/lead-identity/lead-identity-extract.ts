import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import type { RoutingAttributionInput } from "../../lib/routing-attribution-extract.js";
import { resolveLifecycleContactPhoneDetails } from "../../lib/lifecycle-contact-phone.js";
import type { LeadIdentitySnapshot } from "./lead-identity.types.js";

function trim(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = trim(email)?.toLowerCase();
  return e && e.includes("@") ? e : null;
}

function readRoutingField(payload: LifecycleEventSchema, key: string): string | null {
  const routing = payload.routing as Record<string, unknown> | undefined;
  if (!routing) return null;
  const v = routing[key];
  return typeof v === "string" ? trim(v) : null;
}

export function extractLeadIdentitySnapshot(
  payload: LifecycleEventSchema,
  opts: {
    destinationClientAccountId?: string | null;
    destinationSubaccountIdGhl?: string | null;
    attribution?: RoutingAttributionInput | null;
    eventReceivedAt?: Date | null;
  } = {}
): LeadIdentitySnapshot {
  const phone = resolveLifecycleContactPhoneDetails(payload);
  const c = payload.contact;
  const attr = opts.attribution;
  const first = trim(c.first_name);
  const last = trim(c.last_name);
  const fullName =
    [first, last].filter(Boolean).join(" ").trim() ||
    trim(c.email) ||
    null;

  return {
    sa360LeadUid: trim(c.lead_uid),
    masterContactIdGhl:
      payload.client_account_id === opts.destinationClientAccountId
        ? trim(c.contact_id_ghl)
        : trim(c.contact_id_ghl),
    clientContactIdGhl: trim(c.contact_id_ghl),
    facebookLeadId:
      readRoutingField(payload, "facebook_lead_id") ??
      readRoutingField(payload, "meta_lead_id") ??
      null,
    facebookSubmissionId:
      readRoutingField(payload, "facebook_submission_id") ??
      readRoutingField(payload, "meta_submission_id") ??
      null,
    appointmentId: trim(payload.appointment?.appointment_id),
    normalizedPhone: phone.normalized_e164,
    normalizedEmail: normalizeEmail(c.email),
    firstName: first,
    lastName: last,
    fullName: fullName || null,
    clientAccountId: trim(payload.client_account_id),
    destinationClientAccountId: trim(opts.destinationClientAccountId),
    destinationSubaccountIdGhl: trim(opts.destinationSubaccountIdGhl),
    campaignId: trim(attr?.campaignId ?? payload.attribution?.campaign_id),
    utmCampaign: trim(attr?.utmCampaign ?? payload.attribution?.utm_campaign),
    nicheKey: trim(attr?.nicheKey ?? payload.routing?.niche_key),
    sourceType: trim(attr?.sourceType ?? payload.attribution?.source_type),
    eventNameInternal: trim(payload.event.event_name_internal),
    eventReceivedAt: opts.eventReceivedAt ?? null,
  };
}

export function normalizeNameForCompare(name: string | null | undefined): string | null {
  const n = trim(name)?.toLowerCase();
  if (!n) return null;
  return n.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() || null;
}

export function namesSimilar(a: string | null, b: string | null): boolean {
  const na = normalizeNameForCompare(a);
  const nb = normalizeNameForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aParts = new Set(na.split(" "));
  const bParts = nb.split(" ");
  const overlap = bParts.filter((p) => aParts.has(p) && p.length > 1);
  return overlap.length >= 2;
}

export { normalizeEmail };
