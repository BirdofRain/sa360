import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "./db.js";
import { sendTransactionalEmail, type SendTransactionalEmailResult } from "./transactional-email.js";
import {
  STAFF_HOSTED_DOMAIN,
  STAFF_INVITATION_TTL_MS,
  STAFF_MANAGED_PERMISSIONS,
  accessLevelFromPermissions,
  hostedDomainMatches,
  invitationDisplayStatus,
  isStaffAccessLevel,
  normalizeCompanyEmail,
  parseStaffSignInUrl,
  permissionsForAccessLevel,
  staffAccountStatus,
  type StaffAccessLevel,
  type StaffAccountStatus,
  type StaffManagedPermission,
} from "./staff-team-policy.js";

/**
 * Administrator-approved staff invitations and the first Google binding.
 * Callers that accept HTTP must already have proven a live admin_coc staff
 * session. This module does not accept the shared admin API key or the
 * enrollment issuer secret, and it never grants facebook_association_correction.
 */

const MANAGED_PERMISSIONS: ReadonlySet<string> = new Set(STAFF_MANAGED_PERMISSIONS);

function asManaged(permission: string): StaffManagedPermission | null {
  return MANAGED_PERMISSIONS.has(permission) ? (permission as StaffManagedPermission) : null;
}

const SUB_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
const PRINCIPAL_PATTERN = /^c[a-z0-9]{24}$/;
const DETAIL_PATTERN = /^[a-z0-9_]{1,80}$/;

export type StaffTeamCode =
  | "rejected"
  | "duplicate"
  | "confirmation_required"
  | "disabled"
  | "expired"
  | "canceled"
  | "already_bound"
  | "unverified_email"
  | "workspace_mismatch"
  | "email_mismatch"
  | "not_invited"
  | "collision"
  | "unavailable";

export type StaffClaimIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  hd?: string | null;
  name?: string | null;
};

export type StaffTeamMember = {
  staffPrincipalId: string;
  email: string;
  displayName: string | null;
  accountStatus: StaffAccountStatus;
  invitationStatus: "none" | "pending" | "expired" | "consumed" | "canceled";
  accessLevel: StaffAccessLevel | "none";
  permissions: StaffManagedPermission[];
  bound: boolean;
  lastLoginAt: string | null;
  invitationExpiresAt: string | null;
  emailDelivery: "sent" | "not_sent" | "unknown";
};

export type StaffActivityEntry = {
  id: string;
  kind: string;
  detail: string | null;
  actorStaffPrincipalId: string | null;
  createdAt: string;
};

type TeamDb = PrismaClient;
type SendEmail = (
  input: { to: string; subject: string; text: string; idempotencyKey?: string }
) => Promise<SendTransactionalEmailResult>;

class TeamAbort extends Error {
  constructor(readonly code: StaffTeamCode) {
    super(code);
    this.name = "TeamAbort";
  }
}

export async function inviteStaffMember(
  input: {
    actorStaffPrincipalId: string;
    email: string;
    accessLevel: StaffAccessLevel;
    confirmAdministrator?: boolean;
    signInUrl?: string | null;
    now?: Date;
    sendEmail?: SendEmail;
  },
  db: TeamDb = defaultPrisma
): Promise<
  | {
      ok: true;
      member: StaffTeamMember;
      emailDelivery: "sent" | "not_sent";
      emailDetail: "sent" | "not_configured" | "delivery_failed" | "link_unavailable";
    }
  | { ok: false; code: StaffTeamCode }
