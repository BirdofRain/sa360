import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isHistoricalCampaignAssociationEnabled } from "../lib/historical-campaign-association-auth.js";
import { prisma } from "../lib/db.js";
import { HISTORICAL_ASSOCIATION_CONTRACT_ID } from "../services/ppl-fulfillment/historical-campaign-association-contract.js";
import { HistoricalOwnershipPreviewError } from "../services/ppl-fulfillment/historical-ownership-preview-error.js";
import {
  runHistoricalCampaignCatalog,
  runHistoricalOwnershipPreview,
} from "../services/ppl-fulfillment/historical-campaign-ownership-preview.js";

const CLIENT_ERRORS = new Set([
  "historical_campaign_catalog_invalid",
  "historical_campaign_catalog_scope_required",
  "historical_ownership_preview_invalid",
  "historical_ownership_preview_too_many",
  "historical_ownership_confirmation_not_available",
  "mapping_rejected",
  "origin_client_not_found",
]);

function disabled(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(404).send({
    ok: false,
    code: "historical_campaign_association_disabled",
    policyId: HISTORICAL_ASSOCIATION_CONTRACT_ID,
  });
}

function hasQuery(query: unknown): boolean {
  return Boolean(query && typeof query === "object" && Object.keys(query as object).length > 0);
}

function sendFailure(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  error: unknown,
  unavailableCode: string
) {
  if (error instanceof HistoricalOwnershipPreviewError && CLIENT_ERRORS.has(error.failureCode)) {
    const body: { ok: false; code: string; missingClientAccountIds?: string[] } = {
      ok: false,
      code: error.failureCode,
    };
    const missing = error.details?.missingClientAccountIds;
    if (error.failureCode === "origin_client_not_found" && Array.isArray(missing)) {
      body.missingClientAccountIds = missing.filter(
        (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)
      );
    }
    return reply.status(400).send(body);
  }
  const reason =
    error instanceof HistoricalOwnershipPreviewError &&
    (error.failureCode === "statement_timeout" || error.failureCode === "shape_invalid")
      ? error.failureCode
      : "snapshot_failed";
  return reply.status(503).send({ ok: false, code: unavailableCode, reason });
}

/**
 * Read-only historical campaign catalog and ownership preview.
 * Operator admin key only. Confirmation and resale routes stay unregistered.
 * Request logs are silenced so labels and mapping files are not written.
 */
export const adminHistoricalCampaignAssociationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const silent = {
    logLevel: "silent" as const,
    bodyLimit: 96 * 1024,
    errorHandler: (
      _error: unknown,
      _request: unknown,
      reply: { status: (code: number) => { send: (body: unknown) => unknown } }
    ) => reply.status(400).send({ ok: false, code: "historical_ownership_preview_invalid" }),
  };

  app.post(
    "/fulfillment-ops/historical-campaign-catalog",
    {
      ...silent,
      errorHandler: (_error, _request, reply) => {
        reply.status(400).send({ ok: false, code: "historical_campaign_catalog_invalid" });
      },
    },
    async (request, reply) => {
      if (!isHistoricalCampaignAssociationEnabled()) return disabled(reply);
      if (!(await verifyAdminApiKey(request, reply))) return;
      if (hasQuery(request.query)) {
        return reply.status(400).send({ ok: false, code: "historical_campaign_query_rejected" });
      }
      try {
        return reply.send(await runHistoricalCampaignCatalog(prisma, request.body));
      } catch (error) {
        return sendFailure(reply, error, "historical_campaign_catalog_unavailable");
      }
    }
  );

  app.post(
    "/historical-campaign-associations/ownership-previews",
    silent,
    async (request, reply) => {
      if (!isHistoricalCampaignAssociationEnabled()) return disabled(reply);
      if (!(await verifyAdminApiKey(request, reply))) return;
      if (hasQuery(request.query)) {
        return reply.status(400).send({ ok: false, code: "historical_campaign_query_rejected" });
      }
      try {
        return reply.send(await runHistoricalOwnershipPreview(prisma, request.body));
      } catch (error) {
        return sendFailure(reply, error, "historical_ownership_preview_unavailable");
      }
    }
  );
};
