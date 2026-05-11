import { WebhookRequestSource } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { GHL_LIFECYCLE_ROUTE } from "../services/webhook-request-log.service.js";

/** Successful lifecycle webhook completions whose stored body may carry refreshed routing (including duplicate_index_refreshed). */
export const WEBHOOK_CALENDAR_ALLOWED_PROCESSING_STATUSES = [
  "stored",
  "queued",
  "skipped",
  "duplicate_index_refreshed",
] as const;

/**
 * Latest redacted lifecycle webhook body for calendar enrichment.
 * Scoped by both `contactIdGhl` and `clientAccountId`; rows stored under a different
 * `clientAccountId` never qualify (no cross-client calendar match).
 */
export async function findLatestLifecycleWebhookBodyForCalendar(args: {
  contactIdGhl: string;
  clientAccountId: string;
}): Promise<unknown | null> {
  const cid = args.contactIdGhl.trim();
  const ca = args.clientAccountId.trim();
  if (!cid || !ca) {
    return null;
  }

  const row = await prisma.webhookRequestLog.findFirst({
    where: {
      source: WebhookRequestSource.ghl_lifecycle,
      route: GHL_LIFECYCLE_ROUTE,
      httpStatus: 200,
      processingStatus: { in: [...WEBHOOK_CALENDAR_ALLOWED_PROCESSING_STATUSES] },
      contactIdGhl: cid,
      clientAccountId: ca,
    },
    orderBy: { receivedAt: "desc" },
    select: { requestBodyRedacted: true },
  });

  return row?.requestBodyRedacted ?? null;
}
