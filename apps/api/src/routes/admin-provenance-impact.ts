import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { prisma } from "../lib/db.js";
import { authorizeProvenanceImpactAudit, isProvenanceImpactAuditEnabled } from "../lib/provenance-audit-auth.js";
import { PPL_PROVENANCE_ELIGIBILITY_POLICY_ID } from "../services/ppl-fulfillment/provenance-eligibility.js";
import { runProvenanceImpactAudit } from "../services/ppl-fulfillment/provenance-impact-audit.js";

/**
 * Read-only structural impact of `ppl-provenance-eligibility-v1`.
 * No query parameters. The audit key is accepted only by this route.
 */
export const adminProvenanceImpactRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/fulfillment-ops/provenance-impact", async (request, reply) => {
    if (!isProvenanceImpactAuditEnabled()) {
      return reply.status(404).send({
        ok: false,
        code: "provenance_impact_audit_disabled",
        policyId: PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
      });
    }
    if (!(await authorizeProvenanceImpactAudit(request, reply))) return;
    const query = request.query;
    if (query && typeof query === "object" && Object.keys(query as object).length > 0) {
      return reply.status(400).send({ ok: false, code: "provenance_impact_filters_rejected" });
    }
    const result = await runProvenanceImpactAudit(prisma);
    if (!result.ok) {
      request.log.warn({ code: result.code, reason: result.reason }, "provenance impact audit unavailable");
      return reply.status(503).send(result);
    }
    return reply.send(result);
  });
};
