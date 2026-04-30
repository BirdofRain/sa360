import type { Prisma } from "@prisma/client";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const GHL_LIFECYCLE_ROUTE = "/webhooks/ghl/lifecycle-event";

export type WebhookRequestLogHandle = {
  id: string;
  receivedAt: Date;
};

export type StartLogInput = {
  requestId: string;
  rawBody: unknown;
};

export type CompleteLogInput = {
  httpStatus: number;
  processingStatus: string;
  clientAccountId?: string | null;
  subaccountIdGhl?: string | null;
  contactIdGhl?: string | null;
  eventUuid?: string | null;
  eventNameInternal?: string | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  responseBodyRedacted?: unknown;
};

function capSummary(s: string, max = 2000): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Creates a log row at the start of handling. Never throws to callers.
 */
export async function startLog(input: StartLogInput): Promise<WebhookRequestLogHandle | null> {
  try {
    const requestBodyRedacted = redactWebhookPayloadForLog(input.rawBody) as Prisma.InputJsonValue;
    const row = await prisma.webhookRequestLog.create({
      data: {
        requestId: input.requestId,
        source: "ghl_lifecycle",
        route: GHL_LIFECYCLE_ROUTE,
        processingStatus: "received",
        httpStatus: null,
        durationMs: null,
        completedAt: null,
        requestBodyRedacted,
      },
    });
    return { id: row.id, receivedAt: row.receivedAt };
  } catch (err) {
    logger.warn("webhook_request_log.start_failed", {
      requestId: input.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Finalizes a log row. No-op if handle is null. Never throws to callers.
 */
export async function completeLog(
  handle: WebhookRequestLogHandle | null,
  input: CompleteLogInput
): Promise<void> {
  if (!handle) return;
  try {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - handle.receivedAt.getTime());
    const errorSummary =
      input.errorSummary !== undefined && input.errorSummary !== null
        ? capSummary(input.errorSummary)
        : null;
    const responseJson =
      input.responseBodyRedacted !== undefined
        ? (redactWebhookPayloadForLog(input.responseBodyRedacted) as Prisma.InputJsonValue)
        : undefined;

    await prisma.webhookRequestLog.update({
      where: { id: handle.id },
      data: {
        completedAt,
        durationMs,
        processingStatus: input.processingStatus,
        httpStatus: input.httpStatus,
        clientAccountId: input.clientAccountId?.trim() || null,
        subaccountIdGhl:
          input.subaccountIdGhl === undefined || input.subaccountIdGhl === null
            ? null
            : input.subaccountIdGhl.trim() === ""
              ? null
              : input.subaccountIdGhl.trim(),
        contactIdGhl: input.contactIdGhl?.trim() || null,
        eventUuid: input.eventUuid?.trim() || null,
        eventNameInternal: input.eventNameInternal?.trim() || null,
        errorCode: input.errorCode?.trim() || null,
        errorSummary,
        ...(responseJson !== undefined ? { responseBodyRedacted: responseJson } : {}),
      },
    });
  } catch (err) {
    logger.warn("webhook_request_log.complete_failed", {
      logId: handle.id,
      processingStatus: input.processingStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
