/**
 * Localhost-only PPL aged inventory beta rehearsal.
 * Usage:
 *   $env:DATABASE_URL="postgresql://sa360:sa360password@127.0.0.1:5432/sa360_ppl_beta_rehearsal"
 *   $env:SA360_PPL_SELECTION_ENABLED="true"
 *   $env:SA360_PPL_LOCAL_MIN_QTY="1"
 *   $env:SA360_PPL_CSV_EXPORT_ENABLED="true"
 *   $env:SA360_PPL_REPLACEMENT_ENABLED="true"
 *   pnpm exec tsx scripts/ppl-aged-beta-rehearsal.ts
 */
import { PrismaClient } from "@prisma/client";

import {
  assertLocalhostDatabaseUrl,
  seedPplAgedBetaFixtures,
} from "../apps/api/src/services/ppl-fulfillment/ppl-beta-fixtures.ts";
import {
  analyzePplInventoryExclusions,
  commitPplInventorySelection,
  previewPplInventorySelection,
} from "../apps/api/src/services/ppl-fulfillment/inventory-selection.service.ts";
import {
  commitBuyerCsvExport,
  getBuyerCsvExportDownload,
  markSpreadsheetDelivered,
  previewBuyerCsvExport,
  BUYER_CSV_COLUMNS,
} from "../apps/api/src/services/ppl-fulfillment/buyer-csv-export.service.ts";
import { fingerprintIdentityValue } from "../apps/api/src/lib/identity-fingerprint.ts";
import { readNormalizedLeadIdentity } from "../apps/api/src/lib/normalized-lead-identity.ts";
import {
  decideLeadReplacement,
  previewLeadReplacement,
  requestLeadReplacement,
} from "../apps/api/src/services/ppl-fulfillment/replacement.service.ts";

