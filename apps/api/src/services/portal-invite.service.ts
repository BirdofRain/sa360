import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import {
  evaluatePortalPasswordPolicy,
  PORTAL_PASSWORD_POLICY_ERROR,
} from "@sa360/shared";
import { hashPortalPassword } from "../lib/portal-password.js";
import {
  generatePortalInviteToken,
  hashPortalInviteToken,
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_TTL_MS,
  portalInvitePath,
} from "../lib/portal-invite-token.js";
import { buildAbsoluteOrRelativePortalUrl } from "../lib/portal-public-url.js";
import {
  findClientAccountById,
  findClientAccountByPortalInviteTokenHash,
} from "../repositories/client-account.repository.js";
import { prisma as defaultPrisma } from "../lib/db.js";
import type { ClientPortalTenantDeps } from "./client-portal-tenant.service.js";

const portalEmailSchema = z.string().trim().email().max(320);

export const PORTAL_INVITE_TTL_HOURS = PORTAL_INVITE_TTL_MS / (60 * 60 * 1000);

export const PORTAL_INVITE_INVALID =
  "This invite link is invalid or has expired. Request a new invite from your SA360 team.";

export type PortalInviteServiceDeps = ClientPortalTenantDeps & {
  now?: () => Date;
};

export type IssuePortalInviteResult =
  | { ok: true; inviteUrl: string; expiresAt: string }
  | {
      ok: false;
      error: string;
      code: "NOT_FOUND" | "PORTAL_DISABLED" | "MISSING_PORTAL_LOGIN_EMAIL";
    };

export type AcceptPortalInviteResult =
  | { ok: true }
  | { ok: false; error: string; code: "INVITE_INVALID" | "PASSWORD_INVALID" };

export type InspectPortalInviteResult = { ok: true } | { ok: false; error: string; code: "INVITE_INVALID" };

function isValidPortalLoginEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  return portalEmailSchema.safeParse(value).success;
}

function publicIssueResult(inviteUrl: string, expiresAt: Date): IssuePortalInviteResult {
  return {
    ok: true,
    inviteUrl,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Operator issuance. Replaces any outstanding invite for this ClientAccount.
 * Returns the raw invite URL once. The raw token is never persisted.
 */
export async function issuePortalInvite(
  clientAccountId: string,
  deps: PortalInviteServiceDeps = {}
): Promise<IssuePortalInviteResult> {
  const db: PrismaClient = deps.db ?? defaultPrisma;
  const id = clientAccountId.trim();
  if (!id) {
    return { ok: false, error: "Client account not found", code: "NOT_FOUND" };
  }

  const account = await findClientAccountById(id, db);
  if (!account) {
    return { ok: false, error: "Client account not found", code: "NOT_FOUND" };
  }
  if (!account.portalEnabled) {
    return { ok: false, error: "Client portal is not enabled", code: "PORTAL_DISABLED" };
  }
  if (!isValidPortalLoginEmail(account.portalLoginEmail)) {
    return {
      ok: false,
      error: "Portal login email is required before issuing an invite",
      code: "MISSING_PORTAL_LOGIN_EMAIL",
    };
  }

  const now = deps.now?.() ?? new Date();
  const { rawToken, tokenHash } = generatePortalInviteToken();
  const expiresAt = new Date(now.getTime() + PORTAL_INVITE_TTL_MS);

  await db.clientAccount.update({
    where: { clientAccountId: account.clientAccountId },
    data: {
      portalInviteTokenHash: tokenHash,
      portalInviteExpiresAt: expiresAt,
    },
  });

  const inviteUrl = buildAbsoluteOrRelativePortalUrl(portalInvitePath(rawToken));
  return publicIssueResult(inviteUrl, expiresAt);
}

function genericInvalid(): AcceptPortalInviteResult {
  return { ok: false, error: PORTAL_INVITE_INVALID, code: "INVITE_INVALID" };
}

export async function inspectPortalInvite(
  rawToken: string,
  deps: PortalInviteServiceDeps = {}
): Promise<InspectPortalInviteResult> {
  if (!isWellFormedPortalInviteToken(rawToken)) {
    return { ok: false, error: PORTAL_INVITE_INVALID, code: "INVITE_INVALID" };
  }
  const db: PrismaClient = deps.db ?? defaultPrisma;
  const now = deps.now?.() ?? new Date();
  const tokenHash = hashPortalInviteToken(rawToken);
  const row = await findClientAccountByPortalInviteTokenHash(tokenHash, db);
  if (!row?.portalEnabled) {
    return { ok: false, error: PORTAL_INVITE_INVALID, code: "INVITE_INVALID" };
  }
  if (!row.portalInviteExpiresAt || row.portalInviteExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: PORTAL_INVITE_INVALID, code: "INVITE_INVALID" };
  }
  return { ok: true };
}

/**
 * Customer invite accept. Atomic compare-and-set:
 * hash lookup → not expired → portal enabled → scrypt password →
 * set hash + setAt, clear invite fields, increment portalSessionEpoch.
 *
 * Bound only to the ClientAccount that stores this token hash.
 * Does not read clientAccountId from the customer.
 */
export async function acceptPortalInvite(
  rawToken: string,
  password: string,
  deps: PortalInviteServiceDeps = {}
): Promise<AcceptPortalInviteResult> {
  const policy = evaluatePortalPasswordPolicy(password);
  if (!policy.ok) {
    return { ok: false, error: PORTAL_PASSWORD_POLICY_ERROR, code: "PASSWORD_INVALID" };
  }
  if (!isWellFormedPortalInviteToken(rawToken)) {
    return genericInvalid();
  }

  const db: PrismaClient = deps.db ?? defaultPrisma;
  const now = deps.now?.() ?? new Date();
  const tokenHash = hashPortalInviteToken(rawToken);
  const row = await findClientAccountByPortalInviteTokenHash(tokenHash, db);
  if (!row?.portalEnabled) {
    return genericInvalid();
  }
  if (!row.portalInviteExpiresAt || row.portalInviteExpiresAt.getTime() <= now.getTime()) {
    return genericInvalid();
  }

  const portalPasswordHash = await hashPortalPassword(password);

  const updated = await db.clientAccount.updateMany({
    where: {
      portalInviteTokenHash: tokenHash,
      portalEnabled: true,
      portalInviteExpiresAt: { gt: now },
    },
    data: {
      portalPasswordHash,
      portalPasswordSetAt: now,
      portalInviteTokenHash: null,
      portalInviteExpiresAt: null,
      portalSessionEpoch: { increment: 1 },
    },
  });

  if (updated.count !== 1) {
    return genericInvalid();
  }
  return { ok: true };
}
