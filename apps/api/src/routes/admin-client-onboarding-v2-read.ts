import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";
import {
  CLIENT_ONBOARDING_V2_CLIENT_ID,
  clientOnboardingV2DriveResolveSchema,
  clientOnboardingV2DriveSearchSchema,
  clientOnboardingV2DriveSpreadsheetsSchema,
  clientOnboardingV2SheetPreviewSchema,
} from "../schemas/client-onboarding-v2-read.schema.js";
import { isClientOnboardingV2ReadEnabled, readClientOnboardingSummary } from "../services/client-onboarding-v2/readiness.js";
import { readClientSourceProof } from "../services/client-onboarding-v2/source-proof.js";
import {
  listResolvedFolderSpreadsheets,
  previewOnboardingSpreadsheet,
  resolveOnboardingFolder,
  searchOnboardingDrive,
  type OnboardingSheetDeps,
} from "../services/client-onboarding-v2/sheet-preview.js";
import { prisma } from "../lib/db.js";

export const CLIENT_ONBOARDING_V2_READ_ROUTES = [
  "GET /admin/v1/clients/:clientAccountId/onboarding",
  "GET /admin/v1/clients/:clientAccountId/onboarding/source-proof",
  "POST /admin/v1/clients/:clientAccountId/onboarding/drive/search",
  "POST /admin/v1/clients/:clientAccountId/onboarding/drive/resolve",
  "POST /admin/v1/clients/:clientAccountId/onboarding/drive/spreadsheets",
  "POST /admin/v1/clients/:clientAccountId/onboarding/sheets/preview",
] as const;

export type ClientOnboardingV2ReadRouteOptions = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  sheetsDeps?: OnboardingSheetDeps;
};

/**
 * Read and preview routes for client onboarding v2.
 * Mounted once from app.ts at /admin/v1. These paths stay off the observer allowlist.
 */
export const adminClientOnboardingV2ReadRoutes: FastifyPluginAsync<ClientOnboardingV2ReadRouteOptions> = async (
  app,
  opts
) => {
  const db = opts.db ?? prisma;
  const env = opts.env ?? process.env;
  const sheetsDeps = opts.sheetsDeps ?? {};

  app.get("/clients/:clientAccountId/onboarding", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    if (!isClientOnboardingV2ReadEnabled(env)) return disabled(reply, "onboarding_read_disabled");
    const clientAccountId = pathClient(request, reply);
    if (!clientAccountId) return;
    if (rejectClientMismatch(request, reply, clientAccountId)) return;
    const result = await readClientOnboardingSummary(clientAccountId, db, env);
    if (!result.ok) return reply.status(result.statusCode).send({ ok: false, error: result.code });
    return reply.send(result);
  });

  app.get("/clients/:clientAccountId/onboarding/source-proof", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    if (!isClientOnboardingV2ReadEnabled(env)) return disabled(reply, "onboarding_read_disabled");
    const clientAccountId = pathClient(request, reply);
    if (!clientAccountId) return;
    if (rejectClientMismatch(request, reply, clientAccountId)) return;
    const client = await db.clientAccount.findUnique({
      where: { clientAccountId },
      select: { clientAccountId: true },
    });
    if (!client) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const proof = await readClientSourceProof(client.clientAccountId, db);
    return reply.send({ ok: true, ...proof });
  });

  app.post("/clients/:clientAccountId/onboarding/drive/search", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request, reply);
    if (!clientAccountId) return;
    const parsed = clientOnboardingV2DriveSearchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_request" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const result = await searchOnboardingDrive(
      clientAccountId,
      { scope: parsed.data.scope, query: parsed.data.query, pageToken: parsed.data.pageToken },
      { ...sheetsDeps, db, env: sheetsDeps.env ?? env }
    );
    return sendResult(reply, result);
  });

  app.post("/clients/:clientAccountId/onboarding/drive/resolve", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request, reply);
    if (!clientAccountId) return;
    const parsed = clientOnboardingV2DriveResolveSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_request" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const result = await resolveOnboardingFolder(clientAccountId, parsed.data.folder, {
      ...sheetsDeps,
      db,
      env: sheetsDeps.env ?? env,
    });
    return sendResult(reply, result);
  });

  app.post("/clients/:clientAccountId/onboarding/drive/spreadsheets", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request, reply);
    if (!clientAccountId) return;
    const parsed = clientOnboardingV2DriveSpreadsheetsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_request" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const result = await listResolvedFolderSpreadsheets(clientAccountId, parsed.data.folderId, {
      ...sheetsDeps,
      db,
      env: sheetsDeps.env ?? env,
    });
    return sendResult(reply, result);
  });

  app.post("/clients/:clientAccountId/onboarding/sheets/preview", async (request, reply) => {
    if (!(await authorize(request, reply))) return;
    const clientAccountId = pathClient(request, reply);
    if (!clientAccountId) return;
    const parsed = clientOnboardingV2SheetPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_request" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const result = await previewOnboardingSpreadsheet(
      clientAccountId,
      {
        spreadsheetId: parsed.data.spreadsheetId,
        worksheetTitle: parsed.data.worksheetTitle,
        worksheetId: parsed.data.worksheetId,
      },
      { ...sheetsDeps, db, env: sheetsDeps.env ?? env }
    );
    return sendResult(reply, result);
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
  return Boolean(headerValue(request, CLIENT_PORTAL_KEY_HEADER) || headerValue(request, CLIENT_PORTAL_ASSERTION_HEADER) || headerValue(request, WORKSPACE_KEY_HEADER));
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function disabled(reply: FastifyReply, error: string) {
  return reply.status(404).send({ ok: false, error });
}

function pathClient(request: FastifyRequest, reply: FastifyReply): string | null {
  const { clientAccountId } = request.params as { clientAccountId?: string };
  if (!clientAccountId || !CLIENT_ONBOARDING_V2_CLIENT_ID.test(clientAccountId)) {
    void reply.status(404).send({ ok: false, error: "client_not_found" });
    return null;
  }
  return clientAccountId;
}

function rejectClientMismatch(request: FastifyRequest, reply: FastifyReply, clientAccountId: string): boolean {
  const query = request.query as { clientAccountId?: unknown };
  const body = request.body as { clientAccountId?: unknown } | undefined;
  const supplied = [query?.clientAccountId, body?.clientAccountId];
  if (supplied.some((value) => typeof value === "string" && value !== clientAccountId)) {
    void reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    return true;
  }
  return false;
}

function sendResult(reply: FastifyReply, result: { ok: true } | { ok: false; code: string; statusCode: number; retryable?: boolean }) {
  if (!result.ok) {
    return reply.status(result.statusCode).send({
      ok: false,
      error: result.code,
      ...(result.retryable === undefined ? {} : { retryable: result.retryable }),
    });
  }
  return reply.send(result);
}
