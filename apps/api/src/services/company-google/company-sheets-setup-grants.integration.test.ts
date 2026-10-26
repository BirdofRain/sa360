/**
 * Disposable PostgreSQL 18.6 proof for the company Sheets setup grants.
 * Set SA360_G15_PG18=1. The proof never contacts DigitalOcean or a managed database.
 *
 * Sequence: Boundary A schema baseline, Boundary A role preparation, the PR #225
 * table migration, then the grant file. A second database migrates with no
 * sa360_app and proves the loopback skip does not grant privileges later by itself.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { COMPANY_GOOGLE_CONNECTION_KEY } from "../../lib/company-google-sheets-env.js";
import { repoRoot } from "../ppl-fulfillment/historical-catalog-summary-maintenance.harness.js";
import { upsertCompanyGoogleConnection } from "./company-google-connection.service.js";
import {
  ensureCompanyClientFolder,
  saveCompanySheetsDestinationForClient,
  type CompanySheetsDeps,
} from "./company-sheets-destination.service.js";
import {
  listCompanyClientSpreadsheets,
  unlinkCompanyClientFolder,
} from "./company-sheets-setup.service.js";
import type { GoogleSpreadsheetMetadata } from "../google-sheets/google-sheets-http-client.js";

const productionFile = join(
  repoRoot,
  "prisma/candidates/historical-catalog-summary-role-security-v1/production-boundary-a.sql",
);
const sheetsMigration = join(
  repoRoot,
  "prisma/migrations/20261023220000_company_sheets_setup_links/migration.sql",
);
const grantMigration = join(
  repoRoot,
  "prisma/migrations/20261026200000_company_sheets_setup_grants/migration.sql",
);
const sheetsDir = "20261023220000_company_sheets_setup_links";
const grantDir = "20261026200000_company_sheets_setup_grants";
const boundaryAHash = "6650bddd3f930c0ea0d35afc9ac062693e7e9fbc167e679090cc5b0520e585b5";
const run = process.env.SA360_G15_PG18 === "1" && Boolean(process.env.SA360_TEST_DATABASE_URL?.trim());
const GOOGLE_TEST_KEY = "test-google-encryption-key-for-unit-tests-only";
const APPROVED_DRIVE = "0AApprovedDrive00";
const APPROVED_PARENT = "1ApprovedParentFolder";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

function proofPort(): string {
  const url = new URL(process.env.SA360_TEST_DATABASE_URL ?? "http://invalid");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("refusing a non-local sheets grant proof");
  }
  if (url.port === "25060") throw new Error("refusing the managed database port");
  return url.port || "5432";
}

function roleUrl(role: string, database = "defaultdb"): string {
  return `postgresql://${encodeURIComponent(role)}@127.0.0.1:${proofPort()}/${database}`;
}

function runPsql(args: string[], input?: string, env?: NodeJS.ProcessEnv): { status: number | null; output: string } {
  const result = spawnSync("psql", args, { encoding: "utf8", input, env });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function asPostgres(database: string, sql: string): void {
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-p", proofPort(), "-d", database, "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { encoding: "utf8", input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "postgres psql failed");
  }
}

function psqlFile(databaseUrl: string, filePath: string): void {
  const result = runPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", filePath]);
  if (result.status !== 0) throw new Error(result.output.trim() || "psql file failed");
}

function scalar(databaseUrl: string, sql: string): string {
  const result = runPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]);
  if (result.status !== 0) throw new Error(result.output.trim() || "psql scalar failed");
  return result.output.trim();
}

function capture(databaseUrl: string, sql: string): { status: number | null; output: string } {
  return runPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function nonLoopbackAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  throw new Error("no non-loopback IPv4 address for the grant refusal proof");
}

function cleanupRoles(): void {
  asPostgres(
    "postgres",
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname IN ('defaultdb', 'sa360_grant_skip_test') AND pid <> pg_backend_pid();
     DROP DATABASE IF EXISTS defaultdb;
     DROP DATABASE IF EXISTS sa360_grant_skip_test;`,
  );
  asPostgres(
    "postgres",
    `DO $revoke$
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin') THEN
         ALTER ROLE doadmin RESET createrole_self_grant;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
         REVOKE sa360_summary_runtime FROM sa360_app GRANTED BY doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
         REVOKE sa360_schema_owner FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_schema_owner FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
         REVOKE sa360_summary_operator FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_summary_operator FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
         REVOKE sa360_summary_runtime FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_summary_runtime FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_reader') THEN
         REVOKE sa360_summary_reader FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_summary_reader FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
         REVOKE sa360_app FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_app FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin_group') THEN
         REVOKE doadmin_group FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin_group')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '_doadmin_managed') THEN
         REVOKE _doadmin_managed FROM doadmin_group;
       END IF;
     END
     $revoke$;`,
  );
  for (const roleName of [
    "sa360_app",
    "sa360_summary_reader",
    "sa360_summary_operator",
    "sa360_summary_runtime",
    "sa360_schema_owner",
    "doadmin",
    "doadmin_group",
    "_doadmin_managed",
    "_doadmin_monitor",
    "_dodb_repl",
    "_dodb_rewind",
    "_dodb",
  ]) {
    asPostgres(
      "postgres",
      `DO $one$
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
           DROP ROLE ${roleName};
         END IF;
       END
       $one$;`,
    );
  }
  asPostgres(
    "postgres",
    `DO $restore$
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g15_local_db_owner')
          AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360') THEN
         ALTER ROLE g15_local_db_owner LOGIN;
         ALTER ROLE g15_local_db_owner RENAME TO sa360;
       END IF;
     END
     $restore$;`,
  );
}

function migrateBaseline(databaseUrl: string): void {
  const root = mkdtempSync(join(tmpdir(), "sa360-grant-baseline-"));
  const migrationRoot = join(root, "migrations");
  mkdirSync(migrationRoot);
  cpSync(join(repoRoot, "prisma/schema.prisma"), join(root, "schema.prisma"));
  cpSync(join(repoRoot, "prisma/migrations/migration_lock.toml"), join(migrationRoot, "migration_lock.toml"));
  for (const name of readdirSync(join(repoRoot, "prisma/migrations"))) {
    if (name === sheetsDir || name === grantDir || name === "migration_lock.toml") continue;
    const source = join(repoRoot, "prisma/migrations", name);
    cpSync(source, join(migrationRoot, name), { recursive: true });
  }
  const result = spawnSync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", join(root, "schema.prisma")],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
  rmSync(root, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "baseline migrate failed");
  }
}

function privileges(databaseUrl: string, table: string): string {
  return scalar(
    databaseUrl,
    `SELECT coalesce(string_agg(acl.privilege_type, ',' ORDER BY acl.privilege_type), '')
     FROM pg_class AS relation
     CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
     WHERE relation.relname = '${table}'
       AND relation.relnamespace = 'public'::regnamespace
       AND acl.grantee = 'sa360_app'::regrole`,
  );
}

function folderFile(id: string, name = "Client folder", parents: string[] = []) {
  return {
    id,
    name,
    mimeType: "application/vnd.google-apps.folder",
    ownedByMe: false,
    ownerEmails: [] as string[],
    driveId: APPROVED_DRIVE,
    parents,
    capabilities: { canEdit: true as boolean | null, canAddChildren: true as boolean | null },
    trashed: false as boolean | null,
    shortcutTargetId: null as string | null,
  };
}

function ownedSheet(id: string) {
  return {
    id,
    name: "Acme Leads",
    mimeType: "application/vnd.google-apps.spreadsheet",
    ownedByMe: true,
    ownerEmails: ["sheets@lifeagentlaunch.test"],
    driveId: null as string | null,
    parents: [] as string[],
    capabilities: { canEdit: true as boolean | null, canAddChildren: null as boolean | null },
    trashed: false as boolean | null,
    shortcutTargetId: null as string | null,
  };
}

function metadata(id: string): GoogleSpreadsheetMetadata {
  return {
    spreadsheetId: id,
    title: "Acme Leads",
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
    worksheets: [{ sheetId: 0, title: "Leads", index: 0, hidden: false, sheetType: "GRID" }],
  };
}

describe("company sheets setup grant file", () => {
  it("grants only the audited privileges and leaves Boundary A pinned", () => {
    const sql = readFileSyncGrant();
    const grants = [...sql.matchAll(/^\s*GRANT .*;$/gm)].map((match) => match[0].trim());
    assert.deepEqual(grants, [
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."CompanySheetsClientFolder" TO sa360_app;',
      'GRANT SELECT, INSERT ON TABLE public."CompanySheetsFolderEvent" TO sa360_app;',
      'GRANT SELECT, INSERT, UPDATE ON TABLE public."CompanySheetsSpreadsheetLink" TO sa360_app;',
    ]);
    assert.equal(sql.includes("ALL TABLES"), false);
    assert.equal(sql.includes("ALL PRIVILEGES"), false);
    assert.equal(sql.includes("ALTER DEFAULT PRIVILEGES"), false);
    assert.equal(sql.includes("CREATE ROLE"), false);
    assert.equal(sql.includes("ALTER TABLE"), false);
    assert.equal(sql.includes("TO PUBLIC"), false);
    const boundary = createHash("sha256").update(readFileSyncText(productionFile)).digest("hex");
    assert.equal(boundary, boundaryAHash);
    assert.equal(readFileSyncText(productionFile).includes("CompanySheetsClientFolder"), false);
  });
});

function readFileSyncText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function readFileSyncGrant(): string {
  return readFileSyncText(grantMigration);
}

describe("sa360_app company sheets setup on PostgreSQL 18.6", { skip: !run, timeout: 600_000 }, () => {
  const adminUrl = () => roleUrl("doadmin");
  const appUrl = () => roleUrl("sa360_app");
  let appDb: PrismaClient;

  before(() => {
    const version = spawnSync(
      "sudo",
      ["-n", "-u", "postgres", "psql", "-p", proofPort(), "-d", "postgres", "-t", "-A", "-c", "SHOW server_version"],
      { encoding: "utf8" },
    );
    assert.match(version.stdout ?? "", /^18\./, version.stderr ?? "");
    cleanupRoles();
    asPostgres(
      "postgres",
      `ALTER ROLE sa360 RENAME TO g15_local_db_owner;
       ALTER ROLE g15_local_db_owner NOLOGIN;
       CREATE ROLE doadmin LOGIN NOSUPERUSER INHERIT CREATEDB CREATEROLE REPLICATION BYPASSRLS;
       CREATE ROLE doadmin_group NOLOGIN;
       CREATE ROLE _doadmin_managed NOLOGIN;
       GRANT doadmin_group TO doadmin WITH INHERIT TRUE, SET TRUE, ADMIN TRUE;
       GRANT _doadmin_managed TO doadmin_group WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
       CREATE ROLE _dodb LOGIN SUPERUSER REPLICATION;
       CREATE ROLE _doadmin_monitor LOGIN NOSUPERUSER NOREPLICATION;
       CREATE ROLE _dodb_repl LOGIN NOSUPERUSER REPLICATION;
       CREATE ROLE _dodb_rewind LOGIN NOSUPERUSER NOREPLICATION;
       ALTER ROLE doadmin SET createrole_self_grant = 'inherit,set';
       CREATE DATABASE defaultdb OWNER doadmin;`,
    );
    assert.equal(scalar(adminUrl(), "SHOW createrole_self_grant"), "inherit,set");
    migrateBaseline(adminUrl());
    asPostgres(
      "defaultdb",
      `DO $owners$
       DECLARE
         signature text;
       BEGIN
         FOR signature IN
           SELECT format('%I(%s)', routine.proname, pg_get_function_identity_arguments(routine.oid))
           FROM pg_proc AS routine
           JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
           WHERE namespace.nspname = 'public'
             AND routine.proname NOT LIKE 'historical_%'
             AND pg_get_userbyid(routine.proowner) = 'doadmin'
         LOOP
           EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', signature);
         END LOOP;
       END
       $owners$;`,
    );
    scalar(
      adminUrl(),
      `UPDATE historical_catalog_projection_control
       SET ready = true, source_row_count = 4, projection_row_count = 4,
           verified_at = timestamptz '2026-10-22 15:08:30+00'
       WHERE singleton`,
    );
    psqlFile(adminUrl(), productionFile);
    psqlFile(adminUrl(), sheetsMigration);
    assert.equal(privileges(adminUrl(), "CompanySheetsClientFolder"), "");
    assert.equal(privileges(adminUrl(), "CompanySheetsFolderEvent"), "");
    assert.equal(privileges(adminUrl(), "CompanySheetsSpreadsheetLink"), "");
    const defaultsBefore = scalar(
      adminUrl(),
      `SELECT coalesce(string_agg(defaclacl::text, '|' ORDER BY oid::text), '') FROM pg_default_acl`,
    );
    const membersBefore = scalar(adminUrl(), `SELECT count(*) FROM pg_auth_members`);
    psqlFile(adminUrl(), grantMigration);
    psqlFile(adminUrl(), grantMigration);
    assert.equal(
      scalar(adminUrl(), `SELECT coalesce(string_agg(defaclacl::text, '|' ORDER BY oid::text), '') FROM pg_default_acl`),
      defaultsBefore,
    );
    assert.equal(scalar(adminUrl(), `SELECT count(*) FROM pg_auth_members`), membersBefore);
    assert.equal(
      scalar(
        adminUrl(),
        `SELECT string_agg(pg_get_userbyid(relowner), ',' ORDER BY relname)
         FROM pg_class
         WHERE relnamespace = 'public'::regnamespace
           AND relname IN ('CompanySheetsClientFolder', 'CompanySheetsFolderEvent', 'CompanySheetsSpreadsheetLink')`,
      ),
      "doadmin,doadmin,doadmin",
    );
    appDb = new PrismaClient({ datasources: { db: { url: appUrl() } } });
  });

  after(async () => {
    if (appDb) await appDb.$disconnect();
    if (!run) return;
    cleanupRoles();
  });

  it("matches the audited privilege set and keeps prohibited privileges denied", () => {
    assert.equal(privileges(adminUrl(), "CompanySheetsClientFolder"), "DELETE,INSERT,SELECT,UPDATE");
    assert.equal(privileges(adminUrl(), "CompanySheetsFolderEvent"), "INSERT,SELECT");
    assert.equal(privileges(adminUrl(), "CompanySheetsSpreadsheetLink"), "INSERT,SELECT,UPDATE");
    assert.equal(
      scalar(
        adminUrl(),
        `SELECT coalesce(bool_or(acl.is_grantable), false)
         FROM pg_class AS relation
         CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
         WHERE relation.relnamespace = 'public'::regnamespace
           AND relation.relname IN ('CompanySheetsClientFolder', 'CompanySheetsFolderEvent', 'CompanySheetsSpreadsheetLink')
           AND acl.grantee = 'sa360_app'::regrole`,
      ),
      "f",
    );
    for (const table of ["CompanySheetsClientFolder", "CompanySheetsFolderEvent", "CompanySheetsSpreadsheetLink"]) {
      for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal(
          scalar(adminUrl(), `SELECT has_table_privilege('sa360_app', 'public."${table}"', '${privilege}')`),
          "f",
          `${table} ${privilege}`,
        );
      }
      assert.equal(
        scalar(
          adminUrl(),
          `SELECT count(*)
           FROM pg_class AS relation
           CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
           WHERE relation.relname = '${table}' AND acl.grantee = 0`,
        ),
        "0",
        table,
      );
    }
    const denied = [
      `DELETE FROM public."CompanySheetsFolderEvent"`,
      `UPDATE public."CompanySheetsFolderEvent" SET "action" = "action"`,
      `DELETE FROM public."CompanySheetsSpreadsheetLink"`,
      `TRUNCATE public."CompanySheetsClientFolder"`,
      `TRUNCATE public."CompanySheetsFolderEvent"`,
      `TRUNCATE public."CompanySheetsSpreadsheetLink"`,
    ];
    for (const sql of denied) {
      const result = capture(appUrl(), sql);
      assert.notEqual(result.status, 0, sql);
      assert.match(result.output, /permission denied/);
    }
    assert.equal(scalar(appUrl(), `SELECT has_table_privilege('sa360_app', 'public._prisma_migrations', 'SELECT')`), "f");
    assert.equal(
      scalar(appUrl(), `SELECT has_table_privilege('sa360_app', 'public.historical_catalog_summary_control', 'UPDATE')`),
      "f",
    );
  });

  it("runs folder, history, and spreadsheet-link operations as sa360_app", async () => {
    const clientA = `cgs_grant_${Date.now()}`;
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = GOOGLE_TEST_KEY;
    process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = "true";
    process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
    process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID = APPROVED_PARENT;
    await appDb.clientAccount.create({
      data: { clientAccountId: clientA, clientDisplayName: "Acme Insurance", status: "active" },
    });
    const connected = await upsertCompanyGoogleConnection(
      {
        googleUserId: `company-sub-${clientA}`,
        googleEmail: "sheets@lifeagentlaunch.test",
        googleDisplayName: "Life Agent Launch",
        accessToken: "ya29.company-access",
        refreshToken: "1//company-refresh",
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopes,
        tokenType: "Bearer",
      },
      appDb,
    );
    assert.equal(connected.ok, true);

    const parent = {
      ...folderFile(APPROVED_PARENT, "Client Folders"),
      ownedByMe: false,
      ownerEmails: [] as string[],
    };
    let stored: ReturnType<typeof folderFile> | null = null;
    let creates = 0;
    const deps = (overrides: CompanySheetsDeps = {}): CompanySheetsDeps => ({
      env: process.env,
      db: appDb,
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.company-access",
        connectionId: "company",
        tokenVersion: 1,
        googleEmail: "sheets@lifeagentlaunch.test",
      }),
      getDriveFile: async (input) => {
        if (input.fileId === APPROVED_PARENT) return { ok: true as const, file: parent };
        if (stored && input.fileId === stored.id) return { ok: true as const, file: stored };
        return { ok: false as const, reason: "not_found" as const };
      },
      findNamedChild: async () => (stored ? { ok: true as const, files: [stored] } : { ok: true as const, files: [] }),
      createDriveFile: async () => ({ ok: false as const, reason: "invalid_request" as const }),
      ...overrides,
    });

    const failed = await ensureCompanyClientFolder(clientA, deps());
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "create_placement_failed");
    assert.equal(
      scalar(adminUrl(), `SELECT count(*) FROM public."CompanySheetsClientFolder" WHERE "clientAccountId" = '${clientA}'`),
      "0",
    );

    const raced = deps({
      createDriveFile: async (input) => {
        creates += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        stored = folderFile("1GrantClientFolder", input.name, [input.parentId]);
        return { ok: true as const, file: stored };
      },
    });
    const [first, second] = await Promise.all([
      ensureCompanyClientFolder(clientA, raced),
      ensureCompanyClientFolder(clientA, raced),
    ]);
    assert.equal(creates, 1);
    const successes = [first, second].filter((result) => result.ok);
    const blocked = [first, second].filter((result) => !result.ok);
    assert.ok(successes.length >= 1);
    for (const result of successes) {
      if (!result.ok) continue;
      assert.equal(result.folder.folderId, "1GrantClientFolder");
    }
    if (blocked.length === 1) {
      assert.equal(blocked[0]?.ok, false);
      if (!blocked[0]?.ok) assert.equal(blocked[0].code, "create_in_progress");
    }
    const reused = await ensureCompanyClientFolder(clientA, deps());
    assert.equal(reused.ok, true);
    if (!reused.ok) return;
    assert.equal(reused.folder.created, false);

    const unlinked = await unlinkCompanyClientFolder(clientA, deps());
    assert.equal(unlinked.ok, true);
    if (!unlinked.ok) return;
    assert.equal(unlinked.unlinked, true);
    assert.equal(unlinked.driveDeleted, false);
    assert.equal(
      scalar(
        appUrl(),
        `SELECT status FROM public."CompanySheetsClientFolder" WHERE "clientAccountId" = '${clientA}'`,
      ),
      "unlinked",
    );
    assert.equal(
      scalar(
        appUrl(),
        `SELECT action FROM public."CompanySheetsFolderEvent" WHERE "clientAccountId" = '${clientA}' ORDER BY "createdAt" DESC LIMIT 1`,
      ),
      "unlinked",
    );

    const listed = await listCompanyClientSpreadsheets(clientA, null, deps({
      getDriveFile: async () => ({ ok: false as const, reason: "not_found" as const }),
    }));
    assert.equal(listed.ok, true, listed.ok ? "" : listed.code);
    if (!listed.ok) return;
    assert.equal(listed.folderEvents.some((event) => event.action === "unlinked"), true);

    delete process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID;
    delete process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID;
    const sheetA = "1grantSheetA00000001";
    const sheetB = "1grantSheetB00000001";
    const sheetC = "1grantSheetC00000001";
    const saveDeps = (id: string): CompanySheetsDeps =>
      deps({
        getMetadata: async () => ({ ok: true, metadata: metadata(id) }),
        getDriveFile: async () => ({ ok: true, file: ownedSheet(id) }),
      });
    const savedA = await saveCompanySheetsDestinationForClient(
      clientA,
      { spreadsheetId: sheetA, worksheetId: 0, intendedRecipientEmail: "buyer@example.com" },
      "admin_api",
      saveDeps(sheetA),
    );
    assert.equal(savedA.ok, true, savedA.ok ? "" : savedA.code);
    const savedB = await saveCompanySheetsDestinationForClient(
      clientA,
      { spreadsheetId: sheetB, worksheetId: 0 },
      "admin_api",
      saveDeps(sheetB),
    );
    assert.equal(savedB.ok, true, savedB.ok ? "" : savedB.code);
    assert.equal(
      scalar(
        appUrl(),
        `SELECT status FROM public."CompanySheetsSpreadsheetLink"
         WHERE "clientAccountId" = '${clientA}' AND "spreadsheetId" = '${sheetA}'`,
      ),
      "previous",
    );
    assert.equal(
      scalar(
        appUrl(),
        `SELECT status FROM public."CompanySheetsSpreadsheetLink"
         WHERE "clientAccountId" = '${clientA}' AND "spreadsheetId" = '${sheetB}'`,
      ),
      "current",
    );
    scalar(
      adminUrl(),
      `DELETE FROM public."CompanySheetsSpreadsheetLink" WHERE "clientAccountId" = '${clientA}'`,
    );
    const savedC = await saveCompanySheetsDestinationForClient(
      clientA,
      { spreadsheetId: sheetC, worksheetId: 0 },
      "admin_api",
      saveDeps(sheetC),
    );
    assert.equal(savedC.ok, true, savedC.ok ? "" : savedC.code);
    assert.equal(
      scalar(
        appUrl(),
        `SELECT status FROM public."CompanySheetsSpreadsheetLink"
         WHERE "clientAccountId" = '${clientA}' AND "spreadsheetId" = '${sheetB}'`,
      ),
      "inferred",
    );
    assert.equal(
      scalar(
        appUrl(),
        `SELECT status FROM public."CompanySheetsSpreadsheetLink"
         WHERE "clientAccountId" = '${clientA}' AND "spreadsheetId" = '${sheetC}'`,
      ),
      "current",
    );
    const linkDelete = capture(appUrl(), `DELETE FROM public."CompanySheetsSpreadsheetLink" WHERE "clientAccountId" = '${clientA}'`);
    assert.notEqual(linkDelete.status, 0);
    assert.match(linkDelete.output, /permission denied/);

    await appDb.clientAccount.delete({ where: { clientAccountId: clientA } });
    assert.equal(
      scalar(adminUrl(), `SELECT count(*) FROM public."CompanySheetsClientFolder" WHERE "clientAccountId" = '${clientA}'`),
      "0",
    );
    assert.equal(
      scalar(adminUrl(), `SELECT count(*) FROM public."CompanySheetsFolderEvent" WHERE "clientAccountId" = '${clientA}'`),
      "0",
    );
    assert.equal(
      scalar(adminUrl(), `SELECT count(*) FROM public."CompanySheetsSpreadsheetLink" WHERE "clientAccountId" = '${clientA}'`),
      "0",
    );
    assert.equal(scalar(appUrl(), `SELECT has_table_privilege('sa360_app', 'public."CompanySheetsFolderEvent"', 'DELETE')`), "f");
    await appDb.companyGoogleConnection.deleteMany({ where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY } });
  });
});

describe("loopback skip and non-loopback refusal", { skip: !run, timeout: 600_000 }, () => {
  const skipUrl = () => roleUrl("sa360", "sa360_grant_skip_test");

  before(() => {
    cleanupRoles();
    asPostgres("postgres", `CREATE DATABASE sa360_grant_skip_test OWNER sa360;`);
  });

  after(() => {
    if (!run) return;
    cleanupRoles();
  });

  it("does not grant privileges when the migration runs before the role exists", () => {
    const deployed = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: skipUrl() },
    });
    assert.equal(deployed.status, 0, `${deployed.stderr ?? ""}\n${deployed.stdout ?? ""}`);
    assert.equal(
      scalar(skipUrl(), `SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '${grantDir}' AND finished_at IS NOT NULL`),
      "1",
    );
    asPostgres("postgres", `CREATE ROLE sa360_app LOGIN;`);
    assert.equal(privileges(skipUrl(), "CompanySheetsClientFolder"), "");
    psqlFile(skipUrl(), grantMigration);
    assert.equal(privileges(skipUrl(), "CompanySheetsClientFolder"), "DELETE,INSERT,SELECT,UPDATE");
    assert.equal(privileges(skipUrl(), "CompanySheetsFolderEvent"), "INSERT,SELECT");
    assert.equal(privileges(skipUrl(), "CompanySheetsSpreadsheetLink"), "INSERT,SELECT,UPDATE");
  });

  it("refuses a non-loopback session when sa360_app is absent", () => {
    const address = nonLoopbackAddress();
    const dir = mkdtempSync(join(tmpdir(), "sa360-grant-remote-"));
    const port = 54741;
    const bin = "/usr/lib/postgresql/18/bin";
    const env = { PATH: process.env.PATH, HOME: tmpdir(), LANG: "C" };
    const init = spawnSync(
      `${bin}/initdb`,
      ["-D", dir, "-U", "grantcheck", "--auth-local=trust", "--auth-host=trust", "--no-sync", "--no-instructions"],
      { encoding: "utf8", env },
    );
    assert.equal(init.status, 0, init.stderr || init.stdout);
    writeFileSync(
      join(dir, "postgresql.conf"),
      `listen_addresses = '${address}'\nport = ${port}\nunix_socket_directories = '${dir}'\n`,
      { flag: "a" },
    );
    writeFileSync(join(dir, "pg_hba.conf"), "host all all all trust\nlocal all all trust\n");
    const start = spawnSync(`${bin}/pg_ctl`, ["-D", dir, "-l", join(dir, "server.log"), "-w", "-t", "30", "start"], {
      encoding: "utf8",
      env,
    });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    try {
      const admin = `postgresql://grantcheck@${address}:${port}/postgres`;
      const setup = runPsql(
        [admin, "-v", "ON_ERROR_STOP=1", "-c", `CREATE TABLE public."CompanySheetsClientFolder" (id int);
          CREATE TABLE public."CompanySheetsFolderEvent" (id int);
          CREATE TABLE public."CompanySheetsSpreadsheetLink" (id int);`],
      );
      assert.equal(setup.status, 0, setup.output);
      const refused = runPsql([admin, "-v", "ON_ERROR_STOP=1", "-f", grantMigration]);
      assert.notEqual(refused.status, 0);
      assert.match(refused.output, /sa360_app is absent/);
      const serverAddr = scalar(
        `postgresql://grantcheck@${address}:${port}/postgres`,
        "SELECT inet_server_addr()",
      );
      assert.equal(serverAddr.replace(/\/\d+$/, ""), address);
    } finally {
      spawnSync(`${bin}/pg_ctl`, ["-D", dir, "-m", "immediate", "stop"], { encoding: "utf8", env });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
