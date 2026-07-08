import type { Prisma, PrismaClient } from "@prisma/client";

import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import {
  claimFulfillmentOutboxForProcessing,
  markFulfillmentOutboxCompleted,
  markFulfillmentOutboxRetryableFailure,
  markFulfillmentOutboxTerminalFailure,
} from "../../repositories/fulfillment-outbox.repository.js";
import {
  findLeadAllocationByIdempotencyKey,
  createShadowLeadAllocation,
} from "../../repositories/lead-allocation.repository.js";
import {
  findLeadEligibilityAssessment,
  upsertLeadEligibilityAssessment,
} from "../../repositories/lead-eligibility.repository.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import { prisma } from "../../lib/db.js";
import { evaluateLeadEligibility } from "./eligibility.service.js";
import { planDeliveryInstructionsForAllocation } from "./delivery-planning.service.js";
import {
  buildFulfillmentOutboxIdempotencyKey,
  buildShadowAllocationIdempotencyKey,
  FULFILLMENT_SHADOW_WORK_TYPE,
} from "./fulfillment-keys.js";
import {
  listActiveFulfillmentOrders,
  resolveShadowMatch,
  type ShadowMatchContext,
} from "./shadow-matcher.service.js";

export type ProcessShadowFulfillmentResult =
  | { ok: true; status: "completed" | "skipped_existing"; sourceLeadEventId: string }
  | {
      ok: true;
      status: "stopped";
      sourceLeadEventId: string;
      stopReason: string;
      eligibilityStatus?: string;
    }
  | { ok: false; status: "retryable" | "terminal"; error: string };

function readMatchContext(
  event: NonNullable<Awaited<ReturnType<typeof findSourceLeadEventById>>>
): ShadowMatchContext {
  const enrichment =
    event.enrichmentMetadataJson && typeof event.enrichmentMetadataJson === "object"
      ? (event.enrichmentMetadataJson as Record<string, unknown>)
      : {};
  const normalized =
    event.normalizedPayloadJson && typeof event.normalizedPayloadJson === "object"
      ? (event.normalizedPayloadJson as Record<string, unknown>)
      : {};
  const sourceLane =
    typeof enrichment.sourceLane === "string"
      ? enrichment.sourceLane
      : `${event.sourceProvider}_${event.sourceSystem}`;
  const state =
    typeof normalized.state === "string"
      ? normalized.state
      : typeof normalized.stateCode === "string"
        ? normalized.stateCode
        : null;

  return {
    sourceLeadEventId: event.id,
    clientAccountId: event.clientAccountIdResolved,
    campaignId: event.sourceCampaignId,
    routingRuleId: event.routingRuleIdResolved,
    nicheKey:
      typeof enrichment.nicheKey === "string"
        ? enrichment.nicheKey
        : typeof normalized.nicheKey === "string"
          ? normalized.nicheKey
          : null,
    productType:
      typeof enrichment.productType === "string"
        ? enrichment.productType
        : typeof normalized.productType === "string"
          ? normalized.productType
          : null,
    sourceLane,
    state,
  };
}

