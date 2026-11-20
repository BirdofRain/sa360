/**
 * Campaign-scoped operation ledger.
 *
 * A claim is written before any future external HTTP attempt. This module
 * never performs that attempt. externalSendAuthorized is false on every claim.
 * A simulated row is not an external completion. Legacy GhlLiveDeliveryRun
 * receipts are not read or written here.
 *
 * Ambiguous and completed workflow, opportunity, and first-touch rows hold.
 * failed_before_send can be claimed again because no request left SA360.
 */

import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  campaignGhlRunKey,
  campaignOperationIdempotencyKey,
  type CampaignGhlPriorReceipt,
  type CampaignScopedOperation,
} from "./plan-campaign-ghl-delivery.js";

export const CAMPAIGN_GHL_OPERATIONS = [
  "contact",
  "custom_fields",
  "source_attributes",
  "note",
  "tags",
  "workflow",
  "opportunity",
  "first_touch",
] as const satisfies readonly CampaignScopedOperation[];

const HOLD_STATUSES = new Set(["claimed", "completed", "ambiguous", "rejected"]);
const RECLAIM_STATUSES = new Set(["planned", "failed_before_send", "skipped"]);

export type ReceiptScope = {
  sourceLeadEventId: string;
  clientAccountId: string;
  clientCampaignId: string;
  decisionVersion: number;
  ghlLocationId: string;
  workflowIdGhl: string;
};

export type CampaignReceiptClaim = {
  ok: true;
  receiptId: string;
  claimOwner: boolean;
  externalSendAuthorized: false;
  status: string;
  idempotencyKey: string;
};

type ReceiptRow = {
  id: string;
  operation: string;
  status: string;
  idempotencyKey: string;
  externalAttempted: boolean;
  simulated: boolean;
  externalId: string | null;
  httpStatus: number | null;
};

export function isExternalCompletion(row: Pick<ReceiptRow, "status" | "externalAttempted" | "simulated"> | null): boolean {
  return Boolean(row && row.status === "completed" && row.externalAttempted === true && row.simulated === false);
}

export function receiptToPlanner(row: ReceiptRow): CampaignGhlPriorReceipt | null {
  if (!isOperation(row.operation)) return null;
  if (row.status === "planned") return null;
  if (row.simulated || (!isExternalCompletion(row) && row.status === "completed")) {
    return { operation: row.operation, outcome: "skipped", idempotencyKey: row.idempotencyKey };
  }
  if (row.status === "claimed") {
    return { operation: row.operation, outcome: "ambiguous", idempotencyKey: row.idempotencyKey };
  }
  if (
    row.status === "completed" ||
    row.status === "failed_before_send" ||
    row.status === "ambiguous" ||
    row.status === "rejected" ||
    row.status === "skipped"
  ) {
    return { operation: row.operation, outcome: row.status, idempotencyKey: row.idempotencyKey };
  }
  return { operation: row.operation, outcome: "ambiguous", idempotencyKey: row.idempotencyKey };
}

export async function ensurePlannedCampaignReceipts(db: PrismaClient, scope: ReceiptScope): Promise<void> {
  const runKey = runKeyFor(scope);
  for (const operation of CAMPAIGN_GHL_OPERATIONS) {
    try {
      await db.campaignGhlExecutionReceipt.create({
        data: {
          ...scope,
          operation,
          status: "planned",
          idempotencyKey: campaignOperationIdempotencyKey(runKey, operation),
          externalAttempted: false,
          simulated: false,
          detailJson: { externalCall: false },
        },
      });
    } catch (err) {
      if (!isUnique(err)) throw err;
    }
  }
}

export async function claimCampaignGhlOperation(
  db: PrismaClient,
  scope: ReceiptScope,
  operation: CampaignScopedOperation
): Promise<CampaignReceiptClaim> {
  const idempotencyKey = campaignOperationIdempotencyKey(runKeyFor(scope), operation);
  try {
    return await claimOnce(db, scope, operation, idempotencyKey);
  } catch (err) {
    if (!isUnique(err)) throw err;
    const existing = await db.campaignGhlExecutionReceipt.findUnique({
      where: {
        sourceLeadEventId_clientCampaignId_decisionVersion_ghlLocationId_workflowIdGhl_operation: {
          sourceLeadEventId: scope.sourceLeadEventId,
          clientCampaignId: scope.clientCampaignId,
          decisionVersion: scope.decisionVersion,
          ghlLocationId: scope.ghlLocationId,
          workflowIdGhl: scope.workflowIdGhl,
          operation,
        },
      },
    });
    if (!existing) throw err;
    return claimResult(existing.id, false, existing.status, existing.idempotencyKey);
  }
}

