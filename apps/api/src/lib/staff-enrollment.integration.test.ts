/**
 * Local sa360_test proof for one-time staff enrollment.
 * Staff principals cannot be deleted, so each case uses a fresh email and
 * leaves that local row in place. Nothing here writes a permission.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { staffEnrollmentSecretDigest } from "@sa360/shared/staff-enrollment";

import { assertSafeTestDatabaseUrl } from "./safe-test-database-url.js";
import {
  bindStaffEnrollment,
  cancelStaffEnrollment,
  disableStaffPrincipal,
  issueStaffEnrollment,
  provisionUnboundStaffPrincipal,
} from "./staff-enrollment.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const SUB = "102938475610293847561";
const OTHER_SUB = "564738291056473829105";

function email(label: string): string {
  return `enroll.${label}.${randomBytes(4).toString("hex")}@example.com`;
}

describe("staff enrollment binding (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (db) await db.$disconnect();
  });

  it("binds one approved principal and does not grant a permission", async () => {
    const mailbox = email("bind");
    const created = await provisionUnboundStaffPrincipal({ email: mailbox, displayName: "Ada Staff" }, db);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const issued = await issueStaffEnrollment({ staffPrincipalId: created.staffPrincipalId }, db);
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const digest = staffEnrollmentSecretDigest(issued.enrollmentSecret);
    const stored = await db.staffEnrollmentGrant.findUniqueOrThrow({ where: { id: issued.grantId } });
    assert.equal(stored.secretDigest, digest);
    assert.equal(stored.secretDigest.includes(issued.enrollmentSecret), false);
    assert.equal(await db.staffPermission.count({ where: { staffPrincipalId: created.staffPrincipalId } }), 0);

    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: SUB, email: mailbox, emailVerified: false } },
        db
      ),
      { ok: false, code: "unverified_email" }
    );
    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: SUB, email: "other.staff@example.com", emailVerified: true } },
        db
      ),
      { ok: false, code: "email_mismatch" }
    );
    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: "a".repeat(43), identity: { sub: SUB, email: mailbox, emailVerified: true } },
        db
      ),
      { ok: false, code: "rejected" }
    );
    assert.equal(await db.staffPrincipal.count({ where: { email: mailbox } }), 1);

    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: `${SUB}0`, email: mailbox, emailVerified: true } },
        db
      ),
      { ok: true, staffPrincipalId: created.staffPrincipalId }
    );
    const principal = await db.staffPrincipal.findUniqueOrThrow({ where: { id: created.staffPrincipalId } });
    assert.equal(principal.providerSubject, `${SUB}0`);
    assert.equal(principal.emailVerified, true);
    const grant = await db.staffEnrollmentGrant.findUniqueOrThrow({ where: { id: issued.grantId } });
    assert.equal(grant.status, "consumed");
    const event = await db.staffEnrollmentEvent.findFirstOrThrow({ where: { grantId: issued.grantId, kind: "consumed" } });
    assert.equal(event.googleSub, `${SUB}0`);
    assert.equal(JSON.stringify(event).includes(issued.enrollmentSecret), false);
    assert.equal(await db.staffPermission.count({ where: { staffPrincipalId: created.staffPrincipalId } }), 0);
    assert.equal(
      (await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: `${SUB}0`, email: mailbox, emailVerified: true } },
        db
      )).ok,
      false
    );
    assert.deepEqual(await issueStaffEnrollment({ staffPrincipalId: created.staffPrincipalId }, db), { ok: false, code: "already_bound" });
    await assert.rejects(
      db.staffPrincipal.update({ where: { id: created.staffPrincipalId }, data: { providerSubject: OTHER_SUB } }),
      /immutable once set|restrict_violation/
    );
  });

  it("rejects a missing, disabled, expired, or canceled invitation without binding", async () => {
    const mailbox = email("cancel");
    const created = await provisionUnboundStaffPrincipal({ email: mailbox }, db);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.deepEqual(
      await issueStaffEnrollment({ staffPrincipalId: "c123456789012345678901234" }, db),
      { ok: false, code: "missing_principal" }
    );
    assert.equal((await disableStaffPrincipal({ staffPrincipalId: created.staffPrincipalId }, db)).ok, true);
    assert.deepEqual(await issueStaffEnrollment({ staffPrincipalId: created.staffPrincipalId }, db), { ok: false, code: "disabled" });
    await db.staffPrincipal.update({ where: { id: created.staffPrincipalId }, data: { status: "active", disabledAt: null } });
    const issued = await issueStaffEnrollment(
      { staffPrincipalId: created.staffPrincipalId, now: new Date("2026-11-10T12:00:00.000Z") },
      db
    );
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: SUB, email: mailbox, emailVerified: true }, now: issued.expiresAt },
        db
      ),
      { ok: false, code: "expired" }
    );
    assert.deepEqual(await cancelStaffEnrollment({ grantId: issued.grantId }, db), { ok: true });
    assert.deepEqual(await cancelStaffEnrollment({ grantId: issued.grantId }, db), { ok: true });
    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: SUB, email: mailbox, emailVerified: true } },
        db
      ),
      { ok: false, code: "canceled" }
    );
    const principal = await db.staffPrincipal.findUniqueOrThrow({ where: { id: created.staffPrincipalId } });
    assert.equal(principal.providerSubject, null);
    assert.equal(await db.staffPermission.count({ where: { staffPrincipalId: created.staffPrincipalId } }), 0);
  });

  it("rolls back when the Google subject is already bound elsewhere", async () => {
    const first = await provisionUnboundStaffPrincipal({ email: email("collision-a") }, db);
    const second = await provisionUnboundStaffPrincipal({ email: email("collision-b") }, db);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    const taken = `taken${randomBytes(6).toString("hex")}`;
    await db.staffPrincipal.update({ where: { id: second.staffPrincipalId }, data: { providerSubject: taken } });
    const issued = await issueStaffEnrollment({ staffPrincipalId: first.staffPrincipalId }, db);
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const mailbox = (await db.staffPrincipal.findUniqueOrThrow({ where: { id: first.staffPrincipalId } })).email;
    assert.deepEqual(
      await bindStaffEnrollment(
        { enrollmentSecret: issued.enrollmentSecret, identity: { sub: taken, email: mailbox, emailVerified: true } },
        db
      ),
      { ok: false, code: "collision" }
    );
    const principal = await db.staffPrincipal.findUniqueOrThrow({ where: { id: first.staffPrincipalId } });
    const grant = await db.staffEnrollmentGrant.findUniqueOrThrow({ where: { id: issued.grantId } });
    assert.equal(principal.providerSubject, null);
    assert.equal(grant.status, "pending");
  });

  it("lets one concurrent enrollment win and leaves the other unused", async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const firstDb = new PrismaClient({ datasources: { db: { url } } });
    const secondDb = new PrismaClient({ datasources: { db: { url } } });
    const mailbox = email("race");
    try {
      const created = await provisionUnboundStaffPrincipal({ email: mailbox }, firstDb);
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const issued = await issueStaffEnrollment({ staffPrincipalId: created.staffPrincipalId }, firstDb);
      assert.equal(issued.ok, true);
      if (!issued.ok) return;
      const identity = { sub: `race${randomBytes(8).toString("hex")}`, email: mailbox, emailVerified: true as const };
      const results = await Promise.all([
        bindStaffEnrollment({ enrollmentSecret: issued.enrollmentSecret, identity }, firstDb),
        bindStaffEnrollment({ enrollmentSecret: issued.enrollmentSecret, identity }, secondDb),
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      const principal = await firstDb.staffPrincipal.findUniqueOrThrow({ where: { id: created.staffPrincipalId } });
      const grant = await firstDb.staffEnrollmentGrant.findUniqueOrThrow({ where: { id: issued.grantId } });
      assert.equal(principal.providerSubject, identity.sub);
      assert.equal(grant.status, "consumed");
      assert.equal(await firstDb.staffPermission.count({ where: { staffPrincipalId: created.staffPrincipalId } }), 0);
      assert.equal((await bindStaffEnrollment({ enrollmentSecret: issued.enrollmentSecret, identity }, firstDb)).ok, false);
    } finally {
      await firstDb.$disconnect();
      await secondDb.$disconnect();
    }
  });
});
