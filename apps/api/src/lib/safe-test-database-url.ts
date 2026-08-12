/**
 * Positive-allowlist guard for Prisma-backed automated tests.
 * Never logs credentials. NODE_ENV=test alone is not sufficient.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type SafeTestDatabaseUrlIdentity = {
  protocol: string;
  host: string;
  port: string;
  database: string;
  sanitized: string;
};

export function parseSafeTestDatabaseUrlIdentity(
  databaseUrl: string
): SafeTestDatabaseUrlIdentity {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("SA360_TEST_DATABASE_URL is not a valid URL");
  }

  const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== "postgres" && protocol !== "postgresql") {
    throw new Error(
      `SA360_TEST_DATABASE_URL protocol must be postgres/postgresql (got ${protocol || "empty"})`
    );
  }

  // WHATWG URL may keep brackets on IPv6 hostnames (e.g. "[::1]").
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `SA360_TEST_DATABASE_URL host must be localhost/127.0.0.1/::1 (got ${host || "empty"}). ` +
        "Remote hosts including *.db.ondigitalocean.com are rejected."
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "").trim());
  if (!database) {
    throw new Error("SA360_TEST_DATABASE_URL database name is required");
  }
  if (!/test/i.test(database)) {
    throw new Error(
      `SA360_TEST_DATABASE_URL database name must identify a test-only database ` +
        `(expected name containing "test", got ${database})`
    );
  }

  const port = parsed.port || "5432";
  const user = decodeURIComponent(parsed.username || "unknown");
  return {
    protocol,
    host,
    port,
    database,
    sanitized: `postgres://${user}@${host}:${port}/${database}`,
  };
}

/** Validate and return a trimmed safe local test database URL. */
export function assertSafeTestDatabaseUrl(
  databaseUrl: string | undefined | null
): string {
  const trimmed = typeof databaseUrl === "string" ? databaseUrl.trim() : "";
  if (!trimmed) {
    throw new Error(
      "SA360_TEST_DATABASE_URL is required for Prisma-backed tests. " +
        "Root/general DATABASE_URL is never used. " +
        "Example: postgresql://sa360@127.0.0.1:5432/sa360_test"
    );
  }
  parseSafeTestDatabaseUrlIdentity(trimmed);
  return trimmed;
}

/**
 * Install test DB authorization for the test runtime.
 * - Never loads root .env
 * - Clears ambient/general DATABASE_URL
 * - Only SA360_TEST_DATABASE_URL (validated) may authorize DATABASE_URL
 */
export function installTestDatabaseUrlLock(): {
  authorized: boolean;
  sanitized?: string;
} {
  const explicit = process.env.SA360_TEST_DATABASE_URL?.trim() || "";

  // Discard ambient/general DATABASE_URL (including values from a developer shell
  // or root .env). Mutation tests must not inherit production targets.
  delete process.env.DATABASE_URL;

  if (!explicit) {
    return { authorized: false };
  }

  const safe = assertSafeTestDatabaseUrl(explicit);
  process.env.DATABASE_URL = safe;
  return {
    authorized: true,
    sanitized: parseSafeTestDatabaseUrlIdentity(safe).sanitized,
  };
}

/**
 * Fail closed for suites that mutate via Prisma.
 * Prefer this over reading process.env.DATABASE_URL directly.
 */
export function requireSafeTestDatabaseUrl(): string {
  const current =
    process.env.SA360_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  return assertSafeTestDatabaseUrl(current);
}

/**
 * Validate a candidate DATABASE_URL for test Prisma clients.
 * Returns undefined when unset (non-DB unit tests may still import prisma).
 * Throws when set but unsafe — never silently accept production URLs.
 */
export function resolveTestPrismaDatabaseUrl(
  databaseUrl: string | undefined | null
): string | undefined {
  const trimmed = typeof databaseUrl === "string" ? databaseUrl.trim() : "";
  if (!trimmed) return undefined;
  return assertSafeTestDatabaseUrl(trimmed);
}
