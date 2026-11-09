import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CORRECTION_PREVIEW_FILTERS } from "../services/source-intake/facebook-association-correction-preview.js";
import {
  loadFacebookAssociationCorrectionPreview,
  type CorrectionPreviewQuery,
} from "../services/source-intake/facebook-association-correction-preview.service.js";

const confirmedAtSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, "confirmedAt");

const querySchema = z.object({
  sourceFunnelId: z.string().trim().min(1).max(40),
  pageId: z.string().trim().regex(/^[0-9]{5,32}$/),
  formId: z.string().trim().regex(/^[0-9]{5,32}$/),
  originClientAccountId: z.string().trim().min(1).max(80),
  confirmedAt: confirmedAtSchema,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(500).optional(),
  decision: z.enum(CORRECTION_PREVIEW_FILTERS).optional(),
  includeAllowList: z.enum(["0", "1"]).optional(),
});

export type AdminFacebookAssociationCorrectionPreviewRoutesOptions = {
  loadPreviewImpl?: (query: CorrectionPreviewQuery) => Promise<unknown>;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

/**
 * Read-only eligibility preview. GET only.
 * A response does not confirm, reevaluate, or authorize a correction.
 */
export async function adminFacebookAssociationCorrectionPreviewRoutes(
  app: FastifyInstance,
  opts: AdminFacebookAssociationCorrectionPreviewRoutesOptions = {}
) {
  const loadPreview = opts.loadPreviewImpl ?? loadFacebookAssociationCorrectionPreview;

  app.get("/facebook-source-resolution/association-correction-preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }
    const confirmedAt = new Date(parsed.data.confirmedAt);
    if (Number.isNaN(confirmedAt.getTime())) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }
    const preview = await loadPreview({
      sourceFunnelId: parsed.data.sourceFunnelId,
      pageId: parsed.data.pageId,
      formId: parsed.data.formId,
      originClientAccountId: parsed.data.originClientAccountId,
      confirmedAt,
      limit: parsed.data.limit ?? 25,
      offset: parsed.data.offset ?? 0,
      decision: parsed.data.decision ?? "all",
      includeAllowList: parsed.data.includeAllowList === "1",
    });
    return reply.send(preview);
  });
}
