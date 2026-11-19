/**
 * Admin-only request registry for several campaigns on one client.
 *
 * GET  /admin/v1/clients/:clientAccountId/campaigns
 * GET  /admin/v1/clients/:clientAccountId/campaigns/:campaignId
 * POST /admin/v1/clients/:clientAccountId/campaigns
 * POST /admin/v1/clients/:clientAccountId/campaigns/:campaignId
 * POST /admin/v1/clients/:clientAccountId/campaigns/:campaignId/source-bindings
 * POST /admin/v1/clients/:clientAccountId/campaigns/:campaignId/destination-selection
 *
 * Requires the admin API key. SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED must be
 * the exact string true. A portal key, portal assertion, or workspace key is
 * rejected before that key is accepted. The path stays off the observer allowlist.
 *
 * These routes store a request. They do not confirm a source, create or edit
 * a routing rule, change a destination, or arm delivery. The read-only campaign
 * inventory is a different route and stays available when this flag is off.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient, SourceLeadProvider } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isClientCampaignRegistryEnabled } from "../lib/client-campaign-registry-env.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { resolveOnboardingStaffActor } from "../lib/onboarding-staff-actor.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  createClientCampaign,
  listClientCampaigns,
  readClientCampaign,
  saveClientCampaignBindings,
  saveClientCampaignDestination,
  updateClientCampaign,
  type RegistryCommandResult,
} from "../services/client-campaign-registry/client-campaign-registry.js";
import { isCampaignNicheKey, isCampaignProductType } from "../services/client-campaign-registry/identity.js";
import { TEAM_WORKSPACE_CLIENT_ID } from "../services/team-workspace/team-workspace-read.js";

const CAMPAIGN_ID = /^c[a-z0-9]{24}$/;
const SLUG = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const DISPLAY_NAME = z.string().trim().min(1).max(120);
const NICHE = z.string().refine(isCampaignNicheKey);
const PRODUCT = z.string().refine(isCampaignProductType);
const OPTIONAL_ID = z.string().trim().min(1).max(200).nullable();
const OPTIONAL_URL = z.string().trim().min(1).max(500).nullable();
const PROVIDERS = ["leadcapture_io", "facebook", "goat_leads", "manual_import", "google_sheets"] as const;

const createSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    intent: z.literal("create"),
    slug: SLUG,
    displayName: DISPLAY_NAME,
    nicheKey: NICHE,
    productType: PRODUCT,
  })
  .strict();

const updateSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    intent: z.literal("update"),
    displayName: DISPLAY_NAME,
    nicheKey: NICHE,
    productType: PRODUCT,
    status: z.enum(["draft", "review", "ready"]),
  })
  .strict();

const bindingSchema = z
  .object({
    bindingKey: SLUG,
    requestedStatus: z.enum(["suggested", "recorded", "approved"]),
    sourceFunnelId: OPTIONAL_ID,
    campaignRoutingRuleId: OPTIONAL_ID,
    provider: z.enum(PROVIDERS).nullable(),
    providerFunnelId: OPTIONAL_ID,
    parentUrlKey: OPTIONAL_URL,
    campaignId: OPTIONAL_ID,
    formId: OPTIONAL_ID,
    adsetId: OPTIONAL_ID,
    adId: OPTIONAL_ID,
    evidence: z
      .object({
        note: z.string().trim().max(500).nullable(),
        observedLabel: z.string().trim().max(200).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const bindingsSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    intent: z.literal("save_bindings"),
    bindings: z.array(bindingSchema).max(20),
  })
  .strict();

const destinationSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    intent: z.literal("save_destination"),
    workflowIdGhl: OPTIONAL_ID,
    workflowTriggerMode: z.enum(["none", "direct_api", "tag_trigger"]).nullable(),
    ghlLocationId: OPTIONAL_ID,
    spreadsheetId: OPTIONAL_ID,
    worksheetId: z.number().int().nonnegative().nullable(),
    worksheetTitle: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

export type ClientCampaignRegistryRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

export const adminClientCampaignRegistryRoutes: FastifyPluginAsync<ClientCampaignRegistryRouteOptions> = async (
  app,
  opts
) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;

  app.get("/clients/:clientAccountId/campaigns", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    const listed = await listClientCampaigns(db, clientAccountId, env);
    if (!listed.ok) return sendFailure(reply, listed);
    return reply.send(listed);
  });

  app.get("/clients/:clientAccountId/campaigns/:campaignId", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const campaignId = pathCampaign(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    if (!campaignId) return reply.status(404).send(refused("campaign_not_found"));
    const read = await readClientCampaign(db, clientAccountId, campaignId, env);
    if (!read.ok) return sendFailure(reply, read);
    return reply.send(read);
  });

  app.post("/clients/:clientAccountId/campaigns", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const actor = await resolveOnboardingStaffActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send(refused(actor.error));
    const saved = await createClientCampaign(db, { ...parsed.data, clientAccountId }, env, actor.actor);
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.status(saved.statusCode).send(saved);
  });

  app.post("/clients/:clientAccountId/campaigns/:campaignId", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const campaignId = pathCampaign(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    if (!campaignId) return reply.status(404).send(refused("campaign_not_found"));
    const parsed = updateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const actor = await resolveOnboardingStaffActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send(refused(actor.error));
    const saved = await updateClientCampaign(db, { ...parsed.data, clientAccountId, campaignId }, env, actor.actor);
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.status(saved.statusCode).send(saved);
  });

  app.post("/clients/:clientAccountId/campaigns/:campaignId/source-bindings", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const campaignId = pathCampaign(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    if (!campaignId) return reply.status(404).send(refused("campaign_not_found"));
    const parsed = bindingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const actor = await resolveOnboardingStaffActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send(refused(actor.error));
    const saved = await saveClientCampaignBindings(
      db,
      {
        ...parsed.data,
        clientAccountId,
        campaignId,
        bindings: parsed.data.bindings.map((binding) => ({
          ...binding,
          provider: binding.provider as SourceLeadProvider | null,
        })),
      },
      env,
      actor.actor
    );
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.status(saved.statusCode).send(saved);
  });

  app.post("/clients/:clientAccountId/campaigns/:campaignId/destination-selection", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const campaignId = pathCampaign(request);
    if (!clientAccountId) return reply.status(404).send(refused("client_not_found"));
    if (!campaignId) return reply.status(404).send(refused("campaign_not_found"));
    const parsed = destinationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(refused("invalid_body"));
    const actor = await resolveOnboardingStaffActor(request.headers, db, env);
    if (!actor.ok) return reply.status(actor.statusCode).send(refused(actor.error));
    const saved = await saveClientCampaignDestination(db, { ...parsed.data, clientAccountId, campaignId }, env, actor.actor);
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.status(saved.statusCode).send(saved);
  });
};

async function authorize(request: FastifyRequest, reply: FastifyReply, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send(refused("forbidden"));
    return false;
  }
  const allowed = await verifyAdminApiKey(request, reply);
  if (!allowed) return false;
  if (!isClientCampaignRegistryEnabled(env)) {
    await reply.status(404).send(refused("client_campaign_registry_disabled"));
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

function pathCampaign(request: FastifyRequest): string | null {
  const { campaignId } = request.params as { campaignId?: string };
  if (!campaignId || !CAMPAIGN_ID.test(campaignId)) return null;
  return campaignId;
}

function refused(error: string) {
  return {
    ok: false,
    error: error === "feature_disabled" ? "client_campaign_registry_disabled" : error,
    replayed: false,
    routingRuleApplied: false,
    sourceConfirmed: false,
    deliveryArmed: false,
    externalCall: false,
    inventoryKeyUsed: false,
    operationalReady: false,
    originConfirmed: false,
  };
}

function sendFailure(reply: FastifyReply, result: RegistryCommandResult) {
  const error = result.error === "feature_disabled" ? "client_campaign_registry_disabled" : result.error;
  return reply.status(result.statusCode).send({ ...result, ok: false, error });
}
