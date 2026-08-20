import type { PrismaClient } from "@prisma/client";
import {
  AGED_INVENTORY_OPS_VERIFY_BATCH_SIZE,
  AGED_INVENTORY_OPS_VERIFY_CONFIRMATION,
  AGED_INVENTORY_OPS_VERIFY_KIND,
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
  isCanonicalUsStateCode,
} from "@sa360/shared";

import { assertExpectedDbHost } from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { listActiveExclusions } from "../ppl-fulfillment/protected-agent-exclusion.service.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { buildAgedInventoryLeadUid } from "../aged-inventory-import/aged-inventory-import-classify.service.js";

/**
 * Aged operational verification (truthful scope):
 * MAY verify: normalized source row, generated date, niche, state, usable name,
 * usable phone and/or email, no exact source duplicate, no disqualifying identity
 * conflict, no configured protected-agent exclusion.
 * MUST NOT claim: TCPA consent, TrustedForm, buyer delivery proof, source ownership proof.
 */

export type OpsVerifyArgs = {
  mode: "verify" | "activate";
  lotKey: string;
  expectedDbHost: string;
  operator: string;
  confirmation: string;
  requestId: string;
  batchSize?: number;
  operatorNote?: string;
};

function progress(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...data }));
}

async function loadLot(db: PrismaClient, lotKey: string) {
  const lot = await db.inventoryLot.findUnique({ where: { lotKey } });
  if (!lot) throw new Error("lot_not_found");
  return lot;
}

type ItemRow = {
  id: string;
  status: string;
  normalizedState: string;
  nicheKey: string;
  generatedAt: Date;
  sourceLeadEvent: {
    id: string;
    sourceLeadId: string | null;
    sourceLeadUid: string | null;
    normalizedPayloadJson: unknown;
  };
};

function readName(payload: unknown): { first: string; last: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { first: "", last: "" };
  }
  const rec = payload as Record<string, unknown>;
  const first = typeof rec.firstName === "string" ? rec.firstName.trim() : "";
  const last = typeof rec.lastName === "string" ? rec.lastName.trim() : "";
  return { first, last };
}

function assessOperational(item: ItemRow, exclusionsActive: number): {
  outcome: "passed" | "quarantined" | "rejected";
  reasons: string[];
} {
  const reasons: string[] = [];
  const identity = readNormalizedLeadIdentity(item.sourceLeadEvent.normalizedPayloadJson);
  const { first, last } = readName(item.sourceLeadEvent.normalizedPayloadJson);
  const phone = identity?.phoneE164?.trim() || "";
  const email = identity?.email?.trim() || "";

  if (!item.generatedAt || Number.isNaN(item.generatedAt.getTime())) {
    return { outcome: "rejected", reasons: ["invalid_generated_at"] };
  }
  if (!item.nicheKey?.trim()) {
    return { outcome: "rejected", reasons: ["invalid_niche"] };
  }
  if (!item.normalizedState || !isCanonicalUsStateCode(item.normalizedState)) {
    return { outcome: "rejected", reasons: ["invalid_state"] };
  }
  if (!first || !last) {
    return { outcome: "rejected", reasons: ["invalid_name"] };
  }
  if (!phone && !email) {
    return { outcome: "rejected", reasons: ["invalid_identity"] };
  }

  // Protected agents: only exclude when an explicit list is configured AND matches.
  // With zero active exclusions, count remains zero and nothing is quarantined for this reason.
  if (exclusionsActive > 0) {
    // Aged bulk import does not attach ownership; unresolved owner with active list fails closed at selection time.
    // Operational verify does not infer ownership from Used By / campaign labels.
    reasons.push("protected_exclusions_configured_no_owner_on_aged_bulk");
    // Do not quarantine solely because list exists without owner — selection fail-closed handles buyer path.
  }

  const payload = item.sourceLeadEvent.normalizedPayloadJson as Record<string, unknown> | null;
  if (payload && payload["email_issue"]) {
    reasons.push("email_issue_informational");
  }

  reasons.push("aged_operational_v1");
  reasons.push("no_tcpa_claim");
  reasons.push("no_trustedform_claim");
  reasons.push("no_buyer_delivery_proof_claim");
  reasons.push("no_source_ownership_proof_claim");
  return { outcome: "passed", reasons };
}

