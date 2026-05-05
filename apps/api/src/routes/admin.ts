import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  Prisma,
  SynthflowOutboundResultLog,
  SynthflowRequestLog,
  WebhookRequestLog,
  WebhookRequestSource,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { decodeCursor, encodeCursor, keysetReceivedAtIdDescending } from "../lib/admin-cursor.js";
import { getAdminMetricsSummary } from "../services/admin-metrics.service.js";
import {
  adminIdParamSchema,
  adminSummaryQuerySchema,
  resolveSummaryDateRange,
  synthflowListQuerySchema,
  synthflowOutboundResultListQuerySchema,
  webhookListQuerySchema,
} from "../schemas/admin.schema.js";
import {
  type WebhookLeadIdentity,
  deriveLeadIdentityFromLifecyclePayloadJson,
  deriveLeadIdentityFromWebhookBodies,
  mergePreferPrimary,
} from "../lib/webhook-log-lead-identity.js";

const webhookListSelect = {
  id: true,
  requestId: true,
  source: true,
  route: true,
  receivedAt: true,
  completedAt: true,
  durationMs: true,
  processingStatus: true,
  httpStatus: true,
  clientAccountId: true,
  subaccountIdGhl: true,
  contactIdGhl: true,
  eventUuid: true,
  eventNameInternal: true,
  errorCode: true,
  errorSummary: true,
  requestBodyRedacted: true,
  responseBodyRedacted: true,
} satisfies Prisma.WebhookRequestLogSelect;

const synthflowListSelect = {
  id: true,
  requestId: true,
  source: true,
  route: true,
  receivedAt: true,
  completedAt: true,
  durationMs: true,
  httpStatus: true,
  processingStatus: true,
  clientAccountId: true,
  subaccountIdGhl: true,
  lookupStatus: true,
  knownCaller: true,
  matchedBy: true,
  fromNumber: true,
  toNumber: true,
  phoneE164: true,
  modelId: true,
  overrideModelId: true,
  contactIdGhl: true,
  assignedAgentName: true,
  customerName: true,
  errorCode: true,
  errorSummary: true,
} satisfies Prisma.SynthflowRequestLogSelect;

const synthflowOutboundResultListSelect = {
  id: true,
  requestId: true,
  callId: true,
  modelId: true,
  fromNumber: true,
  toNumber: true,
  fromNumberE164: true,
  toNumberE164: true,
  contactIdGhl: true,
  clientAccountId: true,
  subaccountIdGhl: true,
  outcome: true,
  booked: true,
  appointmentTime: true,
  receivedAt: true,
} satisfies Prisma.SynthflowOutboundResultLogSelect;

function buildWebhookFilters(q: {
  source?: WebhookRequestSource;
  processingStatus?: string;
  clientAccountId?: string;
  subaccountIdGhl?: string;
  eventUuid?: string;
  eventNameInternal?: string;
  httpStatus?: number;
  from?: string;
  to?: string;
}): Prisma.WebhookRequestLogWhereInput {
  const w: Prisma.WebhookRequestLogWhereInput = {};
  if (q.source) w.source = q.source;
  if (q.processingStatus) w.processingStatus = q.processingStatus;
  if (q.clientAccountId) w.clientAccountId = q.clientAccountId;
  if (q.subaccountIdGhl) w.subaccountIdGhl = q.subaccountIdGhl;
  if (q.eventUuid) w.eventUuid = q.eventUuid;
  if (q.eventNameInternal) w.eventNameInternal = q.eventNameInternal;
  if (q.httpStatus !== undefined) w.httpStatus = q.httpStatus;
  const ra: { gte?: Date; lte?: Date } = {};
  if (q.from) ra.gte = new Date(q.from);
  if (q.to) ra.lte = new Date(q.to);
  if (Object.keys(ra).length) w.receivedAt = ra;
  return w;
}

