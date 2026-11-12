/**
 * Admin-only intended Company Sheets destination configuration.
 *
 * GET and POST /admin/v1/clients/:clientAccountId/company-sheets-destination-configuration
 *
 * Requires the admin API key. SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED
 * must be the exact string true. A portal key, portal assertion, or workspace
 * key is rejected before that key is accepted. The path stays off the observer
 * allowlist.
 *
 * These routes store a configuration request. They do not update
 * CompanySheetsDestination, change a tab contract, publish a column map,
 * create a Drive file, or enqueue delivery.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { resolveOnboardingStaffActor } from "../lib/onboarding-staff-actor.js";
import { isCompanySheetsConfigRequestEnabled } from "../lib/company-sheets-config-request-env.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  readCompanySheetsConfigHead,
  recordCompanySheetsConfigRequest,
  type CompanySheetsConfigDeps,
  type CompanySheetsConfigFailure,
  type CompanySheetsConfigResult,
} from "../services/company-sheets-config-request.js";
import { TEAM_WORKSPACE_CLIENT_ID } from "../services/team-workspace/team-workspace-read.js";

const bodySchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    expectedDestinationRevision: z.number().int().positive().nullable(),
    spreadsheetId: z.string().trim().min(1).max(500),
    worksheetId: z.number().int().nonnegative(),
  })
  .strict();

export type CompanySheetsConfigRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  /** Test hook. Production registration does not pass it. */
  deps?: CompanySheetsConfigDeps;
};

export const adminCompanySheetsConfigRequestRoutes: FastifyPluginAsync<CompanySheetsConfigRouteOptions> = async (
  app,
  opts
) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;
  const deps = opts.deps;

  app.get("/clients/:clientAccountId/company-sheets-destination-configuration", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const read = await readCompanySheetsConfigHead(db, clientAccountId, env);
    if (!read.ok) return sendFailure(reply, read);
    return reply.send(read);
  });

  app.post("/clients/:clientAccountId/company-sheets-destination-configuration", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const actor = await resolveOnboardingStaffActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send({ ok: false, error: actor.error });
    const saved = await recordCompanySheetsConfigRequest(db, { ...parsed.data, clientAccountId }, env, {
      ...deps,
      actor: actor.actor,
    });
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.send(saved);
  });
};

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send({ ok: false, error: "forbidden" });
    return false;
  }
  const allowed = await verifyAdminApiKey(request, reply);
  if (!allowed) return false;
  if (!isCompanySheetsConfigRequestEnabled(env)) {
    await reply.status(404).send({ ok: false, error: "company_sheets_config_request_disabled" });
    return false;
  }
  return true;
}

function foreignCredential(request: FastifyRequest): boolean {
  return Boolean(
    headerValue(request, CLIENT_PORTAL_KEY_HEADER) ||
      headerValue(request, CLIENT_PORTAL_ASSERTION_HEADER) ||
      headerValue(request, WORKSPACE_KEY_HEADER)
  );
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pathClient(request: FastifyRequest): string | null {
  const { clientAccountId } = request.params as { clientAccountId?: string };
  if (!clientAccountId || !TEAM_WORKSPACE_CLIENT_ID.test(clientAccountId)) return null;
  return clientAccountId;
}

function sendFailure(reply: FastifyReply, result: CompanySheetsConfigFailure | CompanySheetsConfigResult) {
  if (result.ok) return reply.send(result);
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.error === "feature_disabled" ? "company_sheets_config_request_disabled" : result.error,
    replayed: false,
    requestId: result.requestId,
    revision: result.revision,
    operationalWrite: false,
    destinationUpdated: false,
    dispatchChanged: false,
    driveChanged: false,
    tabContractChanged: false,
    columnMapPublished: false,
    deliveryArmed: false,
    routingChanged: false,
    fulfillmentChanged: false,
  });
}
