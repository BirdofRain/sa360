import { createHash } from "node:crypto";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import {
  getGhlWorkspaceSyncApiBaseUrl,
  getGhlWorkspaceSyncPrivateToken,
  getGhlWorkspaceSyncTimeoutMs,
  parseGhlSa360CustomFieldIdMap,
} from "../../lib/ghl-workspace-sync-env.js";
import {
  isGhlLiveCanaryWriteAllowed,
  GHL_LIVE_CANARY_SAFETY_MESSAGE,
} from "../../lib/ghl-delivery-adapter-mode.js";
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
};

export function redactGhlPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const redacted = redactWebhookPayloadForLog(value);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
    return redacted as Record<string, unknown>;
  }
  return { value: String(redacted) };
}

export function buildCustomFieldsForPutFromMap(
  idMap: Record<string, string>,
  values: Record<string, string | null | undefined>
): { id: string; field_value: string }[] {
  const out: { id: string; field_value: string }[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const v = raw?.trim();
    if (!v) continue;
    const id = idMap[key];
    if (!id) continue;
    out.push({ id, field_value: v });
  }
  return out;
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
  }
): Promise<GhlLiveRequestResult> {
  if (!isGhlLiveCanaryWriteAllowed()) {
    throw new Error(
      `${GHL_LIVE_CANARY_SAFETY_MESSAGE} Live GHL writes require GHL_DELIVERY_ADAPTER_MODE=live_canary.`
    );
  }

  const token = getGhlWorkspaceSyncPrivateToken();
  if (!token) {
    throw new Error("GHL private integration token is not configured.");
  }

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

export function getGhlLiveTransportCustomFieldIdMap(): Record<string, string> {
  return parseGhlSa360CustomFieldIdMap();
}
