/**
 * Diagnostics accept two named windows only. There is no free-form `from` or
 * `to`, so a caller cannot ask for an unbounded scan.
 */

import { z } from "zod";

const HOUR_MS = 60 * 60 * 1000;

export const DIAGNOSTIC_WINDOWS = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
} as const;

export type DiagnosticWindowKey = keyof typeof DIAGNOSTIC_WINDOWS;

export const MAX_DIAGNOSTIC_WINDOW_MS = DIAGNOSTIC_WINDOWS["7d"];

export type DiagnosticWindow = {
  key: DiagnosticWindowKey;
  from: Date;
  to: Date;
  hours: number;
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

const safeId = z.string().trim().min(1).max(128).regex(SAFE_ID);

export const diagnosticsSummaryQuerySchema = z
  .object({
    window: z.enum(["24h", "7d"]).default("24h"),
    clientAccountId: safeId.optional(),
    campaignId: safeId.optional(),
  })
  .strict();

export type DiagnosticsSummaryQuery = z.infer<typeof diagnosticsSummaryQuerySchema>;

export const MAX_RUN_LIST_PAGE = 50;
export const DEFAULT_RUN_LIST_PAGE = 25;

export const diagnosticsRunListQuerySchema = z
  .object({
    window: z.enum(["24h", "7d"]).default("24h"),
    clientAccountId: safeId.optional(),
    status: z
      .enum(["succeeded", "partial_success", "failed", "executing", "skipped_duplicate"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(MAX_RUN_LIST_PAGE).default(DEFAULT_RUN_LIST_PAGE),
    cursor: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type DiagnosticsRunListQuery = z.infer<typeof diagnosticsRunListQuerySchema>;

export const diagnosticsRunParamsSchema = z.object({ runId: safeId }).strict();

export function resolveDiagnosticWindow(key: DiagnosticWindowKey, now: Date): DiagnosticWindow {
  const ms = DIAGNOSTIC_WINDOWS[key];
  return { key, from: new Date(now.getTime() - ms), to: now, hours: ms / HOUR_MS };
}

export type RunCursor = { startedAt: Date; id: string };

export function encodeRunCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.startedAt.toISOString(), i: cursor.id }), "utf8").toString(
    "base64url"
  );
}

export function decodeRunCursor(raw: string | undefined): RunCursor | null | "invalid" {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string" || !SAFE_ID.test(parsed.i)) {
      return "invalid";
    }
    const startedAt = new Date(parsed.t);
    if (Number.isNaN(startedAt.getTime())) return "invalid";
    return { startedAt, id: parsed.i };
  } catch {
    return "invalid";
  }
}
