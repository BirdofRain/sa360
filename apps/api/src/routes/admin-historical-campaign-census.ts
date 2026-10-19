import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  isHistoricalCampaignCensusEnabled,
  isHistoricalOrderNumber,
} from "../lib/historical-campaign-census-auth.js";
import { prisma } from "../lib/db.js";
import {
  HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
  HISTORICAL_ORDER_NOT_FOUND,
  runHistoricalCampaignCensus,
  runHistoricalOrderDrilldown,
} from "../services/ppl-fulfillment/historical-campaign-census.js";

function disabled(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(404).send({
    ok: false,
    code: "historical_campaign_census_disabled",
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
  });
}

function hasQuery(query: unknown): boolean {
  return Boolean(query && typeof query === "object" && Object.keys(query as object).length > 0);
}

/**
 * Read-only historical campaign census and one-order drill-down.
 * Operator admin key only. The provenance audit credential is not accepted.
 */
export const adminHistoricalCampaignCensusRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/fulfillment-ops/historical-campaign-census", async (request, reply) => {
    if (!isHistoricalCampaignCensusEnabled()) return disabled(reply);
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (hasQuery(request.query)) {
      return reply.status(400).send({ ok: false, code: "historical_campaign_census_filters_rejected" });
    }
    const result = await runHistoricalCampaignCensus(prisma);
    if (!result.ok) {
      request.log.warn({ code: result.code, reason: result.reason }, "historical campaign census unavailable");
      return reply.status(503).send(result);
    }
    return reply.send(result);
  });

  app.get<{ Params: { orderNumber: string } }>(
    "/fulfillment-ops/historical-campaign-orders/:orderNumber",
    async (request, reply) => {
      if (!isHistoricalCampaignCensusEnabled()) return disabled(reply);
      if (!(await verifyAdminApiKey(request, reply))) return;
      if (hasQuery(request.query)) {
        return reply.status(400).send({ ok: false, code: "historical_order_filters_rejected" });
      }
      const orderNumber = request.params.orderNumber?.trim() ?? "";
      if (!isHistoricalOrderNumber(orderNumber)) {
        return reply.status(400).send({ ok: false, code: "historical_order_number_invalid" });
      }
      const result = await runHistoricalOrderDrilldown(prisma, orderNumber);
      if (!result.ok && result.code === HISTORICAL_ORDER_NOT_FOUND) {
        return reply.status(404).send(result);
      }
      if (!result.ok) {
        request.log.warn(
          { code: result.code, reason: result.reason, orderNumber },
          "historical order drill-down unavailable"
        );
        return reply.status(503).send(result);
      }
      return reply.send(result);
    }
  );
};
