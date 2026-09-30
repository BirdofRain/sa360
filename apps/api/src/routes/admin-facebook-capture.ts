import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import {
  FacebookCaptureReevaluationError,
  reevaluateFacebookCaptureAssociation,
} from "../services/source-intake/facebook-capture-reevaluate.service.js";
import {
  FacebookFormAssociationError,
  confirmFacebookFormAssociation,
  listFacebookFormAssociations,
} from "../services/source-intake/facebook-form-association.service.js";

const associateBodySchema = z.object({
  pageId: z.string().trim().min(1),
  formId: z.string().trim().min(1),
  clientAccountId: z.string().trim().min(1),
  formName: z.string().trim().max(200).optional(),
});

const reevaluateBodySchema = z.object({
  operatorNote: z.string().trim().max(500).optional(),
});

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminFacebookCaptureRoutes(app: FastifyInstance) {
  app.get("/facebook-form-associations", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const items = await listFacebookFormAssociations({ limit: 50 });
    return reply.send({ ok: true, count: items.length, items });
  });

  app.post("/facebook-form-associations", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = associateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_payload",
        message: "pageId, formId, and clientAccountId are required strings.",
      });
    }
    try {
      const result = await confirmFacebookFormAssociation(parsed.data);
      return reply.status(result.created ? 201 : 200).send({ ok: true, ...result });
    } catch (err) {
      if (err instanceof FacebookFormAssociationError) {
        const status =
          err.code === "client_not_found" ? 404 : err.code === "association_conflict" ? 409 : 400;
        return reply.status(status).send({
          ok: false,
          error: err.code,
          message: err.message,
          currentClientAccountId: err.details.currentClientAccountId ?? null,
          requestedClientAccountId: err.details.requestedClientAccountId ?? null,
        });
      }
      logger.warn("admin.facebook_form_association.failed", {
        error: err instanceof Error ? err.message : "associate_failed",
      });
      return reply.status(500).send({ ok: false, error: "Unable to save the Facebook form association." });
    }
  });

  app.post("/facebook-capture/events/:sourceEventId/reevaluate-association", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = z
      .object({ sourceEventId: z.string().trim().min(1) })
      .safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_id" });
    }
    const body = reevaluateBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_payload" });
    }
    try {
      const result = await reevaluateFacebookCaptureAssociation({
        sourceEventId: params.data.sourceEventId,
        operatorNote: body.data.operatorNote,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof FacebookCaptureReevaluationError) {
        return reply.status(err.httpStatus).send({ ok: false, error: err.code });
      }
      logger.warn("admin.facebook_capture.reevaluate_failed", {
        error: err instanceof Error ? err.message : "reevaluate_failed",
      });
      return reply.status(500).send({ ok: false, error: "Unable to reevaluate the association." });
    }
  });
}
