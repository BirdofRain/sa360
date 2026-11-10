import type { FastifyInstance } from "fastify";

import { readStaffGoogleAudience } from "@sa360/shared/staff-google-oidc";
import { readStaffSessionSecret, STAFF_SESSION_HEADER, verifyStaffSession } from "@sa360/shared/staff-google-session";
import {
  readStaffGoogleServiceSecret,
  STAFF_GOOGLE_SERVICE_HEADER,
  staffGoogleServiceHeaderMatches,
} from "@sa360/shared/staff-google-service";

import { findStaffPrincipalByGoogleSubject, findStaffPrincipalById } from "../lib/staff-google-directory.js";
import { authorizeStaffSessionPrincipal, resolveProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { verifyStaffGoogleIdToken } from "../lib/staff-google-oidc.js";
import type { ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffGoogleRouteDeps = {
  findByGoogleSubject?: (sub: string) => Promise<ProvisionedStaffPrincipal | null>;
  findById?: (id: string) => Promise<ProvisionedStaffPrincipal | null>;
  verifyIdToken?: typeof verifyStaffGoogleIdToken;
  env?: NodeJS.ProcessEnv;
};

export async function staffGoogleRoutes(app: FastifyInstance, opts: StaffGoogleRouteDeps = {}): Promise<void> {
  const findByGoogleSubject = opts.findByGoogleSubject ?? findStaffPrincipalByGoogleSubject;
  const findById = opts.findById ?? findStaffPrincipalById;
  const verifyIdToken = opts.verifyIdToken ?? verifyStaffGoogleIdToken;
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
    return { ok: true, staffPrincipalId: resolved.staffPrincipalId, googleSub: verified.identity.sub };
  });

  app.post("/internal/staff/session", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const header = request.headers[STAFF_SESSION_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    if (typeof token !== "string" || token.length === 0) return reply.code(401).send({ ok: false });
    const session = verifyStaffSession(token, { env });
    if (!session.ok) {
      const status = session.code === "secret_unavailable" ? 404 : 401;
      return reply.code(status).send({ ok: false });
    }
    if (!PRINCIPAL_ID_PATTERN.test(session.claims.sub)) return reply.code(401).send({ ok: false });
    const principal = await findById(session.claims.sub);
    const authorized = authorizeStaffSessionPrincipal(
      { staffPrincipalId: session.claims.sub, googleSub: session.claims.googleSub },
      principal
    );
    if (!authorized.ok) return reply.code(401).send({ ok: false });
    return { ok: true, staffPrincipalId: authorized.staffPrincipalId };
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

function sessionSecretReady(env: NodeJS.ProcessEnv): boolean {
  try {
    readStaffSessionSecret(env);
    return true;
  } catch {
    return false;
  }
}
