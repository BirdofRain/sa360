import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  getClientPortalTenantConfig,
  verifyClientPortalApiKey,
} from "../lib/client-portal-auth.js";
import {
  clientDashboardQuerySchema,
  resolveClientDashboardDateRange,
} from "../schemas/client-dashboard.schema.js";
import {
  getClientDashboard,
  type ClientDashboardResponse,
  type ClientDashboardServiceDeps,
} from "../services/client-dashboard.service.js";

export type ClientPortalRoutesOptions = {
  getClientDashboardImpl?: (
    params: { tenant: NonNullable<ReturnType<typeof getClientPortalTenantConfig>>; range: ReturnType<typeof resolveClientDashboardDateRange> },
    deps?: ClientDashboardServiceDeps
  ) => Promise<ClientDashboardResponse>;
};

export const clientPortalRoutes: FastifyPluginAsync<ClientPortalRoutesOptions> = async (
  app,
  opts
) => {
  const loadDashboard = opts.getClientDashboardImpl ?? getClientDashboard;

  app.get("/dashboard", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = clientDashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    let range;
    try {
      range = resolveClientDashboardDateRange(parsed.data);
    } catch (e) {
      const msg = e instanceof RangeError ? e.message : "Invalid date range";
      return reply.status(400).send({ ok: false, error: msg });
    }

    const tenant = getClientPortalTenantConfig()!;

    return loadDashboard({ tenant, range });
  });
};
