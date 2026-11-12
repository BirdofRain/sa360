/**
 * Local sa360_test proof for approved staff invitations and first Google claim.
 * Staff rows cannot be deleted. Each case uses a fresh synthetic mailbox.
 * Nothing here uses a production identity.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "./safe-test-database-url.js";
import { provisionUnboundStaffPrincipal } from "./staff-enrollment.js";
import {
  changeStaffAccess,
  claimApprovedStaffInvitation,
  disableStaffTeamMember,
  inviteStaffMember,
  renewStaffInvitation,
  revokeStaffAccess,
} from "./staff-team-management.js";
import type { SendTransactionalEmailResult } from "./transactional-email.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const SIGN_IN = "https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/start";
const DOMAIN = "lifeagentlaunch.com";

function mailbox(label: string): string {
  return `staff.${label}.${randomBytes(4).toString("hex")}@${DOMAIN}`;
}

function sub(label: string): string {
  return `${label}${randomBytes(8).toString("hex")}0123456789`;
}

function failureCode(result: { ok: boolean; code?: string }): string {
  assert.equal(result.ok, false);
  return result.code ?? "";
}

const sendEmail = async (input: { text: string }): Promise<SendTransactionalEmailResult> => {
  assert.match(input.text, new RegExp(SIGN_IN.replaceAll(".", "\\.")));
  assert.equal(input.text.includes("code="), false);
  assert.equal(input.text.includes("secret"), false);
  assert.equal(input.text.includes("enrollment"), false);
  return { ok: false, skipped: true, error: "not configured in test" };
};

describe("staff team invitation and first Google claim (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let actorId = "";

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    const actor = await provisionUnboundStaffPrincipal(
      { email: `actor.${randomBytes(4).toString("hex")}@example.com`, displayName: "Synthetic Actor" },
      db
    );
    assert.equal(actor.ok, true);
    if (actor.ok) actorId = actor.staffPrincipalId;
  });

  after(async () => {
    if (db) await db.$disconnect();
  });

  it("binds an approved company mailbox once and does not grant admin_coc to manager or operations", async () => {
    const managerEmail = mailbox("manager");
    const invited = await inviteStaffMember(
      {
        actorStaffPrincipalId: actorId,
        email: managerEmail,
        accessLevel: "manager",
        signInUrl: `${SIGN_IN}?code=secret`,
        sendEmail,
      },
      db
    );
    assert.equal(invited.ok, true);
    if (!invited.ok) return;
    assert.equal(invited.emailDelivery, "not_sent");
    assert.equal(invited.emailDetail, "link_unavailable");
    assert.deepEqual(invited.member.permissions.sort(), ["team_manager", "team_workspace"]);
    assert.equal(invited.member.permissions.includes("admin_coc"), false);
    assert.equal(invited.member.accountStatus, "pending");
    assert.equal(
      await db.staffPermission.count({
        where: { staffPrincipalId: invited.member.staffPrincipalId, permission: "facebook_association_correction" },
      }),
      0
    );

    const googleSub = sub("mgr");
    const identity = { sub: googleSub, email: managerEmail, emailVerified: true as const, hd: DOMAIN, name: "Manager Example" };
    assert.equal((await claimApprovedStaffInvitation({ identity: { ...identity, hd: "gmail.com" } }, db)).ok, false);
    assert.deepEqual(
      await claimApprovedStaffInvitation({ identity: { ...identity, email: `staff.lookalike@${DOMAIN}.evil.com`, hd: DOMAIN } }, db),
      { ok: false, code: "email_mismatch" }
    );
    assert.deepEqual(
      await claimApprovedStaffInvitation({ identity: { ...identity, email: "outside.person@gmail.com", hd: "gmail.com" } }, db),
      { ok: false, code: "email_mismatch" }
    );
    assert.equal(
      failureCode(await claimApprovedStaffInvitation({ identity: { ...identity, hd: null } }, db)),
      "workspace_mismatch"
    );
    const unbound = await db.staffPrincipal.findUniqueOrThrow({ where: { email: managerEmail } });
    assert.equal(unbound.providerSubject, null);

    const claimed = await claimApprovedStaffInvitation({ identity }, db);
    assert.deepEqual(claimed, { ok: true, staffPrincipalId: invited.member.staffPrincipalId });
    const bound = await db.staffPrincipal.findUniqueOrThrow({ where: { id: invited.member.staffPrincipalId } });
    assert.equal(bound.providerSubject, googleSub);
    assert.equal(bound.emailVerified, true);
    const invitation = await db.staffInvitation.findFirstOrThrow({ where: { staffPrincipalId: bound.id } });
    assert.equal(invitation.status, "consumed");
    const event = await db.staffManagementEvent.findFirstOrThrow({
      where: { staffPrincipalId: bound.id, kind: "invitation_consumed" },
    });
    assert.equal(event.googleSub, googleSub);
    assert.equal(JSON.stringify(event).includes("secret"), false);

    const replacement = sub("replace");
    assert.equal(
      failureCode(await claimApprovedStaffInvitation({ identity: { ...identity, sub: replacement } }, db)),
      "already_bound"
    );
    const still = await db.staffPrincipal.findUniqueOrThrow({ where: { id: bound.id } });
    assert.equal(still.providerSubject, googleSub);
    await assert.rejects(
      db.staffPrincipal.update({ where: { id: bound.id }, data: { providerSubject: replacement } }),
      /immutable once set|restrict_violation/
    );
    assert.equal(
      failureCode(
        await changeStaffAccess(
          {
            actorStaffPrincipalId: actorId,
            staffPrincipalId: bound.id,
            email: managerEmail,
            accessLevel: "administrator",
          },
          db
        )
      ),
      "confirmation_required"
    );
    const grants = await db.staffPermission.findMany({
      where: { staffPrincipalId: bound.id, status: "granted", revokedAt: null },
      select: { permission: true },
    });
    assert.deepEqual(grants.map((grant) => grant.permission).sort(), ["team_manager", "team_workspace"]);
  });

  it("rejects an unapproved workspace account and an expired, canceled, or disabled invitation", async () => {
    const unapproved = mailbox("unapproved");
    assert.equal(
      failureCode(
        await claimApprovedStaffInvitation(
          { identity: { sub: sub("none"), email: unapproved, emailVerified: true, hd: DOMAIN } },
          db
        )
      ),
      "not_invited"
    );
    assert.equal(await db.staffPrincipal.count({ where: { email: unapproved } }), 0);

    const expiredEmail = mailbox("expired");
    const opened = new Date("2026-01-01T00:00:00.000Z");
    const expiredInvite = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: expiredEmail, accessLevel: "operations", signInUrl: SIGN_IN, sendEmail, now: opened },
      db
    );
    assert.equal(expiredInvite.ok, true);
    if (!expiredInvite.ok) return;
    assert.deepEqual(expiredInvite.member.permissions.sort(), ["team_operations", "team_workspace"]);
    assert.equal(expiredInvite.emailDetail, "not_configured");
    const later = new Date(opened.getTime() + 8 * 24 * 60 * 60 * 1000);
    const expiredIdentity = { sub: sub("exp"), email: expiredEmail, emailVerified: true as const, hd: DOMAIN };
    assert.equal(failureCode(await claimApprovedStaffInvitation({ identity: expiredIdentity, now: later }, db)), "expired");
    const renewed = await renewStaffInvitation(
      { actorStaffPrincipalId: actorId, staffPrincipalId: expiredInvite.member.staffPrincipalId, email: expiredEmail, signInUrl: SIGN_IN, now: later },
      db
    );
    assert.equal(renewed.ok, true);
    assert.equal((await claimApprovedStaffInvitation({ identity: expiredIdentity, now: later }, db)).ok, true);

    const canceledEmail = mailbox("canceled");
    const canceledInvite = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: canceledEmail, accessLevel: "operations", signInUrl: SIGN_IN, sendEmail },
      db
    );
    assert.equal(canceledInvite.ok, true);
    if (!canceledInvite.ok) return;
    const revoked = await revokeStaffAccess(
      { actorStaffPrincipalId: actorId, staffPrincipalId: canceledInvite.member.staffPrincipalId, email: canceledEmail },
      db
    );
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    assert.deepEqual(revoked.member.permissions, []);
    assert.equal(
      await db.staffPermission.count({
        where: { staffPrincipalId: canceledInvite.member.staffPrincipalId, status: "granted", revokedAt: null },
      }),
      0
    );
    assert.equal(
      failureCode(
        await claimApprovedStaffInvitation(
          { identity: { sub: sub("cancel"), email: canceledEmail, emailVerified: true, hd: DOMAIN } },
          db
        )
      ),
      "canceled"
    );

    const disabledEmail = mailbox("disabled");
    const disabledInvite = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: disabledEmail, accessLevel: "manager", signInUrl: SIGN_IN, sendEmail },
      db
    );
    assert.equal(disabledInvite.ok, true);
    if (!disabledInvite.ok) return;
    const disabled = await disableStaffTeamMember(
      { actorStaffPrincipalId: actorId, staffPrincipalId: disabledInvite.member.staffPrincipalId, email: disabledEmail },
      db
    );
    assert.equal(disabled.ok, true);
    if (!disabled.ok) return;
    assert.equal(disabled.member.accountStatus, "disabled");
    assert.equal(
      failureCode(
        await claimApprovedStaffInvitation(
          { identity: { sub: sub("off"), email: disabledEmail, emailVerified: true, hd: DOMAIN } },
          db
        )
      ),
      "disabled"
    );
    const row = await db.staffPrincipal.findUniqueOrThrow({ where: { email: disabledEmail } });
    assert.equal(row.providerSubject, null);
    assert.equal(row.status, "disabled");
  });

  it("lets one concurrent claim bind the subject and leaves the other unused", async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const firstDb = new PrismaClient({ datasources: { db: { url } } });
    const secondDb = new PrismaClient({ datasources: { db: { url } } });
    const email = mailbox("race");
    try {
      const invited = await inviteStaffMember(
        { actorStaffPrincipalId: actorId, email, accessLevel: "operations", signInUrl: SIGN_IN, sendEmail },
        firstDb
      );
      assert.equal(invited.ok, true);
      if (!invited.ok) return;
      const firstSub = sub("racea");
      const secondSub = sub("raceb");
      const results = await Promise.all([
        claimApprovedStaffInvitation({ identity: { sub: firstSub, email, emailVerified: true, hd: DOMAIN } }, firstDb),
        claimApprovedStaffInvitation({ identity: { sub: secondSub, email, emailVerified: true, hd: DOMAIN } }, secondDb),
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      const principal = await firstDb.staffPrincipal.findUniqueOrThrow({ where: { email } });
      assert.ok(principal.providerSubject === firstSub || principal.providerSubject === secondSub);
      assert.equal(await firstDb.staffInvitation.count({ where: { staffPrincipalId: principal.id, status: "consumed" } }), 1);
      const loser = principal.providerSubject === firstSub ? secondSub : firstSub;
      assert.equal(
        failureCode(
          await claimApprovedStaffInvitation({ identity: { sub: loser, email, emailVerified: true, hd: DOMAIN } }, firstDb)
        ),
        "already_bound"
      );
      const unchanged = await firstDb.staffPrincipal.findUniqueOrThrow({ where: { email } });
      assert.equal(unchanged.providerSubject, principal.providerSubject);
    } finally {
      await firstDb.$disconnect();
      await secondDb.$disconnect();
    }
  });

  it("does not create an account for an external or plus-aliased email", async () => {
    const external = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: "person@gmail.com", accessLevel: "manager", sendEmail },
      db
    );
    assert.deepEqual(external, { ok: false, code: "rejected" });
    const alias = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: `person+ops@${DOMAIN}`, accessLevel: "operations", sendEmail },
      db
    );
    assert.deepEqual(alias, { ok: false, code: "rejected" });
    const admin = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: mailbox("admin"), accessLevel: "administrator", sendEmail },
      db
    );
    assert.deepEqual(admin, { ok: false, code: "confirmation_required" });
  });

  it("rejects self-demotion, self-revocation, and self-disable", async () => {
    const admin = await boundAdministrator(db, actorId, "self");
    const other = await boundAdministrator(db, actorId, "other");
    assert.equal(
      failureCode(
        await changeStaffAccess(
          {
            actorStaffPrincipalId: admin.id,
            staffPrincipalId: admin.id,
            email: admin.email,
            accessLevel: "manager",
          },
          db
        )
      ),
      "self_protected"
    );
    assert.equal(
      failureCode(
        await revokeStaffAccess({ actorStaffPrincipalId: admin.id, staffPrincipalId: admin.id, email: admin.email }, db)
      ),
      "self_protected"
    );
    assert.equal(
      failureCode(
        await disableStaffTeamMember({ actorStaffPrincipalId: admin.id, staffPrincipalId: admin.id, email: admin.email }, db)
      ),
      "self_protected"
    );
    const still = await db.staffPermission.count({
      where: { staffPrincipalId: admin.id, permission: "admin_coc", status: "granted", revokedAt: null },
    });
    assert.equal(still, 1);
    const row = await db.staffPrincipal.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(row.status, "active");
    assert.equal(
      (await changeStaffAccess(
        {
          actorStaffPrincipalId: other.id,
          staffPrincipalId: admin.id,
          email: admin.email,
          accessLevel: "operations",
        },
        db
      )).ok,
      true
    );
    assert.equal(
      await db.staffPermission.count({
        where: { staffPrincipalId: other.id, permission: "admin_coc", status: "granted", revokedAt: null },
      }),
      1
    );
  });

  it("protects the last active administrator and still changes other staff", async () => {
    const admin = await collapseToOneAdministrator(db, actorId);
    const manager = await inviteStaffMember(
      { actorStaffPrincipalId: actorId, email: mailbox("managed"), accessLevel: "manager", signInUrl: SIGN_IN, sendEmail },
      db
    );
    assert.equal(manager.ok, true);
    if (!manager.ok) return;
    assert.equal(
      failureCode(
        await changeStaffAccess(
          {
            actorStaffPrincipalId: actorId,
            staffPrincipalId: admin.id,
            email: admin.email,
            accessLevel: "manager",
          },
          db
        )
      ),
      "last_administrator"
    );
    assert.equal(
      failureCode(
        await revokeStaffAccess({ actorStaffPrincipalId: actorId, staffPrincipalId: admin.id, email: admin.email }, db)
      ),
      "last_administrator"
    );
    assert.equal(
      failureCode(
        await disableStaffTeamMember(
          { actorStaffPrincipalId: actorId, staffPrincipalId: admin.id, email: admin.email },
          db
        )
      ),
      "last_administrator"
    );
    const changed = await changeStaffAccess(
      {
        actorStaffPrincipalId: admin.id,
        staffPrincipalId: manager.member.staffPrincipalId,
        email: manager.member.email,
        accessLevel: "operations",
      },
      db
    );
    assert.equal(changed.ok, true);
    if (!changed.ok) return;
    assert.deepEqual(changed.member.permissions.sort(), ["team_operations", "team_workspace"]);
    const revoked = await revokeStaffAccess(
      { actorStaffPrincipalId: admin.id, staffPrincipalId: manager.member.staffPrincipalId, email: manager.member.email },
      db
    );
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    assert.deepEqual(revoked.member.permissions, []);
    assert.equal(
      await db.staffPermission.count({
        where: { staffPrincipalId: admin.id, permission: "admin_coc", status: "granted", revokedAt: null },
      }),
      1
    );
    const principal = await db.staffPrincipal.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(principal.status, "active");
  });

  it("does not let two administrators revoke each other down to zero", async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const firstDb = new PrismaClient({ datasources: { db: { url } } });
    const secondDb = new PrismaClient({ datasources: { db: { url } } });
    try {
      const first = await collapseToOneAdministrator(firstDb, actorId);
      const second = await boundAdministrator(firstDb, actorId, "race-admin-b");
      const results = await Promise.all([
        revokeStaffAccess(
          { actorStaffPrincipalId: first.id, staffPrincipalId: second.id, email: second.email },
          firstDb
        ),
        revokeStaffAccess(
          { actorStaffPrincipalId: second.id, staffPrincipalId: first.id, email: first.email },
          secondDb
        ),
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(results.filter((result) => !result.ok && result.code === "last_administrator").length, 1);
      const remaining = await firstDb.staffPermission.count({
        where: {
          staffPrincipalId: { in: [first.id, second.id] },
          permission: "admin_coc",
          status: "granted",
          revokedAt: null,
        },
      });
      assert.equal(remaining, 1);
      const effective = await firstDb.$queryRaw<Array<{ id: string }>>`
        SELECT principal.id
        FROM "StaffPermission" perm
        JOIN "StaffPrincipal" principal ON principal.id = perm."staffPrincipalId"
        WHERE perm.permission = 'admin_coc'::"StaffPermissionKey"
          AND perm.status = 'granted'::"StaffPermissionStatus"
          AND perm."revokedAt" IS NULL
          AND principal.status = 'active'::"StaffPrincipalStatus"
          AND principal."disabledAt" IS NULL
          AND principal."providerSubject" IS NOT NULL
      `;
      assert.equal(effective.length, 1);
    } finally {
      await firstDb.$disconnect();
      await secondDb.$disconnect();
    }
  });
});

async function boundAdministrator(
  db: PrismaClient,
  actorStaffPrincipalId: string,
  label: string
): Promise<{ id: string; email: string }> {
  const email = mailbox(label);
  const invited = await inviteStaffMember(
    {
      actorStaffPrincipalId,
      email,
      accessLevel: "administrator",
      confirmAdministrator: true,
      signInUrl: SIGN_IN,
      sendEmail,
    },
    db
  );
  assert.equal(invited.ok, true);
  if (!invited.ok) throw new Error("administrator invitation failed");
  const claimed = await claimApprovedStaffInvitation(
    { identity: { sub: sub(label), email, emailVerified: true, hd: DOMAIN, name: "Synthetic Admin" } },
    db
  );
  assert.equal(claimed.ok, true);
  return { id: invited.member.staffPrincipalId, email };
}

async function collapseToOneAdministrator(
  db: PrismaClient,
  actorStaffPrincipalId: string
): Promise<{ id: string; email: string }> {
  const rows = await db.$queryRaw<Array<{ id: string; email: string }>>`
    SELECT principal.id, principal.email
    FROM "StaffPermission" perm
    JOIN "StaffPrincipal" principal ON principal.id = perm."staffPrincipalId"
    WHERE perm.permission = 'admin_coc'::"StaffPermissionKey"
      AND perm.status = 'granted'::"StaffPermissionStatus"
      AND perm."revokedAt" IS NULL
      AND principal.status = 'active'::"StaffPrincipalStatus"
      AND principal."disabledAt" IS NULL
      AND principal."providerSubject" IS NOT NULL
    ORDER BY principal."createdAt" ASC
  `;
  const keeper = rows[0] ?? (await boundAdministrator(db, actorStaffPrincipalId, "kept"));
  for (const extra of rows.slice(rows[0] ? 1 : 0)) {
    const changed = await changeStaffAccess(
      {
        actorStaffPrincipalId: keeper.id,
        staffPrincipalId: extra.id,
        email: extra.email,
        accessLevel: "manager",
      },
      db
    );
    assert.equal(changed.ok, true);
  }
  return keeper;
}
