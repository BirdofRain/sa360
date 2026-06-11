import { createHash } from "node:crypto";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import {
  getGhlWorkspaceSyncApiBaseUrl,
  getGhlWorkspaceSyncTimeoutMs,
  parseGhlSa360CustomFieldIdMap,
} from "../../lib/ghl-workspace-sync-env.js";
import {
  isGhlLiveCanaryWriteAllowed,
  GHL_LIVE_CANARY_SAFETY_MESSAGE,
} from "../../lib/ghl-delivery-adapter-mode.js";
import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";
import type { GhlLocationAuthMode } from "../ghl-oauth/ghl-location-token.service.js";
import { logger } from "../../lib/logger.js";

const GHL_VERSION = "2021-07-28";

export type GhlLiveHttpDeps = {
  fetch: typeof fetch;
};

export type GhlLiveRequestResult = {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
  redactedRequest: Record<string, unknown> | null;
  redactedResponse: Record<string, unknown> | null;
  authMode?: GhlLocationAuthMode;
};

export function redactGhlPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const redacted = redactWebhookPayloadForLog(value);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
    return redacted as Record<string, unknown>;
  }
  return { value: String(redacted) };
}

/** GHL PUT /contacts/{id} customFields array item (id + field_value required). */
export type GhlCustomFieldPutItem = {
  id: string;
  field_value: string;
};

export type GhlCustomFieldPutDiagnostic = {
  logicalKey: string;
  ghlFieldId: string;
  valueType: "string";
  valueLength: number;
};

export type CustomFieldStampBuildResult = {
  apiPayload: GhlCustomFieldPutItem[];
  diagnostics: GhlCustomFieldPutDiagnostic[];
};

const INVALID_GHL_CUSTOM_FIELD_ID_TOKENS = new Set([
  "",
  "ghl_field_id",
  "placeholder",
  "todo",
  "null",
  "undefined",
]);

export function isPlausibleGhlCustomFieldId(id: string | null | undefined): boolean {
  const t = id?.trim();
  if (!t) return false;
  if (INVALID_GHL_CUSTOM_FIELD_ID_TOKENS.has(t.toLowerCase())) return false;
  return t.length >= 8 && /^[a-zA-Z0-9_-]+$/.test(t);
}

export function buildCustomFieldsForPutFromMap(
  idMap: Record<string, string>,
  values: Record<string, string | null | undefined>
): CustomFieldStampBuildResult {
  const apiPayload: GhlCustomFieldPutItem[] = [];
  const diagnostics: GhlCustomFieldPutDiagnostic[] = [];
  const usedGhlIds = new Set<string>();

  for (const [logicalKey, raw] of Object.entries(values)) {
    const v = raw?.trim();
    if (!v) continue;
    const id = idMap[logicalKey]?.trim();
    if (!id || !isPlausibleGhlCustomFieldId(id)) continue;
    if (usedGhlIds.has(id)) continue;
    usedGhlIds.add(id);
    apiPayload.push({ id, field_value: v });
    diagnostics.push({
      logicalKey,
      ghlFieldId: id,
      valueType: "string",
      valueLength: v.length,
    });
  }
  return { apiPayload, diagnostics };
}

/** Sanitized summary for logs/UI — no secrets, only logical keys and id suffixes. */
export function summarizeCustomFieldsPutPayload(
  build: CustomFieldStampBuildResult
): {
  shape: "array";
  count: number;
  mappingSource?: string;
  items: Array<{
    logicalKey: string;
    ghlFieldIdSuffix: string;
    valueType: string;
    valueLength: number;
  }>;
} {
  return {
    shape: "array",
    count: build.apiPayload.length,
    items: build.diagnostics.map((item) => ({
      logicalKey: item.logicalKey,
      ghlFieldIdSuffix: item.ghlFieldId.length > 6 ? item.ghlFieldId.slice(-6) : item.ghlFieldId,
      valueType: item.valueType,
      valueLength: item.valueLength,
    })),
  };
}

export function formatCustomFieldStampFailureDetail(input: {
  ghlError: string | null;
  shapeSummary: ReturnType<typeof summarizeCustomFieldsPutPayload>;
  mappingSource: string;
}): string {
  const parts = [
    input.ghlError ?? "Custom field stamp failed after contact was created.",
    `customFields shape: ${input.shapeSummary.shape}, count: ${input.shapeSummary.count}`,
    input.shapeSummary.items.length > 0
      ? input.shapeSummary.items
          .map(
            (i) =>
              `${i.logicalKey}→…${i.ghlFieldIdSuffix} (${i.valueType}, len ${i.valueLength})`
          )
          .join("; ")
      : "no mappable custom fields in payload",
    `mapping source: ${input.mappingSource}`,
  ];
  return parts.filter(Boolean).join(" — ");
}

