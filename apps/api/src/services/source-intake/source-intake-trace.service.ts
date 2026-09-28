import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { findSourceFunnelById } from "../../repositories/source-funnel.repository.js";
import {
  classifyStoredInventoryTracking,
  inventoryTrackingDetail,
  isSafeInventoryReferenceId,
  isRecognizedReuseOutcome,
  type InventoryTrackingDiagnostic,
  type RecognizedInventoryTrackingOutcome,
} from "../lead-fulfillment-overview/inventory-tracking-diagnostic.js";
import {
  buildCampaignIdentityFingerprints,
  CAMPAIGN_IDENTITY_MATCH_OUTCOME,
  findExistingCampaignInventoryIdentity,
  historicalInventoryItemStillMatches,
  storedFingerprintRelationship,
  type CampaignInventoryIdentityHit,
} from "../lead-inventory/campaign-inventory-identity.js";

export type SourceIntakeTraceQuery = {
  webhookRequestLogId?: string;
  requestId?: string;
  sourceLeadEventId?: string;
  sourceLeadId?: string;
  sourceLeadUid?: string;
};

export type SourceIntakeTraceFailureCode =
  | "missing_anchor"
  | "multiple_anchors"
  | "not_found"
  | "ambiguous_request_id"
  | "ambiguous_source_identity"
  | "association_conflict";

export type SourceIntakeTraceFailure = {
  ok: false;
  status: 400 | 404 | 409;
  code: SourceIntakeTraceFailureCode;
  error: string;
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
    outcome: RecognizedInventoryTrackingOutcome | null;
    label: string;
    detail: string | null;
    inventoryItemId: string | null;
  };
};

export type SourceIntakeTraceResult = SourceIntakeTraceResponse | SourceIntakeTraceFailure;

const RELATED_EVENT_CAP = 8;
const AMBIGUITY_TAKE = 2;

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

const WEBHOOK_SELECT = {
  id: true,
  requestId: true,
  source: true,
  route: true,
  receivedAt: true,
  processingStatus: true,
  httpStatus: true,
  sourceLeadEventId: true,
  normalizedLeadUid: true,
  clientAccountId: true,
  errorCode: true,
} satisfies Prisma.WebhookRequestLogSelect;

const ITEM_SELECT = {
  id: true,
  status: true,
  generatedAt: true,
  normalizedState: true,
  nicheKey: true,
  sourceLane: true,
  sourceLeadEventId: true,
  commerceExcludedAt: true,
} satisfies Prisma.LeadInventoryItemSelect;

type EventRow = Prisma.SourceLeadEventGetPayload<{ select: typeof EVENT_SELECT }>;
type WebhookRow = Prisma.WebhookRequestLogGetPayload<{ select: typeof WEBHOOK_SELECT }>;
type ItemRow = Prisma.LeadInventoryItemGetPayload<{ select: typeof ITEM_SELECT }>;

