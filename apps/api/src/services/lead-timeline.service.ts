import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { emptyIdentity, finalizeIdentity } from "../lib/webhook-log-lead-identity.js";
import {
  collectMilestonesFromTimeline,
  computeMissingMilestones,
  correlationKeysFromQuery,
  extractKeysFromLifecyclePayload,
  extractKeysFromWebhookLog,
  hasCorrelationMatchKey,
  identityFromParts,
  mergeCorrelationKeys,
  requireResolvedCorrelationKeys,
  stateFromLifecyclePayload,
  webhookValidity,
} from "./lead-timeline-correlation.js";
import type {
  LeadCorrelationKeys,
  LeadTimelineCurrentState,
  LeadTimelineEntry,
  LeadTimelineQuery,
  LeadTimelineResponse,
} from "./lead-timeline.types.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function receivedAtRange(query: LeadTimelineQuery): { gte?: Date; lte?: Date } | undefined {
  const ra: { gte?: Date; lte?: Date } = {};
  if (query.from) ra.gte = new Date(query.from);
  if (query.to) ra.lte = new Date(query.to);
  return Object.keys(ra).length ? ra : undefined;
}

async function resolveAnchorFromRequestId(
  requestId: string
): Promise<Partial<LeadCorrelationKeys> | null> {
  const trimmed = requestId.trim();
  if (!trimmed) return null;

  const byId = await prisma.webhookRequestLog.findUnique({ where: { id: trimmed } });
  if (byId) return extractKeysFromWebhookLog(byId);

  const byRequestId = await prisma.webhookRequestLog.findFirst({
    where: { requestId: trimmed },
    orderBy: { receivedAt: "desc" },
  });
  if (byRequestId) return extractKeysFromWebhookLog(byRequestId);

  return null;
}

async function widenKeysFromInboundIndex(
  keys: LeadCorrelationKeys
): Promise<LeadCorrelationKeys> {
  if (keys.leadUid && keys.contactIdGhl) return keys;

  const or: Prisma.InboundContactIndexWhereInput[] = [];
  if (keys.leadUid) or.push({ leadUid: keys.leadUid });
  if (keys.contactIdGhl) or.push({ contactIdGhl: keys.contactIdGhl });
  if (keys.phoneE164) or.push({ phoneE164: keys.phoneE164 });
  if (keys.email) or.push({ email: keys.email });
  if (!or.length) return keys;

  const row = await prisma.inboundContactIndex.findFirst({
    where: {
      clientAccountId: keys.clientAccountId,
      OR: or,
    },
    orderBy: { lastSeenAt: "desc" },
  });

  if (!row) return keys;

  return mergeCorrelationKeys(keys, {
    leadUid: row.leadUid ?? undefined,
    contactIdGhl: row.contactIdGhl ?? undefined,
    phoneE164: row.phoneE164,
    email: row.email ?? undefined,
    subaccountIdGhl: row.subaccountIdGhl || keys.subaccountIdGhl,
  }) as LeadCorrelationKeys;
}

function lifecycleOrClause(keys: LeadCorrelationKeys): Prisma.LifecycleEventWhereInput[] {
  const or: Prisma.LifecycleEventWhereInput[] = [];
  if (keys.leadUid) or.push({ leadUid: keys.leadUid });
  if (keys.contactIdGhl) or.push({ contactIdGhl: keys.contactIdGhl });
  return or;
}

function scopedSubaccount<T extends { subaccountIdGhl?: string | null }>(
  keys: LeadCorrelationKeys,
  row: T
): boolean {
  if (!keys.subaccountIdGhl) return true;
  return (row.subaccountIdGhl ?? "") === keys.subaccountIdGhl;
}

export async function resolveLeadCorrelationKeys(
  query: LeadTimelineQuery
): Promise<{ keys: LeadCorrelationKeys | null; warnings: string[] }> {
  const warnings: string[] = [];
  const anchor = query.requestId ? await resolveAnchorFromRequestId(query.requestId) : null;
  if (query.requestId && !anchor?.clientAccountId && !hasCorrelationMatchKey(anchor ?? {})) {
    warnings.push(`No webhook request found for requestId=${query.requestId.trim()}.`);
  }

  const merged = mergeCorrelationKeys(anchor ?? undefined, correlationKeysFromQuery(query));
  let resolved = requireResolvedCorrelationKeys(merged);
  if (!resolved) return { keys: null, warnings };

  resolved = (await widenKeysFromInboundIndex(resolved)) as LeadCorrelationKeys;
  resolved = requireResolvedCorrelationKeys(resolved);
  return { keys: resolved, warnings };
}

