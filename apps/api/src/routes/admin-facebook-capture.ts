import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import { FacebookCaptureIntakeDisabledError } from "../services/source-intake/facebook-capture-gate.js";
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
  actor: z.string().trim().max(120).optional(),
});

function readOperatorActor(request: FastifyRequest, bodyActor?: string): string | null {
  const header = request.headers["x-sa360-operator"];
  const fromHeader = typeof header === "string" ? header.trim() : "";
  if (fromHeader) return fromHeader.slice(0, 120);
  const fromBody = bodyActor?.trim() ?? "";
  return fromBody ? fromBody.slice(0, 120) : null;
}

function disabledResponse(err: FacebookCaptureIntakeDisabledError) {
  return { ok: false as const, error: err.code, message: err.message };
}

export type AdminFacebookCaptureRoutesOptions = {
  confirmFacebookFormAssociationImpl?: typeof confirmFacebookFormAssociation;
  reevaluateFacebookCaptureAssociationImpl?: typeof reevaluateFacebookCaptureAssociation;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminFacebookCaptureRoutes(
  app: FastifyInstance,
  opts: AdminFacebookCaptureRoutesOptions = {}
) {
  const confirmImpl = opts.confirmFacebookFormAssociationImpl ?? confirmFacebookFormAssociation;
  const reevaluateImpl =
    opts.reevaluateFacebookCaptureAssociationImpl ?? reevaluateFacebookCaptureAssociation;
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
      const result = await confirmImpl(parsed.data);
      return reply.status(result.created ? 201 : 200).send({ ok: true, ...result });
    } catch (err) {
      if (err instanceof FacebookCaptureIntakeDisabledError) {
        return reply.status(err.httpStatus).send(disabledResponse(err));
      }
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
      const result = await reevaluateImpl({
        sourceEventId: params.data.sourceEventId,
        operatorNote: body.data.operatorNote,
        actor: readOperatorActor(request, body.data.actor),
        requestId: readRequestId(request),
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof FacebookCaptureIntakeDisabledError) {
        return reply.status(err.httpStatus).send(disabledResponse(err));
      }
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
