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

import { findStaffPrincipalById } from "../lib/staff-google-directory.js";
import { authorizeStaffSessionPrincipal, type ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { staffAdminCocAllows } from "../lib/staff-admin-coc.js";
import { createRedisStaffSessionRegistry, type StaffSessionRegistry } from "../lib/staff-session-registry.js";
import {
  changeStaffAccess,
  disableStaffTeamMember,
  inviteStaffMember,
  listStaffTeam,
  readGrantedStaffPermissions,
  readStaffActivity,
  readStaffTeamMember,
  renewStaffInvitation,
  revokeStaffAccess,
  type StaffTeamCode,
  type StaffTeamMember,
} from "../lib/staff-team-management.js";
import { isStaffAccessLevel, type StaffAccessLevel } from "../lib/staff-team-policy.js";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffTeamRouteDeps = {
  env?: NodeJS.ProcessEnv;
  findById?: (id: string) => Promise<ProvisionedStaffPrincipal | null>;
  sessionRegistry?: StaffSessionRegistry;
  allows?: typeof staffAdminCocAllows;
  list?: typeof listStaffTeam;
  invite?: typeof inviteStaffMember;
  read?: typeof readStaffTeamMember;
  activity?: typeof readStaffActivity;
  changeAccess?: typeof changeStaffAccess;
  revoke?: typeof revokeStaffAccess;
  disable?: typeof disableStaffTeamMember;
  renew?: typeof renewStaffInvitation;
  permissions?: typeof readGrantedStaffPermissions;
};

/**
 * Staff team administration.
 * Every mutation requires a live staff session with an active admin_coc grant.
 * The shared admin API key, the shared-password cookie, and the enrollment
 * issuer secret are not accepted.
 */
export async function staffTeamRoutes(app: FastifyInstance, opts: StaffTeamRouteDeps = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const findById = opts.findById ?? findStaffPrincipalById;
  const sessionRegistry = opts.sessionRegistry ?? createRedisStaffSessionRegistry();
  const allows = opts.allows ?? staffAdminCocAllows;
  const list = opts.list ?? listStaffTeam;
  const invite = opts.invite ?? inviteStaffMember;
  const read = opts.read ?? readStaffTeamMember;
  const activity = opts.activity ?? readStaffActivity;
  const changeAccess = opts.changeAccess ?? changeStaffAccess;
  const revoke = opts.revoke ?? revokeStaffAccess;
  const disable = opts.disable ?? disableStaffTeamMember;
  const renew = opts.renew ?? renewStaffInvitation;
  const permissions = opts.permissions ?? readGrantedStaffPermissions;

  app.post("/internal/staff/session/capabilities", async (request, reply) => {
    if (!staffGoogleApiReady(env)) return reply.code(404).send({ ok: false });
    if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
      return reply.code(401).send({ ok: false });
    }
    const actor = await livePrincipal(request.headers[STAFF_SESSION_HEADER], env, sessionRegistry, findById);
    if (!actor.ok) return reply.code(actor.status).send({ ok: false });
    const granted = await permissions({ staffPrincipalId: actor.staffPrincipalId });
    if (!granted) return reply.code(503).send({ ok: false });
    const access = granted.includes("admin_coc") ? "admin" : granted.includes("team_workspace") ? "workspace" : "limited";
    return { ok: true, access, permissions: granted, staffPrincipalId: actor.staffPrincipalId };
  });

  app.post("/internal/staff/team/members", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const listed = await list();
    if (!listed.ok) return reply.code(503).send({ ok: false, code: "unavailable" });
    return { ok: true, members: listed.members };
  });

  app.post("/internal/staff/team/members/create", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const body = recordBody(request.body);
    const accessLevel = body?.accessLevel;
    if (!body || typeof body.email !== "string" || !isStaffAccessLevel(accessLevel)) {
      return reply.code(400).send({ ok: false, code: "rejected" });
    }
    const created = await invite({
      actorStaffPrincipalId: actor.staffPrincipalId,
      email: body.email,
      accessLevel,
      confirmAdministrator: body.confirmAdministrator === true,
      signInUrl: typeof body.signInUrl === "string" ? body.signInUrl : null,
    });
    if (!created.ok) return reply.code(statusFor(created.code)).send({ ok: false, code: created.code });
    return {
      ok: true,
      member: created.member,
      emailDelivery: created.emailDelivery,
      emailDetail: created.emailDetail,
    };
  });

  app.post("/internal/staff/team/members/get", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const staffPrincipalId = principalIdFromBody(request.body);
    const email = emailFromBody(request.body);
    if (!staffPrincipalId || !email) return reply.code(400).send({ ok: false, code: "rejected" });
    const member = await read({ staffPrincipalId });
    if (!member || member.email !== email.trim().toLowerCase()) return reply.code(404).send({ ok: false, code: "rejected" });
    const history = await activity({ staffPrincipalId });
    if (!history.ok) return reply.code(503).send({ ok: false, code: "unavailable" });
    return { ok: true, member, activity: history.entries };
  });

  app.post("/internal/staff/team/members/access", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const target = matchedTarget(request.body);
    const accessLevel = recordBody(request.body)?.accessLevel;
    if (!target || !isStaffAccessLevel(accessLevel)) return reply.code(400).send({ ok: false, code: "rejected" });
    const changed = await changeAccess({
      actorStaffPrincipalId: actor.staffPrincipalId,
      staffPrincipalId: target.staffPrincipalId,
      email: target.email,
      accessLevel: accessLevel as StaffAccessLevel,
      confirmAdministrator: recordBody(request.body)?.confirmAdministrator === true,
    });
    return mutation(reply, changed);
  });

  app.post("/internal/staff/team/members/revoke", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const target = confirmedTarget(request.body);
    if (!target) return reply.code(400).send({ ok: false, code: "rejected" });
    const revoked = await revoke({
      actorStaffPrincipalId: actor.staffPrincipalId,
      staffPrincipalId: target.staffPrincipalId,
      email: target.email,
    });
    return mutation(reply, revoked);
  });

  app.post("/internal/staff/team/members/disable", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const target = confirmedTarget(request.body);
    if (!target) return reply.code(400).send({ ok: false, code: "rejected" });
    const disabled = await disable({
      actorStaffPrincipalId: actor.staffPrincipalId,
      staffPrincipalId: target.staffPrincipalId,
      email: target.email,
    });
    return mutation(reply, disabled);
  });

  app.post("/internal/staff/team/members/invitation/renew", async (request, reply) => {
    const actor = await requireAdministrator(request, reply, env, sessionRegistry, findById, allows);
    if (!actor) return;
    const target = matchedTarget(request.body);
    if (!target) return reply.code(400).send({ ok: false, code: "rejected" });
    const body = recordBody(request.body);
    const renewed = await renew({
      actorStaffPrincipalId: actor.staffPrincipalId,
      staffPrincipalId: target.staffPrincipalId,
      email: target.email,
      signInUrl: typeof body?.signInUrl === "string" ? body.signInUrl : null,
    });
    if (!renewed.ok) return reply.code(statusFor(renewed.code)).send({ ok: false, code: renewed.code });
    return { ok: true, member: renewed.member, emailDelivery: renewed.emailDelivery, emailDetail: renewed.emailDetail };
  });
}

