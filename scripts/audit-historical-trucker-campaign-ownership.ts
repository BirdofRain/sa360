/**
 * Read-only historical trucker campaign ownership audit.
 *
 * Does not import, activate, allocate, or update inventory.
 * Refuses to run unless the operator passes the read-only confirmation phrase
 * and the DATABASE_URL host matches --expected-db-host.
 *
 * Exit 0: audit completed against a lot that has inventory rows.
 * Exit 2: audit completed and the lot has no manual_import/csv_import rows.
 *         An empty local database is not evidence that production is empty.
 * Exit 1: the audit did not run.
 *
 *   pnpm inventory:audit-trucker-campaigns -- \
 *     --expected-db-host 127.0.0.1:5432 \
 *     --confirm-read-only "READ ONLY HISTORICAL CAMPAIGN AUDIT"
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import { assertExpectedDbHost } from "../apps/api/src/services/aged-inventory-bulk/aged-inventory-bulk-db-guard.ts";
import {
  HISTORICAL_CAMPAIGN_AUDIT_CONFIRMATION,
  HISTORICAL_TRUCKER_IMPORT_REQUEST_ID,
  HISTORICAL_TRUCKER_LOT_KEY,
  JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
  runHistoricalTruckerCampaignAudit,
} from "../apps/api/src/services/aged-inventory-bulk/historical-trucker-campaign-audit.ts";

dotenv.config();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const expectedDbHost = arg("--expected-db-host")?.trim() ?? "";
  const confirmation = arg("--confirm-read-only") ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL_required" }));
    process.exit(1);
  }
  if (!expectedDbHost) {
    console.error(JSON.stringify({ ok: false, error: "expected_db_host_required" }));
    process.exit(1);
  }
  if (confirmation !== HISTORICAL_CAMPAIGN_AUDIT_CONFIRMATION) {
    console.error(JSON.stringify({ ok: false, error: "invalid_read_only_confirmation" }));
    process.exit(1);
  }
  const identity = assertExpectedDbHost({ databaseUrl, expectedDbHost });
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const report = await runHistoricalTruckerCampaignAudit(db, {
      databaseUrl,
      lotKey: arg("--lot-key") ?? HISTORICAL_TRUCKER_LOT_KEY,
      importRequestId: arg("--import-request-id") ?? HISTORICAL_TRUCKER_IMPORT_REQUEST_ID,
      exampleCampaignLabel: arg("--example-campaign") ?? JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
    });
    const body = JSON.stringify({ ok: true, db: identity.sanitized, report }, null, 2);
    process.stdout.write(`${body}\n`);
    const artifact = arg("--artifact");
    if (artifact) writeFileSync(artifact, body);
    if (!report.lot.found) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "audit_failed";
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
