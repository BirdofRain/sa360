import type { WebhookRequestLog } from "@prisma/client";
import type { WebhookLeadIdentity } from "./webhook-log-lead-identity.js";

export type WebhookDetailFieldValue = string | boolean | null;

export type WebhookDetailFieldErrors = Array<{ path: string; message: string }>;

export type WebhookRequestDetailDebug = {
  summary: {
    event: string | null;
    validity: "valid" | "invalid";
    status: string;
    http: string | null;
    time: string;
    durationMs: string | null;
    source: string;
    route: string;
  };
  topLine: {
    request_id: string;
    time: string;
    event: string | null;
    lead: string | null;
    client: string | null;
    subaccount: string | null;
    validity: "valid" | "invalid";
    status: string;
    http: string | null;
    ms: string | null;
    route: string;
  };
  identity: Record<string, WebhookDetailFieldValue>;
  lifecycleEvent: Record<string, WebhookDetailFieldValue>;
  state: Record<string, WebhookDetailFieldValue>;
  attribution: Record<string, WebhookDetailFieldValue>;
  routingOwnership: Record<string, WebhookDetailFieldValue>;
  errors: {
    error_code: string | null;
    error_summary: string | null;
    processingStatus: string;
    validityReason: string | null;
    unauthorizedReason: string | null;
    fieldErrors: WebhookDetailFieldErrors;
  } | null;
  requestBodyRedacted: unknown;
  responseBodyRedacted: unknown;
  meta: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function pickPath(root: Record<string, unknown> | null, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[key];
  }
  return cur;
}

function flattenZodFieldErrors(details: unknown): WebhookDetailFieldErrors {
  const rec = asRecord(details);
  if (!rec) return [];
  const fieldErrors = asRecord(rec.fieldErrors);
  if (!fieldErrors) return [];
  const out: WebhookDetailFieldErrors = [];
  for (const [path, messages] of Object.entries(fieldErrors)) {
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg === "string") out.push({ path, message: msg });
      }
    } else if (typeof messages === "string") {
      out.push({ path, message: messages });
    }
  }
  const formErrors = rec.formErrors;
  if (Array.isArray(formErrors)) {
    for (const msg of formErrors) {
      if (typeof msg === "string") out.push({ path: "_form", message: msg });
    }
  }
  return out;
}

function isInvalidProcessingStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "unauthorized" || s === "validation_failed";
}

function validityReasonFor(status: string, errorCode: string | null): string | null {
  const s = status.trim().toLowerCase();
  if (s === "unauthorized") return "Webhook secret missing or invalid (x-sa360-secret).";
  if (s === "validation_failed") return "Payload failed lifecycle schema validation.";
  if (errorCode === "VALIDATION_FAILED") return "Lifecycle payload validation failed.";
  if (s.includes("fail") || s.includes("error")) return `Processing status: ${status}`;
  return null;
}

function unauthorizedReasonFor(
  status: string,
  responseBody: unknown
): string | null {
  if (status.trim().toLowerCase() !== "unauthorized") return null;
  const rec = asRecord(responseBody);
  const err = asString(rec?.error);
  return err ?? "Unauthorized — invalid or missing webhook secret.";
}

function parseLifecycleFromRequest(requestBody: unknown): Record<string, unknown> | null {
  return asRecord(requestBody);
}

function buildRoutingOwnership(
  payload: Record<string, unknown> | null,
  row: WebhookRequestLog
): Record<string, WebhookDetailFieldValue> {
  const routing = asRecord(payload ? pickPath(payload, ["routing"]) : null);
  const pickR = (key: string) => asString(routing?.[key]);

  return {
    campaign_scope: pickR("campaign_scope") ?? pickR("sa360_campaign_scope"),
    campaign_key: pickR("campaign_key") ?? pickR("sa360_campaign_key"),
    niche_key: pickR("niche_key"),
    niche_label: pickR("niche_label") ?? pickR("niche_name"),
    product_type: pickR("product_type") ?? asString(pickPath(payload, ["policy", "product_type"])),
    lead_pool_id: pickR("lead_pool_id"),
    assignment_status: pickR("assignment_status"),
    master_dataset_id: pickR("master_dataset_id"),
    client_dataset_id:
      pickR("client_dataset_id") ??
      pickR("source_dataset_id") ??
      pickR("sa360_source_dataset_id"),
    assigned_client_account_id:
      asString(pickPath(payload, ["client_account_id"])) ?? row.clientAccountId,
    assigned_subaccount_id_ghl:
      asString(pickPath(payload, ["subaccount_id_ghl"])) ?? row.subaccountIdGhl,
    updated_by: asString(pickPath(payload, ["ownership", "updated_by"])),
  };
}

function buildStateSnapshot(
  payload: Record<string, unknown> | null,
  eventName: string | null
): Record<string, WebhookDetailFieldValue> {
  const state = asRecord(payload ? pickPath(payload, ["state"]) : null);
  const stage = asString(state?.lifecycle_stage);
  const event = eventName?.toLowerCase() ?? "";

  return {
    lifecycle_stage: stage,
    lead_status: asString(state?.lead_status),
    appointment_status: asString(state?.appointment_status),
    agent_disposition: asString(state?.agent_disposition),
    policy_status: asString(state?.policy_status),
    ai_status: asString(state?.ai_status),
    routing_status: asString(state?.routing_status),
    dead_lead_flag: asBool(state?.dead_lead_flag),
    bad_number_flag: stage === "BAD_NUMBER" || event === "bad_number" ? true : false,
    dnc_flag: stage === "DNC" || event === "dnc" ? true : false,
  };
}

