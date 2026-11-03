/**
 * Confirmed Julia Dodge historical DOB correction.
 *
 * Dry run (read-only; localhost, or a host named by --expected-db-host):
 *
 *   pnpm source-intake:dob-correction -- --limit 100
 *
 * Apply on the database named by DATABASE_URL. This does not call GHL or Sheets.
 *
 *   pnpm source-intake:dob-correction -- \
 *     --apply \
 *     --expected-db-host 127.0.0.1:5432 \
 *     --operator <name> \
 *     --limit 25 \
 *     --audit-file ./julia-dob.dob-correction-audit.jsonl \
 *     --confirm "APPLY CONFIRMED JULIA DOB CORRECTION"
 *
 * Roll back only the canonical fields recorded in that audit:
 *
 *   pnpm source-intake:dob-correction -- \
 *     --rollback \
 *     --expected-db-host 127.0.0.1:5432 \
 *     --operator <name> \
 *     --limit 25 \
 *     --audit-file ./julia-dob.dob-correction-audit.jsonl \
 *     --confirm "ROLLBACK CONFIRMED JULIA DOB CORRECTION"
 *
 * Do not commit the audit file. Do not pass a production host until a
 * separate review authorizes that write.
 */
import { config } from "dotenv";

import { isLocalhostTarget, parseDatabaseTarget } from "../apps/api/src/services/aged-inventory-bulk/aged-inventory-bulk-db-guard.ts";
import {
  buildRefusedTestRuntimePayload,
  isManualOpsTestRuntime,
} from "../apps/api/src/lib/manual-ops-runtime.ts";

config();

if (isManualOpsTestRuntime()) {
  console.error(JSON.stringify(buildRefusedTestRuntimePayload("source-intake:dob-correction")));
  process.exit(2);
}

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

function repeated(flag: string): string[] {
  const argv = process.argv.slice(2);
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) values.push(next.trim());
  }
  return values.filter(Boolean);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.replay) refuse("writes_refused", "replay");
  if (args.apply && args.rollback) refuse("apply_and_rollback", "rollback");

  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) refuse("database_url_required");
  let identity: ReturnType<typeof parseDatabaseTarget>;
  try {
    identity = parseDatabaseTarget(databaseUrl);
  } catch {
    refuse("invalid_database_url");
  }
  const expectedHost = args["expected-db-host"]?.trim() || "";
  if (!isLocalhostTarget(identity) && !expectedHost) refuse("remote_database_refused");
  if (expectedHost) {
    const hostPort = identity.port ? `${identity.host}:${identity.port}` : identity.host;
    const candidates = [identity.host.toLowerCase(), hostPort.toLowerCase()];
    if (!candidates.includes(expectedHost.toLowerCase())) refuse("db_host_mismatch", "expected-db-host");
  }

  const correction = await import("../apps/api/src/services/source-intake/incoming-field-dob-correction.ts");
  const recovery = await import("../apps/api/src/services/source-intake/incoming-field-dob-recovery.ts");
  const receivedFrom = args["received-from"]?.trim() || recovery.INCOMING_DOB_RECOVERY_WINDOW_START;
  const from = new Date(receivedFrom);
  if (Number.isNaN(from.getTime())) refuse("invalid_received_from", "received-from");
  const receivedToText = args["received-to"]?.trim() || "";
  const to = receivedToText ? new Date(receivedToText) : null;
  if (to && Number.isNaN(to.getTime())) refuse("invalid_received_to", "received-to");
  if (to && to.getTime() < from.getTime()) refuse("received_to_before_from", "received-to");

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    if (args.rollback) {
      const limitText = args.limit?.trim() || "";
      if (!/^[1-9]\d*$/.test(limitText)) refuse("invalid_limit", "limit");
      const result = await correction.rollbackIncomingDobCorrections(db, {
        databaseUrl,
        expectedDbHost: expectedHost,
        operator: args.operator?.trim() || "",
        confirm: args.confirm?.trim() || "",
        limit: Number(limitText),
        auditFile: args["audit-file"]?.trim() || "",
      });
      console.log(JSON.stringify({ ...result, writes: result.writesAttempted && result.outcome === "ROLLED_BACK" }));
      if (!result.ok) process.exit(2);
      return;
    }

    const limitText = args.limit?.trim() || String(recovery.INCOMING_DOB_RECOVERY_DEFAULT_LIMIT);
    if (!/^[1-9]\d*$/.test(limitText)) refuse("invalid_limit", "limit");
    const limit = Number(limitText);
    if (!args.apply && limit > recovery.INCOMING_DOB_RECOVERY_MAX_LIMIT) refuse("limit_exceeds_maximum", "limit");

    const loaded = await recovery.readIncomingDobRecoverySnapshots(db, {
      receivedFrom: from,
      receivedTo: to,
      knownEventId: recovery.KNOWN_DOB_RECOVERY_EVENT_ID,
      limit,
    });
    const window = { receivedFrom: from.toISOString(), receivedTo: to ? to.toISOString() : null };
    const requestedIds = new Set(repeated("--id"));
    const plans = loaded.rows
      .filter((row) => requestedIds.size === 0 || requestedIds.has(row.id))
      .map((row) => correction.planIncomingDobCorrection(row, window));
    const applyPlans = plans.filter((plan) => plan.action === "apply");

    if (!args.apply) {
      console.log(JSON.stringify({
        version: correction.INCOMING_DOB_CORRECTION_VERSION,
        mode: "dry_run",
        writes: false,
        externalDestinations: "unchanged",
        truncated: loaded.truncated,
        window,
        counts: {
          rows: plans.length,
          apply: applyPlans.length,
          skip: plans.length - applyPlans.length,
          alreadyDeliveredApply: applyPlans.filter((plan) => plan.alreadyDelivered).length,
        },
        plans: plans.filter((plan) => plan.action === "apply" || plan.recoveryClass === "conflicting" || plan.eventId === recovery.KNOWN_DOB_RECOVERY_EVENT_ID),
      }));
      return;
    }

    const result = await correction.applyIncomingDobCorrections(db, {
      databaseUrl,
      expectedDbHost: expectedHost,
      operator: args.operator?.trim() || "",
      confirm: args.confirm?.trim() || "",
      limit,
      auditFile: args["audit-file"]?.trim() || "",
      ids: applyPlans.map((plan) => plan.eventId),
      receivedFrom: window.receivedFrom,
      receivedTo: window.receivedTo,
    });
    console.log(JSON.stringify({ ...result, writes: result.outcome === "APPLIED" }));
    if (!result.ok) process.exit(2);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.name : "unknown_error";
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, writes: false, error: message }));
  process.exit(1);
});
