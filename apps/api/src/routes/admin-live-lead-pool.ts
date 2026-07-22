import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SourceLeadEventStatus } from "@prisma/client";
import { z } from "zod";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { getBuildVersionPayload } from "../lib/build-version.js";
import { listLiveLeadPool } from "../services/live-lead-pool/live-lead-pool.service.js";
import { listDemandQueue } from "../services/demand-queue/demand-queue.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const liveLeadPoolQuerySchema = z.object({
  clientAccountId: z.string().trim().optional(),
  campaignId: z.string().trim().optional(),
  nicheKey: z.string().trim().optional(),
  status: z.string().trim().optional(),
  sourceSystem: z.string().trim().optional(),
  unmatchedOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
  demandType: z.enum(["pay_per_lead", "retainer_allocation"]).optional(),
  proofStatus: z.string().trim().optional(),
  receivedAfter: z.string().datetime().optional(),
  receivedBefore: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const demandQueueQuerySchema = z.object({
  clientAccountId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  demandType: z.enum(["pay_per_lead", "retainer_allocation"]).optional(),
  clientScoped: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function adminLiveLeadPoolRoutes(app: FastifyInstance) {
  app.get("/live-lead-pool", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = liveLeadPoolQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }

    const result = await listLiveLeadPool({
      clientAccountId: parsed.data.clientAccountId,
      campaignId: parsed.data.campaignId,
      nicheKey: parsed.data.nicheKey,
      status: parsed.data.status as SourceLeadEventStatus | undefined,
      sourceSystem: parsed.data.sourceSystem,
      unmatchedOnly: parsed.data.unmatchedOnly,
      demandType: parsed.data.demandType,
      proofStatus: parsed.data.proofStatus,
      receivedAfter: parsed.data.receivedAfter
        ? new Date(parsed.data.receivedAfter)
        : undefined,
      receivedBefore: parsed.data.receivedBefore
        ? new Date(parsed.data.receivedBefore)
        : undefined,
      limit: parsed.data.limit,
    });

    return reply.send({
      ok: true,
      summary: result.summary,
      items: result.items,
      apiBuildVersion: getBuildVersionPayload(),
    });
  });

  app.get("/demand-queue", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = demandQueueQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }

    const result = await listDemandQueue({
      clientAccountId: parsed.data.clientAccountId,
      status: parsed.data.status,
      demandType: parsed.data.demandType,
      clientScoped: parsed.data.clientScoped ?? Boolean(parsed.data.clientAccountId),
      limit: parsed.data.limit,
    });

    return reply.send({
      ok: true,
      items: result.items,
      scope: parsed.data.clientAccountId ? "client" : "admin_global",
      apiBuildVersion: getBuildVersionPayload(),
    });
  });
}
