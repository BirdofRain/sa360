/**
 * Association GHL is still called in-process after intake commits.
 * This outbox is the schedule for the case where that process dies first.
 *
 * A pending row has not started an external attempt and can be delivered once.
 * A live run that is executing, or that already called GHL, is not sent again.
 * Marking a row uncertain does not complete the GHL call and does not retry it.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { isOngoingGhlServiceEnabled } from "../../lib/ghl-ongoing-delivery-scope.js";
import { prisma } from "../../lib/db.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "../routing-source-association.service.js";
import {
  ongoingRunDisposition,
  type DeliveryRunDispositionInput,
} from "../ghl-destination-authorization.js";
import { deliverConfirmedAssociationIfActivated } from "../association-ongoing-delivery.js";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { attachSourceAttributesToLifecyclePayload } from "../source-intake/source-enrichment-pipeline.service.js";
import type { SourceAttributes, UnmappedSourceField } from "../source-intake/source-enrichment.types.js";

export const ASSOCIATION_DISPATCH_GRACE_MS = 30_000;
export const ASSOCIATION_DISPATCH_LEASE_MS = 60_000;

type DispatchDb = PrismaClient | Prisma.TransactionClient;

export type AssociationDispatchRecovery = "deliver" | "settle_without_delivery" | "mark_uncertain" | "wait" | "skip";

export function associationDispatchRecovery(input: {
  status: string;
  executingAt: Date | null;
  run: DeliveryRunDispositionInput | null;
  now: Date;
  leaseMs?: number;
}): AssociationDispatchRecovery {
  if (input.status === "settled" || input.status === "uncertain") return "skip";
  const disposition = ongoingRunDisposition(input.run);
  if (disposition === "hold") {
    if (input.run?.status === "executing") return "mark_uncertain";
    return "settle_without_delivery";
  }
  if (input.status === "executing") {
    const leaseMs = input.leaseMs ?? ASSOCIATION_DISPATCH_LEASE_MS;
    const started = input.executingAt?.getTime() ?? 0;
    if (input.now.getTime() - started < leaseMs) return "wait";
  }
  if (input.status === "pending" || input.status === "executing") return "deliver";
  return "skip";
}

export async function recordGhlAssociationDispatchOutbox(
  input: {
    sourceLeadEventId: string;
    status: string;
    routing: {
      matched: boolean;
      routingAuthority?: string | null;
      routingDryRunDecisionId?: string | null;
      destinationClientAccountId?: string | null;
      destinationLocationIdGhl?: string | null;
    };
    resolvedAt: Date;
  },
  db: DispatchDb,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!isOngoingGhlServiceEnabled(env)) return;
  if (input.status !== "routing_matched" || input.routing.matched !== true) return;
  if (input.routing.routingAuthority !== ROUTING_AUTHORITY_SOURCE_ASSOCIATION) return;
  const clientAccountId = input.routing.destinationClientAccountId?.trim() ?? "";
  const locationId = input.routing.destinationLocationIdGhl?.trim() ?? "";
  if (!clientAccountId || !locationId) return;
  const idempotencyKey = `association:${input.sourceLeadEventId}`;
  await db.ghlAssociationDispatchOutbox.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      status: "pending",
      clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      routingDryRunDecisionId: input.routing.routingDryRunDecisionId?.trim() || null,
      destinationLocationIdGhl: locationId,
      availableAt: new Date(input.resolvedAt.getTime() + ASSOCIATION_DISPATCH_GRACE_MS),
    },
    update: {},
  });
}

type OutboxRow = {
  id: string;
  status: string;
  sourceLeadEventId: string;
  clientAccountId: string;
  routingDryRunDecisionId: string | null;
  destinationLocationIdGhl: string;
  executingAt: Date | null;
};

type ProcessDeps = {
  now?: Date;
  listDue: (now: Date, limit: number) => Promise<OutboxRow[]>;
  claim: (row: OutboxRow, now: Date) => Promise<boolean>;
  findRun: (decisionId: string | null) => Promise<DeliveryRunDispositionInput | null>;
  deliver: (row: OutboxRow) => Promise<{ outcome: string; reason?: string; runId: string | null; externalCallExecuted: boolean }>;
  settle: (id: string, data: { status: string; outcome: string; liveRunId: string | null; externalCallExecuted: boolean; lastError: string | null }) => Promise<void>;
};

export async function processDueGhlAssociationDispatches(
  deps: ProcessDeps,
  limit = 20
): Promise<{ processed: number; delivered: number; settled: number; uncertain: number }> {
  const now = deps.now ?? new Date();
  const due = await deps.listDue(now, limit);
  const counts = { processed: 0, delivered: 0, settled: 0, uncertain: 0 };
  for (const row of due) {
    const run = await deps.findRun(row.routingDryRunDecisionId);
    const action = associationDispatchRecovery({
      status: row.status,
      executingAt: row.executingAt,
      run,
      now,
    });
    if (action === "wait" || action === "skip") continue;
    if (action === "deliver") {
      const claimed = await deps.claim(row, now);
      if (!claimed) continue;
    }
    counts.processed += 1;
    if (action === "mark_uncertain") {
      await deps.settle(row.id, {
        status: "uncertain",
        outcome: "uncertain",
        liveRunId: null,
        externalCallExecuted: false,
        lastError: "attempt_in_flight",
      });
      counts.uncertain += 1;
      continue;
    }
    if (action === "settle_without_delivery") {
      await deps.settle(row.id, {
        status: "settled",
        outcome: "held",
        liveRunId: null,
        externalCallExecuted: false,
        lastError: null,
      });
      counts.settled += 1;
      continue;
    }
    const result = await deps.deliver(row);
    const uncertain = result.reason === "delivery_failed" || (result.outcome === "skipped" && result.externalCallExecuted);
    await deps.settle(row.id, {
      status: uncertain ? "uncertain" : "settled",
      outcome: result.outcome,
      liveRunId: result.runId,
      externalCallExecuted: result.externalCallExecuted,
      lastError: uncertain ? "external_call_without_terminal_status" : null,
    });
    if (uncertain) counts.uncertain += 1;
    else if (result.externalCallExecuted) counts.delivered += 1;
    else counts.settled += 1;
  }
  return counts;
}

export async function settleGhlAssociationDispatchFromResult(
  sourceLeadEventId: string,
  result: { outcome: string; runId: string | null; externalCallExecuted: boolean; reason?: string },
  db: DispatchDb = prisma
): Promise<void> {
  const uncertain = result.outcome === "skipped" && result.reason === "delivery_failed";
  await db.ghlAssociationDispatchOutbox.updateMany({
    where: { sourceLeadEventId, status: { in: ["pending", "executing"] } },
    data: {
      status: uncertain ? "uncertain" : "settled",
      outcome: result.outcome,
      liveRunId: result.runId,
      externalCallExecuted: result.externalCallExecuted,
      settledAt: uncertain ? null : new Date(),
      lastError: uncertain ? "in_process_failed" : null,
    },
  });
}

export async function processDueGhlAssociationDispatchesFromDb(
  limit = 20,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ processed: number; delivered: number; settled: number; uncertain: number; skipped?: string }> {
  if (!isOngoingGhlServiceEnabled(env)) {
    return { processed: 0, delivered: 0, settled: 0, uncertain: 0, skipped: "service_disabled" };
  }
  const now = new Date();
  return processDueGhlAssociationDispatches({
    now,
    listDue: (at, take) => listDueOutbox(at, take),
    claim: (row, at) => claimOutbox(row, at),
    findRun: findRunForDecision,
    deliver: deliverOutboxRow,
    settle: async (id, data) => {
      await prisma.ghlAssociationDispatchOutbox.update({
        where: { id },
        data: {
          ...data,
          settledAt: data.status === "settled" ? new Date() : null,
        },
      });
    },
  }, limit);
}

async function listDueOutbox(now: Date, limit: number): Promise<OutboxRow[]> {
  const leaseCutoff = new Date(now.getTime() - ASSOCIATION_DISPATCH_LEASE_MS);
  return prisma.ghlAssociationDispatchOutbox.findMany({
    where: {
      OR: [
        { status: "pending", availableAt: { lte: now } },
        { status: "executing", OR: [{ executingAt: null }, { executingAt: { lt: leaseCutoff } }] },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      status: true,
      sourceLeadEventId: true,
      clientAccountId: true,
      routingDryRunDecisionId: true,
      destinationLocationIdGhl: true,
      executingAt: true,
    },
  });
}

async function claimOutbox(row: OutboxRow, now: Date): Promise<boolean> {
  const leaseCutoff = new Date(now.getTime() - ASSOCIATION_DISPATCH_LEASE_MS);
  const claimed = await prisma.ghlAssociationDispatchOutbox.updateMany({
    where:
      row.status === "executing"
        ? { id: row.id, status: "executing", OR: [{ executingAt: null }, { executingAt: { lt: leaseCutoff } }] }
        : { id: row.id, status: "pending" },
    data: { status: "executing", executingAt: now, attemptCount: { increment: 1 } },
  });
  return claimed.count === 1;
}

async function findRunForDecision(decisionId: string | null): Promise<DeliveryRunDispositionInput | null> {
  if (!decisionId) return null;
  const run = await prisma.ghlLiveDeliveryRun.findFirst({
    where: { routingDryRunDecisionId: decisionId },
    orderBy: { startedAt: "desc" },
    include: { stepRuns: { select: { errorCode: true, responseRedactedJson: true } } },
  });
  if (!run) return null;
  return {
    status: run.status,
    stepRuns: run.stepRuns.map((step) => ({
      errorCode: step.errorCode,
      responseRedactedJson: step.responseRedactedJson,
    })),
  };
}

async function deliverOutboxRow(row: OutboxRow) {
  const event = await prisma.sourceLeadEvent.findUnique({ where: { id: row.sourceLeadEventId } });
  const lifecyclePayload = event ? lifecycleFromEvent(event.normalizedPayloadJson, event.enrichmentMetadataJson) : undefined;
  return deliverConfirmedAssociationIfActivated({
    sourceLeadEventId: row.sourceLeadEventId,
    status: event?.status ?? "routing_matched",
    routing: {
      matched: true,
      routingDryRunDecisionId: row.routingDryRunDecisionId,
      routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
      destinationClientAccountId: row.clientAccountId,
      destinationLocationIdGhl: row.destinationLocationIdGhl,
    },
    lifecyclePayload,
  });
}

function lifecycleFromEvent(normalized: unknown, enrichmentJson: unknown): LifecycleEventSchema | undefined {
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) return undefined;
  const enrichment = asRecord(enrichmentJson);
  const attributes = asRecord(enrichment?.sourceAttributes);
  if (!attributes) return parsed.data;
  const unmapped = Array.isArray(enrichment?.unmappedSourceFields)
    ? (enrichment.unmappedSourceFields as UnmappedSourceField[])
    : [];
  return attachSourceAttributesToLifecyclePayload(parsed.data, attributes as SourceAttributes, unmapped);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
