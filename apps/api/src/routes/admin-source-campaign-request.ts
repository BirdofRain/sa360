/**
 * Admin-only source and campaign association requests.
 *
 * GET and POST /admin/v1/clients/:clientAccountId/source-campaign-requests
 *
 * Requires the admin API key. SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED must be
 * the exact string true. A portal key, portal assertion, or workspace key is
 * rejected before that key is accepted. The path stays off the observer allowlist.
 *
 * These routes record a proposal. They do not confirm a SourceFunnel, create
 * or edit a CampaignRoutingRule, stamp inventory, or arm delivery.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { isSourceCampaignRequestEnabled } from "../lib/source-campaign-request-env.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  readSourceCampaignAssociationHead,
  recordSourceCampaignAssociationRequest,
  type SourceCampaignRequestFailure,
  type SourceCampaignRequestResult,
} from "../services/source-intake/source-campaign-association-request.js";
import { TEAM_WORKSPACE_CLIENT_ID } from "../services/team-workspace/team-workspace-read.js";

const shortIdentifier = z.string().trim().min(1).max(200).nullable();
const parentUrlIdentifier = z.string().trim().min(1).max(500).nullable();

const requestSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    setupRevision: z.number().int().nonnegative(),
    intent: z.literal("request"),
    providerFunnelId: shortIdentifier,
    parentUrlKey: parentUrlIdentifier,
    providerCampaignId: shortIdentifier,
  })
  .strict();

const rejectSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    setupRevision: z.number().int().nonnegative(),
    intent: z.literal("reject"),
  })
  .strict();

const bodySchema = z.discriminatedUnion("intent", [requestSchema, rejectSchema]);

export type SourceCampaignRequestRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

export const adminSourceCampaignRequestRoutes: FastifyPluginAsync<SourceCampaignRequestRouteOptions> = async (
  app,
  opts
) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;

  app.get("/clients/:clientAccountId/source-campaign-requests", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const read = await readSourceCampaignAssociationHead(db, clientAccountId, env);
    if (!read.ok) return sendFailure(reply, read);
    return reply.send(read);
  });

  app.post("/clients/:clientAccountId/source-campaign-requests", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const saved = await recordSourceCampaignAssociationRequest(
      db,
      { ...parsed.data, clientAccountId },
      env
    );
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
  if (!isSourceCampaignRequestEnabled(env)) {
    await reply.status(404).send({ ok: false, error: "source_campaign_request_disabled" });
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

function sendFailure(reply: FastifyReply, result: SourceCampaignRequestFailure | SourceCampaignRequestResult) {
  if (result.ok) return reply.send(result);
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.error === "feature_disabled" ? "source_campaign_request_disabled" : result.error,
    replayed: result.replayed,
    status: result.status,
    requestId: result.requestId,
    associationRequestId: result.associationRequestId,
    revision: result.revision,
    associationApplied: false,
    routingRuleApplied: false,
    deliveryArmed: false,
    confirmedOperationalAssociation: false,
  });
}
