import type { AdminSynthflowListItem } from "@/lib/admin-api/types";

export type SynthflowRequestKind = "inbound_lookup" | "outbound_context" | "outbound_result" | "unknown";

export function synthflowRequestKindLabel(kind: SynthflowRequestKind): string {
  switch (kind) {
    case "inbound_lookup":
      return "Inbound lookup";
    case "outbound_context":
      return "Outbound context";
    case "outbound_result":
      return "Outbound result";
    default:
      return "Unknown type";
  }
}

/** Route/source-based request kind (outbound-result rarely appears in this log today). */
export function getSynthflowRequestKind(row: AdminSynthflowListItem): SynthflowRequestKind {
  const route = (row.route ?? "").toLowerCase();
  const source = (row.source ?? "").toLowerCase();
  if (route.includes("outbound-result") || source.includes("outbound_result")) {
    return "outbound_result";
  }
  if (route.includes("outbound-context") || source.includes("outbound_context")) {
    return "outbound_context";
  }
  if (route.includes("inbound-lookup") || source.includes("inbound_lookup") || source.includes("synthflow_inbound")) {
    return "inbound_lookup";
  }
  return "unknown";
}

const SUCCESS_LOOKUP = new Set([
  "matched_local",
  "matched_ghl",
  "matched_composite",
  "matched_contact_id",
  "matched_lead_uid",
  "matched_phone_scoped",
  "matched_phone_global",
  "lookup_ok",
]);

export type LookupStatusTone = "success" | "warn" | "danger" | "muted" | "caution" | "neutral";

/** Visual tone for operational scanning (lookupStatus + processingStatus). */
export function getSynthflowLookupTone(row: AdminSynthflowListItem): LookupStatusTone {
  const ls = (row.lookupStatus ?? "").trim();
  const ps = (row.processingStatus ?? "").trim();

  if (ls === "invalid_payload" || ps === "validation_failed") {
    return "danger";
  }
  if (
    ls === "lookup_error" ||
    ps === "lookup_error" ||
    ps === "failed" ||
    ls === "error"
  ) {
    return "danger";
  }
  if (ps === "guardrail") {
    return "caution";
  }
  if (ls === "disabled" || ls === "invalid_phone") {
    return "muted";
  }
  if (
    ls === "not_found" ||
    ls === "not_found_local" ||
    ps === "not_found" ||
    ps === "not_found_local"
  ) {
    return "warn";
  }
  if (SUCCESS_LOOKUP.has(ls) || ps === "matched_local" || ps === "matched_ghl") {
    return "success";
  }
  return "neutral";
}

export function lookupToneClasses(tone: LookupStatusTone): string {
  switch (tone) {
    case "success":
      return "text-emerald-800 bg-emerald-50 border-emerald-200";
    case "warn":
      return "text-amber-900 bg-amber-50 border-amber-200";
    case "danger":
      return "text-red-800 bg-red-50 border-red-200";
    case "caution":
      return "text-amber-900 bg-amber-50/80 border-amber-300";
    case "muted":
      return "text-slate-600 bg-slate-100 border-slate-200";
    default:
      return "text-slate-700 bg-white border-slate-200";
  }
}

function e164LooksTestBlock(phone: string | null | undefined): boolean {
  if (!phone?.trim()) {
    return false;
  }
  const p = phone.replace(/\s/g, "");
  return p.startsWith("+1555") || p.startsWith("1555");
}

/** Heuristic test/dev traffic from list columns (no request body on list rows). */
export function isRecognizableTestDevRow(row: AdminSynthflowListItem): boolean {
  const mid = (row.modelId ?? "").toLowerCase();
  if (mid.includes("test")) {
    return true;
  }
  if (e164LooksTestBlock(row.fromNumber) || e164LooksTestBlock(row.toNumber) || e164LooksTestBlock(row.phoneE164)) {
    return true;
  }
  return false;
}

function shallowIdLooksTest(key: string, val: unknown): boolean {
  const k = key.toLowerCase();
  if ((k.includes("call_id") || k === "callid") && typeof val === "string" && val.toLowerCase().includes("test")) {
    return true;
  }
  if ((k.includes("model_id") || k === "modelid") && typeof val === "string" && val.toLowerCase().includes("test")) {
    return true;
  }
  return false;
}

/** Scan redacted JSON for call_id/model_id containing "test" or +1555 numbers (detail view). */
export function bodyLooksLikeTestDev(body: unknown): boolean {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (shallowIdLooksTest(k, v)) {
        return true;
      }
    }
  }
  try {
    const s = JSON.stringify(body).toLowerCase();
    if (s.includes("+1555")) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isInvalidPayloadRow(row: AdminSynthflowListItem): boolean {
  return (
    row.lookupStatus === "invalid_payload" || row.processingStatus === "validation_failed"
  );
}
