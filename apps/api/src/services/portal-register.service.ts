import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  evaluatePortalPasswordPolicy,
  PORTAL_PASSWORD_POLICY_ERROR,
} from "@sa360/shared";

import { generatePublicClientAccountId } from "../lib/client-account-id.js";
import { logger } from "../lib/logger.js";
import { hashPortalPassword } from "../lib/portal-password.js";
import { isPublicRegisterOriginAllowed } from "../lib/public-register-origin.js";
import {
  defaultRedisRateLimitConsume,
  hashRateLimitValue,
  portalRegisterRateLimitBucket,
  type RateLimitConsume,
} from "../lib/redis-rate-limit.js";
import { prisma as defaultPrisma } from "../lib/db.js";
import { findClientAccountByPortalLoginEmail } from "../repositories/client-account.repository.js";
import type { PortalRegisterBody } from "../schemas/portal-register.schema.js";
import { portalClientIpFromHeaders } from "./portal-password-reset.service.js";
import {
  presentPortalClientContext,
  type PortalClientContext,
} from "./client-portal-tenant.service.js";

export const PORTAL_REGISTER_GENERIC_ERROR =
  "We could not create your account. If you already have one, sign in.";
export const PORTAL_REGISTER_RATE_LIMITED = "Too many attempts. Try again later.";
export const PORTAL_REGISTER_ORIGIN_DENIED = "Registration is not available from this site.";

export const PORTAL_REGISTER_EMAIL_LIMIT = 5;
export const PORTAL_REGISTER_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const PORTAL_REGISTER_IP_LIMIT = 10;
export const PORTAL_REGISTER_IP_WINDOW_MS = 60 * 60 * 1000;
const ID_RETRY_LIMIT = 5;

export type PortalRegisterOutcome =
  | "created"
  | "duplicate"
  | "invalid"
  | "password_invalid"
  | "throttled"
  | "origin_denied"
  | "failed";

export type PortalRegisterSuccess = {
  ok: true;
  context: PortalClientContext;
  portalSessionEpoch: number;
  status: "onboarding";
};

export type PortalRegisterFailure = {
  ok: false;
  error: string;
  code: "INVALID" | "PASSWORD_INVALID" | "THROTTLED" | "ORIGIN_DENIED" | "FAILED";
};

export type PortalRegisterResult = PortalRegisterSuccess | PortalRegisterFailure;

export type PortalRegisterDeps = {
  db?: PrismaClient;
  now?: () => Date;
  consumeRateLimit?: RateLimitConsume;
  clientIp?: string;
  origin?: string | null;
  referer?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  env?: NodeJS.ProcessEnv;
  generateId?: () => string;
  hashPassword?: typeof hashPortalPassword;
};

function uniqueTargetIncludes(err: Prisma.PrismaClientKnownRequestError, field: string): boolean {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String).includes(field);
  if (typeof target === "string") return target.includes(field);
  return false;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function audit(outcome: PortalRegisterOutcome, extra: Record<string, unknown>): void {
  logger.info("portal_register", {
    outcome,
    ...extra,
  });
}

async function consumeRegisterLimits(
  email: string,
  clientIp: string,
  consume: RateLimitConsume
): Promise<boolean> {
  const emailBucket = portalRegisterRateLimitBucket("email", email);
  const ipBucket = portalRegisterRateLimitBucket("ip", clientIp);
  const emailLimit = await consume(
    emailBucket,
    PORTAL_REGISTER_EMAIL_LIMIT,
    PORTAL_REGISTER_EMAIL_WINDOW_MS
  );
  if (!emailLimit.allowed) return false;
  const ipLimit = await consume(ipBucket, PORTAL_REGISTER_IP_LIMIT, PORTAL_REGISTER_IP_WINDOW_MS);
  return ipLimit.allowed;
}

