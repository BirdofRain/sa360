import type { LeadAllocation, LeadOrder, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { EXECUTION_MODE_LIVE, EXECUTION_MODE_SIMULATION } from "../fulfillment-execution/fulfillment-execution.constants.js";

export type Lf2ProofReviewExecutionContext = {
  allocation: (LeadAllocation & { leadOrder: LeadOrder }) | null;
  simulationAttemptCount: number;
  liveAttemptCount: number;
  hasSucceededLiveAttempt: boolean;
  hasActiveLiveAttempt: boolean;
  hasUnknownOutcomeLiveAttempt: boolean;
  allocationCommitted: boolean;
  fulfilledQuantity: number;
  priorExternalDeliveryEvidence: boolean;
  priorGhlLiveDeliveryRun: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function hasPriorExternalDeliveryEvidence(event: {
  deliveredAt: Date | null;
  deliveryResultJson: unknown;
}): boolean {
  if (event.deliveredAt) return true;
  const delivery = asRecord(event.deliveryResultJson);
  if (!delivery) return false;
  if (delivery.externalCallExecuted === true) return true;
  const mode = typeof delivery.mode === "string" ? delivery.mode.trim().toLowerCase() : "";
  if (mode === "live_canary" || mode === "live") return true;
  if (typeof delivery.contactIdGhl === "string" && delivery.contactIdGhl.trim()) return true;
  return false;
}

export async function loadLf2ProofReviewExecutionContext(
  event: {
    id: string;
    deliveredAt: Date | null;
    deliveryResultJson: unknown;
    routingDryRunDecisionId: string | null;
    sourceLeadUid: string | null;
  },
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<Lf2ProofReviewExecutionContext> {
  const allocation = await db.leadAllocation.findFirst({
    where: { sourceLeadEventId: event.id },
    include: { leadOrder: true },
    orderBy: { createdAt: "desc" },
  });

  const attempts = await db.deliveryAttempt.findMany({
    where: { deliveryInstruction: { leadAllocation: { sourceLeadEventId: event.id } } },
    select: { executionMode: true, status: true },
  });

  const simulationAttempts = attempts.filter((row) => row.executionMode === EXECUTION_MODE_SIMULATION);
  const liveAttempts = attempts.filter((row) => row.executionMode === EXECUTION_MODE_LIVE);

  let priorGhlLiveDeliveryRun = false;
  if (event.routingDryRunDecisionId) {
    const count = await db.ghlLiveDeliveryRun.count({
      where: { routingDryRunDecisionId: event.routingDryRunDecisionId },
    });
    priorGhlLiveDeliveryRun = count > 0;
  }
  if (!priorGhlLiveDeliveryRun && event.sourceLeadUid) {
    const count = await db.ghlLiveDeliveryRun.count({
      where: { leadDeliveryPlan: { sourceLeadUid: event.sourceLeadUid } },
    });
    priorGhlLiveDeliveryRun = count > 0;
  }

  return {
    allocation,
    simulationAttemptCount: simulationAttempts.length,
    liveAttemptCount: liveAttempts.length,
    hasSucceededLiveAttempt: liveAttempts.some((row) => row.status === "succeeded"),
    hasActiveLiveAttempt: liveAttempts.some(
      (row) => row.status === "claimed" || row.status === "in_progress"
    ),
    hasUnknownOutcomeLiveAttempt: liveAttempts.some((row) => row.status === "unknown_outcome"),
    allocationCommitted: Boolean(allocation?.committedAt),
    fulfilledQuantity: allocation?.leadOrder.fulfilledQuantity ?? 0,
    priorExternalDeliveryEvidence: hasPriorExternalDeliveryEvidence(event),
    priorGhlLiveDeliveryRun,
  };
}