const ATTRIBUTION_KEYS = [
  "source_platform",
  "source_type",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "fbclid",
  "fbc",
  "fbp",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "meta_dataset_id",
] as const;

function buildAttribution(payload: Record<string, unknown> | null): Record<string, WebhookDetailFieldValue> {
  const attr = asRecord(payload ? pickPath(payload, ["attribution"]) : null);
  const out: Record<string, WebhookDetailFieldValue> = {};
  for (const key of ATTRIBUTION_KEYS) {
    out[key] = asString(attr?.[key]);
  }
  return out;
}

function buildLifecycleEvent(payload: Record<string, unknown> | null): Record<string, WebhookDetailFieldValue> {
  const event = asRecord(payload ? pickPath(payload, ["event"]) : null);
  return {
    event_uuid: asString(event?.event_uuid),
    event_name_internal: asString(event?.event_name_internal),
    event_name_meta: asString(event?.event_name_meta),
    value_score: event?.value_score !== undefined ? asString(event.value_score) : null,
    currency: asString(event?.currency),
    send_to_meta: asBool(event?.send_to_meta),
    schema_version: asString(payload?.schema_version),
  };
}

function buildIdentity(
  payload: Record<string, unknown> | null,
  row: WebhookRequestLog,
  identity: WebhookLeadIdentity
): Record<string, WebhookDetailFieldValue> {
  const contact = asRecord(payload ? pickPath(payload, ["contact"]) : null);
  const ownership = asRecord(payload ? pickPath(payload, ["ownership"]) : null);

  return {
    lead_name: identity.leadName,
    contact_id_ghl: asString(contact?.contact_id_ghl) ?? row.contactIdGhl,
    lead_uid: asString(contact?.lead_uid),
    phone: identity.leadPhone ?? asString(contact?.phone_e164) ?? asString(contact?.phone),
    email: identity.leadEmail ?? asString(contact?.email),
    state: asString(contact?.state),
    client_account_id: asString(pickPath(payload, ["client_account_id"])) ?? row.clientAccountId,
    subaccount_id_ghl: asString(pickPath(payload, ["subaccount_id_ghl"])) ?? row.subaccountIdGhl,
    assigned_agent_name: asString(ownership?.assigned_agent_name),
    assigned_agent_id: asString(ownership?.assigned_agent_id),
  };
}

export function buildWebhookRequestDetailDebug(
  row: WebhookRequestLog,
  identity: WebhookLeadIdentity
): WebhookRequestDetailDebug {
  const payload = parseLifecycleFromRequest(row.requestBodyRedacted);
  const eventName =
    row.eventNameInternal ?? asString(pickPath(payload, ["event", "event_name_internal"]));
  const validity: "valid" | "invalid" = isInvalidProcessingStatus(row.processingStatus)
    ? "invalid"
    : "valid";
  const time = row.receivedAt.toISOString();
  const fieldErrors = flattenZodFieldErrors(asRecord(row.responseBodyRedacted)?.details);

  const hasErrors =
    validity === "invalid" ||
    Boolean(row.errorCode) ||
    Boolean(row.errorSummary) ||
    fieldErrors.length > 0 ||
    row.processingStatus.toLowerCase().includes("fail");

  const errors = hasErrors
    ? {
        error_code: row.errorCode,
        error_summary: row.errorSummary,
        processingStatus: row.processingStatus,
        validityReason: validityReasonFor(row.processingStatus, row.errorCode),
        unauthorizedReason: unauthorizedReasonFor(row.processingStatus, row.responseBodyRedacted),
        fieldErrors,
      }
    : null;

  const topLine = {
    request_id: row.requestId,
    time,
    event: eventName,
    lead: identity.leadName,
    client: row.clientAccountId,
    subaccount: row.subaccountIdGhl,
    validity,
    status: row.processingStatus,
    http: row.httpStatus !== null ? String(row.httpStatus) : null,
    ms: row.durationMs !== null ? String(row.durationMs) : null,
    route: row.route,
  };

  return {
    summary: {
      event: eventName,
      validity,
      status: row.processingStatus,
      http: row.httpStatus !== null ? String(row.httpStatus) : null,
      time,
      durationMs: row.durationMs !== null ? String(row.durationMs) : null,
      source: row.source,
      route: row.route,
    },
    topLine,
    identity: buildIdentity(payload, row, identity),
    lifecycleEvent: buildLifecycleEvent(payload),
    state: buildStateSnapshot(payload, eventName),
    attribution: buildAttribution(payload),
    routingOwnership: buildRoutingOwnership(payload, row),
    errors,
    requestBodyRedacted: row.requestBodyRedacted ?? null,
    responseBodyRedacted: row.responseBodyRedacted ?? null,
    meta: {
      id: row.id,
      requestId: row.requestId,
      source: row.source,
      route: row.route,
      receivedAt: time,
      completedAt: row.completedAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      processingStatus: row.processingStatus,
      httpStatus: row.httpStatus,
      clientAccountId: row.clientAccountId,
      subaccountIdGhl: row.subaccountIdGhl,
      contactIdGhl: row.contactIdGhl,
      eventUuid: row.eventUuid,
      eventNameInternal: row.eventNameInternal,
      errorCode: row.errorCode,
      errorSummary: row.errorSummary,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}