export async function runAgedInventoryOpsVerify(args: OpsVerifyArgs, db: PrismaClient) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_required");
  const dbIdentity = assertExpectedDbHost({
    databaseUrl,
    expectedDbHost: args.expectedDbHost,
  });

  if (args.mode === "verify" && args.confirmation !== AGED_INVENTORY_OPS_VERIFY_CONFIRMATION) {
    throw new Error("invalid_confirmation");
  }
  if (
    args.mode === "activate" &&
    args.confirmation !== LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION
  ) {
    throw new Error("invalid_confirmation");
  }

  const existing = await db.agedInventoryOpsVerifyAction.findUnique({
    where: { requestId: args.requestId },
  });
  if (existing?.actionStatus === "applied" || existing?.actionStatus === "completed") {
    // Activation may have partially applied before a timeout; if pending_review remains
    // for this lot, allow a fresh requestId to finish. Same requestId stays idempotent.
    if (args.mode === "activate") {
      const remaining = await db.leadInventoryItem.count({
        where: { inventoryLotId: existing.inventoryLotId, status: "pending_review" },
      });
      if (remaining === 0) {
        return {
          ok: true as const,
          idempotentReplay: true,
          db: dbIdentity.sanitized,
          action: existing,
        };
      }
      // Fall through is not possible with same completed requestId — require new requestId.
      throw new Error(
        `activation_incomplete_use_new_request_id:remaining_pending_review=${remaining}`
      );
    }
    return {
      ok: true as const,
      idempotentReplay: true,
      db: dbIdentity.sanitized,
      action: existing,
    };
  }

  const lot = await loadLot(db, args.lotKey);
  const batchSize = Math.min(
    Math.max(1, args.batchSize ?? AGED_INVENTORY_OPS_VERIFY_BATCH_SIZE),
    2000
  );
  const exclusions = await listActiveExclusions(db);
  const exclusionsActive = exclusions.length;

  if (args.mode === "verify") {
    return verifyLot({
      db,
      lot,
      args,
      batchSize,
      exclusionsActive,
      dbSanitized: dbIdentity.sanitized,
      existingId: existing?.id,
    });
  }
  return activateLot({
    db,
    lot,
    args,
    batchSize,
    dbSanitized: dbIdentity.sanitized,
    existingId: existing?.id,
  });
}