async function main() {
  const url = assertLocalhostDatabaseUrl(process.env.DATABASE_URL);
  for (const flag of [
    "SA360_PPL_SELECTION_ENABLED",
    "SA360_PPL_CSV_EXPORT_ENABLED",
    "SA360_PPL_REPLACEMENT_ENABLED",
  ]) {
    if (process.env[flag] !== "true") {
      throw new Error(`${flag} must be true for rehearsal`);
    }
  }
  if (process.env.SA360_LF2_EXECUTION_ENABLED === "true") {
    throw new Error("SA360_LF2_EXECUTION_ENABLED must remain false");
  }
  if (process.env.SA360_LF2_GHL_CANARY_ENABLED === "true") {
    throw new Error("SA360_LF2_GHL_CANARY_ENABLED must remain false");
  }

  const db = new PrismaClient({ datasources: { db: { url } } });
  const report: Record<string, unknown> = {
    databaseUrlHost: new URL(url).hostname,
    databaseName: new URL(url).pathname.replace(/^\//, ""),
    externalWriteOccurred: false,
  };

  try {
    const fixtures = await seedPplAgedBetaFixtures(db);
    report.buyerClientId = fixtures.buyerClientId;
    report.orderId = fixtures.orderId;
    report.orderNumber = fixtures.orderNumber;
    report.cleanInventoryCount = fixtures.cleanItems.length;

    const preview = await previewPplInventorySelection(
      {
        orderId: fixtures.orderId,
        requestedQuantity: 3,
        commerceAgeBucketKeys: [
          "COMMERCE_1_3_MO",
          "COMMERCE_3_6_MO",
          "COMMERCE_6_9_MO",
          "COMMERCE_12_MO_PLUS",
        ],
      },
      db
    );
    report.selectionPreview = preview;
    if (!preview.ok) throw new Error(`selection_preview_failed:${preview.code}`);

    const exclusionCounts = await analyzePplInventoryExclusions(
      {
        nicheKey: "vet",
        states: ["NC", "TX", "NJ", "CA"],
        commerceAgeBucketKeys: [
          "COMMERCE_1_3_MO",
          "COMMERCE_3_6_MO",
          "COMMERCE_6_9_MO",
          "COMMERCE_12_MO_PLUS",
        ],
        clientAccountId: fixtures.buyerClientId,
      },
      db
    );
    report.exclusionCounts = exclusionCounts;
    if (
      exclusionCounts.sameBuyerPriorDelivery < 1 ||
      exclusionCounts.currentBatchDuplicate < 1 ||
      exclusionCounts.protectedAgent < 1 ||
      exclusionCounts.invalidIdentity < 1
    ) {
      throw new Error(`exclusion_counts_incomplete:${JSON.stringify(exclusionCounts)}`);
    }

    const commit = await commitPplInventorySelection(
      {
        orderId: fixtures.orderId,
        requestedQuantity: 3,
        commerceAgeBucketKeys: [
          "COMMERCE_1_3_MO",
          "COMMERCE_3_6_MO",
          "COMMERCE_6_9_MO",
          "COMMERCE_12_MO_PLUS",
        ],
        idempotencyKey: `rehearsal-select-${fixtures.orderId}`,
      },
      db
    );
    report.selectionCommit = commit;
    if (!commit.ok) throw new Error(`selection_commit_failed:${commit.code}`);

    const reservedCount = await db.leadAllocation.count({
      where: { leadOrderId: fixtures.orderId, status: "reserved" },
    });
    report.reservedQuantity = reservedCount;

    const exportPreview = await previewBuyerCsvExport({ orderId: fixtures.orderId }, db);
    report.exportPreview = exportPreview;
    if (!exportPreview.ok) throw new Error(`export_preview_failed:${exportPreview.code}`);

    const exportCommit = await commitBuyerCsvExport(
      {
        orderId: fixtures.orderId,
        idempotencyKey: `rehearsal-export-${fixtures.orderId}`,
        createdBy: "rehearsal-script",
      },
      db
    );
    report.exportCommit = exportCommit;
    if (!exportCommit.ok) throw new Error(`export_commit_failed:${exportCommit.code}`);

    const historyAfterExport = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: exportCommit.allocationIds } },
    });
    report.buyerHistoryAfterExportCommit = historyAfterExport;
    if (historyAfterExport !== 0) {
      throw new Error("buyer_history_written_too_early");
    }

    const download = await getBuyerCsvExportDownload(exportCommit.exportId, db);
    if (!download.ok) throw new Error(`download_failed:${download.code}`);
    const header = download.csv.split("\n")[0]?.trim();
    report.exportHeaders = header;
    report.exportChecksum = download.contentSha256;
    report.spreadsheetDeliveredAfterDownload = download.spreadsheetDelivered;
    if (header !== BUYER_CSV_COLUMNS.join(",")) {
      throw new Error(`unexpected_headers:${header}`);
    }
    if (/T\d{2}:\d{2}|source_agent|supplier|leadUid|allocation|proof|cost|margin/i.test(download.csv)) {
      throw new Error("forbidden_fields_or_timestamp_present");
    }

    const delivered = await markSpreadsheetDelivered(
      {
        exportId: exportCommit.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `rehearsal-delivered-${exportCommit.exportId}`,
        deliveredBy: "rehearsal-operator",
      },
      db
    );
    report.deliveryEvidence = delivered;
    if (!delivered.ok) throw new Error(`delivery_failed:${delivered.code}`);
    if (delivered.externalWriteOccurred) throw new Error("external_write_detected");

    const historyAfterDelivery = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: delivered.allocationIds } },
    });
    report.buyerHistoryAfterDelivery = historyAfterDelivery;

    const replayDelivery = await markSpreadsheetDelivered(
      {
        exportId: exportCommit.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `rehearsal-delivered-${exportCommit.exportId}`,
        deliveredBy: "rehearsal-operator",
      },
      db
    );
    report.deliveryReplay = replayDelivery;

    const originalAllocationId = delivered.allocationIds[0]!;
    // Independent prior same-buyer delivery proof (buyer free-text is never proof).
    const originalAlloc = await db.leadAllocation.findUniqueOrThrow({
      where: { id: originalAllocationId },
      select: {
        clientAccountId: true,
        sourceLeadEvent: { select: { normalizedPayloadJson: true } },
      },
    });
    const originalIdentity = readNormalizedLeadIdentity(
      originalAlloc.sourceLeadEvent.normalizedPayloadJson
    );
    if (!originalIdentity?.phoneE164 && !originalIdentity?.email) {
      throw new Error("original_allocation_missing_identity");
    }
    await db.buyerDeliveredIdentity.create({
      data: {
        clientAccountId: originalAlloc.clientAccountId,
        phoneFingerprint: originalIdentity.phoneE164
          ? fingerprintIdentityValue("phone", originalIdentity.phoneE164)
          : null,
        emailFingerprint: originalIdentity.email
          ? fingerprintIdentityValue("email", originalIdentity.email)
          : null,
        sourceLeadEventId: `rehearsal-prior-event-${originalAllocationId}`,
        leadAllocationId: `rehearsal-prior-alloc-${originalAllocationId}`,
        leadInventoryItemId: null,
      },
    });

    const replacementReq = await requestLeadReplacement(
      {
        originalAllocationId,
        reason: "Buyer reported duplicate contact",
        requestId: `rehearsal-repl-${originalAllocationId}`,
        reasonCode: "duplicate",
      },
      db
    );
    report.replacementRequest = replacementReq;
    if (!replacementReq.ok) throw new Error(`replacement_request_failed:${replacementReq.code}`);

    const replacementPreview = await previewLeadReplacement(replacementReq.item.id, db);
    report.replacementPreview = replacementPreview;
    if (!replacementPreview.ok) {
      throw new Error(`replacement_preview_failed:${replacementPreview.code}`);
    }

    const replacementDecision = await decideLeadReplacement(
      {
        replacementId: replacementReq.item.id,
        action: "approve",
        confirmationPhrase: "APPROVE REPLACEMENT",
        requestId: `rehearsal-repl-dec-${replacementReq.item.id}`,
        decidedBy: "rehearsal-operator",
      },
      db
    );
    report.replacementDecision = replacementDecision;
    if (!replacementDecision.ok) {
      throw new Error(`replacement_decision_failed:${replacementDecision.code}`);
    }

    const replacementReplay = await decideLeadReplacement(
      {
        replacementId: replacementReq.item.id,
        action: "approve",
        confirmationPhrase: "APPROVE REPLACEMENT",
        requestId: `rehearsal-repl-dec-${replacementReq.item.id}`,
        decidedBy: "rehearsal-operator",
      },
      db
    );
    report.replacementApprovalReplay = replacementReplay;
    if (!replacementReplay.ok || !replacementReplay.idempotentReplay) {
      throw new Error(`replacement_replay_failed:${JSON.stringify(replacementReplay)}`);
    }
    const secondRequest = await requestLeadReplacement(
      {
        originalAllocationId,
        reason: "second attempt after fulfillment",
        requestId: `rehearsal-repl-2-${originalAllocationId}`,
        reasonCode: "duplicate",
      },
      db
    );
    report.secondReplacementRequest = secondRequest;
    if (secondRequest.ok || secondRequest.code !== "replacement_already_fulfilled") {
      throw new Error(`second_request_unexpected:${JSON.stringify(secondRequest)}`);
    }

    const originalItem = await db.leadInventoryItem.findFirst({
      where: {
        leadAllocations: { some: { id: originalAllocationId } },
      },
    });
    report.originalInventoryStatus = originalItem?.status ?? null;
    if (originalItem?.status === "available") {
      throw new Error("original_restored_to_available");
    }

    const replacementExport = await commitBuyerCsvExport(
      {
        orderId: fixtures.orderId,
        idempotencyKey: `rehearsal-export-replacement-${fixtures.orderId}`,
        createdBy: "rehearsal-script",
      },
      db
    );
    report.replacementExport = replacementExport;
    if (!replacementExport.ok) {
      throw new Error(`replacement_export_failed:${replacementExport.code}`);
    }
    if (
      !replacementDecision.item.replacementAllocationId ||
      !replacementExport.allocationIds.includes(
        replacementDecision.item.replacementAllocationId
      )
    ) {
      throw new Error("replacement_allocation_missing_from_export");
    }
    const replacementItem = await db.leadInventoryItem.findFirst({
      where: {
        leadAllocations: {
          some: { id: replacementDecision.item.replacementAllocationId },
        },
      },
    });
    report.replacementInventoryStatus = replacementItem?.status ?? null;

    // False duplicate claim: request succeeds, approve fails closed, deny persists.
    const falseAllocationId = delivered.allocationIds[1];
    if (!falseAllocationId) throw new Error("false_allocation_missing");
    const falseReq = await requestLeadReplacement(
      {
        originalAllocationId: falseAllocationId,
        reason: "Buyer dissatisfaction disguised as duplicate",
        requestId: `rehearsal-false-${falseAllocationId}`,
        reasonCode: "duplicate",
      },
      db
    );
    report.falseDuplicateRequest = falseReq;
    if (!falseReq.ok) throw new Error(`false_request_failed:${falseReq.code}`);
    const falsePreview = await previewLeadReplacement(falseReq.item.id, db);
    report.falseDuplicatePreview = falsePreview;
    if (falsePreview.ok || falsePreview.code !== "duplicate_not_proven") {
      throw new Error(`false_preview_unexpected:${JSON.stringify(falsePreview)}`);
    }
    const falseApprove = await decideLeadReplacement(
      {
        replacementId: falseReq.item.id,
        action: "approve",
        confirmationPhrase: "APPROVE REPLACEMENT",
        decidedBy: "rehearsal-operator",
      },
      db
    );
    report.falseDuplicateApprove = falseApprove;
    if (falseApprove.ok || falseApprove.code !== "duplicate_not_proven") {
      throw new Error(`false_approve_unexpected:${JSON.stringify(falseApprove)}`);
    }
    const falseDeny = await decideLeadReplacement(
      {
        replacementId: falseReq.item.id,
        action: "deny",
        decidedBy: "rehearsal-operator",
        decisionNote: "No independent duplicate evidence",
      },
      db
    );
    report.falseDuplicateDenial = falseDeny;
    if (!falseDeny.ok || falseDeny.item.status !== "denied") {
      throw new Error(`false_deny_failed:${JSON.stringify(falseDeny)}`);
    }

    report.requestedQuantity = 3;
    report.eligibleQuantity = preview.eligibleQuantity;
    report.selectedQuantity = commit.selectedQuantity;
    report.reservedQuantity = reservedCount;
    report.exportedQuantity = exportCommit.rowCount;
    report.deliveredQuantity = delivered.identityCount;
    report.replacementQuantity = replacementDecision.item.replacementAllocationId ? 1 : 0;
    report.buyerHistoryAfterExportCommit = historyAfterExport;
    report.buyerHistoryAfterDelivery = historyAfterDelivery;
    report.externalWriteOccurred = false;
    report.ok = true;

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
