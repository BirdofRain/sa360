import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PORTAL_PASSWORD_RESET_GENERIC_SUCCESS } from "@sa360/shared";
import { isPortalPasswordBound } from "../lib/portal-password.js";
import { PORTAL_PASSWORD_RESET_TTL_MS } from "../lib/portal-invite-token.js";
import { resolvePortalPublicBaseUrl } from "../lib/portal-public-url.js";
import {
  defaultRedisRateLimitConsume,
  portalPasswordResetRateLimitBucket,
  type RateLimitConsume,
} from "../lib/redis-rate-limit.js";
import { logger } from "../lib/logger.js";
import {
  isTransactionalEmailConfigured,
  sendTransactionalEmail,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
} from "../lib/transactional-email.js";
import { buildPortalPasswordResetEmail } from "../lib/portal-password-reset-email.js";
import { findClientAccountByPortalLoginEmail } from "../repositories/client-account.repository.js";
import { prisma as defaultPrisma } from "../lib/db.js";
import { issuePortalInvite, type PortalInviteServiceDeps } from "./portal-invite.service.js";

const portalEmailSchema = z.string().trim().email().max(320);

export const PORTAL_PASSWORD_RESET_GENERIC = PORTAL_PASSWORD_RESET_GENERIC_SUCCESS;

export const PORTAL_PASSWORD_RESET_EMAIL_LIMIT = 5;
export const PORTAL_PASSWORD_RESET_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const PORTAL_PASSWORD_RESET_IP_LIMIT = 15;
export const PORTAL_PASSWORD_RESET_IP_WINDOW_MS = 60 * 60 * 1000;

export type PortalPasswordResetOutcome =
  | "issued"
  | "ineligible"
  | "throttled"
  | "not_configured"
  | "send_failed";

export type RequestPortalPasswordResetResult = {
  ok: true;
  message: string;
  outcome: PortalPasswordResetOutcome;
};

export type PortalPasswordResetDeps = PortalInviteServiceDeps & {
  clientIp?: string;
  sendEmail?: (input: SendTransactionalEmailInput) => Promise<SendTransactionalEmailResult>;
  consumeRateLimit?: RateLimitConsume;
  env?: NodeJS.ProcessEnv;
};

export function normalizePortalLoginEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isWellFormedPortalLoginEmail(value: string): boolean {
  return portalEmailSchema.safeParse(value).success;
}

export function portalClientIpFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallbackIp?: string
): string {
  const forwarded = headers["x-forwarded-for"];
  const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof rawForwarded === "string" && rawForwarded.trim()) {
    return rawForwarded.split(",")[0]!.trim().slice(0, 128);
  }
  const realIp = headers["x-real-ip"];
  const rawReal = Array.isArray(realIp) ? realIp[0] : realIp;
  if (typeof rawReal === "string" && rawReal.trim()) {
    return rawReal.trim().slice(0, 128);
  }
  if (typeof fallbackIp === "string" && fallbackIp.trim()) {
    return fallbackIp.trim().slice(0, 128);
  }
  return "unknown";
}

export function isEligibleForSelfServicePortalReset(row: {
  portalEnabled: boolean;
  portalLoginEmail: string | null;
  portalPasswordHash: string | null;
}): boolean {
  return (
    row.portalEnabled === true &&
    isWellFormedPortalLoginEmail(row.portalLoginEmail ?? "") &&
    isPortalPasswordBound(row.portalPasswordHash)
  );
}

export function canDeliverPortalPasswordResetEmail(
  deps: Pick<PortalPasswordResetDeps, "sendEmail" | "env"> = {}
): boolean {
  const env = deps.env ?? process.env;
  if (!resolvePortalPublicBaseUrl(env)) return false;
  if (deps.sendEmail) return true;
  return isTransactionalEmailConfigured();
}

function generic(outcome: PortalPasswordResetOutcome): RequestPortalPasswordResetResult {
  return {
    ok: true,
    message: PORTAL_PASSWORD_RESET_GENERIC,
    outcome,
  };
}

async function consumeResetLimits(
  email: string,
  clientIp: string,
  consume: RateLimitConsume
): Promise<boolean> {
  try {
    const emailBucket = portalPasswordResetRateLimitBucket("email", email);
    const ipBucket = portalPasswordResetRateLimitBucket("ip", clientIp);
    const [emailLimit, ipLimit] = await Promise.all([
      consume(emailBucket, PORTAL_PASSWORD_RESET_EMAIL_LIMIT, PORTAL_PASSWORD_RESET_EMAIL_WINDOW_MS),
      consume(ipBucket, PORTAL_PASSWORD_RESET_IP_LIMIT, PORTAL_PASSWORD_RESET_IP_WINDOW_MS),
    ]);
    return emailLimit.allowed && ipLimit.allowed;
  } catch {
    logger.warn("portal_password_reset_rate_limit_unavailable");
    return false;
  }
}

/**
 * Public self-service reset request. Always returns the same customer message.
 * Issues a 60-minute one-time token only for converted, enabled portal accounts.
 */
export async function requestPortalPasswordReset(
  rawEmail: string,
  deps: PortalPasswordResetDeps = {}
): Promise<RequestPortalPasswordResetResult> {
  const normalized = normalizePortalLoginEmail(rawEmail);
  const clientIp = (deps.clientIp ?? "unknown").trim().slice(0, 128) || "unknown";
  const consume = deps.consumeRateLimit ?? defaultRedisRateLimitConsume;

  const allowed = await consumeResetLimits(
    isWellFormedPortalLoginEmail(normalized) ? normalized : `invalid:${normalized || "empty"}`,
    clientIp,
    consume
  );
  if (!allowed) {
    return generic("throttled");
  }

  if (!isWellFormedPortalLoginEmail(normalized)) {
    return generic("ineligible");
  }

  if (!canDeliverPortalPasswordResetEmail(deps)) {
    return generic("not_configured");
  }

  const db: PrismaClient = deps.db ?? defaultPrisma;
  const row = await findClientAccountByPortalLoginEmail(normalized, db);
  if (!row || !isEligibleForSelfServicePortalReset(row)) {
    return generic("ineligible");
  }

  const issued = await issuePortalInvite(row.clientAccountId, {
    db,
    now: deps.now,
    ttlMs: PORTAL_PASSWORD_RESET_TTL_MS,
  });
  if (!issued.ok) {
    return generic("ineligible");
  }

  const email = buildPortalPasswordResetEmail({ resetUrl: issued.inviteUrl });
  const send = deps.sendEmail ?? sendTransactionalEmail;
  const sent = await send({
    to: normalized,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `portal-pw-reset:${row.clientAccountId}:${issued.expiresAt}`.slice(0, 256),
  });

  if (!sent.ok) {
    logger.warn("portal_password_reset_email_failed", {
      skipped: sent.skipped === true,
    });
    return generic("send_failed");
  }

  return generic("issued");
}
