/**
 * Recipient opt-in link. No portal session and no admin key.
 * The token is the credential. A missing or false checkbox records nothing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../lib/db.js";
import {
  confirmSmsOptInLink,
  confirmSupersedingGhlConsent,
  readSmsOptInLink,
  type SmsLinkCode,
} from "../services/external-webhook-notification/sms-opt-in-link.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const confirmSchema = z.object({ affirmDisclosure: z.literal(true) }).strict();

const STATUS: Partial<Record<SmsLinkCode, number>> = {
  token_invalid: 404,
  token_expired: 410,
  consent_not_affirmed: 400,
  legal_urls_missing: 409,
  disclosure_mismatch: 409,
  stop_suppressed: 409,
  not_opted_in: 409,
  phone_not_verified: 409,
};

export async function publicSmsOptInRoutes(app: FastifyInstance, opts: { env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-robots-tag", "noindex, nofollow");
  });

  app.get("/public/sms-opt-in/:token", async (request, reply) => {
    const token = pathToken(request);
    if (!token) return reply.status(404).send({ ok: false, error: "token_invalid" });
    const read = await readSmsOptInLink(prisma, token, env);
    if (!read.ok) return reply.status(STATUS[read.code] ?? 409).send({ ok: false, error: read.code });
    return reply.send({
      ok: true,
      disclosure: read.disclosure,
      phoneMasked: read.phoneMasked,
      phoneSource: read.phoneSource,
      recipientConsentConfirmed: read.recipientConsentConfirmed,
      handsetOwnershipProven: read.handsetOwnershipProven,
      consentRecorded: read.consentRecorded,
      smsEnabled: read.smsEnabled,
      pendingConfirmation: read.pendingConfirmation,
      priorProgram: read.priorProgram,
      portalLoginRequired: false,
    });
  });

  app.post("/public/sms-opt-in/:token/ghl-program", async (request, reply) => {
    const token = pathToken(request);
    if (!token) return reply.status(404).send({ ok: false, error: "token_invalid" });
    const parsed = confirmSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "consent_not_affirmed" });
    const confirmed = await confirmSupersedingGhlConsent(prisma, { rawToken: token, affirmDisclosure: true, env });
    if (!confirmed.ok) return reply.status(STATUS[confirmed.code] ?? 409).send({ ok: false, error: confirmed.code });
    return reply.send({
      ok: true,
      consentRecorded: true,
      smsEnabled: true,
      priorProgram: confirmed.priorProgram,
      phoneSource: "staff_supplied",
      recipientConsentConfirmed: true,
      handsetOwnershipProven: false,
      portalLoginRequired: false,
    });
  });

  app.post("/public/sms-opt-in/:token", async (request, reply) => {
    const token = pathToken(request);
    if (!token) return reply.status(404).send({ ok: false, error: "token_invalid" });
    const parsed = confirmSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "consent_not_affirmed" });
    const confirmed = await confirmSmsOptInLink(prisma, { rawToken: token, affirmDisclosure: true, env });
    if (!confirmed.ok) return reply.status(STATUS[confirmed.code] ?? 409).send({ ok: false, error: confirmed.code });
    return reply.send({
      ok: true,
      consentRecorded: true,
      smsEnabled: true,
      phoneSource: "staff_supplied",
      recipientConsentConfirmed: true,
      handsetOwnershipProven: false,
      portalLoginRequired: false,
    });
  });
}

function pathToken(request: { params: unknown }): string | null {
  const token = (request.params as { token?: string }).token ?? "";
  return TOKEN.test(token) ? token : null;
}
