/**
 * Guarded one-item commerce exclusion.
 *
 *   pnpm inventory:commerce-exclude -- \
 *     --inventory-item-id <LeadInventoryItem id> \
 *     --expected-source-event-id <SourceLeadEvent id> \
 *     --expected-db-host <host or host:port> \
 *     --reason <reason> \
 *     --operator <name> \
 *     --confirm "EXCLUDE ONE INVENTORY ITEM FROM COMMERCE"
 *
 * Do not run against production without a separate, explicit authorization.
 * This CLI is exclude-only. There is no unexclude path.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

import {
  buildRefusedTestRuntimePayload,
  isManualOpsTestRuntime,
} from "../apps/api/src/lib/manual-ops-runtime.ts";

config();

if (isManualOpsTestRuntime()) {
  console.error(JSON.stringify(buildRefusedTestRuntimePayload("inventory:commerce-exclude")));
  process.exit(2);
}

const CONFIRMATION = "EXCLUDE ONE INVENTORY ITEM FROM COMMERCE";

const REQUIRED_FLAGS = [
  "inventory-item-id",
  "expected-source-event-id",
  "expected-db-host",
  "reason",
  "operator",
  "confirm",
] as const;

function usage(): never {
  console.error(`Inventory commerce exclude CLI

Required:
  --inventory-item-id <LeadInventoryItem id>
  --expected-source-event-id <SourceLeadEvent id>
  --expected-db-host <host or host:port>
  --reason <reason>
  --operator <name>
  --confirm "${CONFIRMATION}"
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

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  for (const flag of REQUIRED_FLAGS) {
    if (!raw[flag]?.trim()) usage();
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      JSON.stringify({ outcome: "FAILED", ok: false, error: "DATABASE_URL_required" })
    );
    process.exit(2);
  }

  const { excludeInventoryItemFromCommerce } = await import(
    "../apps/api/src/services/lead-inventory/inventory-commerce-exclusion.service.ts"
  );

  const db = new PrismaClient();
  try {
    const result = await excludeInventoryItemFromCommerce(
      {
        inventoryItemId: raw["inventory-item-id"]!,
        expectedSourceEventId: raw["expected-source-event-id"]!,
        expectedDbHost: raw["expected-db-host"]!,
        reason: raw.reason!,
        operator: raw.operator!,
        confirm: raw.confirm!,
        databaseUrl: process.env.DATABASE_URL,
      },
      db
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.outcome !== "EXCLUDED") process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, error: message }));
  process.exit(1);
});