export function sortTimelineEntries(
  entries: LeadTimelineEntry[],
  sort: "asc" | "desc"
): LeadTimelineEntry[] {
  const dir = sort === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.receivedAt);
    const tb = Date.parse(b.receivedAt);
    if (ta !== tb) return (ta - tb) * dir;
    return a.id.localeCompare(b.id) * dir;
  });
}

export function buildCurrentState(
  index: {
    lifecycleStage: string | null;
    appointmentStatus: string | null;
    policyStatus: string | null;
    lastSeenAt: Date;
  } | null,
  latestLifecyclePayload: unknown | null
): LeadTimelineCurrentState {
  const fromPayload = latestLifecyclePayload
    ? stateFromLifecyclePayload(latestLifecyclePayload)
    : {};

  return {
    lifecycleStage: index?.lifecycleStage ?? fromPayload.lifecycleStage ?? null,
    appointmentStatus: index?.appointmentStatus ?? fromPayload.appointmentStatus ?? null,
    agentDisposition: fromPayload.agentDisposition ?? null,
    policyStatus: index?.policyStatus ?? fromPayload.policyStatus ?? null,
    aiStatus: fromPayload.aiStatus ?? null,
    routingStatus: fromPayload.routingStatus ?? null,
    lastSeenAt: index?.lastSeenAt.toISOString() ?? null,
  };
}

export type LeadTimelineFetchedData = {
  keys: LeadCorrelationKeys;
  lifecycleRows: Awaited<ReturnType<typeof prisma.lifecycleEvent.findMany>>;
  webhookRows: Awaited<ReturnType<typeof prisma.webhookRequestLog.findMany>>;
  indexRow: Awaited<ReturnType<typeof prisma.inboundContactIndex.findFirst>>;
  synthflowRows: Awaited<ReturnType<typeof prisma.synthflowRequestLog.findMany>>;
  outboundRows: Awaited<ReturnType<typeof prisma.synthflowOutboundResultLog.findMany>>;
  agentRows: Awaited<ReturnType<typeof prisma.agentWorkspaceAction.findMany>>;
};

