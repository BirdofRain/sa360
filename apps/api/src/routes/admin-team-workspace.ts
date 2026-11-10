import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";
import { readSourceCampaignReview } from "../services/team-workspace/source-campaign-review-read.js";
import {
  TEAM_WORKSPACE_CLIENT_ID,
  isTeamWorkspaceApiEnabled,
  readTeamWorkspaceClient,
} from "../services/team-workspace/team-workspace-read.js";

export type TeamWorkspaceRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

/**
 * Read-only Team Workspace. Mounted once from app.ts at /admin/v1.
 * This path stays off the observer allowlist. There is no write route.
 */
export const adminTeamWorkspaceRoutes: FastifyPluginAsync<TeamWorkspaceRouteOptions> = async (app, opts) => {
  const db = opts.db ?? (await import("../lib/db.js")).prisma;
  const env = opts.env ?? process.env;

  app.get("/team-workspace/clients/:clientAccountId", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    if (!isTeamWorkspaceApiEnabled(env)) {
      return reply.status(404).send({ ok: false, error: "team_workspace_disabled" });
    }
    const clientAccountId = pathClient(request);
    if (!clientAccountId) {
      return reply.status(404).send({ ok: false, error: "client_not_found" });
    }
    const result = await readTeamWorkspaceClient(clientAccountId, db);
    if (!result.ok) return reply.status(result.statusCode).send({ ok: false, error: result.code });
    return reply.send(result.body);
  });

  app.get("/team-workspace/clients/:clientAccountId/source-campaign-review", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    if (!isTeamWorkspaceApiEnabled(env)) {
      return reply.status(404).send({ ok: false, error: "team_workspace_disabled" });
    }
    const clientAccountId = pathClient(request);
    if (!clientAccountId) {
      return reply.status(404).send({ ok: false, error: "client_not_found" });
    }
    const expected = readExpectedRevision(request);
    if (expected === "invalid") {
      return reply.status(400).send({ ok: false, error: "invalid_revision" });
    }
    const result = await readSourceCampaignReview(clientAccountId, db, { expectedRevision: expected, env });
    if (!result.ok) return reply.status(result.statusCode).send({ ok: false, error: result.code });
    return reply.send(result.body);
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

function readExpectedRevision(request: FastifyRequest): number | undefined | "invalid" {
  const raw = (request.query as { expectedRevision?: unknown }).expectedRevision;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return "invalid";
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : "invalid";
}

function pathClient(request: FastifyRequest): string | null {
  const { clientAccountId } = request.params as { clientAccountId?: string };
  if (!clientAccountId || !TEAM_WORKSPACE_CLIENT_ID.test(clientAccountId)) return null;
  return clientAccountId;
}
