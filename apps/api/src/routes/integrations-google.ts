import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { requireAuthenticatedPortalTenant } from "../lib/client-portal-session-assertion.js";
import {
  disconnectGoogleOAuth,
  getGoogleOAuthStatus,
  handleGoogleOAuthCallback,
  startGoogleOAuth,
  type GoogleOAuthRuntimeDeps,
} from "../services/google-oauth/google-oauth-http.service.js";
import {
  createSa360SpreadsheetForClient,
  deleteGoogleSheetsDestinationForClient,
  getGoogleSheetsDestinationForClient,
  resolveGoogleSpreadsheetForClient,
  saveGoogleSheetsDestinationForClient,
  testGoogleSheetAccessForClient,
  type GoogleSheetsDestinationDeps,
  type GoogleSheetsDestinationFailure,
} from "../services/google-sheets/google-sheets-destination.service.js";

export type GoogleIntegrationRoutesOptions = {
  runtimeDeps?: GoogleOAuthRuntimeDeps;
  sheetsDeps?: GoogleSheetsDestinationDeps;
  requirePortalTenant?: typeof requireAuthenticatedPortalTenant;
};

function clientAccountIdSupplied(source: unknown): boolean {
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  return Object.prototype.hasOwnProperty.call(source, "clientAccountId");
}

function rejectBrowserClientAccountId(source: unknown, reply: FastifyReply): boolean {
  if (!clientAccountIdSupplied(source)) return false;
  void reply.status(400).send({
    ok: false,
    error: "clientAccountId cannot be supplied",
  });
  return true;
}

function sendSheetsFailure(reply: FastifyReply, result: GoogleSheetsDestinationFailure) {
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.code,
    retryable: result.retryable,
  });
}

export const clientGoogleIntegrationRoutes: FastifyPluginAsync<
  GoogleIntegrationRoutesOptions
> = async (app, opts) => {
  const requireTenant = opts.requirePortalTenant ?? requireAuthenticatedPortalTenant;
  const deps = opts.runtimeDeps ?? {};
  const sheetsDeps = opts.sheetsDeps ?? {};

  app.get("/integrations/google/oauth/start", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const query = request.query as { returnTo?: string; clientAccountId?: string };
    if (rejectBrowserClientAccountId(query, reply)) return;
    const result = await startGoogleOAuth(tenant.clientAccountId, query.returnTo, deps);
    if (!result.ok) {
      return reply.status(result.statusCode).send({ ok: false, error: result.code });
    }
    return reply.redirect(result.authorizeUrl);
  });

  app.get("/integrations/google/status", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    if (rejectBrowserClientAccountId(request.query, reply)) return;
    return reply.send({
      ok: true,
      connection: await getGoogleOAuthStatus(tenant.clientAccountId, deps),
    });
  });

  app.post("/integrations/google/disconnect", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    if (rejectBrowserClientAccountId(request.body ?? {}, reply)) return;
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

  app.post("/integrations/google/sheets/resolve", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const body = (request.body ?? {}) as { spreadsheet?: unknown; clientAccountId?: unknown };
    if (rejectBrowserClientAccountId(body, reply)) return;
    const result = await resolveGoogleSpreadsheetForClient(
      tenant.clientAccountId,
      body.spreadsheet,
      sheetsDeps
    );
    if (!result.ok) return sendSheetsFailure(reply, result);
    return reply.send({ ok: true, spreadsheet: result.spreadsheet });
  });

  app.post("/integrations/google/sheets/create", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const body = (request.body ?? {}) as { title?: unknown; clientAccountId?: unknown };
    if (rejectBrowserClientAccountId(body, reply)) return;
    const result = await createSa360SpreadsheetForClient(
      tenant.clientAccountId,
      body.title,
      sheetsDeps
    );
    if (!result.ok) return sendSheetsFailure(reply, result);
    return reply.send({ ok: true, spreadsheet: result.spreadsheet });
  });

  app.post("/integrations/google/sheets/test", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const body = (request.body ?? {}) as {
      spreadsheetId?: unknown;
      worksheetId?: unknown;
      clientAccountId?: unknown;
    };
    if (rejectBrowserClientAccountId(body, reply)) return;
    const result = await testGoogleSheetAccessForClient(
      tenant.clientAccountId,
      { spreadsheetId: body.spreadsheetId, worksheetId: body.worksheetId },
      sheetsDeps
    );
    if (!result.ok) return sendSheetsFailure(reply, result);
    return reply.send(result.result);
  });

  app.put("/integrations/google/sheets/destination", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    const body = (request.body ?? {}) as {
      spreadsheetId?: unknown;
      worksheetId?: unknown;
      clientAccountId?: unknown;
    };
    if (rejectBrowserClientAccountId(body, reply)) return;
    // Only the spreadsheet reference is read. Provenance (`createdBySa360`) and
    // target flags (`enabled`, `isRequired`) are server-derived, never client input.
    const result = await saveGoogleSheetsDestinationForClient(
      tenant.clientAccountId,
      {
        spreadsheetId: body.spreadsheetId,
        worksheetId: body.worksheetId,
      },
      sheetsDeps
    );
    if (!result.ok) return sendSheetsFailure(reply, result);
    return reply.send({ ok: true, destination: result.destination });
  });

  app.get("/integrations/google/sheets/destination", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    if (rejectBrowserClientAccountId(request.query, reply)) return;
    const result = await getGoogleSheetsDestinationForClient(
      tenant.clientAccountId,
      sheetsDeps
    );
    return reply.send({ ok: true, destination: result.destination });
  });

  app.delete("/integrations/google/sheets/destination", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    if (rejectBrowserClientAccountId(request.body ?? {}, reply)) return;
    if (rejectBrowserClientAccountId(request.query, reply)) return;
    const result = await deleteGoogleSheetsDestinationForClient(
      tenant.clientAccountId,
      sheetsDeps
    );
    if (!result.ok) return sendSheetsFailure(reply, result);
    return reply.send({ ok: true, destination: result.destination });
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
