import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { requireAuthenticatedPortalTenant } from "../lib/client-portal-session-assertion.js";
import {
  enqueueAuthorizedAgedReleaseSheetsDelivery,
  enqueueCompanySheetsCanary,
  enqueueConfirmedLeadSheetsDelivery,
  executeCompanySheetsDeliveryJob,
  getCompanySheetsOrderEvidenceForClient,
  releaseCompanySheetsDeliveryHold,
  setCompanySheetsCanaryApproval,
  type CompanySheetsDeliveryDeps,
  type DeliveryFailure,
} from "../services/company-sheets-delivery/company-sheets-delivery.service.js";

export type CompanySheetsDeliveryRouteOptions = {
  deps?: CompanySheetsDeliveryDeps;
  requirePortalTenant?: typeof requireAuthenticatedPortalTenant;
};

function sendFailure(reply: FastifyReply, result: DeliveryFailure) {
  return reply.status(result.statusCode).send({ ok: false, error: result.code });
}

function clientAccountIdSupplied(source: unknown): boolean {
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  return Object.prototype.hasOwnProperty.call(source, "clientAccountId");
}

export const adminCompanySheetsDeliveryRoutes: FastifyPluginAsync<CompanySheetsDeliveryRouteOptions> = async (
  app,
  opts
) => {
  const deps = opts.deps ?? {};

  app.put("/clients/:clientAccountId/google-sheets/canary-approval", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const body = (request.body ?? {}) as { approved?: unknown };
    if (typeof body.approved !== "boolean") {
      return reply.status(400).send({ ok: false, error: "invalid_canary_approval" });
    }
    const result = await setCompanySheetsCanaryApproval(clientAccountId, body.approved, deps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, canaryApproved: result.canaryApproved, executionStarted: false });
  });

  app.post("/clients/:clientAccountId/google-sheets/canary", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const body = (request.body ?? {}) as { idempotencyKey?: unknown; rowCount?: unknown };
    const result = await enqueueCompanySheetsCanary(
      {
        clientAccountId,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        rowCount: typeof body.rowCount === "number" ? body.rowCount : undefined,
      },
      deps
    );
    if (!result.ok) return sendFailure(reply, result);
    return reply.status(result.created ? 201 : 200).send({
      ok: true,
      jobId: result.job.id,
      status: result.job.status,
      executed: false,
    });
  });

  app.post("/company-sheets/deliveries/lead", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const body = (request.body ?? {}) as { sourceLeadEventId?: unknown };
    if (typeof body.sourceLeadEventId !== "string") {
      return reply.status(400).send({ ok: false, error: "invalid_lead" });
    }
    const result = await enqueueConfirmedLeadSheetsDelivery(body.sourceLeadEventId, deps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.status(result.created ? 201 : 200).send({
      ok: true,
      jobId: result.job.id,
      status: result.job.status,
      executed: false,
    });
  });

  app.post("/company-sheets/deliveries/aged-release", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const body = (request.body ?? {}) as { exportPackageId?: unknown };
    if (typeof body.exportPackageId !== "string") {
      return reply.status(400).send({ ok: false, error: "invalid_export" });
    }
    const result = await enqueueAuthorizedAgedReleaseSheetsDelivery(body.exportPackageId, deps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.status(result.created ? 201 : 200).send({
      ok: true,
      jobId: result.job.id,
      status: result.job.status,
      executed: false,
    });
  });

  app.post("/company-sheets/delivery-jobs/:jobId/execute", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const { jobId } = request.params as { jobId: string };
    const result = await executeCompanySheetsDeliveryJob(jobId, deps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, status: result.status, rowsWritten: result.rowsWritten });
  });

  app.post("/company-sheets/delivery-jobs/:jobId/release-hold", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { confirmation?: unknown };
    const result = await releaseCompanySheetsDeliveryHold(
      jobId,
      typeof body.confirmation === "string" ? body.confirmation : "",
      deps
    );
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, status: result.status });
  });
};

export const clientCompanySheetsDeliveryRoutes: FastifyPluginAsync<CompanySheetsDeliveryRouteOptions> = async (
  app,
  opts
) => {
  const requireTenant = opts.requirePortalTenant ?? requireAuthenticatedPortalTenant;
  const deps = opts.deps ?? {};

  app.get("/lead-orders/:orderId/google-sheets-delivery", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    if (clientAccountIdSupplied(request.query) || clientAccountIdSupplied(request.body)) {
      return reply.status(400).send({ ok: false, error: "clientAccountId cannot be supplied" });
    }
    const { orderId } = request.params as { orderId: string };
    const evidence = await getCompanySheetsOrderEvidenceForClient(
      { clientAccountId: tenant.clientAccountId, leadOrderId: orderId },
      deps
    );
    return reply.send({
      ok: true,
      evidence,
      usesCurrentDestination: false,
      portalLinkGrantsGoogleAccess: false,
    });
  });
};
