import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuthenticatedPortalTenant } from "../lib/client-portal-session-assertion.js";
import { isPortalLiveInventoryEnabled } from "../lib/portal-live-inventory-env.js";
import { lookupPortalBuyerAvailability } from "../services/ppl-fulfillment/portal-buyer-availability.js";

const bodySchema = z.object({
  nicheKey: z.string().trim().min(1).max(120),
  states: z.array(z.string().trim().min(1).max(8)).min(1).max(20),
  commerceAgeBucketKeys: z.array(z.string().trim().min(1).max(64)).min(1).max(8),
  productType: z.string().trim().max(120).optional().nullable(),
});

function clientAccountIdSupplied(source: unknown): boolean {
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  return Object.prototype.hasOwnProperty.call(source, "clientAccountId");
}

export type PortalBuyerAvailabilityRoutesOptions = {
  requirePortalTenant?: typeof requireAuthenticatedPortalTenant;
  lookup?: typeof lookupPortalBuyerAvailability;
  enabled?: () => boolean;
};

function statusForFailure(code: string): number {
  if (code === "buyer_not_found") return 404;
  if (code === "invalid_niche" || code === "invalid_states" || code === "invalid_age_buckets") {
    return 400;
  }
  if (code === "unsupported_filter") return 400;
  if (code === "availability_snapshot_unavailable") return 503;
  return 409;
}

export const portalBuyerAvailabilityRoutes: FastifyPluginAsync<
  PortalBuyerAvailabilityRoutesOptions
> = async (app, options) => {
  const requireTenant = options.requirePortalTenant ?? requireAuthenticatedPortalTenant;
  const lookup = options.lookup ?? lookupPortalBuyerAvailability;
  const enabled = options.enabled ?? isPortalLiveInventoryEnabled;

  app.post(
    "/inventory/buyer-availability",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!enabled()) {
        return reply.status(404).send({ ok: false, error: "portal_live_inventory_disabled" });
      }
      const query = request.query;
      const body = request.body;
      if (clientAccountIdSupplied(query) || clientAccountIdSupplied(body)) {
        return reply.status(400).send({
          ok: false,
          error: "clientAccountId cannot be supplied",
        });
      }
      const tenant = await requireTenant(request, reply);
      if (!tenant) return;

      const parsed = bodySchema.safeParse(body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: "invalid_request" });
      }
      const result = await lookup({
        clientAccountId: tenant.clientAccountId,
        nicheKey: parsed.data.nicheKey,
        states: parsed.data.states,
        commerceAgeBucketKeys: parsed.data.commerceAgeBucketKeys,
        productType: parsed.data.productType,
      });
      if (!result.ok) {
        return reply.status(statusForFailure(result.code)).send({
          ok: false,
          code: result.code,
          error: result.code,
          reasons: result.reasons,
        });
      }
      return reply.send(result);
    }
  );
};
