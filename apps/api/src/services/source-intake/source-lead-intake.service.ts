import type { SourceLeadEventStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { prisma } from "../../lib/db.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { runRoutingDryRun } from "../routing-dry-run.service.js";
import { evaluateSourceLeadDuplicateRisk } from "./source-lead-duplicate-risk.service.js";
import {
  canNormalizeLeadCaptureIoWebhook,
  inferLeadCaptureIoRoutingKeys,
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
  type LeadCaptureIoSourceSystem,
} from "./leadcapture-io-normalizer.js";
import type { SourceLeadRoutingResult } from "./source-intake.types.js";

export type LeadCaptureIoIntakeInput = {
  rawPayload: Record<string, unknown>;
  routeKeyFromPath?: string;
};

export type SourceLeadIntakeResult = {
  ok: true;
  provider: "leadcapture_io";
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  sourceLeadId: string;
  normalizedLeadUid: string;
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  nextAction: string;
  devWarning?: string;
};

function resolveLeadCaptureSourceSystem(raw: Record<string, unknown>): LeadCaptureIoSourceSystem {
  const v = typeof raw.sa360_source_system === "string" ? raw.sa360_source_system.trim() : "";
  return v === "leadcapture_io_nextgen" ? "leadcapture_io_nextgen" : "leadcapture_io_legacy";
}

function resolveLeadCaptureSourceType(raw: Record<string, unknown>): "webhook" | "lead_form" {
  const t = typeof raw.sa360_source_type === "string" ? raw.sa360_source_type.trim() : "";
  if (t === "webhook") return "webhook";
  return "lead_form";
}

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

async function persistRoutingAndDuplicate(
  sourceEventId: string,
  normalized: LifecycleEventSchema,
  now: Date
): Promise<{
  routing: SourceLeadRoutingResult;
  duplicateRiskJson: object | null;
  status: SourceLeadEventStatus;
}> {
  const dryRun = await runRoutingDryRun(normalized);
  const routing: SourceLeadRoutingResult = {
    matched: dryRun.matched,
    matchedRuleId: dryRun.matchedRuleId,
    destinationClientAccountId: dryRun.destinationClientAccountId,
    destinationLocationIdGhl: dryRun.destinationSubaccountIdGhl,
    reason: dryRun.reason,
    matchType: dryRun.matchType,
    routingDryRunDecisionId: dryRun.decisionId,
  };

  const duplicateRisk = await evaluateSourceLeadDuplicateRisk({
    payload: normalized,
    destinationClientAccountId: dryRun.destinationClientAccountId ?? null,
    destinationSubaccountIdGhl: dryRun.destinationSubaccountIdGhl ?? null,
    routingDryRunDecisionId: dryRun.decisionId,
  });

  let status: SourceLeadEventStatus;
  if (duplicateRisk.blocksDelivery) {
    status = "duplicate_blocked";
  } else if (dryRun.matched) {
    status = "routing_matched";
  } else {
    status = "routing_unmatched";
  }

  await updateSourceLeadEvent(sourceEventId, {
    status,
    normalizedPayloadJson: normalized as object,
    routingResultJson: routing as object,
    duplicateRiskJson: duplicateRisk as object,
    routingDryRunDecisionId: dryRun.decisionId,
    clientAccountIdResolved: dryRun.destinationClientAccountId ?? null,
    destinationLocationIdResolved: dryRun.destinationSubaccountIdGhl ?? null,
    routingRuleIdResolved: dryRun.matchedRuleId ?? null,
    routedAt: now,
  });

  return { routing, duplicateRiskJson: duplicateRisk, status };
}

/** Process LeadCapture.io webhook: store raw, normalize, route, duplicate check — no GHL delivery. */
export async function processLeadCaptureIoWebhookIntake(
  input: LeadCaptureIoIntakeInput
): Promise<SourceLeadIntakeResult> {
  const raw = input.rawPayload;
  if (!canNormalizeLeadCaptureIoWebhook(raw)) {
    throw new Error("invalid_leadcapture_io_payload");
  }

  const now = new Date();
  const routingHints = inferLeadCaptureIoRoutingKeys(raw);
  const routeKey =
    trimOrUndefined(raw.sa360_route_key) ?? input.routeKeyFromPath ?? routingHints.sourceRouteKey ?? "";
  const leadId = trimOrUndefined(raw.lead_id) ?? "unknown_lead";
  const sourceSystem = resolveLeadCaptureSourceSystem(raw);
  const sourceType = resolveLeadCaptureSourceType(raw);

  const event = await createSourceLeadEvent({
    sourceProvider: "leadcapture_io",
    sourceSystem,
    sourceType,
    sourceRouteKey: routeKey,
    sourceCampaignId: routeKey,
    sourceCampaignName: routingHints.campaignName ?? null,
    sourceFunnelName: routingHints.funnelName ?? null,
    sourceLeadId: leadId,
    sourceLeadUid: `leadcaptureio-${sourceSystem}-${leadId}`,
    status: "received",
    rawPayloadJson: raw as object,
    receivedAt: now,
  });

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized payload failed lifecycle schema validation.",
      normalizedAt: now,
    });
    return {
      ok: true,
      provider: "leadcapture_io",
      sourceEventId: event.id,
      status: "needs_review",
      sourceRouteKey: routeKey,
      sourceLeadId: leadId,
      normalizedLeadUid: normalized.contact.lead_uid,
      matched: false,
      nextAction: "Review and approve delivery in Admin C.O.C.",
    };
  }

  await updateSourceLeadEvent(event.id, {
    status: "normalized",
    normalizedPayloadJson: parsed.data as object,
    normalizedAt: now,
  });

  const { routing, status } = await persistRoutingAndDuplicate(event.id, parsed.data, now);

  return {
    ok: true,
    provider: "leadcapture_io",
    sourceEventId: event.id,
    status,
    sourceRouteKey: routeKey,
    sourceLeadId: leadId,
    normalizedLeadUid: parsed.data.contact.lead_uid,
    matched: routing.matched,
    matchedRuleId: routing.matchedRuleId,
    destinationClientAccountId: routing.destinationClientAccountId,
    destinationLocationIdGhl: routing.destinationLocationIdGhl,
    nextAction: "Review and approve delivery in Admin C.O.C.",
  };
}

export type SourceLeadIntakeServiceDeps = {
  prisma: typeof prisma;
};

export { prisma as defaultSourceLeadIntakePrisma };
