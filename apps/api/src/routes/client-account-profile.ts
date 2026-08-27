import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { verifyClientPortalApiKey } from "../lib/client-portal-auth.js";
import { frontOfficeQuerySchema } from "../schemas/front-office.schema.js";
import {
  clientAccountCompleteOnboardingBodySchema,
  clientAccountProfilePatchBodySchema,
} from "../schemas/client-account-profile.schema.js";
import {
  completeClientAccountOnboarding,
  getClientAccountProfile,
  patchClientAccountProfile,
  type ClientAccountProfileServiceDeps,
} from "../services/client-account-profile.service.js";
import {
  resolveClientPortalTenant,
  type ClientPortalTenantDeps,
} from "../services/client-portal-tenant.service.js";

export type ClientAccountProfileRoutesOptions = {
  tenantDeps?: ClientPortalTenantDeps;
  accountProfileDeps?: ClientAccountProfileServiceDeps;
};

function sendTenantError(
  reply: FastifyReply,
  resolved: { error: string; code: "NOT_FOUND" | "PORTAL_DISABLED" }
) {
  const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
  return reply.status(status).send({
    ok: false,
    error: resolved.error,
    code: resolved.code,
  });
}

export const clientAccountProfileRoutes: FastifyPluginAsync<
  ClientAccountProfileRoutesOptions
> = async (app, opts) => {
  const tenantDeps = opts.tenantDeps;
  const accountProfileDeps = opts.accountProfileDeps ?? {};

  app.get("/account", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) return sendTenantError(reply, resolved);

    const result = await getClientAccountProfile(
      resolved.tenant.clientAccountId,
      accountProfileDeps
    );
    if (!result.ok) {
      return reply.status(404).send({ ok: false, error: "Account not found" });
    }
    return reply.send({ ok: true, account: result.account });
  });

  app.patch("/account", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = clientAccountProfilePatchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) return sendTenantError(reply, resolved);

    const result = await patchClientAccountProfile(
      resolved.tenant.clientAccountId,
      parsed.data,
      accountProfileDeps
    );
    if (!result.ok) {
      return reply.status(404).send({ ok: false, error: "Account not found" });
    }
    return reply.send({ ok: true, account: result.account });
  });

  app.post("/account/complete-onboarding", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = clientAccountCompleteOnboardingBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) return sendTenantError(reply, resolved);

    const result = await completeClientAccountOnboarding(
      resolved.tenant.clientAccountId,
      parsed.data,
      accountProfileDeps
    );
    if (!result.ok && "notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Account not found" });
    }
    if (!result.ok && result.code === "ACCOUNT_NOT_ELIGIBLE") {
      return reply.status(409).send({
        ok: false,
        error: result.error,
        code: result.code,
        account: result.account,
      });
    }
    if (!result.ok && result.code === "PROFILE_INCOMPLETE") {
      return reply.status(400).send({
        ok: false,
        error: result.error,
        code: result.code,
        account: result.account,
        missingFields: result.missingFields,
      });
    }
    if (!result.ok) {
      return reply.status(400).send({ ok: false, error: "Unable to complete account setup" });
    }
    return reply.send({ ok: true, account: result.account });
  });
};
