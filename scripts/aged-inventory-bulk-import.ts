/**
 * Full-scale aged inventory bulk import CLI (service-direct; no HTTP body limits).
 *
 * Usage:
 *   pnpm inventory:bulk-aged -- --mode preview --file ... --source-format trucker_master_v1 ...
 *   pnpm inventory:bulk-aged -- --mode commit ...
 *   pnpm inventory:bulk-aged -- --mode resume ...
 *   pnpm inventory:bulk-aged -- --mode reconcile ...
 *
 * Verify/activate modes are added in the operational-verification stacked PR.
 *
 * Never place master/normalized/reject files under the git repo work tree.
 */
import { PrismaClient } from "@prisma/client";

import {
  AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE,
  AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION,
} from "@sa360/shared";

import {
  reconcileAgedInventoryBulkSnapshot,
  runAgedInventoryBulkImport,
} from "../apps/api/src/services/aged-inventory-bulk/aged-inventory-bulk-commit.service.ts";
import type {
  AgedBulkCliArgs,
  AgedBulkMode,
  AgedBulkSourceFormat,
} from "../apps/api/src/services/aged-inventory-bulk/aged-inventory-bulk.types.ts";

function usage(): never {
  console.error(`Aged inventory bulk CLI

Required:
  --mode preview|commit|resume|reconcile
  --expected-db-host <host or host:port>
  --operator <name>

Import modes also require:
  --file <path>
  --source-format vet_master_v1|trucker_master_v1
  --default-niche vet|trucker
  --work-dir <secure path outside git>
  --expected-file-sha256 <hex>
  --batch-size <n>   (default ${AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE})

Commit/resume require:
  --confirmation "${AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION}"
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
  const mode = (raw.mode || "") as AgedBulkMode;
  if (!mode) usage();
  if (mode === "verify" || mode === "activate") {
    console.error(
      JSON.stringify({
        ok: false,
        error: "ops_verify_modes_require_stacked_pr",
        hint: "Use feature/aged-inventory-operational-verification-v1",
      })
    );
    process.exit(2);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL_required" }));
    process.exit(2);
  }

  const db = new PrismaClient();
  try {
    if (mode === "reconcile") {
      const expectedFileSha256 = raw["expected-file-sha256"];
      const expectedDbHost = raw["expected-db-host"];
      const workDir = raw["work-dir"];
      if (!expectedFileSha256 || !expectedDbHost || !workDir) usage();
      const result = await reconcileAgedInventoryBulkSnapshot(
        { expectedFileSha256, expectedDbHost, workDir },
        db
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
      return;
    }

    const args: AgedBulkCliArgs = {
      mode,
      file: raw.file || "",
      sourceFormat: (raw["source-format"] || "") as AgedBulkSourceFormat,
      defaultNiche: raw["default-niche"] || "",
      batchSize: raw["batch-size"]
        ? Number(raw["batch-size"])
        : AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE,
      workDir: raw["work-dir"] || "",
      expectedFileSha256: raw["expected-file-sha256"] || "",
      expectedDbHost: raw["expected-db-host"] || "",
      operator: raw.operator || "",
      confirmation: raw.confirmation,
      lotKey: raw["lot-key"],
      requestId: raw["request-id"],
      operatorNote: raw["operator-note"],
    };

    if (
      !args.file ||
      !args.sourceFormat ||
      !args.defaultNiche ||
      !args.workDir ||
      !args.expectedFileSha256 ||
      !args.expectedDbHost ||
      !args.operator
    ) {
      usage();
    }

    const result = await runAgedInventoryBulkImport(args, db);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
