/**
 * LOCAL DEMO ONLY — Fulfillment Ops Workbench rehearsal seed.
 *
 * Creates a synthetic ClientAccount and attaches fail-closed-compatible
 * proof + UNIQUE verification for aged-import lead UIDs so inventory review
 * and LF2 eligibility can proceed without live GHL duplicate search.
 *
 * Safety:
 * - Refuses to run unless DATABASE_URL targets localhost / 127.0.0.1
 * - Does not enable LF2 live execution
 * - Does not weaken eligibility rules
 * - Synthetic PII only (FOWB-* / @example.test / +1555…)
 *
 * Usage (from repo root, after aged CSV import commit):
 *   $env:DATABASE_URL="postgresql://sa360:<local-password>@localhost:5432/sa360"
 *   pnpm --filter @sa360/api exec tsx src/scripts/fulfillment-ops-workbench-local-seed.ts
 */
import { PrismaClient } from "@prisma/client";

import { assertLocalDemoDatabaseUrl } from "../lib/local-demo-database-url.js";
import {
  upsertLeadProof,
  upsertLeadVerificationResult,
} from "../repositories/lead-proof.repository.js";
import { buildAgedInventoryLeadUid } from "../services/aged-inventory-import/aged-inventory-import-classify.service.js";

const LOCAL_CLIENT_ACCOUNT_ID = "client_fowb_demo_local";
const SOURCE_LEAD_IDS = ["FOWB-001", "FOWB-002"] as const;

async function main() {
  const databaseUrl = assertLocalDemoDatabaseUrl(process.env.DATABASE_URL);

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await prisma.clientAccount.upsert({
      where: { clientAccountId: LOCAL_CLIENT_ACCOUNT_ID },
      create: {
        clientAccountId: LOCAL_CLIENT_ACCOUNT_ID,
        clientDisplayName: "FOWB Demo Client (Synthetic)",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["vet"],
        primaryProductTypes: [],
        notes: "Local fulfillment-ops workbench rehearsal only. Synthetic data.",
      },
      update: {
        clientDisplayName: "FOWB Demo Client (Synthetic)",
        status: "active",
        notes: "Local fulfillment-ops workbench rehearsal only. Synthetic data.",
      },
    });

    const seeded: Array<{
      sourceLeadId: string;
      leadUidMasked: string;
      verificationStatus: string;
      duplicateStatus: string | null;
      proofStatus: string;
      inventoryItemId: string | null;
      inventoryStatus: string | null;
    }> = [];

    for (const sourceLeadId of SOURCE_LEAD_IDS) {
      const leadUid = buildAgedInventoryLeadUid(sourceLeadId);
      const event = await prisma.sourceLeadEvent.findFirst({
        where: { sourceLeadUid: leadUid },
        select: {
          id: true,
          sourceLeadUid: true,
          leadInventoryItem: {
            select: { id: true, status: true, nicheKey: true, normalizedState: true },
          },
        },
      });

      if (!event) {
        throw new Error(
          `SourceLeadEvent missing for ${sourceLeadId}. Commit the aged inventory import first.`
        );
      }

      const verification = await upsertLeadVerificationResult(
        {
          leadUid,
          verificationStatus: "PASSED",
          duplicateStatus: "UNIQUE",
          phoneStatus: "VALID",
          emailStatus: "VALID",
          suppressionStatus: "CLEAR",
          checkedAt: new Date(),
          reasons: ["local_demo_seed_unique"],
        },
        prisma
      );

      const proof = await upsertLeadProof(
        {
          leadUid,
          sourceLeadId,
          sourceLane: "aged_inventory_csv",
          sourcePlatform: "manual_import",
          sourceType: "csv_import",
          proofStatus: "PROOF_ATTACHED",
          proofMissingReasons: [],
          consentCapturedAt: new Date(),
          formName: "FOWB local synthetic form",
        },
        prisma
      );

      const item = event.leadInventoryItem ?? null;
      seeded.push({
        sourceLeadId,
        leadUidMasked: `${leadUid.slice(0, 28)}…`,
        verificationStatus: verification.verificationStatus,
        duplicateStatus: verification.duplicateStatus,
        proofStatus: proof.proofStatus,
        inventoryItemId: item?.id ?? null,
        inventoryStatus: item?.status ?? null,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          environment: "local_only",
          clientAccountId: LOCAL_CLIENT_ACCOUNT_ID,
          whyEligible:
            "Synthetic candidates have identity on SourceLeadEvent, LeadVerificationResult PASSED+UNIQUE, and LeadProof PROOF_ATTACHED. aged_inventory_csv proof policy has empty requiredArtifacts. After make_available, LF2 eligibility should pass.",
          seeded,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
