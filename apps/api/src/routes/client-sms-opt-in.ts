/**
 * Recipient opt-in for one configured sandbox client.
 * Requires a portal session for that client. An admin key is not accepted.
 * The checkbox value must be the boolean true. Consent is not recorded here
 * until a later call, after the handset inbound code is confirmed.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthenticatedPortalTenant } from "../lib/client-portal-session-assertion.js";
import { prisma } from "../lib/db.js";
import {
  beginRecipientSmsOptIn,
  readRecipientSmsOptIn,
  recordRecipientSmsConsent,
  setRecipientSmsEnabled,
  type SmsOptInCode,
} from "../services/external-webhook-notification/sms-opt-in.js";

const E164 = /^\+[1-9]\d{7,14}$/;

const beginSchema = z
  .object({
    phoneE164: z.string().regex(E164),
    affirmDisclosure: z.literal(true),
    version: z.string().min(1).max(80),
  })
  .strict();

const consentSchema = z
  .object({
    affirmDisclosure: z.literal(true),
    version: z.string().min(1).max(80),
  })
  .strict();

const enableSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const STATUS: Partial<Record<SmsOptInCode, number>> = {
  opt_in_disabled: 404,
  client_not_found: 404,
  preference_missing: 409,
  invalid_e164: 400,
  invalid_consent: 400,
  consent_not_affirmed: 400,
  legal_urls_missing: 409,
  phone_not_verified: 409,
  handset_not_proven: 409,
  disclosure_mismatch: 409,
  not_opted_in: 409,
  stop_suppressed: 409,
  stop_unknown: 409,
  challenge_expired: 409,
  challenge_mismatch: 409,
};

function publicState(state: {
  disclosure: {
    version: string;
    businessName: string;
    program: string;
    purpose: string;
    frequency: string;
    rates: string;
    stop: string;
    help: string;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    recordable: boolean;
  };
  consentRecorded: boolean;
  handsetProven: boolean;
  smsEnabled: boolean;
  preference: { recipientPhoneE164: string | null; smsConsentVersion: string | null; smsConsentRecordedAt: Date | null; smsEnabledAt: Date | null; smsHandsetProvenAt: Date | null; smsSuppressionState: string } | null;
}) {
  return {
    disclosure: state.disclosure,
    phoneOnFile: Boolean(state.preference?.recipientPhoneE164),
    consentRecorded: state.consentRecorded,
    consentVersion: state.preference?.smsConsentVersion ?? null,
    consentRecordedAt: state.preference?.smsConsentRecordedAt?.toISOString() ?? null,
    handsetProven: state.handsetProven,
    handsetProvenAt: state.preference?.smsHandsetProvenAt?.toISOString() ?? null,
    smsEnabled: state.smsEnabled,
    smsEnabledAt: state.preference?.smsEnabledAt?.toISOString() ?? null,
    suppression: state.preference?.smsSuppressionState ?? "unknown",
  };
}

export async function clientSmsOptInRoutes(app: FastifyInstance, opts: { env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;

  app.get("/sms-opt-in", async (request, reply) => {
    const tenant = await requireAuthenticatedPortalTenant(request, reply);
    if (!tenant) return;
    const read = await readRecipientSmsOptIn(prisma, { clientAccountId: tenant.clientAccountId, env });
    if (!read.ok) return reply.status(STATUS[read.code] ?? 409).send({ ok: false, error: read.code });
    return reply.send({ ok: true, ...publicState(read.state) });
  });

  app.post("/sms-opt-in", async (request, reply) => {
    const tenant = await requireAuthenticatedPortalTenant(request, reply);
    if (!tenant) return;
    const parsed = beginSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "consent_not_affirmed" });
    const begun = await beginRecipientSmsOptIn(prisma, {
      clientAccountId: tenant.clientAccountId,
      phoneE164: parsed.data.phoneE164,
      affirmDisclosure: parsed.data.affirmDisclosure,
      version: parsed.data.version,
      env,
    });
    if (!begun.ok) return reply.status(STATUS[begun.code] ?? 409).send({ ok: false, error: begun.code });
    return reply.send({
      ok: true,
      ...publicState(begun.state),
      challengeCode: begun.challengeCode,
      challengeExpiresAt: begun.expiresAt.toISOString(),
      ownershipMethod: "inbound_origination",
    });
  });

  app.post("/sms-opt-in/consent", async (request, reply) => {
    const tenant = await requireAuthenticatedPortalTenant(request, reply);
    if (!tenant) return;
    const parsed = consentSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "consent_not_affirmed" });
    const recorded = await recordRecipientSmsConsent(prisma, {
      clientAccountId: tenant.clientAccountId,
      affirmDisclosure: parsed.data.affirmDisclosure,
      version: parsed.data.version,
      env,
    });
    if (!recorded.ok) return reply.status(STATUS[recorded.code] ?? 409).send({ ok: false, error: recorded.code });
    return reply.send({ ok: true, ...publicState(recorded.state) });
  });

  app.post("/sms-opt-in/enabled", async (request, reply) => {
    const tenant = await requireAuthenticatedPortalTenant(request, reply);
    if (!tenant) return;
    const parsed = enableSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_consent" });
    const saved = await setRecipientSmsEnabled(prisma, {
      clientAccountId: tenant.clientAccountId,
      enabled: parsed.data.enabled,
      env,
    });
    if (!saved.ok) return reply.status(STATUS[saved.code] ?? 409).send({ ok: false, error: saved.code });
    return reply.send({ ok: true, ...publicState(saved.state) });
  });
}