function buildSynthflowFilters(q: {
  processingStatus?: string;
  lookupStatus?: string;
  knownCaller?: string;
  matchedBy?: string;
  fromNumber?: string;
  toNumber?: string;
  phoneE164?: string;
  modelId?: string;
  clientAccountId?: string;
  subaccountIdGhl?: string;
  httpStatus?: number;
  from?: string;
  to?: string;
}): Prisma.SynthflowRequestLogWhereInput {
  const w: Prisma.SynthflowRequestLogWhereInput = {};
  if (q.processingStatus) w.processingStatus = q.processingStatus;
  if (q.lookupStatus) w.lookupStatus = q.lookupStatus;
  if (q.knownCaller) w.knownCaller = q.knownCaller;
  if (q.matchedBy) w.matchedBy = q.matchedBy;
  if (q.fromNumber) w.fromNumber = q.fromNumber;
  if (q.toNumber) w.toNumber = q.toNumber;
  if (q.phoneE164) w.phoneE164 = q.phoneE164;
  if (q.modelId) w.modelId = q.modelId;
  if (q.clientAccountId) w.clientAccountId = q.clientAccountId;
  if (q.subaccountIdGhl) w.subaccountIdGhl = q.subaccountIdGhl;
  if (q.httpStatus !== undefined) w.httpStatus = q.httpStatus;
  const ra: { gte?: Date; lte?: Date } = {};
  if (q.from) ra.gte = new Date(q.from);
  if (q.to) ra.lte = new Date(q.to);
  if (Object.keys(ra).length) w.receivedAt = ra;
  return w;
}

function buildSynthflowOutboundResultFilters(q: {
  outcome?: string;
  clientAccountId?: string;
  subaccountIdGhl?: string;
  contactIdGhl?: string;
  callId?: string;
  modelId?: string;
  from?: string;
  to?: string;
}): Prisma.SynthflowOutboundResultLogWhereInput {
  const w: Prisma.SynthflowOutboundResultLogWhereInput = {};
  if (q.outcome) w.outcome = q.outcome;
  if (q.clientAccountId) w.clientAccountId = q.clientAccountId;
  if (q.subaccountIdGhl !== undefined) {
    w.subaccountIdGhl = q.subaccountIdGhl;
  }
  if (q.contactIdGhl) w.contactIdGhl = q.contactIdGhl;
  if (q.callId) w.callId = q.callId;
  if (q.modelId) w.modelId = q.modelId;
  const ra: { gte?: Date; lte?: Date } = {};
  if (q.from) ra.gte = new Date(q.from);
  if (q.to) ra.lte = new Date(q.to);
  if (Object.keys(ra).length) w.receivedAt = ra;
  return w;
}

function serializeWebhookListRow(
  row: Prisma.WebhookRequestLogGetPayload<{ select: typeof webhookListSelect }>,
  identity: WebhookLeadIdentity
) {
  return {
    id: row.id,
    requestId: row.requestId,
    source: row.source,
    route: row.route,
    receivedAt: row.receivedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    processingStatus: row.processingStatus,
    httpStatus: row.httpStatus,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    contactIdGhl: row.contactIdGhl,
    eventUuid: row.eventUuid,
    eventNameInternal: row.eventNameInternal,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    leadName: identity.leadName,
    leadFirstName: identity.leadFirstName,
    leadLastName: identity.leadLastName,
    leadPhone: identity.leadPhone,
    leadEmail: identity.leadEmail,
  };
}

