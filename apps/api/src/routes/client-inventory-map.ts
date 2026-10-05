import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { verifyClientPortalApiKey } from "../lib/client-portal-auth.js";
import { frontOfficeQuerySchema } from "../schemas/front-office.schema.js";
import {
  resolveClientPortalTenant,
  type ClientPortalTenantDeps,
} from "../services/client-portal-tenant.service.js";
import {
  buildClientInventoryStateAvailability,
  type ClientStateAvailabilityReadModel,
} from "../services/lead-inventory/lead-inventory-client-state-availability.service.js";

export type ClientInventoryMapRoutesOptions = {
  tenantDeps?: ClientPortalTenantDeps;
  buildStateAvailabilityImpl?: (
    filters: { clientAccountId: string; nicheKey?: string; productType?: string }
  ) => Promise<ClientStateAvailabilityReadModel>;
};

export type ClientStateAvailabilityResponse = {
  ok: true;
  availability: ClientStateAvailabilityReadModel;
};

/**
 * Read-only, advisory inventory availability by US state for the portal map.
 * GET only — no reservation, order, or fulfillment side effects.
 */
export const clientInventoryMapRoutes: FastifyPluginAsync<ClientInventoryMapRoutesOptions> =
  async (app, opts) => {
    const tenantDeps = opts.tenantDeps;
    const buildStateAvailability =
      opts.buildStateAvailabilityImpl ??
      ((filters: { clientAccountId: string; nicheKey?: string; productType?: string }) =>
        buildClientInventoryStateAvailability(filters));

    app.get(
      "/leads-on-demand/state-availability",
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!(await verifyClientPortalApiKey(request, reply))) return;

        const parsed = frontOfficeQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.status(400).send({
            ok: false,
            error: "Invalid query",
            details: parsed.error.flatten(),
          });
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

        const availability = await buildStateAvailability({
          clientAccountId: resolved.tenant.clientAccountId,
          nicheKey: parsed.data.nicheKey,
          productType: parsed.data.productType,
        });

        const response: ClientStateAvailabilityResponse = { ok: true, availability };
        return reply.send(response);
      }
    );
  };