> {
  const email = normalizeCompanyEmail(input.email);
  if (!email || !PRINCIPAL_PATTERN.test(input.actorStaffPrincipalId) || !isStaffAccessLevel(input.accessLevel)) {
    return { ok: false, code: "rejected" };
  }
  if (input.accessLevel === "administrator" && input.confirmAdministrator !== true) {
    return { ok: false, code: "confirmation_required" };
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + STAFF_INVITATION_TTL_MS);
  const signInUrl = parseStaffSignInUrl(input.signInUrl);
  try {
    const created = await db.$transaction(async (tx) => {
      const actor = await lockPrincipal(tx, input.actorStaffPrincipalId);
      if (!actor || actor.status !== "active" || actor.disabledAt != null) throw new TeamAbort("rejected");
      const duplicate = await tx.staffPrincipal.findUnique({ where: { email }, select: { id: true } });
      if (duplicate) throw new TeamAbort("duplicate");
      const principal = await tx.staffPrincipal.create({
        data: {
          email,
          displayName: null,
          status: "active",
          disabledAt: null,
          provider: "google",
          providerSubject: null,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await grantDesired(tx, principal.id, permissionsForAccessLevel(input.accessLevel), now);
      const invitation = await tx.staffInvitation.create({
        data: {
          staffPrincipalId: principal.id,
          email,
          accessLevel: input.accessLevel,
          status: "pending",
          expiresAt,
          invitedByStaffPrincipalId: actor.id,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await writeEvent(tx, {
        staffPrincipalId: principal.id,
        actorStaffPrincipalId: actor.id,
        kind: "invited",
        detail: input.accessLevel,
        now,
      });
      return { staffPrincipalId: principal.id, invitationId: invitation.id };
    });
    const delivery = await deliverInvitation({
      db,
      staffPrincipalId: created.staffPrincipalId,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      email,
      accessLevel: input.accessLevel,
      signInUrl,
      expiresAt,
      idempotencyKey: `staff-invite:${created.invitationId}`,
      sendEmail: input.sendEmail,
      now,
    });
    const member = await readStaffTeamMember({ staffPrincipalId: created.staffPrincipalId, now }, db);
    if (!member) return { ok: false, code: "unavailable" };
    return { ok: true, member, emailDelivery: delivery.emailDelivery, emailDetail: delivery.emailDetail };
  } catch (err) {
    return failure(err);
  }
}

export async function listStaffTeam(
  input: { now?: Date } = {},
  db: TeamDb = defaultPrisma
): Promise<{ ok: true; members: StaffTeamMember[] } | { ok: false; code: StaffTeamCode }> {
  try {
    const now = input.now ?? new Date();
    const rows = await db.staffPrincipal.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        permissions: { where: { status: "granted", revokedAt: null } },
        invitations: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const ids = rows.map((row) => row.id);
    const [logins, emails] = await Promise.all([
      latestEvents(db, ids, ["signed_in", "invitation_consumed"]),
      latestEvents(db, ids, ["invitation_email_sent", "invitation_email_skipped"]),
    ]);
    return {
      ok: true,
      members: rows.map((row) => toMember(row, logins.get(row.id) ?? null, emails.get(row.id) ?? null, now)),
    };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function readStaffTeamMember(
  input: { staffPrincipalId: string; now?: Date },
  db: TeamDb = defaultPrisma
): Promise<StaffTeamMember | null> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return null;
  const listed = await listStaffTeam({ now: input.now }, db);
  if (!listed.ok) return null;
  return listed.members.find((member) => member.staffPrincipalId === input.staffPrincipalId) ?? null;
}

export async function readStaffActivity(
  input: { staffPrincipalId: string },
  db: TeamDb = defaultPrisma
): Promise<{ ok: true; entries: StaffActivityEntry[] } | { ok: false; code: StaffTeamCode }> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return { ok: false, code: "rejected" };
  try {
    const rows = await db.staffManagementEvent.findMany({
      where: { staffPrincipalId: input.staffPrincipalId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, kind: true, detail: true, actorStaffPrincipalId: true, createdAt: true },
    });
    return {
      ok: true,
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        detail: row.detail,
        actorStaffPrincipalId: row.actorStaffPrincipalId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function changeStaffAccess(
  input: {
    actorStaffPrincipalId: string;
    staffPrincipalId: string;
    email: string;
    accessLevel: StaffAccessLevel;
    confirmAdministrator?: boolean;
    now?: Date;
  },
  db: TeamDb = defaultPrisma
): Promise<{ ok: true; member: StaffTeamMember } | { ok: false; code: StaffTeamCode }> {
  const email = normalizeCompanyEmail(input.email);
  if (
    !email ||
    !PRINCIPAL_PATTERN.test(input.actorStaffPrincipalId) ||
    !PRINCIPAL_PATTERN.test(input.staffPrincipalId) ||
    !isStaffAccessLevel(input.accessLevel)
  ) {
    return { ok: false, code: "rejected" };
  }
  if (input.accessLevel === "administrator" && input.confirmAdministrator !== true) {
    return { ok: false, code: "confirmation_required" };
  }
  const now = input.now ?? new Date();
  try {
    await db.$transaction(async (tx) => {
      const principal = await lockPrincipal(tx, input.staffPrincipalId);
      if (!principal) throw new TeamAbort("rejected");
      if (principal.email !== email) throw new TeamAbort("email_mismatch");
      if (principal.status !== "active" || principal.disabledAt != null) throw new TeamAbort("disabled");
      await grantDesired(tx, principal.id, permissionsForAccessLevel(input.accessLevel), now);
      await tx.staffInvitation.updateMany({
        where: { staffPrincipalId: principal.id, status: "pending" },
        data: { accessLevel: input.accessLevel, updatedAt: now },
      });
      await writeEvent(tx, {
        staffPrincipalId: principal.id,
        actorStaffPrincipalId: input.actorStaffPrincipalId,
        kind: "role_changed",
        detail: input.accessLevel,
        now,
      });
    });
    const member = await readStaffTeamMember({ staffPrincipalId: input.staffPrincipalId, now }, db);
    if (!member) return { ok: false, code: "unavailable" };
    return { ok: true, member };
  } catch (err) {
    return failure(err);
  }
}

export async function revokeStaffAccess(
  input: { actorStaffPrincipalId: string; staffPrincipalId: string; email: string; now?: Date },
  db: TeamDb = defaultPrisma
): Promise<{ ok: true; member: StaffTeamMember } | { ok: false; code: StaffTeamCode }> {
  return mutateMembership(input, db, async (tx, principal, now) => {
    await grantDesired(tx, principal.id, [], now);
    await cancelPendingInvitation(tx, principal.id, now);
    await writeEvent(tx, {
      staffPrincipalId: principal.id,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      kind: "permissions_revoked",
      detail: "revoked",
      now,
    });
  });
}

export async function disableStaffTeamMember(
  input: { actorStaffPrincipalId: string; staffPrincipalId: string; email: string; now?: Date },
  db: TeamDb = defaultPrisma
): Promise<{ ok: true; member: StaffTeamMember } | { ok: false; code: StaffTeamCode }> {
  return mutateMembership(input, db, async (tx, principal, now) => {
    if (principal.status !== "disabled") {
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffPrincipal"
        SET status = 'disabled'::"StaffPrincipalStatus",
            "disabledAt" = ${now},
            "updatedAt" = ${now}
        WHERE id = ${principal.id}
          AND status = 'active'::"StaffPrincipalStatus"
          AND "disabledAt" IS NULL
        RETURNING id
      `;
      if (updated.length !== 1) throw new TeamAbort("rejected");
    }
    await cancelPendingInvitation(tx, principal.id, now);
    await writeEvent(tx, {
      staffPrincipalId: principal.id,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      kind: "disabled",
      detail: "disabled",
      now,
    });
  });
}

export async function renewStaffInvitation(
  input: {
    actorStaffPrincipalId: string;
    staffPrincipalId: string;
    email: string;
    signInUrl?: string | null;
    now?: Date;
    sendEmail?: SendEmail;
  },
  db: TeamDb = defaultPrisma
): Promise<
  | { ok: true; member: StaffTeamMember; emailDelivery: "sent" | "not_sent"; emailDetail: string }
  | { ok: false; code: StaffTeamCode }
> {
  const email = normalizeCompanyEmail(input.email);
  if (!email || !PRINCIPAL_PATTERN.test(input.actorStaffPrincipalId) || !PRINCIPAL_PATTERN.test(input.staffPrincipalId)) {
    return { ok: false, code: "rejected" };
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + STAFF_INVITATION_TTL_MS);
  const signInUrl = parseStaffSignInUrl(input.signInUrl);
  try {
    const renewed = await db.$transaction(async (tx) => {
      const principal = await lockPrincipal(tx, input.staffPrincipalId);
      if (!principal) throw new TeamAbort("rejected");
      if (principal.email !== email) throw new TeamAbort("email_mismatch");
      if (principal.status !== "active" || principal.disabledAt != null) throw new TeamAbort("disabled");
      if (principal.providerSubject) throw new TeamAbort("already_bound");
      const invitations = await tx.$queryRaw<Array<{ id: string; status: string; accessLevel: StaffAccessLevel }>>`
        SELECT id, status::text AS status, "accessLevel"::text AS "accessLevel"
        FROM "StaffInvitation"
        WHERE "staffPrincipalId" = ${principal.id}
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      `;
      const invitation = invitations[0];
      if (!invitation) throw new TeamAbort("not_invited");
      if (invitation.status === "consumed") throw new TeamAbort("already_bound");
      const level = accessLevelFromPermissions(
        (await grantedManaged(tx, principal.id)).map((row) => row.permission)
      );
      const accessLevel = level === "none" ? invitation.accessLevel : level;
      if (invitation.status === "pending") {
        await tx.staffInvitation.update({
          where: { id: invitation.id },
          data: { expiresAt, accessLevel, updatedAt: now },
        });
      } else {
        await tx.staffInvitation.update({
          where: { id: invitation.id },
          data: { status: "pending", canceledAt: null, expiresAt, accessLevel, updatedAt: now },
        });
      }
      await writeEvent(tx, {
        staffPrincipalId: principal.id,
        actorStaffPrincipalId: input.actorStaffPrincipalId,
        kind: "invitation_renewed",
        detail: accessLevel,
        now,
      });
      return { invitationId: invitation.id, accessLevel };
    });
    const delivery = await deliverInvitation({
      db,
      staffPrincipalId: input.staffPrincipalId,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      email,
      accessLevel: renewed.accessLevel,
      signInUrl,
      expiresAt,
      idempotencyKey: `staff-invite:${renewed.invitationId}:${expiresAt.toISOString()}`,
      sendEmail: input.sendEmail,
      now,
    });
    const member = await readStaffTeamMember({ staffPrincipalId: input.staffPrincipalId, now }, db);
    if (!member) return { ok: false, code: "unavailable" };
    return { ok: true, member, emailDelivery: delivery.emailDelivery, emailDetail: delivery.emailDetail };
  } catch (err) {
    return failure(err);
  }
}

export async function claimApprovedStaffInvitation(
  input: { identity: StaffClaimIdentity; now?: Date; hostedDomain?: string },
  db: TeamDb = defaultPrisma
): Promise<{ ok: true; staffPrincipalId: string } | { ok: false; code: StaffTeamCode }> {
  const domain = input.hostedDomain ?? STAFF_HOSTED_DOMAIN;
  const now = input.now ?? new Date();
  if (input.identity.emailVerified !== true) return { ok: false, code: "unverified_email" };
  if (!SUB_PATTERN.test(input.identity.sub)) return { ok: false, code: "rejected" };
  const email = normalizeCompanyEmail(input.identity.email, domain);
  if (!email) return { ok: false, code: "email_mismatch" };
  if (!hostedDomainMatches(input.identity.hd, domain)) {
    await rejectClaim(db, email, "workspace_mismatch", input.identity.sub, now);
    return { ok: false, code: "workspace_mismatch" };
  }
  const displayName = safeDisplayName(input.identity.name);
  try {
    const result = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedPrincipal[]>`
        SELECT id, email, status::text AS status, provider::text AS provider, "providerSubject", "disabledAt", "displayName"
        FROM "StaffPrincipal"
        WHERE email = ${email}
        FOR UPDATE
      `;
      const principal = rows[0];
      if (!principal || principal.provider !== "google") throw new TeamAbort("not_invited");
      if (principal.status !== "active" || principal.disabledAt != null) throw new TeamAbort("disabled");
      if (principal.providerSubject) throw new TeamAbort("already_bound");
      const invitations = await tx.$queryRaw<
        Array<{ id: string; status: string; email: string; expiresAt: Date; canceledAt: Date | null; consumedAt: Date | null }>
      >`
        SELECT id, status::text AS status, email, "expiresAt", "canceledAt", "consumedAt"
        FROM "StaffInvitation"
        WHERE "staffPrincipalId" = ${principal.id}
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      `;
      const invitation = invitations[0];
      if (!invitation) throw new TeamAbort("not_invited");
      if (invitation.email !== principal.email) throw new TeamAbort("email_mismatch");
      if (invitation.status === "canceled" || invitation.canceledAt) throw new TeamAbort("canceled");
      if (invitation.status === "consumed" || invitation.consumedAt) throw new TeamAbort("already_bound");
      if (invitation.expiresAt.getTime() <= now.getTime()) throw new TeamAbort("expired");
      const bound = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffPrincipal"
        SET "providerSubject" = ${input.identity.sub},
            "emailVerified" = true,
            "displayName" = COALESCE("displayName", ${displayName}),
            "updatedAt" = ${now}
        WHERE id = ${principal.id}
          AND provider = 'google'::"StaffIdentityProvider"
          AND "providerSubject" IS NULL
          AND status = 'active'::"StaffPrincipalStatus"
          AND "disabledAt" IS NULL
          AND email = ${email}
        RETURNING id
      `;
      if (bound.length !== 1) throw new TeamAbort("already_bound");
      const consumed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffInvitation"
        SET status = 'consumed'::"StaffInvitationStatus",
            "consumedAt" = ${now},
            "updatedAt" = ${now}
        WHERE id = ${invitation.id}
          AND "staffPrincipalId" = ${principal.id}
          AND status = 'pending'::"StaffInvitationStatus"
          AND "canceledAt" IS NULL
          AND "consumedAt" IS NULL
          AND "expiresAt" > ${now}
        RETURNING id
      `;
      if (consumed.length !== 1) throw new TeamAbort("expired");
      await writeEvent(tx, {
        staffPrincipalId: principal.id,
        actorStaffPrincipalId: null,
        kind: "invitation_consumed",
        detail: "bound",
        googleSub: input.identity.sub,
        now,
      });
      return { staffPrincipalId: principal.id };
    });
    return { ok: true, staffPrincipalId: result.staffPrincipalId };
  } catch (err) {
    const failed = failure(err);
    if (!failed.ok && failed.code !== "unavailable" && failed.code !== "not_invited") {
      await rejectClaim(db, email, failed.code, input.identity.sub, now);
    }
    return failed;
  }
}

export async function readGrantedStaffPermissions(
  input: { staffPrincipalId: string },
  db: TeamDb = defaultPrisma
): Promise<StaffManagedPermission[] | null> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return null;
  try {
    const rows = await db.staffPermission.findMany({
      where: {
        staffPrincipalId: input.staffPrincipalId,
        status: "granted",
        revokedAt: null,
        permission: { in: [...STAFF_MANAGED_PERMISSIONS] },
      },
      select: { permission: true },
    });
    return rows.flatMap((row) => {
      const permission = asManaged(row.permission);
      return permission ? [permission] : [];
    });
  } catch {
    return null;
  }
}

export async function recordStaffSignIn(
  input: { staffPrincipalId: string; googleSub: string; now?: Date },
  db: TeamDb = defaultPrisma
): Promise<void> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId) || !SUB_PATTERN.test(input.googleSub)) return;
  try {
    await writeEvent(db, {
      staffPrincipalId: input.staffPrincipalId,
      actorStaffPrincipalId: null,
      kind: "signed_in",
      detail: "signed_in",
      googleSub: input.googleSub,
      now: input.now ?? new Date(),
    });
  } catch {
    // A missed audit row must not deny a sign-in that already matched a bound principal.
  }
}

async function mutateMembership(
  input: { actorStaffPrincipalId: string; staffPrincipalId: string; email: string; now?: Date },
  db: TeamDb,
  change: (tx: Prisma.TransactionClient, principal: LockedPrincipal, now: Date) => Promise<void>
): Promise<{ ok: true; member: StaffTeamMember } | { ok: false; code: StaffTeamCode }> {
  const email = normalizeCompanyEmail(input.email);
  if (!email || !PRINCIPAL_PATTERN.test(input.actorStaffPrincipalId) || !PRINCIPAL_PATTERN.test(input.staffPrincipalId)) {
    return { ok: false, code: "rejected" };
  }
  const now = input.now ?? new Date();
  try {
    await db.$transaction(async (tx) => {
      const principal = await lockPrincipal(tx, input.staffPrincipalId);
      if (!principal) throw new TeamAbort("rejected");
      if (principal.email !== email) throw new TeamAbort("email_mismatch");
      await change(tx, principal, now);
    });
    const member = await readStaffTeamMember({ staffPrincipalId: input.staffPrincipalId, now }, db);
    if (!member) return { ok: false, code: "unavailable" };
    return { ok: true, member };
  } catch (err) {
    return failure(err);
  }
}

async function grantDesired(
  tx: Prisma.TransactionClient,
  staffPrincipalId: string,
  desired: readonly StaffManagedPermission[],
  now: Date
): Promise<void> {
  const current = await tx.$queryRaw<Array<{ id: string; permission: StaffManagedPermission }>>`
    SELECT id, permission::text AS permission
    FROM "StaffPermission"
    WHERE "staffPrincipalId" = ${staffPrincipalId}
      AND status = 'granted'::"StaffPermissionStatus"
      AND "revokedAt" IS NULL
      AND permission IN ('admin_coc'::"StaffPermissionKey", 'team_workspace'::"StaffPermissionKey", 'team_manager'::"StaffPermissionKey", 'team_operations'::"StaffPermissionKey")
    FOR UPDATE
  `;
  const keep = new Set(desired);
  for (const row of current) {
    if (keep.has(row.permission)) continue;
    await tx.staffPermission.update({
      where: { id: row.id },
      data: { status: "revoked", revokedAt: now, updatedAt: now },
    });
  }
  const held = new Set(current.map((row) => row.permission));
  for (const permission of desired) {
    if (held.has(permission)) continue;
    await tx.staffPermission.create({
      data: {
        staffPrincipalId,
        permission,
        status: "granted",
        grantedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}

async function grantedManaged(
  tx: Prisma.TransactionClient,
  staffPrincipalId: string
): Promise<Array<{ permission: StaffManagedPermission }>> {
  const rows = await tx.staffPermission.findMany({
    where: {
      staffPrincipalId,
      status: "granted",
      revokedAt: null,
      permission: { in: [...STAFF_MANAGED_PERMISSIONS] },
    },
    select: { permission: true },
  });
  return rows.flatMap((row) => {
    const permission = asManaged(row.permission);
    return permission ? [{ permission }] : [];
  });
}

async function cancelPendingInvitation(tx: Prisma.TransactionClient, staffPrincipalId: string, now: Date): Promise<void> {
  await tx.staffInvitation.updateMany({
    where: { staffPrincipalId, status: "pending" },
    data: { status: "canceled", canceledAt: now, updatedAt: now },
  });
}

async function deliverInvitation(input: {
  db: TeamDb;
  staffPrincipalId: string;
  actorStaffPrincipalId: string;
  email: string;
  accessLevel: StaffAccessLevel;
  signInUrl: string | null;
  expiresAt: Date;
  idempotencyKey: string;
  sendEmail?: SendEmail;
  now: Date;
}): Promise<{ emailDelivery: "sent" | "not_sent"; emailDetail: "sent" | "not_configured" | "delivery_failed" | "link_unavailable" }> {
  if (!input.signInUrl) {
    await writeEvent(input.db, {
      staffPrincipalId: input.staffPrincipalId,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      kind: "invitation_email_skipped",
      detail: "link_unavailable",
      now: input.now,
    });
    return { emailDelivery: "not_sent", emailDetail: "link_unavailable" };
  }
  const send = input.sendEmail ?? sendTransactionalEmail;
  let result: SendTransactionalEmailResult;
  try {
    result = await send({
      to: input.email,
      subject: "SA360 staff sign-in",
      idempotencyKey: input.idempotencyKey,
      text: invitationText(input.email, input.accessLevel, input.signInUrl, input.expiresAt),
    });
  } catch {
    result = { ok: false, error: "delivery_failed" };
  }
  if (result.ok) {
    await writeEvent(input.db, {
      staffPrincipalId: input.staffPrincipalId,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      kind: "invitation_email_sent",
      detail: "sent",
      now: input.now,
    });
    return { emailDelivery: "sent", emailDetail: "sent" };
  }
  const detail = result.skipped ? "not_configured" : "delivery_failed";
  await writeEvent(input.db, {
    staffPrincipalId: input.staffPrincipalId,
    actorStaffPrincipalId: input.actorStaffPrincipalId,
    kind: "invitation_email_skipped",
    detail,
    now: input.now,
  });
  return { emailDelivery: "not_sent", emailDetail: detail };
}

function invitationText(email: string, accessLevel: StaffAccessLevel, signInUrl: string, expiresAt: Date): string {
  const label = accessLevel === "administrator" ? "Administrator" : accessLevel === "manager" ? "Manager" : "Operations";
  return [
    `A SA360 administrator approved ${email} for ${label} access.`,
    "",
    "Open this sign-in page and choose that Google Workspace account:",
    signInUrl,
    "",
    "The link has no invitation code and no password.",
    `The approval expires ${expiresAt.toISOString()}.`,
    "If it expires, ask an administrator to renew it.",
  ].join("\n");
}

async function rejectClaim(
  db: TeamDb,
  email: string,
  code: StaffTeamCode,
  googleSub: string,
  now: Date
): Promise<void> {
  if (!DETAIL_PATTERN.test(code)) return;
  try {
    const principal = await db.staffPrincipal.findUnique({ where: { email }, select: { id: true } });
    if (!principal) return;
    await writeEvent(db, {
      staffPrincipalId: principal.id,
      actorStaffPrincipalId: null,
      kind: "claim_rejected",
      detail: code,
      googleSub: SUB_PATTERN.test(googleSub) ? googleSub : null,
      now,
    });
  } catch {
    // The denial already happened. A missed audit row does not grant access.
  }
}

type LockedPrincipal = {
  id: string;
  email: string;
  status: string;
  provider: string;
  providerSubject: string | null;
  disabledAt: Date | null;
  displayName: string | null;
};

async function lockPrincipal(tx: Prisma.TransactionClient, id: string): Promise<LockedPrincipal | null> {
  const rows = await tx.$queryRaw<LockedPrincipal[]>`
    SELECT id, email, status::text AS status, provider::text AS provider, "providerSubject", "disabledAt", "displayName"
    FROM "StaffPrincipal"
    WHERE id = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function writeEvent(
  db: Prisma.TransactionClient | TeamDb,
  input: {
    staffPrincipalId: string;
    actorStaffPrincipalId: string | null;
    kind:
      | "invited"
      | "invitation_renewed"
      | "invitation_canceled"
      | "invitation_consumed"
      | "invitation_email_sent"
      | "invitation_email_skipped"
      | "role_changed"
      | "permissions_revoked"
      | "disabled"
      | "signed_in"
      | "claim_rejected";
    detail: string | null;
    googleSub?: string | null;
    now: Date;
  }
): Promise<void> {
  await db.staffManagementEvent.create({
    data: {
      staffPrincipalId: input.staffPrincipalId,
      actorStaffPrincipalId: input.actorStaffPrincipalId,
      kind: input.kind,
      detail: input.detail && DETAIL_PATTERN.test(input.detail) ? input.detail : null,
      googleSub: input.googleSub && SUB_PATTERN.test(input.googleSub) ? input.googleSub : null,
      createdAt: input.now,
    },
  });
}

async function latestEvents(
  db: TeamDb,
  ids: string[],
  kinds: Array<"signed_in" | "invitation_consumed" | "invitation_email_sent" | "invitation_email_skipped">
): Promise<Map<string, { kind: string; createdAt: Date }>> {
  const found = new Map<string, { kind: string; createdAt: Date }>();
  if (ids.length === 0) return found;
  const rows = await db.$queryRaw<Array<{ staffPrincipalId: string; kind: string; createdAt: Date }>>`
    SELECT DISTINCT ON ("staffPrincipalId") "staffPrincipalId", kind::text AS kind, "createdAt"
    FROM "StaffManagementEvent"
    WHERE "staffPrincipalId" IN (${Prisma.join(ids)})
      AND kind::text IN (${Prisma.join(kinds)})
    ORDER BY "staffPrincipalId", "createdAt" DESC
  `;
  for (const row of rows) found.set(row.staffPrincipalId, { kind: row.kind, createdAt: row.createdAt });
  return found;
}

function toMember(
  row: {
    id: string;
    email: string;
    displayName: string | null;
    status: "active" | "disabled";
    providerSubject: string | null;
    permissions: Array<{ permission: string }>;
    invitations: Array<{ status: "pending" | "consumed" | "canceled"; expiresAt: Date; accessLevel: StaffAccessLevel }>;
  },
  login: { createdAt: Date } | null,
  emailEvent: { kind: string } | null,
  now: Date
): StaffTeamMember {
  const granted = row.permissions.flatMap((permission) => {
    const value = asManaged(permission.permission);
    return value ? [value] : [];
  });
  const invitation = row.invitations[0] ?? null;
  const accessLevel = accessLevelFromPermissions(granted);
  return {
    staffPrincipalId: row.id,
    email: row.email,
    displayName: row.displayName,
    accountStatus: staffAccountStatus({
      principalStatus: row.status === "active" ? "active" : "disabled",
      bound: row.providerSubject != null,
      granted,
      invitationStatus: invitation?.status ?? null,
      invitationExpiresAt: invitation?.expiresAt ?? null,
      now,
    }),
    invitationStatus: invitationDisplayStatus({
      status: invitation?.status ?? null,
      expiresAt: invitation?.expiresAt ?? null,
      now,
    }),
    accessLevel: accessLevel === "none" ? (invitation && !row.providerSubject ? invitation.accessLevel : "none") : accessLevel,
    permissions: granted,
    bound: row.providerSubject != null,
    lastLoginAt: login ? login.createdAt.toISOString() : null,
    invitationExpiresAt: invitation ? invitation.expiresAt.toISOString() : null,
    emailDelivery: emailEvent?.kind === "invitation_email_sent" ? "sent" : emailEvent ? "not_sent" : "unknown",
  };
}

function safeDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length < 1 || name.length > 200 || name !== value.trim()) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

function failure(err: unknown): { ok: false; code: StaffTeamCode } {
  if (err instanceof TeamAbort) return { ok: false, code: err.code };
  if (isUniqueViolation(err)) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes("StaffPrincipal_email") || text.includes("email")) return { ok: false, code: "duplicate" };
    return { ok: false, code: "collision" };
  }
  return { ok: false, code: "unavailable" };
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
  const text = err instanceof Error ? err.message : String(err);
  return (
    text.includes("23505") ||
    text.includes("StaffPrincipal_provider_subject_key") ||
    text.includes("StaffInvitation_one_pending_key") ||
    text.includes("StaffPermission_one_effective_grant_key")
  );
}
