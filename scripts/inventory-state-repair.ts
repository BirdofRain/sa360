/**
 * Guarded historical Lead Inventory state repair.
 *
 *   pnpm inventory:state-repair -- --mode state-repair-preview --expected-db-host <host> --operator <name>
 *   pnpm inventory:state-repair -- --mode state-repair-commit --expected-db-host <host> --operator <name> --confirmation "REPAIR HISTORICAL INVENTORY STATES"
 *
 * Preview is read-only. Commit is never implied.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

import { INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION } from "@sa360/shared";

import { runInventoryStateRepair } from "../apps/api/src/services/lead-inventory-state-repair/lead-inventory-state-repair.service.ts";
import type { InventoryStateRepairMode } from "../apps/api/src/services/lead-inventory-state-repair/lead-inventory-state-repair.service.ts";

config();

function usage(): never {
  console.error(`Inventory state repair CLI

Required:
  --mode state-repair-preview|state-repair-commit
  --expected-db-host <host or host:port>
  --operator <name>

Commit additionally requires:
  --confirmation "${INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION}"
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
  const mode = (raw.mode || "") as InventoryStateRepairMode;
  if (mode !== "state-repair-preview" && mode !== "state-repair-commit") usage();
  if (!raw["expected-db-host"] || !raw.operator) usage();
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL_required" }));
    process.exit(2);
  }

  const db = new PrismaClient();
  try {
    const result = await runInventoryStateRepair(
      {
        mode,
        expectedDbHost: raw["expected-db-host"],
        operator: raw.operator,
        confirmation: raw.confirmation,
      },
      db
    );
    console.log(JSON.stringify(result, null, 2));
    if (!("ok" in result) || result.ok !== true) process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
