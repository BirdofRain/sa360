import type { PrismaClient } from "@prisma/client";

import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { evaluateAndPersistDuplicateRiskForRoutingDecision } from "../lead-identity/lead-identity-correlation.service.js";
import { classifyAssessmentFailure } from "../../repositories/lead-duplicate-risk.repository.js";
import {
  evaluateClientSheetsPersonGate,
  prepareClientSheetsHistoryBaseline,
} from "./client-sheets-person-gate.js";

const HISTORY_REASONS = new Set(["history_coverage_partial", "history_coverage_unavailable"]);
const TRANSIENT_REASON = "assessment_failed_transient";

export type SheetsPersonRecoveryActor = "drain" | "operator";

/**
 * Re-reads a held Sheets intent after the underlying assessment or history
 * gap can move. Updates the same intent. Does not create a job, append a row,
 * or write the GHL outbox.
 */
export async function recoverClientSheetsPersonHold(
  db: PrismaClient,
  sourceLeadEventId: string,
  actor: SheetsPersonRecoveryActor,
  now = new Date()
): Promise<{ ok: true; status: string; reason: string | null; promoted: boolean } | { ok: false; code: string }> {
  const lead = await db.sourceLeadEvent.findUnique({ where: { id: sourceLeadEventId } });
  if (!lead) return { ok: false, code: "lead_not_found" };
  const clientAccountId = lead.clientAccountIdResolved?.trim() ?? "";
  if (!clientAccountId) return { ok: false, code: "client_not_confirmed" };
  const intent = await db.companySheetsDispatchIntent.findUnique({
    where: { idempotencyKey: `campaign:${clientAccountId}:${lead.id}` },
  });
  if (!intent) return { ok: false, code: "intent_not_found" };
  if (intent.status !== "assessment_held" && intent.status !== "assessment_failed" && intent.status !== "review_held") {
    return { ok: true, status: intent.status, reason: intent.reason, promoted: false };
  }

  if (intent.status === "review_held" && HISTORY_REASONS.has(intent.reason ?? "")) {
    await prepareClientSheetsHistoryBaseline(db, { clientAccountId });
    return promoteFromGate(db, intent.id, clientAccountId, lead.id, now);
  }
  if (intent.status === "review_held") {
    return { ok: true, status: intent.status, reason: intent.reason, promoted: false };
  }

  const drainTransient = actor === "drain" && intent.reason === TRANSIENT_REASON;
  const operatorAssessment = actor === "operator";
  if (!drainTransient && !operatorAssessment) {
    return { ok: true, status: intent.status, reason: intent.reason, promoted: false };
  }

  const decisionId = lead.routingDryRunDecisionId?.trim() || null;
  if (decisionId) {
    const assessment = await db.leadDuplicateRiskAssessment.findUnique({ where: { routingDryRunDecisionId: decisionId } });
    if (!assessment) {
      const retry = await retryDuplicateRiskAssessment(db, decisionId);
      if (!retry.ok && retry.failureClass === "transient") {
        const later = new Date(now.getTime() + 30_000);
        await db.companySheetsDispatchIntent.update({
          where: { id: intent.id },
          data: {
            status: "assessment_failed",
            reason: TRANSIENT_REASON,
            lastError: "assessment_failed",
            availableAt: later,
          },
        });
        return { ok: true, status: "assessment_failed", reason: TRANSIENT_REASON, promoted: false };
      }
      if (!retry.ok) {
        await db.companySheetsDispatchIntent.update({
          where: { id: intent.id },
          data: {
            status: "assessment_failed",
            reason: "assessment_needs_review",
            lastError: "assessment_failed",
          },
        });
        return { ok: true, status: "assessment_failed", reason: "assessment_needs_review", promoted: false };
      }
    }
  }
  return promoteFromGate(db, intent.id, clientAccountId, lead.id, now);
}

async function promoteFromGate(
  db: PrismaClient,
  intentId: string,
  clientAccountId: string,
  sourceLeadEventId: string,
  now: Date
) {
  const gate = await evaluateClientSheetsPersonGate(db, { clientAccountId, sourceLeadEventId });
  if (!gate.ok) {
    const later = new Date(now.getTime() + 30_000);
    await db.companySheetsDispatchIntent.update({
      where: { id: intentId },
      data: {
        status: gate.intentStatus ?? "review_held",
        reason: gate.reason,
        lastError: gate.code,
        availableAt: gate.reason === TRANSIENT_REASON || gate.reason.startsWith("history_coverage_") ? later : undefined,
      },
    });
    return { ok: true as const, status: gate.intentStatus ?? "review_held", reason: gate.reason, promoted: false };
  }
  await db.companySheetsDispatchIntent.update({
    where: { id: intentId },
    data: { status: "pending", reason: "person_hold_recovered", lastError: null, availableAt: now },
  });
  return { ok: true as const, status: "pending", reason: "person_hold_recovered", promoted: true };
}

async function retryDuplicateRiskAssessment(
  db: PrismaClient,
  routingDryRunDecisionId: string
): Promise<{ ok: true } | { ok: false; failureClass: "transient" | "review" }> {
  const decision = await db.routingDryRunDecision.findUnique({ where: { id: routingDryRunDecisionId } });
  const lead = decision
    ? await db.sourceLeadEvent.findFirst({ where: { routingDryRunDecisionId: decision.id } })
    : null;
  const parsed = lifecycleEventSchema.safeParse(lead?.rawPayloadJson);
  if (!decision || !lead || !parsed.success) return { ok: false, failureClass: "review" };
  try {
    await evaluateAndPersistDuplicateRiskForRoutingDecision({
      routingDryRunDecisionId: decision.id,
      masterClientAccountId: decision.masterClientAccountId,
      destinationClientAccountId: decision.destinationClientAccountId,
      destinationSubaccountIdGhl: decision.destinationSubaccountIdGhl,
      sourceEventUuid: decision.sourceEventUuid,
      sourceLeadUid: decision.sourceLeadUid,
      payload: parsed.data,
      eventReceivedAt: lead.receivedAt,
    });
    return { ok: true };
  } catch (err) {
    const failureClass = classifyAssessmentFailure(err);
    await db.duplicateRiskAssessmentFailure.upsert({
      where: { routingDryRunDecisionId: decision.id },
      create: {
        routingDryRunDecisionId: decision.id,
        errorName: err instanceof Error ? err.name : "Error",
        failureClass,
      },
      update: { errorName: err instanceof Error ? err.name : "Error", failureClass },
    });
    return { ok: false, failureClass };
  }
}

export async function recoverDueSheetsPersonHolds(
  db: PrismaClient,
  now: Date,
  limit: number
): Promise<number> {
  const intents = await db.companySheetsDispatchIntent.findMany({
    where: {
      kind: "campaign_lead",
      availableAt: { lte: now },
      OR: [
        { status: "assessment_failed", reason: TRANSIENT_REASON },
        { status: "review_held", reason: { in: [...HISTORY_REASONS] } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { sourceLeadEventId: true },
  });
  let recovered = 0;
  for (const intent of intents) {
    if (!intent.sourceLeadEventId) continue;
    const result = await recoverClientSheetsPersonHold(db, intent.sourceLeadEventId, "drain", now);
    if (result.ok) recovered += 1;
  }
  return recovered;
}
