/**
 * Boundary B restricted-login proof.
 * Disposable PostgreSQL 18 only. Set SA360_G15_PG18=1 to run the database proof.
 * The proof applies the already-reviewed production Boundary A script on the
 * pre-Sheets schema, then the Sheets setup migration and its grant migration.
 * It does not set a password or talk to DigitalOcean.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  candidateDir,
  integrationUrl,
  migrate,
  migrateExcluding,
  postBoundaryAMigrations,
  psqlFile,
  repoRoot,
  scalar,
} from "./historical-catalog-summary-maintenance.harness.js";

const roleDir = join(candidateDir, "../historical-catalog-summary-role-security-v1");
const productionFile = join(roleDir, "production-boundary-a.sql");
const postconditionFile = join(roleDir, "production-boundary-a-postconditions.sql");
const runbook = join(repoRoot, "docs/operations/historical-catalog-summary-boundary-b-v1.md");
const shapeScript = join(repoRoot, "scripts/app-spec-shape.mjs");
const database = "defaultdb";
const run = Boolean(integrationUrl()) && process.env.SA360_G15_PG18 === "1";

const membership = [
  "doadmin|sa360_app|admin=false|inherit=true|set=true|grantor=doadmin",
  "doadmin|sa360_app|admin=true|inherit=false|set=false|grantor=postgres",
  "doadmin|sa360_schema_owner|admin=false|inherit=false|set=true|grantor=doadmin",
  "doadmin|sa360_schema_owner|admin=true|inherit=false|set=false|grantor=postgres",
  "doadmin|sa360_summary_operator|admin=false|inherit=false|set=true|grantor=doadmin",
  "doadmin|sa360_summary_operator|admin=true|inherit=false|set=false|grantor=postgres",
  "doadmin|sa360_summary_reader|admin=false|inherit=true|set=true|grantor=doadmin",
  "doadmin|sa360_summary_reader|admin=true|inherit=false|set=false|grantor=postgres",
  "doadmin|sa360_summary_runtime|admin=false|inherit=true|set=true|grantor=doadmin",
  "doadmin|sa360_summary_runtime|admin=true|inherit=false|set=false|grantor=postgres",
  "sa360_app|sa360_summary_runtime|admin=false|inherit=true|set=false|grantor=doadmin",
].join("\n");

function proofPort(): string {
  const url = new URL(integrationUrl());
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("refusing a non-local Boundary B proof");
  }
  if (url.port === "25060") throw new Error("refusing the managed database port");
  return url.port || "5432";
}

function roleUrl(role: string): string {
  return `postgresql://${encodeURIComponent(role)}@127.0.0.1:${proofPort()}/${database}`;
}

function asPostgres(dbName: string, sql: string): void {
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-p", proofPort(), "-d", dbName, "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { encoding: "utf8", input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "postgres psql failed");
  }
}

function capture(role: string, sql: string): { status: number | null; output: string } {
  const result = spawnSync("psql", [roleUrl(role), "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    input: sql,
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function cleanup(): void {
  asPostgres(
    "postgres",
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = '${database}' AND pid <> pg_backend_pid();
     DROP DATABASE IF EXISTS ${database};`,
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

describe("boundary B package", () => {
  it("pins the runbook to the reviewed script and a secret-free spec fingerprint", () => {
    const text = readFileSync(runbook, "utf8");
    const hash = createHash("sha256").update(readFileSync(productionFile)).digest("hex");
    assert.equal(text.includes(hash), true, hash);
    assert.match(text, /Merging this package is not execution approval/);
    assert.match(text, /Do not execute this cutover/);
    assert.match(text, /20261026200000_company_sheets_setup_grants/);
    assert.match(text, /93 finished/);
    const fingerprint = "d337d60be371bc946432f95c01ee4986d2bde8b7db34dd610041266f401bf3eb";
    assert.match(text, new RegExp(fingerprint));
    assert.match(
      readFileSync(join(repoRoot, "scripts/boundary-b/controller.mjs"), "utf8"),
      new RegExp(fingerprint),
    );
    assert.match(text, /126be00e622ca12ca57ef0afb0e12a6e4f891d1c586399fbcd862c5cd86c676e/);
    assert.match(text, /createrole_self_grant=inherit,set/);
    assert.match(text, /type SECRET and scope RUN_TIME/);
    assert.match(text, /Boundaries C through F remain unapproved/);
    assert.match(text, /PQchangePassword/);
    assert.match(text, /full-structure comparison/);
    assert.match(text, /skip_pin true/);
    assert.equal(text.includes("Pipe "), false);
    assert.equal(text.includes("summary_ready = true"), false);
    assert.equal(text.includes("postgres://"), false);
    assert.equal(text.includes("postgresql://"), false);
    assert.equal(text.includes("EV["), false);
    assert.equal(/password\s*[:=]\s*\S+/i.test(text), false);

    const fixture = {
      name: "example",
      envs: [
        {
          key: "DATABASE_URL",
          scope: "RUN_AND_BUILD_TIME",
          value: "postgresql://doadmin:super-secret@db.example:25060/defaultdb?sslmode=require",
        },
      ],
      services: [{ name: "sa360-api", run_command: "start", github: { repo: "BirdofRain/sa360", branch: "master", deploy_on_push: true }, envs: [] }],
      workers: [
        {
          name: "sa360-worker",
          envs: [{ key: "DATABASE_URL", scope: "RUN_TIME", type: "SECRET", value: "EV[1:ciphertext-secret]" }],
        },
      ],
      jobs: [{ name: "sa360-migrate", envs: [] }],
      databases: [],
    };
    const shaped = spawnSync("node", [shapeScript], { encoding: "utf8", input: JSON.stringify(fixture) });
    assert.equal(shaped.status, 0, shaped.stderr ?? "");
    assert.equal(shaped.stdout.includes("super-secret"), false);
    assert.equal(shaped.stdout.includes("ciphertext-secret"), false);
    assert.equal(shaped.stdout.includes("db.example"), false);
    const parsed = JSON.parse(shaped.stdout) as {
      fingerprint: string;
      bindings: Array<{ component?: string; class?: { kind?: string; user?: string } }>;
    };
    assert.equal(parsed.bindings[0]?.class?.user, "doadmin");
    assert.equal(parsed.bindings[1]?.component, "sa360-worker");
    assert.equal(parsed.bindings[1]?.class?.kind, "secret");
    assert.match(parsed.fingerprint, /^[a-f0-9]{64}$/);
  });
});

describe("sa360_app on disposable PostgreSQL 18.6", { skip: !run, timeout: 600_000 }, () => {
  before(() => {
    const version = spawnSync(
      "sudo",
      ["-n", "-u", "postgres", "psql", "-p", proofPort(), "-d", "postgres", "-t", "-A", "-c", "SHOW server_version"],
      { encoding: "utf8" },
    );
    assert.match(version.stdout ?? "", /^18\./, version.stderr ?? "");
    cleanup();
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
       CREATE DATABASE ${database} OWNER doadmin;`,
    );
    const adminUrl = roleUrl("doadmin");
    assert.equal(scalar(adminUrl, "SHOW createrole_self_grant"), "inherit,set");
    migrateExcluding(adminUrl, postBoundaryAMigrations);
    asPostgres(
      database,
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
      adminUrl,
      `UPDATE historical_catalog_projection_control
       SET ready = true, source_row_count = 4, projection_row_count = 4,
           verified_at = timestamptz '2026-10-22 15:08:30+00'
       WHERE singleton`,
    );
    psqlFile(adminUrl, productionFile);
    const posted = capture("doadmin", readFileSync(postconditionFile, "utf8"));
    assert.equal(posted.status, 0, posted.output);
    migrate(adminUrl);
    assert.equal(
      scalar(
        adminUrl,
        `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text
           || '|' || count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)::text
         FROM _prisma_migrations
         WHERE migration_name IN (
           '20261023220000_company_sheets_setup_links',
           '20261026200000_company_sheets_setup_grants'
         )`,
      ),
      "2|0",
    );
    assert.equal(
      scalar(
        adminUrl,
        `SELECT has_table_privilege('sa360_app', 'public."CompanySheetsClientFolder"', 'DELETE')::text`,
      ),
      "true",
    );
    assert.equal(
      scalar(
        adminUrl,
        `SELECT has_table_privilege('sa360_app', 'public."CompanySheetsFolderEvent"', 'UPDATE')::text`,
      ),
      "false",
    );
  });

  after(() => {
    if (!run) return;
    cleanup();
  });

  it("reproduces the production createrole_self_grant memberships", () => {
    const db = roleUrl("doadmin");
    assert.equal(
      scalar(
        db,
        `SELECT coalesce(string_agg(line, E'\\n' ORDER BY line), '')
         FROM (
           SELECT member.rolname || '|' || granted.rolname
             || '|admin=' || membership.admin_option::text
             || '|inherit=' || membership.inherit_option::text
             || '|set=' || membership.set_option::text
             || '|grantor=' || grantor.rolname AS line
           FROM pg_auth_members AS membership
           JOIN pg_roles AS granted ON granted.oid = membership.roleid
           JOIN pg_roles AS member ON member.oid = membership.member
           JOIN pg_roles AS grantor ON grantor.oid = membership.grantor
           WHERE granted.rolname LIKE 'sa360%'
         ) AS rows`,
      ),
      membership,
    );
    assert.equal(
      scalar(
        db,
        `SELECT count(*)::text
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname LIKE 'historical_catalog_summary%'
           AND pg_get_userbyid(relation.relowner) <> 'sa360_schema_owner'`,
      ),
      "0",
    );
    const password = spawnSync(
      "sudo",
      [
        "-n",
        "-u",
        "postgres",
        "psql",
        "-p",
        proofPort(),
        "-d",
        database,
        "-t",
        "-A",
        "-c",
        "SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'sa360_app'",
      ],
      { encoding: "utf8" },
    );
    assert.equal(password.status, 0, password.stderr ?? "");
    assert.equal((password.stdout ?? "").trim(), "t");
  });

  it("grants sa360_app the company Sheets setup privileges and no broader rights", () => {
    const db = roleUrl("doadmin");
    const migrationDirs = readdirSync(join(repoRoot, "prisma/migrations")).filter((name) =>
      statSync(join(repoRoot, "prisma/migrations", name)).isDirectory(),
    );
    assert.equal(
      scalar(
        db,
        `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text
           || '|' || count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)::text
         FROM _prisma_migrations`,
      ),
      `${migrationDirs.length}|0`,
    );
    assert.equal(
      scalar(
        db,
        `SELECT finished_at IS NOT NULL AND rolled_back_at IS NULL
         FROM _prisma_migrations
         WHERE migration_name = '20261026200000_company_sheets_setup_grants'`,
      ),
      "t",
    );
    const sheetsPrivileges = [
      "CompanySheetsClientFolder|DELETE|false",
      "CompanySheetsClientFolder|INSERT|false",
      "CompanySheetsClientFolder|SELECT|false",
      "CompanySheetsClientFolder|UPDATE|false",
      "CompanySheetsFolderEvent|INSERT|false",
      "CompanySheetsFolderEvent|SELECT|false",
      "CompanySheetsSpreadsheetLink|INSERT|false",
      "CompanySheetsSpreadsheetLink|SELECT|false",
      "CompanySheetsSpreadsheetLink|UPDATE|false",
    ].join("\n");
    assert.equal(
      scalar(
        db,
        `SELECT coalesce(string_agg(line, E'\\n' ORDER BY line), '')
         FROM (
           SELECT relation.relname || '|' || privilege.privilege_type || '|' || privilege.is_grantable::text AS line
           FROM pg_class AS relation
           JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
           JOIN LATERAL aclexplode(relation.relacl) AS privilege ON true
           JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
           WHERE namespace.nspname = 'public'
             AND relation.relname IN (
               'CompanySheetsClientFolder',
               'CompanySheetsFolderEvent',
               'CompanySheetsSpreadsheetLink'
             )
             AND grantee.rolname = 'sa360_app'
         ) AS rows`,
      ),
      sheetsPrivileges,
    );
    assert.equal(
      scalar(
        db,
        `SELECT coalesce(string_agg(line, E'\\n' ORDER BY line), '')
         FROM (
           SELECT relation.relname || '|' || wanted.privilege_type AS line
           FROM pg_class AS relation
           JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
           CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS wanted(privilege_type)
           WHERE namespace.nspname = 'public'
             AND relation.relname IN (
               'CompanySheetsClientFolder',
               'CompanySheetsFolderEvent',
               'CompanySheetsSpreadsheetLink'
             )
             AND NOT has_table_privilege('sa360_app', relation.oid, wanted.privilege_type)
         ) AS rows`,
      ),
      [
        "CompanySheetsClientFolder|REFERENCES",
        "CompanySheetsClientFolder|TRIGGER",
        "CompanySheetsClientFolder|TRUNCATE",
        "CompanySheetsFolderEvent|DELETE",
        "CompanySheetsFolderEvent|REFERENCES",
        "CompanySheetsFolderEvent|TRIGGER",
        "CompanySheetsFolderEvent|TRUNCATE",
        "CompanySheetsFolderEvent|UPDATE",
        "CompanySheetsSpreadsheetLink|DELETE",
        "CompanySheetsSpreadsheetLink|REFERENCES",
        "CompanySheetsSpreadsheetLink|TRIGGER",
        "CompanySheetsSpreadsheetLink|TRUNCATE",
      ].join("\n"),
    );
    assert.equal(
      scalar(
        db,
        `SELECT count(*)::text
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         JOIN LATERAL aclexplode(relation.relacl) AS privilege ON privilege.grantee = 0
         WHERE namespace.nspname = 'public'
           AND relation.relname IN (
             'CompanySheetsClientFolder',
             'CompanySheetsFolderEvent',
             'CompanySheetsSpreadsheetLink'
           )`,
      ),
      "0",
    );
    assert.equal(
      scalar(
        db,
        `SELECT string_agg(pg_get_userbyid(relation.relowner), ',' ORDER BY relation.relname)
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname IN (
             'CompanySheetsClientFolder',
             'CompanySheetsFolderEvent',
             'CompanySheetsSpreadsheetLink'
           )`,
      ),
      "doadmin,doadmin,doadmin",
    );
  });

  it("runs the restricted login through intake, inventory, portal, fulfillment, Sheets, GHL, and worker writes", () => {
    const prepared = capture(
      "doadmin",
      `BEGIN;
       INSERT INTO "ClientAccount" ("clientAccountId", "clientDisplayName", "updatedAt")
       VALUES ('b2-origin', 'Boundary B origin', now());
       INSERT INTO "HistoricalCampaignAlias" (
         id, "scopeType", "scopeKey", "normalizedLabel", "displayLabel", "updatedAt"
       ) VALUES (
         'b2-alias', 'inventory_lot', 'vet-b2', 'Boundary B', 'Boundary B', now()
       );
       INSERT INTO "HistoricalCampaignAliasEvent" (
         id, "aliasId", action, actor, "requestId"
       ) VALUES (
         'b2-alias-ev', 'b2-alias', 'recorded', 'boundary-b-proof', 'b2-alias-req'
       );
       INSERT INTO "LeadAgeBandDefinition" (
         id, version, key, label, "minDaysInclusive", "sortOrder", "updatedAt"
       ) VALUES (
         'b2-band', 'b2', 'all', 'All', 0, 1, now()
       );
       COMMIT;`,
    );
    assert.equal(prepared.status, 0, prepared.output);

    const writes = capture(
      "sa360_app",
      `BEGIN;
       INSERT INTO "ClientAccount" ("clientAccountId", "clientDisplayName", "portalEnabled", "updatedAt")
       VALUES
         ('b2-master', 'Boundary B master', false, now()),
         ('b2-client', 'Boundary B portal', true, now()),
         ('b2-other', 'Boundary B other', true, now());
       INSERT INTO "CampaignRoutingRule" (
         id, "masterClientAccountId", "clientAccountId", "campaignId", "matchType", "updatedAt"
       ) VALUES (
         'b2-rule', 'b2-master', 'b2-client', 'camp-b2', 'campaign_id', now()
       );
       INSERT INTO "WebhookRequestLog" (
         id, "requestId", source, route, "processingStatus", "clientAccountId", "updatedAt"
       ) VALUES (
         'b2-lc-wh', 'b2-lc-req', 'leadcapture_io', '/sources/leadcapture/nextgen/lead-created', 'ok', 'b2-client', now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson",
         "sourceRouteKey", "clientAccountIdResolved", "routingRuleIdResolved",
         "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'b2-lc-evt', 'leadcapture_io', 'leadcapture_io_nextgen', 'webhook', 'routing_matched',
         '{"fixture":"boundary-b"}'::jsonb, 'lc-b2', 'b2-client', 'b2-rule', now(), now(), now()
       );
       INSERT INTO "LeadAttribution" (id, "leadUid", "sourcePlatform", "campaignId")
       VALUES ('b2-attr', 'b2-lead-uid', 'leadcapture_io', 'camp-b2');
       INSERT INTO "RoutingDryRunDecision" (
         id, "masterClientAccountId", "sourceLeadUid", matched, confidence, "matchedRuleId",
         "destinationClientAccountId", "matchReason", "routingEventNameInternal"
       ) VALUES (
         'b2-route', 'b2-master', 'b2-lead-uid', true, 'high', 'b2-rule',
         'b2-client', 'campaign_id', 'lead_routed'
       );
       INSERT INTO "LeadDuplicateRiskAssessment" (
         id, "masterClientAccountId", "destinationClientAccountId", "routingDryRunDecisionId",
         "sourceLeadUid", "normalizedPhone", "riskLevel", "updatedAt"
       ) VALUES (
         'b2-dup', 'b2-master', 'b2-client', 'b2-route', 'b2-lead-uid', 'fp-phone-b2', 'none', now()
       );
       INSERT INTO "InboundContactIndex" (
         id, "clientAccountId", "phoneE164", "sourceOrigin", "leadUid", "updatedAt"
       ) VALUES
         ('b2-id-a', 'b2-client', '+15555550100', 'lifecycle_webhook', 'b2-lead-uid', now()),
         ('b2-id-b', 'b2-other', '+15555550100', 'lifecycle_webhook', 'b2-lead-uid', now());
       INSERT INTO "SourceRouteSchemaSnapshot" (
         id, "sourceProvider", "sourceRouteKey", "fieldKeysJson", "schemaFingerprint", "updatedAt"
       ) VALUES (
         'b2-schema', 'leadcapture_io', 'lc-b2', '["phone"]'::jsonb, 'b2', now()
       );
       INSERT INTO "WebhookRequestLog" (
         id, "requestId", source, route, "processingStatus", "sourceLeadEventId", "updatedAt"
       ) VALUES (
         'b2-fb-wh', 'b2-fb-req', 'facebook_lead_ads', '/sources/facebook/lead-created', 'ok', NULL, now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson",
         "sourceLeadId", "webhookRequestLogId", "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'b2-fb-evt', 'facebook', 'meta_lead_ads', 'lead_form', 'received',
         '{"fixture":"boundary-b"}'::jsonb, 'fb-b2', 'b2-fb-wh', now(), now(), now()
       );
       UPDATE "WebhookRequestLog"
       SET "sourceLeadEventId" = 'b2-fb-evt', "updatedAt" = now()
       WHERE id = 'b2-fb-wh';
       INSERT INTO "MetaDispatchAttempt" (id, "eventUuid", "attemptNumber", success)
       VALUES ('b2-meta', 'b2-fb-event', 1, false);
       UPDATE "MetaDispatchAttempt"
       SET success = true, "httpStatus" = 200
       WHERE id = 'b2-meta';
       INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey",
         "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES (
         'b2-lot', 'vet-b2', 'Boundary B', 'manual_import', 'b2', 'vet', 'aged', 'active', now(), now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson",
         "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'b2-live-evt', 'leadcapture_io', 'leadcapture_io_nextgen', 'webhook', 'approved',
         '{"fixture":"boundary-b"}'::jsonb, now(), now(), now()
       );
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       ) VALUES (
         'b2-live-item', 'b2-lot', 'b2-live-evt', now(), 'GA', 'vet',
         'leadcapture_io', 'b2', 'aged', 'available', now(), now(), now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'b2-hist-evt', 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Boundary B',
         jsonb_build_object('importRequestId', 'imp-b2'), '{"campaign_name":"Boundary B"}'::jsonb,
         now(), now(), now()
       );
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       ) VALUES (
         'b2-hist-item', 'b2-lot', 'b2-hist-evt', now(), 'GA', 'vet',
         'manual_import', 'b2', 'aged', 'available', now(), now(), now()
       );
       SELECT id FROM "LeadInventoryItem" WHERE id = 'b2-hist-item' FOR UPDATE;
       UPDATE "LeadInventoryItem"
       SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
       WHERE id = 'b2-hist-item';
       SELECT id FROM "LeadInventoryItem" WHERE id = 'b2-live-item' AND status = 'available' FOR SHARE;
       INSERT INTO "LeadOrder" (
         id, "orderNumber", "clientAccountId", "nicheKey", "leadVolume", "campaignType",
         "crmPackage", "createdByRole", "updatedAt"
       ) VALUES (
         'b2-order', 'B2-1', 'b2-client', 'vet', 1, 'aged', 'none', 'client', now()
       );
       INSERT INTO "LeadOrderLine" (
         id, "leadOrderId", "lineNumber", "nicheKey", "requestedQuantity", "updatedAt"
       ) VALUES (
         'b2-line', 'b2-order', 1, 'vet', 1, now()
       );
       INSERT INTO "LeadAllocation" (
         id, "sourceLeadEventId", "leadOrderId", "leadOrderLineId", "leadInventoryItemId",
         "clientAccountId", status, "allocationPolicyVersion", "idempotencyKey", "updatedAt"
       ) VALUES (
         'b2-alloc', 'b2-hist-evt', 'b2-order', 'b2-line', 'b2-hist-item',
         'b2-client', 'reserved', 'b2', 'b2-alloc', now()
       );
       UPDATE "LeadOrder"
       SET "reservedQuantity" = 1, "updatedAt" = now()
       WHERE id = 'b2-order';
       UPDATE "LeadOrderLine"
       SET status = 'reserved', "reservedQuantity" = 1, "updatedAt" = now()
       WHERE id = 'b2-line';
       INSERT INTO "BuyerDeliveredIdentity" (
         id, "clientAccountId", "phoneFingerprint", "sourceLeadEventId", "leadAllocationId", "leadInventoryItemId"
       ) VALUES
         ('b2-buyer-a', 'b2-client', 'fp-phone-b2', 'b2-hist-evt', 'b2-alloc', 'b2-hist-item'),
         ('b2-buyer-b', 'b2-other', 'fp-phone-b2', 'b2-fb-evt', 'b2-alloc', NULL);
       INSERT INTO "FulfillmentOutbox" (
         id, "idempotencyKey", "sourceLeadEventId", "workType", status, "updatedAt"
       ) VALUES (
         'b2-outbox', 'b2-outbox', 'b2-lc-evt', 'shadow', 'pending', now()
       );
       UPDATE "FulfillmentOutbox"
       SET status = 'completed', "completedAt" = now(), "updatedAt" = now()
       WHERE id = 'b2-outbox';
       INSERT INTO "LeadReplacementRequest" (
         id, "clientAccountId", "leadOrderId", "originalAllocationId", status, reason, "requestId", "updatedAt"
       ) VALUES (
         'b2-replace', 'b2-client', 'b2-order', 'b2-alloc', 'requested', 'duplicate', 'b2-replace', now()
       );
       UPDATE "LeadReplacementRequest"
       SET status = 'approved', "decidedAt" = now(), "updatedAt" = now()
       WHERE id = 'b2-replace';
       INSERT INTO "DeliveryTarget" (
         id, "clientAccountId", "displayName", "adapterKey", "updatedAt"
       ) VALUES (
         'b2-target', 'b2-client', 'Boundary B sheets', 'google_sheets.v1', now()
       );
       INSERT INTO "DeliveryInstruction" (
         id, "leadAllocationId", "deliveryTargetId", sequence, "updatedAt"
       ) VALUES (
         'b2-instruction', 'b2-alloc', 'b2-target', 1, now()
       );
       INSERT INTO "DeliveryAttempt" (
         id, "deliveryInstructionId", "adapterKey", "attemptNumber", "idempotencyKey",
         "executionMode", status, "updatedAt"
       ) VALUES (
         'b2-attempt', 'b2-instruction', 'google_sheets.v1', 1, 'b2-attempt',
         'simulation', 'planned', now()
       );
       UPDATE "DeliveryAttempt"
       SET status = 'succeeded', "completedAt" = now(), "updatedAt" = now()
       WHERE id = 'b2-attempt';
       SELECT pg_advisory_xact_lock(hashtext('b2-sheets-drain'));
       INSERT INTO "CompanyGoogleConnection" (id, "connectionKey", "updatedAt")
       VALUES ('b2-google', 'b2-company', now());
       INSERT INTO "CompanySheetsDestination" (
         id, "clientAccountId", "companyConnectionId", "spreadsheetId", "spreadsheetUrl",
         "worksheetId", "worksheetTitle", "controlBasis", "sharingStatus", "updatedAt"
       ) VALUES (
         'b2-dest', 'b2-client', 'b2-google', 'sheet-b2', 'https://docs.example.invalid/sheet-b2',
         1, 'Leads', 'company_created', 'missing_recipient', now()
       );
       INSERT INTO "CompanySheetsWorksheetLock" ("spreadsheetId", "worksheetId")
       VALUES ('sheet-b2', 1);
       INSERT INTO "CompanySheetsDispatchIntent" (
         id, "idempotencyKey", kind, status, "clientAccountId", "sourceLeadEventId", "updatedAt"
       ) VALUES (
         'b2-intent', 'b2-intent', 'campaign_lead', 'pending', 'b2-client', 'b2-lc-evt', now()
       );
       INSERT INTO "CompanySheetsDeliveryJob" (
         id, kind, status, "clientAccountId", "companyConnectionId", "destinationId",
         "spreadsheetId", "spreadsheetUrl", "worksheetId", "worksheetTitle", "controlBasis",
         "destinationUpdatedAt", "headerContract", "idempotencyKey", "rowsTotal", "updatedAt"
       ) VALUES (
         'b2-job', 'lead', 'queued', 'b2-client', 'b2-google', 'b2-dest',
         'sheet-b2', 'https://docs.example.invalid/sheet-b2', 1, 'Leads', 'company_created',
         now(), '{}'::jsonb, 'b2-job', 1, now()
       );
       INSERT INTO "CompanySheetsDeliveryRow" (
         id, "jobId", "spreadsheetId", "worksheetId", "stableRowId", ordinal, "valuesJson", "updatedAt"
       ) VALUES (
         'b2-row', 'b2-job', 'sheet-b2', 1, 'b2-stable', 1, '["Boundary B"]'::jsonb, now()
       );
       UPDATE "CompanySheetsWorksheetLock"
       SET "ownerJobId" = 'b2-job', "lockedAt" = now()
       WHERE "spreadsheetId" = 'sheet-b2' AND "worksheetId" = 1;
       UPDATE "CompanySheetsDispatchIntent"
       SET status = 'processing', "jobId" = 'b2-job', "updatedAt" = now()
       WHERE id = 'b2-intent';
       UPDATE "CompanySheetsDeliveryJob"
       SET status = 'succeeded', "rowsWritten" = 1, "updatedAt" = now()
       WHERE id = 'b2-job';
       INSERT INTO "CompanySheetsClientFolder" (
         "clientAccountId", status, "updatedAt"
       ) VALUES (
         'b2-client', 'creating', now()
       );
       DELETE FROM "CompanySheetsClientFolder"
       WHERE "clientAccountId" = 'b2-client' AND status = 'creating';
       INSERT INTO "CompanySheetsClientFolder" (
         "clientAccountId", "folderId", "folderTitle", status, "operationToken", "linkedAt", "updatedAt"
       ) VALUES (
         'b2-client', 'folder-b2', 'Boundary B folder', 'linked', 'op-b2', now(), now()
       );
       UPDATE "CompanySheetsClientFolder"
       SET "folderTitle" = 'Boundary B folder linked', "updatedAt" = now()
       WHERE "clientAccountId" = 'b2-client';
       INSERT INTO "CompanySheetsFolderEvent" (
         id, "clientAccountId", "folderId", "folderTitle", action
       ) VALUES (
         'b2-folder-event', 'b2-client', 'folder-b2', 'Boundary B folder linked', 'linked'
       );
       INSERT INTO "CompanySheetsSpreadsheetLink" (
         id, "clientAccountId", "spreadsheetId", "spreadsheetTitle", "spreadsheetUrl", status
       ) VALUES (
         'b2-link-old', 'b2-client', 'sheet-b2-old', 'Old', 'https://docs.example.invalid/sheet-b2-old', 'current'
       );
       UPDATE "CompanySheetsSpreadsheetLink"
       SET status = 'superseded', "supersededAt" = now()
       WHERE id = 'b2-link-old';
       INSERT INTO "CompanySheetsSpreadsheetLink" (
         id, "clientAccountId", "spreadsheetId", "spreadsheetTitle", "spreadsheetUrl", status
       ) VALUES (
         'b2-link', 'b2-client', 'sheet-b2', 'Leads', 'https://docs.example.invalid/sheet-b2', 'current'
       );
       INSERT INTO "LeadDeliveryPlan" (
         id, "routingDryRunDecisionId", "masterClientAccountId", "destinationClientAccountId",
         "sourceLeadUid", status, "updatedAt"
       ) VALUES (
         'b2-plan', 'b2-route', 'b2-master', 'b2-client', 'b2-lead-uid', 'planned', now()
       );
       INSERT INTO "LeadDeliveryPlanStep" (
         id, "deliveryPlanId", "stepOrder", "stepType", title, "updatedAt"
       ) VALUES (
         'b2-step', 'b2-plan', 1, 'contact', 'Boundary B contact', now()
       );
       INSERT INTO "GhlDeliveryAdapterRun" (
         id, "leadDeliveryPlanId", "routingDryRunDecisionId", "masterClientAccountId",
         "destinationClientAccountId", mode, status, "updatedAt"
       ) VALUES (
         'b2-ghl', 'b2-plan', 'b2-route', 'b2-master', 'b2-client', 'simulation', 'running', now()
       );
       INSERT INTO "GhlDeliveryAdapterStepRun" (
         id, "adapterRunId", "stepOrder", "stepType", mode, status, title, "updatedAt"
       ) VALUES (
         'b2-ghl-step', 'b2-ghl', 1, 'contact', 'simulation', 'running', 'Boundary B contact', now()
       );
       UPDATE "GhlDeliveryAdapterRun"
       SET status = 'succeeded', "completedAt" = now(), "updatedAt" = now()
       WHERE id = 'b2-ghl';
       SELECT pg_try_advisory_xact_lock(hashtext('b2-worker-schedule'));
       INSERT INTO "SupportTicket" (id, description, "updatedAt")
       VALUES ('b2-ticket', 'boundary b sequence probe', now());
       INSERT INTO "WebhookRequestLog" (
         id, "requestId", source, route, "processingStatus", "updatedAt"
       ) VALUES (
         'b2-delete-me', 'b2-delete-req', 'leadcapture_io', '/sources/leadcapture/nextgen/lead-created', 'probe', now()
       );
       DELETE FROM "WebhookRequestLog" WHERE id = 'b2-delete-me';
       DO $b2$
       BEGIN
         IF current_user IS DISTINCT FROM 'sa360_app' THEN
           RAISE EXCEPTION 'restricted login did not stay sa360_app';
         END IF;
         IF EXISTS (SELECT 1 FROM "WebhookRequestLog" WHERE id = 'b2-delete-me') THEN
           RAISE EXCEPTION 'delete privilege did not remove the probe row';
         END IF;
       END
       $b2$;
       COMMIT;`,
    );
    assert.equal(writes.status, 0, writes.output);

    const db = roleUrl("sa360_app");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'b2-live-item'`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'b2-fb-evt'`), "0");
    assert.equal(scalar(db, `SELECT item_status FROM historical_catalog_projection WHERE item_id = 'b2-hist-item'`), "reserved");
    assert.equal(scalar(db, `SELECT status FROM "LeadInventoryItem" WHERE id = 'b2-live-item'`), "available");
    assert.equal(scalar(db, `SELECT "reservedQuantity"::text FROM "LeadOrder" WHERE id = 'b2-order'`), "1");
    assert.equal(scalar(db, `SELECT status FROM "LeadReplacementRequest" WHERE id = 'b2-replace'`), "approved");
    assert.equal(scalar(db, `SELECT status FROM "FulfillmentOutbox" WHERE id = 'b2-outbox'`), "completed");
    assert.equal(scalar(db, `SELECT status FROM "CompanySheetsDeliveryJob" WHERE id = 'b2-job'`), "succeeded");
    assert.equal(scalar(db, `SELECT "ownerJobId" FROM "CompanySheetsWorksheetLock" WHERE "spreadsheetId" = 'sheet-b2'`), "b2-job");
    assert.equal(scalar(db, `SELECT status FROM "CompanySheetsDispatchIntent" WHERE id = 'b2-intent'`), "processing");
    assert.equal(
      scalar(db, `SELECT "folderTitle" FROM "CompanySheetsClientFolder" WHERE "clientAccountId" = 'b2-client'`),
      "Boundary B folder linked",
    );
    assert.equal(scalar(db, `SELECT action FROM "CompanySheetsFolderEvent" WHERE id = 'b2-folder-event'`), "linked");
    assert.equal(scalar(db, `SELECT status FROM "CompanySheetsSpreadsheetLink" WHERE id = 'b2-link-old'`), "superseded");
    assert.equal(scalar(db, `SELECT status FROM "CompanySheetsSpreadsheetLink" WHERE id = 'b2-link'`), "current");
    assert.equal(scalar(db, `SELECT status FROM "GhlDeliveryAdapterRun" WHERE id = 'b2-ghl'`), "succeeded");
    assert.equal(scalar(db, `SELECT success::text FROM "MetaDispatchAttempt" WHERE id = 'b2-meta'`), "true");
    assert.equal(scalar(db, `SELECT count(*)::text FROM "InboundContactIndex" WHERE "phoneE164" = '+15555550100'`), "2");
    assert.equal(scalar(db, `SELECT count(*)::text FROM "BuyerDeliveredIdentity" WHERE "phoneFingerprint" = 'fp-phone-b2'`), "2");
    assert.equal(scalar(db, `SELECT "normalizedLabel" FROM "HistoricalCampaignAlias" WHERE id = 'b2-alias'`), "Boundary B");
    assert.equal(scalar(db, `SELECT label FROM "LeadAgeBandDefinition" WHERE id = 'b2-band'`), "All");
    assert.equal(scalar(db, `SELECT ready::text FROM historical_catalog_projection_control`), "true");
    assert.match(
      scalar(db, `SELECT decision FROM historical_campaign_ownership_decision('vet-b2', NULL, 'Boundary B')`),
      /.+/,
    );
    assert.equal(scalar(db, `SELECT historical_july_campaign_label_normalize('Boundary B')`), "Boundary B");
    assert.match(scalar(db, `SELECT historical_registry_scope_key_kind('vet-b2')`), /.+/);
    assert.match(scalar(db, `SELECT "ticketNumber"::text FROM "SupportTicket" WHERE id = 'b2-ticket'`), /^[1-9]/);
    const owner = roleUrl("doadmin");
    assert.equal(scalar(owner, `SELECT count(*)::text FROM historical_catalog_summary_membership`), "0");
    assert.equal(scalar(owner, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(scalar(owner, `SELECT source_row_count::text FROM historical_catalog_projection_control`), "4");
  });

  it("denies migration history, summary control, privileged routines, and protected records", () => {
    const denied: Array<[string, string]> = [
      ["migrations", `SELECT count(*) FROM _prisma_migrations`],
      [
        "migration insert",
        `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
         VALUES ('b2-mig', 'x', 'b2-mig', now(), 0)`,
      ],
      ["summary update", `UPDATE historical_catalog_summary_control SET summary_ready = true`],
      ["summary read", `SELECT summary_ready FROM historical_catalog_summary_control`],
      ["projection ready", `UPDATE historical_catalog_projection_control SET ready = false`],
      ["projection count", `UPDATE historical_catalog_projection_control SET source_row_count = 0`],
      ["backfill", `CALL historical_catalog_projection_backfill_chunk('a', 'b')`],
      ["diff", `SELECT item_id FROM historical_catalog_projection_diff('a', 'b', 1)`],
      ["resale routine", `SELECT historical_resale_authorization_decision(NULL, NULL, now())`],
      ["summary sequence", `SELECT nextval('public.historical_catalog_summary_bucket_bucket_id_seq')`],
      [
        "alias event",
        `INSERT INTO "HistoricalCampaignAliasEvent" (id, "aliasId", action, actor, "requestId")
         VALUES ('b2-deny-ev', 'b2-alias', 'recorded', 'x', 'b2-deny-req')`,
      ],
      ["consent", `SELECT count(*) FROM "ConsentDisclosureVersion"`],
      ["failed dispatch", `SELECT count(*) FROM "FailedDispatch"`],
      ["guidance version", `SELECT count(*) FROM "GuidanceResourceVersion"`],
      ["truncate", `TRUNCATE "LeadInventoryItem"`],
      [
        "folder event update",
        `UPDATE "CompanySheetsFolderEvent" SET action = 'denied' WHERE id = 'b2-folder-event'`,
      ],
      ["folder event delete", `DELETE FROM "CompanySheetsFolderEvent" WHERE id = 'b2-folder-event'`],
      ["spreadsheet link delete", `DELETE FROM "CompanySheetsSpreadsheetLink" WHERE id = 'b2-link'`],
      ["truncate folder", `TRUNCATE "CompanySheetsClientFolder"`],
      ["truncate folder event", `TRUNCATE "CompanySheetsFolderEvent"`],
      ["truncate spreadsheet link", `TRUNCATE "CompanySheetsSpreadsheetLink"`],
      ["create", `CREATE TABLE public.b2_denied (id int)`],
      ["set owner", `SET ROLE sa360_schema_owner`],
      ["set operator", `SET ROLE sa360_summary_operator`],
      ["set doadmin", `SET ROLE doadmin`],
      ["disable trigger", `ALTER TABLE "LeadInventoryItem" DISABLE TRIGGER historical_catalog_projection_item_refresh`],
    ];
    const gaps: string[] = [];
    for (const [name, statement] of denied) {
      const result = capture("sa360_app", statement);
      if (result.status === 0 || !/permission denied|must be owner/i.test(result.output)) {
        gaps.push(`${name}\n${result.output}`);
      }
    }
    assert.deepEqual(gaps, []);
    const owner = roleUrl("doadmin");
    assert.equal(scalar(owner, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(scalar(owner, `SELECT ready::text FROM historical_catalog_projection_control`), "true");
    assert.equal(scalar(owner, `SELECT source_row_count::text FROM historical_catalog_projection_control`), "4");
    assert.equal(
      scalar(owner, `SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'historical_catalog_summary_%'`),
      "0",
    );
  });

  it("keeps doadmin summary writes behind SET ROLE and not inheritance", () => {
    const direct = capture(
      "doadmin",
      `BEGIN;
       UPDATE historical_catalog_summary_control SET failure_count = 1;
       ROLLBACK;`,
    );
    assert.notEqual(direct.status, 0, direct.output);
    assert.match(direct.output, /permission denied/i);
    const throughSet = capture(
      "doadmin",
      `BEGIN;
       SET LOCAL ROLE sa360_schema_owner;
       UPDATE historical_catalog_summary_control SET failure_count = 1;
       ROLLBACK;`,
    );
    assert.equal(throughSet.status, 0, throughSet.output);
    const db = roleUrl("doadmin");
    assert.equal(scalar(db, `SELECT failure_count::text FROM historical_catalog_summary_control`), "0");
    assert.equal(
      scalar(db, `SELECT has_table_privilege('doadmin', 'public.historical_catalog_summary_control', 'UPDATE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT has_table_privilege('doadmin', 'public.historical_catalog_summary_control', 'SELECT')::text`),
      "true",
    );
    assert.equal(
      scalar(db, `SELECT has_table_privilege('sa360_summary_reader', 'public.historical_catalog_summary_control', 'SELECT')::text`),
      "false",
    );
    const migrateRead = capture("doadmin", `SELECT count(*) FROM _prisma_migrations`);
    assert.equal(migrateRead.status, 0, migrateRead.output);
    const appMigrate = capture("sa360_app", `SELECT count(*) FROM _prisma_migrations`);
    assert.notEqual(appMigrate.status, 0, appMigrate.output);
  });

  it("lets sa360_app use the onboarding grants and denies the omitted operations", () => {
    const owner = roleUrl("doadmin");
    assert.equal(
      scalar(
        owner,
        `SELECT (finished_at IS NOT NULL AND rolled_back_at IS NULL)::text
         FROM "_prisma_migrations"
         WHERE migration_name = '20261026233000_client_onboarding_v2_persistence'`,
      ),
      "true",
    );
    const names = [
      "ClientOnboardingDestinationProfile",
      "ClientOnboardingVerifiedTestIdentity",
      "ClientOnboardingTestWorksheet",
      "ClientOnboardingTestRun",
      "ClientOnboardingTestAttempt",
      "ClientOnboardingTestAttemptKey",
      "ClientSheetColumnMap",
      "ClientOnboardingActivationIntent",
      "ClientOnboardingV2AuditEvent",
    ];
    assert.equal(
      scalar(
        owner,
        `SELECT count(*)::text
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
         WHERE namespace.nspname = 'public'
           AND owner_role.rolname = 'doadmin'
           AND relation.relname IN (${names.map((name) => `'${name}'`).join(",")})`,
      ),
      "9",
    );
    const privileges: Record<string, string> = {
      ClientOnboardingDestinationProfile: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingVerifiedTestIdentity: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingTestWorksheet: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingTestRun: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingTestAttempt: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingTestAttemptKey: "DELETE,INSERT,SELECT",
      ClientSheetColumnMap: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingActivationIntent: "SELECT,INSERT,UPDATE,DELETE",
      ClientOnboardingV2AuditEvent: "INSERT,SELECT,UPDATE",
    };
    for (const [table, expected] of Object.entries(privileges)) {
      assert.equal(
        scalar(
          owner,
          `SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
           FROM information_schema.role_table_grants
           WHERE grantee = 'sa360_app' AND table_schema = 'public' AND table_name = '${table}'
             AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')`,
        ),
        expected.split(",").sort().join(","),
        table,
      );
    }
    assert.equal(
      scalar(
        owner,
        `SELECT count(*)::text FROM information_schema.role_table_grants
         WHERE grantee IN ('sa360_app', 'PUBLIC')
           AND is_grantable = 'YES'
           AND table_name IN (${names.map((name) => `'${name}'`).join(",")})`,
      ),
      "0",
    );
    assert.equal(
      scalar(
        owner,
        `SELECT count(*)::text FROM information_schema.role_table_grants
         WHERE grantee = 'PUBLIC' AND table_name IN (${names.map((name) => `'${name}'`).join(",")})`,
      ),
      "0",
    );
    assert.equal(scalar(owner, `SELECT count(*)::text FROM pg_default_acl`), "0");
    assert.equal(
      scalar(
        owner,
        `SELECT count(*)::text FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname LIKE 'client_onboarding_v2_%'
           AND prosecdef`,
      ),
      "0",
    );
    assert.equal(
      scalar(
        owner,
        `SELECT has_function_privilege('sa360_app', 'client_onboarding_v2_test_attempt_guard()', 'EXECUTE')::text`,
      ),
      "true",
    );
    const written = capture(
      "sa360_app",
      `BEGIN;
       INSERT INTO "ClientAccount" ("clientAccountId", "clientDisplayName", "updatedAt")
       VALUES ('b2-onboard', 'Boundary B onboarding', now()),
              ('b2-onboard-next', 'Boundary B onboarding next', now());
       INSERT INTO "ClientOnboardingDestinationProfile"
         (id, "clientAccountId", "ghlMode", "notesEnabled", revision, "updatedAt")
       VALUES ('b2-profile', 'b2-onboard', 'location_api', false, 1, now());
       UPDATE "ClientOnboardingDestinationProfile" SET revision = 2, "updatedAt" = now() WHERE id = 'b2-profile';
       INSERT INTO "ClientOnboardingVerifiedTestIdentity"
         (id, "clientAccountId", email, "evidenceJson", "requestId", "updatedAt")
       VALUES ('b2-identity', 'b2-onboard', 'operator@example.invalid', '{}'::jsonb, 'b2-identity-req', now());
       INSERT INTO "ClientOnboardingTestWorksheet"
         (id, "clientAccountId", "spreadsheetId", "worksheetId", "worksheetTitle", "schemaVersion",
          header, "headerSha256", "destinationRevision", "controlBasis", "approvedAt", "updatedAt")
       VALUES (
         'b2-worksheet', 'b2-onboard', 'sheet-b2-onboard', 1, 'Campaign', 'company_sheets_campaign_v3',
         client_onboarding_v2_exact_v3_header(), repeat('ab', 32), 1,
         '{"establishControl":"company_created","checkedAt":"2026-10-27T00:00:00Z"}'::jsonb,
         now(), now()
       );
       INSERT INTO "ClientOnboardingTestRun"
         (id, "clientAccountId", kind, destinations, "isolationMode", "requestId", status,
          "requestSnapshot", "warningCodes", "updatedAt")
       VALUES (
         'b2-run', 'b2-onboard', 'preview', '["ghl_location_api"]'::jsonb, 'verified_test_identity',
         'b2-run-req', 'executing', '{"fixture":"boundary-b"}'::jsonb, '[]'::jsonb, now()
       );
       INSERT INTO "ClientOnboardingTestAttempt"
         (id, "testRunId", destination, "idempotencyKey", status, "ownerClientAccountId", "updatedAt")
       VALUES (
         'b2-attempt', 'b2-run', 'ghl_location_api', 'onboarding-test:b2:ghl-contact', 'executing',
         'b2-onboard', now()
       );
       INSERT INTO "ClientOnboardingTestAttemptKey" ("idempotencyKey", "attemptId", "callKind")
       VALUES ('onboarding-test:b2:ghl-contact', 'b2-attempt', 'ghl_contact');
       UPDATE "ClientOnboardingTestAttempt" SET status = 'succeeded', "updatedAt" = now() WHERE id = 'b2-attempt';
       UPDATE "ClientOnboardingTestRun" SET status = 'succeeded', "updatedAt" = now() WHERE id = 'b2-run';
       INSERT INTO "ClientSheetColumnMap"
         (id, "clientAccountId", "sourceScope", "spreadsheetId", "worksheetId", "mapVersion", status,
          "baseSchemaVersion", "headerSnapshot", assignments, revision, "updatedAt")
       VALUES (
         'b2-map', 'b2-onboard', 'shared', 'sheet-b2-onboard', 2, 1, 'draft',
         'company_sheets_campaign_v3', '["Phone"]'::jsonb, '[]'::jsonb, 1, now()
       );
       UPDATE "ClientSheetColumnMap" SET revision = 2, "updatedAt" = now() WHERE id = 'b2-map';
       INSERT INTO "ClientOnboardingActivationIntent"
         (id, "clientAccountId", destination, status, "requestId", "expectedReceiptIds",
          "readinessEvidenceJson", "confirmationPhrase", "updatedAt")
       VALUES (
         'b2-intent-onboard', 'b2-onboard', 'ghl_location_api', 'ready_for_operator', 'b2-activate-req',
         '[]'::jsonb, '{}'::jsonb, 'ACTIVATE CLIENT ONBOARDING DESTINATION', now()
       );
       INSERT INTO "ClientOnboardingV2AuditEvent"
         (id, "clientAccountId", "historicalClientAccountId", "requestId", action, destinations, "metadataJson")
       VALUES (
         'b2-audit', 'b2-onboard', 'b2-onboard', 'b2-audit-req', 'destination_saved', '[]'::jsonb, '{}'::jsonb
       );
       UPDATE "ClientOnboardingV2AuditEvent" SET "clientAccountId" = 'b2-onboard-next' WHERE id = 'b2-audit';
       UPDATE "ClientOnboardingTestRun" SET "clientAccountId" = 'b2-onboard-next', "updatedAt" = now() WHERE id = 'b2-run';
       COMMIT;`,
    );
    assert.equal(written.status, 0, written.output);
    assert.equal(
      scalar(owner, `SELECT "ownerClientAccountId" FROM "ClientOnboardingTestAttempt" WHERE id = 'b2-attempt'`),
      "b2-onboard-next",
    );
    const denied = [
      ["attempt key update", `UPDATE "ClientOnboardingTestAttemptKey" SET "callKind" = "callKind"`],
      ["audit delete", `DELETE FROM "ClientOnboardingV2AuditEvent" WHERE id = 'b2-audit'`],
      ["profile truncate", `TRUNCATE "ClientOnboardingDestinationProfile"`],
      ["migration select", `SELECT count(*) FROM "_prisma_migrations"`],
    ] as const;
    for (const [name, statement] of denied) {
      const result = capture("sa360_app", statement);
      assert.notEqual(result.status, 0, name);
      assert.match(result.output, /permission denied/i, name);
    }
  });
});
