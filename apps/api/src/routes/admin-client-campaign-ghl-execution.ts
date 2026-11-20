/**
 * Admin-only campaign GHL grants and preparation.
 *
 * POST /admin/v1/clients/:clientAccountId/campaign-ghl-grants
 * POST /admin/v1/clients/:clientAccountId/campaign-ghl-grants/:grantId/revoke
 * POST /admin/v1/clients/:clientAccountId/campaign-ghl-preparation
 *
 * SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED must be the exact string true.
 * These routes do not enroll a workflow, post a tag, create an opportunity,
 * or write a Sheet. A request body cannot supply the acting admin.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { resolveCampaignGhlGrantActor } from "../lib/campaign-ghl-grant-actor.js";
import { isClientCampaignGhlExecutionEnabled } from "../lib/client-campaign-ghl-execution-env.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  issueCampaignGhlExecutionGrant,
  revokeCampaignGhlExecutionGrant,
} from "../services/client-campaign-ghl-delivery/campaign-ghl-execution-grant.js";
import { prepareCampaignGhlDelivery } from "../services/client-campaign-ghl-delivery/prepare-campaign-ghl-delivery.js";
import type { WorkflowDiscoveryEvidence } from "../services/client-campaign-ghl-delivery/campaign-ghl-workflow-verification.js";
import { TEAM_WORKSPACE_CLIENT_ID } from "../services/team-workspace/team-workspace-read.js";

const ID = /^c[a-z0-9]{24}$/;

const issueSchema = z
  .object({
    requestId: z.string().uuid(),
    sourceLeadEventId: z.string().regex(ID),
    clientCampaignId: z.string().regex(ID),
    expectedDecisionVersion: z.number().int().positive(),
    expectedCampaignRevision: z.number().int().positive(),
    expectedWorkflowId: z.string().trim().min(1).max(200),
    expectedLocationId: z.string().trim().min(1).max(200),
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();

const revokeSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
  })
  .strict();

const prepareSchema = z
  .object({
    sourceLeadEventId: z.string().regex(ID),
  })
  .strict();

export type CampaignGhlExecutionRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  readEvidence?: (locationId: string) => Promise<WorkflowDiscoveryEvidence>;
};

export const adminClientCampaignGhlExecutionRoutes: FastifyPluginAsync<CampaignGhlExecutionRouteOptions> = async (
  app,
  opts
) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;

  app.post("/clients/:clientAccountId/campaign-ghl-grants", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    const parsed = issueSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const actor = await resolveCampaignGhlGrantActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send(refused(actor.error));
    const issued = await issueCampaignGhlExecutionGrant(
      db,
      {
        ...parsed.data,
        clientAccountId,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
      actor.actor,
      opts.now?.() ?? new Date()
    );
    if (!issued.ok) return reply.status(issued.error === "grant_conflict" ? 409 : 422).send(issued);
    return reply.status(issued.replayed ? 200 : 201).send(issued);
  });

  app.post("/clients/:clientAccountId/campaign-ghl-grants/:grantId/revoke", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const grantId = pathGrant(request);
    if (!clientAccountId || !grantId) return reply.status(404).send(refused("grant_not_found"));
    const parsed = revokeSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const actor = await resolveCampaignGhlGrantActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send(refused(actor.error));
    const revoked = await revokeCampaignGhlExecutionGrant(
      db,
      { grantId, clientAccountId, reason: parsed.data.reason },
      actor.actor,
      opts.now?.() ?? new Date()
    );
    if (!revoked.ok) return reply.status(revoked.error === "grant_not_found" ? 404 : 422).send(revoked);
    return reply.send(revoked);
  });

  app.post("/clients/:clientAccountId/campaign-ghl-preparation", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    const parsed = prepareSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const prepared = await prepareCampaignGhlDelivery(db, {
      clientAccountId,
      sourceLeadEventId: parsed.data.sourceLeadEventId,
      env,
      now: opts.now?.(),
      readEvidence: opts.readEvidence,
    });
    return reply.send({
      ok: true,
      ...prepared,
      externalCall: false,
    });
  });
};

async function authorize(request: FastifyRequest, reply: FastifyReply, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send(refused("forbidden"));
    return false;
  }
  const allowed = await verifyAdminApiKey(request, reply);
  if (!allowed) return false;
  if (!isClientCampaignGhlExecutionEnabled(env)) {
    await reply.status(404).send(refused("campaign_ghl_execution_disabled"));
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

function pathGrant(request: FastifyRequest): string | null {
  const { grantId } = request.params as { grantId?: string };
  if (!grantId || !ID.test(grantId)) return null;
  return grantId;
}

function refused(error: string) {
  return {
    ok: false,
    error,
    replayed: false,
    executionStarted: false,
    externalCall: false,
    shadowExecutionAuthorized: false,
  };
}
