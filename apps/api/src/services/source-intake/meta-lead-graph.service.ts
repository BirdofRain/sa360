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

/** Graph outcome classes used by the async meta-leadgen-fetch worker. */
export type MetaGraphOutcome =
  | "success"
  | "retryable_failure"
  | "non_retryable_failure"
  | "auth_failure"
  | "not_found"
  | "malformed";

function graphErrorCode(body: Record<string, unknown> | null): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = body.error;
  if (!error || typeof error !== "object") return undefined;
  const rec = error as Record<string, unknown>;
  if (typeof rec.code === "number") return String(rec.code);
  if (typeof rec.code === "string") return rec.code;
  if (typeof rec.type === "string") return rec.type;
  return undefined;
}

function hasUsableLeadBody(body: Record<string, unknown> | null): boolean {
  if (!body || typeof body !== "object") return false;
  if (asString(body.id)) return true;
  return Array.isArray(body.field_data);
}

/**
 * Classify a Graph lead GET into retryable vs terminal outcomes.
 * Does not log or return the access token.
 */
export function classifyMetaGraphResult(result: MetaGraphLeadResult): MetaGraphOutcome {
  const status = result.status;
  if (result.ok && hasUsableLeadBody(result.body)) return "success";
  if (result.ok && !hasUsableLeadBody(result.body)) return "malformed";

  if (status === 0) return "retryable_failure";
  if (status === 429) return "retryable_failure";
  if (status >= 500) return "retryable_failure";
  if (status === 401 || status === 403) return "auth_failure";
  if (status === 404) return "not_found";

  const code = graphErrorCode(result.body);
  if (code === "190" || code === "102" || code === "OAuthException") return "auth_failure";
  if (code === "100" || code === "803") return "not_found";

  if (status >= 400 && status < 500) return "non_retryable_failure";
  return "retryable_failure";
}

export function isRetryableMetaGraphOutcome(outcome: MetaGraphOutcome): boolean {
  return outcome === "retryable_failure";
}

export type MetaLeadFetcher = (
  leadgenId: string,
  config: MetaWebhookConfig
) => Promise<MetaGraphLeadResult>;

/** Bound Graph GET so a hung lead fetch cannot overlap a BullMQ stall (~30s). */
export const META_GRAPH_FETCH_TIMEOUT_MS = 25_000;

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
    return { ok: false, status: 401, body: { error: "missing_access_token" } };
  }
  const url =
    `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(leadgenId)}` +
    `?fields=${LEAD_FIELDS}&access_token=${encodeURIComponent(config.accessToken)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(META_GRAPH_FETCH_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: "network_error" } };
  }
};

/** Build a token-free Graph-shaped body from fixture/test-lead fields (no live Meta token). */
export function buildFixtureGraphLead(
  leadgenId: string,
  fields: Partial<FacebookLeadFields> & { field_data?: unknown }
): Record<string, unknown> {
  const fieldData = Array.isArray(fields.field_data)
    ? fields.field_data
    : [
        ...(fields.firstName ? [{ name: "first_name", values: [fields.firstName] }] : []),
        ...(fields.lastName ? [{ name: "last_name", values: [fields.lastName] }] : []),
        ...(fields.email ? [{ name: "email", values: [fields.email] }] : []),
        ...(fields.phone ? [{ name: "phone_number", values: [fields.phone] }] : []),
        ...(fields.state ? [{ name: "state", values: [fields.state] }] : []),
        ...(fields.zip ? [{ name: "zip", values: [fields.zip] }] : []),
      ];
  return {
    id: leadgenId,
    created_time: fields.createdTime,
    ad_id: fields.adId,
    ad_name: fields.adName,
    adset_id: fields.adsetId,
    adset_name: fields.adsetName,
    campaign_id: fields.campaignId,
    campaign_name: fields.campaignName,
    form_id: fields.formId,
    form_name: fields.formName,
    platform: fields.platform,
    field_data: fieldData,
  };
}

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
