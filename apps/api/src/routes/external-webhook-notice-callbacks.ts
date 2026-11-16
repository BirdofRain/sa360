import type { FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import { applyTwilioInboundOptOut, applyTwilioNoticeStatus } from "../services/external-webhook-notification/notice-callbacks.js";
import { twilioSignatureMatches } from "../services/external-webhook-notification/twilio-signature.js";
import {
  TWILIO_AUTH_TOKEN_ENV,
  TWILIO_STATUS_CALLBACK_URL_ENV,
} from "../services/external-webhook-notification/twilio-programmable-messaging.js";

export { TWILIO_STATUS_CALLBACK_URL_ENV };
export const TWILIO_INBOUND_CALLBACK_URL_ENV = "SA360_TWILIO_INBOUND_CALLBACK_URL";

type CallbackOpts = {
  statusUrl?: string;
  inboundUrl?: string;
  authToken?: string;
};

/**
 * Twilio callback plugin. Unsigned requests do not change notice or consent state.
 * The form parser is added only when this plugin context does not already have one,
 * so a parent intake parser is left in place.
 */
export async function externalWebhookNoticeCallbackRoutes(app: FastifyInstance, opts: CallbackOpts = {}) {
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
      const text = typeof body === "string" ? body : body.toString("utf8");
      done(null, Object.fromEntries(new URLSearchParams(text)));
    });
  }

  app.post("/integrations/twilio/external-webhook-notice/status", async (request, reply) => {
    const params = asParams(request.body);
    const url = opts.statusUrl ?? process.env[TWILIO_STATUS_CALLBACK_URL_ENV]?.trim() ?? "";
    if (!signed(request.headers["x-twilio-signature"], params, url, opts.authToken)) {
      return reply.code(403).send({ ok: false, error: "invalid_signature" });
    }
    const result = await applyTwilioNoticeStatus(prisma, params);
    return reply.send(result);
  });

  app.post("/integrations/twilio/external-webhook-notice/inbound", async (request, reply) => {
    const params = asParams(request.body);
    const url = opts.inboundUrl ?? process.env[TWILIO_INBOUND_CALLBACK_URL_ENV]?.trim() ?? "";
    if (!signed(request.headers["x-twilio-signature"], params, url, opts.authToken)) {
      return reply.code(403).send({ ok: false, error: "invalid_signature" });
    }
    const result = await applyTwilioInboundOptOut(prisma, params);
    return reply.send(result);
  });
}

function signed(
  header: string | string[] | undefined,
  params: Record<string, string>,
  url: string,
  authToken: string | undefined
): boolean {
  const signature = Array.isArray(header) ? header[0] : header;
  const token = authToken ?? process.env[TWILIO_AUTH_TOKEN_ENV]?.trim() ?? "";
  return twilioSignatureMatches(url, params, signature, token);
}

function asParams(body: unknown): Record<string, string> {
  if (typeof body === "string") return Object.fromEntries(new URLSearchParams(body));
  if (!body || typeof body !== "object") return {};
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
