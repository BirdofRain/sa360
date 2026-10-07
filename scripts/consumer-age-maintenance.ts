/**
 * Bounded consumer-age maintenance for life-insurance inventory.
 *
 * Preview (read-only, safe anywhere including production):
 *
 *   pnpm consumer-age:maintenance -- --mode preview
 *
 * Backfill recovered ages onto the canonical normalized destination:
 *
 *   pnpm consumer-age:maintenance -- \
 *     --mode backfill \
 *     --expected-db-host <host or host:port> \
 *     --operator <name> \
 *     --limit 500 \
 *     --confirm "BACKFILL HISTORICAL CONSUMER AGE"
 *
 * Classify unallocated inventory over the maximum sellable age as dead:
 *
 *   pnpm consumer-age:maintenance -- \
 *     --mode classify-dead \
 *     --expected-db-host <host or host:port> \
 *     --operator <name> \
 *     --limit 500 \
 *     --confirm "CLASSIFY CONSUMER AGE OVER 86 AS DEAD"
 *
 * Optional scope flags (all modes): --niche <key> (repeatable via comma),
 * --status <LeadInventoryItemStatus> (comma separated), --inventory-lot-id <id>,
 * --source-lane <lane>, --max-scan-rows <n>, --include-commerce-excluded,
 * --all-lots.
 *
 * Resuming past the per-invocation scan ceiling: every result carries
 * `coverage` and `nextCursor`. While `coverage` is `partial`, re-run the same
 * command with `--after-generated-at` / `--after-id` taken from `nextCursor`.
 * Stop only when `coverage == "complete"` and `nextCursor == null`.
 *
 * Sharding a large inventory: `--generated-at-from` / `--generated-at-to`
 * restrict the scope to one inclusive `generatedAt` window (for example a
 * single month) without raising the row cap.
 *
 * Always run `--mode preview` first and review the blast radius. Writing modes
 * require an explicit authorization for the target database.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

import {
  buildRefusedTestRuntimePayload,
  isManualOpsTestRuntime,
} from "../apps/api/src/lib/manual-ops-runtime.ts";

config();

if (isManualOpsTestRuntime()) {
  console.error(JSON.stringify(buildRefusedTestRuntimePayload("consumer-age:maintenance")));
  process.exit(2);
}

const BACKFILL_CONFIRMATION = "BACKFILL HISTORICAL CONSUMER AGE";
const DEAD_CONFIRMATION = "CLASSIFY CONSUMER AGE OVER 86 AS DEAD";

const MODES = ["preview", "backfill", "classify-dead"] as const;
type Mode = (typeof MODES)[number];

function usage(): never {
  console.error(`Consumer age maintenance CLI

  --mode preview | backfill | classify-dead

Writing modes also require:
  --expected-db-host <host or host:port>
  --operator <name>
  --limit <positive integer>
  --confirm "${BACKFILL_CONFIRMATION}"            (backfill)
  --confirm "${DEAD_CONFIRMATION}"   (classify-dead)

Optional scope:
  --niche <key[,key]>            default: every canonical life-insurance niche
  --status <status[,status]>     default: available,pending_review
  --inventory-lot-id <id>        the inventoryLotId emitted in breakdown.byInventoryLot
  --source-lane <lane>
  --max-scan-rows <n>            positive integer, at most the per-invocation cap
  --after-generated-at <iso>     resume point from a previous nextCursor
  --after-id <id>                resume point from a previous nextCursor
  --generated-at-from <iso>      inclusive shard lower bound
  --generated-at-to <iso>        inclusive shard upper bound
  --all-lots                     do not restrict to active inventory lots
  --include-commerce-excluded
`);
  process.exit(2);
}

function operatorError(field: string, reason: string): never {
  console.error(
    JSON.stringify({
      outcome: "REFUSED",
      ok: false,
      reasonCode: "invalid_operator_input",
      field,
      reason,
    })
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  const items = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  const mode = raw.mode?.trim() as Mode | undefined;
  if (!mode || !MODES.includes(mode)) usage();

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      JSON.stringify({ outcome: "FAILED", ok: false, error: "DATABASE_URL_required" })
    );
    process.exit(2);
  }

  const service = await import(
    "../apps/api/src/services/consumer-age/consumer-age-inventory-maintenance.service.ts"
  );
  const {
    CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS,
    parseMaintenanceInstant,
    parseMaintenanceRowBound,
  } = service;

  // Numeric and instant flags fail closed. A non-numeric --max-scan-rows must
  // never become NaN and produce a zero-row report that reads as "nothing to do".
  function readRowBound(flag: string): number | undefined {
    try {
      return parseMaintenanceRowBound(flag, raw[flag], CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS);
    } catch (err) {
      operatorError(flag, err instanceof Error ? err.message.split(":").pop()! : "invalid");
    }
  }

  function readInstant(flag: string): string | undefined {
    try {
      return parseMaintenanceInstant(flag, raw[flag])?.toISOString();
    } catch (err) {
      operatorError(flag, err instanceof Error ? err.message.split(":").pop()! : "invalid");
    }
  }

  const maxScanRows = readRowBound("max-scan-rows");
  const afterGeneratedAt = readInstant("after-generated-at");
  const generatedAtFrom = readInstant("generated-at-from");
  const generatedAtTo = readInstant("generated-at-to");
  const afterId = raw["after-id"]?.trim() || undefined;
  if (Boolean(afterGeneratedAt) !== Boolean(afterId)) {
    operatorError("after-generated-at", "requires_both_after_generated_at_and_after_id");
  }

  const scope = {
    nicheKeys: parseList(raw.niche),
    statuses: parseList(raw.status) as never,
    inventoryLotId: raw["inventory-lot-id"] ?? null,
    sourceLane: raw["source-lane"] ?? null,
    activeLotOnly: raw["all-lots"] !== "true",
    includeCommerceExcluded: raw["include-commerce-excluded"] === "true",
    maxScanRows,
    cursor:
      afterGeneratedAt && afterId ? { afterGeneratedAt, afterId } : null,
    generatedAtFrom: generatedAtFrom ?? null,
    generatedAtTo: generatedAtTo ?? null,
  };

  const db = new PrismaClient();
  try {
    if (mode === "preview") {
      const report = await service.previewConsumerAgeInventory(scope, db);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    for (const flag of ["expected-db-host", "operator", "limit", "confirm"] as const) {
      if (!raw[flag]?.trim()) usage();
    }
    const limit = readRowBound("limit");
    const guardArgs = {
      expectedDbHost: raw["expected-db-host"]!,
      databaseUrl: process.env.DATABASE_URL,
      operator: raw.operator!,
      confirm: raw.confirm!,
      limit,
      scope,
    };

    const result =
      mode === "backfill"
        ? await service.commitConsumerAgeBackfill(guardArgs, db)
        : await service.commitConsumerAgeOverMaximumClassification(guardArgs, db);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // Scope validation (for example an inverted --generated-at window) is raised
  // inside the service. Report it through the same operator-input channel as
  // the flags parsed here, so every bad-input refusal looks identical.
  if (err instanceof Error && err.name === "ConsumerAgeMaintenanceInputError") {
    const [field, ...rest] = message.split(":");
    operatorError(field ?? "scope", rest.join(":") || "invalid");
  }
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, error: message }));
  process.exit(1);
});
