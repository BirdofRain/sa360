import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { requireAuthenticatedPortalTenant } from "../lib/client-portal-session-assertion.js";
import {
  disconnectGoogleOAuth,
  getGoogleOAuthStatus,
  handleGoogleOAuthCallback,
  startGoogleOAuth,
  type GoogleOAuthRuntimeDeps,
} from "../services/google-oauth/google-oauth-http.service.js";

export type GoogleIntegrationRoutesOptions = {
  runtimeDeps?: GoogleOAuthRuntimeDeps;
  requirePortalTenant?: typeof requireAuthenticatedPortalTenant;
};

export const clientGoogleIntegrationRoutes: FastifyPluginAsync<
  GoogleIntegrationRoutesOptions
> = async (app, opts) => {
  const requireTenant = opts.requirePortalTenant ?? requireAuthenticatedPortalTenant;
  const deps = opts.runtimeDeps ?? {};

  app.get("/integrations/google/oauth/start", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const query = request.query as { returnTo?: string; clientAccountId?: string };
    if (query.clientAccountId !== undefined) {
      return reply.status(400).send({
        ok: false,
        error: "clientAccountId cannot be supplied",
      });
    }
    const result = await startGoogleOAuth(tenant.clientAccountId, query.returnTo, deps);
    if (!result.ok) {
      return reply.status(result.statusCode).send({ ok: false, error: result.code });
    }
    return reply.redirect(result.authorizeUrl);
  });

  app.get("/integrations/google/status", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const query = request.query as { clientAccountId?: string };
    if (query.clientAccountId !== undefined) {
      return reply.status(400).send({
        ok: false,
        error: "clientAccountId cannot be supplied",
      });
    }
    return reply.send({
      ok: true,
      connection: await getGoogleOAuthStatus(tenant.clientAccountId, deps),
    });
  });

  app.post("/integrations/google/disconnect", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const body = (request.body ?? {}) as { clientAccountId?: string };
    if (body.clientAccountId !== undefined) {
      return reply.status(400).send({
        ok: false,
        error: "clientAccountId cannot be supplied",
      });
    }
    const result = await disconnectGoogleOAuth(tenant.clientAccountId, deps);
    if (!result.ok) {
      return reply.status(result.statusCode).send({
        ok: false,
        error: result.code,
        retryable: result.code === "revoke_retryable",
      });
    }
    return reply.send({
      ok: true,
      connection: result.status,
      revokeResult: result.revokeResult,
    });
  });
};

async function callbackHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: GoogleOAuthRuntimeDeps
) {
  const query = request.query as {
    state?: string;
    code?: string;
    error?: string;
    clientAccountId?: string;
  };
  const result = await handleGoogleOAuthCallback(
    { state: query.state, code: query.code, error: query.error },
    deps
  );
  if (result.kind === "redirect") return reply.redirect(result.url);
  return reply.status(result.statusCode).send({ ok: false, error: result.code });
}

export const integrationsGoogleRoutes: FastifyPluginAsync<
  Pick<GoogleIntegrationRoutesOptions, "runtimeDeps">
> = async (app, opts) => {
  const deps = opts.runtimeDeps ?? {};
  app.get("/google/oauth/callback", (request, reply) =>
    callbackHandler(request, reply, deps)
  );
};
