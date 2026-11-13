/**
 * Read the persisted onboarding actor for one request id.
 *
 * GET /admin/v1/clients/:clientAccountId/onboarding-attribution/:requestId
 *
 * Requires the admin API key. A portal key, portal assertion, or workspace
 * key is rejected before that key is accepted. The path stays off the
 * observer allowlist. The read is not gated by the setup or configuration
 * request flags, and it does not insert or update a row.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { prisma } from "../lib/db.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import {
  readOnboardingAttribution,
  type OnboardingAttributionResult,
} from "../services/onboarding-attribution-read.js";

type RouteOptions = {
  db?: PrismaClient;
};

export const adminOnboardingAttributionRoutes: FastifyPluginAsync<RouteOptions> = async (app, opts) => {
  const db = opts.db ?? prisma;

  app.get("/clients/:clientAccountId/onboarding-attribution/:requestId", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const { clientAccountId, requestId } = request.params as {
      clientAccountId?: string;
      requestId?: string;
    };
    const result = await readOnboardingAttribution(db, clientAccountId ?? "", requestId ?? "");
    return send(reply, result);
  });
};

async function authorize(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send({ ok: false, error: "forbidden" });
    return false;
  }
  return verifyAdminApiKey(request, reply);
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

function send(reply: FastifyReply, result: OnboardingAttributionResult) {
  if (!result.ok) {
    return reply.status(result.statusCode).send({ ok: false, error: result.error });
  }
  return reply.send({
    ok: true,
    clientAccountId: result.clientAccountId,
    recordType: result.recordType,
    recordId: result.recordId,
    requestId: result.requestId,
    actor: result.actor,
  });
}
