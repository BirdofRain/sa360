import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { processMetaLeadgenFetch } from "../services/source-intake/meta-leadgen-fetch.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const processBodySchema = z.object({
  leadgenId: z.string().trim().min(1),
  sourceLeadEventId: z.string().trim().min(1),
  jobId: z.string().optional(),
  attemptNumber: z.number().int().positive().optional(),
  fixture: z.boolean().optional(),
});

/**
 * Internal worker endpoint for meta-leadgen-fetch.
 * Graph tokens and intake services stay in the API; the worker is a thin dispatcher.
 */
export const adminMetaLeadgenRoutes: FastifyPluginAsync = async (app) => {
  app.post("/meta-leadgen/internal/process-fetch", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = processBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const result = await processMetaLeadgenFetch({
      leadgenId: body.data.leadgenId,
      sourceLeadEventId: body.data.sourceLeadEventId,
      jobId: body.data.jobId,
      attemptNumber: body.data.attemptNumber,
      fixture: body.data.fixture,
    });

    if (!result.ok && result.retryable) {
      return reply.status(500).send({
        ok: false,
        retryable: true,
        error: result.error,
        graphOutcome: result.graphOutcome,
      });
    }
    if (!result.ok) {
      return reply.status(422).send({
        ok: false,
        retryable: false,
        error: result.error,
        graphOutcome: result.graphOutcome,
      });
    }
    return reply.send({ ok: true, result });
  });
};
