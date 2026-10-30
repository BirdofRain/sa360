/**
 * Disposable-database helpers for Gate 12 summary maintenance tests.
 * Connections are derived from SA360_TEST_DATABASE_URL and must stay on localhost.
 * Database names passed here contain "test". This file is not a test suite.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

export const repoRoot = join(import.meta.dirname, "../../../../..");
export const candidateDir = join(
  repoRoot,
  "prisma/candidates/historical-catalog-summary-maintenance-v1",
);

export function integrationUrl(): string {
  return process.env.SA360_TEST_DATABASE_URL?.trim() || "";
}

export function localDatabaseUrl(database: string): string {
  const base = integrationUrl();
  if (!base) throw new Error("SA360_TEST_DATABASE_URL is required");
  const url = new URL(base);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("refusing a non-local database");
  }
  url.pathname = `/${database}`;
  const value = url.toString();
  if (database !== "sa360") assertSafeTestDatabaseUrl(value);
  return value;
}

export function psqlCapture(
  databaseUrl: string,
  sql: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", sql],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function psql(databaseUrl: string, sql: string): string {
  const result = psqlCapture(databaseUrl, sql);
  if (result.status !== 0) {
    throw new Error(`${result.stderr}\n${result.stdout}`.trim() || "psql failed");
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function scalar(databaseUrl: string, sql: string): string {
  const result = spawnSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "psql scalar failed");
  }
  return result.stdout.trim();
}

export function psqlFile(databaseUrl: string, filePath: string): void {
  const result = spawnSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", filePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "psql file failed");
  }
}

export function recreate(database: string): string {
  const adminUrl = localDatabaseUrl("sa360");
  psql(
    adminUrl,
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  );
  psql(adminUrl, `DROP DATABASE IF EXISTS ${database}`);
  psql(adminUrl, `CREATE DATABASE ${database}`);
  return localDatabaseUrl(database);
}

export function dropDatabase(database: string): void {
  const adminUrl = localDatabaseUrl("sa360");
  psql(
    adminUrl,
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  );
  psql(adminUrl, `DROP DATABASE IF EXISTS ${database}`);
}

export function migrate(databaseUrl: string): void {
  const result = spawnSync("pnpm", ["migrate:deploy"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "migrate failed");
  }
}

/** Migrations that create relations Boundary A's 106-relation inventory rejects. */
export const postBoundaryAMigrations = [
  "20261023220000_company_sheets_setup_links",
  "20261026200000_company_sheets_setup_grants",
  "20261026233000_client_onboarding_v2_persistence",
] as const;

/**
 * Apply every Prisma migration except the named directories.
 * The copied files keep the checksums Prisma records, so a later
 * `migrate()` applies only the excluded directories.
 */
export function migrateExcluding(databaseUrl: string, excluded: readonly string[]): void {
  const source = join(repoRoot, "prisma");
  const dir = mkdtempSync(join(tmpdir(), "sa360-migrate-baseline-"));
  try {
    cpSync(join(source, "schema.prisma"), join(dir, "schema.prisma"));
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    cpSync(join(source, "migrations", "migration_lock.toml"), join(migrations, "migration_lock.toml"));
    const skipped = new Set(excluded);
    for (const name of readdirSync(join(source, "migrations"))) {
      if (skipped.has(name)) continue;
      const from = join(source, "migrations", name);
      if (!statSync(from).isDirectory()) continue;
      cpSync(from, join(migrations, name), { recursive: true });
    }
    const result = spawnSync(
      "pnpm",
      ["exec", "prisma", "migrate", "deploy", "--schema", join(dir, "schema.prisma")],
      {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "baseline migrate failed");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function loadCandidate(databaseUrl: string, withTriggers: boolean): void {
  psqlFile(databaseUrl, join(candidateDir, "functions.sql"));
  if (withTriggers) psqlFile(databaseUrl, join(candidateDir, "triggers.sql"));
}
