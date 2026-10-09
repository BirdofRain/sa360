import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  getMetaReviewConfig,
  getMetaReviewPreflight,
  getMetaReviewSubscription,
  listMetaReviewInsights,
  listMetaReviewPages,
  listMetaReviewPermissions,
  listMetaReviewPosts,
  MetaReviewError,
  subscribeMetaReviewLeadgen,
  type MetaReviewConfig,
} from "../services/meta-review/meta-review.service.js";

const pageParamsSchema = z.object({ pageId: z.string().trim().min(1).max(40) });
const accountParamsSchema = z.object({ adAccountId: z.string().trim().min(1).max(44) });
const insightQuerySchema = z.object({
  since: z.string().trim().min(1),
  until: z.string().trim().min(1),
});
const subscribeBodySchema = z.object({
  confirmed: z.literal(true),
  confirmationText: z.string().trim().min(1).max(80),
});

export type AdminMetaReviewRoutesOptions = {
  getConfigImpl?: () => MetaReviewConfig;
  fetchImpl?: typeof fetch;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof MetaReviewError) {
    return reply.status(error.httpStatus).send({
      ok: false,
      error: error.code,
      message: error.message,
      trace: error.trace,
    });
  }
  return reply.status(500).send({
    ok: false,
    error: "meta_review_failed",
    message: "Meta review request failed.",
  });
}

export async function adminMetaReviewRoutes(
  app: FastifyInstance,
  opts: AdminMetaReviewRoutesOptions = {}
) {
  const config = () => (opts.getConfigImpl ?? getMetaReviewConfig)();

  app.get("/meta-review/preflight", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      return reply.send({ ok: true, preflight: getMetaReviewPreflight(config()) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/meta-review/pages", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      return reply.send({ ok: true, ...(await listMetaReviewPages(config(), opts.fetchImpl)) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/meta-review/permissions", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      return reply.send({
        ok: true,
        ...(await listMetaReviewPermissions(config(), opts.fetchImpl)),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/meta-review/pages/:pageId/subscription", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = pageParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_page_id" });
    }
    try {
      return reply.send({
        ok: true,
        ...(await getMetaReviewSubscription(params.data.pageId, config(), opts.fetchImpl)),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/meta-review/pages/:pageId/posts", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = pageParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_page_id" });
    }
    try {
      return reply.send({
        ok: true,
        ...(await listMetaReviewPosts(params.data.pageId, config(), opts.fetchImpl)),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/meta-review/ad-accounts/:adAccountId/insights", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = accountParamsSchema.safeParse(request.params);
    const query = insightQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ ok: false, error: "invalid_insights_request" });
    }
    try {
      return reply.send({
        ok: true,
        ...(await listMetaReviewInsights(
          params.data.adAccountId,
          query.data.since,
          query.data.until,
          config(),
          opts.fetchImpl
        )),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/meta-review/pages/:pageId/subscribe-leadgen", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = pageParamsSchema.safeParse(request.params);
    const body = subscribeBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ ok: false, error: "confirmation_required" });
    }
    try {
      return reply.send({
        ok: true,
        ...(await subscribeMetaReviewLeadgen(
          params.data.pageId,
          body.data.confirmationText,
          config(),
          opts.fetchImpl
        )),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
