/**
 * Confirmed campaign historical DOB correction.
 *
 * The reviewed forms are the date-of-birth bindings in
 * SCOPED_INCOMING_FIELD_BINDINGS. Apply does not scan the window and add
 * rows. Pass every reviewed SourceLeadEvent id with --id, or a manifest
 * `{ "ids": [...], "expectedCount": N }`, and the same count.
 *
 * Dry run (read-only; localhost, or a host named by --expected-db-host):
 *
 *   pnpm source-intake:dob-correction -- --limit 100
 *
 * Apply on the database named by DATABASE_URL. This does not call GHL or Sheets.
 * Apply and rollback refuse until IncomingDobCorrectionAudit matches the
 * documented schema. A table name alone is not enough. The audit row commits
 * with the payload change. --audit-file is an optional local JSONL
 * supplement and is not the source of rollback.
 *
 *   pnpm source-intake:dob-correction -- \
 *     --apply \
 *     --expected-db-host 127.0.0.1:5432 \
 *     --operator <name> \
 *     --id <source-lead-event-id> \
 *     --expected-count 1 \
 *     --limit 25 \
 *     --audit-file ./campaign-dob.dob-correction-audit.jsonl \
 *     --confirm "APPLY CONFIRMED CAMPAIGN DOB CORRECTION"
 *
 * Roll back open audit rows from IncomingDobCorrectionAudit. A lock skip
 * exits 3 and stays in pendingIds. Rollback does not discover new ids.
 *
 *   pnpm source-intake:dob-correction -- \
 *     --rollback \
 *     --expected-db-host 127.0.0.1:5432 \
 *     --operator <name> \
 *     --limit 25 \
 *     --confirm "ROLLBACK CONFIRMED CAMPAIGN DOB CORRECTION"
 *
 * Do not commit a JSONL supplement. Do not pass a production host until a
 * separate review authorizes that write. This command is not
 * production-executable until Auth/Account ships the audit migration.
 */
