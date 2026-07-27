/**
 * Guards local-only demo/rehearsal scripts from targeting remote databases.
 * Accepts only localhost / 127.0.0.1. Never logs credentials.
 */

export function assertLocalDemoDatabaseUrl(databaseUrl: string | undefined | null): string {
  const trimmed = typeof databaseUrl === "string" ? databaseUrl.trim() : "";
  if (!trimmed) {
    throw new Error("DATABASE_URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `Refusing to run: DATABASE_URL host must be localhost/127.0.0.1 (got ${host}). ` +
        "Do not point local demo scripts at remote/production databases."
    );
  }

  return trimmed;
}
