import type { MetaWebhookConfig } from "../../lib/meta-webhook.js";
import type { FacebookLeadFields } from "./facebook-lead-normalizer.js";

/**
 * Meta Lead Ads Graph API client + webhook envelope extraction.
 *
 * The access token is only ever placed in the outbound Graph URL; it is never logged,
 * stored, or returned. Only the (token-free) Graph response body is persisted.
 */

export type MetaLeadgenEnvelope = {
  leadgenId: string;
  pageId?: string;
  formId?: string;
  adId?: string;
  adgroupId?: string;
  createdTime?: string;
};

function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * Extract leadgen change envelopes from a Meta Lead Ads webhook notification.
 * Tolerates missing/odd shapes by returning an empty array (caller logs + responds 200).
 */
export function extractLeadgenEnvelopes(body: unknown): MetaLeadgenEnvelope[] {
  if (!body || typeof body !== "object") return [];
  const entries = (body as Record<string, unknown>).entry;
  if (!Array.isArray(entries)) return [];

  const out: MetaLeadgenEnvelope[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const entryRec = entry as Record<string, unknown>;
    const entryPageId = asString(entryRec.id);
    const changes = entryRec.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const changeRec = change as Record<string, unknown>;
      if (asString(changeRec.field) !== "leadgen") continue;
      const value = changeRec.value;
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const leadgenId = asString(v.leadgen_id) ?? asString(v.leadgenId);
      if (!leadgenId) continue;
      const createdTimeRaw = v.created_time ?? v.createdTime;
      out.push({
        leadgenId,
        pageId: asString(v.page_id) ?? entryPageId,
        formId: asString(v.form_id),
        adId: asString(v.ad_id),
        adgroupId: asString(v.adgroup_id),
        createdTime:
          typeof createdTimeRaw === "number"
            ? new Date(createdTimeRaw * 1000).toISOString()
            : asString(createdTimeRaw),
      });
    }
  }
  return out;
}

export type MetaGraphLeadResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
};

export type MetaLeadFetcher = (
  leadgenId: string,
  config: MetaWebhookConfig
) => Promise<MetaGraphLeadResult>;

const LEAD_FIELDS = [
  "id",
  "created_time",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "form_name",
  "platform",
  "field_data",
].join(",");

/** Default Graph API fetcher. Token stays in the URL only; never logged or returned. */
export const fetchMetaLeadDetails: MetaLeadFetcher = async (leadgenId, config) => {
  if (!config.accessToken) {
    return { ok: false, status: 0, body: { error: "missing_access_token" } };
  }
  const url =
    `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(leadgenId)}` +
    `?fields=${LEAD_FIELDS}&access_token=${encodeURIComponent(config.accessToken)}`;

  const response = await fetch(url, { method: "GET" });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, body };
};

const FIELD_ALIASES: Record<string, keyof FacebookLeadFields> = {
  email: "email",
  email_address: "email",
  phone: "phone",
  phone_number: "phone",
  first_name: "firstName",
  last_name: "lastName",
  state: "state",
  state_province: "state",
  province: "state",
  zip: "zip",
  zip_code: "zip",
  postal_code: "zip",
  postcode: "zip",
};

function readFieldData(graphLead: Record<string, unknown>): {
  mapped: Partial<FacebookLeadFields>;
  custom: Record<string, string>;
  fullName?: string;
} {
  const mapped: Partial<FacebookLeadFields> = {};
  const custom: Record<string, string> = {};
  let fullName: string | undefined;
  const fieldData = graphLead.field_data;
  if (!Array.isArray(fieldData)) return { mapped, custom, fullName };

  for (const field of fieldData) {
    if (!field || typeof field !== "object") continue;
    const rec = field as Record<string, unknown>;
    const name = asString(rec.name);
    if (!name) continue;
    const values = Array.isArray(rec.values) ? rec.values : [];
    const value = asString(values[0]);
    if (value === undefined) continue;
    const key = name.toLowerCase();
    if (key === "full_name" || key === "name") {
      fullName = value;
      continue;
    }
    const aliasKey = FIELD_ALIASES[key];
    if (aliasKey) {
      (mapped as Record<string, string>)[aliasKey] = value;
    } else {
      custom[name] = value;
    }
  }
  return { mapped, custom, fullName };
}

function splitFullName(fullName: string): { firstName?: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Merge the (token-free) Graph lead response with the webhook envelope into normalizer input. */
export function mapMetaLeadToFacebookFields(
  graphLead: Record<string, unknown>,
  envelope: MetaLeadgenEnvelope
): FacebookLeadFields {
  const { mapped, custom, fullName } = readFieldData(graphLead);
  const nameParts = fullName ? splitFullName(fullName) : {};

  return {
    leadgenId: asString(graphLead.id) ?? envelope.leadgenId,
    pageId: envelope.pageId,
    formId: asString(graphLead.form_id) ?? envelope.formId,
    formName: asString(graphLead.form_name),
    adId: asString(graphLead.ad_id) ?? envelope.adId,
    adName: asString(graphLead.ad_name),
    adgroupId: envelope.adgroupId,
    adsetId: asString(graphLead.adset_id),
    adsetName: asString(graphLead.adset_name),
    campaignId: asString(graphLead.campaign_id),
    campaignName: asString(graphLead.campaign_name),
    platform: asString(graphLead.platform),
    createdTime: asString(graphLead.created_time) ?? envelope.createdTime,
    firstName: mapped.firstName ?? nameParts.firstName,
    lastName: mapped.lastName ?? nameParts.lastName,
    email: mapped.email,
    phone: mapped.phone,
    state: mapped.state,
    zip: mapped.zip,
    custom: Object.keys(custom).length > 0 ? custom : undefined,
  };
}
