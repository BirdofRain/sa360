import type { FastifyInstance } from "fastify";
import type { Prisma, SynthflowRequestLog, WebhookRequestLog, WebhookRequestSource } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { decodeCursor, encodeCursor, keysetReceivedAtIdDescending } from "../lib/admin-cursor.js";
import { getAdminMetricsSummary } from "../services/admin-metrics.service.js";
import {
  adminIdParamSchema,
  adminSummaryQuerySchema,
  resolveSummaryDateRange,
  synthflowListQuerySchema,
  webhookListQuerySchema,
} from "../schemas/admin.schema.js";

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

function serializeWebhookListRow(
  row: Prisma.WebhookRequestLogGetPayload<{ select: typeof webhookListSelect }>
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
  };
}

function serializeWebhookDetail(row: WebhookRequestLog) {
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
  app.get("/health", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    return {
      ok: true,
      service: "admin",
      env: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/metrics/summary", async (request, reply) => {
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
  });

  app.get("/webhook-requests", async (request, reply) => {
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

    return {
      items: page.map(serializeWebhookListRow),
      nextCursor,
    };
  });

  app.get<{ Params: { id: string } }>("/webhook-requests/:id", async (request, reply) => {
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
    return serializeWebhookDetail(row);
  });

  app.get("/synthflow-requests", async (request, reply) => {
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
  });

  app.get<{ Params: { id: string } }>("/synthflow-requests/:id", async (request, reply) => {
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
  });
}
