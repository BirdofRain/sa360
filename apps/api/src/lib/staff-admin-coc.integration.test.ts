/**
 * Local sa360_test proof for the explicit Admin C.O.C. staff grant.
 * Principals cannot be deleted, so each case uses a fresh email.
 * No production identity is written.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "./safe-test-database-url.js";
import {
  grantStaffAdminCoc,
  readStaffAdminCocStatus,
  revokeStaffAdminCoc,
  staffAdminCocAllows,
} from "./staff-admin-coc.js";
import { disableStaffPrincipal, provisionUnboundStaffPrincipal } from "./staff-enrollment.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
function googleSub(): string {
  return `sub${randomBytes(12).toString("hex")}`;
}

function email(label: string): string {
  return `admincoc.${label}.${randomBytes(4).toString("hex")}@example.com`;
}

async function bind(db: PrismaClient, staffPrincipalId: string, googleSub: string): Promise<void> {
  await db.staffPrincipal.update({
    where: { id: staffPrincipalId },
    data: { providerSubject: googleSub, emailVerified: true },
  });
}

describe("staff admin_coc grant (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (db) await db.$disconnect();
  });

  it("grants only admin_coc to a bound principal and revokes it without deleting the row", async () => {
    const mailbox = email("grant");
    const subject = googleSub();
    const created = await provisionUnboundStaffPrincipal({ email: mailbox, displayName: "Ada Admin" }, db);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.deepEqual(await grantStaffAdminCoc({ staffPrincipalId: created.staffPrincipalId, email: mailbox }, db), {
      ok: false,
      code: "unbound",
    });
    assert.deepEqual(
      await grantStaffAdminCoc(
        { staffPrincipalId: created.staffPrincipalId, email: `${mailbox}.attacker.test` },
        db
      ),
      { ok: false, code: "email_mismatch" }
    );
    assert.equal(await staffAdminCocAllows({ staffPrincipalId: created.staffPrincipalId, googleSub: subject }, db), "absent");

    await bind(db, created.staffPrincipalId, subject);
    const granted = await grantStaffAdminCoc({ staffPrincipalId: created.staffPrincipalId, email: mailbox }, db);
    assert.equal(granted.ok, true);
    if (!granted.ok) return;
    assert.equal(granted.alreadyGranted, false);
    assert.equal(granted.grant.permission, "admin_coc");
    assert.equal(granted.grant.email, mailbox);
    const again = await grantStaffAdminCoc({ staffPrincipalId: created.staffPrincipalId, email: mailbox.toUpperCase() }, db);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.alreadyGranted, true);
    assert.equal(again.grant.staffPermissionId, granted.grant.staffPermissionId);

    assert.equal(await staffAdminCocAllows({ staffPrincipalId: created.staffPrincipalId, googleSub: subject }, db), "allowed");
    assert.equal(
      await staffAdminCocAllows({ staffPrincipalId: created.staffPrincipalId, googleSub: "999999999999999999999" }, db),
      "absent"
    );
    assert.equal(
      await db.staffPermission.count({
        where: { staffPrincipalId: created.staffPrincipalId, permission: "facebook_association_correction" },
      }),
      0
    );

    const revoked = await revokeStaffAdminCoc({ staffPrincipalId: created.staffPrincipalId, email: mailbox }, db);
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    assert.equal(revoked.grant.status, "revoked");
    assert.ok(revoked.grant.revokedAt);
    assert.equal(await staffAdminCocAllows({ staffPrincipalId: created.staffPrincipalId, googleSub: subject }, db), "absent");
    const retained = await db.staffPermission.findUniqueOrThrow({ where: { id: revoked.grant.staffPermissionId } });
    assert.equal(retained.status, "revoked");

    const replaced = await grantStaffAdminCoc({ staffPrincipalId: created.staffPrincipalId, email: mailbox }, db);
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    assert.notEqual(replaced.grant.staffPermissionId, revoked.grant.staffPermissionId);
    assert.equal(await staffAdminCocAllows({ staffPrincipalId: created.staffPrincipalId, googleSub: subject }, db), "allowed");

    const disabled = await disableStaffPrincipal({ staffPrincipalId: created.staffPrincipalId }, db);
    assert.equal(disabled.ok, true);
    assert.equal(await staffAdminCocAllows({ staffPrincipalId: created.staffPrincipalId, googleSub: subject }, db), "absent");
    const status = await readStaffAdminCocStatus({ staffPrincipalId: created.staffPrincipalId }, db);
    assert.equal(status.ok, true);
    if (!status.ok) return;
    assert.equal(status.status, "disabled");
    assert.equal(status.adminCoc, "granted");
    assert.equal(status.providerSubject, subject);
  });
});
