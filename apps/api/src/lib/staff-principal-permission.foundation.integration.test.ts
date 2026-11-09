/**
 * Local sa360_test proof for the staff identity and permission tables.
 * No login, no OAuth, no production seed. Writes roll back, except rejected
 * statements, which abort their own transaction.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "./safe-test-database-url.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const MIGRATION_NAME = "20261109210000_staff_principal_permission_foundation";
const PERMISSION = "facebook_association_correction" as const;

class IntentionalRollback extends Error {
  constructor() {
    super("rollback staff foundation fixture");
    this.name = "IntentionalRollback";
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
    return `${err.name}\n${code}\n${err.message}`;
  }
  return String(err);
}

describe("staff principal permission foundation (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (db) await db.$disconnect();
  });

  async function rolledBack(
    run: (tx: Prisma.TransactionClient) => Promise<void>
  ): Promise<void> {
    let finished = false;
    try {
      await db.$transaction(
        async (tx) => {
          await run(tx);
          finished = true;
          throw new IntentionalRollback();
        },
        { timeout: 15_000 }
      );
    } catch (err) {
      if (err instanceof IntentionalRollback && finished) return;
      throw err;
    }
    throw new Error("staff foundation transaction committed");
  }

  async function expectRejected(
    pattern: RegExp,
    run: (tx: Prisma.TransactionClient) => Promise<void>
  ): Promise<void> {
    let finished = false;
    try {
      await db.$transaction(
        async (tx) => {
          await run(tx);
          finished = true;
          throw new IntentionalRollback();
        },
        { timeout: 15_000 }
      );
    } catch (err) {
      if (finished) {
        throw new Error(`expected database rejection but the writes succeeded\n${errorText(err)}`);
      }
      assert.match(errorText(err), pattern);
      return;
    }
    throw new Error("expected database rejection");
  }

  async function counts(): Promise<{ principals: bigint; permissions: bigint }> {
    const [principals] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "StaffPrincipal"
    `;
    const [permissions] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "StaffPermission"
    `;
    return { principals: principals.count, permissions: permissions.count };
  }

  async function activeGrantIds(tx: Prisma.TransactionClient, principalId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p."id"
      FROM "StaffPermission" p
      JOIN "StaffPrincipal" s ON s."id" = p."staffPrincipalId"
      WHERE p."staffPrincipalId" = ${principalId}
        AND p."permission" = 'facebook_association_correction'::"StaffPermissionKey"
        AND p."status" = 'granted'::"StaffPermissionStatus"
        AND p."revokedAt" IS NULL
        AND s."status" = 'active'::"StaffPrincipalStatus"
        AND s."disabledAt" IS NULL
      ORDER BY p."grantedAt", p."id"
    `;
    return rows.map((row) => row.id);
  }

  it("applies the empty migration and creates no principals or grants", async () => {
    const applied = await db.$queryRaw<Array<{ finished: Date | null; rolledBack: Date | null }>>`
      SELECT "finished_at" AS finished, "rolled_back_at" AS "rolledBack"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${MIGRATION_NAME}
    `;
    assert.equal(applied.length, 1);
    assert.ok(applied[0]?.finished);
    assert.equal(applied[0]?.rolledBack, null);

    const count = await counts();
    assert.equal(count.principals, 0n);
    assert.equal(count.permissions, 0n);

    const secretColumns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('StaffPrincipal', 'StaffPermission')
        AND (
          column_name ILIKE '%password%'
          OR column_name ILIKE '%token%'
          OR column_name ILIKE '%secret%'
          OR column_name ILIKE '%hash%'
        )
    `;
    assert.deepEqual(secretColumns, []);

    const foreignKeys = await db.$queryRaw<Array<{ table_name: string; foreign_table: string; definition: string }>>`
      SELECT conrelid::regclass::text AS table_name,
             confrelid::regclass::text AS foreign_table,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'f'
        AND (
          conrelid = '"StaffPrincipal"'::regclass
          OR conrelid = '"StaffPermission"'::regclass
          OR confrelid = '"StaffPrincipal"'::regclass
          OR confrelid = '"StaffPermission"'::regclass
        )
      ORDER BY conrelid::regclass::text
    `;
    assert.equal(foreignKeys.length, 1);
    assert.match(foreignKeys[0]?.table_name ?? "", /StaffPermission/);
    assert.match(foreignKeys[0]?.foreign_table ?? "", /StaffPrincipal/);
    assert.match(foreignKeys[0]?.definition ?? "", /ON DELETE RESTRICT/);
    assert.match(foreignKeys[0]?.definition ?? "", /ON UPDATE RESTRICT/);
  });

  it("keeps principals and grants when delete or truncate is attempted", async () => {
    const before = await counts();
    await expectRejected(/StaffPermission rows are retained/, async (tx) => {
      const principal = await tx.staffPrincipal.create({
        data: { email: "retain.permission@example.com" },
      });
      const grant = await tx.staffPermission.create({
        data: {
          staffPrincipalId: principal.id,
          permission: PERMISSION,
          status: "granted",
        },
      });
      await tx.staffPermission.delete({ where: { id: grant.id } });
    });
    await expectRejected(/StaffPrincipal rows are retained/, async (tx) => {
      const principal = await tx.staffPrincipal.create({
        data: { email: "retain.principal@example.com" },
      });
      await tx.staffPrincipal.delete({ where: { id: principal.id } });
    });
    await assert.rejects(
      () => db.$executeRaw`TRUNCATE TABLE "StaffPermission", "StaffPrincipal"`,
      (err: unknown) => /rows are retained/.test(errorText(err))
    );
    assert.deepEqual(await counts(), before);
  });

  it("coexists, scopes grants, and withholds disabled or revoked authority", async () => {
    const before = await counts();
    await rolledBack(async (tx) => {
      const clientsBefore = await tx.clientAccount.count();
      const googleBefore = await tx.googleAccountConnection.count();

      const ada = await tx.staffPrincipal.create({
        data: {
          email: "ada.staff@example.com",
          displayName: "Ada Staff",
          emailVerified: true,
        },
      });
      const grace = await tx.staffPrincipal.create({
        data: {
          email: "grace.staff@example.com",
          displayName: "Grace Staff",
        },
      });
      assert.equal(ada.status, "disabled");
      assert.ok(ada.disabledAt);
      assert.equal(ada.provider, "google");
      assert.equal(ada.providerSubject, null);
      assert.equal(ada.emailVerified, true);
      assert.notEqual(ada.id, grace.id);
      assert.equal(await tx.staffPermission.count({ where: { staffPrincipalId: ada.id } }), 0);

      const adaGrant = await tx.staffPermission.create({
        data: {
          staffPrincipalId: ada.id,
          permission: PERMISSION,
          status: "granted",
        },
      });
      assert.deepEqual(await activeGrantIds(tx, ada.id), []);
      assert.equal(adaGrant.status, "granted");

      await tx.staffPrincipal.update({
        where: { id: ada.id },
        data: { status: "active", disabledAt: null, providerSubject: "google-sub-ada" },
      });
      await tx.staffPrincipal.update({
        where: { id: grace.id },
        data: { status: "active", disabledAt: null, providerSubject: "google-sub-grace" },
      });
      const graceGrant = await tx.staffPermission.create({
        data: {
          staffPrincipalId: grace.id,
          permission: PERMISSION,
          status: "granted",
        },
      });

      assert.deepEqual(await activeGrantIds(tx, ada.id), [adaGrant.id]);
      assert.deepEqual(await activeGrantIds(tx, grace.id), [graceGrant.id]);

      await tx.staffPrincipal.update({
        where: { id: ada.id },
        data: {
          email: "ada.renamed@example.com",
          displayName: "Ada Renamed",
        },
      });
      const renamed = await tx.staffPrincipal.findUniqueOrThrow({ where: { id: ada.id } });
      assert.equal(renamed.email, "ada.renamed@example.com");
      assert.equal(renamed.providerSubject, "google-sub-ada");

      await tx.staffPrincipal.update({
        where: { id: ada.id },
        data: { status: "disabled", disabledAt: new Date() },
      });
      const disabledGrant = await tx.staffPermission.findUniqueOrThrow({
        where: { id: adaGrant.id },
      });
      assert.equal(disabledGrant.status, "granted");
      assert.equal(disabledGrant.revokedAt, null);
      assert.deepEqual(await activeGrantIds(tx, ada.id), []);
      assert.deepEqual(await activeGrantIds(tx, grace.id), [graceGrant.id]);

      await tx.staffPrincipal.update({
        where: { id: ada.id },
        data: { status: "active", disabledAt: null },
      });
      assert.deepEqual(await activeGrantIds(tx, ada.id), [adaGrant.id]);

      const revokedAt = new Date();
      await tx.staffPermission.update({
        where: { id: adaGrant.id },
        data: { status: "revoked", revokedAt },
      });
      assert.deepEqual(await activeGrantIds(tx, ada.id), []);
      const replacement = await tx.staffPermission.create({
        data: {
          staffPrincipalId: ada.id,
          permission: PERMISSION,
          status: "granted",
        },
      });
      assert.deepEqual(await activeGrantIds(tx, ada.id), [replacement.id]);
      const history = await tx.staffPermission.findMany({
        where: { staffPrincipalId: ada.id },
        orderBy: { grantedAt: "asc" },
      });
      assert.equal(history.length, 2);
      assert.equal(history[0]?.status, "revoked");
      assert.equal(history[1]?.id, replacement.id);

      await tx.clientAccount.create({
        data: {
          clientAccountId: "staff_foundation_client",
          clientDisplayName: "Same Mailbox Client",
          portalLoginEmail: "ada.renamed@example.com",
        },
      });
      assert.equal(await tx.clientAccount.count(), clientsBefore + 1);
      assert.equal(await tx.googleAccountConnection.count(), googleBefore);
      assert.equal(await tx.staffPrincipal.count(), 2);
    });
    assert.deepEqual(await counts(), before);
  });

  it("rejects a second effective grant and a second bound subject", async () => {
    await expectRejected(/P2002|StaffPermission_one_effective_grant_key|23505/, async (tx) => {
      const principal = await tx.staffPrincipal.create({
        data: { email: "dup.grant@example.com", displayName: "Dup Grant" },
      });
      await tx.staffPermission.create({
        data: {
          staffPrincipalId: principal.id,
          permission: PERMISSION,
          status: "granted",
        },
      });
      await tx.staffPermission.create({
        data: {
          staffPrincipalId: principal.id,
          permission: PERMISSION,
          status: "granted",
        },
      });
    });

    await expectRejected(/P2002|StaffPrincipal_provider_subject_key|23505/, async (tx) => {
      await tx.staffPrincipal.create({
        data: {
          email: "dup.sub.a@example.com",
          providerSubject: "google-sub-shared",
        },
      });
      await tx.staffPrincipal.create({
        data: {
          email: "dup.sub.b@example.com",
          providerSubject: "google-sub-shared",
        },
      });
    });

    await expectRejected(/P2002|StaffPrincipal_email_key|23505/, async (tx) => {
      await tx.staffPrincipal.create({
        data: { email: "dup.mail@example.com" },
      });
      await tx.staffPrincipal.create({
        data: { email: "dup.mail@example.com" },
      });
    });
    assert.deepEqual(await counts(), { principals: 0n, permissions: 0n });
  });

  it("holds the foreign key, the binding, and revoked-grant retention", async () => {
    await expectRejected(/P2003|23503/, async (tx) => {
      await tx.staffPermission.create({
        data: {
          staffPrincipalId: "missing-staff-principal",
          permission: PERMISSION,
          status: "granted",
        },
      });
    });

    await expectRejected(/provider binding is immutable once set/, async (tx) => {
      const principal = await tx.staffPrincipal.create({
        data: {
          email: "bind.once@example.com",
          providerSubject: "google-sub-bind",
          status: "active",
          disabledAt: null,
        },
      });
      await tx.staffPrincipal.update({
        where: { id: principal.id },
        data: { providerSubject: "google-sub-other" },
      });
    });

    await expectRejected(/StaffPrincipal.id is immutable/, async (tx) => {
      const principal = await tx.staffPrincipal.create({
        data: { email: "id.lock@example.com" },
      });
      await tx.$executeRaw`
        UPDATE "StaffPrincipal"
        SET "id" = 'replaced-staff-id'
        WHERE "id" = ${principal.id}
      `;
    });

    await expectRejected(/cannot be reactivated/, async (tx) => {
      const principal = await tx.staffPrincipal.create({
        data: {
          email: "revoke.lock@example.com",
          status: "active",
          disabledAt: null,
        },
      });
      const grant = await tx.staffPermission.create({
        data: {
          staffPrincipalId: principal.id,
          permission: PERMISSION,
          status: "granted",
        },
      });
      await tx.staffPermission.update({
        where: { id: grant.id },
        data: { status: "revoked", revokedAt: new Date() },
      });
      await tx.staffPermission.update({
        where: { id: grant.id },
        data: { status: "granted", revokedAt: null },
      });
    });

    await expectRejected(/StaffPrincipal_email_normalized_chk/, async (tx) => {
      await tx.staffPrincipal.create({
        data: { email: "Not.Normalized@Example.com" },
      });
    });

    await expectRejected(/StaffPrincipal_status_disabled_at_chk/, async (tx) => {
      await tx.staffPrincipal.create({
        data: {
          email: "active.with.disabled-at@example.com",
          status: "active",
          disabledAt: new Date(),
        },
      });
    });

    await expectRejected(/StaffPrincipal_status_disabled_at_chk/, async (tx) => {
      await tx.staffPrincipal.create({
        data: {
          email: "disabled.without.time@example.com",
          status: "disabled",
          disabledAt: null,
        },
      });
    });

    assert.deepEqual(await counts(), { principals: 0n, permissions: 0n });
  });
});
