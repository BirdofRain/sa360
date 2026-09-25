import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { findSourceFunnelById } from "../../repositories/source-funnel.repository.js";
import {
  classifyStoredInventoryTracking,
  inventoryTrackingDetail,
  type InventoryTrackingDiagnostic,
} from "../lead-fulfillment-overview/inventory-tracking-diagnostic.js";

export type SourceIntakeTraceQuery = {
  webhookRequestLogId?: string;
  requestId?: string;
  sourceLeadEventId?: string;
  sourceLeadId?: string;
  sourceLeadUid?: string;
};

export type SourceIntakeTraceResponse = {
  ok: true;
  readOnly: true;
  hasDestinationClient: boolean;
  destinationClientAccountId: string | null;
  webhookRequestLog: {
    id: string;
    requestId: string;
    source: string;
    route: string;
    receivedAt: string;
    processingStatus: string;
    httpStatus: number | null;
    sourceLeadEventId: string | null;
    normalizedLeadUid: string | null;
    clientAccountId: string | null;
    errorCode: string | null;
  } | null;
  sourceLeadEvent: {
    id: string;
    sourceProvider: string;
    sourceSystem: string;
    sourceType: string;
    sourceRouteKey: string | null;
    sourceLeadId: string | null;
    sourceLeadUid: string | null;
    status: string;
    receivedAt: string;
    normalizedAt: string | null;
    clientAccountIdResolved: string | null;
    webhookRequestLogId: string | null;
    sourceFunnelName: string | null;
  } | null;
  relatedSourceEventIds: string[];
  sourceFunnel: {
    id: string;
    provider: string;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    pageSlug: string | null;
    observedFunnelName: string | null;
    nicheKey: string | null;
    associationStatus: string;
    originClientAccountId: string | null;
  } | null;
  inventoryItem: {
    id: string;
    status: string;
    generatedAt: string;
    normalizedState: string;
    nicheKey: string;
    sourceLane: string;
    sourceLeadEventId: string;
    commerceExcluded: boolean;
    onOtherSourceEvent: boolean;
  } | null;
  inventoryTracking: {
    diagnostic: InventoryTrackingDiagnostic;
    outcome: string | null;
    label: string;
    detail: string | null;
    inventoryItemId: string | null;
  };
};

const EVENT_SELECT = {
  id: true,
  sourceProvider: true,
  sourceSystem: true,
  sourceType: true,
  sourceRouteKey: true,
  sourceLeadId: true,
  sourceLeadUid: true,
  status: true,
  receivedAt: true,
  normalizedAt: true,
  clientAccountIdResolved: true,
  webhookRequestLogId: true,
  sourceFunnelName: true,
  enrichmentMetadataJson: true,
} satisfies Prisma.SourceLeadEventSelect;

type EventRow = Prisma.SourceLeadEventGetPayload<{ select: typeof EVENT_SELECT }>;

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function presentEvent(event: EventRow) {
  return {
    id: event.id,
    sourceProvider: event.sourceProvider,
    sourceSystem: event.sourceSystem,
    sourceType: event.sourceType,
    sourceRouteKey: event.sourceRouteKey,
    sourceLeadId: event.sourceLeadId,
    sourceLeadUid: event.sourceLeadUid,
    status: event.status,
    receivedAt: event.receivedAt.toISOString(),
    normalizedAt: event.normalizedAt?.toISOString() ?? null,
    clientAccountIdResolved: event.clientAccountIdResolved,
    webhookRequestLogId: event.webhookRequestLogId,
    sourceFunnelName: event.sourceFunnelName,
  };
}

/**
 * Authenticated, read-only correlation for source intake that has no
 * destination client. Does not read raw payloads or contact fields.
 */