export function parseGhlApiErrorSummary(text: string, json: unknown): string {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const root = json as Record<string, unknown>;
    if (typeof root.message === "string" && root.message.trim()) {
      return root.message.trim().slice(0, 500);
    }
    if (typeof root.error === "string" && root.error.trim()) {
      return root.error.trim().slice(0, 500);
    }
    const errors = root.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (typeof first === "string" && first.trim()) return first.trim().slice(0, 500);
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const msg = (first as Record<string, unknown>).message;
        if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 500);
      }
    }
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 500) : "GHL request failed.";
}

export function extractContactIdFromGhlResponse(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const contact = root.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const id = (contact as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  for (const key of ["id", "contactId"]) {
    const v = root[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function extractOpportunityIdFromGhlResponse(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const opp = root.opportunity ?? root.opportunities;
  if (opp && typeof opp === "object" && !Array.isArray(opp)) {
    const id = (opp as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  const id = root.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export async function ghlLiveJson(
  deps: GhlLiveHttpDeps,
  method: string,
  path: string,
  options?: {
    body?: unknown;
    query?: Record<string, string>;
    timeoutMs?: number;
    allowRetry?: boolean;
    locationId?: string | null;
  }
): Promise<GhlLiveRequestResult> {
  if (!isGhlLiveCanaryWriteAllowed()) {
    throw new Error(
      `${GHL_LIVE_CANARY_SAFETY_MESSAGE} Live GHL writes require effective runtime mode live_canary.`
    );
  }

  const auth = await resolveGhlBearerAuthForLocation(options?.locationId);
  if (!auth) {
    throw new Error("No GHL OAuth connection or env private token available for this location.");
  }
  const token = auth.token;

  const base = getGhlWorkspaceSyncApiBaseUrl();
  const timeoutMs = options?.timeoutMs ?? getGhlWorkspaceSyncTimeoutMs();
  const allowRetry = options?.allowRetry !== false;
  const qs = options?.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}${qs}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Version: GHL_VERSION,
  };
  let bodyStr: string | undefined;
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(options.body);
  }

  const redactedRequest = redactGhlPayload({
    method,
    url: url.replace(token, "[REDACTED]"),
    headers: { ...headers, Authorization: "Bearer [REDACTED]" },
    body: options?.body,
  });

  const maxAttempts = allowRetry ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await deps.fetch(url, {
        method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const redactedResponse = redactGhlPayload(json ?? { raw: text.slice(0, 500) });

      if (!res.ok && allowRetry && isRetriableStatus(res.status) && attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }

      if (!res.ok) {
        logger.warn("ghl_live_canary", {
          event: "ghl_request_failed",
          method,
          path,
          http_status: res.status,
        });
      }

      return {
        ok: res.ok,
        status: res.status,
        json,
        text,
        redactedRequest,
        redactedResponse,
        authMode: auth.authMode,
      };
    } catch (err) {
      if (attempt < maxAttempts && allowRetry) {
        await sleep(400 * attempt);
        continue;
      }
      logger.warn("ghl_live_canary", {
        event: "ghl_request_error",
        method,
        path,
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        status: 0,
        json: null,
        text: err instanceof Error ? err.message : String(err),
        redactedRequest,
        redactedResponse: { error: "transport_error" },
        authMode: auth.authMode,
      };
    }
  }

  return {
    ok: false,
    status: 0,
    json: null,
    text: "unexpected_transport_state",
    redactedRequest,
    redactedResponse: { error: "unexpected_transport_state" },
  };
}

export function buildLiveCanaryIdempotencyKey(input: {
  deliveryPlanId: string;
  destinationSubaccountIdGhl: string;
  sourceLeadUid: string | null | undefined;
  sourceEmail: string | null | undefined;
  sourcePhoneE164: string | null | undefined;
  planVersion: string;
}): string {
  const parts = [
    input.deliveryPlanId.trim(),
    input.destinationSubaccountIdGhl.trim(),
    input.sourceLeadUid?.trim() ?? "",
    input.sourceEmail?.trim() ?? "",
    input.sourcePhoneE164?.trim() ?? "",
    input.planVersion.trim(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function getGhlLiveTransportCustomFieldIdMap(
  override?: Record<string, string> | null
): Record<string, string> {
  if (override && Object.keys(override).length > 0) return override;
  return parseGhlSa360CustomFieldIdMap();
}
