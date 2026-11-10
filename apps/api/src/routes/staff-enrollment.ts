import type { FastifyInstance } from "fastify";

import { readStaffGoogleClientId } from "@sa360/shared/staff-google-oidc";
import {
  readStaffEnrollmentIssuerSecret,
  STAFF_ENROLLMENT_ISSUER_HEADER,
  staffEnrollmentEnabled,
  staffEnrollmentIssuerHeaderMatches,
} from "@sa360/shared/staff-enrollment";
import {
  readStaffGoogleServiceSecret,
  STAFF_GOOGLE_SERVICE_HEADER,
  staffGoogleServiceHeaderMatches,
} from "@sa360/shared/staff-google-service";

import { claimStaffGoogleStateReplay, type StaffGoogleStateClaim } from "../lib/staff-google-state-replay.js";
import { verifyStaffGoogleIdToken } from "../lib/staff-google-oidc.js";
import {
  bindStaffEnrollment,
  cancelStaffEnrollment,
  disableStaffPrincipal,
  issueStaffEnrollment,
  previewStaffEnrollment,
  provisionUnboundStaffPrincipal,
  readStaffEnrollmentStatus,
} from "../lib/staff-enrollment.js";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffEnrollmentRouteDeps = {
  env?: NodeJS.ProcessEnv;
  provision?: typeof provisionUnboundStaffPrincipal;
  issue?: typeof issueStaffEnrollment;
  cancel?: typeof cancelStaffEnrollment;
  disable?: typeof disableStaffPrincipal;
  status?: typeof readStaffEnrollmentStatus;
  preview?: typeof previewStaffEnrollment;
  bind?: typeof bindStaffEnrollment;
  verifyIdToken?: typeof verifyStaffGoogleIdToken;
  claimReplay?: (replayId: string) => Promise<StaffGoogleStateClaim>;
};