async function requireAdministrator(
  request: { headers: Record<string, string | string[] | undefined>; body?: unknown },
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  env: NodeJS.ProcessEnv,
  sessionRegistry: StaffSessionRegistry,
  findById: (id: string) => Promise<ProvisionedStaffPrincipal | null>,
  allows: typeof staffAdminCocAllows
): Promise<{ staffPrincipalId: string } | null> {
  if (!staffGoogleApiReady(env)) {
    reply.code(404).send({ ok: false });
    return null;
  }
  if (!serviceHeaderAccepted(env, headerValue(request.headers[STAFF_GOOGLE_SERVICE_HEADER]))) {
    reply.code(401).send({ ok: false });
    return null;
  }
  const actor = await livePrincipal(request.headers[STAFF_SESSION_HEADER], env, sessionRegistry, findById);
  if (!actor.ok) {
    reply.code(actor.status).send({ ok: false });
    return null;
  }
  const grant = await allows({ staffPrincipalId: actor.staffPrincipalId, googleSub: actor.googleSub });
  if (grant === "unavailable") {
    reply.code(503).send({ ok: false, code: "unavailable" });
    return null;
  }
  if (grant !== "allowed") {
    reply.code(403).send({ ok: false, code: "forbidden" });
    return null;
  }
  return { staffPrincipalId: actor.staffPrincipalId };
}

async function livePrincipal(
  header: string | string[] | undefined,
  env: NodeJS.ProcessEnv,
  sessionRegistry: StaffSessionRegistry,
  findById: (id: string) => Promise<ProvisionedStaffPrincipal | null>
): Promise<{ ok: true; staffPrincipalId: string; googleSub: string } | { ok: false; status: 401 | 404 | 503 }> {
  const presented = verifiedPresentedSession(header, env);
  if (!presented.ok) return presented;
  const registered = await sessionRegistry.read(presented.claims, presented.nowSec);
  if (registered === "unavailable") return { ok: false, status: 503 };
  if (registered !== "active") return { ok: false, status: 401 };
  const principal = await findById(presented.claims.sub);
  const identity = authorizeStaffSessionPrincipal(
    { staffPrincipalId: presented.claims.sub, googleSub: presented.claims.googleSub },
    principal
  );
  if (!identity.ok) return { ok: false, status: 401 };
  return { ok: true, staffPrincipalId: identity.staffPrincipalId, googleSub: presented.claims.googleSub };
}

function mutation(
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  result: { ok: true; member: StaffTeamMember } | { ok: false; code: StaffTeamCode }
) {
  if (!result.ok) return reply.code(statusFor(result.code)).send({ ok: false, code: result.code });
  return { ok: true, member: result.member };
}

function statusFor(code: StaffTeamCode): 400 | 401 | 409 | 503 {
  if (code === "unavailable") return 503;
  if (code === "duplicate") return 409;
  if (code === "confirmation_required" || code === "rejected") return 400;
  return 401;
}

function staffGoogleApiReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(readStaffGoogleAudience(env) && sessionSecretReady(env) && readStaffGoogleServiceSecret(env));
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

function emailFromBody(body: unknown): string | null {
  const email = recordBody(body)?.email;
  return typeof email === "string" ? email : null;
}

function matchedTarget(body: unknown): { staffPrincipalId: string; email: string } | null {
  const staffPrincipalId = principalIdFromBody(body);
  const email = emailFromBody(body);
  if (!staffPrincipalId || !email) return null;
  return { staffPrincipalId, email };
}

function confirmedTarget(body: unknown): { staffPrincipalId: string; email: string } | null {
  const target = matchedTarget(body);
  if (!target || recordBody(body)?.confirm !== true) return null;
  return target;
}

function sessionSecretReady(env: NodeJS.ProcessEnv): boolean {
  try {
    readStaffSessionSecret(env);
    return true;
  } catch {
    return false;
  }
}
