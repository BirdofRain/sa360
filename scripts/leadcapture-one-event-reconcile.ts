/**
 * Guarded one-event LeadCapture source-association reconciliation.
 *
 * For a LeadCapture lead that arrived before its client's confirmed source
 * association could resolve a destination. Reuses the existing
 * SourceLeadEvent — never re-POSTs the public webhook, because the Legacy lane
 * inserts a new event per request and a resend would duplicate the lead.
 *
 * Preview (no writes):
 *
 *   pnpm source-intake:one-event-reconcile -- \
 *     --source-event-id <id> \
 *     --expected-source-system leadcapture_io_legacy \
 *     --expected-route <route key> \
 *     --expected-lead-id <lead id> \
 *     --expected-destination-client-account-id <client> \
 *     --expected-db-host <host or host:port> \
 *     --operator <name> \
 *     --confirm "RECONCILE ONE LEADCAPTURE SOURCE EVENT"
 *
 * Add `--apply` to write. Do not run against production without a separate,
 * explicit authorization.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

import {
  buildRefusedTestRuntimePayload,
  isManualOpsTestRuntime,
} from "../apps/api/src/lib/manual-ops-runtime.ts";

config();

if (isManualOpsTestRuntime()) {
  console.error(
    JSON.stringify(buildRefusedTestRuntimePayload("source-intake:one-event-reconcile"))
  );
  process.exit(2);
}

const LEADCAPTURE_RECONCILE_CONFIRMATION = "RECONCILE ONE LEADCAPTURE SOURCE EVENT";

const REQUIRED_FLAGS = [
  "source-event-id",
  "expected-source-system",
  "expected-route",
  "expected-lead-id",
  "expected-destination-client-account-id",
  "expected-db-host",
  "operator",
  "confirm",
] as const;

function usage(): never {
  console.error(`LeadCapture one-event source-association reconcile CLI

Required:
  --source-event-id <SourceLeadEvent id>
  --expected-source-system <leadcapture_io_legacy | leadcapture_io_nextgen>
  --expected-route <sourceRouteKey>
  --expected-lead-id <sourceLeadId>
  --expected-destination-client-account-id <clientAccountId>
  --expected-db-host <host or host:port>
  --operator <name>
  --confirm "${LEADCAPTURE_RECONCILE_CONFIRMATION}"

Optional:
  --apply   write; omit for a read-only preview
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
    console.error(JSON.stringify({ outcome: "FAILED", ok: false, error: "DATABASE_URL_required" }));
    process.exit(2);
  }

  const { reconcileOneLeadCaptureSourceEventAssociation } = await import(
    "../apps/api/src/services/source-intake/leadcapture-one-event-reconcile.service.ts"
  );

  const db = new PrismaClient();
  try {
    const result = await reconcileOneLeadCaptureSourceEventAssociation(
      {
        sourceEventId: raw["source-event-id"]!,
        expectedSourceSystem: raw["expected-source-system"]!,
        expectedRoute: raw["expected-route"]!,
        expectedLeadId: raw["expected-lead-id"]!,
        expectedDestinationClientAccountId: raw["expected-destination-client-account-id"]!,
        expectedDbHost: raw["expected-db-host"]!,
        operator: raw.operator!,
        confirm: raw.confirm!,
        apply: raw.apply === "true",
        databaseUrl: process.env.DATABASE_URL,
      },
      { prisma: db }
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.outcome !== "RECONCILED" && result.outcome !== "PREVIEWED") process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, error: message }));
  process.exit(1);
});
