/**
 * Admin configuration for an external webhook destination.
 *
 * GET  /admin/v1/clients/:clientAccountId/external-webhook
 * PUT  /admin/v1/clients/:clientAccountId/external-webhook
 * PUT  /admin/v1/clients/:clientAccountId/external-webhook/activation
 * POST /admin/v1/clients/:clientAccountId/external-webhook/preflight
 *
 * Admin key only. A portal key, portal assertion, workspace key, or
 * SA360_OBSERVER role header is rejected before that key is accepted.
 * These routes do not POST a lead, enable SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED,
 * or write Google Sheets or a native GHL destination.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  nodeExternalWebhookResolver,
  type ExternalWebhookResolver,
} from "../lib/external-webhook-url-policy.js";
import {
  preflightExternalWebhookDestination,
  readExternalWebhookDestination,
  saveExternalWebhookDestination,
  setExternalWebhookDestinationEnabled,
  type ExternalWebhookConfigFailure,
  type ExternalWebhookSaveResult,
} from "../services/external-webhook/external-webhook-config.js";

const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const OBSERVER_ROLE_HEADER = "x-sa360-admin-role";
/** Same value as Admin C.O.C. ADMIN_COC_ROLE_OBSERVER. This API has no observer session. */
const OBSERVER_ROLE = "SA360_OBSERVER";

const destinationBody = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    kind: z.enum(["ghl_inbound", "external_https"]),
    authMode: z.enum(["none", "hmac_sha256"]),
    endpointUrl: z.string().min(1).max(2048),
    signingSecret: z.string().max(512).optional(),
  })
  .strict();

const activationBody = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean(),
  })
  .strict();

const preflightBody = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    kind: z.enum(["ghl_inbound", "external_https"]),
    authMode: z.enum(["none", "hmac_sha256"]),
    endpointUrl: z.string().min(1).max(2048),
    signingSecret: z.string().max(512).optional(),
  })
  .strict();

export type ExternalWebhookConfigRouteOptions = {
  db?: PrismaClient;
  resolve?: ExternalWebhookResolver;
};

export const adminExternalWebhookConfigRoutes: FastifyPluginAsync<
  ExternalWebhookConfigRouteOptions
> = async (app, opts) => {
  const db = opts.db ?? prisma;
  const resolve = opts.resolve ?? nodeExternalWebhookResolver;

  app.get("/clients/:clientAccountId/external-webhook", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const read = await readExternalWebhookDestination(db, clientAccountId);
    if (!read.ok) return sendFailure(reply, read);
    return reply.send(read);
  });

  app.put("/clients/:clientAccountId/external-webhook", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = destinationBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const saved = await saveExternalWebhookDestination(db, { clientAccountId, ...parsed.data }, resolve);
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.send(publicSave(saved));
  });

  app.put("/clients/:clientAccountId/external-webhook/activation", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = activationBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const saved = await setExternalWebhookDestinationEnabled(db, { clientAccountId, ...parsed.data }, resolve);
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.send(publicSave(saved));
  });

  app.post("/clients/:clientAccountId/external-webhook/preflight", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = preflightBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const report = await preflightExternalWebhookDestination(db, { clientAccountId, ...parsed.data }, resolve);
    if (!report.ok) return sendFailure(reply, report);
    return reply.send(report);
  });
};

function publicSave(saved: Extract<ExternalWebhookSaveResult, { ok: true }>) {
  return {
    ok: true as const,
    replayed: saved.replayed,
    clientAccountId: saved.clientAccountId,
    kind: saved.kind,
    authMode: saved.authMode,
    hostname: saved.hostname,
    enabled: saved.enabled,
    revision: saved.revision,
    configurationValid: saved.configurationValid,
    primaryCrmConflict: saved.primaryCrmConflict,
  };
}

async function authorize(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send({ ok: false, error: "forbidden" });
    return false;
  }
  return verifyAdminApiKey(request, reply);
}

function foreignCredential(request: FastifyRequest): boolean {
  const role = headerValue(request, OBSERVER_ROLE_HEADER);
  return Boolean(
    headerValue(request, CLIENT_PORTAL_KEY_HEADER) ||
      headerValue(request, CLIENT_PORTAL_ASSERTION_HEADER) ||
      headerValue(request, WORKSPACE_KEY_HEADER) ||
      role === OBSERVER_ROLE
  );
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pathClient(request: FastifyRequest): string | null {
  const { clientAccountId } = request.params as { clientAccountId?: string };
  if (!clientAccountId || !CLIENT_ID.test(clientAccountId)) return null;
  return clientAccountId;
}

function sendFailure(reply: FastifyReply, result: ExternalWebhookConfigFailure) {
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.error,
    replayed: false,
    ...(result.code ? { code: result.code } : {}),
  });
}
