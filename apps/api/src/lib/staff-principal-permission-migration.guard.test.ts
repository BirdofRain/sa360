import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../../");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationsDir = join(repoRoot, "prisma/migrations");
const migrationName = "20261109210000_staff_principal_permission_foundation";
const migrationPath = join(migrationsDir, migrationName, "migration.sql");
const partialIndex = "StaffPermission_one_effective_grant_key";

const unchangedAuthFiles = [
  "apps/api/src/lib/admin-auth.ts",
  "apps/api/src/lib/auth.ts",
  "apps/api/src/lib/workspace-auth.ts",
  "apps/api/src/lib/client-portal-auth.ts",
  "apps/api/src/routes/admin-team-workspace.ts",
  "apps/api/src/routes/admin-facebook-association-correction-preview.ts",
  "apps/api/src/routes/admin-facebook-capture.ts",
  "apps/admin-coc/src/lib/admin-coc-session.ts",
  "apps/admin-coc/src/lib/admin-coc-auth.ts",
];

function modelBody(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  assert.ok(start >= 0, modelName);
  const end = schema.indexOf("\n}", start);
  assert.ok(end > start, modelName);
  return schema.slice(start, end + 2);
}

test("staff schema is an explicit principal and grant, not a password or a role", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const principal = modelBody(schema, "StaffPrincipal");
  const permission = modelBody(schema, "StaffPermission");

  assert.match(principal, /provider\s+StaffIdentityProvider @default\(google\)/);
  assert.match(principal, /providerSubject\s+String\?/);
  assert.match(principal, /emailVerified\s+Boolean\s+@default\(false\)/);
  assert.match(principal, /status\s+StaffPrincipalStatus\s+@default\(disabled\)/);
  assert.match(principal, /@@unique\(\[provider, providerSubject\], map: "StaffPrincipal_provider_subject_key"\)/);
  assert.doesNotMatch(principal, /password|passwordHash|accessToken|refreshToken|session/i);
  assert.doesNotMatch(principal, /ClientAccount|GoogleAccountConnection|role/i);

  assert.match(permission, /onDelete: Restrict, onUpdate: Restrict/);
  assert.match(permission, /permission\s+StaffPermissionKey/);
  assert.doesNotMatch(permission, /@@unique\(\[staffPrincipalId, permission\]\)/);
  assert.doesNotMatch(permission, /password|role/i);
  assert.match(schema, /enum StaffPermissionKey \{\s*facebook_association_correction\s*admin_coc\s*\}/);
  assert.match(schema, /enum StaffIdentityProvider \{\s*google\s*\}/);
});

test("staff migration is additive, empty, and keeps the effective-grant index", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const ddl = sql.replace(/--.*$/gm, "");

  assert.match(sql, /CREATE UNIQUE INDEX "StaffPermission_one_effective_grant_key"/);
  assert.match(sql, /WHERE "status" = 'granted'/);
  assert.match(sql, /DEFAULT 'disabled'/);
  assert.match(sql, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.match(sql, /StaffPrincipal.id is immutable/);
  assert.match(sql, /StaffPrincipal provider binding is immutable once set/);
  assert.match(sql, /StaffPrincipal rows are retained/);
  assert.match(sql, /a revoked StaffPermission cannot be reactivated/);
  assert.match(sql, /StaffPermission rows are retained/);
  assert.doesNotMatch(ddl, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(ddl, /\bCOPY\b/i);
  assert.doesNotMatch(ddl, /ALTER TABLE "ClientAccount"/);
  assert.doesNotMatch(ddl, /ALTER TABLE "GoogleAccountConnection"/);
  assert.doesNotMatch(ddl, /ALTER TABLE "CompanyGoogleConnection"/);
  assert.doesNotMatch(ddl, /password/i);
  assert.doesNotMatch(ddl, /GOOGLE_CLIENT|ADMIN_COC_SESSION_SECRET|SA360_ADMIN_KEY/);

  const later = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > migrationName)
    .map((entry) => entry.name);
  for (const name of later) {
    const laterSql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    assert.equal(
      laterSql.includes("DROP INDEX") && laterSql.includes(partialIndex),
      false,
      `${name} must not drop ${partialIndex}`
    );
  }
});

test("existing admin, workspace, and portal auth does not reference staff permissions", () => {
  for (const relativePath of unchangedAuthFiles) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /StaffPrincipal|StaffPermission|facebook_association_correction/);
  }
});

test("admin_coc migration adds the enum value and does not grant it", () => {
  const sql = readFileSync(
    join(migrationsDir, "20261111180000_staff_admin_coc_permission", "migration.sql"),
    "utf8"
  );
  const ddl = sql.replace(/--.*$/gm, "");
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'admin_coc'/);
  assert.doesNotMatch(ddl, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(ddl, /\bUPDATE\b/i);
  assert.doesNotMatch(ddl, /\bDROP\b/i);
  assert.doesNotMatch(ddl, /facebook_association_correction/);
  assert.doesNotMatch(sql, /sam@lifeagentlaunch\.com/);
});

test("prisma seeds do not create staff principals or permissions", () => {
  const seedDir = join(repoRoot, "prisma");
  const seedFiles = readdirSync(seedDir).filter((name) => name.startsWith("seed"));
  assert.ok(seedFiles.length > 0);
  for (const name of seedFiles) {
    const source = readFileSync(join(seedDir, name), "utf8");
    assert.doesNotMatch(source, /StaffPrincipal|StaffPermission|facebook_association_correction/);
  }
});
