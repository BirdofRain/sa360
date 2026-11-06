import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { SOURCE_RESOLUTION_CLASSIFICATIONS } from "../services/source-intake/facebook-source-resolution-review.js";
import {
  loadFacebookSourceResolutionReview,
  type SourceResolutionReview,
  type SourceResolutionReviewQuery,
} from "../services/source-intake/facebook-source-resolution-review.service.js";

const querySchema = z.object({
  pageId: z.string().trim().regex(/^[0-9]{5,32}$/).optional(),
  formId: z.string().trim().regex(/^[0-9]{5,32}$/).optional(),
  sourceEventId: z.string().trim().min(1).max(40).optional(),
  classification: z.enum(SOURCE_RESOLUTION_CLASSIFICATIONS).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(500).optional(),
  associationLimit: z.coerce.number().int().min(1).max(100).optional(),
  associationOffset: z.coerce.number().int().min(0).max(500).optional(),
  includeEvents: z.enum(["0", "1"]).optional(),
  eventLimit: z.coerce.number().int().min(1).max(100).optional(),
  eventOffset: z.coerce.number().int().min(0).max(500).optional(),
});

export type AdminFacebookSourceResolutionRoutesOptions = {
  loadReviewImpl?: (query: SourceResolutionReviewQuery) => Promise<SourceResolutionReview>;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

/**
 * Read-only Source Resolution review. GET only.
 * The handler does not confirm associations, reevaluate events, import
 * candidates, or call Meta.
 */
export async function adminFacebookSourceResolutionRoutes(
  app: FastifyInstance,
  opts: AdminFacebookSourceResolutionRoutesOptions = {}
) {
  const loadReview = opts.loadReviewImpl ?? loadFacebookSourceResolutionReview;

  app.get("/facebook-source-resolution", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }
    const review = await loadReview({
      pageId: parsed.data.pageId ?? null,
      formId: parsed.data.formId ?? null,
      sourceEventId: parsed.data.sourceEventId ?? null,
      classification: parsed.data.classification ?? null,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      associationLimit: parsed.data.associationLimit,
      associationOffset: parsed.data.associationOffset,
      includeEvents: parsed.data.includeEvents === "1",
      eventLimit: parsed.data.eventLimit,
      eventOffset: parsed.data.eventOffset,
    });
    return reply.send(review);
  });
}
