import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  const tables = sqlWithoutComments(migrationSql(tableMigration));
  const grants = migrationSql(grantMigration);
  const executable = sqlWithoutComments(grants);
  assert.equal(/\bGRANT\b/i.test(tables), false);
  assert.match(executable, /GRANT SELECT, INSERT, UPDATE ON TABLE/);
  assert.match(grants, /public\."DeliveryHealthIncident"/);
  assert.match(grants, /public\."DeliveryHealthMonitorHeartbeat"/);
  assert.match(grants, /TO sa360_app/);
  assert.match(grants, /delivery health grants refused: sa360_app is absent/);
  assert.match(grants, /inet '127\.0\.0\.0\/8'/);
  assert.equal(/\bGRANT\b[^;]*\bDELETE\b/i.test(executable), false);
  assert.equal(/\bGRANT\s+ALL\b/i.test(executable), false);
  assert.equal(/TO PUBLIC/i.test(executable), false);
  assert.equal(/CREATE ROLE/i.test(executable), false);
  assert.equal(/ALTER DEFAULT PRIVILEGES/i.test(executable), false);
  assert.equal(/SET ROLE/i.test(executable), false);
});

function sqlWithoutComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

const database = new URL(databaseUrl);
const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ""));
const port = database.port || "5432";
const sep = databaseUrl.includes("?") ? "&" : "?";
const db = new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=1` } } });
let createdRole = false;

function asPostgres(sql: string): string {
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-p", port, "-d", databaseName, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { encoding: "utf8", input: sql }
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "postgres psql failed");
  }
  return (result.stdout ?? "").trim();
}

after(async () => {
  if (createdRole) {
    asPostgres(
      `REVOKE ALL ON TABLE public."DeliveryHealthIncident", public."DeliveryHealthMonitorHeartbeat" FROM sa360_app;
       DROP ROLE sa360_app;`
    );
  }
  await db.$disconnect().catch(() => undefined);
});

test("sa360_app can select, insert, and update delivery health tables and cannot delete them", async () => {
  const applied = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT migration_name AS name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL`,
    grantMigration
  );
  assert.equal(applied.length, 1, "grant migration is applied to the local test database");

  const present = asPostgres(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app')`);
  if (present !== "t") {
    asPostgres(`CREATE ROLE sa360_app NOLOGIN`);
    createdRole = true;
  }
  const grantSql = migrationSql(grantMigration).slice(migrationSql(grantMigration).indexOf("DO $grant$"));
  asPostgres(grantSql);
  asPostgres(grantSql);

  for (const table of ["DeliveryHealthIncident", "DeliveryHealthMonitorHeartbeat"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      const allowed = asPostgres(
        `SELECT has_table_privilege('sa360_app', 'public."${table}"', '${privilege}')`
      );
      assert.equal(allowed, "t", `${table} ${privilege}`);
    }
    for (const privilege of ["DELETE", "TRUNCATE"]) {
      const allowed = asPostgres(
        `SELECT has_table_privilege('sa360_app', 'public."${table}"', '${privilege}')`
      );
      assert.equal(allowed, "f", `${table} ${privilege}`);
    }
    const publicGrants = asPostgres(
      `SELECT count(*)
       FROM pg_class AS relation
       CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
       WHERE relation.relname = '${table}' AND acl.grantee = 0`
    );
    assert.equal(publicGrants, "0", `${table} PUBLIC`);
  }
});