export async function registerPublicPortalAccount(
  body: PortalRegisterBody,
  deps: PortalRegisterDeps = {}
): Promise<PortalRegisterResult> {
  const env = deps.env ?? process.env;
  const originAllowed = isPublicRegisterOriginAllowed({
    origin: deps.origin,
    referer: deps.referer,
    forwardedHost: deps.forwardedHost,
    host: deps.host,
    env,
  });
  if (!originAllowed) {
    audit("origin_denied", { host: deps.host ?? null });
    return { ok: false, error: PORTAL_REGISTER_ORIGIN_DENIED, code: "ORIGIN_DENIED" };
  }

  const email = normalizeEmail(body.email);
  const agencyName = body.agencyName.trim();
  const clientIp = (deps.clientIp?.trim() || "unknown").slice(0, 128);
  const consume = deps.consumeRateLimit ?? defaultRedisRateLimitConsume;
  const allowed = await consumeRegisterLimits(email, clientIp, consume);
  if (!allowed) {
    audit("throttled", {
      emailHash: hashRateLimitValue(email),
      ipHash: hashRateLimitValue(clientIp),
    });
    return { ok: false, error: PORTAL_REGISTER_RATE_LIMITED, code: "THROTTLED" };
  }

  const policy = evaluatePortalPasswordPolicy(body.password);
  if (!policy.ok) {
    audit("password_invalid", { emailHash: hashRateLimitValue(email) });
    return { ok: false, error: PORTAL_PASSWORD_POLICY_ERROR, code: "PASSWORD_INVALID" };
  }

  const db = deps.db ?? defaultPrisma;
  const existing = await findClientAccountByPortalLoginEmail(email, db);
  if (existing) {
    audit("duplicate", { emailHash: hashRateLimitValue(email) });
    return { ok: false, error: PORTAL_REGISTER_GENERIC_ERROR, code: "FAILED" };
  }

  const hashPassword = deps.hashPassword ?? hashPortalPassword;
  let portalPasswordHash: string;
  try {
    portalPasswordHash = await hashPassword(body.password);
  } catch {
    audit("failed", { emailHash: hashRateLimitValue(email), reason: "hash_failed" });
    return { ok: false, error: PORTAL_REGISTER_GENERIC_ERROR, code: "FAILED" };
  }

  const now = deps.now?.() ?? new Date();
  const generateId = deps.generateId ?? generatePublicClientAccountId;

  for (let attempt = 0; attempt < ID_RETRY_LIMIT; attempt += 1) {
    const clientAccountId = generateId();
    try {
      const created = await db.clientAccount.create({
        data: {
          clientAccountId,
          clientDisplayName: agencyName,
          status: "onboarding",
          portalEnabled: true,
          portalDisplayName: agencyName,
          portalLoginEmail: email,
          portalPasswordHash,
          portalPasswordSetAt: now,
          portalSessionEpoch: 0,
          primaryNicheKeys: ["vet"],
          primaryProductTypes: [],
          notes: "Public registration (Aged Vet Leads)",
        },
        include: { ghlDestination: true },
      });
      const context = presentPortalClientContext(created);
      audit("created", {
        emailHash: hashRateLimitValue(email),
        clientAccountId: created.clientAccountId,
        status: created.status,
        portalEnabled: created.portalEnabled,
      });
      return {
        ok: true,
        context,
        portalSessionEpoch: context.portalSessionEpoch,
        status: "onboarding",
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        if (uniqueTargetIncludes(err, "portalLoginEmail")) {
          audit("duplicate", { emailHash: hashRateLimitValue(email) });
          return { ok: false, error: PORTAL_REGISTER_GENERIC_ERROR, code: "FAILED" };
        }
        if (uniqueTargetIncludes(err, "clientAccountId") && attempt < ID_RETRY_LIMIT - 1) {
          continue;
        }
      }
      audit("failed", {
        emailHash: hashRateLimitValue(email),
        reason: "create_failed",
      });
      return { ok: false, error: PORTAL_REGISTER_GENERIC_ERROR, code: "FAILED" };
    }
  }

  audit("failed", { emailHash: hashRateLimitValue(email), reason: "id_exhausted" });
  return { ok: false, error: PORTAL_REGISTER_GENERIC_ERROR, code: "FAILED" };
}

export { portalClientIpFromHeaders };
