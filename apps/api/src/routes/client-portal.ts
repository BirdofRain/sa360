import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { verifyClientPortalApiKey } from "../lib/client-portal-auth.js";
import {
  clientDashboardQuerySchema,
  resolveClientDashboardDateRange,
} from "../schemas/client-dashboard.schema.js";
import { portalContextQuerySchema } from "../schemas/client-portal.schema.js";
import {
  getClientDashboard,
  type ClientDashboardResponse,
  type ClientDashboardServiceDeps,
} from "../services/client-dashboard.service.js";
import {
  getPortalClientContextByLoginEmail,
  resolveClientPortalTenant,
  type ClientPortalTenantDeps,
} from "../services/client-portal-tenant.service.js";

export type ClientPortalRoutesOptions = {
  tenantDeps?: ClientPortalTenantDeps;
  getClientDashboardImpl?: (
    params: {
      tenant: { clientAccountId: string; subaccountIdGhl?: string };
      range: ReturnType<typeof resolveClientDashboardDateRange>;
    },
    deps?: ClientDashboardServiceDeps
  ) => Promise<ClientDashboardResponse>;
};

export const clientPortalRoutes: FastifyPluginAsync<ClientPortalRoutesOptions> = async (
  app,
  opts
) => {
  const loadDashboard = opts.getClientDashboardImpl ?? getClientDashboard;
  const tenantDeps = opts.tenantDeps;

  app.get("/portal-context", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = portalContextQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const ctx = await getPortalClientContextByLoginEmail(parsed.data.loginEmail, tenantDeps);
    if (!ctx) {
      return reply.status(404).send({ ok: false, error: "Portal account not found" });
    }

    return reply.send({ ok: true, context: ctx });
  });

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

    const resolved = await resolveClientPortalTenant(parsed.data.clientAccountId, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    return loadDashboard({ tenant: resolved.tenant, range });
  });
};
