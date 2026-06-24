import type { SourceLeadEventStatus } from "@prisma/client";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { prisma } from "../../lib/db.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import {
  canNormalizeLeadCaptureIoWebhook,
  inferLeadCaptureIoRoutingKeys,
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
  type LeadCaptureIoSourceSystem,
} from "./leadcapture-io-normalizer.js";
import {
  applyLeadCaptureEndpointDefaults,
  resolveLeadCaptureLeadId,
  resolveLeadCaptureRouteKey,
} from "./leadcapture-payload-resolver.js";
import { stripLeadCaptureInternalMetadata } from "../../lib/leadcapture-webhook-body.js";

export type LeadCaptureIoIntakeInput = {
  rawPayload: Record<string, unknown>;
  routeKeyFromPath?: string;
  webhookRequestLogId?: string;
};

export type SourceLeadIntakeResult = {
  ok: true;
  provider: "leadcapture_io";
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  sourceLeadId: string;
  sourceLeadIdGenerated?: boolean;
  normalizedLeadUid: string;
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  routingDryRunDecisionId?: string;
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

/** Process LeadCapture.io webhook: store raw, normalize, route, duplicate check — no GHL delivery. */
export async function processLeadCaptureIoWebhookIntake(
  input: LeadCaptureIoIntakeInput
): Promise<SourceLeadIntakeResult> {
  const rawStored = stripLeadCaptureInternalMetadata(input.rawPayload);
  if (!canNormalizeLeadCaptureIoWebhook(rawStored, input.routeKeyFromPath)) {
    throw new Error("invalid_leadcapture_io_payload");
  }

  const raw = applyLeadCaptureEndpointDefaults(rawStored, input.routeKeyFromPath);
  const now = new Date();
  const routingHints = inferLeadCaptureIoRoutingKeys(raw, input.routeKeyFromPath);
  const routeKey = resolveLeadCaptureRouteKey(raw, input.routeKeyFromPath);
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(raw, routeKey);
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
    webhookRequestLogId: input.webhookRequestLogId ?? null,
    status: "received",
    rawPayloadJson: rawStored as object,
    receivedAt: now,
  });

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw, {
    routeKeyFromPath: input.routeKeyFromPath,
  });
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
      sourceLeadIdGenerated,
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

  const { routing, status } = await persistRoutingAndDuplicate(
    event.id,
    parsed.data,
    raw,
    "leadcapture_io",
    sourceSystem,
    routeKey,
    leadId,
    sourceLeadIdGenerated,
    now.toISOString(),
    now
  );

  return {
    ok: true,
    provider: "leadcapture_io",
    sourceEventId: event.id,
    status,
    sourceRouteKey: routeKey,
    sourceLeadId: leadId,
    sourceLeadIdGenerated,
    normalizedLeadUid: parsed.data.contact.lead_uid,
    matched: routing.matched,
    matchedRuleId: routing.matchedRuleId,
    destinationClientAccountId: routing.destinationClientAccountId,
    destinationLocationIdGhl: routing.destinationLocationIdGhl,
    routingDryRunDecisionId: routing.routingDryRunDecisionId,
    nextAction: "Review and approve delivery in Admin C.O.C.",
  };
}

export type SourceLeadIntakeServiceDeps = {
  prisma: typeof prisma;
};

export { prisma as defaultSourceLeadIntakePrisma };