async function claimOnce(
  db: PrismaClient,
  scope: ReceiptScope,
  operation: CampaignScopedOperation,
  idempotencyKey: string
): Promise<CampaignReceiptClaim> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
    const existing = await tx.campaignGhlExecutionReceipt.findUnique({
      where: {
        sourceLeadEventId_clientCampaignId_decisionVersion_ghlLocationId_workflowIdGhl_operation: {
          sourceLeadEventId: scope.sourceLeadEventId,
          clientCampaignId: scope.clientCampaignId,
          decisionVersion: scope.decisionVersion,
          ghlLocationId: scope.ghlLocationId,
          workflowIdGhl: scope.workflowIdGhl,
          operation,
        },
      },
    });
    if (!existing) {
      const created = await tx.campaignGhlExecutionReceipt.create({
        data: {
          ...scope,
          operation,
          status: "claimed",
          idempotencyKey,
          externalAttempted: false,
          simulated: false,
          claimToken: randomUUID(),
          claimedAt: new Date(),
          detailJson: { externalCall: false },
        },
      });
      return claimResult(created.id, true, "claimed", idempotencyKey);
    }
    if (HOLD_STATUSES.has(existing.status)) {
      return claimResult(existing.id, false, existing.status, existing.idempotencyKey);
    }
    if (!RECLAIM_STATUSES.has(existing.status)) {
      return claimResult(existing.id, false, existing.status, existing.idempotencyKey);
    }
    const updated = await tx.campaignGhlExecutionReceipt.updateMany({
      where: { id: existing.id, status: existing.status as never },
      data: {
        status: "claimed",
        claimToken: randomUUID(),
        claimedAt: new Date(),
        externalAttempted: false,
        simulated: false,
      },
    });
    return claimResult(existing.id, updated.count === 1, updated.count === 1 ? "claimed" : existing.status, existing.idempotencyKey);
  });
}

export async function recordCampaignGhlOutcome(
  db: PrismaClient,
  input: {
    receiptId: string;
    outcome: "completed" | "failed_before_send" | "ambiguous" | "rejected" | "skipped";
    httpStatus: number | null;
    externalId?: string | null;
  }
): Promise<{ ok: true; externalCompletion: boolean } | { ok: false; error: string }> {
  if (input.outcome === "completed" && input.httpStatus === null) {
    return { ok: false, error: "completed_requires_external_attempt" };
  }
  const externalAttempted = input.outcome === "completed" || input.outcome === "ambiguous" || input.outcome === "rejected";
  const updated = await db.campaignGhlExecutionReceipt.updateMany({
    where: { id: input.receiptId, status: "claimed", simulated: false },
    data: {
      status: input.outcome,
      externalAttempted,
      simulated: false,
      httpStatus: input.httpStatus,
      externalId: input.externalId ?? null,
      completedAt: input.outcome === "completed" ? new Date() : null,
      detailJson: { externalCall: externalAttempted, simulated: false },
    },
  });
  if (updated.count !== 1) return { ok: false, error: "claim_required" };
  return { ok: true, externalCompletion: input.outcome === "completed" && externalAttempted };
}

export async function recordSimulatedCampaignGhlOperation(
  db: PrismaClient,
  scope: ReceiptScope,
  operation: CampaignScopedOperation
): Promise<{ ok: true; externalCompletion: false } | { ok: false; error: string }> {
  const idempotencyKey = campaignOperationIdempotencyKey(runKeyFor(scope), operation);
  const existing = await db.campaignGhlExecutionReceipt.findUnique({
    where: {
      sourceLeadEventId_clientCampaignId_decisionVersion_ghlLocationId_workflowIdGhl_operation: {
        sourceLeadEventId: scope.sourceLeadEventId,
        clientCampaignId: scope.clientCampaignId,
        decisionVersion: scope.decisionVersion,
        ghlLocationId: scope.ghlLocationId,
        workflowIdGhl: scope.workflowIdGhl,
        operation,
      },
    },
  });
  if (existing && isExternalCompletion(existing)) return { ok: false, error: "external_completion_kept" };
  if (!existing) {
    await db.campaignGhlExecutionReceipt.create({
      data: {
        ...scope,
        operation,
        status: "skipped",
        idempotencyKey,
        externalAttempted: false,
        simulated: true,
        detailJson: { externalCall: false, simulated: true },
      },
    });
    return { ok: true, externalCompletion: false };
  }
  if (existing.status !== "planned" && existing.status !== "claimed") {
    return { ok: false, error: "simulation_not_applied" };
  }
  await db.campaignGhlExecutionReceipt.update({
    where: { id: existing.id },
    data: {
      status: "skipped",
      simulated: true,
      externalAttempted: false,
      detailJson: { externalCall: false, simulated: true },
    },
  });
  return { ok: true, externalCompletion: false };
}

export async function listCampaignReceipts(db: PrismaClient, scope: ReceiptScope): Promise<ReceiptRow[]> {
  return db.campaignGhlExecutionReceipt.findMany({
    where: {
      sourceLeadEventId: scope.sourceLeadEventId,
      clientAccountId: scope.clientAccountId,
      clientCampaignId: scope.clientCampaignId,
      decisionVersion: scope.decisionVersion,
      ghlLocationId: scope.ghlLocationId,
      workflowIdGhl: scope.workflowIdGhl,
    },
  });
}

function claimResult(receiptId: string, claimOwner: boolean, status: string, idempotencyKey: string): CampaignReceiptClaim {
  return { ok: true, receiptId, claimOwner, externalSendAuthorized: false, status, idempotencyKey };
}

function runKeyFor(scope: ReceiptScope): string {
  return campaignGhlRunKey(scope);
}

function isOperation(value: string): value is CampaignScopedOperation {
  return (CAMPAIGN_GHL_OPERATIONS as readonly string[]).includes(value);
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
