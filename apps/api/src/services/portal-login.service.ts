import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  isPortalPasswordBound,
  verifyPortalPassword,
} from "../lib/portal-password.js";
import { findClientAccountByPortalLoginEmail } from "../repositories/client-account.repository.js";
import { prisma as defaultPrisma } from "../lib/db.js";
import {
  presentPortalClientContext,
  type ClientPortalTenantDeps,
  type PortalClientContext,
} from "./client-portal-tenant.service.js";

export const PORTAL_LOGIN_INVALID_CREDENTIALS =
  "Email or password is incorrect. Please try again.";
export const PORTAL_LOGIN_DISABLED =
  "Your portal is not enabled yet. Contact your account team.";

export type PortalLoginPasswordCheck = "customer" | "env_fallback";

export type PortalLoginServiceResult =
  | {
      ok: true;
      passwordCheck: PortalLoginPasswordCheck;
      context: PortalClientContext;
      portalSessionEpoch: number;
    }
  | { ok: false; error: string; code: "INVALID" | "PORTAL_DISABLED" | "NOT_FOUND" };

function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function getClientPortalLoginPassword(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_LOGIN_PASSWORD?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function contextOmitsSecrets(
  ctx: PortalClientContext
): PortalClientContext {
  return {
    clientAccountId: ctx.clientAccountId,
    clientDisplayName: ctx.clientDisplayName,
    portalDisplayName: ctx.portalDisplayName,
    portalLoginEmail: ctx.portalLoginEmail,
    portalEnabled: ctx.portalEnabled,
    locationName: ctx.locationName,
    subaccountIdGhl: ctx.subaccountIdGhl,
    primaryNicheKeys: ctx.primaryNicheKeys,
    primaryProductTypes: ctx.primaryProductTypes,
    hasPortalPassword: ctx.hasPortalPassword,
    portalSessionEpoch: ctx.portalSessionEpoch,
  };
}

export async function authenticatePortalCustomerLogin(
  loginEmail: string,
  password: string,
  deps: ClientPortalTenantDeps = {}
): Promise<PortalLoginServiceResult> {
  const db: PrismaClient = deps.db ?? defaultPrisma;
  const normalized = loginEmail.trim().toLowerCase();
  if (!normalized || !password) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS, code: "INVALID" };
  }

  const row = await findClientAccountByPortalLoginEmail(normalized, db);
  if (!row) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS, code: "NOT_FOUND" };
  }

  const publicContext = contextOmitsSecrets(presentPortalClientContext(row));
  const epoch = publicContext.portalSessionEpoch;

  if (isPortalPasswordBound(row.portalPasswordHash)) {
    const ok = await verifyPortalPassword(password, row.portalPasswordHash);
    if (!ok) {
      return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS, code: "INVALID" };
    }
    if (!row.portalEnabled) {
      return { ok: false, error: PORTAL_LOGIN_DISABLED, code: "PORTAL_DISABLED" };
    }
    return {
      ok: true,
      passwordCheck: "customer",
      context: publicContext,
      portalSessionEpoch: epoch,
    };
  }

  // Null hash: env password is the migration fallback.
  // If this process has CLIENT_PORTAL_LOGIN_PASSWORD, verify here.
  // If not (env lives only on admin-coc), return env_fallback and let the
  // trusted BFF verify before issuing a session.
  const envPassword = getClientPortalLoginPassword();
  if (envPassword && !timingSafeStringEqual(password, envPassword)) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS, code: "INVALID" };
  }
  return {
    ok: true,
    passwordCheck: "env_fallback",
    context: publicContext,
    portalSessionEpoch: epoch,
  };
}

export type PortalSessionAuthState = {
  clientAccountId: string;
  portalSessionEpoch: number;
  portalEnabled: boolean;
};

export async function getPortalSessionAuthState(
  clientAccountId: string,
  deps: ClientPortalTenantDeps = {}
): Promise<PortalSessionAuthState | null> {
  const db = deps.db ?? defaultPrisma;
  const id = clientAccountId.trim();
  if (!id) return null;
  const row = await db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: {
      clientAccountId: true,
      portalSessionEpoch: true,
      portalEnabled: true,
    },
  });
  if (!row) return null;
  return {
    clientAccountId: row.clientAccountId,
    portalSessionEpoch: row.portalSessionEpoch,
    portalEnabled: row.portalEnabled,
  };
}
