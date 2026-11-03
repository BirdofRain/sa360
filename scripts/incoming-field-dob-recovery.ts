/**
 * Read-only DOB recovery report for the confirmed LeadCapture veteran form.
 *
 *   pnpm source-intake:dob-recovery
 *
 * Prints counts for leads received since Monday, October 26, 2026 00:00
 * America/New_York, plus the known source event when it is stored locally.
 * There is no apply mode. --apply, --confirm, --write, --backfill, and
 * --replay are refused before a database client is constructed. A remote
 * DATABASE_URL is refused the same way.
 */
import { config } from "dotenv";

config();

const WRITE_FLAGS = ["apply", "confirm", "write", "backfill", "replay"] as const;

function refuse(reasonCode: string, field?: string): never {
  console.error(JSON.stringify({ outcome: "REFUSED", ok: false, writes: false, reasonCode, ...(field ? { field } : {}) }));
  process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    if (!key) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function localHost(databaseUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const flag of WRITE_FLAGS) {
    if (args[flag]) refuse("writes_refused", flag);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) refuse("database_url_required");
  if (!localHost(databaseUrl)) refuse("remote_database_refused");

  const recovery = await import(
    "../apps/api/src/services/source-intake/incoming-field-dob-recovery.ts"
  );
  const receivedFrom = args["received-from"]?.trim() || recovery.INCOMING_DOB_RECOVERY_WINDOW_START;
  const from = new Date(receivedFrom);
  if (Number.isNaN(from.getTime())) refuse("invalid_received_from", "received-from");
  const receivedToText = args["received-to"]?.trim() || "";
  const to = receivedToText ? new Date(receivedToText) : null;
  if (to && Number.isNaN(to.getTime())) refuse("invalid_received_to", "received-to");
  if (to && to.getTime() < from.getTime()) refuse("received_to_before_from", "received-to");

  const limitText = args.limit?.trim() || String(recovery.INCOMING_DOB_RECOVERY_DEFAULT_LIMIT);
  if (!/^[1-9]\d*$/.test(limitText)) refuse("invalid_limit", "limit");
  const limit = Number(limitText);
  if (limit > recovery.INCOMING_DOB_RECOVERY_MAX_LIMIT) refuse("limit_exceeds_maximum", "limit");

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const loaded = await recovery.readIncomingDobRecoverySnapshots(db, {
      receivedFrom: from,
      receivedTo: to,
      knownEventId: recovery.KNOWN_DOB_RECOVERY_EVENT_ID,
      limit,
    });
    const report = recovery.buildIncomingDobRecoveryReport({
      rows: loaded.rows,
      receivedFrom: from.toISOString(),
      receivedTo: to ? to.toISOString() : null,
      truncated: loaded.truncated,
    });
    console.log(JSON.stringify(report));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.name : "unknown_error";
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, writes: false, error: message }));
  process.exit(1);
});