export async function processShadowFulfillmentOutboxItem(
  outboxId: string,
  db: PrismaClient = prisma
): Promise<ProcessShadowFulfillmentResult> {
  const claimed = await claimFulfillmentOutboxForProcessing(outboxId, db);
  if (!claimed) {
    const existing = await db.fulfillmentOutbox.findUnique({ where: { id: outboxId } });
    if (existing?.status === "completed") {
      return {
        ok: true,
        status: "skipped_existing",
        sourceLeadEventId: existing.sourceLeadEventId,
      };
    }
    return { ok: false, status: "retryable", error: "outbox_not_claimable" };
  }

  try {
    const event = await findSourceLeadEventById(claimed.sourceLeadEventId, db);
    if (!event) {
      await markFulfillmentOutboxTerminalFailure(
        { id: claimed.id, lastErrorJson: { code: "source_lead_not_found" } },
        db
      );
      return { ok: false, status: "terminal", error: "source_lead_not_found" };
    }

    const allocationKey = buildShadowAllocationIdempotencyKey(event.id);
    const existingAllocation = await findLeadAllocationByIdempotencyKey(allocationKey, db);
    if (existingAllocation) {
      await markFulfillmentOutboxCompleted(claimed.id, db);
      return { ok: true, status: "skipped_existing", sourceLeadEventId: event.id };
    }

    const leadUid = event.sourceLeadUid?.trim();
    const leadProof = leadUid ? await getLeadProofByLeadUid(leadUid, db) : null;
    const verification = leadUid
      ? await db.leadVerificationResult.findUnique({ where: { leadUid } })
      : null;

    const eligibilityEval = evaluateLeadEligibility({
      sourceLeadEvent: event,
      leadProof,
      verification,
      leadState: readMatchContext(event).state,
    });

    await upsertLeadEligibilityAssessment(
      {
        sourceLeadEventId: event.id,
        policyKey: eligibilityEval.policyKey,
        policyVersion: eligibilityEval.policyVersion,
        status: eligibilityEval.status,
        reasonCodesJson: eligibilityEval.reasonCodes as Prisma.InputJsonValue,
        proofResultJson: eligibilityEval.proofResult as Prisma.InputJsonValue,
        duplicateResultJson: eligibilityEval.duplicateResult as Prisma.InputJsonValue,
        requiredFieldResultJson: eligibilityEval.requiredFieldResult as Prisma.InputJsonValue,
        geographyResultJson: eligibilityEval.geographyResult as Prisma.InputJsonValue,
        consentResultJson: eligibilityEval.consentResult as Prisma.InputJsonValue,
      },
      db
    );

    if (eligibilityEval.status !== "eligible") {
      await markFulfillmentOutboxCompleted(claimed.id, db);
      return {
        ok: true,
        status: "stopped",
        sourceLeadEventId: event.id,
        stopReason: eligibilityEval.status,
        eligibilityStatus: eligibilityEval.status,
      };
    }

    const orders = await listActiveFulfillmentOrders(db);
    const match = resolveShadowMatch(orders, readMatchContext(event));
    if (!match.ok) {
      await markFulfillmentOutboxCompleted(claimed.id, db);
      return {
        ok: true,
        status: "stopped",
        sourceLeadEventId: event.id,
        stopReason: match.code,
      };
    }

    const allocation = await createShadowLeadAllocation(
      {
        sourceLeadEventId: event.id,
        leadOrderId: match.selected.id,
        clientAccountId: match.selected.clientAccountId,
        allocationPolicyVersion: match.policyVersion,
        decisionReasonsJson: match.decisionReasons,
        candidateCount: match.candidates.length,
        idempotencyKey: allocationKey,
      },
      db
    );

    const planning = await planDeliveryInstructionsForAllocation({
      leadAllocationId: allocation.id,
      clientAccountId: match.selected.clientAccountId,
    });

    if (!planning.ok) {
      await markFulfillmentOutboxCompleted(claimed.id, db);
      return {
        ok: true,
        status: "stopped",
        sourceLeadEventId: event.id,
        stopReason: planning.code,
      };
    }

    await db.leadOrder.update({
      where: { id: match.selected.id },
      data: { proposedQuantity: { increment: 1 } },
    });

    await markFulfillmentOutboxCompleted(claimed.id, db);
    return { ok: true, status: "completed", sourceLeadEventId: event.id };
  } catch (err) {
    await markFulfillmentOutboxRetryableFailure(
      {
        id: claimed.id,
        lastErrorJson: {
          message: err instanceof Error ? err.message : "unknown_error",
        },
      },
      db
    );
    return {
      ok: false,
      status: "retryable",
      error: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

export async function ensureFulfillmentOutboxForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient = prisma
) {
  const idempotencyKey = buildFulfillmentOutboxIdempotencyKey(sourceLeadEventId);
  return db.fulfillmentOutbox.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      sourceLeadEventId,
      workType: FULFILLMENT_SHADOW_WORK_TYPE,
      status: "pending",
    },
    update: {},
  });
}

export async function reconcileMissingFulfillmentOutbox(
  input: { limit?: number } = {},
  db: PrismaClient = prisma
) {
  const missing = await db.sourceLeadEvent.findMany({
    where: {
      status: { in: ["normalized", "routing_matched", "approved"] },
      fulfillmentOutboxItems: { none: { workType: FULFILLMENT_SHADOW_WORK_TYPE } },
    },
    orderBy: { receivedAt: "asc" },
    take: Math.min(Math.max(input.limit ?? 50, 1), 200),
    select: { id: true },
  });

  const created: string[] = [];
  for (const row of missing) {
    await ensureFulfillmentOutboxForSourceLead(row.id, db);
    created.push(row.id);
  }
  return { reconciledCount: created.length, sourceLeadEventIds: created };
}
