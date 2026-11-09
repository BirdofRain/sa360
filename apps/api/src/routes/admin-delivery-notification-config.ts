/**
 * Admin C.O.C. notification configuration.
 *
 * GET /admin/v1/clients/:clientAccountId/delivery-notification-recipient
 * PUT /admin/v1/clients/:clientAccountId/delivery-notification-recipient
 * PUT /admin/v1/team-workspace/clients/:clientAccountId/delivery-notification
 *
 * Both routes require the admin API key and SA360_TEAM_WORKSPACE_ENABLED
 * equal to the exact string true. A portal key, portal assertion, or
 * x-sa360-workspace-key is rejected before that key is accepted.
 *
 * These routes do not send email, arm GoHighLevel, Sheets, or a custom
 * webhook, activate the scanner, or write a client lead.
 *
 * Rebase note: PR #292 registers the Team Workspace read from app.ts and
 * defines the same exact-true gate in team-workspace-read.ts. This module
 * stays separate. Keep both app.ts registrations when that branch lands.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { isTeamWorkspaceApiEnabled } from "../lib/team-workspace-env.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { prisma } from "../lib/db.js";
import {
  configureDeliveryNotificationPreference,
  configureDeliveryNotificationRecipient,
  readDeliveryNotificationRecipient,
  type DeliveryNotificationConfigFailure,
} from "../services/delivery-success-notification/delivery-notification-config.js";

/** Same shape as the Team Workspace client id: one segment, no dots or slashes. */
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const recipientSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    recipientEmail: z.string().min(1).max(320),
  })
  .strict();

const preferenceSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean(),
  })
  .strict();

export type DeliveryNotificationConfigRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

export const adminDeliveryNotificationConfigRoutes: FastifyPluginAsync<
  DeliveryNotificationConfigRouteOptions
> = async (app, opts) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;

  app.get("/clients/:clientAccountId/delivery-notification-recipient", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const read = await readDeliveryNotificationRecipient(db, clientAccountId);
    if (!read.ok) return sendFailure(reply, read);
    return reply.send(read);
  });

  app.put("/clients/:clientAccountId/delivery-notification-recipient", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = recipientSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const saved = await configureDeliveryNotificationRecipient(db, {
      clientAccountId,
      requestId: parsed.data.requestId,
      expectedRevision: parsed.data.expectedRevision,
      recipientEmail: parsed.data.recipientEmail,
    });
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.send({
      ok: true,
      replayed: saved.replayed,
      clientAccountId: saved.clientAccountId,
      recipientEmail: saved.recipientEmail,
      recipientVerified: saved.recipientVerified,
      recipientEmailVerifiedAt: saved.recipientEmailVerifiedAt,
      enabled: saved.enabled,
      enabledAt: saved.enabledAt,
      disabledAt: saved.disabledAt,
      revision: saved.revision,
      channel: saved.channel,
    });
  });

  app.put("/team-workspace/clients/:clientAccountId/delivery-notification", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const parsed = preferenceSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const saved = await configureDeliveryNotificationPreference(db, {
      clientAccountId,
      requestId: parsed.data.requestId,
      expectedRevision: parsed.data.expectedRevision,
      enabled: parsed.data.enabled,
    });
    if (!saved.ok) return sendFailure(reply, saved);
    return reply.send({
      ok: true,
      replayed: saved.replayed,
      clientAccountId: saved.clientAccountId,
      enabled: saved.enabled,
      recipientVerified: saved.recipientVerified,
      enabledAt: saved.enabledAt,
      disabledAt: saved.disabledAt,
      revision: saved.revision,
      channel: saved.channel,
    });
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
  if (!isTeamWorkspaceApiEnabled(env)) {
    await reply.status(404).send({ ok: false, error: "team_workspace_disabled" });
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
  if (!clientAccountId || !CLIENT_ID.test(clientAccountId)) return null;
  return clientAccountId;
}

function sendFailure(reply: FastifyReply, result: DeliveryNotificationConfigFailure) {
  return reply.status(result.statusCode).send({
    ok: false,
    error: result.error,
    replayed: result.replayed,
  });
}