export function assembleLeadTimelineResponse(
  data: LeadTimelineFetchedData,
  options: { sort: "asc" | "desc"; limit: number; warnings?: string[] }
): LeadTimelineResponse {
  const { keys } = data;
  const warnings = [...(options.warnings ?? [])];
  const scopedLifecycle = data.lifecycleRows.filter((r) => scopedSubaccount(keys, r));
  const scopedWebhooks = data.webhookRows.filter((r) => scopedSubaccount(keys, r));
  const indexRow = data.indexRow;

  const webhookIdByEventUuid = new Map<string, string>();
  for (const row of scopedWebhooks) {
    const eu = row.eventUuid?.trim();
    if (eu) webhookIdByEventUuid.set(eu, row.id);
  }

  const timeline: LeadTimelineEntry[] = [];

  for (const row of scopedWebhooks) {
    const identity = extractKeysFromWebhookLog(row);
    const display = finalizeIdentity(null, null, identity.email ?? null, identity.phoneE164 ?? null);
    timeline.push({
      id: row.id,
      source: row.source,
      sourceTable: "WebhookRequestLog",
      requestId: row.requestId,
      eventUuid: row.eventUuid,
      eventNameInternal: row.eventNameInternal,
      eventNameMeta: null,
      receivedAt: row.receivedAt.toISOString(),
      validity: webhookValidity(row.processingStatus),
      processingStatus: row.processingStatus,
      httpStatus: row.httpStatus !== null ? String(row.httpStatus) : null,
      leadName: display.leadName !== "Unknown lead" ? display.leadName : null,
      phoneE164: keys.phoneE164 ?? null,
      email: keys.email ?? null,
      summary: row.route,
      errorSummary: row.errorSummary,
      webhookLogId: row.id,
    });
  }

  for (const row of scopedLifecycle) {
    const payloadKeys = extractKeysFromLifecyclePayload(row.payloadJson);
    const eventUuid = row.eventUuid?.trim() || null;
    timeline.push({
      id: row.id,
      source: "lifecycle_event",
      sourceTable: "LifecycleEvent",
      requestId: null,
      eventUuid: row.eventUuid,
      eventNameInternal: row.eventNameInternal,
      eventNameMeta: row.eventNameMeta,
      receivedAt: row.receivedAt.toISOString(),
      validity: "valid",
      processingStatus: row.status,
      httpStatus: null,
      leadName: indexRow?.displayName ?? null,
      phoneE164: keys.phoneE164 ?? payloadKeys.phoneE164 ?? null,
      email: keys.email ?? payloadKeys.email ?? null,
      summary: `Lifecycle ${row.eventNameInternal} (${row.status})`,
      errorSummary: null,
      webhookLogId: eventUuid ? (webhookIdByEventUuid.get(eventUuid) ?? null) : null,
    });
  }

  for (const row of data.synthflowRows.filter((r) => scopedSubaccount(keys, r))) {
    timeline.push({
      id: row.id,
      source: row.source,
      sourceTable: "SynthflowRequestLog",
      requestId: row.requestId,
      eventUuid: null,
      eventNameInternal: "synthflow_inbound_lookup",
      eventNameMeta: row.lookupStatus ?? "Inbound lookup",
      receivedAt: row.receivedAt.toISOString(),
      validity: webhookValidity(row.processingStatus),
      processingStatus: row.processingStatus,
      httpStatus: row.httpStatus !== null ? String(row.httpStatus) : null,
      leadName: row.customerName,
      phoneE164: row.phoneE164,
      email: null,
      summary: `Synthflow lookup ${row.lookupStatus ?? row.processingStatus}`,
      errorSummary: row.errorSummary,
    });
  }

  for (const row of data.outboundRows.filter((r) => scopedSubaccount(keys, r))) {
    timeline.push({
      id: row.id,
      source: "synthflow_outbound_result",
      sourceTable: "SynthflowOutboundResultLog",
      requestId: row.requestId,
      eventUuid: null,
      eventNameInternal: row.booked ? "synthflow_outbound_booked" : "synthflow_outbound_result",
      eventNameMeta: row.outcome,
      receivedAt: row.receivedAt.toISOString(),
      validity: "valid",
      processingStatus: row.outcome,
      httpStatus: null,
      leadName: null,
      phoneE164: row.toNumberE164 ?? row.fromNumberE164,
      email: null,
      summary: `Outbound call ${row.outcome}${row.booked ? " (booked)" : ""}`,
      errorSummary: null,
    });
  }

  for (const row of data.agentRows.filter((r) => scopedSubaccount(keys, r))) {
    timeline.push({
      id: row.id,
      source: "agent_workspace",
      sourceTable: "AgentWorkspaceAction",
      requestId: null,
      eventUuid: null,
      eventNameInternal: row.actionType,
      eventNameMeta: row.actionType,
      receivedAt: row.createdAt.toISOString(),
      validity: row.status === "FAILED" ? "invalid" : "valid",
      processingStatus: row.status,
      httpStatus: null,
      leadName: indexRow?.displayName ?? null,
      phoneE164: keys.phoneE164 ?? null,
      email: keys.email ?? null,
      summary: `Agent action ${row.actionType}`,
      errorSummary: row.errorSummary,
    });
  }

  const sorted = sortTimelineEntries(timeline, options.sort).slice(0, options.limit);
  const missingMilestones = computeMissingMilestones(collectMilestonesFromTimeline(sorted));

  const latestLifecycle = scopedLifecycle.length
    ? scopedLifecycle[scopedLifecycle.length - 1]!.payloadJson
    : null;

  if (!indexRow) {
    warnings.push("No InboundContactIndex snapshot found for this lead scope.");
  }

  return {
    ok: true,
    identity: identityFromParts(keys, indexRow?.displayName, emptyIdentity()),
    currentState: buildCurrentState(
      indexRow
        ? {
            lifecycleStage: indexRow.lifecycleStage,
            appointmentStatus: indexRow.appointmentStatus,
            policyStatus: indexRow.policyStatus,
            lastSeenAt: indexRow.lastSeenAt,
          }
        : null,
      latestLifecycle
    ),
    timeline: sorted,
    missingMilestones,
    warnings,
  };
}

