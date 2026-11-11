import type { FastifyInstance } from "fastify";

import { readStaffGoogleAudience } from "@sa360/shared/staff-google-oidc";
import { readStaffEnrollmentIssuerSecret, STAFF_ENROLLMENT_ISSUER_HEADER, staffEnrollmentIssuerHeaderMatches } from "@sa360/shared/staff-enrollment";
import {
  readStaffSessionSecret,
  STAFF_SESSION_HEADER,
  verifyStaffSession,
  type StaffSessionClaims,
} from "@sa360/shared/staff-google-session";
import {
  readStaffGoogleServiceSecret,
  STAFF_GOOGLE_SERVICE_HEADER,
  staffGoogleServiceHeaderMatches,
} from "@sa360/shared/staff-google-service";

import { findStaffPrincipalById } from "../lib/staff-google-directory.js";
import { authorizeStaffSessionPrincipal, type ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import {
  grantStaffAdminCoc,
  readStaffAdminCocStatus,
  revokeStaffAdminCoc,
  staffAdminCocAllows,
  type StaffAdminCocCode,
} from "../lib/staff-admin-coc.js";
import { createRedisStaffSessionRegistry, type StaffSessionRegistry } from "../lib/staff-session-registry.js";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffAdminCocRouteDeps = {
  env?: NodeJS.ProcessEnv;
  findById?: (id: string) => Promise<ProvisionedStaffPrincipal | null>;
  sessionRegistry?: StaffSessionRegistry;
  allows?: typeof staffAdminCocAllows;
  grant?: typeof grantStaffAdminCoc;
  revoke?: typeof revokeStaffAdminCoc;
  status?: typeof readStaffAdminCocStatus;
};

/**
 * Admin C.O.C. authorization for a Google staff session.
 * Authorize checks the live session and the admin_coc grant.
 * Grant and revoke require the enrollment issuer secret. A staff session,
 * the service secret, and the shared admin API key cannot grant or revoke.
 */
export async function staffAdminCocRoutes(app: FastifyInstance, opts: StaffAdminCocRouteDeps = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const findById = opts.findById ?? findStaffPrincipalById;
  const sessionRegistry = opts.sessionRegistry ?? createRedisStaffSessionRegistry();
  const allows = opts.allows ?? staffAdminCocAllows;
  const grant = opts.grant ?? grantStaffAdminCoc;
  const revoke = opts.revoke ?? revokeStaffAdminCoc;
  const status = opts.status ?? readStaffAdminCocStatus;

  app.post("/internal/staff/admin-coc/authorize", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const presented = verifiedPresentedSession(request.headers[STAFF_SESSION_HEADER], env);
    if (!presented.ok) return reply.code(presented.status).send({ ok: false });
    const registered = await sessionRegistry.read(presented.claims, presented.nowSec);
    if (registered === "unavailable") return reply.code(503).send({ ok: false });
    if (registered !== "active") return reply.code(401).send({ ok: false });
    const principal = await findById(presented.claims.sub);
    const identity = authorizeStaffSessionPrincipal(
      { staffPrincipalId: presented.claims.sub, googleSub: presented.claims.googleSub },
      principal
    );
    if (!identity.ok) return reply.code(401).send({ ok: false });
    const grantState = await allows({
      staffPrincipalId: identity.staffPrincipalId,
      googleSub: presented.claims.googleSub,
    });
    if (grantState === "unavailable") return reply.code(503).send({ ok: false });
    if (grantState !== "allowed") return reply.code(403).send({ ok: false });
    return { ok: true, staffPrincipalId: identity.staffPrincipalId };
  });

  app.post("/internal/staff/admin-coc/status", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const staffPrincipalId = principalIdFromBody(request.body);
    if (!staffPrincipalId) return reply.code(401).send({ ok: false });
    const current = await status({ staffPrincipalId });
    if (!current.ok) return reply.code(current.code === "unavailable" ? 503 : 401).send({ ok: false });
    return current;
  });

  app.post("/internal/staff/admin-coc/grant", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = matchedGrantBody(request.body);
    if (!body) return reply.code(401).send({ ok: false });
    const granted = await grant(body);
    if (!granted.ok) return reply.code(httpStatus(granted.code)).send({ ok: false });
    return {
      ok: true,
      alreadyGranted: granted.alreadyGranted,
      staffPermissionId: granted.grant.staffPermissionId,
      staffPrincipalId: granted.grant.staffPrincipalId,
      email: granted.grant.email,
      permission: granted.grant.permission,
      status: granted.grant.status,
      grantedAt: granted.grant.grantedAt.toISOString(),
    };
  });

  app.post("/internal/staff/admin-coc/revoke", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = matchedGrantBody(request.body);
    if (!body) return reply.code(401).send({ ok: false });
    const revoked = await revoke(body);
    if (!revoked.ok) return reply.code(httpStatus(revoked.code)).send({ ok: false });
    return {
      ok: true,
      staffPermissionId: revoked.grant.staffPermissionId,
      staffPrincipalId: revoked.grant.staffPrincipalId,
      email: revoked.grant.email,
      permission: revoked.grant.permission,
      status: revoked.grant.status,
      revokedAt: revoked.grant.revokedAt?.toISOString() ?? null,
    };
  });
}

function staffGoogleApiReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(readStaffGoogleAudience(env) && sessionSecretReady(env) && readStaffGoogleServiceSecret(env));
}

function issuerReady(env: NodeJS.ProcessEnv): boolean {
  return readStaffEnrollmentIssuerSecret(env) !== null;
}

function issuerAccepted(env: NodeJS.ProcessEnv, presented: string): boolean {
  const expected = readStaffEnrollmentIssuerSecret(env);
  if (!expected) return false;
  return staffEnrollmentIssuerHeaderMatches(presented, expected);
}

function serviceHeaderAccepted(env: NodeJS.ProcessEnv, presented: string): boolean {
  const expected = readStaffGoogleServiceSecret(env);
  if (!expected) return false;
  return staffGoogleServiceHeaderMatches(presented, expected);
}

function verifiedPresentedSession(
  header: string | string[] | undefined,
  env: NodeJS.ProcessEnv
): { ok: true; claims: StaffSessionClaims; nowSec: number } | { ok: false; status: 401 | 404 } {
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== "string" || token.length === 0) return { ok: false, status: 401 };
  const nowSec = Math.floor(Date.now() / 1000);
  const session = verifyStaffSession(token, { env, nowSec });
  if (!session.ok) return { ok: false, status: session.code === "secret_unavailable" ? 404 : 401 };
  return { ok: true, claims: session.claims, nowSec };
}

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

function recordBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function principalIdFromBody(body: unknown): string | null {
  const record = recordBody(body);
  const staffPrincipalId = record?.staffPrincipalId;
  return typeof staffPrincipalId === "string" && PRINCIPAL_ID_PATTERN.test(staffPrincipalId) ? staffPrincipalId : null;
}

function matchedGrantBody(body: unknown): { staffPrincipalId: string; email: string } | null {
  const record = recordBody(body);
  if (!record || typeof record.staffPrincipalId !== "string" || typeof record.email !== "string") return null;
  if (!PRINCIPAL_ID_PATTERN.test(record.staffPrincipalId)) return null;
  return { staffPrincipalId: record.staffPrincipalId, email: record.email };
}

function sessionSecretReady(env: NodeJS.ProcessEnv): boolean {
  try {
    readStaffSessionSecret(env);
    return true;
  } catch {
    return false;
  }
}

function httpStatus(code: StaffAdminCocCode): 401 | 503 {
  return code === "unavailable" ? 503 : 401;
}
