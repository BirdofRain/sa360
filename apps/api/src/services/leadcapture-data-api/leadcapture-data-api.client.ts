import { createHash, randomUUID } from "node:crypto";

import {
  getLeadCaptureDataApiBaseUrl,
  getLeadCaptureDataApiMaxPageSize,
  getLeadCaptureDataApiMaxRetries,
  getLeadCaptureDataApiTimeoutMs,
  getLeadCaptureDataApiToken,
  isLeadCaptureTrustSyncEnabled,
} from "../../lib/leadcapture-data-api-env.js";
import { logger } from "../../lib/logger.js";
import type {
  LeadCaptureDataApiClientResult,
  LeadCaptureDataApiErrorCode,
  LeadCaptureDataApiLeadRecord,
  LeadCaptureDataApiLeadsPage,
  LeadCaptureDataApiListLeadsInput,
  LeadCaptureDataApiTransport,
} from "./leadcapture-data-api.types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue?.trim()) return null;
  const trimmed = headerValue.trim();
  const seconds = Number.parseInt(trimmed, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

function redactErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/lc_live_[A-Za-z0-9_-]+/gi, "lc_live_[REDACTED]")
    .slice(0, 240);
}

function classifyHttpError(status: number): LeadCaptureDataApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "transport_error";
}

function parseLeadsPage(json: unknown): LeadCaptureDataApiLeadsPage | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const data = Array.isArray(root.data) ? (root.data as LeadCaptureDataApiLeadRecord[]) : null;
  if (!data) return null;
  const nextCursor =
    typeof root.next_cursor === "string" && root.next_cursor.trim()
      ? root.next_cursor.trim()
      : null;
  const hasMore = root.has_more === true;
  return { data, next_cursor: nextCursor, has_more: hasMore };
}

function parseLeadRecord(json: unknown): LeadCaptureDataApiLeadRecord | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  return json as LeadCaptureDataApiLeadRecord;
}

async function leadCaptureDataApiRequest<T>(input: {
  path: string;
  query?: Record<string, string>;
  transport?: LeadCaptureDataApiTransport;
  parser: (json: unknown) => T | null;
}): Promise<LeadCaptureDataApiClientResult<T>> {
  const correlationId = randomUUID();
  if (!isLeadCaptureTrustSyncEnabled()) {
    return {
      ok: false,
      code: "disabled",
      httpStatus: null,
      message: "LeadCapture trust sync is disabled.",
      correlationId,
      retryAfterMs: null,
    };
  }

  const token = getLeadCaptureDataApiToken();
  if (!token) {
    return {
      ok: false,
      code: "unauthorized",
      httpStatus: null,
      message: "LeadCapture Data API token is not configured.",
      correlationId,
      retryAfterMs: null,
    };
  }

  const baseUrl = getLeadCaptureDataApiBaseUrl();
  const timeoutMs = getLeadCaptureDataApiTimeoutMs();
  const maxRetries = getLeadCaptureDataApiMaxRetries();
  const transport = input.transport ?? fetch;
  const qs = input.query ? `?${new URLSearchParams(input.query).toString()}` : "";
  const url = `${baseUrl}${input.path.startsWith("/") ? input.path : `/${input.path}`}${qs}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await transport(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "X-Correlation-Id": correlationId,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const code = classifyHttpError(res.status);
        const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
        if (isRetriableStatus(res.status) && attempt < maxRetries) {
          await sleep(retryAfterMs ?? 250 * attempt);
          continue;
        }
        logger.warn("leadcapture_data_api", {
          event: "request_failed",
          correlation_id: correlationId,
          http_status: res.status,
          path: input.path,
          code,
        });
        return {
          ok: false,
          code,
          httpStatus: res.status,
          message: redactErrorMessage(`LeadCapture Data API request failed with HTTP ${res.status}.`),
          correlationId,
          retryAfterMs,
        };
      }

      const parsed = input.parser(json);
      if (!parsed) {
        return {
          ok: false,
          code: "malformed_response",
          httpStatus: res.status,
          message: "LeadCapture Data API response could not be parsed.",
          correlationId,
          retryAfterMs: null,
        };
      }

      return {
        ok: true,
        data: parsed,
        correlationId,
        httpStatus: res.status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.toLowerCase().includes("timeout") || message.includes("aborted");
      if (attempt < maxRetries) {
        await sleep(250 * attempt);
        continue;
      }
      return {
        ok: false,
        code: isTimeout ? "timeout" : "transport_error",
        httpStatus: null,
        message: redactErrorMessage(message),
        correlationId,
        retryAfterMs: null,
      };
    }
  }

  return {
    ok: false,
    code: "transport_error",
    httpStatus: null,
    message: "LeadCapture Data API request exhausted retries.",
    correlationId,
    retryAfterMs: null,
  };
}

export async function listLeadCaptureDataApiLeads(
  input: LeadCaptureDataApiListLeadsInput = {},
  transport?: LeadCaptureDataApiTransport
): Promise<LeadCaptureDataApiClientResult<LeadCaptureDataApiLeadsPage>> {
  const query: Record<string, string> = {
    limit: String(Math.min(input.limit ?? getLeadCaptureDataApiMaxPageSize(), 25)),
  };
  if (input.since?.trim()) query.since = input.since.trim();
  if (input.funnelId?.trim()) query.funnel_id = input.funnelId.trim();

  return leadCaptureDataApiRequest({
    path: "/v1/data/leads",
    query,
    transport,
    parser: parseLeadsPage,
  });
}

export async function getLeadCaptureDataApiLeadById(
  providerLeadId: string,
  transport?: LeadCaptureDataApiTransport
): Promise<LeadCaptureDataApiClientResult<LeadCaptureDataApiLeadRecord>> {
  const trimmed = providerLeadId.trim();
  return leadCaptureDataApiRequest({
    path: `/v1/data/leads/${encodeURIComponent(trimmed)}`,
    transport,
    parser: parseLeadRecord,
  });
}
