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
  --inventory-lot-id <id>
  --source-lane <lane>
  --max-scan-rows <n>
  --all-lots                     do not restrict to active inventory lots
  --include-commerce-excluded
`);
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

  const scope = {
    nicheKeys: parseList(raw.niche),
    statuses: parseList(raw.status) as never,
    inventoryLotId: raw["inventory-lot-id"] ?? null,
    sourceLane: raw["source-lane"] ?? null,
    activeLotOnly: raw["all-lots"] !== "true",
    includeCommerceExcluded: raw["include-commerce-excluded"] === "true",
    maxScanRows: raw["max-scan-rows"] ? Number(raw["max-scan-rows"]) : undefined,
  };

  const service = await import(
    "../apps/api/src/services/consumer-age/consumer-age-inventory-maintenance.service.ts"
  );

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
    const guardArgs = {
      expectedDbHost: raw["expected-db-host"]!,
      databaseUrl: process.env.DATABASE_URL,
      operator: raw.operator!,
      confirm: raw.confirm!,
      limit: Number(raw.limit),
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
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, error: message }));
  process.exit(1);
});
