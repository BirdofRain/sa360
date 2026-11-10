/**
 * Admin-only intended GoHighLevel destination configuration.
 *
 * GET and POST /admin/v1/clients/:clientAccountId/ghl-destination-configuration
 *
 * Requires the admin API key. SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED
 * must be the exact string true. A portal key, portal assertion, or workspace
 * key is rejected before that key is accepted. The path stays off the observer
 * allowlist.
 *
 * These routes store a configuration request. They do not update
 * ClientGhlDestination, enroll a contact, create a delivery run, or edit a
 * routing rule.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { isGhlDestinationConfigRequestEnabled } from "../lib/ghl-destination-config-request-env.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  readGhlDestinationConfigHead,
  recordGhlDestinationConfigRequest,
  type GhlDestinationConfigFailure,
  type GhlDestinationConfigResult,
} from "../services/ghl-destination-config-request.js";
import { TEAM_WORKSPACE_CLIENT_ID } from "../services/team-workspace/team-workspace-read.js";

const bodySchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    expectedDestinationUpdatedAt: z.string().datetime().nullable(),
    locationId: z.string().trim().min(1).max(200),
    workflowId: z.string().trim().min(1).max(200),
    fieldMappings: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(80),
            fieldId: z.string().trim().min(1).max(200),
          })
          .strict()
      )
      .max(40),
  })
  .strict();

export type GhlDestinationConfigRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

export const adminGhlDestinationConfigRequestRoutes: FastifyPluginAsync<GhlDestinationConfigRouteOptions> = async (
  app,
  opts
) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;

  app.get("/clients/:clientAccountId/ghl-destination-configuration", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const read = await readGhlDestinationConfigHead(db, clientAccountId, env);
    if (!read.ok) return sendFailure(reply, read);
    return reply.send(read);
  });

  app.post("/clients/:clientAccountId/ghl-destination-configuration", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const saved = await recordGhlDestinationConfigRequest(db, { ...parsed.data, clientAccountId }, env);
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
  if (!isGhlDestinationConfigRequestEnabled(env)) {
    await reply.status(404).send({ ok: false, error: "ghl_destination_config_request_disabled" });
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

function sendFailure(reply: FastifyReply, result: GhlDestinationConfigFailure | GhlDestinationConfigResult) {
  if (result.ok) return reply.send(result);
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.error === "feature_disabled" ? "ghl_destination_config_request_disabled" : result.error,
    replayed: false,
    requestId: result.requestId,
    revision: result.revision,
    destinationUpdated: false,
    deliveryArmed: false,
    enrollmentPerformed: false,
    routingChanged: false,
    liveDestinationChanged: false,
  });
}
