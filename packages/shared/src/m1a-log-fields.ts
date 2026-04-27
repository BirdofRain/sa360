import type { LifecycleWebhookPayload } from "./types.js";

export type M1AStage =
  | "m1a.webhook.received"
  | "m1a.payload.validated"
  | "m1a.event.stored"
  | "m1a.attribution.upserted"
  | "m1a.contact_index.upserted"
  | "m1a.contact_index.failed"
  | "m1a.queue.created"
  | "m1a.webhook.completed"
  | "m1a.webhook.failed"
  | "m1a.webhook.skipped_duplicate"
  | "m1a.webhook.duplicate_index_refreshed"
  | "m1a.duplicate.index_upsert.started"
  | "m1a.duplicate.index_upsert.completed"
  | "m1a.duplicate.index_upsert.failed"
  | "worker.job.received"
  | "worker.event.loaded"
  | "worker.meta.skipped_disabled"
  | "worker.meta.dispatch.started"
  | "worker.meta.dispatch.success"
  | "worker.meta.dispatch.failed"
  | "worker.job.completed"
  | "worker.job.failed";

/** Safe, non-secret fields allowed on M1A telemetry logs (no raw payload / headers). */
export type SafeM1ALogFields = {
  client_account_id?: string;
  subaccount_id_ghl?: string;
  lead_uid?: string;
  contact_id_ghl?: string;
  phone_e164?: string;
  event_uuid?: string;
  event_name_internal?: string;
  event_name_meta?: string;
  source_platform?: string;
  source_type?: string;
  niche_key?: string;
  lifecycle_stage?: string;
  appointment_status?: string;
  policy_status?: string | null;
  assigned_agent_id?: string;
  assigned_agent_name?: string;
  send_to_meta?: boolean;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  return str(v);
}

function readNested(
  root: Record<string, unknown>,
  path: string[]
): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Extract safe display fields from a validated lifecycle payload. */
export function extractSafeM1ALogFields(
  payload: LifecycleWebhookPayload
): SafeM1ALogFields {
  return {
    client_account_id: payload.client_account_id,
    subaccount_id_ghl: payload.subaccount_id_ghl?.trim() || undefined,
    lead_uid: payload.contact?.lead_uid,
    contact_id_ghl: payload.contact?.contact_id_ghl,
    phone_e164: payload.contact?.phone_e164,
    event_uuid: payload.event?.event_uuid,
    event_name_internal: payload.event?.event_name_internal,
    event_name_meta: payload.event?.event_name_meta,
    source_platform: payload.attribution?.source_platform,
    source_type: payload.attribution?.source_type,
    niche_key: payload.routing?.niche_key,
    lifecycle_stage: payload.state?.lifecycle_stage,
    appointment_status: payload.state?.appointment_status,
    policy_status: payload.state?.policy_status ?? undefined,
    assigned_agent_id: payload.ownership?.assigned_agent_id,
    assigned_agent_name: payload.ownership?.assigned_agent_name,
    send_to_meta: payload.event?.send_to_meta,
  };
}

/**
 * Best-effort safe fields from unknown JSON (e.g. invalid body).
 * Only reads known keys; never spreads the full object.
 */
export function extractSafeM1ALogFieldsFromUnknown(
  body: unknown
): SafeM1ALogFields {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  const o = body as Record<string, unknown>;
  return {
    client_account_id: str(o.client_account_id),
    subaccount_id_ghl: str(o.subaccount_id_ghl),
    lead_uid: str(readNested(o, ["contact", "lead_uid"])),
    contact_id_ghl: str(readNested(o, ["contact", "contact_id_ghl"])),
    phone_e164: str(readNested(o, ["contact", "phone_e164"])),
    event_uuid: str(readNested(o, ["event", "event_uuid"])),
    event_name_internal: str(readNested(o, ["event", "event_name_internal"])),
    event_name_meta: str(readNested(o, ["event", "event_name_meta"])),
    source_platform: str(readNested(o, ["attribution", "source_platform"])),
    source_type: str(readNested(o, ["attribution", "source_type"])),
    niche_key: str(readNested(o, ["routing", "niche_key"])),
    lifecycle_stage: str(readNested(o, ["state", "lifecycle_stage"])),
    appointment_status: str(readNested(o, ["state", "appointment_status"])),
    policy_status: strOrNull(readNested(o, ["state", "policy_status"])),
    assigned_agent_id: str(readNested(o, ["ownership", "assigned_agent_id"])),
    assigned_agent_name: str(
      readNested(o, ["ownership", "assigned_agent_name"])
    ),
    send_to_meta: bool(readNested(o, ["event", "send_to_meta"])),
  };
}
