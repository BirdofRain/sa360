import type { FastifyRequest } from "fastify";
import { isValidWebhookSecret } from "./auth.js";

/**
 * Synthflow voice callbacks must send the same shared secret as GHL lifecycle webhooks.
 * Header name is case-insensitive (`x-sa360-secret`).
 */
export function readSynthflowVoiceSecretHeader(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-sa360-secret"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !v.trim()) {
    return undefined;
  }
  return v;
}

export function isSynthflowVoiceRequestAuthorized(request: FastifyRequest): boolean {
  return isValidWebhookSecret(readSynthflowVoiceSecretHeader(request));
}