export async function getLeadTimeline(query: LeadTimelineQuery): Promise<LeadTimelineResponse | null> {
  const { keys, warnings } = await resolveLeadCorrelationKeys(query);
  if (!keys) return null;

  const sort = query.sort ?? "asc";
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const receivedAt = receivedAtRange(query);

  const lifecycleOr = lifecycleOrClause(keys);
  const lifecycleWhere: Prisma.LifecycleEventWhereInput = {
    clientAccountId: keys.clientAccountId,
    ...(lifecycleOr.length ? { OR: lifecycleOr } : {}),
    ...(receivedAt ? { receivedAt } : {}),
  };

  const lifecycleRows = await prisma.lifecycleEvent.findMany({
    where: lifecycleWhere,
    orderBy: { receivedAt: "asc" },
    take: limit,
  });

  const eventUuids = lifecycleRows.map((r) => r.eventUuid);

  const webhookOr: Prisma.WebhookRequestLogWhereInput[] = [];
  if (keys.contactIdGhl) webhookOr.push({ contactIdGhl: keys.contactIdGhl });
  if (eventUuids.length) webhookOr.push({ eventUuid: { in: eventUuids } });

  const webhookRows =
    webhookOr.length > 0
      ? await prisma.webhookRequestLog.findMany({
          where: {
            clientAccountId: keys.clientAccountId,
            OR: webhookOr,
            ...(receivedAt ? { receivedAt } : {}),
          },
          orderBy: { receivedAt: "asc" },
          take: limit,
        })
      : [];

  const indexOr: Prisma.InboundContactIndexWhereInput[] = [];
  if (keys.leadUid) indexOr.push({ leadUid: keys.leadUid });
  if (keys.contactIdGhl) indexOr.push({ contactIdGhl: keys.contactIdGhl });
  if (keys.phoneE164) indexOr.push({ phoneE164: keys.phoneE164 });
  if (keys.email) indexOr.push({ email: keys.email });

  const indexRow = indexOr.length
    ? await prisma.inboundContactIndex.findFirst({
        where: { clientAccountId: keys.clientAccountId, OR: indexOr },
        orderBy: { lastSeenAt: "desc" },
      })
    : null;

  const synthflowOr: Prisma.SynthflowRequestLogWhereInput[] = [];
  if (keys.contactIdGhl) synthflowOr.push({ contactIdGhl: keys.contactIdGhl });
  if (keys.phoneE164) synthflowOr.push({ phoneE164: keys.phoneE164 });

  const synthflowRows =
    synthflowOr.length > 0
      ? await prisma.synthflowRequestLog.findMany({
          where: {
            clientAccountId: keys.clientAccountId,
            OR: synthflowOr,
            ...(receivedAt ? { receivedAt } : {}),
          },
          orderBy: { receivedAt: "asc" },
          take: limit,
        })
      : [];

  const outboundOr: Prisma.SynthflowOutboundResultLogWhereInput[] = [];
  if (keys.contactIdGhl) outboundOr.push({ contactIdGhl: keys.contactIdGhl });
  if (keys.phoneE164) {
    outboundOr.push({ fromNumberE164: keys.phoneE164 }, { toNumberE164: keys.phoneE164 });
  }

  const outboundRows =
    outboundOr.length > 0
      ? await prisma.synthflowOutboundResultLog.findMany({
          where: {
            clientAccountId: keys.clientAccountId,
            OR: outboundOr,
            ...(receivedAt ? { receivedAt } : {}),
          },
          orderBy: { receivedAt: "asc" },
          take: limit,
        })
      : [];

  const agentOr: Prisma.AgentWorkspaceActionWhereInput[] = [];
  if (keys.leadUid) agentOr.push({ leadUid: keys.leadUid });
  if (keys.contactIdGhl) agentOr.push({ contactIdGhl: keys.contactIdGhl });

  const agentRows =
    agentOr.length > 0
      ? await prisma.agentWorkspaceAction.findMany({
          where: {
            clientAccountId: keys.clientAccountId,
            OR: agentOr,
            ...(receivedAt ? { createdAt: receivedAt } : {}),
          },
          orderBy: { createdAt: "asc" },
          take: limit,
        })
      : [];

  return assembleLeadTimelineResponse(
    {
      keys,
      lifecycleRows,
      webhookRows,
      indexRow,
      synthflowRows,
      outboundRows,
      agentRows,
    },
    { sort, limit, warnings }
  );
}
