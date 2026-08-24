/**
 * Guarded one-event LeadCapture NextGen promotion.
 *
 * Operational tooling only. Does not change
 * SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE and does not POST the public webhook.
 *
 *   pnpm source-intake:nextgen-one-event-promote -- \
 *     --source-event-id <id> \
 *     --stage normalize_route_proof \
 *     --expected-source-system leadcapture_io_nextgen \
 *     --expected-route <route> \
 *     --expected-lead-id <lead-id> \
 *     --expected-db-host <host or host:port> \
 *     --operator <name> \
 *     --confirm "PROMOTE ONE NEXTGEN SOURCE EVENT"
 *
 * Do not run against production without a separate, explicit authorization.
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
    JSON.stringify(buildRefusedTestRuntimePayload("source-intake:nextgen-one-event-promote"))
  );
  process.exit(2);
}

const NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION = "PROMOTE ONE NEXTGEN SOURCE EVENT";
const NEXTGEN_ONE_EVENT_PROMOTE_STAGE = "normalize_route_proof";

const REQUIRED_FLAGS = [
  "source-event-id",
  "stage",
  "expected-source-system",
  "expected-route",
  "expected-lead-id",
  "expected-db-host",
  "operator",
  "confirm",
] as const;

function usage(): never {
  console.error(`LeadCapture NextGen one-event promote CLI

Required:
  --source-event-id <SourceLeadEvent id>
  --stage ${NEXTGEN_ONE_EVENT_PROMOTE_STAGE}
  --expected-source-system leadcapture_io_nextgen
  --expected-route <sourceRouteKey>
  --expected-lead-id <sourceLeadId>
  --expected-db-host <host or host:port>
  --operator <name>
  --confirm "${NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION}"
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

  const { promoteOneLeadCaptureNextGenSourceEvent } = await import(
    "../apps/api/src/services/source-intake/leadcapture-nextgen-one-event-promote.service.ts"
  );

  const db = new PrismaClient();
  try {
    const result = await promoteOneLeadCaptureNextGenSourceEvent(
      {
        sourceEventId: raw["source-event-id"]!,
        stage: raw.stage!,
        expectedSourceSystem: raw["expected-source-system"]!,
        expectedRoute: raw["expected-route"]!,
        expectedLeadId: raw["expected-lead-id"]!,
        expectedDbHost: raw["expected-db-host"]!,
        operator: raw.operator!,
        confirm: raw.confirm!,
        databaseUrl: process.env.DATABASE_URL,
      },
      { prisma: db }
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.outcome !== "PROMOTED") process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, error: message }));
  process.exit(1);
});
