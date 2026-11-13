import type { Prisma, PrismaClient } from "@prisma/client";

import { findPublishedColumnMap } from "../client-onboarding-v2/column-maps.js";
import { logger } from "../../lib/logger.js";
import { isExternalWebhookDeliveryEnabled, assessPrimaryCrmDelivery } from "./external-webhook-contract.js";
import {
  buildExternalWebhookAttemptRecord,
  projectExternalWebhookPayload,
  type PublishedColumnMapSnapshot,
} from "./external-webhook-payload.js";

type ScheduleDb = PrismaClient | Prisma.TransactionClient;

/**
 * Inserts one frozen attempt in the caller's transaction.
 * Flag off, unmatched, disabled, and a live GHL location conflict return
 * without throwing. A database error throws and rolls the intake transaction back.
 * This function does not enqueue and does not open a socket.
 */
export async function recordExternalWebhookAttempt(
  input: {
    sourceLeadEventId: string;
    status: string;
    clientAccountId: string | null;
    sourceLeadId: string | null;
    receivedAt: string;
    normalizedPayload: unknown;
    sourceFunnelId: string | null;
    resolvedAt: Date;
  },
  db: ScheduleDb,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ attemptId: string } | null> {
  if (!isExternalWebhookDeliveryEnabled(env)) return null;
  if (input.status !== "routing_matched") return null;
  const clientAccountId = input.clientAccountId?.trim() ?? "";
  if (!clientAccountId) return null;
  const destination = await db.clientExternalWebhookDestination.findUnique({ where: { clientAccountId } });
  if (!destination?.enabled) return null;
  const ghl = await db.clientGhlDestination.findUnique({ where: { clientAccountId } });
  const conflict = assessPrimaryCrmDelivery({
    ghl,
    externalWebhookEnabled: true,
  });
  if (!conflict.ok) return null;

  const existing = await db.externalWebhookDeliveryAttempt.findUnique({
    where: {
      clientAccountId_sourceLeadEventId: {
        clientAccountId,
        sourceLeadEventId: input.sourceLeadEventId,
      },
    },
    select: { id: true },
  });
  if (existing) return { attemptId: existing.id };

  const publishedMap = await publishedMapSnapshot(db, clientAccountId, input.sourceFunnelId);
  const projected = projectExternalWebhookPayload({
    destinationKind: destination.kind,
    destinationRevision: destination.revision,
    lead: {
      stableRowId: `lead:${clientAccountId}:${input.sourceLeadEventId}`,
      clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      receivedAt: input.receivedAt,
      sourceLeadId: input.sourceLeadId,
      normalizedPayload: input.normalizedPayload,
    },
    publishedMap,
  });
  if (!projected.ok) {
    logger.warn("external_webhook.schedule_skipped", { code: projected.code });
    return null;
  }
  const built = buildExternalWebhookAttemptRecord({
    destinationId: destination.id,
    endpointHost: destination.endpointHost,
    endpointUrlFingerprint: destination.endpointUrlFingerprint,
    projection: projected.projection,
  });
  if (!built.ok) {
    logger.warn("external_webhook.schedule_skipped", { code: built.code });
    return null;
  }
  const created = await db.externalWebhookDeliveryAttempt.create({
    data: built.record,
    select: { id: true },
  });
  return { attemptId: created.id };
}

async function publishedMapSnapshot(
  db: ScheduleDb,
  clientAccountId: string,
  sourceFunnelId: string | null
): Promise<PublishedColumnMapSnapshot | null> {
  const sheets = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  if (!sheets) return null;
  const tab = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: sheets.id, role: "campaign" } },
  });
  if (tab?.worksheetId == null) return null;
  const row = await findPublishedColumnMap(db, {
    clientAccountId,
    spreadsheetId: sheets.spreadsheetId,
    worksheetId: tab.worksheetId,
    sourceFunnelId,
  });
  if (!row || row.status !== "published" || !Array.isArray(row.assignments)) return null;
  return {
    id: row.id,
    mapVersion: row.mapVersion,
    sourceScope: row.sourceScope,
    status: row.status,
    assignments: row.assignments as unknown as PublishedColumnMapSnapshot["assignments"],
  };
}