function serializeWebhookDetail(row: WebhookRequestLog, identity: WebhookLeadIdentity) {
  return {
    id: row.id,
    requestId: row.requestId,
    source: row.source,
    route: row.route,
    receivedAt: row.receivedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    processingStatus: row.processingStatus,
    httpStatus: row.httpStatus,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    contactIdGhl: row.contactIdGhl,
    eventUuid: row.eventUuid,
    eventNameInternal: row.eventNameInternal,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    leadName: identity.leadName,
    leadFirstName: identity.leadFirstName,
    leadLastName: identity.leadLastName,
    leadPhone: identity.leadPhone,
    leadEmail: identity.leadEmail,
    requestBodyRedacted: row.requestBodyRedacted,
    responseBodyRedacted: row.responseBodyRedacted,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeSynthflowListRow(
  row: Prisma.SynthflowRequestLogGetPayload<{ select: typeof synthflowListSelect }>
) {
  return {
    id: row.id,
    requestId: row.requestId,
    source: row.source,
    route: row.route,
    receivedAt: row.receivedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    httpStatus: row.httpStatus,
    processingStatus: row.processingStatus,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    lookupStatus: row.lookupStatus,
    knownCaller: row.knownCaller,
    matchedBy: row.matchedBy,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    phoneE164: row.phoneE164,
    modelId: row.modelId,
    overrideModelId: row.overrideModelId,
    contactIdGhl: row.contactIdGhl,
    assignedAgentName: row.assignedAgentName,
    customerName: row.customerName,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
  };
}

function serializeSynthflowOutboundResultListRow(
  row: Prisma.SynthflowOutboundResultLogGetPayload<{ select: typeof synthflowOutboundResultListSelect }>
) {
  return {
    id: row.id,
    requestId: row.requestId,
    callId: row.callId,
    modelId: row.modelId,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    fromNumberE164: row.fromNumberE164,
    toNumberE164: row.toNumberE164,
    contactIdGhl: row.contactIdGhl,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    outcome: row.outcome,
    booked: row.booked,
    appointmentTime: row.appointmentTime?.toISOString() ?? null,
    receivedAt: row.receivedAt.toISOString(),
  };
}

function serializeSynthflowOutboundResultDetail(row: SynthflowOutboundResultLog) {
  return {
    id: row.id,
    requestId: row.requestId,
    callId: row.callId,
    modelId: row.modelId,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    fromNumberE164: row.fromNumberE164,
    toNumberE164: row.toNumberE164,
    contactIdGhl: row.contactIdGhl,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    outcome: row.outcome,
    booked: row.booked,
    appointmentTime: row.appointmentTime?.toISOString() ?? null,
    transcriptSummary: row.transcriptSummary,
    payloadRedacted: row.payloadRedacted,
    receivedAt: row.receivedAt.toISOString(),
  };
}

function serializeSynthflowDetail(row: SynthflowRequestLog) {
  return {
    id: row.id,
    requestId: row.requestId,
    source: row.source,
    route: row.route,
    receivedAt: row.receivedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    httpStatus: row.httpStatus,
    processingStatus: row.processingStatus,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    lookupStatus: row.lookupStatus,
    knownCaller: row.knownCaller,
    matchedBy: row.matchedBy,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    phoneE164: row.phoneE164,
    modelId: row.modelId,
    overrideModelId: row.overrideModelId,
    contactIdGhl: row.contactIdGhl,
    assignedAgentName: row.assignedAgentName,
    customerName: row.customerName,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    requestBodyRedacted: row.requestBodyRedacted,
    responseBodyRedacted: row.responseBodyRedacted,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function adminRoutes(app: FastifyInstance) {
  type AdminDetailParams = { id: string };
  type AdminSummaryQuery = { from?: string; to?: string };
  type AdminWebhookListQuery = {
    limit?: number;
    cursor?: string;
    source?: WebhookRequestSource;
    processingStatus?: string;
    clientAccountId?: string;
    subaccountIdGhl?: string;
    eventUuid?: string;
    eventNameInternal?: string;
    httpStatus?: number;
    from?: string;
    to?: string;
  };
  type AdminSynthflowListQuery = {
    limit?: number;
    cursor?: string;
    processingStatus?: string;
    lookupStatus?: string;
    knownCaller?: string;
    matchedBy?: string;
    fromNumber?: string;
    toNumber?: string;
    phoneE164?: string;
    modelId?: string;
    clientAccountId?: string;
    subaccountIdGhl?: string;
    httpStatus?: number;
    from?: string;
    to?: string;
  };
  type AdminSynthflowOutboundResultListQuery = {
    limit?: number;
    cursor?: string;
    outcome?: string;
    clientAccountId?: string;
    subaccountIdGhl?: string;
    contactIdGhl?: string;
    callId?: string;
    modelId?: string;
    from?: string;
    to?: string;
  };

  const handleSummaryMetrics = async (
    request: FastifyRequest<{ Querystring: AdminSummaryQuery }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const parsed = adminSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    try {
      const { from, to } = resolveSummaryDateRange(parsed.data.from, parsed.data.to);
      const summary = await getAdminMetricsSummary(from, to);
      return summary;
    } catch (e) {
      const msg = e instanceof RangeError ? e.message : "Invalid date range";
      return reply.status(400).send({ ok: false, error: msg });
    }
  };

  const handleWebhookRequestsList = async (
    request: FastifyRequest<{ Querystring: AdminWebhookListQuery }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const parsed = webhookListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    const decoded = decodeCursor(q.cursor);
    if (q.cursor && !decoded) {
      return reply.status(400).send({ ok: false, error: "Invalid cursor" });
    }

    const filterWhere = buildWebhookFilters(q);
    const where: Prisma.WebhookRequestLogWhereInput = decoded
      ? { AND: [filterWhere, keysetReceivedAtIdDescending(decoded)] }
      : filterWhere;

    const take = q.limit + 1;
    const rows = await prisma.webhookRequestLog.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take,
      select: webhookListSelect,
    });

    const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor({
        receivedAt: last.receivedAt.toISOString(),
        id: last.id,
      });
    }

    const distinctEventUuids = [...new Set(page.map((r) => r.eventUuid).filter(Boolean))] as string[];
    const lifecycleRows =
      distinctEventUuids.length > 0
        ? await prisma.lifecycleEvent.findMany({
            where: { eventUuid: { in: distinctEventUuids } },
            select: { eventUuid: true, payloadJson: true },
          })
        : [];
    const lifecycleIdentityByUuid = new Map(
      lifecycleRows.map((ev) => [
        ev.eventUuid,
        deriveLeadIdentityFromLifecyclePayloadJson(ev.payloadJson),
      ])
    );

    return {
      items: page.map((row) => {
        const fromBodies = deriveLeadIdentityFromWebhookBodies(
          row.requestBodyRedacted,
          row.responseBodyRedacted
        );
        const fromLifecycle = row.eventUuid ? lifecycleIdentityByUuid.get(row.eventUuid) : undefined;
        const identity = fromLifecycle ? mergePreferPrimary(fromBodies, fromLifecycle) : fromBodies;
        return serializeWebhookListRow(row, identity);
      }),
      nextCursor,
    };
  };

  const handleWebhookRequestDetail = async (
    request: FastifyRequest<{ Params: AdminDetailParams }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const params = adminIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid id" });
    }
    const row = await prisma.webhookRequestLog.findUnique({
      where: { id: params.data.id },
    });
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Not found" });
    }
    let identity = deriveLeadIdentityFromWebhookBodies(
      row.requestBodyRedacted,
      row.responseBodyRedacted
    );
    if (row.eventUuid) {
      const ev = await prisma.lifecycleEvent.findUnique({
        where: { eventUuid: row.eventUuid },
        select: { payloadJson: true },
      });
      if (ev?.payloadJson != null) {
        identity = mergePreferPrimary(identity, deriveLeadIdentityFromLifecyclePayloadJson(ev.payloadJson));
      }
    }
    return serializeWebhookDetail(row, identity);
  };

  const handleSynthflowRequestsList = async (
    request: FastifyRequest<{ Querystring: AdminSynthflowListQuery }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const parsed = synthflowListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    const decoded = decodeCursor(q.cursor);
    if (q.cursor && !decoded) {
      return reply.status(400).send({ ok: false, error: "Invalid cursor" });
    }

    const filterWhere = buildSynthflowFilters(q);
    const where: Prisma.SynthflowRequestLogWhereInput = decoded
      ? { AND: [filterWhere, keysetReceivedAtIdDescending(decoded)] }
      : filterWhere;

    const take = q.limit + 1;
    const rows = await prisma.synthflowRequestLog.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take,
      select: synthflowListSelect,
    });

    const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor({
        receivedAt: last.receivedAt.toISOString(),
        id: last.id,
      });
    }

    return {
      items: page.map(serializeSynthflowListRow),
      nextCursor,
    };
  };

  const handleSynthflowRequestDetail = async (
    request: FastifyRequest<{ Params: AdminDetailParams }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const params = adminIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid id" });
    }
    const row = await prisma.synthflowRequestLog.findUnique({
      where: { id: params.data.id },
    });
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Not found" });
    }
    return serializeSynthflowDetail(row);
  };

  const handleSynthflowOutboundResultsList = async (
    request: FastifyRequest<{ Querystring: AdminSynthflowOutboundResultListQuery }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const parsed = synthflowOutboundResultListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    const decoded = decodeCursor(q.cursor);
    if (q.cursor && !decoded) {
      return reply.status(400).send({ ok: false, error: "Invalid cursor" });
    }

    const filterWhere = buildSynthflowOutboundResultFilters(q);
    const where: Prisma.SynthflowOutboundResultLogWhereInput = decoded
      ? { AND: [filterWhere, keysetReceivedAtIdDescending(decoded)] }
      : filterWhere;

    const take = q.limit + 1;
    const rows = await prisma.synthflowOutboundResultLog.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take,
      select: synthflowOutboundResultListSelect,
    });

    const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor({
        receivedAt: last.receivedAt.toISOString(),
        id: last.id,
      });
    }

    return {
      items: page.map(serializeSynthflowOutboundResultListRow),
      nextCursor,
    };
  };

  const handleSynthflowOutboundResultDetail = async (
    request: FastifyRequest<{ Params: AdminDetailParams }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const params = adminIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid id" });
    }
    const row = await prisma.synthflowOutboundResultLog.findUnique({
      where: { id: params.data.id },
    });
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Not found" });
    }
    return serializeSynthflowOutboundResultDetail(row);
  };

  app.get("/health", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    return {
      ok: true,
      service: "admin",
      env: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/metrics/summary", handleSummaryMetrics);
  app.get("/webhook-requests", handleWebhookRequestsList);
  app.get<{ Params: { id: string } }>("/webhook-requests/:id", handleWebhookRequestDetail);
  app.get("/synthflow-requests", handleSynthflowRequestsList);
  app.get<{ Params: { id: string } }>("/synthflow-requests/:id", handleSynthflowRequestDetail);

  // SA360 C.O.C. aliases (frontend migration can happen later).
  app.get("/coc/summary-metrics", handleSummaryMetrics);
  app.get("/coc/webhook-requests", handleWebhookRequestsList);
  app.get<{ Params: { id: string } }>("/coc/webhook-requests/:id", handleWebhookRequestDetail);
  app.get("/coc/synthflow-requests", handleSynthflowRequestsList);
  app.get<{ Params: { id: string } }>("/coc/synthflow-requests/:id", handleSynthflowRequestDetail);

  app.get("/synthflow-outbound-results", handleSynthflowOutboundResultsList);
  app.get<{ Params: { id: string } }>(
    "/synthflow-outbound-results/:id",
    handleSynthflowOutboundResultDetail
  );
  app.get("/coc/synthflow-outbound-results", handleSynthflowOutboundResultsList);
  app.get<{ Params: { id: string } }>(
    "/coc/synthflow-outbound-results/:id",
    handleSynthflowOutboundResultDetail
  );
}
