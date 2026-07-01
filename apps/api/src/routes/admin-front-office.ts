import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { frontOfficeQuerySchema } from "../schemas/front-office.schema.js";
import { buildFrontOfficeDemoReadiness } from "../services/front-office/front-office-demo-readiness.service.js";
import { buildFrontOfficeSummary } from "../services/front-office/front-office-summary.service.js";
import { buildFrontOfficeTrustCenter } from "../services/front-office/front-office-trust.service.js";
import { presentTrustCenter } from "../services/front-office/front-office-trust-present.service.js";
import type { FrontOfficeSummaryServiceDeps } from "../services/front-office/front-office-summary.service.js";
import type { FrontOfficeTrustServiceDeps } from "../services/front-office/front-office-trust.service.js";

export type AdminFrontOfficeRoutesOptions = FrontOfficeSummaryServiceDeps &
  FrontOfficeTrustServiceDeps & {
    buildFrontOfficeTrustCenterImpl?: typeof buildFrontOfficeTrustCenter;
    buildFrontOfficeSummaryImpl?: typeof buildFrontOfficeSummary;
    buildFrontOfficeDemoReadinessImpl?: typeof buildFrontOfficeDemoReadiness;
  };

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export const adminFrontOfficeRoutes: FastifyPluginAsync<AdminFrontOfficeRoutesOptions> = async (
  app,
  opts
) => {
  const buildTrust = opts.buildFrontOfficeTrustCenterImpl ?? buildFrontOfficeTrustCenter;
  const buildSummary = opts.buildFrontOfficeSummaryImpl ?? buildFrontOfficeSummary;
  const buildDemoReadiness = opts.buildFrontOfficeDemoReadinessImpl ?? buildFrontOfficeDemoReadiness;

  app.get("/front-office/trust", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = frontOfficeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const center = await buildTrust(parsed.data.clientAccountId, opts);
    return presentTrustCenter(center, "admin");
  });

  app.get("/front-office/summary", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = frontOfficeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const summary = await buildSummary(parsed.data.clientAccountId, "admin", opts);
    return reply.send({ ok: true, ...summary });
  });

  app.get("/front-office/demo-readiness", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const readiness = await buildDemoReadiness(opts);
    return reply.send(readiness);
  });
};
