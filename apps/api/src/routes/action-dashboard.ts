import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import type { ActionDashboardTodayResponse } from "../lib/action-dashboard-types.js";
import { actionDashboardActionBodySchema } from "../schemas/action-dashboard-action.schema.js";
import { actionDashboardTodayQuerySchema } from "../schemas/action-dashboard.schema.js";
import { executeActionDashboardAction } from "../services/action-dashboard-action.service.js";
import {
  getActionDashboardToday,
  type ActionDashboardTodayParams,
} from "../services/action-dashboard.service.js";

export type ActionDashboardRoutesOptions = {
  /** Test-only override; production uses the default DB-backed implementation. */
  getActionDashboardTodayImpl?: (
    params: ActionDashboardTodayParams
  ) => Promise<ActionDashboardTodayResponse>;
};

export const actionDashboardRoutes: FastifyPluginAsync<ActionDashboardRoutesOptions> = async (
  app,
  opts
) => {
  const getToday = opts.getActionDashboardTodayImpl ?? getActionDashboardToday;

  app.get("/today", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;

    const parsed = actionDashboardTodayQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    return getToday({
      clientAccountId: q.clientAccountId,
      locationId: q.locationId,
      agentDisplayName: q.agentDisplayName,
    });
  });

  app.post("/actions", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;

    const parsed = actionDashboardActionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const result = await executeActionDashboardAction(parsed.data);
    if (!result.ok) {
      return reply.status(400).send(result);
    }
    return reply.status(200).send(result);
  });
};
