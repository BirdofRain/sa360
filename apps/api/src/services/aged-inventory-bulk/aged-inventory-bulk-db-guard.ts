export type DbTargetIdentity = {
  host: string;
  port: string;
  database: string;
  user: string;
  sanitized: string;
};

/** Parse DATABASE_URL without printing credentials. */
export function parseDatabaseTarget(databaseUrl: string): DbTargetIdentity {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("invalid_database_url");
  }
  const host = parsed.hostname || "unknown";
  const port = parsed.port || (parsed.protocol === "postgresql:" ? "5432" : "");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "") || "unknown");
  const user = decodeURIComponent(parsed.username || "unknown");
  return {
    host,
    port,
    database,
    user,
    sanitized: `postgres://${user}@${host}:${port}/${database}`,
  };
}

export function assertExpectedDbHost(input: {
  databaseUrl: string;
  expectedDbHost: string;
}): DbTargetIdentity {
  const identity = parseDatabaseTarget(input.databaseUrl);
  const expected = input.expectedDbHost.trim().toLowerCase();
  if (!expected) throw new Error("expected_db_host_required");

  const hostPort = identity.port ? `${identity.host}:${identity.port}` : identity.host;
  const candidates = [identity.host.toLowerCase(), hostPort.toLowerCase()];
  if (!candidates.includes(expected)) {
    throw new Error(`db_host_mismatch:expected=${expected};actual=${hostPort}`);
  }
  return identity;
}

export function isLocalhostTarget(identity: DbTargetIdentity): boolean {
  return identity.host === "127.0.0.1" || identity.host === "localhost" || identity.host === "::1";
}
