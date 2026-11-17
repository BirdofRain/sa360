/**
 * Team Workspace verbal SMS note.
 * Only Matt, Alex, and Aaron, identified by a verified staff assertion, may record one.
 * The note stays pending_confirmation. It does not enable SMS.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { STAFF_ASSERTION_HEADER, verifyStaffAssertion } from "@sa360/shared/staff-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { prisma } from "../lib/db.js";
import { isTeamWorkspaceApiEnabled } from "../lib/team-workspace-env.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";
import { smsVerbalOperatorAllowed } from "../services/external-webhook-notification/sms-disclosure.js";
import { issueSmsOptInLink, recordVerbalSmsConsent, type SmsLinkCode } from "../services/external-webhook-notification/sms-opt-in-link.js";

const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

const verbalSchema = z
  .object({
    phoneE164: z.string().regex(E164),
    affirmativeResponse: z.string().trim().min(2).max(500),
    disclosureVersion: z.literal("external-webhook-sms-v2"),
    confirmationEmail: z.string().trim().email().max(320),
    evidence: z.string().trim().max(500).optional(),
  })
  .strict();

const linkSchema = z
  .object({
    phoneE164: z.string().regex(E164),
    confirmationEmail: z.string().trim().email().max(320).optional(),
  })
  .strict();

const STATUS: Partial<Record<SmsLinkCode, number>> = {
  operator_required: 403,
  client_not_found: 404,
  preference_missing: 409,
  stop_suppressed: 409,
  invalid_e164: 400,
  invalid_consent: 400,
  affirmation_required: 400,
  confirmation_email_required: 400,
};

export async function adminSmsVerbalConsentRoutes(app: FastifyInstance, opts: { env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;

  app.post("/team-workspace/clients/:clientAccountId/sms-verbal-consent", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const operator = await resolveVerbalOperator(request, env);
    if (!operator.ok) return reply.status(operator.status).send({ ok: false, error: operator.error });
    const parsed = verbalSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "affirmation_required" });
    const recorded = await recordVerbalSmsConsent(prisma, {
      clientAccountId,
      phoneE164: parsed.data.phoneE164,
      affirmativeResponse: parsed.data.affirmativeResponse,
      disclosureVersion: parsed.data.disclosureVersion,
      operatorId: operator.operatorId,
      evidence: parsed.data.evidence,
      confirmationEmail: parsed.data.confirmationEmail,
      env,
    });
    if (!recorded.ok) return reply.status(STATUS[recorded.code] ?? 409).send({ ok: false, error: recorded.code });
    return reply.send({
      ok: true,
      status: recorded.status,
      smsEnabled: false,
      consentRecorded: false,
      operatorId: operator.operatorId,
      recordedAt: recorded.recordedAt.toISOString(),
      email: recorded.email,
      url: recorded.email === "sent" ? null : recorded.url,
    });
  });

  app.post("/team-workspace/clients/:clientAccountId/sms-opt-in-link", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    if (!clientAccountId) return reply.status(404).send({ ok: false, error: "client_not_found" });
    const operator = await resolveVerbalOperator(request, env);
    if (!operator.ok) return reply.status(operator.status).send({ ok: false, error: operator.error });
    const parsed = linkSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_e164" });
    const issued = await issueSmsOptInLink(prisma, {
      clientAccountId,
      phoneE164: parsed.data.phoneE164,
      confirmationEmail: parsed.data.confirmationEmail,
      env,
    });
    if (!issued.ok) return reply.status(STATUS[issued.code] ?? 409).send({ ok: false, error: issued.code });
    return reply.send({
      ok: true,
      consentRecorded: false,
      smsEnabled: false,
      email: issued.email,
      url: issued.email === "sent" ? null : issued.url,
      expiresAt: issued.expiresAt.toISOString(),
    });
  });
}

async function authorize(request: FastifyRequest, reply: FastifyReply, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send({ ok: false, error: "forbidden" });
    return false;
  }
  if (!(await verifyAdminApiKey(request, reply))) return false;
  if (!isTeamWorkspaceApiEnabled(env)) {
    await reply.status(404).send({ ok: false, error: "team_workspace_disabled" });
    return false;
  }
  return true;
}

async function resolveVerbalOperator(
  request: FastifyRequest,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; operatorId: string } | { ok: false; status: 401 | 403; error: string }> {
  const raw = request.headers[STAFF_ASSERTION_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return { ok: false, status: 403, error: "operator_required" };
  const verified = verifyStaffAssertion(token, { env });
  if (!verified.ok) return { ok: false, status: 401, error: "operator_required" };
  const rows = await prisma.staffPrincipal.findMany({
    where: {
      id: verified.claims.sub,
      status: "active",
      disabledAt: null,
      provider: "google",
      providerSubject: { not: null },
    },
    select: { id: true, email: true, permissions: { where: { status: "granted", revokedAt: null }, select: { permission: true } } },
  });
  const row = rows[0];
  if (!row || !smsVerbalOperatorAllowed(row.email)) return { ok: false, status: 403, error: "operator_required" };
  const allowed = row.permissions.some((item) =>
    item.permission === "admin_coc" || item.permission === "team_workspace" || item.permission === "team_manager"
  );
  if (!allowed) return { ok: false, status: 403, error: "operator_required" };
  return { ok: true, operatorId: row.id };
}

function foreignCredential(request: FastifyRequest): boolean {
  return Boolean(headerValue(request, CLIENT_PORTAL_KEY_HEADER) || headerValue(request, CLIENT_PORTAL_ASSERTION_HEADER) || headerValue(request, WORKSPACE_KEY_HEADER));
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