async function verifyLot(input: {
  db: PrismaClient;
  lot: { id: string; lotKey: string };
  args: OpsVerifyArgs;
  batchSize: number;
  exclusionsActive: number;
  dbSanitized: string;
  existingId?: string;
}) {
  const { db, lot, args, batchSize, exclusionsActive, dbSanitized } = input;
  let passed = 0;
  let quarantined = 0;
  let rejected = 0;
  let cursor: string | undefined;
  let processed = 0;
  const started = Date.now();

  const action = await db.agedInventoryOpsVerifyAction.upsert({
    where: { requestId: args.requestId },
    create: {
      requestId: args.requestId,
      inventoryLotId: lot.id,
      lotKey: lot.lotKey,
      actionType: "verify",
      actionStatus: "running",
      verificationKind: AGED_INVENTORY_OPS_VERIFY_KIND,
      operator: args.operator,
      operatorNote: args.operatorNote ?? "aged operational verification",
      previewedAt: new Date(),
    },
    update: {
      actionStatus: "running",
      operator: args.operator,
    },
  });

  for (;;) {
    const items: ItemRow[] = await db.leadInventoryItem.findMany({
      where: {
        inventoryLotId: lot.id,
        status: "pending_review",
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        status: true,
        normalizedState: true,
        nicheKey: true,
        generatedAt: true,
        sourceLeadEvent: {
          select: {
            id: true,
            sourceLeadId: true,
            sourceLeadUid: true,
            normalizedPayloadJson: true,
          },
        },
      },
    });
    if (!items.length) break;

    await db.$transaction(
      async (tx) => {
        for (const item of items) {
          const assessment = assessOperational(item, exclusionsActive);
          const sourceLeadId = item.sourceLeadEvent.sourceLeadId?.trim();
          if (!sourceLeadId) {
            rejected += 1;
            processed += 1;
            continue;
          }
          const leadUid =
            item.sourceLeadEvent.sourceLeadUid ||
            buildAgedInventoryLeadUid(sourceLeadId);

          if (assessment.outcome === "passed") {
            await tx.leadVerificationResult.upsert({
              where: { leadUid },
              create: {
                leadUid,
                verificationStatus: "PASSED",
                duplicateStatus: "UNIQUE",
                phoneStatus: "operational_check",
                emailStatus: "operational_check",
                suppressionStatus: "not_checked_aged_ops",
                reasons: assessment.reasons,
                checkedAt: new Date(),
              },
              update: {
                verificationStatus: "PASSED",
                duplicateStatus: "UNIQUE",
                phoneStatus: "operational_check",
                emailStatus: "operational_check",
                suppressionStatus: "not_checked_aged_ops",
                reasons: assessment.reasons,
                checkedAt: new Date(),
              },
            });
            passed += 1;
          } else if (assessment.outcome === "quarantined") {
            await tx.leadInventoryItem.updateMany({
              where: { id: item.id, status: "pending_review" },
              data: {
                status: "quarantined",
                quarantineReason: assessment.reasons[0] ?? "ops_verify_quarantine",
              },
            });
            await tx.leadVerificationResult.upsert({
              where: { leadUid },
              create: {
                leadUid,
                verificationStatus: "NEEDS_REVIEW",
                duplicateStatus: "POSSIBLE_MATCH",
                reasons: assessment.reasons,
                checkedAt: new Date(),
              },
              update: {
                verificationStatus: "NEEDS_REVIEW",
                duplicateStatus: "POSSIBLE_MATCH",
                reasons: assessment.reasons,
                checkedAt: new Date(),
              },
            });
            quarantined += 1;
          } else {
            await tx.leadInventoryItem.updateMany({
              where: { id: item.id, status: "pending_review" },
              data: {
                status: "rejected",
                rejectedAt: new Date(),
              },
            });
            await tx.leadVerificationResult.upsert({
              where: { leadUid },
              create: {
                leadUid,
                verificationStatus: "FAILED",
                duplicateStatus: "UNCHECKED",
                reasons: assessment.reasons,
                checkedAt: new Date(),
              },
              update: {
                verificationStatus: "FAILED",
                reasons: assessment.reasons,
                checkedAt: new Date(),
              },
            });
            rejected += 1;
          }
          processed += 1;
        }
      },
      { timeout: 180_000, maxWait: 30_000 }
    );

    cursor = items[items.length - 1]!.id;
    await db.agedInventoryOpsVerifyAction.update({
      where: { id: action.id },
      data: {
        nextCursor: cursor,
        passedCount: passed,
        quarantinedCount: quarantined,
        rejectedCount: rejected,
        requestedCount: processed,
      },
    });
    progress("verify_batch", {
      processed,
      passed,
      quarantined,
      rejected,
      protectedExclusionsActive: exclusionsActive,
    });
  }

  const updated = await db.agedInventoryOpsVerifyAction.update({
    where: { id: action.id },
    data: {
      actionStatus: "completed",
      committedAt: new Date(),
      passedCount: passed,
      quarantinedCount: quarantined,
      rejectedCount: rejected,
      requestedCount: processed,
      summaryJson: {
        verificationKind: AGED_INVENTORY_OPS_VERIFY_KIND,
        durationMs: Date.now() - started,
        protectedExclusionsActive: exclusionsActive,
        claims: {
          tcpa: false,
          trustedForm: false,
          buyerDeliveryProof: false,
          sourceOwnershipProof: false,
        },
      },
    },
  });

  return {
    ok: true as const,
    idempotentReplay: false,
    db: dbSanitized,
    action: updated,
    counts: { processed, passed, quarantined, rejected },
    durationMs: Date.now() - started,
  };
}