import { readFileSync } from "node:fs";
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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function reviewedScope(args: Record<string, string>): { ids: string[]; expectedCount: number } {
  const flagIds = repeated("--id");
  const manifestPath = args.manifest?.trim() || "";
  let manifestIds: string[] | null = null;
  let manifestCount: number | null = null;
  if (manifestPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    } catch {
      refuse("manifest_unreadable", "manifest");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refuse("manifest_unreadable", "manifest");
    const body = parsed as { ids?: unknown; expectedCount?: unknown };
    if (
      !Array.isArray(body.ids) ||
      !body.ids.every((id) => typeof id === "string" && id.trim()) ||
      typeof body.expectedCount !== "number" ||
      !Number.isInteger(body.expectedCount)
    ) {
      refuse("manifest_unreadable", "manifest");
    }
    manifestIds = body.ids.map((id) => id.trim());
    manifestCount = body.expectedCount;
  }
  if (flagIds.length === 0 && manifestIds == null) refuse("reviewed_scope_required");
  if (manifestIds && flagIds.length > 0 && !sameIds(flagIds, manifestIds)) refuse("reviewed_scope_mismatch");
  const ids = manifestIds ?? flagIds;
  const countText = args["expected-count"]?.trim() || "";
  let expectedCount: number;
  if (countText) {
    if (!/^[1-9]\d*$/.test(countText)) refuse("reviewed_count_mismatch", "expected-count");
    expectedCount = Number(countText);
  } else if (manifestCount != null) {
    expectedCount = manifestCount;
  } else {
    refuse("reviewed_count_mismatch", "expected-count");
  }
  if (manifestCount != null && expectedCount !== manifestCount) refuse("reviewed_count_mismatch", "expected-count");
  if (expectedCount !== ids.length || new Set(ids).size !== ids.length) {
    refuse("reviewed_count_mismatch", "expected-count");
  }
  return { ids, expectedCount };
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
  const receivedToText = args["received-to"]?.trim() || recovery.INCOMING_DOB_RECOVERY_WINDOW_END;
  const to = new Date(receivedToText);
  if (Number.isNaN(to.getTime())) refuse("invalid_received_to", "received-to");
  if (to.getTime() < from.getTime()) refuse("received_to_before_from", "received-to");

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
      console.log(JSON.stringify({ ...result, writes: result.writtenIds.length > 0 }));
      const code = correction.incomingDobCorrectionExitCode(result);
      if (code !== 0) process.exit(code);
      return;
    }

    const limitText = args.limit?.trim() || String(recovery.INCOMING_DOB_RECOVERY_DEFAULT_LIMIT);
    if (!/^[1-9]\d*$/.test(limitText)) refuse("invalid_limit", "limit");
    const limit = Number(limitText);
    if (!args.apply && limit > recovery.INCOMING_DOB_RECOVERY_MAX_LIMIT) refuse("limit_exceeds_maximum", "limit");
    const window = { receivedFrom: from.toISOString(), receivedTo: to.toISOString() };

    if (args.apply) {
      if ((args.confirm?.trim() || "") !== correction.INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION) {
        refuse("confirmation_mismatch", "confirm");
      }
      const reviewed = reviewedScope(args);
      if (limit < reviewed.expectedCount) refuse("reviewed_count_mismatch", "limit");
      const loaded = await recovery.readIncomingDobRecoverySnapshots(db, {
        receivedFrom: from,
        receivedTo: to,
        knownEventId: recovery.KNOWN_DOB_RECOVERY_EVENT_ID,
        limit: reviewed.ids.length,
        onlyIds: reviewed.ids,
      });
      const byId = new Map(loaded.rows.map((row) => [row.id, row]));
      const plans = reviewed.ids.map((id) => {
        const row = byId.get(id);
        return row ? correction.planIncomingDobCorrection(row, window) : null;
      });
      if (plans.some((plan) => plan == null || plan.action !== "apply")) refuse("reviewed_scope_mismatch");
      const applyPlans = plans.filter((plan): plan is NonNullable<typeof plan> => plan != null);
      const result = await correction.applyIncomingDobCorrections(db, {
        databaseUrl,
        expectedDbHost: expectedHost,
        operator: args.operator?.trim() || "",
        confirm: args.confirm?.trim() || "",
        limit,
        auditFile: args["audit-file"]?.trim() || "",
        ids: reviewed.ids,
        expectedCount: reviewed.expectedCount,
        receivedFrom: window.receivedFrom,
        receivedTo: window.receivedTo,
        expectedBeforeById: Object.fromEntries(applyPlans.map((plan) => [plan.eventId, plan.before])),
      });
      console.log(JSON.stringify({ ...result, writes: result.writtenIds.length > 0 }));
      const code = correction.incomingDobCorrectionExitCode(result);
      if (code !== 0) process.exit(code);
      return;
    }

    const loaded = await recovery.readIncomingDobRecoverySnapshots(db, {
      receivedFrom: from,
      receivedTo: to,
      knownEventId: recovery.KNOWN_DOB_RECOVERY_EVENT_ID,
      limit,
    });
    const plans = loaded.rows.map((row) => correction.planIncomingDobCorrection(row, window));
    const applyPlans = plans.filter((plan) => plan.action === "apply");
    console.log(JSON.stringify({
      version: correction.INCOMING_DOB_CORRECTION_VERSION,
      mode: "dry_run",
      writes: false,
      externalDestinations: "unchanged",
      truncated: loaded.truncated,
      window,
      confirmedDateOfBirthBindingIds: recovery.listConfirmedDateOfBirthBindingIds(),
      counts: {
        rows: plans.length,
        apply: applyPlans.length,
        skip: plans.length - applyPlans.length,
        alreadyDeliveredApply: applyPlans.filter((plan) => plan.alreadyDelivered).length,
      },
      plans: plans.filter((plan) => plan.action === "apply" || plan.recoveryClass === "conflicting" || plan.eventId === recovery.KNOWN_DOB_RECOVERY_EVENT_ID),
    }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.name : "unknown_error";
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, writes: false, error: message }));
  process.exit(1);
});
