import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import { readFacebookId, type FacebookIdRead } from "./facebook-form-association.js";

export type ZapierFacebookFormIdentityStatus = "present" | "missing" | "invalid";

export type ZapierFacebookCaptureFields = {
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  formIdentityStatus: ZapierFacebookFormIdentityStatus;
  formName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  state: string | null;
  postalCode: string | null;
  submittedAt: string | null;
};

export type ZapierFacebookParseResult =
  | { ok: true; fields: ZapierFacebookCaptureFields }
  | { ok: false; error: "invalid_payload" | "unsafe_facebook_id"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = record;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function firstValue(record: Record<string, unknown>, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = getPath(record, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function readOptionalText(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstText(record: Record<string, unknown>, paths: readonly string[]): string | null {
  return readOptionalText(firstValue(record, paths));
}

function readSubmittedAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const millis = Date.parse(trimmed);
  if (Number.isNaN(millis)) return null;
  return new Date(millis).toISOString();
}

function optionalFacebookId(
  value: unknown
): { status: "missing" | "invalid" | "present"; id: string | null; unsafe: boolean } {
  if (value === undefined || value === null || value === "") {
    return { status: "missing", id: null, unsafe: false };
  }
  const read: FacebookIdRead = readFacebookId(value);
  if (read.ok) return { status: "present", id: read.value, unsafe: false };
  if (read.code === "unsafe_number") return { status: "invalid", id: null, unsafe: true };
  if (read.code === "missing") return { status: "missing", id: null, unsafe: false };
  return { status: "invalid", id: null, unsafe: false };
}

export function parseZapierFacebookCapturePayload(raw: unknown): ZapierFacebookParseResult {
  const record = asRecord(raw);
  if (!record) {
    return {
      ok: false,
      error: "invalid_payload",
      message: "Facebook capture requires a JSON object.",
    };
  }

  const leadgenRaw = firstValue(record, [
    "leadgen_id",
    "leadgenId",
    "facebook_lead_id",
    "facebookLeadId",
    "lead.id",
    "facebook.leadgen_id",
    "id",
  ]);
  const leadgen = readFacebookId(leadgenRaw);
  if (!leadgen.ok) {
    if (leadgen.code === "unsafe_number") {
      return {
        ok: false,
        error: "unsafe_facebook_id",
        message: "Facebook IDs must be sent as strings so large IDs are not rounded.",
      };
    }
    return {
      ok: false,
      error: "invalid_payload",
      message: "A numeric Facebook leadgen_id string is required.",
    };
  }

  const page = optionalFacebookId(
    firstValue(record, ["page_id", "pageId", "facebook.page_id"])
  );
  const form = optionalFacebookId(
    firstValue(record, ["form_id", "formId", "facebook.form_id", "facebook_form_id"])
  );
  if (page.unsafe || form.unsafe) {
    return {
      ok: false,
      error: "unsafe_facebook_id",
      message: "Facebook IDs must be sent as strings so large IDs are not rounded.",
    };
  }

  let formIdentityStatus: ZapierFacebookFormIdentityStatus = "present";
  if (page.status === "invalid" || form.status === "invalid") {
    formIdentityStatus = "invalid";
  } else if (page.status !== "present" || form.status !== "present") {
    formIdentityStatus = "missing";
  }

  const phone = firstText(record, ["phone", "phone_number", "phoneNumber", "lead.phone"]);
  const phoneResult = phone ? tryNormalizeToVerifiedE164(phone) : null;

  const submittedRaw = firstValue(record, [
    "submitted_at",
    "submittedAt",
    "created_time",
    "createdTime",
    "lead.created_time",
  ]);

  return {
    ok: true,
    fields: {
      leadgenId: leadgen.value,
      pageId: page.id,
      formId: form.id,
      formIdentityStatus,
      formName: firstText(record, ["form_name", "formName", "facebook.form_name"]),
      campaignId: firstText(record, ["campaign_id", "campaignId", "facebook.campaign_id"]),
      campaignName: firstText(record, ["campaign_name", "campaignName", "facebook.campaign_name"]),
      adsetId: firstText(record, ["adset_id", "adsetId", "facebook.adset_id"]),
      adsetName: firstText(record, ["adset_name", "adsetName", "facebook.adset_name"]),
      adId: firstText(record, ["ad_id", "adId", "facebook.ad_id"]),
      adName: firstText(record, ["ad_name", "adName", "facebook.ad_name"]),
      firstName: firstText(record, ["first_name", "firstName", "lead.first_name"]),
      lastName: firstText(record, ["last_name", "lastName", "lead.last_name"]),
      email: firstText(record, ["email", "email_address", "lead.email"]),
      phone,
      phoneE164: phoneResult?.ok ? phoneResult.e164 : null,
      state: firstText(record, ["state", "state_code", "lead.state"]),
      postalCode: firstText(record, ["postal_code", "postalCode", "zip", "zip_code", "lead.zip"]),
      submittedAt: readSubmittedAt(submittedRaw),
    },
  };
}