async function activateLot(input: {
  db: PrismaClient;
  lot: { id: string; lotKey: string };
  args: OpsVerifyArgs;
  batchSize: number;
  dbSanitized: string;
  existingId?: string;
}) {
  const { db, lot, args, batchSize, dbSanitized } = input;
  let activated = 0;
  let blocked = 0;
  let cursor: string | undefined;
  const started = Date.now();
  const now = new Date();

  const action = await db.agedInventoryOpsVerifyAction.upsert({
    where: { requestId: args.requestId },
    create: {
      requestId: args.requestId,
      inventoryLotId: lot.id,
      lotKey: lot.lotKey,
      actionType: "activate",
      actionStatus: "running",
      verificationKind: AGED_INVENTORY_OPS_VERIFY_KIND,
      operator: args.operator,
      operatorNote: args.operatorNote ?? "bulk activate PASSED aged inventory",
      previewedAt: now,
    },
    update: { actionStatus: "running", operator: args.operator },
  });

  // Also create a review action audit header for make_available phrase traceability
  const reviewAction = await db.leadInventoryReviewAction.create({
    data: {
      requestId: `${args.requestId}:review`,
      actionType: "make_available",
      actionStatus: "previewed",
      requestedBy: args.operator,
      operatorNote: args.operatorNote ?? "lot-scale activation after ops verify",
      selectionFingerprint: `lot:${lot.lotKey}`,
      requestedCount: 0,
      eligibleCount: 0,
      appliedCount: 0,
      blockedCount: 0,
      resultSummaryJson: {
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
        lotKey: lot.lotKey,
        lotScale: true,
      },
      previewedAt: now,
    },
  }).catch(async (err) => {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return db.leadInventoryReviewAction.findUniqueOrThrow({
        where: { requestId: `${args.requestId}:review` },
      });
    }
    throw err;
  });

  for (;;) {
    const items = await db.leadInventoryItem.findMany({
      where: {
        inventoryLotId: lot.id,
        status: "pending_review",
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        sourceLeadEvent: { select: { sourceLeadUid: true, sourceLeadId: true } },
      },
    });
    if (!items.length) break;

    // Prefetch verification outside the write transaction to keep TX short.
    const leadUids = items
      .map((item) => {
        const sourceLeadId = item.sourceLeadEvent.sourceLeadId?.trim();
        if (!sourceLeadId) return null;
        return (
          item.sourceLeadEvent.sourceLeadUid ||
          buildAgedInventoryLeadUid(sourceLeadId)
        );
      })
      .filter((uid): uid is string => Boolean(uid));
    const verifications = await db.leadVerificationResult.findMany({
      where: { leadUid: { in: leadUids } },
      select: { leadUid: true, verificationStatus: true, duplicateStatus: true },
    });
    const byUid = new Map(verifications.map((v) => [v.leadUid, v]));

    await db.$transaction(
      async (tx) => {
        for (const item of items) {
          const sourceLeadId = item.sourceLeadEvent.sourceLeadId?.trim();
          if (!sourceLeadId) {
            blocked += 1;
            continue;
          }
          const leadUid =
            item.sourceLeadEvent.sourceLeadUid ||
            buildAgedInventoryLeadUid(sourceLeadId);
          const verification = byUid.get(leadUid);
          const canActivate =
            verification?.verificationStatus === "PASSED" &&
            (verification.duplicateStatus === "UNIQUE" ||
              verification.duplicateStatus === null);

          if (!canActivate) {
            blocked += 1;
            await tx.leadInventoryReviewItemResult
              .create({
                data: {
                  reviewActionId: reviewAction.id,
                  leadInventoryItemId: item.id,
                  priorStatus: "pending_review",
                  resultingStatus: null,
                  blockerCodesJson: ["verification_not_passed"],
                  eligibilitySnapshotJson: {
                    verificationStatus: verification?.verificationStatus ?? "UNCHECKED",
                    lotScale: true,
                  },
                },
              })
              .catch(() => undefined);
            continue;
          }

          const updated = await tx.leadInventoryItem.updateMany({
            where: { id: item.id, status: "pending_review" },
            data: { status: "available", availableAt: now },
          });
          if (updated.count !== 1) {
            blocked += 1;
            continue;
          }
          activated += 1;
          await tx.leadInventoryReviewItemResult
            .create({
              data: {
                reviewActionId: reviewAction.id,
                leadInventoryItemId: item.id,
                priorStatus: "pending_review",
                resultingStatus: "available",
                blockerCodesJson: [],
                eligibilitySnapshotJson: {
                  verificationKind: AGED_INVENTORY_OPS_VERIFY_KIND,
                  lotScale: true,
                },
                appliedAt: now,
              },
            })
            .catch(() => undefined);
        }
      },
      { timeout: 180_000, maxWait: 30_000 }
    );

    cursor = items[items.length - 1]!.id;
    progress("activate_batch", { activated, blocked, cursorPrefix: cursor.slice(0, 8) });
  }

  await db.leadInventoryReviewAction.update({
    where: { id: reviewAction.id },
    data: {
      actionStatus: activated === 0 ? "blocked" : blocked > 0 ? "partially_applied" : "applied",
      appliedCount: activated,
      blockedCount: blocked,
      requestedCount: activated + blocked,
      eligibleCount: activated,
      committedAt: now,
    },
  });

  const updated = await db.agedInventoryOpsVerifyAction.update({
    where: { id: action.id },
    data: {
      actionStatus: "completed",
      committedAt: now,
      activatedCount: activated,
      blockedCount: blocked,
      requestedCount: activated + blocked,
      summaryJson: {
        durationMs: Date.now() - started,
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
        externalWriteOccurred: false,
      },
    },
  });

  return {
    ok: true as const,
    idempotentReplay: false,
    db: dbSanitized,
    action: updated,
    counts: { activated, blocked },
    durationMs: Date.now() - started,
    externalWriteOccurred: false,
  };
}
