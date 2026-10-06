import type { PrismaClient, SourceLeadEvent } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { trackCampaignInventoryFromSourceEvent } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import { resolveLegacyLeadCaptureSourceIdentity } from "./leadcapture-legacy-source-identity.js";
import {
  applyLeadCaptureEndpointDefaults,
  getLeadCaptureFormRecord,
  materializeLeadCapturePayload,
  resolveLeadCaptureLeadId,
} from "./leadcapture-payload-resolver.js";
import { observeNextGenSourceFunnelSafely } from "./source-funnel.service.js";

type RepairableEvent = Pick<
  SourceLeadEvent,
  | "id"
  | "sourceProvider"
  | "sourceSystem"
  | "sourceRouteKey"
  | "sourceLeadId"
  | "rawPayloadJson"
  | "normalizedPayloadJson"
>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nestedSourceIntake(payload: unknown): Record<string, unknown> | null {
  const normalized = asRecord(payload);
  const routing = asRecord(normalized?.routing);
  return asRecord(routing?.source_intake);
}

function validLegacyNumericLeadId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export type LegacyFormRepairPlan =
  | {
      eligible: false;
      sourceEventId: string;
      reason:
        | "not_legacy_leadcapture"
        | "source_lead_id_not_generated"
        | "native_form_lead_id_invalid"
        | "source_route_key_missing";
    }
  | {
      eligible: true;
      sourceEventId: string;
      previousSourceLeadId: string | null;
      sourceLeadId: string;
      sourceLeadUid: string;
      sourceRouteKey: string;
      providerFormId: string | null;
      sourceCampaignId: string;
      parentUrlKey: string | null;
    };

/** Pure, fail-closed eligibility check used before any repair write. */
export function planLegacyLeadCaptureFormEventRepair(
  event: RepairableEvent
): LegacyFormRepairPlan {
  if (
    event.sourceProvider !== "leadcapture_io" ||
    event.sourceSystem !== "leadcapture_io_legacy"
  ) {
    return {
      eligible: false,
      sourceEventId: event.id,
      reason: "not_legacy_leadcapture",
    };
  }
  const sourceIntake = nestedSourceIntake(event.normalizedPayloadJson);
  if (sourceIntake?.source_lead_id_generated !== true) {
    return {
      eligible: false,
      sourceEventId: event.id,
      reason: "source_lead_id_not_generated",
    };
  }
  const raw = asRecord(event.rawPayloadJson);
  const formLeadId = validLegacyNumericLeadId(
    raw ? getLeadCaptureFormRecord(raw)?.lead_id : undefined
  );
  if (!raw || !formLeadId) {
    return {
      eligible: false,
      sourceEventId: event.id,
      reason: "native_form_lead_id_invalid",
    };
  }
  const routeKey = event.sourceRouteKey?.trim();
  if (!routeKey) {
    return {
      eligible: false,
      sourceEventId: event.id,
      reason: "source_route_key_missing",
    };
  }
  const effective = materializeLeadCapturePayload(
    applyLeadCaptureEndpointDefaults(raw, routeKey),
    { routeKeyFromPath: routeKey }
  );
  const identity = resolveLegacyLeadCaptureSourceIdentity(effective, routeKey);
  return {
    eligible: true,
    sourceEventId: event.id,
    previousSourceLeadId: event.sourceLeadId,
    sourceLeadId: formLeadId,
    sourceLeadUid: `leadcaptureio-leadcapture_io_legacy-${formLeadId}`,
    sourceRouteKey: routeKey,
    providerFormId:
      identity.stableSourceIdKind === "form_id" ? identity.stableSourceId : null,
    sourceCampaignId: identity.sourceCampaignId,
    parentUrlKey: identity.parentUrlKey,
  };
}

export type LegacyFormRepairResult =
  | LegacyFormRepairPlan
  | {
      eligible: true;
      applied: true;
      sourceEventId: string;
      sourceLeadId: string;
      inventoryTracking: Awaited<
        ReturnType<typeof trackCampaignInventoryFromSourceEvent>
      >;
    };

/**
 * Repairs one existing row in place. Preview is the default; `apply: true` is required.
 * It never creates a SourceLeadEvent. Existing inventory is reused through the canonical tracker.
 */
export async function repairLegacyLeadCaptureFormEvent(
  input: { sourceEventId: string; apply?: boolean },
  db: PrismaClient = prisma
): Promise<LegacyFormRepairResult> {
  const event = await db.sourceLeadEvent.findUnique({
    where: { id: input.sourceEventId },
  });
  if (!event) throw new Error("source_event_not_found");
  const plan = planLegacyLeadCaptureFormEventRepair(event);
  if (!plan.eligible || input.apply !== true) return plan;

  const collision = await db.sourceLeadEvent.findFirst({
    where: {
      id: { not: event.id },
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      sourceLeadId: plan.sourceLeadId,
    },
    select: { id: true },
  });
  if (collision) throw new Error(`canonical_source_event_conflict:${collision.id}`);

  const raw = asRecord(event.rawPayloadJson)!;
  const effective = applyLeadCaptureEndpointDefaults(raw, plan.sourceRouteKey);
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(effective, {
    routeKeyFromPath: plan.sourceRouteKey,
  });
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) throw new Error("repaired_payload_schema_invalid");
  const resolved = resolveLeadCaptureLeadId(effective, plan.sourceRouteKey);
  if (resolved.sourceLeadIdGenerated || resolved.leadId !== plan.sourceLeadId) {
    throw new Error("repaired_source_identity_mismatch");
  }

  const identity = resolveLegacyLeadCaptureSourceIdentity(
    materializeLeadCapturePayload(effective, {
      routeKeyFromPath: plan.sourceRouteKey,
    }),
    plan.sourceRouteKey
  );
  await observeNextGenSourceFunnelSafely({ identity });

  await db.sourceLeadEvent.update({
    where: { id: event.id },
    data: {
      sourceLeadId: plan.sourceLeadId,
      sourceLeadUid: plan.sourceLeadUid,
      sourceCampaignId: plan.sourceCampaignId,
      sourceCampaignName: identity.sourceCampaignName,
      sourceFunnelName: identity.sourceFunnelName,
    },
  });

  const now = new Date();
  await persistRoutingAndDuplicate(
    event.id,
    parsed.data,
    effective,
    "leadcapture_io",
    "leadcapture_io_legacy",
    plan.sourceRouteKey,
    plan.sourceLeadId,
    false,
    now.toISOString(),
    now
  );
  const inventoryTracking = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
    db
  );

  await db.sourceLeadEvent.update({
    where: { id: event.id },
    data: {
      errorSummary: inventoryTracking.ok ? null : "Legacy form repair inventory tracking failed.",
    },
  });
  return {
    eligible: true,
    applied: true,
    sourceEventId: event.id,
    sourceLeadId: plan.sourceLeadId,
    inventoryTracking,
  };
}