type AnchorName =
  | "webhookRequestLogId"
  | "requestId"
  | "sourceLeadEventId"
  | "sourceLeadId"
  | "sourceLeadUid";

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function fail(
  status: SourceIntakeTraceFailure["status"],
  code: SourceIntakeTraceFailureCode,
  error: string
): SourceIntakeTraceFailure {
  return { ok: false, status, code, error };
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

function presentWebhook(webhook: WebhookRow) {
  return {
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
  };
}

function pointersAgree(webhook: WebhookRow, event: EventRow): boolean {
  if (webhook.sourceLeadEventId && webhook.sourceLeadEventId !== event.id) return false;
  if (event.webhookRequestLogId && event.webhookRequestLogId !== webhook.id) return false;
  return Boolean(webhook.sourceLeadEventId || event.webhookRequestLogId);
}

/**
 * Read-only source intake correlation.
 * Exactly one lookup anchor is accepted. A supplied anchor that does not
 * resolve is a 404 and is never replaced by another identifier. Webhook logs,
 * source events, funnels, and inventory are returned together only when their
 * stored pointers agree.
 */
export async function getSourceIntakeTrace(
  query: SourceIntakeTraceQuery,
  db: PrismaClient = defaultPrisma
): Promise<SourceIntakeTraceResult> {
  const anchors: Array<{ name: AnchorName; value: string }> = [];
  const webhookRequestLogId = trim(query.webhookRequestLogId);
  const requestId = trim(query.requestId);
  const sourceLeadEventId = trim(query.sourceLeadEventId);
  const sourceLeadId = trim(query.sourceLeadId);
  const sourceLeadUid = trim(query.sourceLeadUid);
  if (webhookRequestLogId) anchors.push({ name: "webhookRequestLogId", value: webhookRequestLogId });
  if (requestId) anchors.push({ name: "requestId", value: requestId });
  if (sourceLeadEventId) anchors.push({ name: "sourceLeadEventId", value: sourceLeadEventId });
  if (sourceLeadId) anchors.push({ name: "sourceLeadId", value: sourceLeadId });
  if (sourceLeadUid) anchors.push({ name: "sourceLeadUid", value: sourceLeadUid });

  if (anchors.length === 0) {
    return fail(
      400,
      "missing_anchor",
      "Provide exactly one of webhookRequestLogId, requestId, sourceLeadEventId, sourceLeadId, or sourceLeadUid."
    );
  }
  if (anchors.length > 1) {
    return fail(400, "multiple_anchors", "Provide exactly one lookup anchor.");
  }

  const anchor = anchors[0]!;
  const resolved = await resolveAnchor(anchor, db);
  if (!resolved.ok) return resolved;

  const { webhook, event, relatedSourceEventIds } = resolved;
  const presented = await presentCorrelatedTrace(webhook, event, relatedSourceEventIds, db);
  return presented;
}

type ResolvedAnchor = {
  ok: true;
  webhook: WebhookRow | null;
  event: EventRow | null;
  relatedSourceEventIds: string[];
};

async function resolveAnchor(
  anchor: { name: AnchorName; value: string },
  db: PrismaClient
): Promise<ResolvedAnchor | SourceIntakeTraceFailure> {
  if (anchor.name === "webhookRequestLogId") {
    const webhook = await db.webhookRequestLog.findUnique({
      where: { id: anchor.value },
      select: WEBHOOK_SELECT,
    });
    if (!webhook) return fail(404, "not_found", "Source intake trace not found.");
    const paired = await pairEventForWebhook(webhook, db);
    if (!paired.ok) return paired;
    return {
      ok: true,
      webhook,
      event: paired.event,
      relatedSourceEventIds: await relatedEvents(paired.event, db),
    };
  }

  if (anchor.name === "requestId") {
    const logs = await db.webhookRequestLog.findMany({
      where: { requestId: anchor.value },
      select: WEBHOOK_SELECT,
      orderBy: { receivedAt: "desc" },
      take: AMBIGUITY_TAKE,
    });
    if (logs.length === 0) return fail(404, "not_found", "Source intake trace not found.");
    if (logs.length > 1) {
      return fail(409, "ambiguous_request_id", "requestId matches more than one webhook log.");
    }
    const webhook = logs[0]!;
    const paired = await pairEventForWebhook(webhook, db);
    if (!paired.ok) return paired;
    return {
      ok: true,
      webhook,
      event: paired.event,
      relatedSourceEventIds: await relatedEvents(paired.event, db),
    };
  }

  if (anchor.name === "sourceLeadEventId") {
    const event = await db.sourceLeadEvent.findUnique({
      where: { id: anchor.value },
      select: EVENT_SELECT,
    });
    if (!event) return fail(404, "not_found", "Source intake trace not found.");
    const paired = await pairWebhookForEvent(event, db);
    if (!paired.ok) return paired;
    return {
      ok: true,
      webhook: paired.webhook,
      event,
      relatedSourceEventIds: await relatedEvents(event, db),
    };
  }

  return resolveIdentityAnchor(
    anchor.name === "sourceLeadId" ? "sourceLeadId" : "sourceLeadUid",
    anchor.value,
    db
  );
}

async function pairEventForWebhook(
  webhook: WebhookRow,
  db: PrismaClient
): Promise<{ ok: true; event: EventRow | null } | SourceIntakeTraceFailure> {
  if (webhook.sourceLeadEventId) {
    const event = await db.sourceLeadEvent.findUnique({
      where: { id: webhook.sourceLeadEventId },
      select: EVENT_SELECT,
    });
    if (!event || !pointersAgree(webhook, event)) {
      return fail(409, "association_conflict", "Webhook log does not belong to the linked source event.");
    }
    return { ok: true, event };
  }

  const events = await db.sourceLeadEvent.findMany({
    where: { webhookRequestLogId: webhook.id },
    select: EVENT_SELECT,
    orderBy: { receivedAt: "desc" },
    take: AMBIGUITY_TAKE,
  });
  if (events.length > 1) {
    return fail(409, "association_conflict", "Webhook log matches more than one source event.");
  }
  const event = events[0] ?? null;
  if (event && !pointersAgree(webhook, event)) {
    return fail(409, "association_conflict", "Webhook log does not belong to the linked source event.");
  }
  return { ok: true, event };
}

async function pairWebhookForEvent(
  event: EventRow,
  db: PrismaClient
): Promise<{ ok: true; webhook: WebhookRow | null } | SourceIntakeTraceFailure> {
  if (event.webhookRequestLogId) {
    const webhook = await db.webhookRequestLog.findUnique({
      where: { id: event.webhookRequestLogId },
      select: WEBHOOK_SELECT,
    });
    if (!webhook || !pointersAgree(webhook, event)) {
      return fail(409, "association_conflict", "Source event does not belong to the linked webhook log.");
    }
    return { ok: true, webhook };
  }

  const logs = await db.webhookRequestLog.findMany({
    where: { sourceLeadEventId: event.id },
    select: WEBHOOK_SELECT,
    orderBy: { receivedAt: "desc" },
    take: AMBIGUITY_TAKE,
  });
  if (logs.length > 1) {
    return fail(409, "association_conflict", "Source event matches more than one webhook log.");
  }
  const webhook = logs[0] ?? null;
  if (webhook && !pointersAgree(webhook, event)) {
    return fail(409, "association_conflict", "Source event does not belong to the linked webhook log.");
  }
  return { ok: true, webhook };
}

async function resolveIdentityAnchor(
  field: "sourceLeadId" | "sourceLeadUid",
  value: string,
  db: PrismaClient
): Promise<ResolvedAnchor | SourceIntakeTraceFailure> {
  const groups = await db.sourceLeadEvent.groupBy({
    by: ["sourceProvider", "sourceSystem"],
    where: { [field]: value },
  });
  if (groups.length === 0) return fail(404, "not_found", "Source intake trace not found.");
  if (groups.length > 1) {
    return fail(
      409,
      "ambiguous_source_identity",
      "Source identity matches more than one provider and source system."
    );
  }
  const scope = groups[0]!;
  const events = await db.sourceLeadEvent.findMany({
    where: {
      [field]: value,
      sourceProvider: scope.sourceProvider,
      sourceSystem: scope.sourceSystem,
    },
    select: EVENT_SELECT,
    orderBy: { receivedAt: "desc" },
    take: RELATED_EVENT_CAP + 1,
  });
  const event = events[0];
  if (!event) return fail(404, "not_found", "Source intake trace not found.");
  const paired = await pairWebhookForEvent(event, db);
  if (!paired.ok) return paired;
  return {
    ok: true,
    webhook: paired.webhook,
    event,
    relatedSourceEventIds: events.slice(1).map((row) => row.id),
  };
}

async function relatedEvents(event: EventRow | null, db: PrismaClient): Promise<string[]> {
  if (!event?.sourceLeadId) return [];
  const rows = await db.sourceLeadEvent.findMany({
    where: {
      sourceLeadId: event.sourceLeadId,
      sourceProvider: event.sourceProvider,
      sourceSystem: event.sourceSystem,
      id: { not: event.id },
    },
    select: { id: true },
    orderBy: { receivedAt: "desc" },
    take: RELATED_EVENT_CAP,
  });
  return rows.map((row) => row.id);
}

async function presentCorrelatedTrace(
  webhook: WebhookRow | null,
  event: EventRow | null,
  relatedSourceEventIds: string[],
  db: PrismaClient
): Promise<SourceIntakeTraceResult> {
  const tracking = classifyStoredInventoryTracking(event?.enrichmentMetadataJson);
  const funnelResult = await resolveFunnel(event, db);
  if (!funnelResult.ok) return funnelResult;
  const inventoryResult = await resolveInventory(event, tracking, db);
  if (!inventoryResult.ok) return inventoryResult;

  const destinationClientAccountId =
    event?.clientAccountIdResolved ?? webhook?.clientAccountId ?? null;
  const onOtherSourceEvent = inventoryResult.item?.onOtherSourceEvent ?? false;

  return {
    ok: true,
    readOnly: true,
    hasDestinationClient: Boolean(destinationClientAccountId),
    destinationClientAccountId,
    webhookRequestLog: webhook ? presentWebhook(webhook) : null,
    sourceLeadEvent: event ? presentEvent(event) : null,
    relatedSourceEventIds,
    sourceFunnel: funnelResult.funnel,
    inventoryItem: inventoryResult.item
      ? {
          id: inventoryResult.item.id,
          status: inventoryResult.item.status,
          generatedAt: inventoryResult.item.generatedAt.toISOString(),
          normalizedState: inventoryResult.item.normalizedState,
          nicheKey: inventoryResult.item.nicheKey,
          sourceLane: inventoryResult.item.sourceLane,
          sourceLeadEventId: inventoryResult.item.sourceLeadEventId,
          commerceExcluded: inventoryResult.item.commerceExcludedAt != null,
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
      inventoryItemId: inventoryResult.item?.id ?? null,
    },
  };
}

async function resolveFunnel(
  event: EventRow | null,
  db: PrismaClient
): Promise<{ ok: true; funnel: SourceIntakeTraceResponse["sourceFunnel"] } | SourceIntakeTraceFailure> {
  if (!event) return { ok: true, funnel: null };
  const enrichment = asRecord(event.enrichmentMetadataJson);
  const sourceFunnelId =
    typeof enrichment?.sourceFunnelId === "string" ? enrichment.sourceFunnelId.trim() : "";
  if (!sourceFunnelId || !isSafeInventoryReferenceId(sourceFunnelId)) return { ok: true, funnel: null };
  const funnel = await findSourceFunnelById(sourceFunnelId, db);
  if (!funnel) return { ok: true, funnel: null };
  if (funnel.provider !== event.sourceProvider) {
    return fail(409, "association_conflict", "Source funnel does not belong to this source provider.");
  }
  return {
    ok: true,
    funnel: {
      id: funnel.id,
      provider: funnel.provider,
      providerFunnelId: funnel.providerFunnelId,
      parentUrlKey: funnel.parentUrlKey,
      pageSlug: funnel.pageSlug,
      observedFunnelName: funnel.observedFunnelName,
      nicheKey: funnel.nicheKey,
      associationStatus: funnel.associationStatus,
      originClientAccountId: funnel.originClientAccountId,
    },
  };
}

async function resolveInventory(
  event: EventRow | null,
  tracking: ReturnType<typeof classifyStoredInventoryTracking>,
  db: PrismaClient
): Promise<{ ok: true; item: (ItemRow & { onOtherSourceEvent: boolean }) | null } | SourceIntakeTraceFailure> {
  if (!event) return { ok: true, item: null };
  const direct = await db.leadInventoryItem.findUnique({
    where: { sourceLeadEventId: event.id },
    select: ITEM_SELECT,
  });
  if (direct) return { ok: true, item: { ...direct, onOtherSourceEvent: false } };

  if (tracking.diagnostic !== "reused" || !isRecognizedReuseOutcome(tracking.outcome)) {
    return { ok: true, item: null };
  }
  if (tracking.outcome === "reused_same_event") return { ok: true, item: null };
  if (!tracking.inventoryItemId) return { ok: true, item: null };

  const item = await db.leadInventoryItem.findUnique({
    where: { id: tracking.inventoryItemId },
    select: ITEM_SELECT,
  });
  if (!item || item.id !== tracking.inventoryItemId) return { ok: true, item: null };
  if (item.sourceLeadEventId === event.id) {
    return { ok: true, item: { ...item, onOtherSourceEvent: false } };
  }

  const owner = await db.sourceLeadEvent.findUnique({
    where: { id: item.sourceLeadEventId },
    select: { id: true, sourceProvider: true, sourceSystem: true, sourceLeadId: true },
  });
  if (!owner) {
    return fail(409, "association_conflict", "Inventory item does not belong to this source intake.");
  }

  const outcome = tracking.outcome;
  if (
    outcome === "reused_phone" ||
    outcome === "reused_email" ||
    outcome === "reused_historical" ||
    outcome === "reused_source_lead_id"
  ) {
    const verified = await canonicalInventoryReuseVerified(event, item.id, outcome, db);
    if (verified === "verified") return { ok: true, item: { ...item, onOtherSourceEvent: true } };
    if (verified === "inconclusive") {
      return fail(409, "association_conflict", "Inventory reuse verification is inconclusive.");
    }
  }

  if (
    tracking.outcome === "reused_source_lead_id" &&
    owner.sourceProvider === event.sourceProvider &&
    owner.sourceSystem === event.sourceSystem &&
    owner.sourceLeadId !== event.sourceLeadId
  ) {
    return fail(409, "association_conflict", "Inventory item does not belong to this source lead.");
  }
  return fail(409, "association_conflict", "Inventory item does not belong to this source intake.");
}

const IDENTITY_MATCHES = new Set<CampaignInventoryIdentityHit["match"]>([
  "same_event",
  "source_lead_id",
  "phone_fingerprint",
  "email_fingerprint",
  "historical_json_compat",
]);

function readStoredIdentityMatch(enrichment: unknown): CampaignInventoryIdentityHit["match"] | null {
  const root = asRecord(enrichment);
  const tracking = root ? asRecord(root.inventoryTracking) : null;
  const value = tracking?.identityMatch;
  if (typeof value !== "string" || !IDENTITY_MATCHES.has(value as CampaignInventoryIdentityHit["match"])) {
    return null;
  }
  return value as CampaignInventoryIdentityHit["match"];
}

/**
 * Phone, email, and historical dedup are global. The current lookup must still
 * select the stored item. A higher-precedence channel may now win for that same
 * item after fingerprint backfill; the stored outcome is then checked on its own
 * channel. A different item stays a conflict. Contact values are not returned.
 */
async function canonicalInventoryReuseVerified(
  event: EventRow,
  inventoryItemId: string,
  outcome: "reused_phone" | "reused_email" | "reused_historical" | "reused_source_lead_id",
  db: PrismaClient
): Promise<"verified" | "conflict" | "inconclusive"> {
  const payloadRow = await db.sourceLeadEvent.findUnique({
    where: { id: event.id },
    select: { normalizedPayloadJson: true },
  });
  const fingerprints = buildCampaignIdentityFingerprints(payloadRow?.normalizedPayloadJson ?? null);
  const { hit } = await findExistingCampaignInventoryIdentity(
    {
      sourceLeadEventId: event.id,
      sourceProvider: event.sourceProvider,
      sourceSystem: event.sourceSystem,
      sourceLeadId: event.sourceLeadId,
      fingerprints,
    },
    db
  );
  if (!hit || hit.inventoryItemId !== inventoryItemId) return "conflict";

  const provenance = readStoredIdentityMatch(event.enrichmentMetadataJson);
  if (provenance && CAMPAIGN_IDENTITY_MATCH_OUTCOME[provenance] !== outcome) return "conflict";
  if (CAMPAIGN_IDENTITY_MATCH_OUTCOME[hit.match] === outcome) return "verified";

  if (outcome === "reused_phone" || outcome === "reused_email") {
    const channel = outcome === "reused_phone" ? "phone_fingerprint" : "email_fingerprint";
    const fingerprint =
      channel === "phone_fingerprint" ? fingerprints.phoneFingerprint : fingerprints.emailFingerprint;
    const relationship = await storedFingerprintRelationship(
      { inventoryItemId, channel, fingerprint },
      db
    );
    if (relationship === "match") return "verified";
    if (relationship === "mismatch") return "conflict";
    return "inconclusive";
  }

  if (outcome === "reused_historical") {
    const phoneHolds = fingerprints.phoneE164
      ? await historicalInventoryItemStillMatches(
          { inventoryItemId, channel: "phone_fingerprint", fingerprints },
          db
        )
      : false;
    const emailHolds = fingerprints.email
      ? await historicalInventoryItemStillMatches(
          { inventoryItemId, channel: "email_fingerprint", fingerprints },
          db
        )
      : false;
    if (phoneHolds || emailHolds) return "verified";
    return "inconclusive";
  }

  return "conflict";
}
