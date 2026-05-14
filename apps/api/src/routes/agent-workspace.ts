import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WORKSPACE_KEY_HEADER, verifyAgentWorkspaceApiKey } from "../lib/workspace-auth.js";
import { logger } from "../lib/logger.js";
import {
  agentWorkspaceContextQuerySchema,
  agentWorkspaceGuidanceQuerySchema,
  agentWorkspaceLeadQueueQuerySchema,
  contactGuidanceEventBodySchema,
  whatHappenedBodySchema,
} from "../schemas/agent-workspace.schema.js";
import {
  fetchAgentWorkspaceContext,
  fetchAgentWorkspaceGuidance,
  fetchAgentWorkspaceLeadQueue,
  recordContactGuidanceEvent,
  recordWhatHappened,
  resolveWorkspaceSubaccountIdGhl,
} from "../services/agent-workspace.service.js";

function logWorkspaceSafe(
  event: string,
  meta: Record<string, unknown>
): void {
  logger.info(event, {
    ...meta,
    contactIdGhl_suffix:
      typeof meta.contactIdGhl === "string" && meta.contactIdGhl.length > 6
        ? `…${meta.contactIdGhl.slice(-4)}`
        : meta.contactIdGhl,
    leadUid_suffix:
      typeof meta.leadUid === "string" && meta.leadUid.length > 8
        ? `…${meta.leadUid.slice(-6)}`
        : meta.leadUid,
  });
}

export async function agentWorkspaceRoutes(app: FastifyInstance) {
  app.get("/context", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAgentWorkspaceApiKey(request, reply))) return;

    const parsed = agentWorkspaceContextQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    const sub = resolveWorkspaceSubaccountIdGhl({
      subaccountIdGhl: q.subaccountIdGhl,
      locationId: q.locationId,
    });

    logWorkspaceSafe("agent_workspace.context", {
      clientAccountId: q.clientAccountId,
      subaccountIdGhl: sub || "(empty)",
      contactIdGhl: q.contactIdGhl,
      leadUid: q.leadUid,
    });

    const body = await fetchAgentWorkspaceContext({
      clientAccountId: q.clientAccountId.trim(),
      subaccountIdGhl: sub,
      contactIdGhl: q.contactIdGhl?.trim(),
      leadUid: q.leadUid?.trim(),
    });

    return reply.send({
      ...body,
      resolvedSubaccountIdGhl: sub,
      resolvedLocationId: q.locationId?.trim() || null,
    });
  });

  app.get("/lead-queue", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAgentWorkspaceApiKey(request, reply))) return;

    const parsed = agentWorkspaceLeadQueueQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    const sub = resolveWorkspaceSubaccountIdGhl({
      subaccountIdGhl: q.subaccountIdGhl,
      locationId: q.locationId,
    });

    const stagesFromQuery =
      q.lifecycleStages
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];

    const singleStage = q.lifecycleStage?.trim();
    const lifecycleStages =
      stagesFromQuery.length > 0
        ? stagesFromQuery
        : singleStage
          ? [singleStage]
          : undefined;

    logWorkspaceSafe("agent_workspace.lead_queue", {
      clientAccountId: q.clientAccountId,
      subaccountIdGhl: sub || "(empty)",
      nicheKey: q.nicheKey,
      assignedAgentId: q.assignedAgentId,
    });

    const body = await fetchAgentWorkspaceLeadQueue({
      clientAccountId: q.clientAccountId.trim(),
      subaccountIdGhl: sub,
      lifecycleStages,
      assignedAgentId: q.assignedAgentId?.trim(),
      nicheKey: q.nicheKey?.trim(),
      limit: q.limit ?? 50,
    });

    return reply.send(body);
  });

  app.get("/guidance", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAgentWorkspaceApiKey(request, reply))) return;

    const parsed = agentWorkspaceGuidanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    const sub = resolveWorkspaceSubaccountIdGhl({
      subaccountIdGhl: q.subaccountIdGhl,
      locationId: q.locationId,
    });

    logWorkspaceSafe("agent_workspace.guidance", {
      clientAccountId: q.clientAccountId,
      subaccountIdGhl: sub || "(empty)",
      nicheKey: q.nicheKey,
      lifecycleStage: q.lifecycleStage,
    });

    const body = await fetchAgentWorkspaceGuidance({
      clientAccountId: q.clientAccountId.trim(),
      subaccountIdGhl: sub,
      nicheKey: q.nicheKey?.trim(),
      lifecycleStage: q.lifecycleStage?.trim(),
    });

    return reply.send(body);
  });

  app.post("/actions/what-happened", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAgentWorkspaceApiKey(request, reply))) return;

    const parsed = whatHappenedBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const body = parsed.data;
    logWorkspaceSafe("agent_workspace.what_happened", {
      clientAccountId: body.clientAccountId,
      outcome: body.outcome,
      contactIdGhl: body.contactIdGhl,
      leadUid: body.leadUid,
    });

    const result = await recordWhatHappened(body);
    if (!result.ok) {
      return reply.status(400).send(result);
    }

    return reply.status(201).send(result);
  });

  app.post("/actions/contact-guidance-event", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAgentWorkspaceApiKey(request, reply))) return;

    const parsed = contactGuidanceEventBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const body = parsed.data;
    logWorkspaceSafe("agent_workspace.contact_guidance_event", {
      clientAccountId: body.clientAccountId,
      actionType: body.actionType,
      contactIdGhl: body.contactIdGhl,
      leadUid: body.leadUid,
    });

    const result = await recordContactGuidanceEvent(body);
    if (!result.ok) {
      return reply.status(400).send(result);
    }

    return reply.status(201).send(result);
  });
}
