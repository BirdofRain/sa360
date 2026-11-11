import type { FastifyInstance } from "fastify";

import { readStaffGoogleAudience } from "@sa360/shared/staff-google-oidc";
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

import { findStaffPrincipalByGoogleSubject, findStaffPrincipalById } from "../lib/staff-google-directory.js";
import { authorizeStaffSessionPrincipal, resolveProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { verifyStaffGoogleIdToken } from "../lib/staff-google-oidc.js";
import type { ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { claimStaffGoogleStateReplay, type StaffGoogleStateClaim } from "../lib/staff-google-state-replay.js";
import { createRedisStaffSessionRegistry, type StaffSessionRegistry } from "../lib/staff-session-registry.js";
import { claimApprovedStaffInvitation, recordStaffSignIn } from "../lib/staff-team-management.js";
import { STAFF_HOSTED_DOMAIN } from "../lib/staff-team-policy.js";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffGoogleRouteDeps = {
  findByGoogleSubject?: (sub: string) => Promise<ProvisionedStaffPrincipal | null>;
  findById?: (id: string) => Promise<ProvisionedStaffPrincipal | null>;
  verifyIdToken?: typeof verifyStaffGoogleIdToken;
  claimReplay?: (replayId: string) => Promise<StaffGoogleStateClaim>;
  sessionRegistry?: StaffSessionRegistry;
  claimApproved?: typeof claimApprovedStaffInvitation;
  recordSignIn?: typeof recordStaffSignIn;
  env?: NodeJS.ProcessEnv;
};

export async function staffGoogleRoutes(app: FastifyInstance, opts: StaffGoogleRouteDeps = {}): Promise<void> {
  const findByGoogleSubject = opts.findByGoogleSubject ?? findStaffPrincipalByGoogleSubject;
  const findById = opts.findById ?? findStaffPrincipalById;
  const verifyIdToken = opts.verifyIdToken ?? verifyStaffGoogleIdToken;
  const claimReplay = opts.claimReplay ?? claimStaffGoogleStateReplay;
  const sessionRegistry = opts.sessionRegistry ?? createRedisStaffSessionRegistry();
  const claimApproved = opts.claimApproved ?? claimApprovedStaffInvitation;
  const recordSignIn = opts.recordSignIn ?? recordStaffSignIn;
  const env = opts.env ?? process.env;

  app.post("/internal/staff/google/resolve", async (request, reply) => {
    const ready = staffGoogleApiReady(env);
    if (!ready) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply.code(401).send({ ok: false });
    const record = body as Record<string, unknown>;
    if (typeof record.idToken !== "string" || typeof record.nonce !== "string") {
      return reply.code(401).send({ ok: false });
    }
    const verified = await verifyIdToken({
      idToken: record.idToken,
      audience: ready.clientId,
      nonce: record.nonce,
    });
    if (!verified.ok) return reply.code(401).send({ ok: false });
    const principal = await findByGoogleSubject(verified.identity.sub);
    const resolved = resolveProvisionedStaffPrincipal(verified.identity, principal);
    if (!resolved.ok) return reply.code(401).send({ ok: false });
    await recordSignIn({ staffPrincipalId: resolved.staffPrincipalId, googleSub: verified.identity.sub });
    return { ok: true, staffPrincipalId: resolved.staffPrincipalId, googleSub: verified.identity.sub };
  });

  app.post("/internal/staff/google/claim", async (request, reply) => {
    const ready = staffGoogleApiReady(env);
    if (!ready) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply.code(401).send({ ok: false });
    const record = body as Record<string, unknown>;
    if (typeof record.idToken !== "string" || typeof record.nonce !== "string") {
      return reply.code(401).send({ ok: false });
    }
    if ("staffPrincipalId" in record || "enrollmentSecret" in record) return reply.code(401).send({ ok: false });
    const verified = await verifyIdToken({
      idToken: record.idToken,
      audience: ready.clientId,
      nonce: record.nonce,
    });
    if (!verified.ok) return reply.code(401).send({ ok: false });
    const claimed = await claimApproved({
      identity: {
        sub: verified.identity.sub,
        email: verified.identity.email,
        emailVerified: verified.identity.emailVerified,
        hd: verified.identity.hd ?? null,
        name: verified.identity.name ?? null,
      },
      hostedDomain: STAFF_HOSTED_DOMAIN,
    });
    if (!claimed.ok) return reply.code(claimed.code === "unavailable" ? 503 : 401).send({ ok: false });
    return { ok: true, staffPrincipalId: claimed.staffPrincipalId, googleSub: verified.identity.sub };
  });

  app.post("/internal/staff/session", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const presented = verifiedPresentedSession(request.headers[STAFF_SESSION_HEADER], env);
    if (!presented.ok) return reply.code(presented.status).send({ ok: false });
    const registered = await sessionRegistry.read(presented.claims, presented.nowSec);
    if (registered === "unavailable") return reply.code(503).send({ ok: false });
    if (registered !== "active") return reply.code(401).send({ ok: false });
    if (!PRINCIPAL_ID_PATTERN.test(presented.claims.sub)) return reply.code(401).send({ ok: false });
    const principal = await findById(presented.claims.sub);
    const authorized = authorizeStaffSessionPrincipal(
      { staffPrincipalId: presented.claims.sub, googleSub: presented.claims.googleSub },
      principal
    );
    if (!authorized.ok) return reply.code(401).send({ ok: false });
    return { ok: true, staffPrincipalId: authorized.staffPrincipalId };
  });

  app.post("/internal/staff/session/register", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const presented = verifiedPresentedSession(tokenFromBody(request.body), env);
    if (!presented.ok) return reply.code(presented.status).send({ ok: false });
    const principal = await findById(presented.claims.sub);
    const authorized = authorizeStaffSessionPrincipal(
      { staffPrincipalId: presented.claims.sub, googleSub: presented.claims.googleSub },
      principal
    );
    if (!authorized.ok) return reply.code(401).send({ ok: false });
    const registered = await sessionRegistry.register(presented.claims, presented.nowSec);
    if (registered === "registered") return { ok: true };
    if (registered === "rejected") return reply.code(401).send({ ok: false });
    return reply.code(503).send({ ok: false });
  });

  app.post("/internal/staff/session/revoke", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const presented = verifiedPresentedSession(request.headers[STAFF_SESSION_HEADER], env);
    if (!presented.ok) return reply.code(presented.status).send({ ok: false });
    const revoked = await sessionRegistry.revoke(presented.claims, presented.nowSec);
    if (revoked !== "revoked") return reply.code(503).send({ ok: false });
    return { ok: true };
  });

  app.post("/internal/staff/google/state/consume", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const replayId = readReplayId(request.body);
    if (!replayId) return reply.code(401).send({ ok: false });
    const claimed = await claimReplay(replayId);
    if (claimed === "claimed") return { ok: true };
    if (claimed === "reused") return reply.code(401).send({ ok: false });
    return reply.code(503).send({ ok: false });
  });
}

function staffGoogleApiReady(env: NodeJS.ProcessEnv): { clientId: string } | null {
  const audience = readStaffGoogleAudience(env);
  if (!audience || !sessionSecretReady(env) || !readStaffGoogleServiceSecret(env)) return null;
  return audience;
}

function serviceHeaderAccepted(env: NodeJS.ProcessEnv, presented: string): boolean {
  const expected = readStaffGoogleServiceSecret(env);
  if (!expected) return false;
  return staffGoogleServiceHeaderMatches(presented, expected);
}

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
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

function tokenFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const token = (body as Record<string, unknown>).token;
  return typeof token === "string" ? token : undefined;
}

function readReplayId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const replayId = (body as Record<string, unknown>).replayId;
  return typeof replayId === "string" && /^[a-f0-9]{64}$/.test(replayId) ? replayId : null;
}

function sessionSecretReady(env: NodeJS.ProcessEnv): boolean {
  try {
    readStaffSessionSecret(env);
    return true;
  } catch {
    return false;
  }
}
