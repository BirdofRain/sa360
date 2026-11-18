import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  readMetaLeadgenSubscriptions,
  subscribeMetaLeadgenPage,
  type LeadgenSubscriptionFailure,
  type LeadgenSubscriptionRead,
  type LeadgenSubscriptionWrite,
  type MetaLeadgenSubscriptionDeps,
} from "../services/source-intake/meta-leadgen-subscription.service.js";

const credentialParams = z.object({ credentialId: z.string().trim().min(1).max(80) });
const subscribeParams = credentialParams.extend({
  pageId: z.string().trim().min(1).max(40),
});
const subscribeBody = z.object({
  confirmed: z.literal(true),
  confirmationText: z.string().trim().min(1).max(80),
});

export type AdminMetaLeadgenSubscriptionRoutesOptions = {
  deps?: MetaLeadgenSubscriptionDeps;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

function sendFailure(reply: FastifyReply, failure: LeadgenSubscriptionFailure) {
  const { httpStatus, ...body } = failure;
  return reply.status(httpStatus).send(body);
}

/**
 * Admin-only leadgen subscription status and one-Page subscribe.
 * The handlers do not enable capture grants, intake, Graph lead fetch,
 * routing, or delivery. Writes stay inside the subscription service.
 */
export const adminMetaLeadgenSubscriptionRoutes: FastifyPluginAsync<
  AdminMetaLeadgenSubscriptionRoutesOptions
> = async (app, opts) => {
  const deps = opts.deps ?? {};

  app.get("/meta-capture/credentials/:credentialId/leadgen-subscriptions", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = credentialParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_credential_id" });
    const result: LeadgenSubscriptionRead | LeadgenSubscriptionFailure = await readMetaLeadgenSubscriptions(
      params.data.credentialId,
      deps
    );
    if (!result.ok) return sendFailure(reply, result);
    return reply.send(result);
  });

  app.post(
    "/meta-capture/credentials/:credentialId/pages/:pageId/subscribe-leadgen",
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const params = subscribeParams.safeParse(request.params);
      const body = subscribeBody.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({ ok: false, error: "confirmation_required" });
      }
      const result: LeadgenSubscriptionWrite | LeadgenSubscriptionFailure = await subscribeMetaLeadgenPage(
        {
          credentialId: params.data.credentialId,
          pageId: params.data.pageId,
          confirmationText: body.data.confirmationText,
        },
        deps
      );
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(result);
    }
  );
};
