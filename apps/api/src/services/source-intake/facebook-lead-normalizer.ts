import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";

/**
 * Flattened Facebook Lead Ads input shape (merged Graph response + webhook envelope).
 * This is also the body accepted by POST /sources/facebook/test-lead so staging can
 * exercise the normalize -> match -> dry-run pipeline without calling Meta.
 */
export type FacebookLeadFields = {
  leadgenId: string;
  pageId?: string;
  formId?: string;
  formName?: string;
  adId?: string;
  adName?: string;
  adgroupId?: string;
  adsetId?: string;
  adsetName?: string;
  campaignId?: string;
  campaignName?: string;
  platform?: string;
  createdTime?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  state?: string;
  zip?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  custom?: Record<string, string>;
};

export const FACEBOOK_LEAD_PROVIDER = "facebook" as const;
export const FACEBOOK_LEAD_SOURCE_SYSTEM = "meta_lead_ads" as const;

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function buildFacebookLeadUid(leadgenId: string): string {
  return `facebook-${FACEBOOK_LEAD_SOURCE_SYSTEM}-${leadgenId}`;
}

export function buildFacebookEventUuid(leadgenId: string): string {
  return `FBLEAD-${FACEBOOK_LEAD_SOURCE_SYSTEM}-${leadgenId}`;
}

/** Route key used for source-event grouping and C.O.C. display (form, else campaign, else leadgen). */
export function resolveFacebookRouteKey(fields: FacebookLeadFields): string {
  return (
    trimOrUndefined(fields.formId) ??
    trimOrUndefined(fields.campaignId) ??
    `leadgen_${fields.leadgenId}`
  );
}

function readString(rec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = trimOrUndefined(rec[key]);
    if (v) return v;
  }
  return undefined;
}

/**
 * Tolerantly coerce an arbitrary JSON body (e.g. POST /sources/facebook/test-lead) into
 * FacebookLeadFields. Accepts both snake_case and camelCase keys. Returns null only when
 * there is no usable object; a missing leadgenId is synthesized so staging tests still run.
 */
export function coerceFacebookLeadFields(body: unknown): FacebookLeadFields | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  const customRaw = rec.custom ?? rec.custom_fields;
  const custom =
    customRaw && typeof customRaw === "object" && !Array.isArray(customRaw)
      ? Object.fromEntries(
          Object.entries(customRaw as Record<string, unknown>)
            .map(([k, v]) => [k, trimOrUndefined(v)])
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
        )
      : undefined;

  return {
    leadgenId:
      readString(rec, "leadgenId", "leadgen_id", "id") ?? `test_${Date.now()}`,
    pageId: readString(rec, "pageId", "page_id"),
    formId: readString(rec, "formId", "form_id"),
    formName: readString(rec, "formName", "form_name"),
    adId: readString(rec, "adId", "ad_id"),
    adName: readString(rec, "adName", "ad_name"),
    adgroupId: readString(rec, "adgroupId", "adgroup_id"),
    adsetId: readString(rec, "adsetId", "adset_id"),
    adsetName: readString(rec, "adsetName", "adset_name"),
    campaignId: readString(rec, "campaignId", "campaign_id"),
    campaignName: readString(rec, "campaignName", "campaign_name"),
    platform: readString(rec, "platform"),
    createdTime: readString(rec, "createdTime", "created_time"),
    firstName: readString(rec, "firstName", "first_name"),
    lastName: readString(rec, "lastName", "last_name"),
    email: readString(rec, "email", "email_address"),
    phone: readString(rec, "phone", "phone_number"),
    state: readString(rec, "state", "state_province"),
    zip: readString(rec, "zip", "zip_code", "postal_code"),
    fbclid: readString(rec, "fbclid"),
    fbc: readString(rec, "fbc"),
    fbp: readString(rec, "fbp"),
    custom: custom && Object.keys(custom).length > 0 ? custom : undefined,
  };
}

export type NormalizeFacebookLeadOptions = {
  masterClientAccountId: string;
};

/**
 * Normalize a Facebook Lead Ads lead into the SA360 MASTER 2.0 lifecycle payload
 * consumed by the existing routing matcher / dry-run pipeline. The matcher reads
 * `attribution.*` and `routing.form_id`, so both are populated here.
 */
export function normalizeFacebookLeadToLifecyclePayload(
  fields: FacebookLeadFields,
  opts: NormalizeFacebookLeadOptions
): LifecycleEventSchema {
  const leadgenId = fields.leadgenId.trim();
  const routeKey = resolveFacebookRouteKey(fields);
  const phoneRaw = trimOrUndefined(fields.phone) ?? "";
  const phoneResult = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
  const phoneE164 = phoneResult?.ok ? phoneResult.e164 : undefined;

  const campaignName = trimOrUndefined(fields.campaignName);
  const formName = trimOrUndefined(fields.formName);

  return {
    schema_version: "MASTER 2.0",
    client_account_id: opts.masterClientAccountId,
    subaccount_id_ghl: opts.masterClientAccountId,
    contact: {
      lead_uid: buildFacebookLeadUid(leadgenId),
      first_name: trimOrUndefined(fields.firstName),
      last_name: trimOrUndefined(fields.lastName),
      email: trimOrUndefined(fields.email),
      phone: phoneRaw || undefined,
      phone_e164: phoneE164,
      state: trimOrUndefined(fields.state),
      zip: trimOrUndefined(fields.zip),
    },
    attribution: {
      source_platform: FACEBOOK_LEAD_PROVIDER,
      source_type: "facebook_lead_form",
      campaign_id: trimOrUndefined(fields.campaignId),
      campaign_name: campaignName,
      adset_id: trimOrUndefined(fields.adsetId),
      adset_name: trimOrUndefined(fields.adsetName),
      ad_id: trimOrUndefined(fields.adId),
      ad_name: trimOrUndefined(fields.adName),
      utm_campaign: campaignName,
      fbclid: trimOrUndefined(fields.fbclid),
      fbc: trimOrUndefined(fields.fbc),
      fbp: trimOrUndefined(fields.fbp),
    },
    state: {
      lifecycle_stage: "NEW",
      routing_status: "RECEIVED",
    },
    event: {
      event_uuid: buildFacebookEventUuid(leadgenId),
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    routing: {
      // Surfaced for the routing matcher (reads routing.form_id) and C.O.C. display.
      form_id: trimOrUndefined(fields.formId),
      form_name: formName,
      page_id: trimOrUndefined(fields.pageId),
      campaign_key: routeKey,
      source_intake: {
        provider: FACEBOOK_LEAD_PROVIDER,
        source_system: FACEBOOK_LEAD_SOURCE_SYSTEM,
        source_type: "facebook_lead_form",
        source_route_key: routeKey,
        campaign_name: campaignName,
        form_name: formName,
        lead_id: leadgenId,
        platform: trimOrUndefined(fields.platform),
        created_time: trimOrUndefined(fields.createdTime),
        custom_fields: fields.custom ?? {},
      },
    },
  };
}