export async function getSourceIntakeTrace(
  query: SourceIntakeTraceQuery,
  db: PrismaClient = defaultPrisma
): Promise<SourceIntakeTraceResponse | null> {
  const webhookRequestLogId = trim(query.webhookRequestLogId);
  const requestId = trim(query.requestId);
  const sourceLeadEventId = trim(query.sourceLeadEventId);
  const sourceLeadId = trim(query.sourceLeadId);
  const sourceLeadUid = trim(query.sourceLeadUid);
  if (!webhookRequestLogId && !requestId && !sourceLeadEventId && !sourceLeadId && !sourceLeadUid) {
    return null;
  }

  let webhook =
    webhookRequestLogId
      ? await db.webhookRequestLog.findUnique({ where: { id: webhookRequestLogId } })
      : null;
  if (!webhook && requestId) {
    webhook =
      (await db.webhookRequestLog.findUnique({ where: { id: requestId } })) ??
      (await db.webhookRequestLog.findFirst({
        where: { requestId },
        orderBy: { receivedAt: "desc" },
      }));
  }

  let event: EventRow | null = null;
  if (sourceLeadEventId) {
    event = await db.sourceLeadEvent.findUnique({
      where: { id: sourceLeadEventId },
      select: EVENT_SELECT,
    });
  }
  if (!event && webhook?.sourceLeadEventId) {
    event = await db.sourceLeadEvent.findUnique({
      where: { id: webhook.sourceLeadEventId },
      select: EVENT_SELECT,
    });
  }
  if (!event && webhook) {
    event = await db.sourceLeadEvent.findFirst({
      where: { webhookRequestLogId: webhook.id },
      orderBy: { receivedAt: "desc" },
      select: EVENT_SELECT,
    });
  }
  if (!event && sourceLeadUid) {
    event = await db.sourceLeadEvent.findFirst({
      where: { sourceLeadUid },
      orderBy: { receivedAt: "desc" },
      select: EVENT_SELECT,
    });
  }
  if (!event && sourceLeadId) {
    event = await db.sourceLeadEvent.findFirst({
      where: { sourceLeadId },
      orderBy: { receivedAt: "desc" },
      select: EVENT_SELECT,
    });
  }

  if (!webhook && event?.webhookRequestLogId) {
    webhook = await db.webhookRequestLog.findUnique({ where: { id: event.webhookRequestLogId } });
  }
  if (!webhook && event) {
    webhook = await db.webhookRequestLog.findFirst({
      where: { sourceLeadEventId: event.id },
      orderBy: { receivedAt: "desc" },
    });
  }

  if (!event && !webhook) return null;

  const relatedSourceEventIds: string[] = [];
  if (event?.sourceLeadId) {
    const related = await db.sourceLeadEvent.findMany({
      where: { sourceLeadId: event.sourceLeadId },
      select: { id: true },
      orderBy: { receivedAt: "desc" },
      take: 8,
    });
    for (const row of related) {
      if (row.id !== event.id) relatedSourceEventIds.push(row.id);
    }
  }

  const tracking = classifyStoredInventoryTracking(event?.enrichmentMetadataJson);
  const enrichment = asRecord(event?.enrichmentMetadataJson);
  const sourceFunnelId =
    typeof enrichment?.sourceFunnelId === "string" ? enrichment.sourceFunnelId.trim() : "";
  const funnel = sourceFunnelId ? await findSourceFunnelById(sourceFunnelId, db) : null;

  const directItem = event
    ? await db.leadInventoryItem.findUnique({
        where: { sourceLeadEventId: event.id },
        select: {
          id: true,
          status: true,
          generatedAt: true,
          normalizedState: true,
          nicheKey: true,
          sourceLane: true,
          sourceLeadEventId: true,
          commerceExcludedAt: true,
        },
      })
    : null;
  const reusedItem =
    !directItem && tracking.inventoryItemId
      ? await db.leadInventoryItem.findUnique({
          where: { id: tracking.inventoryItemId },
          select: {
            id: true,
            status: true,
            generatedAt: true,
            normalizedState: true,
            nicheKey: true,
            sourceLane: true,
            sourceLeadEventId: true,
            commerceExcludedAt: true,
          },
        })
      : null;
  const item = directItem ?? reusedItem;
  const onOtherSourceEvent = Boolean(item && event && item.sourceLeadEventId !== event.id);
  const destinationClientAccountId =
    event?.clientAccountIdResolved ?? webhook?.clientAccountId ?? null;

  return {
    ok: true,
    readOnly: true,
    hasDestinationClient: Boolean(destinationClientAccountId),
    destinationClientAccountId,
    webhookRequestLog: webhook
      ? {
          id: webhook.id,
          requestId: webhook.requestId,
          source: webhook.source,
          route: webhook.route,
          receivedAt: webhook.receivedAt.toISOString(),
          processingStatus: webhook.processingStatus,
          httpStatus: webhook.httpStatus,
          sourceLeadEventId: webhook.sourceLeadEventId,
          normalizedLeadUid: webhook.normalizedLeadUid,
          clientAccountId: webhook.clientAccountId,
          errorCode: webhook.errorCode,
        }
      : null,
    sourceLeadEvent: event ? presentEvent(event) : null,
    relatedSourceEventIds,
    sourceFunnel: funnel
      ? {
          id: funnel.id,
          provider: funnel.provider,
          providerFunnelId: funnel.providerFunnelId,
          parentUrlKey: funnel.parentUrlKey,
          pageSlug: funnel.pageSlug,
          observedFunnelName: funnel.observedFunnelName,
          nicheKey: funnel.nicheKey,
          associationStatus: funnel.associationStatus,
          originClientAccountId: funnel.originClientAccountId,
        }
      : null,
    inventoryItem: item
      ? {
          id: item.id,
          status: item.status,
          generatedAt: item.generatedAt.toISOString(),
          normalizedState: item.normalizedState,
          nicheKey: item.nicheKey,
          sourceLane: item.sourceLane,
          sourceLeadEventId: item.sourceLeadEventId,
          commerceExcluded: item.commerceExcludedAt != null,
          onOtherSourceEvent,
        }
      : null,
    inventoryTracking: {
      diagnostic: tracking.diagnostic,
      outcome: tracking.outcome,
      label: tracking.label,
      detail: inventoryTrackingDetail({
        diagnostic: tracking.diagnostic,
        outcome: tracking.outcome,
        canonicalOnOtherEvent: onOtherSourceEvent,
      }),
      inventoryItemId: item?.id ?? tracking.inventoryItemId,
    },
  };
}
