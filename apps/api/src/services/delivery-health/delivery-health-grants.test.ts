import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../../../prisma/migrations");
const tableMigration = "20261120140000_delivery_health_monitoring";
const grantMigration = "20261120190000_delivery_health_sa360_app_grants";
const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);

function migrationSql(name: string): string {
  return readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
}

test("delivery health grants follow the table migration and stay limited to sa360_app", () => {
  const names = readdirSync(migrationsDir).filter((name) => /^\d{14}_/.test(name)).sort();
  const tableAt = names.indexOf(tableMigration);
  const grantAt = names.indexOf(grantMigration);
  assert.equal(tableAt >= 0, true);
  assert.equal(grantAt > tableAt, true);
  const tables = migrationSql(tableMigration);
  const grants = migrationSql(grantMigration);
  assert.equal(/\bGRANT\b/i.test(tables), false);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE ON TABLE/);
  assert.match(grants, /public\."DeliveryHealthIncident"/);
  assert.match(grants, /public\."DeliveryHealthMonitorHeartbeat"/);
  assert.match(grants, /TO sa360_app/);
  assert.match(grants, /delivery health grants refused: sa360_app is absent/);
  assert.match(grants, /inet '127\.0\.0\.0\/8'/);
  assert.equal(/GRANT[^;]*\bDELETE\b/i.test(grants), false);
  assert.equal(/\bGRANT\s+ALL\b/i.test(grants), false);
  assert.equal(/TO PUBLIC/i.test(grants), false);
  assert.equal(/CREATE ROLE/i.test(grants), false);
  assert.equal(/ALTER DEFAULT PRIVILEGES/i.test(grants), false);
  assert.equal(/SET ROLE/i.test(grants), false);
});

const sep = databaseUrl.includes("?") ? "&" : "?";
const db = new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=1` } } });
let createdRole = false;

after(async () => {
  if (createdRole) {
    await db.$executeRawUnsafe(
      `REVOKE ALL ON TABLE public."DeliveryHealthIncident", public."DeliveryHealthMonitorHeartbeat" FROM sa360_app`
    ).catch(() => undefined);
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS sa360_app`).catch(() => undefined);
  }
  await db.$disconnect().catch(() => undefined);
});

test("sa360_app can select, insert, and update delivery health tables and cannot delete them", async () => {
  const applied = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT migration_name AS name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL`,
    grantMigration
  );
  assert.equal(applied.length, 1, "grant migration is applied to the local test database");

  const existing = await db.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') AS present`
  );
  if (!existing[0]?.present) {
    await db.$executeRawUnsafe(`CREATE ROLE sa360_app NOLOGIN`);
    createdRole = true;
  }
  const grantSql = migrationSql(grantMigration).slice(migrationSql(grantMigration).indexOf("DO $grant$"));
  await db.$executeRawUnsafe(grantSql);
  await db.$executeRawUnsafe(grantSql);

  for (const table of ["DeliveryHealthIncident", "DeliveryHealthMonitorHeartbeat"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      const allowed = await privilegeOf(table, privilege);
      assert.equal(allowed, true, `${table} ${privilege}`);
    }
    assert.equal(await privilegeOf(table, "DELETE"), false, `${table} DELETE`);
    assert.equal(await privilegeOf(table, "TRUNCATE"), false, `${table} TRUNCATE`);
    const publicGrants = await db.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count
       FROM pg_class AS relation
       CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
       WHERE relation.relname = $1 AND acl.grantee = 0`,
      table
    );
    assert.equal(publicGrants[0]?.count ?? 0, 0, `${table} PUBLIC`);
  }
});

async function privilegeOf(table: string, privilege: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ allowed: boolean }>>(
    `SELECT has_table_privilege('sa360_app', format('public.%I', $1::text), $2) AS allowed`,
    table,
    privilege
  );
  return rows[0]?.allowed === true;
}