export async function staffEnrollmentRoutes(app: FastifyInstance, opts: StaffEnrollmentRouteDeps = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const provision = opts.provision ?? provisionUnboundStaffPrincipal;
  const issue = opts.issue ?? issueStaffEnrollment;
  const cancel = opts.cancel ?? cancelStaffEnrollment;
  const disable = opts.disable ?? disableStaffPrincipal;
  const status = opts.status ?? readStaffEnrollmentStatus;
  const preview = opts.preview ?? previewStaffEnrollment;
  const bind = opts.bind ?? bindStaffEnrollment;
  const verifyIdToken = opts.verifyIdToken ?? verifyStaffGoogleIdToken;
  const claimReplay = opts.claimReplay ?? claimStaffGoogleStateReplay;

  app.post("/internal/staff/enrollment/provision", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    if (!body || typeof body.email !== "string") return reply.code(401).send({ ok: false });
    const displayName = body.displayName;
    if (displayName != null && typeof displayName !== "string") return reply.code(401).send({ ok: false });
    const created = await provision({ email: body.email, displayName });
    if (!created.ok) return reply.code(created.code === "unavailable" ? 503 : 401).send({ ok: false });
    return { ok: true, staffPrincipalId: created.staffPrincipalId };
  });

  app.post("/internal/staff/enrollment/issue", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    const staffPrincipalId = body && typeof body.staffPrincipalId === "string" ? body.staffPrincipalId : "";
    if (!PRINCIPAL_ID_PATTERN.test(staffPrincipalId)) return reply.code(401).send({ ok: false });
    const issued = await issue({ staffPrincipalId });
    if (!issued.ok) return reply.code(issued.code === "unavailable" ? 503 : 401).send({ ok: false });
    return {
      ok: true,
      staffPrincipalId: issued.staffPrincipalId,
      grantId: issued.grantId,
      expiresAt: issued.expiresAt.toISOString(),
      enrollmentSecret: issued.enrollmentSecret,
    };
  });

  app.post("/internal/staff/enrollment/cancel", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    const grantId = body && typeof body.grantId === "string" ? body.grantId : "";
    const canceled = await cancel({ grantId });
    if (!canceled.ok) return reply.code(canceled.code === "unavailable" ? 503 : 401).send({ ok: false });
    return { ok: true };
  });

  app.post("/internal/staff/enrollment/disable", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    const staffPrincipalId = body && typeof body.staffPrincipalId === "string" ? body.staffPrincipalId : "";
    const disabled = await disable({ staffPrincipalId });
    if (!disabled.ok) return reply.code(disabled.code === "unavailable" ? 503 : 401).send({ ok: false });
    return { ok: true, staffPrincipalId: disabled.staffPrincipalId };
  });

  app.post("/internal/staff/enrollment/status", async (request, reply) => {
    if (!issuerReady(env)) return reply.code(404).send({ ok: false });
    if (!issuerAccepted(env, headerValue(request.headers[STAFF_ENROLLMENT_ISSUER_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    const staffPrincipalId = body && typeof body.staffPrincipalId === "string" ? body.staffPrincipalId : "";
    const current = await status({ staffPrincipalId });
    if (!current.ok) return reply.code(current.code === "unavailable" ? 503 : 401).send({ ok: false });
    return current;
  });

  app.post("/internal/staff/enrollment/preview", async (request, reply) => {
    if (!enrollmentReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    const enrollmentSecret = body && typeof body.enrollmentSecret === "string" ? body.enrollmentSecret : "";
    const opened = await preview({ enrollmentSecret });
    if (!opened.ok) return reply.code(opened.code === "unavailable" ? 503 : 401).send({ ok: false });
    return { ok: true };
  });

  app.post("/internal/staff/enrollment/complete", async (request, reply) => {
    const ready = enrollmentReady(env);
    if (!ready) return reply.code(404).send({ ok: false });
    if (!serviceAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const body = recordBody(request.body);
    const enrollmentSecret = body && typeof body.enrollmentSecret === "string" ? body.enrollmentSecret : "";
    const idToken = body && typeof body.idToken === "string" ? body.idToken : "";
    const nonce = body && typeof body.nonce === "string" ? body.nonce : "";
    if (!enrollmentSecret || !idToken || !nonce) return reply.code(401).send({ ok: false });
    const verified = await verifyIdToken({ idToken, audience: ready.clientId, nonce });
    if (!verified.ok) return reply.code(401).send({ ok: false });
    const bound = await bind({
      enrollmentSecret,
      identity: {
        sub: verified.identity.sub,
        email: verified.identity.email,
        emailVerified: verified.identity.emailVerified,
      },
    });
    if (!bound.ok) return reply.code(bound.code === "unavailable" ? 503 : 401).send({ ok: false });
    return { ok: true, staffPrincipalId: bound.staffPrincipalId };
  });

  app.post("/internal/staff/enrollment/state/consume", async (request, reply) => {
    if (!enrollmentReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
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

function enrollmentReady(env: NodeJS.ProcessEnv): { clientId: string } | null {
  if (!staffEnrollmentEnabled(env)) return null;
  const clientId = readStaffGoogleClientId(env);
  if (!clientId || !readStaffGoogleServiceSecret(env)) return null;
  return { clientId };
}

function issuerReady(env: NodeJS.ProcessEnv): boolean {
  return enrollmentReady(env) !== null && readStaffEnrollmentIssuerSecret(env) !== null;
}

function issuerAccepted(env: NodeJS.ProcessEnv, presented: string): boolean {
  const expected = readStaffEnrollmentIssuerSecret(env);
  if (!expected) return false;
  return staffEnrollmentIssuerHeaderMatches(presented, expected);
}

function serviceAccepted(env: NodeJS.ProcessEnv, presented: string): boolean {
  const expected = readStaffGoogleServiceSecret(env);
  if (!expected) return false;
  return staffGoogleServiceHeaderMatches(presented, expected);
}

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

function recordBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function readReplayId(body: unknown): string | null {
  const record = recordBody(body);
  const replayId = record?.replayId;
  return typeof replayId === "string" && /^[a-f0-9]{64}$/.test(replayId) ? replayId : null;
}
