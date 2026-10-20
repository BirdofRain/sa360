import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { requireAuthenticatedPortalTenant } from "../lib/client-portal-session-assertion.js";
import {
  disconnectCompanyGoogleOAuth,
  getCompanyGoogleOAuthStatus,
  handleCompanyGoogleOAuthCallback,
  startCompanyGoogleOAuth,
  type CompanyGoogleOAuthDeps,
} from "../services/company-google/company-google-oauth.service.js";
import {
  clearVerifiedCompanyDestinationFolder,
  createCompanySpreadsheetForClient,
  deleteCompanySheetsDestinationForClient,
  getCompanySheetsDestinationForClient,
  presentCompanySheetsPortal,
  resolveCompanySpreadsheetForClient,
  saveCompanySheetsDestinationForClient,
  testCompanySheetAccessForClient,
  verifyCompanyDestinationFolder,
  type CompanySheetsDeps,
  type CompanySheetsFailure,
} from "../services/company-google/company-sheets-destination.service.js";

export type CompanyGoogleRouteOptions = {
  oauthDeps?: CompanyGoogleOAuthDeps;
  sheetsDeps?: CompanySheetsDeps;
  requirePortalTenant?: typeof requireAuthenticatedPortalTenant;
};

function sendFailure(reply: FastifyReply, result: CompanySheetsFailure) {
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.code,
    retryable: result.retryable,
  });
}

function actorFrom(request: FastifyRequest): string {
  const raw = request.headers["x-sa360-admin-actor"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : "admin_api";
}

function clientAccountIdSupplied(source: unknown): boolean {
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  return Object.prototype.hasOwnProperty.call(source, "clientAccountId");
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export const adminCompanyGoogleSheetsRoutes: FastifyPluginAsync<CompanyGoogleRouteOptions> = async (
  app,
  opts
) => {
  const oauthDeps = opts.oauthDeps ?? {};
  const sheetsDeps = opts.sheetsDeps ?? {};

  app.get("/integrations/google/company", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return reply.send({ ok: true, connection: await getCompanyGoogleOAuthStatus(oauthDeps) });
  });

  app.get("/integrations/google/company/oauth/start", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = request.query as { returnTo?: string };
    const result = await startCompanyGoogleOAuth(
      { returnTo: query.returnTo, initiatedBy: actorFrom(request) },
      oauthDeps
    );
    if (!result.ok) return reply.status(result.statusCode).send({ ok: false, error: result.code });
    return reply.send({ ok: true, authorizeUrl: result.authorizeUrl });
  });

  app.post("/integrations/google/company/disconnect", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const result = await disconnectCompanyGoogleOAuth(oauthDeps);
    if (!result.ok) {
      return reply.status(result.statusCode).send({ ok: false, error: result.code });
    }
    return reply.send({ ok: true, connection: result.connection, revokeResult: result.revokeResult });
  });

  app.put("/integrations/google/company/folder", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = (request.body ?? {}) as { folder?: unknown };
    const result = await verifyCompanyDestinationFolder(body.folder, sheetsDeps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({
      ok: true,
      connection: result.connection,
      existingSpreadsheetsRemainInPlace: true,
    });
  });

  app.delete("/integrations/google/company/folder", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const result = await clearVerifiedCompanyDestinationFolder(sheetsDeps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, connection: result.connection, existingSpreadsheetsRemainInPlace: true });
  });

  app.get("/clients/:clientAccountId/google-sheets/destination", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const result = await getCompanySheetsDestinationForClient(clientAccountId, sheetsDeps);
    return reply.send({ ok: true, destination: result.destination });
  });

  app.post("/clients/:clientAccountId/google-sheets/resolve", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const body = (request.body ?? {}) as { spreadsheet?: unknown };
    const result = await resolveCompanySpreadsheetForClient(clientAccountId, body.spreadsheet, sheetsDeps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, spreadsheet: result.spreadsheet });
  });

  app.post("/clients/:clientAccountId/google-sheets/create", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const body = (request.body ?? {}) as { title?: unknown };
    const result = await createCompanySpreadsheetForClient(
      clientAccountId,
      body.title,
      actorFrom(request),
      sheetsDeps
    );
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, spreadsheet: result.spreadsheet });
  });

  app.post("/clients/:clientAccountId/google-sheets/test", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const body = (request.body ?? {}) as { spreadsheetId?: unknown; worksheetId?: unknown };
    const result = await testCompanySheetAccessForClient(
      clientAccountId,
      { spreadsheetId: body.spreadsheetId, worksheetId: body.worksheetId },
      sheetsDeps
    );
    if (!result.ok) return sendFailure(reply, result);
    return reply.send(result.result);
  });

  app.put("/clients/:clientAccountId/google-sheets/destination", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const body = (request.body ?? {}) as {
      spreadsheetId?: unknown;
      worksheetId?: unknown;
      intendedRecipientEmail?: unknown;
    };
    const result = await saveCompanySheetsDestinationForClient(
      clientAccountId,
      {
        spreadsheetId: body.spreadsheetId,
        worksheetId: body.worksheetId,
        intendedRecipientEmail: body.intendedRecipientEmail,
      },
      actorFrom(request),
      sheetsDeps
    );
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, destination: result.destination });
  });

  app.delete("/clients/:clientAccountId/google-sheets/destination", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const result = await deleteCompanySheetsDestinationForClient(clientAccountId, sheetsDeps);
    if (!result.ok) return sendFailure(reply, result);
    return reply.send({ ok: true, destination: null });
  });
};

export const clientCompanySheetsReadRoutes: FastifyPluginAsync<CompanyGoogleRouteOptions> = async (
  app,
  opts
) => {
  const requireTenant = opts.requirePortalTenant ?? requireAuthenticatedPortalTenant;
  const sheetsDeps = opts.sheetsDeps ?? {};

  app.get("/integrations/google/company-sheets", async (request, reply) => {
    const tenant = await requireTenant(request, reply);
    if (!tenant) return;
    if (clientAccountIdSupplied(request.query)) {
      return reply.status(400).send({ ok: false, error: "clientAccountId cannot be supplied" });
    }
    const result = await getCompanySheetsDestinationForClient(tenant.clientAccountId, sheetsDeps);
    return reply.send({
      ok: true,
      destination: result.destination ? presentCompanySheetsPortal(result.destination) : null,
    });
  });
};

export const integrationsCompanyGoogleRoutes: FastifyPluginAsync<
  Pick<CompanyGoogleRouteOptions, "oauthDeps">
> = async (app, opts) => {
  const oauthDeps = opts.oauthDeps ?? {};
  app.get("/google/company/oauth/callback", async (request, reply) => {
    const query = request.query as { state?: string; code?: string; error?: string };
    const result = await handleCompanyGoogleOAuthCallback(
      { state: query.state, code: query.code, error: query.error },
      oauthDeps
    );
    if (result.kind === "redirect") return reply.redirect(result.url);
    return reply.status(result.statusCode).send({ ok: false, error: result.code });
  });
};
